# Routing

## Overview

evjs routing is built on **TanStack Router**. All routing APIs are re-exported from `@evjs/client` — never import from `@tanstack/react-router` directly.

## Project Structure

```
src/
├── main.tsx              ← Entry point: build route tree, createApp, register types
├── api/*.server.ts       ← Server functions
└── pages/
    ├── __root.tsx         ← Root layout (nav + <Outlet />)
    ├── home.tsx           ← Static route
    ├── user.tsx           ← Dynamic route (/users/$username)
    ├── posts/index.tsx    ← Nested routes with layout
    ├── dashboard.tsx      ← Pathless layout
    ├── search.tsx         ← Search param validation
    └── catch.tsx          ← Redirects & 404 catch-all
```

## Entry Point Setup

```tsx
// src/main.tsx
import { createApp } from "@evjs/client";
import { rootRoute } from "./pages/__root";
import { homeRoute } from "./pages/home";
import { postsRoute, postsIndexRoute, postDetailRoute } from "./pages/posts";

const routeTree = rootRoute.addChildren([
  homeRoute,
  postsRoute.addChildren([postsIndexRoute, postDetailRoute]),
]);

const app = createApp({ routeTree });

// Required for full type-safety on useParams, useSearch, Link, etc.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
```

## Root Layout

Every app needs a root route with `<Outlet />` to render child routes.

```tsx
import { createAppRootRoute, Link, Outlet } from "@evjs/client";

function RootLayout() {
  return (
    <div>
      <nav>
        <Link to="/" activeProps={{ style: { fontWeight: 600 } }}>Home</Link>
        <Link to="/posts" activeProps={{ style: { fontWeight: 600 } }}>Posts</Link>
      </nav>
      <Outlet />
    </div>
  );
}

export const rootRoute = createAppRootRoute({ component: RootLayout });
```

## Static Routes

```tsx
import { createRoute } from "@evjs/client";
import { rootRoute } from "./__root";

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <h1>Home</h1>,
});
```

## Dynamic Routes (`$param`)

Use `$name` syntax for path parameters. Access them type-safely via `route.useParams()`.

```tsx
import { createRoute, getFnQueryOptions, useQuery } from "@evjs/client";
import { getUser } from "../api/data.server";
import { rootRoute } from "./__root";

function UserProfile() {
  const { username } = userRoute.useParams(); // { username: string }
  const { data } = useQuery(getUser, username);
  return <h2>{data?.name}</h2>;
}

export const userRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users/$username",
  loader: ({ params, context }) =>
    context.queryClient.ensureQueryData(
      getFnQueryOptions(getUser, params.username),
    ),
  component: UserProfile,
});
```

## Nested Routes (Layout + Children)

Parent routes render `<Outlet />` to display child routes. Wire children via `addChildren()` in `main.tsx`.

```tsx
// pages/posts/index.tsx
import { createRoute, Link, Outlet, getFnQueryOptions } from "@evjs/client";
import { getPosts, getPost } from "../../api/data.server";
import { rootRoute } from "../__root";

// Layout route: /posts
export const postsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/posts",
  component: () => (
    <div style={{ display: "flex" }}>
      <nav>{ /* sidebar */ }</nav>
      <Outlet />
    </div>
  ),
});

// Index route: /posts/ (shown when no child matches)
export const postsIndexRoute = createRoute({
  getParentRoute: () => postsRoute,
  path: "/",
  component: () => <p>Select a post</p>,
});

// Detail route: /posts/$postId
export const postDetailRoute = createRoute({
  getParentRoute: () => postsRoute,
  path: "$postId",
  loader: ({ params, context }) =>
    context.queryClient.ensureQueryData(
      getFnQueryOptions(getPost, params.postId),
    ),
  component: PostDetail,
});
```

## Pathless Layouts

Use `id` instead of `path` for shared UI that doesn't add a URL segment.

```tsx
export const dashboardLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "dashboard-layout",
  component: () => <div className="layout"><Outlet /></div>,
});

export const dashboardRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/dashboard",
  component: Dashboard,
});

// main.tsx: dashboardLayout.addChildren([dashboardRoute])
```

## Search Parameters

Use `validateSearch` to define typed query string parameters.

```tsx
export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || "",
    page: Number(search.page) || 1,
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q, page } = searchRoute.useSearch(); // { q: string, page: number }
}
```

Navigate with search params:

```tsx
<Link to="/search" search={{ q: "hello" }}>Search</Link>
```

## Route Loaders (Prefetching)

Use `loader` to prefetch data before the route renders — eliminates loading spinners.

```tsx
export const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(getFnQueryOptions(getUsers)),
  component: UsersPage,
});
```

## Redirects

Throw `redirect()` in `beforeLoad` to redirect before rendering.

```tsx
import { createRoute, redirect } from "@evjs/client";

export const redirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/old-blog",
  beforeLoad: () => {
    throw redirect({ to: "/posts" });
  },
});
```

## 404 Catch-All

Use `path: "*"` to catch all unmatched URLs.

```tsx
export const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: () => <h1>404 — Page not found</h1>,
});
```

## Navigation

```tsx
import { Link, useNavigate, Navigate } from "@evjs/client";

// Declarative
<Link to="/posts/$postId" params={{ postId: "1" }}>View</Link>

// Imperative
const navigate = useNavigate();
navigate({ to: "/posts" });

// Redirect component
<Navigate to="/login" />
```

## Available Re-exports

All from `@evjs/client`:

| Category | APIs |
|----------|------|
| **Route creation** | `createAppRootRoute`, `createRoute`, `createRouter`, `createRootRouteWithContext`, `createRouteMask` |
| **Components** | `Link`, `Outlet`, `Navigate`, `RouterProvider`, `ErrorComponent`, `CatchBoundary`, `CatchNotFound` |
| **Hooks** | `useParams`, `useSearch`, `useNavigate`, `useLocation`, `useMatch`, `useMatchRoute`, `useRouter`, `useRouterState`, `useLoaderData`, `useLoaderDeps`, `useRouteContext`, `useBlocker`, `useCanGoBack` |
| **Utilities** | `redirect`, `notFound`, `isRedirect`, `isNotFound`, `getRouteApi`, `linkOptions`, `lazyRouteComponent`, `createLink` |
