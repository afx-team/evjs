# @evjs/server

> Server runtime core for the **evjs** framework and standalone Hono/fetch apps.

## Features

- **Hono-based** — Build RESTful APIs alongside your React application.
- **Server Function Support** — Seamlessly handle `"use server"` function calls with type safety.
- **Standard Request/Response** — `createRoute()` factory for simplified API endpoint creation.
- **Multi-Runtime** — First-class support for **Node.js** and standard Fetch runtimes (**Deno**, **Bun**, **Cloudflare Workers**).

## Install

```bash
npm install @evjs/server
```

## Quick Start

### 1. Server Routes

Create standard REST endpoints using the `createRoute()` factory:

```ts
// src/api/users.ts
import { createRoute } from "@evjs/server";

export const GET = createRoute("/api/users", {
  GET: async (c) => Response.json([{ id: 1, name: "Alice" }]),
});
```

The `path` must be a **string literal** string so framework build analysis can statically discover it.

### 2. Server Functions

Use the `"use server"` directive in `*.server.ts` files:

```ts
// src/api/posts.server.ts
"use server";

export async function getPosts() {
  // Query DB or third-party API
  return [{ id: 1, title: "Hello World" }];
}
```

## Runtime Adapters

### Node.js

```ts
import { serve } from "@evjs/server/node";
import { app } from "./app";

serve(app, { port: 3001 });
```

### Fetch (Deno/Bun/Edge)

```ts
import app from "@evjs/server/fetch";

Deno.serve({ port: 3001 }, app.fetch);
```

Worker-style hosts that discover named module exports can use the same handler:

```ts
export { fetch } from "@evjs/server/fetch";
```

## Core APIs

### Routing
- `createRoute(path, handler)`: Create a REST endpoint.
- `createApp(options)`: Main application factory.

Application-facing server runtime APIs are exported from `@evjs/server` and
its runtime subpaths. Use `@evjs/ev` when the app needs framework composition
such as file-route discovery, server-function transforms, SSR/PPR/RSC build
validation, manifests, or deployment artifacts.

## License

MIT
