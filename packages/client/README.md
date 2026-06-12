# @evjs/client

> Client-side runtime for the **evjs** fullstack framework.

## Features

- **Page Hooks** — `usePageParams()`, `usePageSearch()`, and `usePageLoaderData()` expose framework-managed route data while evjs owns route discovery.
- **SPA Navigation** — SPA pages use evjs page hooks and navigation helpers while the framework owns route discovery and app bootstrap.
- **Router-Free Pages** — MPA and framework-managed pages use the page runtime without adding a client router.
- **Data Fetching** — Re-exports [TanStack Query](https://tanstack.com/query) with built-in server function proxies.
- **Server Function Support** — `useQuery(fn)` and `useMutation(fn)` for zero-boilerplate RPC.
- **Focused Client Entry Point** — Application code imports transport, page hooks, navigation helpers, and remote helpers from `@evjs/client`; generated framework bootstrap uses `@evjs/client/internal`.

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

When `src/pages` exists and the project does not declare explicit `app`,
`pages`, or `remote` config, evjs discovers the page files and builds the SPA
entry internally. For MPA output:

Use `src/layout.tsx` for the optional SPA root layout. `src/pages` is reserved
for page route modules, so any `layout` source file inside `src/pages` is
reported as a convention error. Dynamic route filenames use `$param`; bracket
segments such as `[id].tsx` are rejected.

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
- `startPageRuntime()`: Generic framework-managed page runtime.
- Manifest shell primitives such as `createShell()`, `createPageDriver()`, and `createHistoryDriver()` are framework-owned and imported through `@evjs/client/internal`.
- Generated component-page and remote bootstrap APIs are also framework-owned and imported through `@evjs/client/internal`.

Application-facing client runtime APIs are exported from `@evjs/client`.

## License

MIT
