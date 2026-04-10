# Deployment

Building and deploying an evjs application requires two parts: serving the static client assets and running the API server for server functions.

## Build for Production

```bash
npm run build
# Under the hood: npx ev build
```

This creates:
- `dist/client/` — Static React SPA and assets
- `dist/server/` — Backend server functions bundle
- `dist/client/manifest.json` — Client asset map and route metadata
- `dist/server/manifest.json` — Server function registry

## CDN Deployment (`assetPrefix`)

If you host your static assets on a CDN rather than the application server, configure `ev.config.ts`:

```ts
export default defineConfig({
  assetPrefix: "https://cdn.example.com/assets/"
});
```

During `ev build`, this prefix will be:
1. Used as Webpack's runtime `publicPath` via `window.assetPrefix` — all dynamically loaded JS/CSS chunks, images, and fonts resolve against this prefix at runtime.
2. Written into `<script>` and `<link>` tags in `dist/index.html`.
3. Exposed as a global `window.assetPrefix` runtime variable on the client, which can be safely mutated by your deployment tools before serving `index.html`.

## Option 1: Node.js (Default)

The default and simplest deployment option:

```javascript
// server.mjs
import { serve } from "@evjs/server/node";
import { serveStatic } from "@hono/node-server/serve-static";
import * as serverBundle from "./dist/server/main.js";

// 1. Initialize the Hono app with server functions
const app = serverBundle.createApp();

// 2. Serve the static client bundle
app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("*", serveStatic({ path: "./dist/client/index.html" }));

// 3. Start the server
serve(app, { port: process.env.PORT || 3000 });
```

Run with: `node server.mjs`

## Option 2: Docker

Multi-stage Dockerfile for production deployment:

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY server.mjs .

EXPOSE 3000
CMD ["node", "server.mjs"]
```

## Option 3: Deno

Use the ECMA adapter for Deno deployment:

```ts
// ev.config.ts
export default defineConfig({
  server: {
    runtime: "deno run -A",  // During dev
  },
});
```

```ts
// server.ts
import { serveStatic } from "hono/deno";
import * as serverBundle from "./dist/server/main.js";

const app = serverBundle.createApp();

app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("*", serveStatic({ path: "./dist/client/index.html" }));

Deno.serve({ port: 3000 }, app.fetch);
```

Run with: `deno run --allow-net --allow-read server.ts`

## Option 4: Bun

Similar to Deno, using Bun's native serve:

```ts
// server.ts
import * as serverBundle from "./dist/server/main.js";

const app = serverBundle.createApp();

export default {
  port: 3000,
  fetch: app.fetch,
};
```

Run with: `bun server.ts`

## Environment Variables

Server secrets (e.g., `DATABASE_URL`, `API_KEY`) are safe — they only evaluate at runtime on the server. Ensure they are injected into your Node/Docker/Edge environment before starting the app.

:::tip

All server function code runs exclusively on the server. Client bundles only contain RPC stubs — your secrets and business logic are never exposed to the browser.

:::
