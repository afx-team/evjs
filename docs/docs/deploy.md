# Deployment

An evjs production build contains static assets, an optional server bundle, and a single framework manifest.

```txt
dist/
├── client/
├── server/
└── manifest.json
```

Deployment adapters should consume `dist/manifest.json` / `BuildOutput` and derive platform-specific routing or asset manifests from it.

## Production Build

```bash
npm run build
# usually runs: ev build
```

Important output:

- `dist/manifest.json` — apps, pages, routes, assets, server functions, server routes, remotes, and runtime paths;
- `dist/client/` — browser assets and HTML;
- `dist/server/` — framework server bundle when `server` is enabled.

## Capability Model

Deployment is driven by framework capabilities, not by the bundler that produced
the files. A deployment adapter should classify the manifest into these runtime
requirements:

| Capability | Public entry | Required runtime | Notes |
| --- | --- | --- | --- |
| Static assets | `dist/client/*` | CDN/static file server | Always safe to cache by filename. |
| CSR app routes | app HTML fallback | static or server | Static rewrite is enough when no server capability is used. |
| MPA entry pages | page HTML file | static or server | Static when the page is user-owned client entry or fully prerendered. |
| SSG pages | page HTML file | static or server | Can be hosted statically unless paired with dynamic server APIs. |
| SSR pages | page route | server-capable | Route must reach the framework server bundle. |
| PPR pages | page route | server-capable or edge+origin | Browser requests the page route; region resolution may be in-process or server-to-server. |
| RSC pages | page route + `runtime.server.rsc` | server-capable | The document route and Flight endpoint must share compatible manifests/assets. |
| Server functions | `runtime.server.fn` | server-capable | Usually same origin/base path as SSR/RSC/PPR unless `transport.baseUrl` splits it. |
| Server routes | declared route path | server-capable | Route methods and 405 behavior belong to `@evjs/server`. |
| Remote host | remote manifest URL | static or server | Host can be static; remote manifest/assets are fetched at runtime. |
| Remote app build | `evjs-remote.json` + assets | CDN/static file server | Remote lifecycle/shared metadata is manifest-driven. |

This gives four practical deployment topologies:

1. **Static-only**: CSR, MPA client entries, SSG, remote manifests, and static
   assets. No server functions, SSR, PPR, RSC, or server routes.
2. **Unified Node**: one Node process serves `dist/client`, framework endpoints,
   SSR/PPR/RSC document routes, server functions, and server routes.
3. **Unified Edge Worker**: one edge worker serves assets from a binding and
   delegates framework requests to the edge-compatible server bundle.
4. **Edge + Origin/FaaS split**: CDN/edge owns assets and cached shells; internal
   origin/FaaS owns server functions, SSR/RSC rendering, and PPR dynamic regions.

The long-term adapter contract is:

```txt
BuildOutput
  -> classify required capabilities
  -> map public asset root
  -> map framework endpoints
  -> map document routes
  -> map server routes
  -> emit platform routing/artifacts
```

Adapters should never infer these capabilities from filenames or bundler stats.

## Runtime Paths

Framework server endpoints are derived from `server.basePath`:

```txt
/__evjs/fn       server functions
/__evjs/ppr      PPR region direct/debug endpoint when PPR pages exist
/__evjs/rsc      RSC Flight endpoint when server.rsc is enabled
```

PPR document requests are served through their page route. The PPR endpoint is
available for direct/debug access, not as the default browser initial-load
protocol.

For production deployments that cache the PPR shell at the edge while rendering
dynamic regions in an internal FaaS/origin, keep the browser-facing protocol as
the page route:

```txt
Browser
  GET /campaign
    -> Edge/CDN
       load cached shell
       read public manifest PPR region metadata
       server-to-server GET /__evjs/ppr/campaign/offer
         -> Internal FaaS/origin renders region fragment
       merge or stream the region into the same /campaign response
    <- Browser receives one document response
```

In this topology `/__evjs/ppr/<page>/<region>` is not a browser initial-load
request. It is an internal region resolver endpoint used by the edge/runtime
layer. Source modules declare `prerender.delivery = "merge"` to wait for
required regions before returning the document, or
`prerender.delivery = "stream"` to flush the cached shell first and append
region patches to the same HTML response as internal region requests complete.

If browser and server run on different origins, configure `transport.baseUrl` at build time.

## Routing Priority

Server-capable adapters should apply routing in this order:

```txt
1. immutable/static assets from dist/client
2. framework endpoints: runtime.server.fn, runtime.server.ppr, runtime.server.rsc
3. explicit server routes from BuildOutput.server.routes
4. framework document routes: SSR, PPR, RSC, and server-rendered SSG fallback
5. app/page HTML fallback for CSR navigation
6. 404
```

Static-only adapters should emit redirects only for capabilities that can run
without a server. If `BuildOutput` contains SSR, PPR, RSC, server functions, or
server routes, the static adapter can still emit static assets and metadata, but
it must not claim the full app is deployable on static hosting alone.

## Built-In Adapters

`@evjs/ev` ships three deployment adapters:

- `nodeDeploymentAdapter()` emits a Node server entry plus deployment metadata.
- `staticDeploymentAdapter()` emits deployment metadata plus `_redirects` for
  static hosts that support SPA/MPA rewrites.
- `edgeDeploymentAdapter()` emits deployment metadata plus an edge-worker module
  that delegates framework requests to the server bundle and static assets to an
  asset binding.

All three adapters derive from `BuildOutput`; none of them read bundler stats or
bundler config.

## Node.js

Use the built-in Node deployment adapter when the app should run on a plain Node server:

```ts
// ev.config.ts
import { defineConfig, nodeDeploymentAdapter } from "@evjs/ev";

export default defineConfig({
  plugins: [nodeDeploymentAdapter()],
});
```

After `ev build`, the adapter emits:

```txt
dist/
├── deployment.node.json
└── server.mjs
```

Run the generated server module:

```bash
node dist/server.mjs
```

The generated server mounts the framework server bundle at `server.basePath`,
mounts SSR/PPR/RSC document routes and explicit server routes, serves
`dist/client`, and falls back to the app HTML for client routes.

If you need full control, the equivalent shape is:

```js
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@evjs/server/node";
import serverHandler from "./dist/server/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, "dist/client");

const app = {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/__evjs/") || url.pathname === "/dashboard") {
      return serverHandler.fetch(request);
    }

    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    try {
      return new Response(await readFile(path.join(clientRoot, file)));
    } catch {
      return new Response(await readFile(path.join(clientRoot, "index.html")));
    }
  },
};

serve(app, { port: Number(process.env.PORT ?? 3000) });
```

Adjust the mounted framework path if `server.basePath` is not `/__evjs`.

## Static Hosting

Use the static adapter when the build output only needs static routing metadata:

```ts
import { defineConfig, staticDeploymentAdapter } from "@evjs/ev";

export default defineConfig({
  plugins: [staticDeploymentAdapter()],
});
```

The adapter emits:

```txt
dist/
├── deployment.static.json
└── _redirects
```

The generated redirects map static/SSG pages to their HTML files and app routes
to the app HTML fallback. SSR, PPR, RSC, server functions, and explicit server
routes still require a server-capable adapter.

## Edge Runtime

Use the edge adapter when the platform provides a `fetch()` worker and static
asset binding:

```ts
import { defineConfig, edgeDeploymentAdapter } from "@evjs/ev";

export default defineConfig({
  plugins: [
    edgeDeploymentAdapter({
      assetsBinding: "ASSETS",
    }),
  ],
});
```

The adapter emits:

```txt
dist/
├── deployment.edge.json
└── worker.mjs
```

The generated worker imports the server bundle from `dist/server`, routes
framework requests and SSR/PPR/RSC document requests to that bundle, and serves
browser assets through the configured binding.

## Docker

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.mjs"]
```

## Deployment Plugins

Deployment plugins should use `buildOutput()` or `buildEnd({ output })`.
For platform-specific files, start from `createDeploymentArtifact()`:

```ts
import { createDeploymentArtifact } from "@evjs/ev";

export function deployAdapter() {
  return {
    name: "deploy-adapter",
    setup() {
      return {
        buildOutput(output) {
          output.deployment = {
            platform: "custom",
            publicPath: output.publicPath,
            server: output.runtime.server,
          };
        },
        buildEnd({ output }) {
          emitPlatformFiles(createDeploymentArtifact(output, {
            platform: "custom",
          }));
        },
      };
    },
  };
}
```

Read `dist/manifest.json`; split client/server manifest files are not part of
the framework contract.
