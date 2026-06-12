# @evjs/client

> Client-side runtime for the **evjs** fullstack framework.

## Features

- **Page Hooks** — `usePageParams()`, `usePageSearch()`, and `usePageLoaderData()` expose framework-managed route data while evjs owns route discovery.
- **SPA Navigation** — SPA pages use [TanStack Router](https://tanstack.com/router) internally while page code uses evjs page hooks and navigation helpers.
- **Router-Free Pages** — MPA and framework-managed pages use the page runtime without adding TanStack Router.
- **Data Fetching** — Re-exports [TanStack Query](https://tanstack.com/query) with built-in server function proxies.
- **Server Function Support** — `useQuery(fn)` and `useMutation(fn)` for zero-boilerplate RPC.
- **Single Client Entry Point** — Shell, page runtime, React page runtime, transport, page hooks, and navigation helpers are exported from `@evjs/client`.

## Install

```bash
npm install @evjs/client react react-dom
```

## Quick Start

### 1. Write Page Files

```tsx
// src/pages/users/$userId.tsx
import { usePageParams } from "@evjs/client";

export default function UserPage() {
  const { userId } = usePageParams();
  return <h1>User {userId}</h1>;
}
```

### 2. Let evjs Build the Route Entry

When `src/pages` exists and `src/main.tsx` does not, evjs discovers the page
files and builds the SPA entry internally. For MPA output:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
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
- `usePageParams`, `usePageSearch`, and `usePageLoaderData`: Read framework-managed route data from page components.
- `createFileRouteApp`: Internal SPA bootstrap used by generated route entries.
- `Link`, `Navigate`, `useNavigate`, and `redirect`: Navigation helpers for page components and route lifecycle exports.

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

All client runtime APIs are exported from `@evjs/client`.

## License

MIT
