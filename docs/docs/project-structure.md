# Project Structure

This page is the source of truth for evjs application file conventions. It
also shows a practical way to organize code that the framework does not
discover automatically.

## Recommended structure

```text
my-evjs-app/
├── ev.config.ts                     # application-wide framework choices
├── index.html                       # shared HTML template
├── package.json
├── public/                          # copied static files
└── src/
    ├── pages/
    │   ├── page.tsx                 # /
    │   ├── page.config.ts           # metadata/rendering for /
    │   ├── layout.tsx               # root layout
    │   ├── about/
    │   │   └── page.tsx             # /about
    │   └── users/
    │       ├── page.tsx             # /users
    │       ├── components/          # code owned by /users
    │       └── $userId/
    │           ├── page.tsx         # /users/:userId
    │           └── get-user.server.ts
    ├── apis/
    │   ├── middleware.ts            # middleware for all API routes
    │   └── health/
    │       └── api.ts               # /health
    ├── middlewares/
    │   ├── middleware.ts            # ordered global middleware
    │   └── authentication.ts
    ├── components/                  # shared UI
    ├── features/                    # shared business features
    ├── hooks/
    └── lib/
```

The directories outside the recognized conventions are recommendations, not
framework requirements. Use the organization that matches your product.

## Where code belongs

A `page.*` or `api.*` file makes a directory public:

- `page.*` publishes a page and client route;
- `api.*` publishes a server request route.

Everything else is ordinary source unless another documented convention names
it. This means a page can safely own components, hooks, models, tests, styles,
assets, and server functions in the same directory.

```text
src/pages/orders/$orderId/
├── page.tsx                         # page and route
├── page.config.ts                  # static page choices
├── index.ts                        # ordinary private module
├── model.ts
├── get-order.server.ts
├── components/
│   └── Summary.tsx
└── __tests__/
    └── page.test.tsx
```

A descendant directory with its own `page.*` starts another page. An `_`
prefix is not required. Here “private” describes route discovery and
ownership, not access control.

## Convention matrix

Paths are relative to the project root unless stated otherwise.

| Path or declaration | Meaning | Important rules |
| --- | --- | --- |
| `ev.config.ts` | Application configuration | Import `defineConfig` from `@evjs/ev`. |
| `conventions: false` | Disables page, API route, and middleware discovery together | Only for applications that manage routing and runtimes themselves; cannot be combined with `routing`. |
| `routing.mode` | Enables file-based page discovery and chooses `"spa"` or `"mpa"` | The page root is always `src/pages`. |
| `src/pages/**/page.{ts,tsx,js,jsx}` | Page and client route | Exactly one variant per route directory. Default-export the React component. |
| `<page>/page.config.{ts,js}` | Optional static page configuration | Exactly one variant beside a `page.*` file. Prefer `definePageConfig()` and TypeScript. |
| `src/pages/**/$param/` | Dynamic route segment | Produces `:param`; SPA only. |
| `src/pages/**/$...splat/` | Catch-all route segment | Must be terminal; SPA only. |
| `src/pages/**/(group)/` | Pathless group | Organizes source without changing the URL. |
| `src/pages/**/layout.*` | Layout for descendant pages | Composes in SPA and MPA. |
| `src/pages/**/error.*`, `not-found.*` | Router error and not-found boundaries | SPA only. |
| Other files inside a page directory | Page-owned source | Do not create routes, including `index.*`. |
| `<page>/index.html` | HTML template for one MPA page | Does not create a page or client entry. |
| `index.html` or `routing.html` | Shared application HTML template | `index.html` is the default. |
| Imported module starting with `"use server";` | Server-function module | Named callable exports only; no required directory. |
| `src/apis/**/api.{ts,tsx,js,jsx}` | Public HTTP route | Exactly one variant per directory. Export uppercase HTTP method handlers. |
| Other files inside an API route directory | Route-owned source | Helpers and `index.*` do not create endpoints. |
| `src/middlewares/middleware.*` | Global middleware composition | Default-export one middleware or an explicitly ordered non-empty list. |
| Other files in `src/middlewares` | Middleware implementation modules | Imported explicitly; filenames do not define order. |
| `src/apis/**/middleware.*` | Middleware scoped to a route subtree | Default-export one middleware. It is not a route. |
| `public/**` | Static files | Copied to browser output according to output configuration. |
| `.ev/**`, `dist/**`, `src/route-types.d.ts`, `src/plugin-types.d.ts` | Generated output | Ignore and never edit or scaffold these files. |

### Page configuration

Keep static behavior beside its page:

```ts title="src/pages/orders/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Orders",
  meta: {
    description: "Review and manage customer orders.",
  },
  render: "csr",
  plugins: {
    analytics: {
      channel: "orders",
    },
  },
});
```

Core fields are `title`, `meta`, `render`, `hydrate`, `prerender`, `rsc`, and
static `document` options. The `plugins` map contains page values for installed
page-aware plugins. The default export must be static JSON data.

`meta` creates only `<meta name="..." content="...">` elements. It is not a
general head-element API. Rendering combinations are documented in
[Rendering](./rendering).

A page that owns static HTML can add validated `.html` or `.htm` output aliases
through `document.aliases`. Aliases publish the same document at another file
path; they do not create another page or route.

### Client path segments

Directory nesting is route nesting:

```text
src/pages/
├── page.tsx                         # /
├── teams/
│   ├── page.tsx                     # /teams
│   └── $teamId/
│       └── page.tsx                 # /teams/:teamId
├── files/
│   └── $...splat/
│       └── page.tsx                 # /files/*
└── (marketing)/
    └── about/
        └── page.tsx                 # /about
```

A directory without `page.*` may organize descendants. Static URL segments
must start with a letter or number. evjs rejects malformed segments, duplicate
paths, ambiguous dynamic shapes, and non-terminal splats.

### Server route paths

Server routes follow the same directory-owned idea under `src/apis`:

```text
src/apis/
├── health/
│   └── api.ts                       # /health
├── users/
│   ├── api.ts                       # /users
│   ├── schema.ts                    # route-owned helper
│   └── $userId/
│       └── api.ts                   # /users/:userId
└── (internal)/
    └── metrics/
        └── api.ts                   # /metrics
```

Server route paths support static, `$param`, and `(group)` segments. Catch-all,
optional, and bracket syntaxes are not supported. Page routes and API routes
share the request pathname space, so conflicting patterns fail validation.

### Middleware order

Make global order explicit in `src/middlewares/middleware.ts`:

```ts title="src/middlewares/middleware.ts"
import type { MiddlewareChain } from "@evjs/ev/server-context";
import authentication from "./authentication";
import tracing from "./tracing";

export default [tracing, authentication] satisfies MiddlewareChain;
```

Requests enter from left to right; work after `await next()` unwinds from right
to left. `src/apis/**/middleware.*` wraps API routes in the same directory and
its descendants.

## SPA and MPA structure

Both modes read the same page tree:

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "spa" }, // or "mpa"
});
```

- SPA supports dynamic segments, catch-alls, layouts, boundaries, and
  client-side navigation.
- MPA uses static page paths only and creates an independent HTML document for
  each page. Layouts still compose around pages.

See [Pages and Routing](./client-routes) for authoring and
[Rendering](./rendering) for delivery choices.

## Shared versus colocated code

Decide where code belongs by where it is used, not by file type:

| Code | Suggested location |
| --- | --- |
| Used by one page or route | Inside that page or API route directory |
| Shared by several pages in one feature | `src/features/<feature>` |
| Shared visual primitive | `src/components` |
| Cross-cutting utility or infrastructure | `src/lib` |
| Static public file | `public` |

This convention keeps page directories understandable without turning
`src/pages` into a collection of thin entry files.

## Use an explicit route tree

Most applications should use `routing.mode` and the file conventions above.
Projects that need to maintain a programmatic SPA route tree can use
`application.routes`. It cannot be combined with `routing` and does not support
MPA.

Read [Custom Routing and Runtimes](./advanced-conventions) before choosing
that model.
