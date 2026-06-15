# Server Routes

Server routes give you full control over HTTP methods, headers, and standard Web `Request`/`Response` objects — unlike server functions which use automatic RPC.

## Basic Usage

Define routes using `createRoute(path, definition)` from `@evjs/server`:

:::important
**Route paths must be string literals.** The `path` argument only accepts
string literal types. Passing a `string` variable or template string produces a
TypeScript compile error in typed projects, and evjs graph analysis reports the
same invalid exported route declaration before bundling. The route definition
must also be an object literal so HTTP methods can be extracted statically.
Paths must start with `/`, and each route must declare at least one HTTP method
handler such as `GET`, `POST`, or `DELETE`. Declare each server route URL shape
only once. Dynamic parameter names do not create distinct shapes, so
`/api/users/:id` and `/api/users/:userId` conflict. Put every HTTP method for
that shape in the same `createRoute()` call. Dynamic parameter names must be
non-empty and safe object keys. Do not use reserved names such as
`:__proto__`, `:constructor`, or `:prototype`, and do not repeat the same
parameter name within one route path.
Malformed reachable server route modules are reported during graph analysis
with the file path and parser message before the bundler runs.
Route paths are path patterns only: do not include whitespace, query strings,
or URL hashes. Read query strings from `new URL(request.url).searchParams`
inside the handler instead.
HTTP method keys must be uppercase supported methods (`GET`, `POST`, `PUT`,
`PATCH`, `DELETE`, `HEAD`, `OPTIONS`). The only non-method key in the definition
is `middlewares`; `middleware`, lowercase method names, and spread definitions
are reported as errors before bundling. Method values must be functions, and
`middlewares` must be an array of functions. Inline functions and referenced
functions are both supported when the referenced local has a static initializer;
uninitialized local variables are rejected before bundling.

```ts
// ✅ Good — string literal
createRoute("/api/users", { ... });

// ❌ Compile error — broad `string` type
const p: string = "/api/users";
createRoute(p, { ... });

// ❌ Build error — query strings belong in request.url, not route paths
createRoute("/api/users?limit=10", { GET: handler });

// ❌ Build error — dynamic params need safe, non-empty names
createRoute("/api/users/:__proto__", { GET: handler });
createRoute("/api/users/:", { GET: handler });

// ❌ Build error — method keys are uppercase and middleware is plural
createRoute("/api/users", { get: handler, middleware: [] });

// ❌ Build error — handlers and middleware entries are functions
createRoute("/api/users", { GET: "not a function", middlewares: [null] });

// ❌ Build error — referenced locals must be initialized statically
let handler;
createRoute("/api/users", { GET: handler });
```
:::

```ts
// src/api/posts.routes.ts
import { createRoute } from "@evjs/server";

export const postsRoute = createRoute("/api/posts", {
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

Route declarations may also use local export specifiers, including
string-literal export aliases. evjs does not follow re-exports from another
module for server route metadata:

```ts
const posts = createRoute("/api/posts", { GET: async () => Response.json([]) });
export { posts as "posts-route" };
```

Do not split one URL shape across multiple route exports:

```ts
// ❌ Fails graph analysis — duplicate path
export const postsGet = createRoute("/api/posts", { GET: async () => Response.json([]) });
export const postsPost = createRoute("/api/posts", { POST: async () => Response.json({ ok: true }) });

// ❌ Fails graph analysis — same dynamic route shape
export const userGet = createRoute("/api/users/:id", { GET: async () => Response.json({}) });
export const userPatch = createRoute("/api/users/:userId", { PATCH: async () => Response.json({ ok: true }) });
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

Use Hono's `:param` syntax for path parameters. Parameter names are available
through `ctx.req.param("id")`, but they are not part of route identity. Keep one
stable parameter name per URL shape and add all methods for that shape in the
same route definition. Empty names and reserved object-property names
(`__proto__`, `constructor`, `prototype`) are rejected because
`ctx.req.param()` returns params as an object. Duplicate names such as
`/api/users/:userId/posts/:userId` are rejected because only one value could be
represented for `userId`:

```ts
export const postDetailsRoute = createRoute("/api/posts/:id", {
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

Use the `middlewares` option to run logic before handlers. Call `next()` to
proceed or return a `Response` to short-circuit:

```ts
import { createRoute } from "@evjs/server";

const requireAuth = async (req, next) => {
  const auth = req.headers.get("Authorization");
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return next();
};

export const protectedRoute = createRoute("/api/protected", {
  middlewares: [requireAuth],
  GET: async () => Response.json({ secret: "data" }),
});
```

Use `createApp({ middlewares })` for global middleware that should run before
server routes, server functions, SSR, PPR, and RSC framework handling:

```ts
import { createApp, requestLogger } from "@evjs/server";

const app = createApp({
  middlewares: [requestLogger()],
  routes: [protectedRoute],
});
```

`createApp({ framework })` is the lower-level hook used by generated server
adapters to mount SSR, SSG fallback, PPR, and RSC handling. When you pass it
manually, `framework.manifest` must be the emitted `BuildOutput` shape:
`version: 1` plus object `runtime`, `apps`, `pages`, and array `routes`.
Malformed framework manifests fail during `createApp()` startup instead of
crashing later on the first page, PPR, or RSC request.
PPR runtime cache options also live under `framework.ppr`; use them from
generated or custom server adapters rather than application page config:

```ts
import type { PprRegionCache } from "@evjs/server";

const regionCache: PprRegionCache = platformRegionCache();

createApp({
  framework: {
    manifest,
    render,
    ppr: {
      regionCache,
      staleWhileRevalidate: 30,
    },
  },
});
```

## Mounting Routes

Provide route handlers to `createApp()` in your server entry:

```ts
// src/server.ts
import { createApp } from "@evjs/server";
import { postsRoute, postDetailsRoute } from "./api/posts.routes";

const app = createApp({
  routes: [postsRoute, postDetailsRoute],
});

export default { fetch: app.fetch };
```

Then configure the server entry in `ev.config.ts`:

```ts
import { defineConfig } from "@evjs/ev";

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

If you combine `routes` with `"use server"` server functions, `createApp()`
handles both. Route handlers are mounted first; the RPC dispatcher handles
requests at the runtime path derived from `server.basePath`, for example
`/__evjs/fn`.

:::
