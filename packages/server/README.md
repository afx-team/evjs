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
// src/routes/users.ts
import { createRoute } from "@evjs/server";

export const usersRoute = createRoute("/api/users", {
  GET: async (_request) => Response.json([{ id: 1, name: "Alice" }]),
});
```

The `path` must be a **string literal** so the route definition keeps precise
compile-time types. Register the route explicitly in the standalone app:

```ts
// src/app.ts
import { createApp } from "@evjs/server";
import { usersRoute } from "./routes/users.js";

export const app = createApp({ routes: [usersRoute] });
```

This programmatic API is independent from evjs Framework file routes anchored
at `src/apis/**/api.*`; the framework does not scan `createRoute()`
declarations.

### 2. Server Functions

Framework projects use the `"use server"` directive in reachable modules. The
generated server entry creates an application-owned function registry and
registers every discovered export. `.server.ts` is the recommended naming
convention, not a discovery rule:

```ts
// src/posts.server.ts
"use server";

export async function getPosts() {
  // Query DB or third-party API
  return [{ id: 1, title: "Hello World" }];
}
```

Standalone apps register their function implementations explicitly. The same
registry can dispatch calls for a custom WebSocket or IPC transport:

```ts
import { createApp, createServerFunctionRegistry } from "@evjs/server";
import { getPosts } from "./posts.server.js";

const serverFunctions = createServerFunctionRegistry();
serverFunctions.register("posts:getPosts", getPosts);

export const app = createApp({ serverFunctions });
```

Registries are isolated per app, so two apps in one process may safely use the
same function id for different implementations.

## Runtime Adapters

### Node.js

```ts
import { serve } from "@evjs/server/node";
import { app } from "./app";

serve(app, { port: 3001 });
```

### Fetch (Deno/Bun/Edge)

`@evjs/server/fetch` provides the zero-configuration empty app. When a
standalone app owns routes or server functions, export that app's handler:

```ts
import { app } from "./app.js";

Deno.serve({ port: 3001 }, app.fetch);
```

Worker-style hosts that discover named module exports can use the same handler:

```ts
import { app } from "./app.js";

export const fetch = app.fetch;
export default { fetch };
```

## Core APIs

### Routing
- `createRoute(path, handler)`: Create a REST endpoint.
- `createApp(options)`: Main application factory.
- `createServerFunctionRegistry()`: Create an isolated function registry for
  one application or custom transport.

Application-facing server runtime APIs are exported from `@evjs/server` and
its runtime subpaths. Use `@evjs/ev` when the app needs framework composition
such as file-route discovery, server-function transforms, SSR/PPR/RSC build
validation, manifests, or deployment artifacts.

## License

MIT
