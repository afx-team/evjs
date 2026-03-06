# ev Framework

A React framework built for speed and simplicity, leveraging `@tanstack/react-router` for code-based routing and `@tanstack/react-query` for state management.

- **Repository**: [evaijs/evjs](https://github.com/evaijs/evjs)
- **Organization**: `@evjs`
- **CLI**: `ev`

## Roadmap

- [x] **Stage 1: Client-first SPA**
  - [x] `createApp()` factory (Router + Query + DOM)
  - [x] Code-based routing (via TanStack Router)
- [x] **Stage 2: React Server Functions**
  - [x] Pluggable server transport (`ServerTransport` interface)
  - [x] Webpack plugin with dynamic child-compiler & auto-discovery
  - [x] Runtime-agnostic API (Node, ECMA, Service Worker)
- [ ] **Stage 3: Production Readiness & Architecture**
  - [ ] **Parallel Compilation**: Move server build out of the `finishModules` blocked phase into a parallel sibling compiler for faster HMR.
  - [ ] **Smart Serialization**: Integrate `superjson` or `seroval` to support Complex JS types (Date, Map, Set, Error) across the RPC boundary.
  - [ ] **Server Context**: Implement `AsyncLocalStorage` to provide request context (Cookies, Headers, Auth) invisibly to server functions.
  - [ ] **Error Boundaries**: Standardize how server-side RPC errors reflect in the client UI.
- [ ] **Stage 4: Server-Side Rendering (SSR)**
  - [ ] HTML streaming & Hydration
- [ ] **Stage 5: React Server Components (RSC)**

## Packages

### `@evjs/runtime`
Core runtime providing isomorphic utilities.
- `client`: `createApp`, `createRoute`, `Outlet`, `Link`, `configureTransport`, `ServerTransport`.
- `server`: `createApp` (Hono, supports `rpcEndpoint` option), `runNodeServer` (Node runner), `registerServerFn`.
- `server/ecma`: `createHandler` — ECMA-standard adapter for Deno, Bun, Cloudflare Workers.
- Server powered by [Hono](https://hono.dev), runtime-agnostic (Node, Edge, Bun).

### `@evjs/manifest`
Shared manifest schema types used by webpack-plugin (producer) and runtime (consumer).
- `ServerManifest` — server manifest (`dist/server/manifest.json`, versioned v1).
- `ClientManifest` — client manifest (reserved for future `dist/client/manifest.json`).
- `ServerFnEntry`, `RscEntry`, `PageEntry`.

### `@evjs/cli`
Command-line interface for project management.
- `ev init [name]`: Scaffold a new project using dereferenced symlinks to examples.
- `ev dev`: Start unified dev server (Client HMR + Node Server Watch).
- `ev build`: Single-command optimized build for both client and server.

### `@evjs/build-tools`
Bundler-agnostic build utilities for server functions.
- `generateServerEntry(config, modules)`: Generates server entry source code.
- `transformServerFile(source, options)`: SWC-based transform for `"use server"` files.
- `detectUseServer()`, `makeFnId()`, `parseModuleRef()`: Pure utility functions.
- `codegen.ts`: `emitCode()` — SWC `parseSync → printSync` roundtrip for validated, formatted output.
- `types.ts`: `RUNTIME` constant — single source of truth for runtime identifiers (module paths, function names). No hardcoded strings in templates.
- `transforms/client/`: Generates `__ev_call` transport stubs.
- `transforms/server/`: Prepends `registerServerFn` calls + manifest reporting.
- `transforms/utils.ts`: Shared `extractExportNames` AST traversal.

### `@evjs/webpack-plugin`
Webpack adapter — thin wrapper over `@evjs/build-tools`.
- `EvWebpackPlugin`: Child compiler manager. Delegates entry generation and module discovery to `@evjs/build-tools`.
- `server-fn-loader`: Thin wrapper that calls `transformServerFile()` from build-tools.

## Key API

### `createApp(options)`
```tsx
import { createApp, createRootRoute } from "@evjs/runtime";
const rootRoute = createRootRoute({ component: Root });
createApp({ routeTree: rootRoute.addChildren([...]) }).render("#app");
```

### `query` and `mutation` Proxies
```tsx
import { query, mutation } from "@evjs/runtime/client";
import { getUsers } from "./api/users.server";

// 1. Hook usage
const { data } = query(getUsers).useQuery([]);

// 2. Extensibility usage (standard TanStack Query options)
const options = query(getUsers).queryOptions([]);
```

### Server Functions (`"use server"`)
```tsx
// api/users.server.ts
"use server";
export async function getUsers() {
  return await db.users.findMany();
}
```
Imported from client as a standard async function. The `@evjs/webpack-plugin` handles the transformation.

### Custom Endpoint
```tsx
import { configureTransport } from "@evjs/runtime/client";

// Point to a remote or custom-path RPC endpoint
configureTransport({
  baseUrl: "https://api.example.com",
  endpoint: "/server-function",  // default: "/api/rpc"
});
```

### Custom Transport
```tsx
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

## Architecture: Server Functions

- **Build-Tools Core**: `@evjs/build-tools` provides bundler-agnostic entry generation and file transformation.
- **Webpack Adapter**: `EvWebpackPlugin` calls `generateServerEntry()` + spawns a child compiler.
- **Dynamic Discovery**: Plugin scans client modules for `"use server"` files, passes paths to build-tools.
- **Client build**: `server-fn-loader` delegates to `transformServerFile()` → replaces bodies with `__ev_call(fnId, args)` stubs.
- **Server build**: `server-fn-loader` keeps bodies and injects `registerServerFn(fnId, fn)`.
- **Manifest**: Emitted to `dist/server/manifest.json`, mapping function IDs to build assets.
- **RPC Path**: Configurable via `createApp({ rpcEndpoint })` on the server and `configureTransport({ endpoint })` on the client. Default: `/api/rpc`.
- **Dev**: `ev dev` runs Webpack Dev Server (port 3000) and a watched Node process (port 3001).
- **Communication**: Reverse-proxy in Dev Server routes `/api/*` (or custom path) to the Node API server.
- **ECMA Adapter**: `server.entry.mjs` + `@evjs/runtime/server/ecma` enables deployment to Deno, Bun, Workers.
- **SW Adapter**: `swMock.entry.js` runs server functions inside a browser Service Worker (with Node.js mock APIs for testing).

## Monorepo Workflow

Managed with Turborepo and npm workspaces.
- `npm run build`: Build all libraries and examples.
- `npm run dev`: Concurrent development mode.
- `npm run release:alpha`: Build and publish all packages to `@evjs` scope.

## Server Function Rules

- **Directive**: Files must start with `"use server";`.
- **Naming**: Files should end in `.server.ts` or be placed in `src/api/`.
- **Exports**: Must be **async functions** with **named exports**.
- **Transformation**: Build system replaces bodies with transport stubs (client) or registers them (server).

## Query Patterns

Always use `query` / `mutation` proxies from `@evjs/runtime/client`. Do NOT use `useQuery` with manual fetch.

```tsx
// Direct wrapper
const { data } = query(getUsers).useQuery([]);

// Module proxy
const users = { query: createQueryProxy(UsersAPI) };
users.query.getUsers.useQuery([]);

// queryOptions (for prefetch, etc.)
const opts = query(getUsers).queryOptions([id]);
queryClient.prefetchQuery(opts);

// Invalidation — use the stable evId
queryClient.invalidateQueries({ queryKey: [getUsers.evId] });

// Mutation args — pass as tuple
mutation(createUser).useMutation().mutate([{ name: "Alice" }]);
```

## Coding Style

- **Imports**: All imports at top of file. Use `import type` for type-only imports.
- **Linting**: Biome — no `any`, no `import * as` unless necessary.
- **No manual server entries**: The framework generates `server-entry.ts` dynamically.
