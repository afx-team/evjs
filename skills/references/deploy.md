# Deployment Guide

Building and deploying an evjs application requires two parts: serving the static client assets and running the API server function handler.

## Overview

A production build creates two output directories under `dist/`:
- `dist/client/`: The static React single-page application and assets.
- `dist/server/`: The backend server functions, bundled into a single file (default: `main.js`).
- `dist/manifest.json`: Metadata linking the client and server builds.

To build the project:
```bash
npm run build
# Under the hood, this runs: `npx ev build`
```

## Option 1: Node.js (Default)

The default backend adapter is `node`. To run the application in production:

1. **Build** the app: `npm run build`
2. **Create a server startup script** (e.g., `server.mjs` or `server.cjs`) to tie the client and server together.

```javascript
// server.mjs
import fs from "node:fs";
import path from "node:path";
import { serve } from "@evjs/server/node";
import { serveStatic } from "@hono/node-server/serve-static";

// 1. Import the built server functions bundle
import * as serverBundle from "./dist/server/main.js";

// 2. Initialize the backend Hono app
const app = serverBundle.createApp();

// 3. Serve the static client bundle
app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("*", serveStatic({ path: "./dist/client/index.html" }));

// 4. Start the Node HTTP server
serve(app, { port: process.env.PORT || 3000 });
```

3. **Run** the server: `node server.mjs`

## Option 2: Docker

You can use a multi-stage `Dockerfile` to deploy your Node app anywhere:

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
# Install production dependencies only (often including @evjs/client, @evjs/server, and hono)
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
# Assume you created the server.mjs file as shown in Option 1
COPY server.mjs .

EXPOSE 3000
CMD ["node", "server.mjs"]
```

## Option 3: Deno / Bun / Edge

evjs server endpoints are built on [Hono](https://hono.dev), meaning they run natively on Deno, Bun, and other Edge runtimes.

### Deno example
Use the `basic-fns-ecma` template as a reference.

Make sure your `ev.config.ts` backend is configured for standard ECMA:
```ts
// ev.config.ts
export default defineConfig({
  server: {
    backend: "deno run -A", // During dev
  }
});
```
Then create a `server.ts` entry point:
```ts
// server.ts
import { serveStatic } from "hono/deno";
import * as serverBundle from "./dist/server/main.js";

const app = serverBundle.createApp();

// Serve static files
app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("*", serveStatic({ path: "./dist/client/index.html" }));

// Serve API
Deno.serve({ port: 3000 }, app.fetch);
```
Run with `deno run --allow-net --allow-read server.ts`.

## Environment Variables

Server secrets (e.g., `DATABASE_URL`) are safe — they only evaluate at runtime on the server. Ensure they are injected into your Node/Docker environment before starting the app.
