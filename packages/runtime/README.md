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
| `configureTransport` | Set custom transport (fetch, axios, WebSocket) |
| `createRootRoute`, `createRoute`, `Link`, `Outlet`, ... | Re-exports from `@tanstack/react-router` |
| `useQuery`, `useMutation`, `useQueryClient`, ... | Re-exports from `@tanstack/react-query` |

### `@evjs/runtime/server`

| Export | Description |
|--------|-------------|
| `createApp` | Create a Hono app with RPC middleware |
| `runNodeServer` | Start the app on Node.js (default port 3001) |
| `registerServerFn` | Register a server function in the RPC registry |
| `createRpcMiddleware` | Standalone Hono sub-app for RPC dispatch |

## Usage

### Client

```tsx
import { createApp, createRootRoute, query, mutation } from "@evjs/runtime/client";
import { getUsers, createUser } from "./api/users.server";

function Users() {
  const { data } = query(getUsers).useQuery([]);
  const { mutate } = mutation(createUser).useMutation();
}

const rootRoute = createRootRoute({ component: Root });
const app = createApp({ routeTree: rootRoute });
app.render("#app");
```

### Server

The server app is a runtime-agnostic Hono instance. Use a Runner to start it:

```ts
import { createApp, runNodeServer } from "@evjs/runtime/server";

const app = createApp();
runNodeServer(app, { port: 3001 });
```

In development, `ev dev` with `runner` configured in `EvWebpackPlugin` handles this automatically.

### Custom Transport

```ts
import { configureTransport } from "@evjs/runtime/client";

configureTransport({
  transport: {
    send: async (fnId, args) => {
      const { data } = await axios.post("/api/rpc", { fnId, args });
      return data.result;
    },
  },
});
```

### Query Proxy Patterns

```tsx
// A. Direct wrapper (single function)
const { data } = query(getUsers).useQuery([]);

// B. Module proxy (feature-based API)
import * as UsersAPI from "./api/users.server";
const users = {
  query: createQueryProxy(UsersAPI),
  mutation: createMutationProxy(UsersAPI),
};
users.query.getUsers.useQuery([]);

// C. queryOptions (for prefetching, etc.)
const options = query(getUsers).queryOptions([id]);
queryClient.prefetchQuery(options);
```
