# Server Functions

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

evjs provides a `serverFn()` utility that converts server functions into TanStack-compatible `{ queryKey, queryFn }` options. This works with **any** TanStack hook.

### Using serverFn() with TanStack hooks

```tsx
import { serverFn, useQuery, useMutation, useSuspenseQuery, useQueryClient } from "@evjs/runtime/client";
import { getUsers, getUser, createUser } from "../api/users.server";

// Works with any TanStack query hook — types are inferred from the server function
const { data: users } = useQuery(serverFn(getUsers));
const { data: user } = useQuery(serverFn(getUser, userId));
const { data } = useSuspenseQuery(serverFn(getUsers));

// Mutations use raw TanStack useMutation
const queryClient = useQueryClient();
const { mutate } = useMutation({
  mutationFn: createUser,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: serverFn(getUsers).queryKey });
  },
});

// Route loaders / prefetching
loader: ({ context }) =>
  context.queryClient.ensureQueryData(serverFn(getUsers));
```

### Raw fetch / non-server functions

For non-server functions, use the standard TanStack Query API directly:

```tsx
const { data } = useQuery({
  queryKey: ["github-user", username],
  queryFn: () => fetch(`https://api.github.com/users/${username}`).then(r => r.json()),
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

- Use `serverFn(fn, ...args)` to get `{ queryKey, queryFn }` for any TanStack hook
- Arguments are spread: `serverFn(getUser, id)` not `serverFn(getUser, [id])`
- `ServerError` on server → `ServerFunctionError` on client (with status + data)
- Middleware receives `(ctx, next)` where `ctx = { fnId, args }` — not a Hono context

