# @evjs/runtime — Agent Guide

> AI-agent reference for developing apps with the `@evjs/runtime` package.

## Overview

Core runtime for evjs apps. Two entry points:
- `@evjs/runtime` + `@evjs/runtime/client` — client-side (React, TanStack)
- `@evjs/runtime/server` — server-side (Hono)
- `@evjs/runtime/server/ecma` — edge/serverless adapter

## Client API

### App Bootstrap

```tsx
import { createApp, createAppRootRoute, createRoute } from "@evjs/runtime";

const rootRoute = createAppRootRoute({ component: RootLayout });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const routeTree = rootRoute.addChildren([homeRoute]);

const app = createApp({ routeTree });

// REQUIRED for type-safe useParams, useSearch, Link, etc.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
```

**Key functions:**
| API | Import | Purpose |
|-----|--------|---------|
| `createApp` | `@evjs/runtime` | Bootstrap Router + QueryClient + render to DOM |
| `createAppRootRoute` | `@evjs/runtime` | Root route with typed `context.queryClient` |
| `createRoute` | `@evjs/runtime` | Define a route (re-export from TanStack Router) |

### Server Function Proxies

**Always use `query()` / `mutation()` wrappers.** Never call `useQuery` with manual fetch.

```tsx
import { query, mutation } from "@evjs/runtime/client";
import { getUsers, createUser } from "./api/users.server";

// Data fetching
const { data, isLoading, error } = query(getUsers).useQuery();

// With arguments (spread, not wrapped in array)
const { data } = query(getUser).useQuery(userId);

// Mutations
const { mutate, isPending } = mutation(createUser).useMutation();
mutate([{ name: "Alice", email: "alice@example.com" }]);

// queryOptions — for route loaders, prefetching, cache control
const opts = query(getUsers).queryOptions();
queryClient.ensureQueryData(opts);
queryClient.prefetchQuery(opts);

// Cache invalidation
queryClient.invalidateQueries({ queryKey: query(getUsers).queryKey() });
// or by evId
queryClient.invalidateQueries({ queryKey: [getUsers.evId] });

// Module proxy (for grouping)
import { createQueryProxy, createMutationProxy } from "@evjs/runtime/client";
const api = {
  query: createQueryProxy({ getUsers, getUser }),
  mutation: createMutationProxy({ createUser }),
};
api.query.getUsers.useQuery();
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

### Routing


**Recommended structure:**

```
src/
├── main.tsx              ← route tree wiring + type registration
├── api/*.server.ts       ← server functions
└── pages/
    ├── __root.tsx         ← root layout (nav + <Outlet />)
    ├── home.tsx           ← static route
    ├── posts/index.tsx    ← nested group (layout + index + $postId)
    ├── dashboard.tsx      ← pathless layout + child route
    ├── search.tsx         ← typed search params
    └── catch.tsx          ← redirect + 404
```

**Key patterns:**

| Pattern | Code | Notes |
|---------|------|-------|
| Dynamic slug | `path: "$postId"` | Access via `route.useParams()` → `{ postId: string }` |
| Pathless layout | `id: "dashboard-layout"` | Shared UI without URL segment, use `<Outlet />` |
| Index route | `path: "/"` inside a group | Shown when parent matches exactly |
| Catch-all / 404 | `path: "*"` | Matches unmatched URLs |
| Search params | `validateSearch: (s) => ({ q: s.q ?? "" })` | Access via `route.useSearch()` |
| Redirect | `beforeLoad: () => { throw redirect({ to: "/posts" }) }` | |
| Route nesting | `postsRoute.addChildren([indexRoute, detailRoute])` | |
| Loader prefetch | `loader: ({ params, context }) => context.queryClient.ensureQueryData(...)` | |

**Type-safe routing (CRITICAL):**

```tsx
// main.tsx — ALWAYS register the router type
const app = createApp({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
```

Without this declaration, `useParams()`, `useSearch()`, and `Link` all return `any`.

**Use route-scoped hooks** (not global):

```tsx
// ✅ Type-safe — postId: string
const { postId } = postDetailRoute.useParams();

// ❌ Untyped — returns any
const params = useParams({ from: "/posts/$postId" });



### Transport Configuration

```tsx
import { initTransport } from "@evjs/runtime/client";

// Default HTTP transport (usually no config needed)
initTransport({ endpoint: "/api/fn" });

// Custom API host (e.g., separate backend)
initTransport({
  baseUrl: "https://api.example.com",
  endpoint: "/api/fn",
});

// WebSocket transport
initTransport({
  transport: {
    send: async (fnId, args) => {
      // custom WebSocket implementation
    },
  },
});

// Custom codec (e.g., MessagePack)
initTransport({
  codec: {
    encode: (data) => msgpack.encode(data),
    decode: (buffer) => msgpack.decode(buffer),
    contentType: "application/msgpack",
  },
});
```

### Routing Re-exports

From `@tanstack/react-router`:
`createRootRoute`, `createRoute`, `createRouter`, `Link`, `Outlet`, `Navigate`, `useParams`, `useSearch`, `useNavigate`, `useLocation`, `useMatch`, `useLoaderData`, `redirect`, `notFound`, `lazyRouteComponent`

### Data Re-exports

From `@tanstack/react-query`:
`useQuery`, `useMutation`, `useQueryClient`, `useSuspenseQuery`, `QueryClient`, `QueryClientProvider`

## Server Functions

```ts
// src/api/users.server.ts
"use server";

export async function getUsers() {
  return await db.users.findMany();
}

export async function getUser(id: string) {
  const user = await db.users.find(id);
  if (!user) {
    throw new ServerError("NOT_FOUND", { message: "User not found", id });
  }
  return user;
}

export async function createUser(name: string, email: string) {
  return await db.users.create({ data: { name, email } });
}
```

**Rules:**
- File must start with `"use server";` directive
- Only **named async function exports** are supported
- No default exports, no arrow function exports
- Arguments are positional, transported as a tuple
- Use `.server.ts` extension or place in `src/api/`
- Build system auto-discovers — no manual registration

## Server API

```ts
import { createApp, serve, createHandler, registerMiddleware } from "@evjs/runtime/server";
```

| API | Purpose |
|-----|---------|
| `createApp({ endpoint? })` | Hono app with server function handler |
| `serve(app, { port?, host? })` | Node.js HTTP server with graceful shutdown |
| `createHandler()` | Standalone server function Hono handler |
| `registerServerFn(id, fn)` | Register a server function (used by build tools) |
| `registerMiddleware(fn)` | Register Hono middleware |

### ECMA Adapter (Edge / Serverless)

```ts
import { createFetchHandler } from "@evjs/runtime/server/ecma";

const app = createApp({ endpoint: "/api/fn" });
const handler = createFetchHandler(app);

// Deno
Deno.serve(handler);

// Bun
export default { fetch: handler };

// Cloudflare Workers
export default { fetch: handler };
```

## Error Handling

```ts
import { ServerError } from "@evjs/runtime";

// Server — throw structured errors
export async function getUser(id: string) {
  const user = await db.users.find(id);
  if (!user) throw new ServerError("NOT_FOUND", { id });
  return user;
}

// Client — catch typed errors
import { ServerError } from "@evjs/runtime";

try {
  await getUser("123");
} catch (e) {
  if (e instanceof ServerError) {
    e.code;  // "NOT_FOUND"
    e.data;  // { id: "123" }
  }
}
```

## Middleware

```ts
// src/middleware/auth.ts
import { registerMiddleware } from "@evjs/runtime/server";

registerMiddleware(async (c, next) => {
  const token = c.req.header("Authorization");
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  await next();
});
```

## Common Mistakes

1. **Don't use raw `useQuery`** for server functions — use `query(fn).useQuery(args)`
2. **Arguments are spread, not wrapped** — `query(getUser).useQuery(id)` not `query(getUser).useQuery([id])`
3. **Don't call server functions directly in components** — wrap with `query()` or `mutation()`
4. **Don't forget `"use server";`** at the top of `.server.ts` files
5. **Import `ServerError` from `@evjs/runtime`** — not from `/server` or `/client`
6. **Always register the router type** — without `declare module "@tanstack/react-router" { interface Register { router: typeof app.router } }`, all route params/search will be `any`
7. **Use `route.useParams()`** not the global `useParams()` — the route-scoped version gives proper type inference
