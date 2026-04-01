# @evjs/client

> Client-side runtime for the **evjs** fullstack framework.

## Features

- **Type-Safe Routing** — Re-exports [TanStack Router](https://tanstack.com/router) with custom `createApp` integration.
- **Data Fetching** — Re-exports [TanStack Query](https://tanstack.com/query) with built-in server function proxies.
- **Server Function Support** — `useQuery(fn)` and `useMutation(fn)` for zero-boilerplate RPC.
- **Unified Bootstrap** — `createApp({ routeTree }).render("#app")`.

## Install

```bash
npm install @evjs/client react react-dom
```

## Quick Start

### 1. Define Routes

```tsx
// src/routes.tsx
import { createRoute, createAppRootRoute, Outlet } from "@evjs/client";

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
- `createRoute`: Define a route (enforces string literal paths).
- `createAppRootRoute`: Define the root layout.
- `Link`, `Outlet`, `useNavigate`, `useParams`, `useSearch`: Standard TanStack Router components/hooks.

### Query
- `useQuery(fn, args?)`: Wrapper around `useSuspenseQuery`.
- `useMutation(fn)`: Wrapper around `useMutation`.
- `getFnQueryKey(fn, args?)`: Generate 1stable query keys for server functions.
- `getFnQueryOptions(fn, args?)`: Generate options for manual `queryClient` usage.

### Transport
- `initTransport({ baseUrl, endpoint })`: Configure the API endpoint for server functions.

## License

MIT
