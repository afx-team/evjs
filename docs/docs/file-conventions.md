# File Conventions

evjs keeps file conventions small and explicit. A positive `page.*` anchor
defines a client Page and its file route; a positive `api.*` anchor defines a
server request Route. In both trees, the anchor's containing directory owns
the scope and determines the URL.

For the complete matrix, see [Project Structure](./project-structure).

## Convention Roots

| Root | Purpose |
| --- | --- |
| `src/pages` | Canonical Page-and-Route tree. |
| `src/apis` | Fixed server request `api.*` anchor tree. |
| `src/middleware.ts` | Global framework server middleware. |
| `src/apis/**/middleware.ts` | Middleware scoped to same-directory and descendant server file routes. |
| Reachable source modules | Server functions that begin with `"use server";`. |

Page anchors, server request-route anchors, and both middleware roots form one
framework-owned discovery unit. Top-level `conventions: false` disables that
unit together; there are no per-root switches. It cannot be combined with
an explicit client `routing` declaration. When conventions remain enabled,
the client Page root is fixed at `src/pages` and the server Route root is fixed
at `src/apis`.

Reachable `"use server";` modules, SPA-only `application.routes`
configuration, and plugin contributions are graph/config inputs rather than
file conventions.

The relative directory of each `page.*` anchor is the client URL source of
truth. `routing.mode` chooses SPA or MPA materialization for that same tree.

## Global Styles

Global styles are ordinary source modules, with no special filename or
directory convention. Import them explicitly from the root or Application
layout, a Page, or a shared component:

```ts
import "./global.css";
```

Less variables and mixins follow the same rule. Import their module explicitly
from each Less module that consumes them:

```less
@import "./tokens.less";
```

## Canonical Pages and Routes

A Page and client Route share one positive anchor:

```text
src/pages/**/page.{ts,tsx,js,jsx}
```

```ts
export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

```text
src/pages/
├── page.tsx                       # /
├── page.config.ts                # optional build-time config for /
├── home/
│   ├── page.tsx                   # /home
│   └── components/
│       ├── Hero.tsx
│       └── index.tsx          # private source, not another Page
└── users/
    └── $userId/
        ├── page.tsx               # /users/:userId
        ├── index.ts
        ├── model.ts
        └── components/Profile.tsx
```

Rules:

- exactly one supported `page.*` variant is allowed in a route directory;
- directory segments relative to `src/pages` determine the URL;
- the complete containing directory is the Page-private scope;
- every other file, including `index.*`, is ordinary Page source;
- a descendant `page.*` intentionally creates a nested Page and Route;
- the same normalized URL shape cannot have two Page anchors;
- Page entries default-export their component.

Page-private code needs no `_` prefix. Private means ownership/discovery scope,
not a security boundary.

Discovery is positive-anchor driven. `src/pages/home/components/index.tsx`
remains private because it is not named `page.*`; a
`src/pages/home/components/page.tsx` would intentionally create
`/home/components`.

An underscore does not create a private route segment. `_components/Card.tsx`
is ordinary source because it has no Page anchor, while
`_private/page.tsx` produces an invalid-static-segment diagnostic instead of
being silently ignored. Static URL segments must start with a letter or number.

### Page configuration

Canonical discovery recognizes one optional `page.config.ts` or
`page.config.js` beside an anchored Page. Prefer the TypeScript form:

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Home",
  meta: {
    description: "The application home page.",
    keywords: "home,evjs",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
  extensions: {
    "@company/feature": {
      enabled: true,
    },
  },
});
```

The module is evaluated synchronously at build time. It default-exports a plain
object containing static JSON data. Core owns `title`, named `meta`, `render`,
`hydrate`, `prerender`, and `rsc`; plugins register and own namespaced values
under `extensions`. Omitted `render` always means CSR, which must omit
`hydrate`; explicit SSR/SSG Pages may select `"load"` or `"none"`. `meta` maps
string keys and values only to
`<meta name="key" content="value">`. It does not provide `property`, `charset`,
links, scripts, dynamic metadata, or a general head DSL. Core title/meta are
materialized for the Page; plugin extension values require explicit plugin
projection before runtime use.

### Page HTML

The application uses top-level `index.html` by default; `routing.html` can
select another shared template. In MPA mode, a colocated Page `index.html`
overrides that Page's Document template. It never becomes a client Page entry
and SPA mode does not treat it as a route anchor. Page `title` and `meta`
materialize missing tags and override matching template title and `meta[name]`
values; omitted values keep the template baseline.

## Canonical Client Paths

Client paths come from route directories:

| Directory segment | Meaning |
| --- | --- |
| `users` | Static segment. |
| `$userId` | Dynamic `:userId` segment. |
| `$...splat` | Terminal catch-all. |
| `(account)` | Pathless organization group. |

```text
src/pages/
├── page.tsx                         # /
├── users/
│   ├── page.tsx                     # /users
│   └── $userId/
│       └── page.tsx                 # /users/:userId
├── files/
│   └── $...splat/
│       └── page.tsx                 # /files/*
└── (account)/
    └── settings/
        └── page.tsx                 # /settings
```

SPA materializes Client Routes. MPA starts from the same semantic Pages and
Routes and materializes Page-owned Documents for static Page paths. `$param`,
terminal `$...splat`, and router-only boundary facets fail explicitly in MPA;
layouts compose in both modes.

## Server Functions

Server functions have no convention root. The build follows reachable imports
from Pages, layouts, wrappers, and server code.

A server-function module:

- starts with `"use server";`;
- exports named function declarations or named `const` function expressions;
- does not default-export;
- does not runtime re-export functions from another module.

```ts
"use server";

export async function getUser(userId: string) {
  return { id: userId };
}
```

Use `.server.ts` or `.server.tsx` when colocating a server function inside a
Page directory so its ownership is obvious to humans and tooling.

## Server File Routes

Server request Routes are discovered from positive `api.*` anchors under the
fixed `src/apis` root. This filesystem convention is separate from the client
`page.*` tree but follows the same directory-owned model.

```text
src/apis/
├── api.ts                      # /
├── api/
│   ├── health/
│   │   └── api.ts             # /api/health
│   └── users/
│       ├── api.ts             # /api/users
│       ├── schema.ts          # private source
│       └── $userId/
│           └── api.ts         # /api/users/:userId
└── (internal)/
    └── metrics/
        └── api.ts             # /metrics
```

### Server path segments

| Directory segment | URL meaning |
| --- | --- |
| `$userId` | Dynamic parameter. |
| `(internal)` | Pathless organization group. |
| ordinary safe name | Static URL segment. |

The `api.*` basename contributes no URL segment. Catch-all, optional, and
bracket directory dialects are not supported. Static directory segments must
start with a lowercase letter or number. Invalid segments are diagnosed only
when their tree contains an `api.*` anchor or route middleware.

### Route exports

Only `src/apis/**/api.{ts,tsx,js,jsx}` is a route candidate, and
each route directory may contain exactly one source-extension variant. The
anchor exports at least one uppercase HTTP method:

```ts
export function GET() {
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const body = await request.json();
  return Response.json(body, { status: 201 });
}
```

Supported methods are the framework's documented uppercase HTTP handlers.
Handlers may be declared locally, imported from route-private modules,
re-exported, or created by a factory. Discovery rejects values that are already
statically known to be non-callable; the generated `createRoute()` definition
validates every evaluated handler before the server starts. Generators, default
exports, lowercase method names, helper exports, and route-module middleware
exports are invalid in an `api.*` anchor. Every other basename is ordinary
route-private source and does not publish a Route, regardless of its exports.

### Server route conflicts

The build rejects:

- two anchors for the same normalized URL;
- multiple `api.*` source-extension variants in one route directory;
- two parameter names for the same dynamic shape, such as `$id` and `$userId`;
- unsafe or malformed group/dynamic segments;
- generated route-id collisions;
- route modules that mix unsupported exports into the route contract;
- a server request Route pattern that intersects a URL-owning Page or redirect
  pattern, or an active framework runtime endpoint.

Static route aliases are compared after exactly one URL decode during conflict
checks. For example, `/%75sers` and `/users` claim the same request path, while
double-encoded text remains distinct.

`index.ts`, `route.ts`, and `foo.get.ts` are not alternate route anchors.

## Server Middleware

Two middleware conventions exist:

```text
src/
├── middleware.ts
└── apis/
    ├── middleware.ts
    └── admin/
        ├── middleware.ts
        ├── api.ts
        └── users/
            └── api.ts
```

- `src/middleware.ts` wraps framework-owned server requests globally.
- `src/apis/**/middleware.ts` wraps same-directory and descendant server file
  routes by filesystem scope.

Middleware files are not routes and cannot be replaced by exporting middleware
from a route module.

## Generated Files

The framework may generate:

- `.ev/**` framework IR and entry facades;
- `src/route-types.d.ts` from canonical SPA file routes when supported;
- `src/evjs-env.d.ts` and `src/.ev/types/**` when a plugin contributes exact
  generated-alias declarations;
- `dist/**` build output.

Do not edit or scaffold these files. Keep them ignored.

## Route Input Boundaries

Canonical Page discovery does not ask users to select a route reader or
provider. A canonical application declares `routing.mode`; the presence of
`src/pages` alone has no client-routing effect.

### Explicit SPA route configuration

`application` cannot be combined with `routing`. The explicit route-tree
normalizer accepts `application.routes` plus `page` or
`component`, nested `routes`, `layout`, `wrappers`, and `redirect`.
`application.pageRoot` controls only reference resolution for this explicit
input and does not change the fixed `src/pages` convention root. It rejects
`children`; nested declarations use `routes`. `exact: true` is accepted only
as a terminal-match assertion; `exact: false` and nested routes below an exact
Route are rejected. Route capability data uses registered, namespaced
`extensions`. Shared template, mount, and Document extension values live under
`application.document`. This profile can materialize only SPA. A `page`
reference resolves to one
canonical `page.*` anchor. An explicit `component` ending in `index.*` or
`page.*` owns its containing directory; other component basenames are
module-scoped and do not consume adjacent `page.config.ts`.

### Canonical Page tree

`routing.mode` discovers only `page.*` anchors. Each Page entry lives in the
directory for its URL; Page settings live in adjacent `page.config.ts` files.
Page-private helpers may use any other basename, including `index.*`, without
creating another route. Parameters, terminal catch-alls, and pathless groups
use `$param`, `$...splat`, and `(group)` directories. Run `ev inspect` to
review normalized Pages, Routes, Documents, Page config, and diagnostics.
