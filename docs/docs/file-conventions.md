# File Conventions

evjs keeps file conventions small and explicit. One positive `page.*` marker
defines both a client Page and its file route. Server request routes remain a
separate file-route convention.

For the complete matrix, see [Project Structure](./project-structure).

## Convention Roots

| Root | Purpose |
| --- | --- |
| `src/pages` or `routing.dir` | Canonical Page-and-Route tree. |
| `src/apis` or `server.routing.dir` | Server request route modules. |
| `src/middleware.ts` | Global framework server middleware. |
| `src/apis/**/middleware.ts` | Middleware scoped to descendant server file routes. |
| Reachable source modules | Server functions that begin with `"use server";`. |

Page anchors, server file routes, and both middleware roots form one
framework-owned discovery unit. Top-level `conventions: false` disables that
unit together; there are no per-root switches. It cannot be combined with
explicit `routing` or `server.routing`. When conventions remain enabled,
`routing.dir` and `server.routing: { dir }` only customize their discovery
roots.

Reachable `"use server";` modules, the SPA-only `application.routes`
migration input, and plugin contributions are graph/config inputs rather than
file conventions. Removed `app`, `pages`, and top-level `routes` declarations
are rejected.

The relative directory of each `page.*` anchor is the client URL source of
truth. `routing.mode` chooses SPA or MPA materialization for that same tree.

## Canonical Pages and Routes

A Page and client Route share one positive anchor:

```text
<routing.dir>/**/page.{ts,tsx,js,jsx}
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
- directory segments relative to `routing.dir` determine the URL;
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
under `extensions`. `meta` maps string keys and values only to
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
Routes and materializes Page-owned Documents. Dynamic-route and SPA-only facet
coverage in the MPA materializer is still staged; unsupported combinations
fail explicitly.

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

Server request routes are discovered under `src/apis` by default. This
filesystem convention is intentionally separate from the client `page.*` tree.

```text
src/apis/
├── index.ts                    # /
├── api/
│   ├── health.ts              # /api/health
│   └── users/
│       ├── index.ts           # /api/users
│       └── $userId.ts         # /api/users/:userId
└── (internal)/
    └── metrics.ts             # /metrics
```

### Server path segments

| File segment | URL meaning |
| --- | --- |
| `index` | Directory root. |
| `$userId` | Dynamic parameter. |
| `(internal)` | Pathless organization group. |
| ordinary safe name | Static URL segment. |

Catch-all, optional, bracket, and method-suffix dialects are not supported.

### Route exports

A route candidate becomes a request route only when it exports at least one
uppercase HTTP method:

```ts
export function GET() {
  return Response.json({ ok: true });
}

export async function POST({ request }: { request: Request }) {
  const body = await request.json();
  return Response.json(body, { status: 201 });
}
```

Supported methods are the framework's documented uppercase HTTP handlers.
Default exports, lowercase method names, and route-module middleware exports
are invalid. Files with no route exports remain ordinary colocated helpers.

### Server route conflicts

The build rejects:

- two modules for the same URL;
- two parameter names for the same dynamic shape, such as `$id` and `$userId`;
- unsafe or malformed group/dynamic segments;
- generated route-id collisions;
- route modules that mix unsupported exports into the route contract.

Do not add `route.ts` sentinels, `foo.get.ts` files, bracket routes, optional
params, catch-all routes, or a `server.entry`.

## Server Middleware

Two middleware conventions exist:

```text
src/
├── middleware.ts
└── apis/
    ├── middleware.ts
    └── admin/
        ├── middleware.ts
        └── users.ts
```

- `src/middleware.ts` wraps framework-owned server requests globally.
- `src/apis/**/middleware.ts` wraps descendant server file routes by
  filesystem scope.

Middleware files are not routes and cannot be replaced by exporting middleware
from a route module.

## Generated Files

The framework may generate:

- `.ev/**` framework IR and entry facades;
- `src/route-types.d.ts` from canonical SPA file routes when supported;
- `dist/**` build output.

Do not edit or scaffold these files. Keep them ignored.

## Migrating Existing Applications

Canonical Page discovery does not ask users to select a route reader or
provider. A new or migrated application declares `routing.mode`; the presence
of `src/pages` alone has no client-routing effect.

### Bigfish SPA

The migration normalizer accepts `application.routes` plus the
`component`/`children`, `layout`, `wrappers`, and `redirect` spellings needed
by Bigfish SPA trees. Shared template and mount values live under
`application.document`. It does not accept a topology selector, top-level
`routes`, or top-level `html`. The canonical destination moves each component
into the directory for its public URL as `page.*`.

### Smallfish

Before running Core 0.3, keep or reshape each public URL directory, rename its
`index.*` component entry to `page.*`, map `config.json` title and supported
named meta to core `title` and `meta`, and move remaining plugin-owned values
into namespaced `page.config.ts` extensions. Delete `config.json`, then select
only `routing.mode: "mpa"`.

### evjs 0.2 and the `page.*` preview

Before running Core 0.3, move each published filename route to the directory
for its URL and rename the entry to `page.*`. Preserve `$param` and `(group)`
directory segments as needed. The earlier positive-anchor preview already
understands `page.*`; its experimental selector is no longer part of the
public config.

For the canonical destination:

1. move each Page entry to its URL directory as `page.*`;
2. move title, supported named meta, rendering, and plugin-owned Page settings
   to `page.config.ts`;
3. keep Page-owned helpers anywhere in that directory without `_`;
4. represent parameters with `$param`, terminal catch-alls with `$...splat`,
   and pathless groups with `(group)`;
5. keep supported route facets beside their route directories;
6. declare only `routing.mode` and run `ev inspect` to review normalized Pages,
   Routes, Documents, Page config, and provenance.

Provider ids may appear in raw CoreGraph/debug artifacts to explain provenance.
Normal inspect routing output hides them. They do not define another public
routing model.
