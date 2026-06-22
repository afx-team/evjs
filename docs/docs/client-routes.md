# Client Routes

evjs uses `src/pages` as the client-routing source of truth. Application code
lives in page files; the framework discovers those files and either builds one
framework-owned SPA or one router-free MPA page per file. evjs does not write
temporary runtime route files; SPA mode only emits a type declaration such as
`src/evjs-route-types.d.ts` so TypeScript can infer navigation paths from the
page tree.

## Project Structure

```
src/
├── api/*.server.ts        # Optional server functions
├── layout/
│   └── index.tsx          # Optional SPA root layout
└── pages/
    ├── layout.tsx         # Optional SPA route layout
    ├── index.tsx          # /
    ├── (marketing)/
    │   └── about.tsx      # /about
    ├── users/$userId.tsx  # /users/$userId
    └── posts/index.tsx    # /posts
```

Dynamic route segments use `$param` filenames. Bracket segments such as
`[id].tsx` or `[...slug].tsx` are rejected so the file convention stays
unambiguous. Catch-all and optional segments are not part of the page route
convention yet, so `$...slug.tsx`, `$slug?.tsx`, and `$.tsx` are also rejected.
Dynamic param names must be JavaScript identifiers after `$`, such as
`$userId.tsx` or `$team_id.tsx`, but reserved object-property names such as
`$__proto__.tsx`, `$constructor.tsx`, and `$prototype.tsx` are rejected.
`$_splat.tsx` is also reserved because wildcard routes expose `*` as `_splat`.
Static route segments must be lowercase and URL-safe: lowercase letters,
numbers, `.`, `_`, `-`, or `~`; use explicit `pages` config when a file needs
to map to a custom or case-sensitive path. A route path must not repeat a
dynamic param name, so `teams/$teamId/users/$teamId.tsx` is rejected.
Dynamic sibling routes that only differ by parameter name are also rejected:
`users/$id.tsx` and `users/$userId.tsx` both match `/users/:param`, so keep one
canonical name or use explicit `pages` config.

Route group segments such as `(marketing)/about.tsx` are supported as pathless
organization. They do not add URL segments, so that file maps to `/about`.
Malformed group segments such as `(marketing` are rejected. Use a real URL
segment such as `marketing/about.tsx` when the group name should appear in the
browser path, or use explicit `pages` config when a file should map to a URL
that does not follow the directory shape.

Route discovery treats `.tsx`, `.jsx`, `.ts`, and `.js` files as possible page
modules. Declaration files (`.d.ts`), test files (`*.test.*` and `*.spec.*`),
Storybook files (`*.story.*` and `*.stories.*`), `*.client.*` client-only
modules, `*.server.*` server-only modules, hidden dot files/folders, and files
without those source extensions are ignored.

Files or folders whose route segment starts with `_` are private to `src/pages`.
They can use source extensions, but they are ignored as URL routes. Use them for
page-local components, helpers, or drafts that should not become URLs.

Route order is deterministic in both SPA and MPA mode: `/` comes first, parent
routes come before child routes, and static siblings rank before dynamic
siblings. For example, `src/pages/users/settings.tsx` is ordered before
`src/pages/users/$id.tsx`. The resolved route list used by graph and build-plan
generation is normalized with the same rule, and duplicate paths, dynamic URL
shapes, or route IDs are rejected there too. `routing.routes` is not a public
`defineConfig()` field; applications should use `src/pages` discovery or
explicit `pages` config. Runtime route matching also uses specificity, so
exact/static routes win over dynamic or wildcard routes even if an external
manifest is not already sorted.

Generated route IDs must be unique. evjs derives IDs from URL paths by
normalizing separators and punctuation to underscores, so routes such as
`src/pages/admin/panel.tsx` and `src/pages/admin_panel.tsx` are rejected
together because both produce `admin_panel`. Server-rendered route-derived page
IDs use the same rule. When generated IDs collide, rename one route file or move
the page to explicit `pages` config with a unique page id.

Every discovered page file must default-export a React component. Layout route
files can default-export a wrapper component; when they do not, they behave as
pathless outlet routes. If a module under `src/pages` is not a route page or
layout, put it in an underscore-prefixed file or folder, name it `*.client.*`
for client-only code, name it `*.server.*` for server-only code, or move it
outside `src/pages`. Syntax and default-export errors are reported during route
discovery before the bundler runs.

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
and client entry. File-route pages that export `render = "ssg"` emit an
independent static HTML document and a server renderer for static generation; by
default they do not create a browser page entry. No client router setup is
added.

## Pages

Each page module exports a default React component. Use the page hooks when
page logic needs the current route params, search params, or loader data:

```tsx
// src/pages/users/$userId.tsx
import { usePageParams, useQuery } from "@evjs/client";
import { getUser } from "../../api/users.server";

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
params from `$param` segments; lower-level explicit manifest routes can also use
`:param` segments, and wildcard `*` segments are exposed as `_splat`. Empty
param names, reserved object-property names, explicit `:_splat` params, and
duplicate param names are rejected there too. A route path can contain at most
one wildcard segment because there is only one `_splat` value. The same hooks
expose those names.

In SPA projects with generated route types, page hooks can take a literal route
path for route-specific inference without importing the generated declaration:

```tsx
import { usePageLoaderData, usePageParams, usePageSearch } from "@evjs/client";

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
those exports to the framework-managed route. In MPA mode these lifecycle hooks
are ignored; use normal component/data logic in the page.

```tsx
// src/pages/search.tsx
import { usePageSearch } from "@evjs/client";

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

For SPA mode, the external root layout is optional. It lives beside the route
directory: the default `src/pages` can use `src/layout.tsx`,
`src/layout/index.tsx`, or the matching `.ts`, `.jsx`, and `.js` source module
variants. A custom `routing.dir` such as `src/app/pages` uses the same
`layout.*` or `layout/index.*` convention under `src/app`. When present, the
default export wraps the entire generated route tree as `children`, so user code
does not need a router outlet component at the app root.

Keep one auto-discovered external root layout module. If multiple candidates
exist, evjs reports an ambiguity and asks you to keep one file or configure the
shell explicitly with `routing.layout: "./src/shell/AppLayout.tsx"`. Set
`routing.layout: false` when the SPA should not consume any external framework
root layout.

SPA route layouts can also live inside the route directory. Use `layout.tsx`,
`layout.jsx`, `layout.ts`, `layout.js`, or `layout/index.*` beside the pages
they should wrap. `src/pages/layout.tsx` wraps root-level page routes;
`src/pages/posts/layout.tsx` wraps routes below `/posts`; and
`src/pages/(app)/dashboard/layout.tsx` creates a layout at `/dashboard` without
adding `(app)` to the URL. These route-directory layouts can coexist with an
external root layout. This remains true when `routing.layout` points at an explicit module.
It also remains true when external root layout discovery is disabled with
`routing.layout: false`.

The layout conventions are SPA-only. MPA mode does not accept `routing.layout`
or consume framework layouts; share visual wrappers by importing ordinary
components from each page, or share the HTML template when only document chrome
is common.

A route-directory segment named `layout` is reserved for layout modules named
`layout.{ts,tsx,js,jsx}` or `layout/index.{ts,tsx,js,jsx}`. Put layout-local
helpers under underscore-prefixed files or folders. Uppercase filenames such as
`Layout.tsx` still fail the lowercase static segment rule in discovered routes.

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

Navigation can use ordinary anchors or `Link` from `@evjs/client`. Route files
remain the source of truth, and navigation helpers use the same file-path
convention for paths and params.

During `ev dev` and `ev build`, SPA routing writes the generated declaration
`src/evjs-route-types.d.ts` for the default `src/pages` route directory. A
custom `routing.dir` writes the same file name beside that route directory's
parent. That file augments the underlying `@evjs/client` route register used by
the `@evjs/client` `Link`, `useLinkProps`, `redirect`, and related helpers.
It is type-only; application code should not import it or write framework
router bootstraps manually.

The generated file imports its type helper from
`@evjs/client/internal/route-types`, a generated-only internal subpath. Do not
import that internal helper from application source.

The declaration preserves each route's literal ID and path for navigation
types. Its internal TypeScript identifiers are de-duplicated automatically, so
valid route IDs such as `admin-panel` and `admin_panel` cannot generate invalid
or duplicate declarations.

Make sure the generated declaration is inside your `tsconfig.json` `include`.
The default `include: ["src"]` works for `src/pages` and custom directories
under `src`, such as `src/app/pages`. If you place routes outside `src`, include
that route directory's parent as well.

```tsx
import { Link } from "@evjs/client";

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

The build graph reads that metadata from the page module and links it to the
discovered route. `render` and `hydrate` must be string literals, `prerender`
must be `true` or an object literal with `partial`, `delivery`, or
`revalidate`, `prerender.revalidate` must be `false` or a positive integer
number of seconds, and `rsc` must be a boolean literal. Full prerendering
(`prerender = true` or non-partial prerender objects) must declare
`render = "ssg"` or `render = "ssr"`. Partial prerendering must declare
`render = "ssr"`.

Use `export const rsc = true` only for RSC pages that also declare
`render = "ssr"` and omit `hydrate` or declare `hydrate = "none"`. RSC pages
cannot also use partial prerendering yet; choose one rendering model per route
or split them into separate routes. `rsc = false` has no effect and produces a
warning; remove it unless you are enabling RSC with `true`. Export each metadata
name only once; duplicate `render`, `hydrate`, `prerender`, or `rsc` exports are
rejected instead of using source order.
