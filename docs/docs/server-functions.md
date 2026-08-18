# Server Functions

Server functions let you write backend logic beside application code and call
it through a typed asynchronous boundary. evjs handles the endpoint and client
call wiring. Use a `.server.ts` suffix so the boundary remains obvious to
people and tooling.

## Basic Usage

```ts
// src/apis/users.server.ts
"use server";

export async function getUsers() {
  return await db.users.findMany();
}

export async function createUser(name: string, email: string) {
  return await db.users.create({ data: { name, email } });
}

export const deleteUser = async (id: string) => {
  return await db.users.delete({ where: { id } });
};
```

### Rules

- File must start with `"use server";` directive
- Malformed `"use server"` modules fail before bundling and include the file path
  plus the parser message when evjs can resolve it.
- Only **named callable exports** are transformed: `export function`,
  `export async function`, `export const name = () => {}`,
  `export const name = async () => {}`, or same-module aliases such as
  `export { saveUser as updateUser }`
- A `"use server"` module must export at least one named server function. If a
  module only exports types or local helpers, remove the directive or export the
  callable function.
- Server functions can return a value or a Promise. The runtime awaits the
  result either way. Generator and async-generator functions are not supported
  because they return iterators, not a single transport result.
- Return values and structured `ServerError.data` must be JSON-serializable.
  Returning `undefined` is allowed and resolves as `undefined` in client code;
  on the raw HTTP response it serializes as an empty success payload.
- Calls are always async server-boundary calls. Do not rely on closure identity,
  synchronous side effects, class instances, DOM objects, streams, or other
  non-serializable references crossing the boundary.
- Export aliases can use identifier or string-literal names, but the local
  binding must be a function declaration or `const` initialized to a function.
  String-literal aliases must not be empty or padded with whitespace. Prefer
  identifier names for ordinary TypeScript imports.
- Type-only exports such as `export type { UserInput }` are ignored by the
  runtime transform and can live beside server functions.
- Ambient `declare` exports are not server functions because they emit no
  runtime implementation. Use a real function body for every exported server
  function.
- **Recommendation**: Use a `.server.ts` or `.server.tsx` filename (for
  example `users.server.ts`) so route discovery ignores colocated server-only
  files. Server functions have no convention directory.
- No default exports, runtime re-exports from other modules, or exported
  non-function runtime values such as constants
- Reachable `"use server"` modules are made callable from the browser.
  "Reachable" means imported by app code, page modules, server file routes, or
  server middleware; unrelated files are ignored.

## Request Context Helpers

Server functions run inside the framework request lifecycle, so they can use the
request helpers exported by `@evjs/ev/server-context`:

```ts
// src/apis/session.server.ts
"use server";

import { getCookie, headers, request, waitUntil } from "@evjs/ev/server-context";

export async function currentSession() {
  const req = request();
  const locale = headers().get("accept-language");
  const session = getCookie("session");

  waitUntil(auditSessionAccess(req.url));

  return { locale, hasSession: Boolean(session) };
}
```

These helpers only work while evjs is handling a server function, route handler,
middleware, SSR render, RSC Flight request, or PPR region request. Calling them
at module scope, during build, or from client code throws this diagnostic:

```text
[evjs] Server context helpers (request(), headers(), cookie helpers, waitUntil()) must be called during a request lifecycle. Call them inside a server function, route handler, middleware, or framework render.
```

## Query Patterns

evjs provides type-safe `useQuery` and `useSuspenseQuery` that accept server
functions directly. Use the cache helpers when a loader, prefetch, or mutation
needs the same query key.

### Direct Usage (Recommended)

```tsx
import {
  useQuery,
  useSuspenseQuery,
  useMutation,
  useQueryClient,
  getFnQueryKey,
  getFnQueryOptions,
} from "@evjs/ev/query";
import { getUsers, getUser, createUser } from "../apis/users.server";

// Queries — pass server functions directly, types are inferred
const { data: users } = useQuery(getUsers);               // data: User[]
const { data: user } = useQuery(getUser, userId);          // data: User
const { data } = useSuspenseQuery(getUsers);               // data: User[] (guaranteed)

// Mutations — pass server functions directly, just like useQuery
const queryClient = useQueryClient();
const { mutate } = useMutation(createUser, {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: getFnQueryKey(getUsers) });
  },
});

// Route loaders / prefetching — use getFnQueryOptions()
loader: ({ context }) =>
  context.queryClient.ensureQueryData(getFnQueryOptions(getUsers));
```

The function overloads require a compiled server function reference. Passing a
plain async function to `useQuery(fn)`,
`useSuspenseQuery(fn)`, `useMutation(fn)`, `getFnQueryKey(fn)`, or
`getFnQueryOptions(fn)` throws an `[evjs]` diagnostic that names the rejected
function. Use the TanStack object form for non-server functions, for example
`useQuery({ queryKey, queryFn })`.

### Cache Helpers

Use `getFnQueryKey()` and `getFnQueryOptions()` instead of reading server
function internals:

```ts
getFnQueryKey(getUsers);
getFnQueryKey(getUser, userId);
getFnQueryOptions(getUsers);
```

- **`getFnQueryKey(fn, ...args)`** — Build a TanStack Query key. Use for `invalidateQueries`, `setQueryData`, etc.
- **`getFnQueryOptions(fn, ...args)`** — Returns `{ queryKey, queryFn }` for loaders, prefetch, and `useInfiniteQuery`.

### Mutation Arguments

```tsx
// No arguments: call mutate() with no variables
mutate();

// Single argument: pass the value directly, even when it is an array
mutate({ name: "Alice", email: "alice@example.com" });
mutate(["admin", "editor"]);

// Multiple arguments: pass a tuple with the exact argument count
mutate(["Alice", "alice@example.com"]);
```

For fixed signatures, evjs can serialize mutation variables by parameter count:

```ts
export async function refresh() {}
export async function saveRoles(roles: string[]) {}
export async function createUser(name: string, email: string) {}
```

Flexible signatures use the fallback argument shape:

```ts
export async function search(query: string, options = {}) {}
export async function maybeUser(id?: string) {}
export const saveTags = async (...tags: string[]) => {};
```

With flexible signatures, omitted variables become `[]`, array variables are
treated as the full argument list, and non-array variables become one argument.
If an array should be one argument, declare exactly one required parameter, as in
`saveRoles()` above.

When you call `useMutation(serverFn, options)`, do not provide `mutationFn`;
evjs derives it and preserves the server function's argument-serialization
metadata. The standard TanStack `useMutation({ mutationFn })` object form is a
generic pass-through and may also receive a callable server-function stub, but
it does not apply the direct overload's multi-argument variable handling.

### Raw fetch / Non-Server Functions

For non-server functions, use the standard TanStack Query API directly:

```tsx
const { data } = useQuery({
  queryKey: ["github-user", username],
  queryFn: () =>
    fetch(`https://api.github.com/users/${username}`).then((r) => r.json()),
});
```

## Transport Configuration

### HTTP (Default)

```tsx
import { initTransport } from "@evjs/ev/transport";

initTransport({
  // Optional. Defaults to the current page origin.
  baseUrl: "https://api.example.com",
  // Send cookies on cross-origin server function requests.
  credentials: "include",
  headers: { "x-app": "my-app" },
});
```

`baseUrl`, `credentials`, and `headers` configure the built-in HTTP adapter.
Application code normally only changes `baseUrl` when the server runtime is
hosted on another origin:

- `baseUrl`: absolute HTTP(S) origin or base URL for server runtime calls;
  it must not contain leading or trailing whitespace.
- `credentials`: fetch credentials policy, for example `"include"`.
- `headers`: static headers or a function evaluated for each call.

For evjs builds, prefer `transport.baseUrl` in `ev.config.ts` when the
browser talks to the server runtime on another origin. That value is shared by
browser-initiated requests such as server functions and RSC Flight.
All evjs applications sharing one JavaScript realm must resolve to the same
framework transport settings. If they intentionally share another transport,
call `initTransport()` once with the common application-owned configuration;
an explicit call takes precedence over embedded framework settings.
The built-in adapter owns `Content-Type: application/json`; use `headers` only
for additional headers such as auth, tracing, or CSRF tokens.

Fetch `mode` is not configurable. Server function requests rely on the browser's
default CORS behavior; cross-origin cookies should be controlled with
`credentials` and matching server CORS headers.

The built-in adapter owns the JSON request/response details. Network failures
and server-side structured errors are surfaced as `ServerFunctionError`.

### Custom Adapter (e.g., WebSocket)

Implement a `TransportAdapter` for custom protocols:

```tsx
import { initTransport } from "@evjs/ev/transport";
import type { TransportAdapter } from "@evjs/ev/transport";

const wsAdapter: TransportAdapter = {
  send: async (fnId, args) => {
    // Implement your WebSocket or custom protocol here
  },
};

initTransport({ adapter: wsAdapter });
```

Custom adapters own their protocol configuration. The optional `context` passed
to `send(fnId, args, context)` contains only the per-call `signal` value.

### Server Config

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  server: {
    basePath: "/__evjs", // derives /__evjs/fn for server functions
  },
});
```

## Error Handling

### Server Side

Throw structured errors with status codes and data:

```ts
import { ServerError } from "@evjs/ev/server-context";

export async function getUser(id: string) {
  const user = await db.users.findById(id);
  if (!user) {
    throw new ServerError("User not found", {
      status: 404,
      data: { id },
    });
  }
  return user;
}
```

### Client Side

Catch typed errors:

```tsx
import { ServerFunctionError } from "@evjs/ev/transport";

try {
  const user = await getUser("123");
} catch (e) {
  if (e instanceof ServerFunctionError) {
    console.log(e.message);  // "User not found"
    console.log(e.status);   // 404
    console.log(e.data);     // { id: "123" }
  }
}
```

## What gets included

During `ev dev` and `ev build`, evjs validates reachable `"use server"`
modules and makes their named functions callable. You do not need to author an
endpoint or client proxy.

Unsupported exports are reported before the bundler runs.
For example, `export default`, `export const VERSION = "1"`, and
`export declare function getUser()` are not server functions.
Runtime re-exports such as `export { getUser } from "./other"` are also
unsupported.

Only modules reachable from application code are included. Remove an import
when a server function should stay outside the application.

## Key Points

| Pattern | Usage |
|---------|-------|
| Query | `useQuery(fn, ...args)` |
| Suspense query | `useSuspenseQuery(fn, ...args)` |
| Mutation | `useMutation(fn)` or `useMutation(fn, { onSuccess })` |
| Cache invalidation | `getFnQueryKey(fn, ...args)` |
| Loader / prefetch | `getFnQueryOptions(fn, ...args)` → `{ queryKey, queryFn }` |
| Arguments | Spread: `useQuery(getUser, id)` not `useQuery(getUser, [id])` |
| Server errors | `ServerError` on server → `ServerFunctionError` on client |
