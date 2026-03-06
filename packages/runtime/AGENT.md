# @evjs/runtime

Core runtime for the ev React framework. Provides client-side routing, data fetching, and server-side handling.

## Client API (`@evjs/runtime/client`)

### App Bootstrap
- `createApp({ routeTree, routerOptions?, queryClientConfig? })` — Bootstrap Router + Query + DOM. Injects `queryClient` into router context.
- `createAppRootRoute(options)` — Create root route with typed `context.queryClient` for route loaders.

### Server Function Proxies
Always use these instead of raw `useQuery`/`useMutation` for server functions:

```tsx
import { query, mutation, createQueryProxy, createMutationProxy } from "@evjs/runtime/client";
import { getUsers, createUser } from "./api/users.server";

// Direct wrapper
const { data } = query(getUsers).useQuery([]);
const { mutate } = mutation(createUser).useMutation();

// Module proxy
const api = { query: createQueryProxy({ getUsers }), mutation: createMutationProxy({ createUser }) };
api.query.getUsers.useQuery([]);

// queryOptions (for loaders, prefetch)
const opts = query(getUsers).queryOptions([]);
queryClient.ensureQueryData(opts);

// Query key (for invalidation)
queryClient.invalidateQueries({ queryKey: query(getUsers).queryKey() });
```

### Route Loader Pattern
```tsx
const rootRoute = createAppRootRoute({ component: Root });
const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(query(getUsers).queryOptions([])),
  component: UsersPage,
});
```

### Routing (re-exports from @tanstack/react-router)
`createRootRoute`, `createRoute`, `createRouter`, `Link`, `Outlet`, `Navigate`, `useParams`, `useSearch`, `useNavigate`, `useLocation`, `useMatch`, `useLoaderData`, `redirect`, `notFound`, `lazyRouteComponent`

### Data (re-exports from @tanstack/react-query)
`useQuery`, `useMutation`, `useQueryClient`, `useSuspenseQuery`, `QueryClient`, `QueryClientProvider`

### Transport
```tsx
import { configureTransport } from "@evjs/runtime/client";

// Simple: custom base URL and endpoint path
configureTransport({
  baseUrl: "https://api.example.com",
  endpoint: "/server-function",  // default: "/api/rpc"
});

// Advanced: fully custom transport
configureTransport({ transport: { send: async (fnId, args) => { /* custom */ } } });
```

## Server API (`@evjs/runtime/server`)

- `createApp(options?)` — Create Hono app with RPC middleware. Options: `{ rpcEndpoint?: string, port?: number }`. Default RPC path: `/api/rpc`.
- `runNodeServer(app, { port?, host? })` — Start on Node.js (default port 3001).
- `registerServerFn(fnId, fn)` — Register server function (called by build-tools).
- `createRpcMiddleware()` — Standalone Hono RPC sub-app.

## ECMA Adapter (`@evjs/runtime/server/ecma`)

- `createHandler(app)` — Wraps a Hono app for deployment to Deno, Bun, Cloudflare Workers, or any Fetch API-compatible runtime.

## Server Functions
Files must start with `"use server";`, use named async exports, and end in `.server.ts`.
