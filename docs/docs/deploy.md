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

## Runtime Paths

Framework server endpoints are derived from `server.basePath`:

```txt
/__evjs/fn       server functions
/__evjs/ppr      PPR region direct/debug endpoint when PPR pages exist
/__evjs/rsc      RSC Flight endpoint when server.rsc is enabled
```

PPR document requests are served through their page route. The PPR endpoint is
kept for direct/debug access and fallback adapters, not as the default browser
initial-load protocol.

If browser and server run on different origins, configure `transport.baseUrl` at build time.

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

Do not read legacy client/server manifest files; they are not the new framework contract.
