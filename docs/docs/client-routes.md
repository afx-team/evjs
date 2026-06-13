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
├── layout.tsx             # Optional SPA root layout
└── pages/
    ├── index.tsx          # /
    ├── about.tsx          # /about
    ├── users/$userId.tsx  # /users/$userId
    └── posts/index.tsx    # /posts
```

Dynamic route segments use `$param` filenames. Bracket segments such as
`[id].tsx` or `[...slug].tsx` are rejected so the file convention stays
unambiguous.

Files or folders whose route segment starts with `_` are private to `src/pages`
and are ignored by route discovery. Use them for page-local components, helpers,
or drafts that should not become URLs.

Every discovered route file must default-export a React component. If a module
under `src/pages` is not a route page, put it in an underscore-prefixed file or
folder, or move it outside `src/pages`. Syntax and default-export errors are
reported during route discovery before the bundler runs.

SPA routing is enabled automatically when `src/pages` exists and the project
does not declare explicit `app`, `pages`, or `remote` config. To opt in
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

In MPA mode every discovered page is emitted as an independent HTML document
and client entry. No client router setup is added.

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
`params`, `search`, or `loaderData` as page component props.

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

For SPA mode, the root layout is optional. It lives beside the route directory:
the default `src/pages` uses `src/layout.tsx`, and a custom `routing.dir` such
as `src/app/pages` uses `src/app/layout.tsx`. When present, the default export
wraps the current page as `children`, so user code does not need a router outlet
component.

The layout convention is SPA-only and has exactly one root file beside the route
directory: use the exact filename `layout.tsx`. `layout.jsx`, `layout.ts`, and
`layout/index.*` are not aliases. MPA mode does not consume a framework layout
file; share visual wrappers by importing ordinary components from each page.

The route directory is only for route pages. Do not put files or folders named
`layout` under it; evjs reports that as a convention error instead of turning
them into routes. Nested visual wrappers should be normal components imported by
the page that needs them.

```tsx
// src/layout.tsx
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
parent. That file augments `@evjs/client` types for `Link`, `useLinkProps`,
`redirect`, and related helpers. It is type-only; application code should not
import it or write TanStack route trees manually.

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
discovered route.
