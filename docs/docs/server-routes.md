# Server Routes

Server routes give you full control over HTTP methods, headers, and standard
Web `Request`/`Response` objects. In evjs framework projects, server routes are
declared with file conventions.

`@evjs/server` remains the standalone server runtime package. It is not a
second evjs routing mode, and evjs framework routing does not inspect
programmatic route declarations.

For the complete server file route and middleware filename rules, see
[File Conventions](./file-conventions).

## File Routes

File-based server routes are enabled by default. evjs scans
`./src/apis/**/api.*`; each anchor's containing directory maps to its request
URL. The root is fixed and there is no prefix configuration; put an anchor
under a directory such as `src/apis/api/users` when its URL should start with
`/api/users`.

```text
src/apis/api.ts                       -> /
src/apis/health/api.ts                -> /health
src/apis/users/api.ts                 -> /users
src/apis/users/$userId/api.ts         -> /users/:userId
src/apis/(internal)/health/api.ts     -> /health
src/apis/api/users/api.ts             -> /api/users
```

`api.{ts,tsx,js,jsx}` is the only request-route anchor, with exactly one
source-extension variant allowed per route directory. An anchor exports at
least one uppercase HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`,
`HEAD`, or `OPTIONS`:

```ts
// src/apis/api/posts/api.ts
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

Discovery rejects handler values that the anchor AST proves are non-callable,
without executing application code. Imported handlers, cross-module
re-exports, factory results, and mutable bindings remain valid composition
forms; the generated `createRoute()` definition validates their final values
when the server module loads. Generator handlers are rejected during discovery
because they return iterators rather than responses.

Every other basename is ordinary private source, so `schema.ts`, `db.ts`,
`types.ts`, `index.ts`, and `route.ts` can be colocated without publishing a
Route. An `api.*` anchor may export only uppercase HTTP methods; move helpers to
another file. Missing methods, `middleware`/`middlewares`, default exports,
lowercase method exports, unsupported runtime exports, duplicate paths,
duplicate dynamic shapes, multiple anchor extension variants, and anchors
under bracket, catch-all, optional, or otherwise invalid directory segments
are rejected before bundling.

Discovered routes use one shared segment-wise specificity order. Parent paths
come before descendants, and a static segment precedes a dynamic segment at
the first differing position. This keeps registration deterministic and
prevents a dynamic route from shadowing a more specific static branch.

Build planning also rejects a server request Route pattern that intersects a
URL-owning Page or redirect pattern, or an active framework runtime endpoint.
Static aliases use one-decode URL semantics: `/%75sers` aliases `/users`, but
double-encoded text remains distinct and encoded `/` does not merge segment
boundaries.

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
// src/apis/users/$userId/api.ts
export const GET = async (_req, ctx) => {
  const userId = ctx.req.param("userId");
  return Response.json({ id: userId });
};
```

## Middleware

evjs has two server middleware scopes. Middleware files default-export a
Hono-compatible middleware function and do not contain matcher configuration.

Global server middleware lives at `src/middleware.ts` and runs before every
server runtime request: server file routes, server functions, SSR,
PPR, and RSC framework handling:

```ts
// src/middleware.ts
import type { MiddlewareHandler } from "@evjs/ev/server-context";

const middleware: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default middleware;
```

API route middleware lives inside the server file-route tree and runs only for
same-directory and descendant server file routes:

```text
src/apis/middleware.ts            -> every anchored Route
src/apis/api/middleware.ts        -> /api and descendants
src/apis/api/admin/middleware.ts  -> /api/admin and descendants
src/apis/(admin)/middleware.ts    -> the group and its descendants
```

Execution order is global server middleware, then API route middleware from
parent directory to child directory, then the HTTP method handler. Route groups
do not add URL segments, but they do participate in filesystem scoping.
`src/apis/api/middleware.ts` covers the `/api` anchor at
`src/apis/api/api.ts`, plus anchors such as `src/apis/api/users/api.ts` and all
other descendants.

The signature follows Hono:

```ts
import type { MiddlewareHandler } from "@evjs/ev/server-context";

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
or `ctx.res`. API route middleware is mounted in the route handler chain, so it
can read route params with `ctx.req.param()`.

## Built-in Behaviors

- **Auto OPTIONS**: returns `Allow` header listing all defined methods
- **Auto HEAD**: derived from `GET` if not explicitly defined
- **405 Method Not Allowed**: for unregistered HTTP methods
