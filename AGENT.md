# evjs — AI Agent Guide

> This file is optimized for AI coding agents. It describes the project structure, key APIs, internal architecture, patterns, rules, and common tasks.

## Project Identity

- **Name**: evjs (meta-framework), `@evjs/*` (package scope)
- **Repository**: [evaijs/evjs](https://github.com/evaijs/evjs)
- **CLI command**: `ev` (binary from `@evjs/cli`)
- **Config file**: `ev.config.ts` (optional — zero-config by default)
- **Linter**: Biome (`npx biome check --write`)
- **Build**: Turborepo + npm workspaces
- **Test**: Vitest (unit) + Playwright (e2e)
- **Node**: ESM-only (`"type": "module"` in all packages)

## Package Map

| Package | Path | Purpose |
|---------|------|---------|
| `@evjs/cli` | `packages/cli` | CLI (`ev init`, `ev dev`, `ev build`) + `defineConfig` |
| `@evjs/runtime` | `packages/runtime` | Client (React + TanStack) + Server (Hono) |
| `@evjs/build-tools` | `packages/build-tools` | Bundler-agnostic server function transforms (SWC) |
| `@evjs/manifest` | `packages/manifest` | Shared manifest schema types (`ManifestV1`) |
| `@evjs/webpack-plugin` | `packages/webpack-plugin` | Webpack adapter wrapping build-tools |

### Dependency Graph

```
@evjs/cli
  ├── @evjs/webpack-plugin
  │     ├── @evjs/build-tools
  │     └── @evjs/manifest
  └── webpack / webpack-dev-server / swc-loader / @swc/core

@evjs/runtime (standalone, no internal deps)
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full diagrams.

### Request Flow (Server Functions)

```
Client                          Build Time                       Server
──────                          ──────────                       ──────
import { getUsers }       →  SWC transform strips body     →  original body kept
  from "./users.server"      replaces with __ev_call stub      registered via registerServerFn()

getUsers(args)            →  transport.send(fnId, args)    →  Hono route: POST /api/fn
                          →  codec.encode(args)            →  codec.decode(body)
                          ←  codec.decode(response)        ←  dispatch(fnId, args) → fn(args)
                          ←  returns result                ←  codec.encode(result)
```

### Transform Pipeline

```
Source: "use server"; export async function getUsers() { ... }

Client transform (@evjs/build-tools/transforms/client):
  → import { __ev_call, __ev_register } from "@evjs/runtime/client/transport";
  → export async function getUsers(...args) { return __ev_call(fnId, args); }
  → __ev_register(getUsers, fnId, "getUsers");

Server transform (@evjs/build-tools/transforms/server):
  → import { registerServerFn } from "@evjs/runtime/server";
  → export async function getUsers() { ... }  // body preserved
  → registerServerFn(fnId, getUsers);
```

## Configuration (`ev.config.ts`)

Optional — the framework works zero-config. When needed:

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  client: {
    entry: "./src/main.tsx",        // default
    html: "./index.html",           // default
    dev: {
      port: 3000,                   // webpack-dev-server port
      open: true,                   // auto-open browser
      historyApiFallback: true,     // SPA fallback (default: true)
    },
    transport: {
      baseUrl: "",                  // custom API base URL
      endpoint: "/api/fn",         // server function endpoint path
    },
  },
  server: {
    endpoint: "/api/fn",            // default
    runner: "@evjs/runtime/server/node",  // or custom runner module
    middleware: [
      "./src/middleware/auth.ts",   // paths to middleware modules
    ],
    dev: {
      port: 3001,                   // API server port (dev mode)
    },
  },
});
```

### Default Values (`CONFIG_DEFAULTS` in `config.ts`)

| Key | Default |
|-----|---------|
| `client.entry` | `"./src/main.tsx"` |
| `client.html` | `"./index.html"` |
| `client.dev.port` | `3000` |
| `server.endpoint` | `"/api/fn"` |
| `server.dev.port` | `3001` |
| `server.runner` | `"@evjs/runtime/server/node"` |

## Key APIs

### Client

```tsx
import { createApp, createRootRoute, createRoute } from "@evjs/runtime";
import { query, mutation, initTransport } from "@evjs/runtime/client";
```

| API | Purpose |
|-----|---------|
| `createApp({ routeTree })` | Bootstrap Router + QueryClient + render to DOM |
| `createAppRootRoute(opts)` | Root route with typed `context.queryClient` |
| `query(fn).useQuery(args)` | Data fetching hook (wraps TanStack `useQuery`) |
| `query(fn).queryOptions(args)` | For prefetching, cache, and loaders |
| `query(fn).queryKey()` | Stable query key for invalidation |
| `mutation(fn).useMutation()` | Mutation hook (wraps TanStack `useMutation`) |
| `createQueryProxy({ ...fns })` | Module-level query proxy object |
| `createMutationProxy({ ...fns })` | Module-level mutation proxy object |
| `initTransport(opts)` | Configure transport (baseUrl, endpoint, or custom) |

### Server Functions

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
- Build system auto-discovers these files (no manual registration)
- Arguments are passed as positional params, transported as a tuple

### Server

```tsx
import { createApp, serve, registerMiddleware } from "@evjs/runtime/server";
import { createFetchHandler } from "@evjs/runtime/server/ecma";
```

| API | Purpose |
|-----|---------|
| `createApp({ endpoint? })` | Hono app with server function handler |
| `serve(app, { port?, host? })` | Node.js HTTP server with graceful shutdown |
| `createFetchHandler(app)` | ECMA adapter for Deno, Bun, and other edge runtimes |
| `createHandler()` | Standalone Hono handler (for custom server setups) |
| `registerServerFn(id, fn)` | Register a server function (called by build tools) |
| `registerMiddleware(fn)` | Register middleware (auth, logging, etc.) |

### Error Handling

```ts
// Server side — throw structured errors
import { ServerError } from "@evjs/runtime";

export async function getUser(id: string) {
  const user = await db.users.find(id);
  if (!user) {
    throw new ServerError("User not found", { status: 404, data: { id } });
  }
  return user;
}

// Client side — catch typed errors
import { ServerFunctionError } from "@evjs/runtime/client";

try {
  const user = await getUser("123");
} catch (e) {
  if (e instanceof ServerFunctionError) {
    console.log(e.message);  // 'Server function "getUser" threw: User not found'
    console.log(e.data);     // { id: "123" }
  }
}
```

### Transport & Codec

**Transport** controls how data moves between client and server:

```tsx
import { initTransport } from "@evjs/runtime/client";

// HTTP (default)
initTransport({ endpoint: "/api/fn" });

// WebSocket
import { WebSocketTransport } from "@evjs/runtime/client";
initTransport({
  transport: new WebSocketTransport("ws://localhost:3001/ws"),
});

// Custom transport
initTransport({
  transport: {
    send: async (fnId: string, args: unknown[]) => {
      // custom implementation
    },
  },
});
```

**Codec** controls serialization format:

```tsx
// Default: JSON (built-in)
// Custom: implement serialize/deserialize
initTransport({
  codec: {
    serialize: (data) => msgpack.encode(data),
    deserialize: (buffer) => msgpack.decode(buffer),
    contentType: "application/msgpack",
  },
});
```

## Build System

### `ev build` Flow

1. `resolveWebpackConfig(cwd)` — loads `ev.config.ts` or uses zero-config defaults
2. `createWebpackConfig(evjsConfig)` — generates webpack config object (no temp files)
3. Calls `webpack()` Node API directly
4. `@evjs/webpack-plugin` runs as a webpack plugin:
   - Discovers `*.server.ts` files via glob
   - Applies SWC transforms (client + server variants)
   - Runs child compiler for server bundle
   - Emits `manifest.json` with server function registry

### `ev dev` Flow

1. Same config resolution as `ev build`
2. Starts `WebpackDevServer` for client
3. Uses `afterEmit` hook to detect server bundle
4. Auto-starts Node API server via `@evjs/runtime/server/node`
5. Sets up proxy: `devServer.proxy["/api/fn"] → localhost:3001`
6. Graceful shutdown on process exit

### Manifest (`manifest.json`)

```json
{
  "version": 1,
  "serverFunctions": {
    "getUsers": { "module": "./api/users.server", "export": "getUsers" },
    "createUser": { "module": "./api/users.server", "export": "createUser" }
  }
}
```

## Query Patterns

Always use `query` / `mutation` proxies. Do **NOT** use `useQuery` with manual fetch.

```tsx
// Hook usage
const { data } = query(getUsers).useQuery();

// With arguments (spread, not wrapped)
const { data } = query(getUser).useQuery(userId);

// queryOptions (prefetch, route loaders)
const opts = query(getUsers).queryOptions();
queryClient.ensureQueryData(opts);

// Cache invalidation via queryKey
queryClient.invalidateQueries({ queryKey: query(getUsers).queryKey() });

// Auto-invalidation on mutation success
const { mutate } = mutation(createUser).useMutation({
  invalidates: [getUsers],
});
mutate({ name: "Alice" });

// Route loader pattern
const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(query(getUsers).queryOptions()),
  component: UsersPage,
});
```

## Middleware

Middleware wraps server function calls (not HTTP requests):

```ts
import { registerMiddleware } from "@evjs/runtime/server";

// ctx has { fnId: string, args: unknown[] }
registerMiddleware(async (ctx, next) => {
  console.log(`Calling ${ctx.fnId}`);
  const start = Date.now();
  const result = await next();
  console.log(`${ctx.fnId} took ${Date.now() - start}ms`);
  return result;
});
```

Reference middleware in `ev.config.ts`:
```ts
export default defineConfig({
  server: {
    middleware: ["./src/middleware/auth.ts"],
  },
});
```

## Rules

1. **Imports**: All imports at top of file. Use `import type` for type-only imports.
2. **Linting**: Biome — no `any`, no `import * as` unless necessary.
3. **No manual server entries**: The framework generates server entry dynamically.
4. **No manual webpack configs**: Use `ev.config.ts` or zero-config defaults.
5. **No webpack.config.cjs fallback**: `ev.config.ts` is the sole config source.
6. **Server function files**: Must start with `"use server";`, use `.server.ts` or `src/api/`.
7. **Server function exports**: Must be named async function exports (no default exports, no arrow functions).
8. **Module type**: All packages are ESM (`"type": "module"`). Use `.js` extensions in relative imports within compiled output.
9. **Config file**: Named `ev.config.ts` (not `evjs.config.ts`, not `evjs.config.ts`).
10. **Dependency resolution**: CLI uses `createRequire(import.meta.url)` for reliable webpack/loader resolution.

## Common Tasks

### Add a new server function

1. Create `src/api/[name].server.ts`
2. Add `"use server";` at the top
3. Export named async functions
4. Import and use in `routes.tsx` with `query()` or `mutation()`

### Add a new route

1. Define route in `routes.tsx` with `createRoute({ getParentRoute, path, component })`
2. Add to route tree via `parentRoute.addChildren([newRoute])`
3. `main.tsx` stays unchanged for route additions

### Add a new example

1. Create directory under `examples/`
2. Add `package.json` with `"@evjs/cli": "*"` as devDep, `"private": true`
3. Add `src/main.tsx` + `index.html`
4. Scripts: `"dev": "ev dev"`, `"build": "ev build"`
5. Symlink in `packages/cli/templates/` → `../../../examples/[name]`
6. Add to `packages/cli/scripts/restore-templates.js` symlink map
7. Add to root `turbo.json` if needed

### Add a new transport

1. Implement `ServerTransport` interface: `{ send(fnId: string, args: unknown[]): Promise<unknown> }`
2. Export from a module
3. User calls `initTransport({ transport: new MyTransport() })`

### Release a new version

```bash
npm run release -- <version> <tag>
# Example: npm run release -- 0.0.1-rc.7 latest
```

This runs: version bump → turbo build → npm publish (all workspaces).

## Monorepo Commands

```bash
npm run build              # Build all packages + examples
npm run test               # Unit tests (vitest)
npm run test:e2e           # E2E tests (playwright)
npm run dev                # Dev mode (turborepo)
npx biome check --write    # Fix lint/format
npm run release -- <v> <t> # Publish all packages
```

## File Conventions

| Pattern | Meaning |
|---------|---------|
| `*.server.ts` | Server function file (must have `"use server"` directive) |
| `ev.config.ts` | Framework configuration file |
| `src/main.tsx` | Client entry — app bootstrap (keep minimal) |
| `src/routes.tsx` | Route tree + route components |
| `index.html` | HTML template |
| `src/api/` | Conventional location for server function files |
| `src/pages/` | Route components (for larger apps, split from routes.tsx) |
| `src/middleware/` | Conventional location for server middleware |

