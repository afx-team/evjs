# Client Routes
evjs routing is built on [TanStack Router](https://tanstack.com/router). All routing APIs are re-exported from `@evjs/client` — never import from `@tanstack/react-router` directly.

:::important
**Route paths must be string literals.** The `path` property only accepts string literal types — passing a `string` variable or template string will produce a TypeScript compile error. This is enforced by the type system to ensure routes are statically analyzable.

```ts
// ✅ Good — string literal
createRoute({ path: "/users/$id", ... });

// ❌ Compile error — broad `string` type
const p: string = "/users";
createRoute({ path: p, ... });

// ❌ Compile error — template string
createRoute({ path: `/users/${segment}`, ... });
```
:::

## Project Structure

```
src/
├── main.tsx              ← Entry: build route tree, createApp, register types
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
declare module "@evjs/client" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
```

### Runtime Router Options

Pass router runtime options to `createApp()` when bootstrapping the client.
The `router` field accepts TanStack Router options, except for `routeTree` and
`context`, which evjs owns. For example, pass through TanStack Router's native
global catch boundary opt-out, preload policy, route masks, URL rewrites,
search serialization, and navigation lifecycle subscriptions:

```tsx
import { composeRewrites } from "@evjs/client";

const localeRewrite = {
  input: ({ url }: { url: URL }) => {
    url.pathname = url.pathname.replace(/^\/en(?=\/|$)/, "") || "/";
    return url;
  },
  output: ({ url }: { url: URL }) => {
    url.pathname = `/en${url.pathname === "/" ? "" : url.pathname}`;
    return url;
  },
};

const app = createApp({
  routeTree,
  router: {
    disableGlobalCatchBoundary: true,
    defaultPreload: "intent",
    defaultPendingMs: 300,
    rewrite: composeRewrites([localeRewrite]),
  },
});
```

Subscribe to router events when you need analytics, tracing, or route-level
performance marks:

```tsx
const unsubscribe = app.router.subscribe("onResolved", (event) => {
  console.info("navigated", event.toLocation.href);
});

// call unsubscribe() during teardown if you register listeners manually
```

evjs sets `routeTree`, injects the router `context.queryClient`, and defaults
`defaultPreload` to `"intent"` when you do not provide one. Other TanStack
Router options stay transparent under `router`.

## Root Layout

Every app needs a root route with `<Outlet />` to render child routes:

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

Use `$name` syntax for path parameters. Access them type-safely via `route.useParams()`:

```tsx
import { createRoute, useQuery } from "@evjs/client";
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

Parent routes render `<Outlet />` to display child routes. Wire children via `addChildren()` in `main.tsx`:

```tsx
// pages/posts/index.tsx
import { createRoute, Link, Outlet } from "@evjs/client";
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

Use `id` instead of `path` for shared UI that doesn't add a URL segment:

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

Use `validateSearch` to define typed query string parameters:

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

Use search middlewares for shared query string behavior such as retaining or
stripping keys across navigation:

```tsx
import { retainSearchParams, stripSearchParams } from "@evjs/client";

export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || "",
    debug: search.debug === "true",
  }),
  search: {
    middlewares: [retainSearchParams(["q"]), stripSearchParams(["debug"])],
  },
});
```

## Route-Level Code Splitting

Code-based routes can split non-critical route UI with `.lazy()`. Keep route
matching, loaders, and parent wiring in the critical route file; move
`component`, `pendingComponent`, `errorComponent`, and heavier UI dependencies
into a lazy route module.

```tsx
// src/routes/posts.tsx
import { createRoute } from "@evjs/client/route";
import { rootRoute } from "./__root";

export const postsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/posts",
  loader: ({ context }) => context.queryClient.ensureQueryData(postsQuery),
}).lazy(() => import("./posts.lazy").then((m) => m.Route));
```

```tsx
// src/routes/posts.lazy.tsx
import { createLazyRoute, getRouteApi } from "@evjs/client/route";

const route = getRouteApi("/posts");

function PostsPage() {
  const data = route.useLoaderData();
  return <h2>{data.title}</h2>;
}

export const Route = createLazyRoute("/posts")({
  component: PostsPage,
});
```

When SSR is enabled, evjs uses the client manifest to preload only the lazy
assets for the matched routes. The root layout and route shell remain in the
entry bundle so the router can match and hydrate the document.

During hydration, evjs reports React recoverable hydration errors through
`createApp({ onHydrationError })`. If router hydration fails before the
document can be attached, evjs clears the router SSR state and falls back to the
normal client render path.

## Route Loaders (Prefetching)

Use `loader` to prefetch data before the route renders — eliminates loading spinners:

```tsx
export const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  staleTime: 30_000,
  preloadStaleTime: 10_000,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(getFnQueryOptions(getUsers)),
  component: UsersPage,
});
```

## Redirects

Throw `redirect()` in `beforeLoad` to redirect before rendering:

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

Use `path: "*"` to catch all unmatched URLs:

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

## Route Masks

Route masks let one internal route render while the browser shows another URL.
They are useful for modal routes and detail overlays:

```tsx
import { Link, createRouteMask } from "@evjs/client";

const postModalMask = createRouteMask({
  routeTree,
  from: "/posts",
  to: "/posts/$postId",
  params: { postId: "123" },
});

const app = createApp({
  routeTree,
  router: { routeMasks: [postModalMask] },
});

<Link
  to="/posts/$postId"
  params={{ postId: "123" }}
  mask={{ to: "/posts" }}
>
  Open modal
</Link>;
```

## Available Re-exports

All imported from `@evjs/client`:

| Category | APIs |
|----------|------|
| **Route creation** | `createAppRootRoute`, `createRoute`, `createLazyRoute`, `createRouter`, `createRootRouteWithContext`, `createRouteMask` |
| **Components** | `Link`, `Outlet`, `Navigate`, `RouterProvider`, `RouterContextProvider`, `ErrorComponent`, `CatchBoundary`, `CatchNotFound`, `Await`, `ClientOnly`, `Match`, `Matches`, `MatchRoute`, `ScrollRestoration`, `Block` |
| **Hooks** | `useParams`, `useSearch`, `useNavigate`, `useLocation`, `useMatch`, `useMatchRoute`, `useMatches`, `useParentMatches`, `useChildMatches`, `useRouter`, `useRouterState`, `useLoaderData`, `useLoaderDeps`, `useRouteContext`, `useLinkProps`, `useBlocker`, `useCanGoBack`, `useAwaited`, `useHydrated`, `useElementScrollRestoration` |
| **Utilities** | `redirect`, `notFound`, `isRedirect`, `isNotFound`, `getRouteApi`, `RouteApi`, `linkOptions`, `lazyRouteComponent`, `createLink`, `defer`, `retainSearchParams`, `stripSearchParams`, `composeRewrites`, `defaultParseSearch`, `defaultStringifySearch`, `parseSearchWith`, `stringifySearchWith` |
| **History** | `createBrowserHistory`, `createHashHistory`, `createMemoryHistory` |
