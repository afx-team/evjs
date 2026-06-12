# Client Routes

evjs uses `src/pages` as the client-routing source of truth. Application code
lives in page files; the framework discovers those files and either builds one
framework-owned SPA or one router-free MPA page per file. evjs does not write
`.evjs` temp route files.

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

evjs also passes the same `params`, `search`, and `loaderData` values to the
page component as props in both SPA and MPA mode. Hooks are the recommended
zero-annotation path for page code.

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

For SPA mode, `src/layout.tsx` is optional. When present, its default
export wraps the current page as `children`, so user code does not need a router
outlet component.

The layout convention is SPA-only and has exactly one root file:
`src/layout.tsx`. `src/layout/index.tsx` is not an alias. MPA mode does not
consume a framework layout file; share visual wrappers by importing ordinary
components from each page.

`src/pages` is only for route pages. Do not put `layout.tsx` anywhere under
`src/pages`; evjs reports that as a convention error instead of turning it into
a route. Nested visual wrappers should be normal components imported by the
page that needs them.

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
