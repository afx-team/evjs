# Client Routes

Client routing has one canonical Page-and-Route model:

- `src/pages/**/page.*` is the positive Page and Route anchor;
- the containing directory is the Page-private scope;
- directory segments determine the URL;
- `routing.mode` chooses SPA or MPA materialization for the same semantic
  Page/Route tree.

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

```text
src/pages/
├── page.tsx                         # /
├── page.config.ts                  # optional build-time config for /
├── users/
│   ├── page.tsx                     # /users
│   └── $userId/
│       ├── page.tsx                 # /users/:userId
│       └── components/
│           └── Profile.tsx          # Page-private code
└── (account)/
    └── settings/
        └── page.tsx                 # /settings
```

There is no separate route map to keep synchronized with this tree.

## Pages

A canonical Page:

- is a `page.{ts,tsx,js,jsx}` module;
- default-exports its component;
- owns its complete containing directory as private source scope;
- receives its semantic identity and URL from its directory relative to
  `src/pages`.

```tsx
// src/pages/users/$userId/page.tsx
import { usePageParams } from "@evjs/ev/route";
import { useQuery } from "@evjs/ev/query";
import { getUser } from "./get-user.server";

export default function UserDetailPage() {
  const { userId } = usePageParams();
  const { data: user } = useQuery(getUser, userId);

  if (!user) return null;
  return <h1>{user.name}</h1>;
}
```

Page components do not receive framework `params`, `search`, or `loaderData`
props. SPA Pages use the Page hooks:

```tsx
import {
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "@evjs/ev/route";
```

Search starts as `Record<string, string>`. Convert values in
`validateSearch` when a Page needs numbers, booleans, or structured values.

```tsx
export const validateSearch = (search: Record<string, string>) => ({
  tab: typeof search.tab === "string" ? search.tab : "overview",
});

export async function loader() {
  return { title: "User" };
}

export default function UserDetailPage() {
  const params = usePageParams();
  const search = usePageSearch();
  const data = usePageLoaderData();
  return (
    <h1>
      {data.title}: {params.userId} ({search.tab})
    </h1>
  );
}
```

CSR SPA Pages may expose supported route lifecycle exports such as `loader`,
`beforeLoad`, `validateSearch`, `pendingComponent`, `errorComponent`, and
`notFoundComponent`. These hooks currently execute in the browser route tree;
SSR and SSG Pages reject them until the framework defines an equivalent server
route lifecycle and initial-data transport. MPA does not run a browser route
tree, so these lifecycle hooks are not an MPA data-loading model.

## Directory Route Tree

Directory nesting is route nesting. Segment syntax is deliberately small:

| Directory segment | Route meaning |
| --- | --- |
| `users` | Static `users` segment. |
| `$userId` | Dynamic `:userId` segment. |
| `$...splat` | Terminal catch-all. |
| `(account)` | Pathless organization group. |

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

A directory without `page.*` can organize descendants. It does not create a
Page by itself. The build rejects malformed segments, non-terminal splats,
duplicate normalized paths, ambiguous dynamic shapes, and generated route-id
collisions.

### Page routes with children

In SPA mode, a parent Page can render its nested route:

```tsx
import { Outlet } from "@evjs/ev/navigation";

export default function TeamsPage() {
  return (
    <section>
      <h1>Teams</h1>
      <Outlet />
    </section>
  );
}
```

## Page-Private Code

Everything in the Page directory belongs to that Page unless a descendant
directory contains another `page.*`:

```text
src/pages/orders/$orderId/
├── page.tsx
├── page.config.ts
├── index.ts
├── model.ts
├── get-order.server.ts
├── components/
│   └── Summary.tsx
└── __tests__/
    └── page.test.tsx
```

Only `page.*` creates a Page and Route. `index.*`, components, hooks, models,
services, styles, tests, and assets are ordinary Page-private source, so they
need no `_` prefix. Private scope is an ownership/discovery boundary, not
JavaScript access control.

## Layouts And Boundaries

SPA route composition can use file facets beside the route tree:

```text
src/pages/
├── layout.tsx
├── error.tsx
├── not-found.tsx
└── admin/
    ├── layout.tsx
    ├── page.tsx
    └── settings/
        └── page.tsx
```

Layouts wrap descendants in both SPA and MPA materialization. Error and
not-found facets define SPA router boundaries. MPA rejects those router-only
facets until they have an explicit Document contract, rather than silently
ignoring them.

## Navigation

Use anchors or the public navigation helpers:

```tsx
import { Link, useNavigate } from "@evjs/ev/navigation";

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <>
      <Link to="/users/1">Open user</Link>
      <button type="button" onClick={() => navigate({ to: "/users/2" })}>
        Next user
      </button>
    </>
  );
}
```

`src/route-types.d.ts`, when emitted, is generated output. Keep it ignored; do
not import it from application source or copy it into templates.

## SPA And MPA

`routing.mode` changes materialization, not Page or Route semantics.

### SPA

```ts
export default defineConfig({
  routing: { mode: "spa" },
});
```

SPA materializes the directory tree as browser Client Routes, normally under
one Application-owned HTML Document. It supports nested routes, dynamic
parameters, splats, layouts, boundaries, and browser navigation.
Each static SSG Page additionally emits HTML at its semantic route path:
`/` becomes `index.html` and `/report` becomes `report/index.html`.

### MPA

```ts
export default defineConfig({
  routing: { mode: "mpa" },
});
```

MPA discovers the same Pages and semantic route patterns, then materializes
Page-owned Documents without requiring a browser router. It currently accepts
only static Page paths; `$param`, terminal `$...splat`, and router-only
boundaries fail graph validation. Layouts compose around Pages in both modes.
`ev inspect` and `ev build` reject unsupported combinations instead of asking
applications to use a second route model. A colocated `index.html` supplies that MPA Page's
Document template.

## Page Configuration

Put optional Page-level configuration beside the anchor:

```ts
// src/pages/orders/$orderId/page.config.ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Order details",
  meta: {
    description: "Review an individual order.",
    keywords: "orders,details",
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

The module is synchronously evaluated at build time and must default-export
static JSON data. Core owns `title`, named `meta`, `render`, `hydrate`,
`prerender`, and `rsc`. `meta` accepts string key/value pairs and creates only
`<meta name="key" content="value">`; `property`, `charset`, links, scripts,
dynamic metadata, and a general head DSL are outside this contract. Plugin
values belong under a registered namespaced `extensions` key.

The resolved config is attached to the same normalized Page identity in SPA
and MPA. In SPA mode, the deepest active Page owns title/meta with no parent
Page inheritance. Route transitions restore the HTML template baseline or
remove values that the next Page does not declare, so metadata cannot leak
between Pages. A plugin that needs extension data at runtime must explicitly
generate and attach the minimal projection.

Page components do not export literal `render`, `hydrate`, `prerender`, or
`rsc` settings. Put them in `page.config.ts`. See [Build](./build) and
[Architecture](./architecture).

## Explicit SPA Route Configuration

`application.routes` can normalize an explicit SPA route tree into the same
Core graph. It accepts nested `routes`, `page` or `component`, layouts,
wrappers, redirects, and registered namespaced extensions. The `children`
spelling is rejected. Each declared Route keeps its own semantic identity.

This configuration is SPA-only and rejects MPA materialization. It is an
alternate input into the normalized graph, not a second canonical file
convention. An unrelated `src/pages` directory does not publish routes unless
canonical routing is enabled.
