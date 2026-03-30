# Server Functions

## Overview

Server functions let you write backend logic alongside your frontend code and call them from React components as if they were local functions. While not strictly required, we recommend suffixing server function files with `.server.ts`. The build system transforms them into RPC calls automatically.

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
- **Recommendation**: Use the `.server.ts` extension (e.g. `users.server.ts`) or place them in a `src/api/` directory to help differentiate them from client code.
- For single-arg mutations: `mutate({ name, email })`
- For multi-arg mutations: `mutate([name, email])`

## Query Patterns

evjs provides type-safe `useQuery` and `useSuspenseQuery` that accept server functions directly. Server function stubs also carry `.queryKey()`, `.fnId`, and `.fnName` properties for cache invalidation and introspection.

### Direct usage (recommended)

```tsx
import { useQuery, useSuspenseQuery, useMutation, useQueryClient, getFnQueryKey, getFnQueryOptions } from "@evjs/client";
import { getUsers, getUser, createUser } from "../api/users.server";

// Queries — pass server functions directly, types are inferred
const { data: users } = useQuery(getUsers);               // data: User[]
const { data: user } = useQuery(getUser, userId);          // data: User
const { data } = useSuspenseQuery(getUsers);               // data: User[] (guaranteed)

// Mutations — use raw TanStack useMutation
const queryClient = useQueryClient();
const { mutate } = useMutation({
  mutationFn: createUser,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: getFnQueryKey(getUsers) });
  },
});

// Route loaders / prefetching — use getFnQueryOptions()
loader: ({ context }) =>
  context.queryClient.ensureQueryData(getFnQueryOptions(getUsers));
```

### Server function metadata

Every registered server function stub carries these properties at runtime:

```ts
getFnQueryKey(getUsers)         // → ["<fnId>"]
getFnQueryKey(getUsers, someArg)// → ["<fnId>", someArg]
getUsers.fnId               // → "<hash>" (stable SHA-256)
getUsers.fnName             // → "getUsers"
```

- **`getFnQueryKey(fn, ...args)`** — Build a TanStack Query key. Use for `invalidateQueries`, `setQueryData`, etc.
- **`.fnId`** — The stable internal function ID (read-only).
- **`.fnName`** — The human-readable export name (read-only).
- **`getFnQueryOptions(fn, ...args)`** — Returns `{ queryKey, queryFn }` for loaders, prefetch, and `useInfiniteQuery`.

### Raw fetch / non-server functions

For non-server functions, use the standard TanStack Query API directly:

```tsx
const { data } = useQuery({
  queryKey: ["github-user", username],
  queryFn: () => fetch(`https://api.github.com/users/${username}`).then(r => r.json()),
});
```

## Configuration

### Transport

```tsx
import { initTransport } from "@evjs/client";

// HTTP (default)
initTransport({ endpoint: "/api/fn" });

// WebSocket
import { WebSocketTransport } from "@evjs/client";
initTransport({ transport: new WebSocketTransport("ws://localhost:3001/ws") });
```

## Error Handling

```ts
// Server — throw structured errors
import { ServerError } from "@evjs/server";
throw new ServerError("User not found", { status: 404, data: { id } });

// Client — catch typed errors
import { ServerFunctionError } from "@evjs/client";
if (e instanceof ServerFunctionError) {
  console.log(e.message, e.status, e.data);
}
```

## Key Points

- Use `useQuery(fn, ...args)` for type-safe queries: `useQuery(getUsers)`
- Use `getFnQueryKey(fn, ...args)` for cache invalidation: `getFnQueryKey(getUsers)`
- Use `getFnQueryOptions(fn, ...args)` for loaders, prefetch, and `useInfiniteQuery`
- Arguments are spread: `useQuery(getUser, id)` not `useQuery(getUser, [id])`
- `ServerError` on server → `ServerFunctionError` on client (with status + data)

