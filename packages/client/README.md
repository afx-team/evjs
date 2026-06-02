# @evjs/client

> Client-side runtime for the **evjs** fullstack framework.

## Features

- **Type-Safe Routing** — Re-exports [TanStack Router](https://tanstack.com/router) with custom `createApp` integration.
- **TanStack-Free App Option** — Applications can use explicit pages, the static route DSL, and framework-managed page/runtime APIs without using TanStack Router.
- **Data Fetching** — Re-exports [TanStack Query](https://tanstack.com/query) with built-in server function proxies.
- **Server Function Support** — `useQuery(fn)` and `useMutation(fn)` for zero-boilerplate RPC.
- **Unified Bootstrap** — `createApp({ routeTree }).render("#app")`.
- **Single Client Entry Point** — Shell, page runtime, React page runtime, static route DSL, transport, and TanStack compatibility helpers are all exported from `@evjs/client`.

## Install

```bash
npm install @evjs/client react react-dom
```

## Quick Start

### 1. Define Routes

```tsx
// src/routes.tsx
import {
  createAppRootRoute,
  createRoute,
  Outlet,
} from "@evjs/client";

export const rootRoute = createAppRootRoute({
  component: () => (
    <div>
      <h1>My App</h1>
      <Outlet />
    </div>
  ),
});

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/", // Must be a string literal!
  component: () => <div>Hello World</div>,
});

export const routeTree = rootRoute.addChildren([indexRoute]);
```

### 2. Bootstrap App

```tsx
// src/main.tsx
import { createApp } from "@evjs/client";
import { routeTree } from "./routes";

const app = createApp({ routeTree });
app.render("#app");
```

## Server Functions

Use the `"use server"` directive in `*.server.ts` files. `@evjs/client` provides hooks to call them:

```tsx
import { useQuery } from "@evjs/client";
import { getPosts } from "./api/posts.server";

function Posts() {
  const { data } = useQuery(getPosts);
  return <ul>{data?.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
}
```

## API

### Routing
- `createApp`: Create the main application instance.
- `createRoute`, `createAppRootRoute`, `Link`, `Outlet`, `useNavigate`, `useParams`, and `useSearch`: TanStack Router compatibility exports kept at the top-level entry for existing applications.
- TanStack compatibility exports and adapter helpers are available from the top-level `@evjs/client` entry.

### Query
- `useQuery(fn, args?)`: Wrapper around `useSuspenseQuery`.
- `useMutation(fn)`: Wrapper around `useMutation`.
- `getFnQueryKey(fn, args?)`: Generate stable query keys for server functions.
- `getFnQueryOptions(fn, args?)`: Generate options for manual `queryClient` usage.

### Transport
- `initTransport({ baseUrl, credentials, headers })`: Configure the default HTTP adapter. The server function path is derived from the framework server runtime.
- `credentials` / `headers`: Supported HTTP defaults; fetch `mode` is intentionally not configurable.
- `initTransport({ adapter })`: Replace transport behavior with a custom adapter.

### Runtime
- `createShell()`, `createPageDriver()`, and `createHistoryDriver()`: Manifest-driven shell APIs.
- `startPageRuntime()`: Generic framework-managed page runtime.
- `createReactPageModule()` and `mountReactPage()`: React page runtime adapter used by component pages.
- `defineReactRoutes()`, `page()`, and `route()`: React static route declaration DSL.
- `createTanStackDriver()`, `defineTanStackRoutes()`, and `withRouteMeta()`: TanStack compatibility helpers.

All client runtime APIs are exported from `@evjs/client`.

## License

MIT
