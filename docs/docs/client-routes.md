# Pages and Routing

Create a page by adding `page.*` to the directory for its URL. evjs turns the
directory tree into either SPA routes or MPA documents.

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "spa" },
});
```

## Create a page

A page module default-exports its React component:

```tsx title="src/pages/about/page.tsx"
export default function AboutPage() {
  return <main>About this application</main>;
}
```

The containing directory creates `/about`. The root
`src/pages/page.tsx` creates `/`.

Only `page.ts`, `page.tsx`, `page.js`, or `page.jsx` publishes a page.
Everything else can be colocated without becoming another route.

## Build the route tree

Directory nesting creates nested route paths:

| Directory | URL pattern |
| --- | --- |
| `users` | `/users` |
| `users/$userId` | `/users/:userId` |
| `files/$...splat` | `/files/*` |
| `(marketing)/about` | `/about` |

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

A directory without `page.*` can group descendants. `$...splat` must be the
last segment. Dynamic parameters and splats are SPA-only.

## Mount an SPA below a basepath

Set `routing.basepath` when every browser route must live below one static
prefix:

```ts title="ev.config.ts"
export default defineConfig({
  routing: { mode: "spa", basepath: "/next" },
});
```

The authored root Page is still `/`, and an authored `/about` Page is still
addressed as `/about` by `Link`, `navigate`, redirects, and generated route
types. Their browser URLs become `/next` and `/next/about`. The framework also
uses those prefixed paths for development routing, server rendering, and
deployment fallbacks. `basepath` is not supported by MPA routing; omit it for
an SPA mounted at the origin root.

## Read path and search parameters

Use route hooks from `@evjs/ev/route`:

```tsx title="src/pages/users/$userId/page.tsx"
import { usePageParams, usePageSearch } from "@evjs/ev/route";

export default function UserPage() {
  const { userId } = usePageParams();
  const search = usePageSearch();

  return (
    <h1>
      User {userId} · tab {search.tab ?? "overview"}
    </h1>
  );
}
```

Search values start as strings. A CSR SPA page can export `validateSearch` to
convert or default them:

```tsx
export const validateSearch = (search: Record<string, string>) => ({
  tab: typeof search.tab === "string" ? search.tab : "overview",
});
```

`usePageParams()` is Page-scoped and works consistently across SPA, MPA, and
RSC rendering. In an SPA, root and nested layouts read the merged parameters
of the active route branch with `useRouteParams()`:

```tsx title="src/pages/layout.tsx"
import { useRouteParams } from "@evjs/ev/route";

export default function RootLayout({ children }: React.PropsWithChildren) {
  const { teamId } = useRouteParams<{ teamId?: string }>();
  return <main data-team-id={teamId}>{children}</main>;
}
```

## Resolve browser hrefs

`Link`, `useNavigate()`, and `redirect()` accept application-relative routes
and apply `routing.basepath` automatically. Native anchors and browser APIs
such as `window.open()` need a public browser href. Use `useHref()` for one
target, or `useHrefResolver()` when targets are created in callbacks:

```tsx
import { useHref, useHrefResolver } from "@evjs/ev/navigation";

export function NativeLinks() {
  const settingsHref = useHref({ to: "/settings" });
  const resolveHref = useHrefResolver();
  return (
    <>
      <a href={settingsHref}>Settings</a>
      <button onClick={() => window.open(resolveHref({ to: "/reports/$reportId", params: { reportId: "42" } }))}>
        Open report
      </button>
    </>
  );
}
```

## Render child pages

In SPA mode, a parent page renders its active child with `Outlet`:

```tsx title="src/pages/teams/page.tsx"
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

Use a directory without `page.*` when descendants should not render inside a
parent page.

## Add layouts and boundaries

Layouts wrap descendant pages:

```text
src/pages/
├── layout.tsx                       # wraps the whole application
├── error.tsx                        # SPA error boundary
├── not-found.tsx                    # SPA not-found boundary
└── admin/
    ├── layout.tsx                   # wraps /admin descendants
    ├── page.tsx
    └── settings/
        └── page.tsx
```

Layouts work in SPA and MPA. `error.*` and `not-found.*` are browser-router
boundaries and therefore SPA-only.

## Navigate

Use standard anchors when a document navigation is intended. For SPA
navigation, use the public helpers:

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

evjs may generate `src/route-types.d.ts` for file routes. Keep it ignored; the
navigation APIs consume the declarations automatically.

## Load route data in CSR pages

CSR SPA pages can export browser route lifecycle functions and components:

```tsx
import { usePageLoaderData } from "@evjs/ev/route";

export async function loader() {
  return { title: "Users" };
}

export default function UsersPage() {
  const data = usePageLoaderData();
  return <h1>{data.title}</h1>;
}
```

Supported lifecycle exports include `loader`, `beforeLoad`, `validateSearch`,
`pendingComponent`, `errorComponent`, and `notFoundComponent`. They run in the
SPA browser route tree. SSR and SSG pages do not use this client loader model;
use [Server Functions](./server-functions) or the appropriate rendering data
flow instead.

## Choose SPA or MPA

The page files do not change when the navigation model changes:

| Capability | SPA | MPA |
| --- | --- | --- |
| Static pages | Yes | Yes |
| Dynamic `$param` routes | Yes | No |
| Terminal `$...splat` | Yes | No |
| Nested layouts | Yes | Yes |
| Error and not-found route boundaries | Yes | No |
| Client-side route navigation | Yes | No browser router |
| Per-page HTML template | For static page output | Yes |

Select MPA in the application config:

```ts title="ev.config.ts"
export default defineConfig({
  routing: { mode: "mpa" },
});
```

MPA creates `/index.html`, `/report.html`, and `/foo/bar.html` for the static
routes `/`, `/report`, and `/foo/bar`. Add `index.html` beside a page to give
that MPA page a custom document template.

## Configure page metadata and rendering

Put static page choices next to the component:

```ts title="src/pages/orders/$orderId/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Order details",
  meta: {
    description: "Review an individual order.",
  },
  render: "csr",
});
```

The deepest active SPA page owns its declared title and named metadata. Route
transitions restore template defaults when the next page does not declare a
value.

See [Rendering](./rendering) for CSR, SSR, SSG, PPR, and RSC, and
[Using Plugins](./plugins) for page-level integration options.

## Use an explicit route tree

`application.routes` is available for intentional programmatic SPA route
trees. It cannot be combined with file-based `routing`, cannot select MPA, and
uses `routes` for nesting. Most applications should prefer the file convention
because it keeps URL ownership beside the page.

See [Custom Routing and Runtimes](./advanced-conventions) for that API.
