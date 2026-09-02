# @evjs/client

> Browser runtime core for standalone CSR apps and the **evjs** framework.

## Features

- **Page Hooks** — `usePageParams()`, `usePageSearch()`, and `usePageLoaderData()` expose framework-managed route data while evjs owns route materialization.
- **Standalone CSR** — `createApp()`, `createAppRootRoute()`, and TanStack Router re-exports support manual browser-only apps without `@evjs/ev`.
- **SPA Navigation** — SPA Pages use evjs page hooks and navigation helpers while the framework owns the route tree and app bootstrap.
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

Use `@evjs/ev` only when the app wants framework composition such as Page
routing, server-function transforms, manifests, SSR, PPR, RSC, or deployment
artifacts.

### Framework-Managed Pages

```tsx
// src/pages/users/$userId/page.tsx
import { usePageParams } from "@evjs/ev/route";

export default function UserPage() {
  const { userId } = usePageParams();
  return <h1>User {userId}</h1>;
}
```

In an SPA, layouts use the same `usePageParams()` API to read the merged
params of the active route branch. Native anchors and browser APIs can resolve application
routes, including `routing.basepath`, with `useHref()` or
`useHrefResolver()` from `@evjs/ev/navigation`.

Use the page hooks for route data in both SPA and MPA output. They are the
zero-annotation path for page code; `params`, `search`, and `loaderData` are
not passed as page component props.

### Let evjs Build the Application

Framework-managed applications use one Page-and-Route convention. A `page.*`
module is the positive Page/Route anchor; its containing directory owns private
source and determines the URL:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

The Page directory may contain components, hooks, models, and services without
private filename prefixes; those files never become routes. Change only
`routing.mode` to materialize the same semantic Page/Route tree as an MPA.
SPA and MPA applications compose the same file-convention layouts. MPA rejects
router-only lifecycle and boundary facets.

Explicit `application.routes` and `component`/`routes` config are SPA-only
route-tree inputs in `@evjs/ev`; their converters normalize into the same
runtime Page contracts, reject MPA materialization, and do not define
additional `@evjs/client` APIs. File-convention applications use `page.tsx`
for published Pages, keep Page configuration in `page.config.ts`, and select
only `routing.mode`.

## Server Functions

Use the `"use server"` directive in reachable modules; `.server.ts` is the
recommended naming convention, not a discovery rule. In file-convention apps,
import the route data hooks from `@evjs/ev/route` and query hooks from
`@evjs/ev/query`:

```tsx
// src/pages/posts/page.tsx
import { useQuery } from "@evjs/ev/query";
import { getPosts } from "../../apis/posts.server";

function Posts() {
  const { data } = useQuery(getPosts);
  return <ul>{data?.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
}
```

Standalone/manual clients can import the same query hooks directly from
`@evjs/client` when they own the runtime integration.

## API

### Routing
- `usePageParams`: Read merged params from the active SPA route branch in pages or layouts.
- `usePageSearch` and `usePageLoaderData`: Read framework-managed route data from page components.
- `Link`, `Navigate`, `useNavigate`, and `redirect`: Navigation helpers for page components and route lifecycle exports.
- `useHref` and `useHrefResolver`: Resolve application-relative routes to public browser hrefs for native anchors and browser APIs.

### Query
- `useQuery(fn, ...args)` and `useSuspenseQuery(fn, ...args)`: Call compiler-generated server function stubs with inferred argument and result types.
- `useMutation(fn, options?)`: Mutate through a compiler-generated server function stub; pass `mutationFn` only when using the standard TanStack object form.
- `getFnQueryKey(fn, ...args)`: Generate stable query keys for server functions.
- `getFnQueryOptions(fn, ...args)`: Generate options for manual `queryClient` usage.
- Plain async functions are not server function stubs. Use `useQuery({ queryKey, queryFn })` or `useMutation({ mutationFn })` for non-server functions.

### Transport
- `initTransport({ baseUrl, credentials, headers, functions })`: Configure the default HTTP adapter. `functions.endpoint` can override the server function path for standalone runtimes.
- `credentials` / `headers`: Supported HTTP defaults; fetch `mode` is intentionally not configurable.
- Hosting runtimes can set `window.__EVJS_TRANSPORT__` before framework server
  requests run. The value accepts data-only `RuntimeTransportOptions`:
  `baseUrl`, `credentials`, and `headers`. Endpoint paths continue to come from
  framework runtime metadata; application `initTransport()` calls still take
  priority for server functions.
- Runtime transport is for framework-managed browser requests to evjs server
  endpoints. It is consumed by server functions and RSC Flight.
  It does not control runtime metadata loading, static assets, dynamic imports,
  or application-authored `fetch()` calls.
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
- Page runtime loads the embedded `__EVJS_CLIENT_RUNTIME__` first. Standalone
  runtimes may explicitly use `runtimeUrl` or `data-evjs-runtime`; there is no
  implicit runtime metadata URL. An external response must be successful JSON
  with `Content-Type: application/json`, allowing optional content-type
  parameters.
- `fetchRscFlight()`, `createReactRscModel()`, `mountReactRscPage()`,
  `unmountReactRscPage()`, and `startReactRscPageRuntime()`: RSC page runtime
  helpers for framework-owned Flight and mount flows.
- RSC page models require successful Flight responses to use
  `Content-Type: text/x-component` with optional parameters.
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
