# Project Structure

This page is the source of truth for evjs application conventions.

evjs uses symmetric positive anchors for client Pages and server request
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
`src/apis/**/middleware.ts`. It cannot be combined with an explicit client
`routing` declaration. evjs does not expose switches for disabling only one of
these roots or facets.

```ts
export default defineConfig({
  conventions: false,
});
```

SPA-only `application.routes` is configuration rather than a file convention.
Reachable `"use server";` modules and plugin-generated contributions are graph
inputs rather than filesystem conventions. Those inputs remain available when
convention discovery is disabled.

When conventions are enabled, the server file-route root is fixed at
`src/apis`.

## Convention Matrix

Use this matrix when creating application files. Paths are relative to the
project root unless stated otherwise.

| Path or declaration | Framework meaning | Scope / output | Notes |
| --- | --- | --- | --- |
| `ev.config.ts` | Framework configuration | Whole project | Import `defineConfig` from `@evjs/ev`. |
| `conventions: false` | Disable framework file discovery | Whole project | Disables Page/Route anchors, server file routes, and global/route middleware together. |
| `routing.mode` | Output materialization | Application | `"spa"` creates Client Routes; `"mpa"` creates Page-owned Documents for static Page paths. It does not select a different route model. |
| `src/pages/**/page.{ts,tsx,js,jsx}` | Canonical Page and Route anchor | Entire containing directory | The Page root is fixed. Exactly one source-extension variant is allowed per route directory. Default-export the Page component. |
| `<Page directory>/page.config.{ts,js}` | Optional canonical Page configuration | Build graph | Default-export static config. Core metadata/rendering fields and the typed `plugins` map belong to the Page; `document.aliases` adds validated static output filenames without adding Routes. Prefer `definePageConfig()` and `page.config.ts`; exactly one variant per Page. |
| `src/pages/**/$param/` | Dynamic route segment | Route path | Produces a semantic `:param` segment. |
| `src/pages/**/$...splat/` | Catch-all route segment | Route path | Must be terminal. |
| `src/pages/**/(group)/` | Pathless route group | Source organization | Participates in scope but contributes no URL segment. |
| `src/pages/layout.*` and nested `layout.*` | Route layout facet | Semantic route tree | Composed around descendants in both SPA and MPA materialization. |
| `src/pages/**/error.*` and `not-found.*` | Route boundary facets | SPA route tree | MPA rejects these router-only facets. |
| Other files below a Page directory | Page-private source | Nearest Page | Components, hooks, models, services, tests, styles, assets, and `index.*` do not create routes. |
| `<Page directory>/index.html` | Page Document template | MPA Page output | Overrides the shared template for that MPA Page. It is not a client Page entry. |
| `index.html` / `routing.html` | Document template | Application output | `index.html` is the default template; it is unrelated to the Page entry filename. |
| `src/route-types.d.ts` | SPA file-route navigation types, when emitted | Generated output | Ignore it; do not copy it into scaffolds or import it from app code. |
| `src/plugin-types.d.ts` | Static `ev.config.ts` type bridge | Generated output | Ignore it; Page config consumes its augmentation automatically and does not import plugin packages. |
| Reachable source module with `"use server";` | Server-function module | Reachability graph | Named callable exports only. There is no required directory or filename suffix; `.server.*` is recommended for clarity. |
| `src/apis/**/api.{ts,tsx,js,jsx}` | Server request Route anchor | Entire containing directory | The server route root is fixed. Exactly one source-extension variant is allowed per route directory. Export callable uppercase HTTP method handlers only. Registration uses segment-wise specificity: static segments precede dynamic segments at the first differing position. |
| Other files below a server route directory | Route-private source | Nearest server Route | Helpers, schemas, stores, tests, and `index.*` do not create routes. |
| `src/middleware.ts` | Global server middleware | Server runtime | Wraps framework-owned server requests. |
| `src/apis/**/middleware.ts` | API route middleware | Same-directory and descendant server file routes | Not itself a route. |
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

### Application and Page plugin scopes

An Application installs and configures a plugin in `ev.config.ts#plugins`:

```ts
import { defineConfig } from "@evjs/ev";
import { analytics } from "@company/evjs-plugin-analytics";

export default defineConfig({
  routing: { mode: "spa" },
  plugins: [analytics({ endpoint: "/events" })],
});
```

The factory call is the only Application-level plugin configuration surface.
Its argument is typed by the plugin package and may contain executable options
when that package explicitly supports them.

A Page-aware installed plugin exposes a short key in the adjacent
`page.config.ts#plugins` map. Application and Page contracts are independent
and never merge with each other. Authored fields deep-merge over defaults
within their own contract. With a normal factory call, an omitted Page key uses
Page defaults when they exist and otherwise disables that Page. A defaultable
Page contract also exposes `forPages()`, where omission always disables the
Page. `false` disables the plugin for a Page, `true` requires Page defaults,
and an object enables it with an independently typed, strict-JSON Page value.

`ev prepare`, `ev dev`, and `ev build` generate `src/plugin-types.d.ts` as a
stable bridge to `ev.config.ts`. TypeScript config provides Page key and value
completion without a plugin import; conditional or widened plugin arrays expose
only entries that are statically certain to install. The declaration lives in
`src`, not `.ev`, because normal project tsconfigs include `src`.

Route and Document objects do not expose separate plugin configuration. A
Page-aware plugin derives route patterns, Document ownership, and other
semantic context from the normalized Page graph, then explicitly projects its
runtime or build contribution.

### Page configuration and plugins

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
  plugins: {
    analytics: {
      channel: "orders",
    },
    access: {
      policy: "canReadOrders",
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
Plugin-owned Page values live below `plugins` and use generated short keys.
The resolved Page objects must be static JSON data. Core title and meta values
are materialized for the active Page; plugin values enter Page analysis but
require their plugin to explicitly project runtime data or behavior through
generated contributions.

When a Page owns a static Document (MPA CSR/SSG or SPA SSG), it may publish the
same transformed HTML at additional validated paths:

```ts
export default definePageConfig({
  document: {
    aliases: ["orders.html", "archive/orders.htm"],
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
segments are rejected. `api.*` is the only server request-route anchor.

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
- `src/plugin-types.d.ts`

Do not edit them or copy them into templates.

## Route Input Boundaries

Client Page discovery begins only
after the application declares `routing.mode`; an unrelated `src/pages`
directory alone does not publish routes. Explicit `application.routes` is a
separate SPA-only configuration input that normalizes into the same CoreGraph.

| Input | Current semantics | Source requirements |
| --- | --- | --- |
| `routing.mode` | Discovers the canonical Page tree and selects SPA or MPA materialization. | Only `src/pages/**/page.*` publishes a Page. Other files, including `index.*`, remain private source. Page settings live in adjacent `page.config.ts` modules. |
| `application.pageRoot` | Page source root for both `page` and `component` references in the explicit SPA route tree; defaults to `./src/pages`. | Applies only with `application.routes`; it does not customize canonical `src/pages` discovery. `@/pages/...` aliases this configured root. |
| `application.routes` | Accepts `routes` nesting (not `children`), `page` or `component`, and layout/wrapper/redirect structure. Plugin configuration is Page-owned rather than authored on Route declarations. `exact: true` is a terminal-match assertion; `exact: false`, or `exact: true` with nested routes, is rejected. This input cannot be combined with `routing` and cannot select MPA. | A `page` resolves to exactly one `page.*` anchor below `application.pageRoot`. A `component` must remain below the same root, including after resolving symbolic links. An `index.*` or `page.*` component owns its containing directory; other component basenames are module-scoped and do not consume `page.config.ts`. Layouts and wrappers remain project-source references. |

## Naming Guidance

- Choose route directory names for stable public URLs.
- Use lowercase URL segments unless an existing public URL requires casing.
- Use `$param`, terminal `$...splat`, and `(group)` directory segments.
- Keep Page-private code inside its Page directory.
- Keep shared business modules outside individual Page directories when several
  Pages use them.
- Put static document title and named meta in the core `title` and `meta`
  fields. Keep product/plugin capability data under generated short keys in
  `page.config.ts#plugins`.
- Keep static title, named meta, rendering settings, and Page plugin values
  together in the adjacent `page.config.ts` module.
