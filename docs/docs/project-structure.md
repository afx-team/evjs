# Project Structure

This page is the source of truth for evjs application conventions.

Core 0.3 uses one positive Page-and-Route convention:

- `src/pages/**/page.*` is the only canonical Page and client-route anchor;
- the containing directory determines both the Page scope and URL;
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
    │       └── health.ts
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
filesystem convention as one unit: `page.*` anchors, server routes under
`src/apis`, global `src/middleware.ts`, and route-scoped
`src/apis/**/middleware.ts`. It cannot be combined with an explicit `routing`
or `server.routing` declaration. evjs does not expose switches for disabling
only one of these roots or facets.

```ts
export default defineConfig({
  conventions: false,
});
```

The SPA-only `application.routes` migration input is configuration rather than
a file convention. Reachable `"use server";` modules and plugin-generated
contributions are graph inputs rather than filesystem conventions. Those
inputs remain available when convention discovery is disabled. Removed
`app`, `pages`, and top-level `routes` declarations produce migration errors.

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
| `routing.mode` | Output materialization | Application | `"spa"` creates Client Routes; `"mpa"` creates Page-owned Documents. It does not select a different route model. |
| `routing.dir` | Page-route root | Application | Defaults to `./src/pages`; new applications normally omit it. |
| `<routing.dir>/**/page.{ts,tsx,js,jsx}` | Canonical Page and Route anchor | Entire containing directory | Exactly one source-extension variant per route directory. Default-export the Page component. |
| `<Page directory>/page.config.{ts,js}` | Optional canonical Page configuration | Build graph | Default-export static Page config. Prefer `definePageConfig()` and `page.config.ts`; exactly one variant per Page. |
| `<routing.dir>/**/$param/` | Dynamic route segment | Route path | Produces a semantic `:param` segment. |
| `<routing.dir>/**/$...splat/` | Catch-all route segment | Route path | Must be terminal. |
| `<routing.dir>/**/(group)/` | Pathless route group | Source organization | Participates in scope but contributes no URL segment. |
| `<routing.dir>/layout.*` and nested `layout.*` | Route layout facet | Semantic route tree | Composed around descendants in both SPA and MPA materialization. |
| `<routing.dir>/**/error.*` and `not-found.*` | Route boundary facets | SPA route tree | MPA rejects these router-only facets until they have an explicit Document contract. |
| Other files below a Page directory | Page-private source | Nearest Page | Components, hooks, models, services, tests, styles, assets, and `index.*` do not create routes. |
| `<Page directory>/index.html` | Page Document template | MPA Page output | Overrides the shared template for that MPA Page. It is not a client Page entry. |
| `index.html` / `routing.html` | Document template | Application output | `index.html` is the default template; it is unrelated to the Page entry filename. |
| `src/route-types.d.ts` | SPA file-route navigation types, when emitted | Generated output | Ignore it; do not copy it into scaffolds or import it from app code. |
| `**/*.server.{ts,tsx,js,jsx}` with `"use server";` | Server-function module | Reachability graph | Named callable exports only. There is no required directory. |
| `server.routing: { dir }` | Server file-route root customization | Application | Defaults to `./src/apis` while conventions are enabled; this is not a disable switch. |
| `src/apis/**/*.{ts,tsx,js,jsx}` | Server file route | Request URL | Uppercase HTTP method exports; URL comes from the file path. |
| `src/middleware.ts` | Global server middleware | Server runtime | Wraps framework-owned server requests. |
| `src/apis/**/middleware.ts` | API route middleware | Descendant server file routes | Not itself a route. |
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
Some MPA dynamic-route and React-facet materialization remains staged;
`ev inspect` and `ev build` report unsupported combinations rather than
selecting another authoring convention.

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
});
```

Core fields include the static Page `title`, named `meta`, `render`, `hydrate`,
`prerender`, and `rsc`. Each `meta` entry becomes
`<meta name="key" content="value">`; it does not represent `property`,
`charset`, `link`, `script`, dynamic metadata, or an arbitrary head DSL.
Plugin-owned values live below `extensions` and use a registered namespaced
key. The resolved config must be static JSON data. Core title and meta values
are materialized for the active Page; extension values enter the normalized
graph but require their owning plugin to explicitly project runtime data or
behavior through generated contributions.

## Server Boundary

Client Page routing and server request routing are separate systems.

Server file routes use `src/apis`, `$param` dynamic filename segments, `index`
for directory roots, and `(group)` for pathless organization:

```text
src/apis/
├── middleware.ts
├── api/
│   ├── health.ts
│   └── users/
│       ├── index.ts
│       └── $userId.ts
└── (internal)/
    └── metrics.ts
```

```ts
export function GET({ params }: { params: { userId: string } }) {
  return Response.json({ id: params.userId });
}
```

Server route modules export uppercase HTTP methods only. Helper files without
route exports remain ordinary source. Do not introduce `route.ts` sentinels,
method-suffix files, bracket routes, catch-all routes, optional params,
route-module middleware exports, or a `server.entry` composition path.

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

## Migrating Existing Applications

Core 0.3 does not select a Smallfish or evjs 0.2 runtime reader. Convert those
source trees once before starting the application. Client Page discovery begins
only after the application declares `routing.mode`; an unrelated `src/pages`
directory alone does not publish routes.

| Existing source | Migration action | Canonical destination |
| --- | --- | --- |
| Bigfish SPA route config / `application.routes` | The explicit SPA route tree may enter the migration normalizer temporarily and implies SPA; it cannot be combined with `routing`, and MPA topology is rejected | Move each route component to its URL directory as `page.*`; after removing `application`, enable the canonical tree with only `routing.mode: "spa"` |
| Smallfish direct-child Page directories | Before running Core 0.3, keep or reshape each URL directory and rename `<page>/index.*` to `page.*` | Keep `routing.mode: "mpa"`; map `config.json` title and supported named meta to core `title`/`meta`, and move remaining plugin-owned values to namespaced extensions |
| evjs 0.2 recursive routes | Before running Core 0.3, move each published filename route into its URL directory as `page.*` | Keep dynamic/group directory segments, move Page settings to `page.config.ts`, and configure only `routing.mode` |
| Core 0.3 `page.*` preview | Reads positive file-route anchors through the previous experimental selector | Keep the tree, remove the preview selector, and declare only `routing.mode` |

Provider names may appear in raw CoreGraph/debug artifacts as internal
provenance. Normal inspect routing output hides them; applications do not
choose a provider as an architectural mode.

## Naming Guidance

- Choose route directory names for stable public URLs.
- Use lowercase URL segments unless an existing public URL requires casing.
- Use `$param`, terminal `$...splat`, and `(group)` directory segments.
- Keep Page-private code inside its Page directory.
- Keep shared business modules outside `routing.dir` when several Pages own
  them.
- Put static document title and named meta in the core `title` and `meta`
  fields. Keep product/plugin capability data behind namespaced
  `page.config.ts` extensions.
- Delete legacy `config.json` after mapping supported title/meta fields and
  moving remaining owned values to `page.config.ts`.
