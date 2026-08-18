# API Routes and Middleware

Server routes give you full control over HTTP methods, headers, and standard
Web `Request`/`Response` objects. In evjs framework projects, server routes are
declared with file conventions.

For the complete server file route and middleware filename rules, see
[File Conventions](./file-conventions).

## File routes

File-based API routes are enabled by default. evjs scans
`./src/apis/**/api.*`; each file's containing directory maps to its request URL.
The root is fixed and there is no prefix configuration; put the file under a
directory such as `src/apis/api/users` when its URL should start with
`/api/users`.

```text
src/apis/api.ts                       -> /
src/apis/health/api.ts                -> /health
src/apis/users/api.ts                 -> /users
src/apis/users/$userId/api.ts         -> /users/:userId
src/apis/(internal)/health/api.ts     -> /health
src/apis/api/users/api.ts             -> /api/users
```

`api.{ts,tsx,js,jsx}` is the only filename that creates an API route, with
exactly one source-extension variant allowed per route directory. The file exports at
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

Imported handlers, re-exported handlers, and factory-created handlers are
supported as long as the final value is callable. Generator handlers are not
supported because they return iterators rather than one response.

Every other filename is ordinary route source, so `schema.ts`, `db.ts`,
`types.ts`, `index.ts`, and `route.ts` can be colocated safely. An `api.*`
file may export only uppercase HTTP methods; move helpers to another file.
evjs rejects missing methods, default or lowercase exports, unsupported runtime
exports, duplicate paths, ambiguous dynamic routes, and multiple `api.*`
variants in one directory.

evjs orders discovered routes by path segment. Parent paths come before their
descendants, and static segments come before dynamic segments. This keeps
registration stable and prevents a dynamic route from hiding a more specific
static route.

API route patterns cannot overlap page routes, redirects, or active framework
runtime endpoints. Run `ev inspect` to catch conflicts before a build.

## Handler signature

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

evjs has two server middleware scopes. They do not contain matcher
configuration.

The fixed `src/middlewares/middleware.*` file composes global middleware for
every server runtime request: server file routes, server functions, SSR, PPR,
and RSC framework handling. It default-exports either one Hono-compatible
middleware function or a non-empty explicitly ordered list. In TypeScript, use
`satisfies MiddlewareChain` to type the list while preserving its entries:

```ts
// src/middlewares/middleware.ts
import type { MiddlewareChain } from "@evjs/ev/server-context";
import authentication from "./authentication";
import tracing from "./tracing";

export default [tracing, authentication] satisfies MiddlewareChain;
```

JavaScript modules can default-export the same array without the TypeScript
annotation. evjs validates literal lists during convention discovery and all
resolved entries again when creating the server application.

Other files in `src/middlewares` are ordinary modules imported by
`middleware.*`. Filenames do not determine execution order, so that file keeps
the order visible while allowing any number of implementation modules.

A single global middleware remains valid:

```ts
// src/middlewares/middleware.ts
import type { MiddlewareHandler } from "@evjs/ev/server-context";

const tracing: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default tracing;
```

API route middleware lives inside the server file-route tree and runs only for
same-directory and descendant server file routes:

```text
src/apis/middleware.ts            -> every API route
src/apis/api/middleware.ts        -> /api and descendants
src/apis/api/admin/middleware.ts  -> /api/admin and descendants
src/apis/(admin)/middleware.ts    -> the group and its descendants
```

Execution order is the global list from left to right, then API route
middleware from parent directory to child directory, then the HTTP method
handler. Code after `await next()` unwinds in the reverse order. Route groups
do not add URL segments, but they do participate in filesystem scoping.
`src/apis/api/middleware.ts` covers the `/api` route at
`src/apis/api/api.ts`, plus routes such as `src/apis/api/users/api.ts` and all
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

## Built-in behavior

- **Auto OPTIONS**: returns `Allow` header listing all defined methods
- **Auto HEAD**: derived from `GET` if not explicitly defined
- **405 Method Not Allowed**: for unregistered HTTP methods
