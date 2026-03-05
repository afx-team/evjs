# @evjs AI Agent Coding Guide

This guide provides context and patterns for AI agents (like Cursor, Copilot, and Gemini) to generate idiomatic code for the `@evjs` framework.

## Framework Architecture

- **Zero-Config**: The framework auto-discovers Server Functions and manages entries.
- **Port 3000**: Webpack Dev Server (Client HMR).
- **Port 3001**: API/Node Server (RPC Handler).
- **Communication**: The Client proxies `/api/*` requests to Port 3001.

## 1. Server Functions (`"use server"`)

Server functions MUST follow these rules:
- **Directive**: Must start with `"use server";` at the top.
- **Naming**: Files should ideally end in `.server.ts` or be placed in `src/api/`.
- **Exports**: Must be **async functions** and use **named exports**.
- **Transformation**: The build system automatically replaces bodies with RPC stubs on the client and registers them on the server.

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

## 3. Routing Patterns

`@evjs` uses `@tanstack/react-router`.
- **Root Route**: Use `createRootRoute`.
- **Pages**: Use `createRoute`.
- **Navigation**: Use `<Link to="/path">` or `useNavigate()`.

## 4. Coding Style Prefs

- **Top-Level Imports**: ALWAYS put all imports at the top of the file. No nested imports or mid-file imports allowed.
- **Biome Compliance**: Follow strict Biome linting rules:
  - Prefer `import type` for type-only imports.
  - Avoid `any` - use explicit types or `unknown`.
  - No namespace imports (`import * as`) unless strictly necessary (like `React` or internal API modules).
- **Type Safety**: Leverage tRPC-like inference via the proxies.
- **Invalidation**: Invalidate queries using the stable `evId`:
  ```tsx
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [api.query.getUsers.evId] });
  }
  ```
- **Mutation Arguments**: When using proxy mutations, pass arguments as a tuple: `mutate([arg1, arg2])`.
- **Cleanup**: Do not create manual `server.ts` or `server-entry.ts` files; the framework generates them dynamically.
