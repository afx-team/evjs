# Deployment

Production deployment starts with `ev build`. By default evjs writes browser
files to `dist/client` and, when the app uses server capabilities, server files
to `dist/server`.

Use a deployment adapter when you want evjs to emit platform-specific files such
as a Node server entry, static-host redirects, or an edge worker.

## Production Build

```bash
npm run build
# usually runs: ev build
```

Typical output:

```txt
dist/
├── client/
│   ├── manifest.json
│   └── ...
├── server/
│   ├── manifest.json
│   └── ...
└── build-output.json
```

Important paths:

- `dist/client/`: browser assets and generated HTML.
- `dist/client/manifest.json`: browser-safe route and asset metadata for
  deployment tooling.
- `dist/server/`: server bundle and server metadata when the app uses server
  functions, server file routes, SSR, PPR, or RSC.
- `dist/server/manifest.json`: lightweight server manifest with the server
  entry and server-handled route projection for deployment compatibility.
- `dist/build-output.json`: canonical deployment metadata for tooling and
  deployment adapters. Application code should not import or edit it.

Generated HTML embeds the browser `ClientRuntime`. The manual `@evjs/client`
runtime URL APIs still support loading JSON from a configured URL, but CLI
builds no longer emit `dist/client/runtime.json` by default.
Runtime-only `FrameworkRuntime` data is passed through build/plugin results and
injected into dev or deployment adapter bootstraps; it is not emitted as a
default JSON artifact.

## Choose A Target

| Target | Use when | Adapter |
| --- | --- | --- |
| Static hosting | The app only needs browser assets, CSR, MPA client pages, or fully static/SSG pages. | `staticDeploymentAdapter()` |
| Node.js | A Node process should serve assets and all server capabilities. | `nodeDeploymentAdapter()` |
| Edge worker | The platform provides a `fetch()` worker and an asset binding. | `edgeDeploymentAdapter()` |
| CDN + origin split | Static assets live on a CDN and server capabilities live elsewhere. | Use a server-capable adapter plus platform routing. |

Do not deploy only `dist/client` when the app uses server functions, server file
routes, SSR, PPR, or RSC. Those features require a server-capable target.

## Runtime Paths

Server runtime paths are derived from `server.basePath`:

```txt
/__evjs/fn       server functions
/__evjs/ppr      PPR support endpoint when PPR pages exist
/__evjs/rsc      RSC Flight endpoint when RSC pages exist
```

Most apps can keep the default `server.basePath`. Change it only when the host
platform reserves `/__evjs`, or when a reverse proxy requires another prefix.

PPR document requests still go through the page route. The PPR support endpoint
is for framework/runtime coordination and direct debugging; it is not a user
authored API route.

When browser assets and the server runtime are on different origins, set
`transport.baseUrl` at build time:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

## Built-In Adapters

`@evjs/ev` ships three deployment adapters:

- `nodeDeploymentAdapter()` emits a Node server module plus deployment metadata.
- `staticDeploymentAdapter()` emits static-host metadata plus `_redirects`.
- `edgeDeploymentAdapter()` emits an edge-worker module plus deployment metadata.

Adapters work from the evjs build result. They should not infer framework
capabilities from filenames or bundler stats.

## Node.js

Use the Node adapter when a plain Node server should own the production request
path:

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

The generated server serves `dist/client`, handles server functions and server
file routes, mounts SSR/PPR/RSC document routes, and falls back to app HTML for
client-side navigation. It reads the port from `PORT` by default.

## Static Hosting

Use the static adapter when the app is static-compatible:

```ts
import { defineConfig, staticDeploymentAdapter } from "@evjs/ev";

export default defineConfig({
  plugins: [staticDeploymentAdapter()],
});
```

The adapter writes static-host files into the public output directory:

```txt
dist/client/
├── deployment.static.json
└── _redirects
```

Generated redirects map static or SSG pages to their HTML files and app routes
to the app HTML fallback. Router-free MPA pages use exact rewrites and do not
create a global catch-all.

If the build contains SSR, PPR, RSC, server functions, or server file routes,
the static adapter still emits assets and metadata, but marks the static output
as incomplete in `deployment.static.json`. In that case the app also needs a
server-capable deployment path.

## Edge Runtime

Use the edge adapter when the platform provides a `fetch()` worker and a static
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

After `ev build`, the adapter emits:

```txt
dist/
├── deployment.edge.json
└── worker.mjs
```

The generated worker routes server runtime requests and server-rendered page
requests to the server bundle, and serves browser assets from the configured
asset binding.

## Docker

For Docker, use the Node adapter and run the generated `dist/server.mjs`:

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

## Custom Deployment Plugins

Deployment plugins can use `buildEnd({ deploymentMetadata })` to emit platform
files. For platform-specific compatibility fields, wrap that metadata before
writing files:

```ts
export function deployAdapter() {
  return {
    name: "deploy-adapter",
    setup() {
      return {
        buildEnd({ deploymentMetadata }) {
          const artifact = {
            ...deploymentMetadata,
            platform: "custom",
          };

          emitPlatformFiles(artifact);
        },
      };
    },
  };
}
```

Keep custom adapters focused on platform routing, asset serving, and process or
worker bootstrap. Application code should continue to use evjs file
conventions instead of reading deployment metadata directly.
