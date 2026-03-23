# @evjs/runtime

Core runtime for the **ev** framework. Provides client-side routing, data fetching, and server-side handling via Hono.

## Installation

```bash
npm install @evjs/runtime
```

## Exports

### `@evjs/runtime/client`

| Export | Description |
|--------|-------------|
| `createApp` | Bootstrap TanStack Router + Query + DOM |
| `query(fn)` | Universal query proxy for server functions |
| `mutation(fn)` | Universal mutation proxy for server functions |
| `createQueryProxy(module)` | Module-level query proxy |
| `createMutationProxy(module)` | Module-level mutation proxy |
| `initTransport` | One-time transport configuration (endpoint, custom transport, codec) |
| `getFnName` | Get the original name of a server function stub |
| `ServerFunctionError` | Structured error class for server function failures |
| `jsonCodec` | Default JSON codec |
| `createRootRoute`, `createRoute`, `Link`, `Outlet`, ... | Re-exports from `@tanstack/react-router` |
| `useQuery`, `useMutation`, `useQueryClient`, ... | Re-exports from `@tanstack/react-query` |

### `@evjs/runtime/server`

| Export | Description |
|--------|-------------|
| `createApp` | Create a Hono app with server function handler |
| `createHandler` | Standalone Hono sub-app for server function dispatch |
| `dispatch` | Protocol-agnostic dispatcher for custom transports (WebSocket, IPC) |
| `registerMiddleware` | Register middleware for all server function calls |
| `registerServerFn` | Register a server function in the registry |
| `ServerError` | Throwable error with structured data and custom status |
| `jsonCodec` | Default JSON codec |

### `@evjs/runtime/server/node`

| Export | Description |
|--------|-------------|
| `serve` | Start the app on Node.js (default port 3001) |

### `@evjs/runtime/server/ecma`

| Export | Description |
|--------|-------------|
| `createFetchHandler` | Wrap Hono app for Deno, Bun, or any Fetch-compatible runtime |

## Usage

### Client

```tsx
import { createApp, createRootRoute, query, mutation } from "@evjs/runtime/client";
import { getUsers, createUser } from "./api/users.server";

function Users() {
  const { data } = query(getUsers).useQuery();
  const { mutate } = mutation(createUser).useMutation({
    invalidates: [getUsers],  // auto-invalidate on success
  });
}

const rootRoute = createRootRoute({ component: Root });
const app = createApp({ routeTree: rootRoute });
app.render("#app");
```

### Server

```ts
import { createApp } from "@evjs/runtime/server";
import { serve } from "@evjs/runtime/server/node";

const app = createApp();
serve(app, { port: 3001 });
```

### Custom Transport

```ts
import { initTransport } from "@evjs/runtime/client";

// Custom endpoint
initTransport({
  baseUrl: "https://api.example.com",
  endpoint: "/server-function",  // default: "/api/fn"
});

// Custom protocol (e.g. WebSocket)
initTransport({
  transport: {
    send: async (fnId, args) => { /* your protocol */ },
  },
});

// Custom serialization
initTransport({
  codec: { serialize: msgpack.encode, deserialize: msgpack.decode, contentType: "application/msgpack" },
});
```

### Server Middleware

```ts
import { registerMiddleware } from "@evjs/runtime/server";

registerMiddleware(async (ctx, next) => {
  console.log(`Calling ${ctx.fnId}`);
  const start = Date.now();
  const result = await next();
  console.log(`${ctx.fnId} took ${Date.now() - start}ms`);
  return result;
});
```

### Typed Errors

```ts
import { ServerError } from "@evjs/runtime/server";

export async function getUser(id: string) {
  const user = db.find(id);
  if (!user) throw new ServerError("User not found", { status: 404, data: { id } });
  return user;
}
```

### Query Proxy Patterns

```tsx
// Direct wrapper
const { data } = query(getUsers).useQuery();

// With args
const { data } = query(getUser).useQuery(userId);

// Query invalidation (via TanStack QueryClient)
queryClient.invalidateQueries({ queryKey: query(getUsers).queryKey() });

// queryOptions (for prefetching)
const options = query(getUsers).queryOptions();
queryClient.prefetchQuery(options);

// queryOptions with custom TanStack options (just spread on top)
const options = { ...query(getUsers).queryOptions(), staleTime: 5000 };

// Module proxy
import * as UsersAPI from "./api/users.server";
const api = createQueryProxy(UsersAPI);
const { data } = api.getUsers.useQuery();
```

### Custom Transport (WebSocket)

```ts
import { initTransport } from "@evjs/runtime/client";

initTransport({
  transport: {
    send: async (fnId, args) => {
      return new Promise((resolve, reject) => {
        ws.send(JSON.stringify({ id: ++reqId, fnId, args }));
        pending.set(reqId, { resolve, reject });
      });
    },
  },
});
```

### Route Loader Pattern

Prefetch data before route renders — no loading spinners:

```tsx
const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(query(getUsers).queryOptions()),
  component: UsersPage,
});
```

## Common Mistakes

1. **Don't use raw `useQuery`** for server functions — use `query(fn).useQuery(args)`
2. **Arguments are spread, not wrapped** — `query(getUser).useQuery(id)` not `query(getUser).useQuery([id])`
3. **Mutation args are passed directly** — `mutate({ name, email })` not `mutate([{ name, email }])`
4. **Don't call server functions directly in components** — wrap with `query()` or `mutation()`
5. **Don't forget `"use server";`** at the top of `.server.ts` files
6. **Throw `ServerError`** on the server, catch `ServerFunctionError` on the client
7. **Always register the router type** — without `declare module "@tanstack/react-router" { ... }`, all route params/search will be `any`
8. **Use `route.useParams()`** not the global `useParams()` — the route-scoped version gives proper type inference
