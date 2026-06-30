# Client Routes

evjs uses `src/pages` as the client-routing source of truth. Application code
lives in page files; the framework discovers those files and either builds one
framework-owned SPA or one router-free MPA page per file. evjs does not write
temporary runtime route files; SPA mode only emits a type declaration such as
`src/route-types.d.ts` so TypeScript can infer navigation paths from the
page tree.

For the complete filename, ignored-file, and layout rules, see
[File Conventions](./file-conventions).

## Project Structure

```
src/
├── apis/*.server.ts       # Optional colocated server functions
├── layout/
│   └── index.tsx          # Optional SPA root layout
└── pages/
    ├── error.tsx           # Optional root SPA error boundary
    ├── not-found.tsx       # Optional root SPA not-found boundary
    ├── index.tsx          # /
    ├── (marketing)/
    │   └── about.tsx      # /about
    ├── users/$userId.tsx  # /users/$userId
    └── posts/
        ├── layout.tsx     # Nested SPA route layout
        └── index.tsx      # /posts
```

The route convention is intentionally narrow:

- Dynamic route segments use `$param` filenames such as `$userId.tsx` or
  `$team_id.tsx`.
- Bracket segments such as `[id].tsx` and `[...slug].tsx` are rejected.
- Catch-all and optional file segments are not part of the convention yet, so
  `$...slug.tsx`, `$slug?.tsx`, and `$.tsx` are rejected.
- Dynamic param names must be JavaScript identifiers after `$`.
- Reserved names such as `$__proto__.tsx`, `$constructor.tsx`,
  `$prototype.tsx`, and `$_splat.tsx` are rejected. `$_splat.tsx` is reserved
  because wildcard routes expose `*` as `_splat`.
- Static route segments must be lowercase and URL-safe: lowercase letters,
  numbers, `.`, `_`, `-`, or `~`.

Use explicit `pages` config when a file needs to map to a custom or
case-sensitive path.

The collision checks are strict:

- A route path must not repeat a dynamic param name, so
  `teams/$teamId/users/$teamId.tsx` is rejected.
- Dynamic sibling routes that only differ by parameter name are rejected.
  `users/$id.tsx` and `users/$userId.tsx` both match `/users/:param`, so keep
  one canonical name or use explicit `pages` config.
- Generated route IDs must be unique. evjs derives IDs from URL paths by
  normalizing separators and punctuation to underscores, so
  `src/pages/admin/panel.tsx` and `src/pages/admin_panel.tsx` are rejected
  together because both produce `admin_panel`.

Route group segments are for organization only:

- `(marketing)/about.tsx` maps to `/about`.
- `(marketing)` does not add a URL segment.
- Malformed group segments such as `(marketing` are rejected.
- Use a real URL segment such as `marketing/about.tsx` when the group name
  should appear in the browser path.

Route discovery treats `.tsx`, `.jsx`, `.ts`, and `.js` files as possible page
modules. It ignores:

- declaration files (`.d.ts`);
- test files (`*.test.*` and `*.spec.*`);
- Storybook files (`*.story.*` and `*.stories.*`);
- `*.client.*` client-only modules;
- `*.server.*` server-only modules;
- hidden dot files and folders;
- files without source extensions;
- files or folders whose route segment starts with `_`.

Use `_`-prefixed files or folders for page-local components, helpers, and
drafts that should not become URLs.

Route order is deterministic in both SPA and MPA mode:

- `/` comes first.
- Parent routes come before child routes.
- Static siblings rank before dynamic siblings, so
  `src/pages/users/settings.tsx` is ordered before
  `src/pages/users/$id.tsx`.

evjs applies the same normalization before build output is generated. Duplicate
paths, dynamic URL shapes, and route IDs are rejected there too.

`routing.routes` is not a public `defineConfig()` field. Applications should use
`src/pages` discovery or explicit `pages` config. Runtime route matching also
uses specificity, so exact/static routes win over dynamic routes.

Every discovered page file must default-export a React component. Layout route
files can default-export a wrapper component; when they do not, they behave as
pathless outlet routes. Syntax and default-export errors are reported during
route discovery before the bundler runs.

SPA routing is enabled automatically when `src/pages` exists and the project
does not declare explicit `app` or `pages` config. To opt in
explicitly or customize discovery:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
    dir: "./src/pages",
    mount: "#app",
  },
});
```

For an MPA, use the same page files and switch the output mode:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

In MPA mode every discovered CSR page is emitted as an independent HTML document
and client entry. File-route pages that export `render = "ssg"` are rendered
during `ev build` into independent static HTML documents; by default they do
not create a browser page entry. No client router setup is added. A file-route
page can use a page-specific HTML template by placing an `.html` file with the
same basename beside the page module, such as
`src/pages/about.html` for `src/pages/about.tsx` or
`src/pages/product/index.html` for `src/pages/product/index.tsx`; routes
without one use the global `index.html` template by default.

## Pages

Each page module exports a default React component. Use the page hooks when
page logic needs the current route params, search params, or loader data:

```tsx
// src/pages/users/$userId.tsx
import { usePageParams } from "@evjs/ev/route";
import { useQuery } from "@evjs/ev/query";
import { getUser } from "../../apis/users.server";

export default function UserPage() {
  const { userId } = usePageParams();
  const { data: user } = useQuery(getUser, userId);
  if (!user) return null;
  return <h1>{user.name}</h1>;
}
```

Use page hooks for route data in both SPA and MPA mode. They keep page modules
free of framework wrapper types and avoid prop annotations. evjs does not pass
`params`, `search`, or `loaderData` as page component props. File routes derive
params from `$param` segments; explicit `pages` config can use `:param` segments.
Reserved, empty, and duplicate param names are rejected.

In SPA projects with generated route types, page hooks can take a literal route
path for route-specific inference without importing the generated declaration:

```tsx
import {
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "@evjs/ev/route";

export const validateSearch = (search: Record<string, unknown>) => ({
  tab: typeof search.tab === "string" ? search.tab : "overview",
});

export async function loader() {
  return { title: "Post" };
}

export default function PostPage() {
  const params = usePageParams("/posts/$postId");
  const search = usePageSearch("/posts/$postId");
  const post = usePageLoaderData("/posts/$postId");
  return <h1>{post.title}: {params.postId} ({search.tab})</h1>;
}
```

In SPA mode, page modules may export page lifecycle hooks that are useful for
page logic, such as `loader`, `beforeLoad`, `validateSearch`,
`pendingComponent`, `errorComponent`, and `notFoundComponent`. evjs attaches
those exports to the evjs-managed route. In MPA mode these lifecycle hooks
are ignored; use normal component/data logic in the page.

SPA mode also recognizes dedicated route convention modules:

- `error.*` and `not-found.*` modules default-export fallback components for
  their route directory scope and descendants.
- In MPA mode `error.*` and `not-found.*` filenames remain ordinary page routes.

```tsx
// src/pages/search.tsx
import { usePageSearch } from "@evjs/ev/route";

export const validateSearch = (search: Record<string, unknown>) => ({
  q: typeof search.q === "string" ? search.q : "",
});

export default function SearchPage() {
  const search = usePageSearch();
  const q = typeof search.q === "string" ? search.q : "";
  return <h1>Search: {q}</h1>;
}
```

## Layout

For SPA mode, the external root layout is optional. Automatic discovery has one
file convention: `layout/index.tsx` beside the route directory. The default
`src/pages` route directory uses `src/layout/index.tsx`; a custom
`routing.dir: "./src/app/pages"` uses `src/app/layout/index.tsx`. When present,
the default export wraps the entire generated route tree as `children`, so user
code does not need a router outlet component at the app root.

Use `routing.conventions.layout: "./src/shell/AppLayout.tsx"` only when the
shell intentionally lives outside the convention path. Set
`routing.conventions.layout: false` when the SPA should not consume any
external framework root layout. Root layout aliases such as `src/layout.tsx`
are rejected by automatic discovery.

SPA route layouts can also live inside the route directory:

- use `layout.tsx`, `layout.jsx`, `layout.ts`, or `layout.js` below a route
  segment;
- `src/pages/posts/layout.tsx` wraps routes below `/posts`;
- `src/pages/(app)/dashboard/layout.tsx` creates a layout at `/dashboard`
  without adding `(app)` to the URL.

Nested route layouts can coexist with an external root layout. This remains
true when `routing.conventions.layout` points at an explicit module, or when
external root layout discovery is disabled with `routing.conventions.layout:
false`. `src/pages/layout.tsx` is not a root layout convention; use
`src/layout/index.tsx` for the app shell.

The layout conventions are SPA-only. MPA mode does not accept
`routing.conventions.layout` or consume framework layouts; share visual
wrappers by importing ordinary components from each page, or share the HTML
template when only document chrome is common.

A route-directory segment named `layout` is reserved and `layout/index.*`
aliases are rejected. Put layout-local helpers under underscore-prefixed files
or folders. Uppercase filenames such as `Layout.tsx` still fail the lowercase
static segment rule in discovered routes.

```tsx
// src/layout/index.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
      {children}
    </main>
  );
}
```

## Navigation

Navigation can use ordinary anchors or `Link` from `@evjs/ev/route`. Route files
remain the source of truth, and navigation helpers use the same file-path
convention for paths and params.

During `ev dev` and `ev build`, SPA routing writes the generated declaration
`src/route-types.d.ts` for the default `src/pages` route directory. A
custom `routing.dir` writes the same file name beside that route directory's
parent. That file augments the `@evjs/ev/route` route register used by
`Link`, `useLinkProps`, `redirect`, and related helpers.
It is type-only; application code should not import it or write framework
router bootstraps manually.

The declaration preserves each route's literal path for navigation types. Keep
the generated file in source control ignores and let evjs update it.

Make sure the generated declaration is inside your `tsconfig.json` `include`.
The default `include: ["src"]` works for `src/pages` and custom directories
under `src`, such as `src/app/pages`. If you place routes outside `src`, include
that route directory's parent as well.

```tsx
import { Link } from "@evjs/ev/navigation";

export default function HomePage() {
  return (
    <Link to="/users/$userId" params={{ userId: "1" }}>
      Open user
    </Link>
  );
}
```

## Rendering Metadata

Page modules can continue to own rendering metadata:

```tsx
export const render = "ssr";
export const hydrate = "load";
export const prerender = { partial: true } as const;

export default function CampaignPage() {
  return <main>Campaign</main>;
}
```

evjs reads that metadata from the page module during build. `render` and
`hydrate` must be string literals, `prerender` must be `true` or an object
literal with `partial`, `delivery`, or `revalidate`, `prerender.revalidate` must
be `false` or a positive integer number of seconds, and `rsc` must be a boolean
literal. Full prerendering (`prerender = true` or non-partial prerender objects)
must declare `render = "ssg"` or `render = "ssr"`. Partial prerendering must
declare `render = "ssr"`.

Use `export const rsc = true` only for RSC pages that also declare
`render = "ssr"` and omit `hydrate` or declare `hydrate = "none"`. RSC pages
cannot also use partial prerendering yet; choose one rendering model per route
or split them into separate routes. `rsc = false` has no effect and produces a
warning; remove it unless you are enabling RSC with `true`. Export each metadata
name only once; duplicate `render`, `hydrate`, `prerender`, or `rsc` exports are
rejected instead of using source order.
