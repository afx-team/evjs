# @evjs AI Agent Coding Guide

This guide provides context and patterns for AI agents (like Cursor, Copilot, and Gemini) to generate idiomatic code for the `@evjs` framework.

## Framework Architecture

- **Zero-Config**: The framework auto-discovers Server Functions and manages entries.
- **Bundler-Agnostic Core**: `@evjs/build-tools` contains all build logic (entry generation, file transforms). Bundler plugins are thin adapters.
- **Port 3000**: Webpack Dev Server (Client HMR).
- **Port 3001**: API/Node Server (RPC Handler).
- **Communication**: The Client proxies `/api/*` requests to Port 3001.
- **Runtime-Agnostic**: The server app is a Hono instance, runnable on Node, Edge, or Bun via Runners.

## 1. Server Functions (`"use server"`)

Server functions MUST follow these rules:
- **Directive**: Must start with `"use server";` at the top.
- **Naming**: Files should ideally end in `.server.ts` or be placed in `src/api/`.
- **Exports**: Must be **async functions** and use **named exports**.
- **Transformation**: The build system automatically replaces bodies with transport stubs on the client and registers them on the server.

### Example
```typescript
// src/api/users.server.ts
"use server";

export async function getUser(id: string) {
  // Direct DB or API access here
  return { id, name: "User " + id };
}
```

## 2. Universal Query Proxy

Always use the **`query`** and **`mutation`** proxies exported from `@evjs/runtime/client`. Do NOT use standard `useQuery` with manual fetch calls for server functions.

### Key Patterns

#### A. Direct Wrapper (Recommended for single imports)
```tsx
import { query } from "@evjs/runtime/client";
import { getUsers } from "./api/users.server";

function Component() {
  const { data, isLoading } = query(getUsers).useQuery([]);
  // ...
}
```

#### B. Modular Proxy (Recommended for feature-based APIs)
```tsx
import { createQueryProxy, createMutationProxy } from "@evjs/runtime/client";
import * as UsersAPI from "./api/users.server";

const users = {
  query: createQueryProxy(UsersAPI),
  mutation: createMutationProxy(UsersAPI),
};

// Usage: users.query.getUsers.useQuery([])
```

#### C. Extensibility (`queryOptions`)
If you need to use the options with other TanStack utilities (like `prefetchQuery`):
```tsx
const options = query(getUsers).queryOptions([id]);
// useQuery(options), queryClient.fetchQuery(options), etc.
```

## 3. Webpack Plugin Configuration

```js
const { EvWebpackPlugin } = require("@evjs/webpack-plugin");

new EvWebpackPlugin({
  server: {
    // App factory (default: "@evjs/runtime/server#createApp")
    appFactory: "@evjs/runtime/server#createApp",
    // Runner (set for dev, omit for Edge-compatible production builds)
    runner: process.env.NODE_ENV === 'development'
      ? "@evjs/runtime/server#runNodeServer"
      : undefined,
    // Optional extra imports
    setup: [],
  },
})
```

## 4. Custom Transport

The client transport is pluggable via `configureTransport`:
```tsx
import { configureTransport } from "@evjs/runtime/client";

configureTransport({
  transport: {
    send: async (fnId, args, context) => {
      // Use any HTTP library or protocol
      const { data } = await axios.post("/api/rpc", { fnId, args });
      return data.result;
    },
  },
});
```

## 5. Routing Patterns

`@evjs` uses `@tanstack/react-router`.
- **Root Route**: Use `createRootRoute`.
- **Pages**: Use `createRoute`.
- **Navigation**: Use `<Link to="/path">` or `useNavigate()`.

## 6. Coding Style Prefs

- **Top-Level Imports**: ALWAYS put all imports at the top of the file.
- **Biome Compliance**: Follow strict Biome linting rules:
  - Prefer `import type` for type-only imports.
  - Avoid `any` - use explicit types or `unknown`.
  - No namespace imports (`import * as`) unless strictly necessary.
- **Type Safety**: Leverage tRPC-like inference via the proxies.
- **Invalidation**: Invalidate queries using the stable `evId`:
  ```tsx
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [api.query.getUsers.evId] });
  }
  ```
- **Mutation Arguments**: When using proxy mutations, pass arguments as a tuple: `mutate([arg1, arg2])`.
- **Cleanup**: Do not create manual `server.ts` or `server-entry.ts` files; the framework generates them dynamically.
