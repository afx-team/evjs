# Server Routes

Server routes give you full control over HTTP methods, headers, and standard
Web `Request`/`Response` objects. In evjs framework projects, server routes are
declared with file conventions.

`@evjs/server` remains the standalone server runtime package. It is not a
second evjs routing mode, and evjs framework routing does not inspect
programmatic route declarations.

For the complete server file route and middleware filename rules, see
[File Conventions](./file-conventions.md).

## File Routes

Enable file-based server routes with `server.routing`:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  server: {
    routing: true,
  },
});
```

`server.routing: true` scans `./src/apis` and maps that directory to `/`.
Object form currently supports only `dir`. There is no `prefix` option; put
files under a folder such as `src/apis/api` when the URL should start with
`/api`.

```text
src/apis/index.ts              -> /
src/apis/health.ts             -> /health
src/apis/users.ts              -> /users
src/apis/users/index.ts        -> /users
src/apis/users/$userId.ts      -> /users/:userId
src/apis/(internal)/health.ts  -> /health
src/apis/api/users.ts          -> /api/users
```

A file becomes a route only when it exports at least one uppercase HTTP method:
`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, or `OPTIONS`:

```ts
// src/apis/api/posts.ts
export const GET = async (req) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || 10;
  return Response.json([{ id: 1, title: "Hello World", limit }]);
};

export const POST = async (req) => {
  const data = await req.json();
  return Response.json({ success: true, data }, { status: 201 });
};
```

Files with no route exports are ignored, so `schema.ts`, `db.ts`, and
`types.ts` can be colocated. Route candidates may export only uppercase HTTP
methods; move helpers to non-route files. `middleware`, `middlewares`, default
exports, duplicate paths, duplicate dynamic shapes, bracket routes, catch-all
routes, optional params, lowercase method exports, unsupported runtime exports
in route candidates, and method suffix files such as `posts.get.ts` are
rejected before bundling.

## Handler Signature

Each HTTP method handler receives the Web `Request` and a Hono-compatible
context:

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

```ts
// src/apis/users/$userId.ts
export const GET = async (_req, ctx) => {
  const userId = ctx.req.param("userId");
  return Response.json({ id: userId });
};
```

## File Route Middleware

File-route middleware is a filesystem-scoped convention. Middleware files
default-export a Hono-compatible middleware function and do not contain matcher
configuration:

```ts
// src/middleware.ts
import type { MiddlewareHandler } from "@evjs/server";

const middleware: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default middleware;
```

Global middleware lives at `src/middleware.ts` and runs before server file
routes, server functions, SSR, PPR, and RSC framework handling. Route-scoped
middleware lives inside the route tree and runs only for descendant server file
routes:

```text
src/apis/middleware.ts            -> all file routes
src/apis/api/middleware.ts        -> routes under api/**
src/apis/api/admin/middleware.ts  -> routes under api/admin/**
src/apis/(admin)/middleware.ts    -> routes under (admin)/**
```

Execution order is global middleware, then route-scoped middleware from parent
directory to child directory, then the HTTP method handler. Route groups do not
add URL segments, but they do participate in filesystem scoping.
`src/apis/api/middleware.ts` covers `src/apis/api/index.ts`,
`src/apis/api/users.ts`, and nested files under `src/apis/api/**`; it does not
cover the flat sibling `src/apis/api.ts`.

The signature follows Hono:

```ts
import type { MiddlewareHandler } from "@evjs/server";

const requireAuth: MiddlewareHandler = async (ctx, next) => {
  if (!ctx.req.header("authorization")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await next();
  ctx.header("x-authenticated", "true");
};

export default requireAuth;
```

`ctx` is Hono's `Context`. `next` continues the remaining middleware/handler
chain. Returning a `Response` short-circuits the request. After `await next()`,
middleware can modify the downstream response with APIs such as `ctx.header()`
or `ctx.res`. Route-scoped middleware is mounted in the route handler chain, so
it can read route params with `ctx.req.param()`.

## Built-in Behaviors

- **Auto OPTIONS**: returns `Allow` header listing all defined methods
- **Auto HEAD**: derived from `GET` if not explicitly defined
- **405 Method Not Allowed**: for unregistered HTTP methods
