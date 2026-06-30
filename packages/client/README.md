# @evjs/client

> Browser runtime core for standalone CSR apps and the **evjs** framework.

## Features

- **Page Hooks** — `usePageParams()`, `usePageSearch()`, and `usePageLoaderData()` expose framework-managed route data while evjs owns route discovery.
- **Standalone CSR** — `createApp()`, `createAppRootRoute()`, and TanStack Router re-exports support manual browser-only apps without `@evjs/ev`.
- **SPA Navigation** — SPA pages use evjs page hooks and navigation helpers while the framework owns route discovery and app bootstrap.
- **Router-Free Pages** — MPA and framework-managed pages use the page runtime without adding a client router.
- **Data Fetching** — Wraps [TanStack Query](https://tanstack.com/query) with built-in server function proxies.
- **Server Function Support** — `useQuery(fn)` and `useMutation(fn)` for typed server-boundary calls.
- **Focused Client API** — Standalone/manual client code imports transport, page hooks, navigation helpers, and RSC helpers from `@evjs/client`; file-convention app source reaches the same authoring APIs through `@evjs/ev/route`, `@evjs/ev/navigation`, `@evjs/ev/query`, and `@evjs/ev/transport`; generated framework bootstrap uses `@evjs/client/internal`.

## Install

```bash
npm install @evjs/client react react-dom
```

## Quick Start

### Standalone CSR

Use `@evjs/client` directly when a browser-only app owns its routing and build
pipeline:

```tsx
import {
  createApp,
  createAppRootRoute,
  createRoute,
  Link,
  Outlet,
} from "@evjs/client";

const rootRoute = createAppRootRoute({
  component: () => (
    <main>
      <Link to="/">Home</Link>
      <Outlet />
    </main>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <h1>Home</h1>,
});

const app = createApp({
  routeTree: rootRoute.addChildren([indexRoute]),
});

declare module "@evjs/client" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
```

Use `@evjs/ev` only when the app wants framework composition such as file-based
routing, server-function transforms, manifests, SSR, PPR, RSC, or deployment
artifacts.

### Framework-Managed Pages

```tsx
// src/pages/users/$userId.tsx
import { usePageParams } from "@evjs/ev/route";

export default function UserPage() {
  const { userId } = usePageParams();
  return <h1>User {userId}</h1>;
}
```

Use the page hooks for route data in both SPA and MPA output. They are the
zero-annotation path for page code; `params`, `search`, and `loaderData` are
not passed as page component props.

### Let evjs Build the Route Entry

When `src/pages` exists and the project does not declare explicit `app` or
`pages` config, evjs discovers the page files and builds the SPA entry
internally.

SPA mode writes `src/route-types.d.ts` for type-safe `Link`,
`useLinkProps`, and `redirect` calls. Treat it as generated output: keep it
ignored and do not import it from application code.

Use `layout/index.tsx` beside the page route directory only for the optional SPA
root layout. The default `src/pages` route directory uses
`src/layout/index.tsx`; a custom directory such as `src/app/pages` uses
`src/app/layout/index.tsx`. It is an exact directory-entry convention:
`layout.tsx`, `layout.jsx`, `layout.ts`, and non-TSX `layout/index.*` files are
not aliases. Set `routing.conventions.layout` to another module path for
migrated SPA shells, or set `routing.conventions.layout: false` to disable SPA
root layout discovery. MPA output does not accept or consume a framework layout
file, so MPA pages compose shared wrappers as ordinary components.

The route directory is reserved for page route modules, so files or folders
named `layout` inside it are reported as convention errors. Dynamic route
filenames use `$param`; bracket segments such as `[id].tsx` are rejected. Every
discovered route file must default-export a React component; put non-route
helpers in underscore-prefixed files or folders. Syntax and default-export
errors are reported during route discovery before the bundler runs.

For MPA output:

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

Use the `"use server"` directive in reachable `*.server.ts` files. In
file-convention apps, import the route data hooks from `@evjs/ev/route` and query hooks from `@evjs/ev/query`:

```tsx
// src/pages/posts.tsx
import { useQuery } from "@evjs/ev/query";
import { getPosts } from "../apis/posts.server";

function Posts() {
  const { data } = useQuery(getPosts);
  return <ul>{data?.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
}
```

Standalone/manual clients can import the same query hooks directly from
`@evjs/client` when they own the runtime integration.

## API

### Routing
- `usePageParams`, `usePageSearch`, and `usePageLoaderData`: Read framework-managed route data from page components.
- `Link`, `Navigate`, `useNavigate`, and `redirect`: Navigation helpers for page components and route lifecycle exports.

### Query
- `useQuery(fn, ...args)` and `useSuspenseQuery(fn, ...args)`: Call compiler-generated server function stubs with inferred argument and result types.
- `useMutation(fn, options?)`: Mutate through a compiler-generated server function stub; pass `mutationFn` only when using the standard TanStack object form.
- `getFnQueryKey(fn, ...args)`: Generate stable query keys for server functions.
- `getFnQueryOptions(fn, ...args)`: Generate options for manual `queryClient` usage.
- Plain async functions are not server function stubs. Use `useQuery({ queryKey, queryFn })` or `useMutation({ mutationFn })` for non-server functions.

### Transport
- `initTransport({ baseUrl, credentials, headers, functions })`: Configure the default HTTP adapter. `functions.endpoint` can override the server function path for standalone runtimes.
- `credentials` / `headers`: Supported HTTP defaults; fetch `mode` is intentionally not configurable.
- `@evjs/client/transport`: Public subpath for low-level transport APIs such as `createServerReference`, `getFnId`, `getFnName`, and `initTransport`.
- The default HTTP adapter expects successful server-function responses to use
  `Content-Type: application/json`. Non-JSON error responses use their trimmed
  body text for `ServerFunctionError`, falling back to `statusText` when the
  body is empty or only whitespace.
- `initTransport({ adapter })`: Replace transport behavior with a custom adapter.
- Generated server-function stubs use `@evjs/client/internal/server-functions`;
  application code should keep using the public transport APIs above.

### Runtime
- Page runtime bootstrap is framework-owned and imported through `@evjs/client/internal`.
- Page runtime loads the embedded `__EVJS_CLIENT_RUNTIME__` first. When it falls
  back to `runtimeUrl`, `data-evjs-runtime`, or `/runtime.json`, the response
  must be successful JSON with `Content-Type: application/json`, allowing
  optional content-type parameters.
- `fetchRscFlight()`, `createReactRscModel()`, `mountReactRscPage()`,
  `unmountReactRscPage()`, and `startReactRscPageRuntime()`: RSC page runtime
  helpers for framework-owned Flight and mount flows.
- RSC page models require successful Flight responses to use
  `Content-Type: text/x-component` with optional parameters.
- `fetchRscDebugPayload()`, `loadRscDebugPage()`, and `mountRscDebugPayload()`:
  RSC diagnostics helpers. Debug payload responses require
  `Content-Type: application/json` with optional parameters, `version: 1`,
  `type: "evjs.rsc"`, a build-identifier `buildId`, and well-formed asset
  lists before any diagnostic HTML is mounted.
- Runtime shell primitives such as `createShell()`, `createPageDriver()`, and `createHistoryDriver()` are framework-owned and imported through `@evjs/client/internal`.
- Shell activation request URLs must be HTTP(S) URLs or pathnames starting with `/`.
- Generated component-page bootstrap APIs are also framework-owned and imported through `@evjs/client/internal`.

Application-facing client runtime APIs are exported from `@evjs/client`.
Generic TanStack Query APIs that are not paired with evjs server functions
should come from `@tanstack/react-query`. Standalone/manual clients use
`@evjs/client` for evjs page, navigation, server-function, and RSC APIs; normal
file-convention app source imports the public authoring surface from
`@evjs/ev/route`, `@evjs/ev/navigation`, `@evjs/ev/query`, and `@evjs/ev/transport`.

## License

MIT
