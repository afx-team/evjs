# Client Routes

evjs uses file routes as the client-routing source of truth. Application code
lives in `src/pages`; the framework discovers those files and either builds one
TanStack Router-backed SPA or one router-free MPA page per file. evjs does not
write `.evjs` temp route files.

## Project Structure

```
src/
├── api/*.server.ts        # Optional server functions
└── pages/
    ├── __root.tsx         # Optional root layout
    ├── index.tsx          # /
    ├── about.tsx          # /about
    ├── users/$userId.tsx  # /users/$userId
    └── posts/index.tsx    # /posts
```

SPA file routes are enabled automatically when `src/pages` exists and the
default `src/main.tsx` entry does not. To opt in explicitly or customize
discovery:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  fileRoutes: {
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
  fileRoutes: {
    mode: "mpa",
  },
});
```

In MPA mode every discovered page is emitted as an independent HTML document
and client entry. No TanStack Router code is added.

## Pages

Each page module exports a default React component. `definePage()` gives the
component the file-route prop shape without a route-local type declaration:

```tsx
// src/pages/users/$userId.tsx
import { definePage, useQuery } from "@evjs/client";
import { getUser } from "../../api/users.server";

export default definePage(function UserPage({ params }) {
  const { data: user } = useQuery(getUser, params.userId);
  if (!user) return null;
  return <h1>{user.name}</h1>;
});
```

In SPA mode, page modules may export TanStack route options that are useful for
page logic, such as `loader`, `beforeLoad`, `validateSearch`,
`pendingComponent`, `errorComponent`, and `notFoundComponent`. evjs attaches
those exports to the generated internal route. In MPA mode these router options
are ignored; use normal component/data logic in the page.

```tsx
// src/pages/search.tsx
import { definePage } from "@evjs/client";

export const validateSearch = (search: Record<string, unknown>) => ({
  q: typeof search.q === "string" ? search.q : "",
});

export default definePage(function SearchPage({ search }) {
  const q = typeof search.q === "string" ? search.q : "";
  return <h1>Search: {q}</h1>;
});
```

## Layout

For SPA mode, `src/pages/__root.tsx` is optional. When present, its default
export wraps the current page as `children`, so user code does not need TanStack
Router's `<Outlet />`.

```tsx
// src/pages/__root.tsx
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
remain the source of truth; users do not create route objects, route trees, or
global router registrations.

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
discovered file route.
