---
name: evjs-server-functions
description: Guide on how server functions, data fetching, transport, and middleware work in evjs.
---

# Instruction

Use this skill when helping a user create server functions, fetch data, or configure middleware and transport.

## Overview

Server functions let you write backend logic in `.server.ts` files and call them from React components as if they were local functions. The build system transforms them into RPC calls automatically.

## Usage

```ts
// src/api/users.server.ts
"use server";

export async function getUsers() {
  return await db.users.findMany();
}

export async function createUser(name: string, email: string) {
  return await db.users.create({ data: { name, email } });
}
```

**Rules:**
- File must start with `"use server";` directive
- Only **named async function exports** are transformed
- Use `.server.ts` extension or place in `src/api/` directory
- For single-arg mutations: `mutate({ name, email })`
- For multi-arg mutations: `mutate([name, email])`

## Query Patterns

Use `query` / `mutation` proxies — they handle query keys, transport, and cache invalidation automatically.

### evjs proxy vs raw TanStack Query

```tsx
// ✅ evjs — automatic queryKey, transport, and type safety
const { data } = query(getUser).useQuery(userId);

// ❌ raw TanStack — manual everything
const { data } = useQuery({
  queryKey: ["getUser", userId],
  queryFn: () => fetch(`/api/fn`, {
    method: "POST",
    body: JSON.stringify({ fnId: "hash:getUser", args: [userId] }),
  }).then(r => r.json()).then(r => r.result),
});
```

| | evjs proxy | Raw TanStack |
|--|-----------|-------------|
| **Query key** | Auto-generated from function ID | Manual, error-prone strings |
| **Transport** | Built-in (fetch, WebSocket, custom) | Manual fetch |
| **Cache invalidation** | `invalidates: [getUsers]` | Manual queryKey matching |
| **Type safety** | Inferred from server function | Manual typing |
| **Custom options** | `.queryOptions({ staleTime: 5000 })` | Inline in `useQuery()` |

### Examples

```tsx
import { query, mutation, useQuery } from "@evjs/runtime/client";

// Basic usage
const { data } = query(getUsers).useQuery();

// With arguments
const { data } = query(getUser).useQuery(userId);

// Custom query options (staleTime, refetchInterval, etc.)
const opts = query(getUsers).queryOptions({ staleTime: 5000 });
const { data } = useQuery(opts);

// Prefetching in route loaders
const opts = query(getUsers).queryOptions();
queryClient.ensureQueryData(opts);

// Cache invalidation
queryClient.invalidateQueries({ queryKey: query(getUsers).queryKey() });

// Auto-invalidation on mutation success
const { mutate } = mutation(createUser).useMutation({
  invalidates: [getUsers],
});
```

## Configuration

### Middleware

Middleware wraps server function calls (not HTTP requests):

```ts
import { registerMiddleware } from "@evjs/runtime/server";

registerMiddleware(async (ctx, next) => {
  const start = Date.now();
  const result = await next();
  console.log(`${ctx.fnId} took ${Date.now() - start}ms`);
  return result;
});
```

Register in `ev.config.ts`:
```ts
export default defineConfig({
  server: { middleware: ["./src/middleware/auth.ts"] },
});
```

### Transport & Codec

```tsx
import { initTransport } from "@evjs/runtime/client";

// HTTP (default)
initTransport({ endpoint: "/api/fn" });

// WebSocket
import { WebSocketTransport } from "@evjs/runtime/client";
initTransport({ transport: new WebSocketTransport("ws://localhost:3001/ws") });
```

## Error Handling

```ts
// Server — throw structured errors
import { ServerError } from "@evjs/runtime/server";
throw new ServerError("User not found", { status: 404, data: { id } });

// Client — catch typed errors
import { ServerFunctionError } from "@evjs/runtime/client";
if (e instanceof ServerFunctionError) {
  console.log(e.message, e.status, e.data);
}
```

## Key Points

- Always use `query()` / `mutation()` proxies instead of raw `useQuery`
- Arguments are spread, not wrapped: `useQuery(id)` not `useQuery([id])`
- `ServerError` on server → `ServerFunctionError` on client (with status + data)
- Middleware receives `(ctx, next)` where `ctx = { fnId, args }` — not a Hono context
