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

Import HTTP authoring APIs from `@evjs/ev/api`: `withMiddlewares`,
`MiddlewareHandler`, `MiddlewareChain`, `RouteHandlerFn`, and `requestLogger`
(with `RequestLoggerOptions` and `RequestLogEntry`). Request, cookie, and
server-function error helpers belong to `@evjs/ev/server-context`.

Choose where a policy applies:

| Declaration | Scope |
| --- | --- |
| `src/middlewares/middleware.*` | Every server runtime request, including API routes, server functions, SSR, PPR, and RSC |
| `src/apis/**/middleware.*` | API routes in the same directory and its descendants |
| `withMiddlewares(handler, middlewares)` in an `api.*` method export | Only that HTTP method |

Both middleware anchors default-export one Hono-compatible function or a
non-empty, ordered array. Each directory allows exactly one
`middleware.{ts,tsx,js,jsx}` variant. Runtime named exports are rejected;
type-only exports are allowed. Other filenames are ordinary source modules.

```ts title="src/apis/api/admin/middleware.ts"
import type { MiddlewareChain } from "@evjs/ev/api";
import { audit, requireAdmin, requireSession } from "./policies";

export default [requireSession, requireAdmin, audit] satisfies MiddlewareChain;
```

The same array convention applies to global middleware:

```ts title="src/middlewares/middleware.ts"
import { type MiddlewareChain, requestLogger } from "@evjs/ev/api";
import tracing from "./tracing";

export default [requestLogger(), tracing] satisfies MiddlewareChain;
```

JavaScript uses the same arrays without the type annotation. Use array spread
to reuse a chain: `[...shared, audit]`. Nested arrays, holes, and non-functions
are invalid. Explicit array exports and method chains must be non-empty.
Computed global chains may resolve to `[]` when disabled. Repeated functions
run each time they are listed.

Imported middleware and factory results follow the same rules. Invalid exports
prevent server startup; diagnostics identify the source module and, for an
invalid array entry, its zero-based index. Changing an exported array after
registration does not change the registered chain.

### Directory inheritance

```text
src/apis/middleware.ts            -> every API route
src/apis/api/middleware.ts        -> /api and descendants
src/apis/api/admin/middleware.ts  -> /api/admin and descendants
src/apis/(admin)/middleware.ts    -> the group and its descendants
```

Inheritance follows the source directory tree. An anchor also applies to its
own directory's `api.*`, and the directory need not have an API anchor to scope
its descendants. `(group)` directories participate in inheritance without
adding URL segments. Parent policies always run before child policies;
children cannot remove an ancestor's middleware.

For separate public and protected APIs, put their anchors in sibling
`(public)` and `(protected)` groups and place authentication under
`(protected)`. Middleware at `src/apis/middleware.*` applies to both groups.
These scopes affect API routes only, including when a server-function module
is colocated in the same directory.

### Method composition

Use `withMiddlewares` on an exported HTTP method handler to apply policies to
that method:

```ts title="src/apis/api/posts/api.ts"
import { withMiddlewares } from "@evjs/ev/api";
import { createPost, listPosts } from "./handlers";
import { requireUser, validatePost } from "./policies";

export const GET = listPosts;
export const POST = withMiddlewares(createPost, [requireUser, validatePost]);
```

`withMiddlewares(handler, middlewares)` returns a callable HTTP method handler.
The `handler` argument uses the
`(request, ctx) => Response | Promise<Response>` signature. The `middlewares`
argument accepts one middleware or a non-empty ordered array.

To share policy across several methods of one endpoint, reuse the same chain
in those method exports. Method chains never inherit into child routes.
Nested `withMiddlewares` calls run the outer chain first.

Use `MiddlewareHandler<Env, Path, Input>` for individual middleware,
`MiddlewareChain<Env, Path, Input>` for ordered chains, and
`RouteHandlerFn<Path, Env, Input>` for HTTP method handlers. These types describe
the Hono environment, route parameters, and validated input.
`withMiddlewares` infers the handler's context from typed middleware. Assign
generic factory results, such as Hono's `validator()`, to variables before
composing the handler:

```ts
import { withMiddlewares } from "@evjs/ev/api";
import { validator } from "hono/validator";

const validateBody = validator("json", (value) => ({
  title: String(value.title),
}));

export const POST = withMiddlewares(
  (_request, ctx) => ctx.json(ctx.req.valid("json")),
  validateBody,
);
```

Declare shared context variables with an application Hono `ContextVariableMap`
or an explicit environment type. When middleware reads a request body, use
`ctx.req.json()` and the same Hono body cache in the handler, or pass validated
data through `ctx.req.valid()` or context variables. The raw `Request` body
stream can only be consumed once.

### Execution order

Requests enter in this order:

```text
plugin middleware -> application global middleware -> API root
-> ancestor directories -> current directory -> method chain -> handler
```

Plugin contributions run in slot order. Arrays run left to right, and code
after `await next()` unwinds in reverse. All layers use the same Hono context.
Returning a `Response` without calling `next()` short-circuits the request.

```ts
import type { MiddlewareHandler } from "@evjs/ev/api";

const requireAuth: MiddlewareHandler = async (ctx, next) => {
  if (!ctx.req.header("authorization")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await next();
  ctx.header("x-authenticated", "true");
};

export default requireAuth;
```

API directory and method middleware can read resolved params through
`ctx.req.param()`. After `await next()`, use `ctx.header()` or `ctx.res` to
modify the response. Method middleware uses Hono's error handling:
exceptions become error responses, with the error available through `ctx.error`
as middleware unwinds.

## HTTP method behavior

For a matching API path, global middleware wraps every response. Directory
middleware wraps supported methods, including automatic HEAD and OPTIONS:

| Request | Method chain and response |
| --- | --- |
| Declared method | Its own chain, then its handler |
| Explicit `HEAD` | The `HEAD` chain and handler; the final body is removed |
| `HEAD` with only `GET` declared | The `GET` chain and handler; the final body is removed |
| Automatic `OPTIONS` | No method chain; returns 204 with `Allow` |
| Unsupported method | Only global middleware; returns 405 with `Allow`, without directory or method middleware |
| No matching API path | No API directory or method middleware; normal framework routing continues |

An explicit `OPTIONS` export runs its own method chain. `Allow` includes the
supported explicit and automatic methods. A more specific API path owns its
405 response; it cannot fall through to another API's method handler.

Directory middleware can short-circuit automatic `OPTIONS`. Put policy that
must also apply to 405 responses in global middleware. Place CORS
before authentication when it should answer preflight requests; the framework
does not silently bypass authentication for `OPTIONS`. Method middleware can
also short-circuit derived `HEAD`, whose final response is always bodyless.
