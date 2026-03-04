# Stage 2: React Server Functions (Data/AJAX)

Server functions that behave like REST API calls — client sends JSON, server processes, returns JSON. No React DOM streaming (that's Stage 4).

## Architecture Overview

```
┌─────────────────────┐          POST /rpc/:fnId           ┌─────────────────────┐
│     Client Code     │  ──────────────────────────────▶  │    Server Runtime   │
│                     │                                    │                     │
│  import { getUser } │     { args: [...] }                │  fnId → getUser()   │
│  from "./user.server"│  ◀──────────────────────────────  │  execute & return   │
│                     │     { result: {...} }               │                     │
└─────────────────────┘                                    └─────────────────────┘
```

## How It Works

### 1. Developer writes server functions

```ts
// src/server/user.server.ts
"use server";

export async function getUser(id: string) {
  const user = await db.query("SELECT * FROM users WHERE id = ?", [id]);
  return user;
}

export async function updateUser(id: string, data: { name: string }) {
  await db.query("UPDATE users SET name = ? WHERE id = ?", [data.name, id]);
  return { ok: true };
}
```

### 2. Client imports and calls them like normal functions

```tsx
// src/pages/profile.tsx
import { getUser } from "../server/user.server";

function Profile() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    getUser("123").then(setUser);
  }, []);
  return <div>{user?.name}</div>;
}
```

### 3. Webpack transforms the code at build time

**Client bundle** — the actual server code is stripped and replaced with fetch stubs:
```ts
// transformed client output for user.server.ts
export function getUser(...args) {
  return __@evjs_rpc("user_server_getUser", args);
}
export function updateUser(...args) {
  return __@evjs_rpc("user_server_updateUser", args);
}
```

**Server bundle** — the original code stays intact, and a registry maps function IDs to real implementations.

## Proposed Changes

### Webpack Loader (`packages/runtime`)

#### [NEW] `src/webpack/server-fn-loader.ts`

A Webpack loader that:
1. Detects `"use server"` directive at file top
2. For client builds: replaces all exports with RPC stubs calling `__@evjs_rpc(fnId, args)`  
3. For server builds: keeps original code and registers exports in a function registry

#### [NEW] `src/webpack/plugin.ts`

A Webpack plugin that:
1. Injects the `__@evjs_rpc` runtime helper into client bundles
2. Generates function ID manifest for both client and server

---

### Client Runtime (`packages/runtime`)

#### [NEW] `src/client/rpc.ts`

The `__@evjs_rpc(fnId, args)` helper that:
1. Serializes args as JSON
2. Sends `POST /api/rpc` with `{ fnId, args }` body
3. Returns deserialized JSON response
4. Handles errors (throws on non-200)

---

### Server Runtime (`packages/runtime`)

#### [MODIFY] `src/server/index.ts`

Exports:
- `createHandler()` — creates an HTTP request handler that routes RPC calls to registered server functions
- `registerServerFn(fnId, fn)` — registers a server function (called by the transformed server bundle)

#### [NEW] `src/server/handler.ts`

The request handler that:
1. Accepts `POST /api/rpc` requests
2. Parses `{ fnId, args }` from the body  
3. Looks up the function in the registry
4. Calls it with `...args`
5. Returns `{ result }` or `{ error }` as JSON

---

### Example (`examples/basic-server-fns`)

#### [NEW] Example project

- Webpack config with two entry points: client + server
- A server function file demonstrating data fetch
- Client page calling the server function
- Express/Node server using `createHandler()` from `@evjs/runtime/server`

## Build Pipeline

```
webpack.config.cjs (multi-compiler)
├── Client Compiler
│   ├── entry: src/main.tsx
│   ├── target: web
│   └── server-fn-loader: strips "use server" → RPC stubs
└── Server Compiler
    ├── entry: src/server.ts
    ├── target: node
    └── server-fn-loader: keeps code, adds registry calls
```

## Verification Plan

- `npm run build` — both client and server bundles compile
- `npm run dev` — starts server, serves client, server functions work end-to-end
- `npm run check-types` — all types pass
- Manual test: call a server function from a client component, verify JSON response
