# @evjs/server

> Server-side runtime for the **evjs** fullstack framework.

## Features

- **Hono-based** — Build RESTful APIs alongside your React application.
- **Server Function Support** — Seamlessly handle `"use server"` function calls with type safety.
- **Standard Request/Response** — `route()` factory for simplified API endpoint creation.
- **Multi-Runtime** — First-class support for **Node.js** and ECMA runtimes (**Deno**, **Bun**, **Cloudflare Workers**).

## Install

```bash
npm install @evjs/server hono
```

## Quick Start

### 1. Server Routes

Create standard REST endpoints using the `route()` factory:

```ts
// src/api/users.ts
import { route } from "@evjs/server";

export const GET = route("/api/users", {
  GET: async (c) => Response.json([{ id: 1, name: "Alice" }]),
});
```

The `path` must be a **string literal** string for compatibility with the framework's build system.

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
import { createNodeServer } from "@evjs/server/node";
import { app } from "./app";

createNodeServer(app, { port: 3001 });
```

### ECMA (Deno/Bun/Edge)

```ts
import { createServer } from "@evjs/server/ecma";
import { app } from "./app";

Deno.serve({ port: 3001 }, createServer(app).fetch);
```

## Core APIs

### Routing
- `route(path, handler)`: Create a REST endpoint.
- `createApp(options)`: Main application factory.
- `handleServerFunctions(options)`: Middleware to handle `"use server"` calls.

### Middleware
- `setContext(key, value)`: Set request-scoped context (available to server functions).
- `getContext(key)`: Retrieve request-scoped context.

## License

MIT
