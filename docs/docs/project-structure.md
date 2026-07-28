# Project Structure

This page is the source of truth for evjs application conventions.

Core 0.3 uses symmetric positive anchors for client Pages and server request
Routes:

- `src/pages/**/page.*` is the only canonical Page and client-route anchor;
- `src/apis/**/api.*` is the only server request-route anchor;
- each anchor's containing directory determines its scope and URL;
- the same file tree produces the same semantic Pages and Routes in SPA and
  MPA;
- `routing.mode` changes materialization, not Page or Route identity.

## Recommended Structure

```text
my-evjs-app/
├── ev.config.ts
├── index.html
├── package.json
├── tsconfig.json
├── public/
└── src/
    ├── middleware.ts
    ├── pages/
    │   ├── page.tsx                 # /
    │   ├── page.config.ts          # optional build-time config for /
    │   ├── layout.tsx               # root layout in SPA and MPA
    │   ├── about/
    │   │   └── page.tsx             # /about
    │   ├── users/
    │   │   ├── page.tsx             # /users
    │   │   ├── page.config.ts       # optional Page capabilities
    │   │   ├── model.ts
    │   │   ├── components/
    │   │       ├── Hero.tsx
    │   │       └── index.tsx       # private barrel/component, not a Page
    │   │   └── $userId/
    │   │       ├── page.tsx         # /users/:userId
    │   │       └── services.ts
    │   └── (account)/
    │       └── settings/
    │           └── page.tsx         # /settings
    ├── apis/
    │   ├── middleware.ts
    │   ├── users.server.ts
    │   └── api/
    │       └── health/
    │           └── api.ts            # /api/health
    ├── components/
    ├── features/
    ├── hooks/
    └── lib/
```

The matching SPA declaration is:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

An MPA keeps the same Page tree and changes only the materialization mode:

```ts
export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

## Convention Discovery Boundary

The top-level `conventions: false` switch disables the framework-owned
filesystem convention as one unit: `page.*` anchors, `api.*` anchors under
`src/apis`, global `src/middleware.ts`, and route-scoped
`src/apis/**/middleware.ts`. It cannot be combined with an explicit `routing`
or `server.routing` declaration. evjs does not expose switches for disabling
only one of these roots or facets.

```ts
export default defineConfig({
  conventions: false,
});
```

SPA-only `application.routes` is configuration rather than a file convention.
Reachable `"use server";` modules and plugin-generated contributions are graph
inputs rather than filesystem conventions. Those inputs remain available when
convention discovery is disabled. `app`, `pages`, and top-level `routes` are
not public configuration fields and are rejected.

When conventions are enabled, `server.routing: { dir }` may move the server
file-route root away from `src/apis`; it customizes the root and does not
disable discovery.

## Convention Matrix

Use this matrix when creating application files. Paths are relative to the
project root unless stated otherwise.

| Path or declaration | Framework meaning | Scope / output | Notes |
| --- | --- | --- | --- |
| `ev.config.ts` | Framework configuration | Whole project | Import `defineConfig` from `@evjs/ev`. |
| `conventions: false` | Disable framework file discovery | Whole project | Disables Page/Route anchors, server file routes, and global/route middleware together. |
| `routing.mode` | Output materialization | Application | `"spa"` creates Client Routes; `"mpa"` creates Page-owned Documents for static Page paths. It does not select a different route model. |
| `src/pages/**/page.{ts,tsx,js,jsx}` | Canonical Page and Route anchor | Entire containing directory | The Page root is fixed. Exactly one source-extension variant is allowed per route directory. Default-export the Page component. |
| `<Page directory>/page.config.{ts,js}` | Optional canonical Page, Page-anchored Route, and Page-owned Document configuration | Build graph | Default-export static config. Top-level `extensions` belong to the Page; `route.extensions` belong to its unique semantic Route; `document.aliases` adds validated static output filenames without adding Routes. Prefer `definePageConfig()` and `page.config.ts`; exactly one variant per Page. |
| `src/pages/**/$param/` | Dynamic route segment | Route path | Produces a semantic `:param` segment. |
| `src/pages/**/$...splat/` | Catch-all route segment | Route path | Must be terminal. |
| `src/pages/**/(group)/` | Pathless route group | Source organization | Participates in scope but contributes no URL segment. |
| `src/pages/layout.*` and nested `layout.*` | Route layout facet | Semantic route tree | Composed around descendants in both SPA and MPA materialization. |
| `src/pages/**/error.*` and `not-found.*` | Route boundary facets | SPA route tree | MPA rejects these router-only facets until they have an explicit Document contract. |
| Other files below a Page directory | Page-private source | Nearest Page | Components, hooks, models, services, tests, styles, assets, and `index.*` do not create routes. |
| `<Page directory>/index.html` | Page Document template | MPA Page output | Overrides the shared template for that MPA Page. It is not a client Page entry. |
| `index.html` / `routing.html` | Document template | Application output | `index.html` is the default template; it is unrelated to the Page entry filename. |
| `src/route-types.d.ts` | SPA file-route navigation types, when emitted | Generated output | Ignore it; do not copy it into scaffolds or import it from app code. |
| `**/*.server.{ts,tsx,js,jsx}` with `"use server";` | Server-function module | Reachability graph | Named callable exports only. There is no required directory. |
| `server.routing: { dir }` | Server file-route root customization | Application | Defaults to `./src/apis` while conventions are enabled; this is not a disable switch. |
| `<server.routing.dir>/**/api.{ts,tsx,js,jsx}` | Server request Route anchor | Entire containing directory | Exactly one source-extension variant per route directory. Export callable uppercase HTTP method handlers only. Registration uses segment-wise specificity: static segments precede dynamic segments at the first differing position. |
| Other files below a server route directory | Route-private source | Nearest server Route | Helpers, schemas, stores, tests, and `index.*` do not create routes. |
| `src/middleware.ts` | Global server middleware | Server runtime | Wraps framework-owned server requests. |
| `<server.routing.dir>/**/middleware.ts` | API route middleware | Same-directory and descendant server file routes | Defaults to `src/apis/**/middleware.ts`; not itself a route. |
| `public/**` | Static files | Client output | Copied according to output configuration. |
| `components/`, `features/`, `hooks/`, `lib/` | Shared application source | Application/shared | Ordinary project organization, not framework conventions. |

### Canonical Page and Route resolution

For this anchor:

```text
src/pages/people/$personId/page.tsx
```

evjs resolves:

```text
Page entry    src/pages/people/$personId/page.tsx
Page scope    src/pages/people/$personId/
URL           /people/:personId
```

There is no second route map to keep synchronized: the Page directory is the
stable source of both identity and URL. Core derives build-safe internal ids
separately. SPA and MPA normalize this source to the same semantic Page and
Route nodes, then choose different runtime/output projections.

### Page-private code

Everything below a Page directory belongs to that Page unless a descendant
directory contains another `page.*` anchor:

```text
src/pages/orders/$orderId/
├── page.tsx
├── page.config.ts
├── index.ts
├── loader.server.ts
├── model.ts
├── components/
│   └── Summary.tsx
└── __tests__/
    └── detail.test.tsx
```

No `_` prefix is required for ordinary private code. Private scope is an
ownership boundary, not access control: JavaScript imports are still governed
by normal module rules and optional lint tooling. `index.*` has no client-route
meaning. A descendant `page.*` intentionally creates another Page and its
directory becomes a more specific scope.

`_` has no private-route meaning. A directory such as `_components/` remains
ordinary source only because it contains no `page.*` anchor. If
`_private/page.tsx` exists, discovery reports an invalid static URL segment
instead of silently hiding the Page; static segments must start with a letter
or number.

### Route tree

Directory nesting is the route tree:

```text
src/pages/
├── page.tsx                       # /
└── admin/
    ├── layout.tsx                 # /admin subtree layout in SPA and MPA
    ├── page.tsx                   # /admin
    ├── members/
    │   └── $memberId/
    │       └── page.tsx           # /admin/members/:memberId
    └── (settings)/
        └── profile/
            └── page.tsx           # /admin/profile
```

Layouts compose around descendant Pages in both SPA and MPA materialization.
SPA Page routes may additionally render `Outlet` from `@evjs/ev/navigation`.
MPA rejects `$param` and terminal `$...splat` routes because a dynamic pattern
does not identify one build-time HTML output. Router-only boundary facets are
also SPA-only. `ev inspect` and `ev build` report these combinations rather
than selecting another authoring convention.

## Page Modules

A React Page default-exports its component:

```tsx
export default function UserDetailPage() {
  return <main>User detail</main>;
}
```

Use the public authoring subpaths from Page code:

```tsx
import { usePageParams } from "@evjs/ev/route";
import { Link, useNavigate } from "@evjs/ev/navigation";
import { useQuery } from "@evjs/ev/query";
```

The exact exports are documented in [Client Routes](./client-routes) and
[Server Functions](./server-functions).

### Application, Page, Route, and Document extension scopes

Application-wide plugin data is authored once at top-level
`ev.config.ts#extensions` and registered with
`applicationExtension()`. Per-Page plugin data is authored under the adjacent
`page.config.ts#extensions` and registered with `pageExtension()`. Route-owned
data for a canonical Page route is authored under
`page.config.ts#route.extensions` and registered with `routeExtension()`.
This explicit nesting keeps menu, access, tracing, and micro-frontend data on
the semantic Route rather than silently treating it as Page data.

All owner kinds use the same CoreGraph extension registry. One plugin may own
the same namespace for more than one owner kind as long as it declares each
owner. Explicit SPA Route values may be authored on
`application.routes[*].extensions`; after adopting the canonical Page tree,
move each Page route value to `page.config.ts#route.extensions`. Runtime
projection is always explicit.

`page.config.ts#route.extensions` requires exactly one semantic Route targeting
that Page. If an explicit config-route tree reuses one Page from multiple
Routes, configure each `application.routes[*].extensions` value separately
until the routes have distinct canonical Page anchors. A componentless layout
Route cannot borrow a descendant Page config, and a pathless directory without
a Page or layout does not materialize a Route at all. Plugins may apply
Route-extension defaults to such structural Routes. Otherwise retain explicit
`application.routes` configuration until the componentless Route data has
another real owner; evjs diagnoses an orphan `page.config.ts` instead of
inheriting it.

Application-owned Document values in an explicit SPA profile use
`application.document.extensions` and `documentExtension()`. A canonical
Page-owned Document uses `page.config.ts#document.extensions`; this is valid
only when that Page materializes its own Document, such as MPA or an SPA SSG
Page. A CSR SPA Page shares the Application-owned Document, so Page-specific
Document configuration is diagnosed instead of being applied globally.
Plugins may register Document defaults for either materialization.

### Page configuration and extensions

An adjacent `page.config.ts` default-exports build-time Page configuration:

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Orders",
  meta: {
    description: "Review and manage customer orders.",
    keywords: "orders,payments",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
  extensions: {
    "@company/analytics": {
      channel: "orders",
    },
  },
  route: {
    extensions: {
      "@company/access": {
        policy: "canReadOrders",
      },
    },
  },
});
```

Core fields include the static Page `title`, named `meta`, `render`, `hydrate`,
`prerender`, and `rsc`. Omitted `render` always normalizes to CSR, which must
omit `hydrate`; explicit SSR/SSG Pages may select `"load"` or `"none"`. Each
`meta` entry becomes
`<meta name="key" content="value">`; it does not represent `property`,
`charset`, `link`, `script`, dynamic metadata, or an arbitrary head DSL.
Plugin-owned Page values live below top-level `extensions`; Route-owned values
live below `route.extensions`. Both use registered namespaced keys, and the
resolved config must be static JSON data. Core title and meta values are
materialized for the active Page; extension values enter their corresponding
normalized graph owners but require their plugin to explicitly project runtime
data or behavior through generated contributions.

When a Page owns a static Document (MPA CSR/SSG or SPA SSG), it may publish the
same transformed HTML at additional validated paths:

```ts
export default definePageConfig({
  document: {
    aliases: ["orders.html", "legacy/orders.htm"],
  },
});
```

Aliases do not create Pages, Routes, or additional Documents. They must be
normalized relative paths ending in `.html` or `.htm`, must differ from the
canonical output, and must not collide with any other canonical output or
alias. Restricting the suffix keeps framework HTML from overwriting JavaScript,
CSS, or deployment metadata. Page-specific Document configuration is rejected
when the Page shares a SPA Application Document or uses request-time rendering.

## Server Boundary

Client routing and server request routing are separate systems, but they share
the request pathname namespace. Every URL-owning client Route (Page or
redirect) must be disjoint from server request Route patterns: a static segment
can intersect a dynamic segment, and a terminal client splat can intersect both
its prefix and descendants. Percent-encoded static aliases are compared by
their one-decode URL meaning, so `/%75sers` also intersects `/users`, while
double-encoded text stays distinct. An encoded `/` remains inside its segment
and never merges path boundaries. Explicit client segments that decode to `.`
or `..` are rejected because WHATWG URL parsing removes them before routing.
Structural group Routes do not own a URL. Build planning rejects collisions
because server request Routes take precedence at runtime.

Server request Routes use a positive `api.*` anchor under `src/apis`. The
anchor's complete containing directory determines its URL and scope; `$param`
directories create dynamic segments and `(group)` directories provide pathless
organization:

```text
src/apis/
├── middleware.ts
├── api/
│   ├── health/
│   │   └── api.ts
│   └── users/
│       ├── api.ts
│       ├── users-store.ts
│       └── $userId/
│           └── api.ts
└── (internal)/
    └── metrics/
        └── api.ts
```

```ts
export function GET(
  _request: Request,
  ctx: { req: { param(name: string): string } },
) {
  return Response.json({ id: ctx.req.param("userId") });
}
```

Only `api.*` is a server request-route anchor. Other basenames, including
`index.ts`, `route.ts`, and method-suffix files, remain ordinary private source
even if they export a name such as `GET`. An anchored `api.*` module exports
callable uppercase HTTP methods. Local declarations, imported or re-exported
handlers, factories, and mutable bindings are all composition details; known
non-callable values and generators are rejected during discovery, and the
evaluated method values are validated when the generated route module loads.
Default exports, helper exports, and route-module middleware exports are
invalid. Anchors under bracket, catch-all, optional, or otherwise invalid path
segments are rejected. Do not add another route anchor or a `server.entry`
composition path.

Server functions are different again: any reachable module that starts with
`"use server";` and exports supported named callables can define them. See
[Server Routes](./server-routes) and
[Server Functions](./server-functions).

## Generated Structure

`ev prepare`, `ev dev`, and `ev build` materialize framework IR under `.ev`.
It contains the normalized graph, generated entries, plugin contributions,
framework slots, import edges, and the final manifest inputs.

Treat these as generated:

- `.ev/`
- `dist/`
- `.turbo/`
- `node_modules/`
- `src/route-types.d.ts`

Do not edit them or copy them into templates.

## Route Input Boundaries

Core 0.3 has one file-convention reader. Client Page discovery begins only
after the application declares `routing.mode`; an unrelated `src/pages`
directory alone does not publish routes. Explicit `application.routes` is a
separate SPA-only configuration input that normalizes into the same CoreGraph.

| Input | Current semantics | Source requirements |
| --- | --- | --- |
| `routing.mode` | Discovers the canonical Page tree and selects SPA or MPA materialization. | Only `src/pages/**/page.*` publishes a Page. Other files, including `index.*`, remain private source. Page settings live in adjacent `page.config.ts` modules. |
| `application.pageRoot` | Page source root for both `page` and `component` references in the explicit SPA route tree; defaults to `./src/pages`. | Applies only with `application.routes`; it does not customize canonical `src/pages` discovery. `@/pages/...` aliases this configured root. |
| `application.routes` | Accepts `routes` nesting (not `children`), `page` or `component`, layout/wrapper/redirect structure, and registered namespaced `extensions`. `exact: true` is a terminal-match assertion; `exact: false`, or `exact: true` with nested routes, is rejected. This input cannot be combined with `routing` and cannot select MPA. | A `page` resolves to exactly one `page.*` anchor below `application.pageRoot`. A `component` must remain below the same root, including after resolving symbolic links. An `index.*` or `page.*` component owns its containing directory; other component basenames are module-scoped and do not consume `page.config.ts`. Layouts and wrappers remain project-source references. |

Provider names may appear in raw CoreGraph/debug artifacts as internal
provenance. Normal inspect routing output hides them; applications do not
choose a provider as an architectural mode.

## Naming Guidance

- Choose route directory names for stable public URLs.
- Use lowercase URL segments unless an existing public URL requires casing.
- Use `$param`, terminal `$...splat`, and `(group)` directory segments.
- Keep Page-private code inside its Page directory.
- Keep shared business modules outside individual Page directories when several
  Pages use them.
- Put static document title and named meta in the core `title` and `meta`
  fields. Keep product/plugin capability data behind namespaced
  `page.config.ts` extensions.
- Keep static title, named meta, rendering settings, and namespaced extension
  values together in the adjacent `page.config.ts` module.
