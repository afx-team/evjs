# Deployment

Run a production build, then deploy the browser output and any server output
required by the application:

```bash
npm run build
# usually runs: ev build
```

## Choose a target

| Target | Choose it when | Built-in adapter |
| --- | --- | --- |
| Static hosting | The app uses CSR, MPA client pages, or SSG and no runtime server feature | `staticDeploymentAdapter()` |
| Node.js | One Node process should serve assets and all server capabilities | `nodeDeploymentAdapter()` |
| Edge worker | The platform provides a Fetch-compatible worker and asset binding | `edgeDeploymentAdapter()` |
| CDN + origin | Browser assets live on a CDN and server work lives elsewhere | Server-capable adapter plus platform routing |

Server functions, API routes, SSR, PPR, and RSC require a server-capable
target. Do not deploy only `dist/client` when any of those features are active.

## Understand the output

The default production layout is:

```text
dist/
├── client/                          # HTML, JS, CSS, and public assets
├── server/                          # server bundle when required
└── deployment-metadata.json        # input for deployment tooling
```

Deployment adapters may add platform entry files and routing metadata. Treat
everything under `dist` as generated.

## Static hosting

Install the static adapter:

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";
import { staticDeploymentAdapter } from "@evjs/ev/deployment";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [staticDeploymentAdapter()],
});
```

After `ev build`, static-host files are written with the browser output:

```text
dist/client/
├── deployment.static.json
└── _redirects
```

The redirects map static pages to their HTML and, for an SPA, map browser
routes to the application document. Router-free MPA pages use exact rewrites
without a global SPA fallback.

If the build contains a server capability, the adapter marks the static output
as incomplete. Keep the static files for a CDN, but also deploy the server
output to a compatible runtime.

## Node.js

Use the Node adapter when a Node process should own production requests:

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";
import { nodeDeploymentAdapter } from "@evjs/ev/deployment";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [nodeDeploymentAdapter()],
});
```

The build adds:

```text
dist/
├── deployment.node.json
└── server.mjs
```

Start the generated server:

```bash
PORT=3000 node dist/server.mjs
```

It serves browser assets, handles server functions and API routes, renders
request-time pages, and provides the SPA fallback when needed.

## Docker

Build the application with the Node adapter and run its generated server:

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

If runtime dependencies are bundled completely, your project may support a
smaller final image. Confirm that with the selected bundler and every native or
external server dependency before removing installed packages.

## Edge runtime

Use the edge adapter when the host provides a Fetch-compatible worker and a
binding for static assets:

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";
import { edgeDeploymentAdapter } from "@evjs/ev/deployment";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [
    edgeDeploymentAdapter({
      assetsBinding: "ASSETS",
    }),
  ],
});
```

The build adds:

```text
dist/
├── deployment.edge.json
└── worker.mjs
```

Connect the configured asset binding to `dist/client` according to the host's
deployment settings. The worker handles server requests and delegates public
assets to that binding.

## Split browser and server origins

When a CDN serves `dist/client` and another origin runs the server output,
point framework browser calls at the server origin during the build:

```ts title="ev.config.ts"
export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

The platform must route:

- server-function requests;
- public API route paths;
- SSR, PPR, and RSC document requests;
- the active RSC or PPR support paths when those modes are used.

Static files and browser-route fallbacks stay on the CDN. Configure CORS,
cookies, and credentials for the cross-origin boundary explicitly.

## Runtime paths

Framework server paths derive from `server.basePath`, which defaults to
`/__evjs`:

```text
/__evjs/fn       server functions
/__evjs/ppr      PPR support, when used
/__evjs/rsc      RSC Flight, when used
```

Change the prefix only when a host or reverse proxy requires it. Public API
routes continue to use the paths created under `src/apis`.

## Deployment checklist

1. Run `ev inspect` and confirm every route and rendering choice.
2. Run `ev build` and keep its diagnostics.
3. Verify whether `dist/server` is required.
4. Install the adapter for the selected target.
5. Confirm public asset, SPA fallback, API, and request-time page routing.
6. Set `transport.baseUrl` only for a split origin.
7. Test a direct page load, a client navigation, an API route, and every active
   server rendering mode in the production environment.

Platform authors can build a custom deployment plugin with the public plugin
APIs. Start from [Plugin Development](./plugin-authoring) rather than reading
or rewriting application routes from generated filenames.
