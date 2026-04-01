# Server Routes

Server routes give you full control over HTTP methods, headers, and standard Web `Request`/`Response` objects — unlike server functions which use automatic RPC.

## Basic Usage

Define routes using `route(path, definition)` from `@evjs/server`:

:::important
**Route paths must be string literals.** Do not use template strings (with backticks) or dynamic variables for the `path` argument. This is required for static analysis and route discovery.
:::

```ts
// src/api/posts.routes.ts
import { route } from "@evjs/server";

export const postsRoute = route("/api/posts", {
  GET: async (req) => {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit")) || 10;
    return Response.json([{ id: 1, title: "Hello World" }]);
  },
  POST: async (req) => {
    const data = await req.json();
    return Response.json({ success: true, data }, { status: 201 });
  },
});
```

## Handler Signature

Each handler receives two arguments:

```ts
(request: Request, ctx: HonoContext) => Response | Promise<Response>
```

The Hono `Context` (`ctx`) provides:

| API | Description |
|-----|-------------|
| `ctx.req.param()` | All resolved route params as an object |
| `ctx.req.param("id")` | A single route param by name |
| `ctx.req.raw` | The underlying Web `Request` |
| `ctx.header()` | Set response headers |
| `ctx.json()` | Send a JSON response |

## Dynamic Routes

Use Hono's `:param` syntax for path parameters:

```ts
export const postDetailsRoute = route("/api/posts/:id", {
  GET: async (_req, ctx) => {
    const id = ctx.req.param("id");
    return Response.json({ id, title: "Post Details" });
  },
  DELETE: async (_req, ctx) => {
    const id = ctx.req.param("id");
    await db.deletePost(id);
    return new Response(null, { status: 204 });
  },
});
```

## Middleware

Use the `middleware` option to run logic before handlers. Call `next()` to proceed or return a `Response` to short-circuit:

```ts
import { route } from "@evjs/server";

const requireAuth = async (req, next) => {
  const auth = req.headers.get("Authorization");
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return next();
};

export const protectedRoute = route("/api/protected", {
  middleware: [requireAuth],
  GET: async () => Response.json({ secret: "data" }),
});
```

## Mounting Routes

Provide route handlers to `createApp()` in your server entry:

```ts
// src/server.ts
import { createApp } from "@evjs/server";
import { postsRoute, postDetailsRoute } from "./api/posts.routes";

export const app = createApp({
  routeHandlers: [postsRoute, postDetailsRoute],
});
```

Then configure the server entry in `ev.config.ts`:

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  server: {
    entry: "./src/server.ts",
    dev: { port: 3001 },
  },
});
```

## Built-in Behaviors

- **Auto OPTIONS** — returns `Allow` header listing all defined methods
- **Auto HEAD** — derived from `GET` if not explicitly defined
- **405 Method Not Allowed** — for unregistered HTTP methods

:::tip

If you combine `routeHandlers` with `"use server"` Server Functions, `createApp()` handles **both**. Route handlers are mounted first; the RPC fallback handles requests at `/api/fn`.

:::
