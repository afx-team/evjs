# evjs — AI Agent Guide

> This file is optimized for AI coding agents. It describes the project structure, key APIs, patterns, rules, and common tasks.

## Project Identity

- **Name**: evjs (meta-framework), `@evjs/*` (package scope)
- **Repository**: [evaijs/evjs](https://github.com/evaijs/evjs)
- **CLI command**: `ev`
- **Config file**: `ev.config.ts` (optional — zero-config by default)
- **Linter**: Biome
- **Build**: Turborepo + npm workspaces

## Package Map

| Package | Path | Purpose |
|---------|------|---------|
| `@evjs/cli` | `packages/cli` | CLI (`ev init`, `ev dev`, `ev build`) + `defineConfig` |
| `@evjs/runtime` | `packages/runtime` | Client (React + TanStack) + Server (Hono) |
| `@evjs/build-tools` | `packages/build-tools` | Bundler-agnostic server function transforms (SWC) |
| `@evjs/manifest` | `packages/manifest` | Shared manifest schema types |
| `@evjs/webpack-plugin` | `packages/webpack-plugin` | Webpack adapter wrapping build-tools |

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for diagrams.
See [ROADMAP.md](./ROADMAP.md) for the roadmap.

## Configuration (`ev.config.ts`)

Optional — the framework works zero-config. When needed:

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  client: {
    entry: "./src/main.tsx",   // default
    html: "./index.html",      // default
    dev: { port: 3000 },       // dev server port
  },
  server: {
    endpoint: "/api/fn",       // server function endpoint
    runner: "@evjs/runtime/server/node",
    middleware: [],
    dev: { port: 3001 },       // API server port (dev)
  },
});
```

## Key APIs

### Client

```tsx
import { createApp, createRootRoute, createRoute } from "@evjs/runtime";
import { query, mutation } from "@evjs/runtime/client";
import { initTransport } from "@evjs/runtime/client";
```

- `createApp({ routeTree }).render("#app")` — mount app
- `query(fn).useQuery(args)` — data fetching hook
- `mutation(fn).useMutation()` — mutation hook
- `query(fn).queryOptions(args)` — for prefetching / cache

### Server Functions

```tsx
// src/api/users.server.ts
"use server";

export async function getUsers() {
  return await db.users.findMany();
}
```

- Files must start with `"use server";`
- Only **named async function exports** are supported
- Build system auto-transforms: client gets transport stubs, server keeps original bodies

### Server

```tsx
import { createApp } from "@evjs/runtime/server";
import { serve } from "@evjs/runtime/server";
import { createFetchHandler } from "@evjs/runtime/server/ecma";
```

- `createApp({ endpoint })` — Hono app with server function handler
- `serve(app, port)` — Node.js runner
- `createFetchHandler(app)` — ECMA adapter (Deno, Bun, Workers)

## Build System

The `@evjs/cli` CLI uses webpack Node API directly — no temp config files:

1. `ev build` → loads `ev.config.ts` (or uses zero-config defaults) → creates webpack config object → calls `webpack()` Node API
2. `ev dev` → same config → starts `WebpackDevServer` + watches for server bundle → auto-starts Node API server

Internally:
- `@evjs/webpack-plugin` handles server function discovery + child compiler
- `@evjs/build-tools` does the actual SWC transforms (bundler-agnostic)

## Query Patterns

Always use `query` / `mutation` proxies. Do **NOT** use `useQuery` with manual fetch.

```tsx
// Hook usage
const { data } = query(getUsers).useQuery([]);

// queryOptions (prefetch, cache invalidation)
const opts = query(getUsers).queryOptions([id]);
queryClient.prefetchQuery(opts);

// Cache invalidation — use stable evId
queryClient.invalidateQueries({ queryKey: [getUsers.evId] });

// Mutation — args as tuple
mutation(createUser).useMutation().mutate([{ name: "Alice" }]);
```

## Rules

1. **Imports**: All imports at top of file. Use `import type` for type-only imports.
2. **Linting**: Biome — no `any`, no `import * as` unless necessary.
3. **No manual server entries**: The framework generates server entry dynamically.
4. **No manual webpack configs**: Use `ev.config.ts` or zero-config defaults.
5. **Server function files**: Must start with `"use server";`, use `.server.ts` extension or `src/api/` directory.
6. **Server function exports**: Must be async functions with named exports.

## Common Tasks

### Add a new server function

1. Create `src/api/[name].server.ts`
2. Add `"use server";` at the top
3. Export async functions
4. Import and use on client with `query()` or `mutation()`

### Add a new route

1. Create route with `createRoute({ getParentRoute, path, component })`
2. Add to route tree via `parentRoute.addChildren([newRoute])`

### Add a new example

1. Create directory under `examples/`
2. Add `package.json` with `"@evjs/cli": "*"` as devDep
3. Add `src/main.tsx` + `index.html`
4. Scripts: `"dev": "ev dev"`, `"build": "ev build"`

## Monorepo Commands

```bash
npm run build           # Build all packages + examples
npm run test            # Unit tests (vitest)
npm run test:e2e        # E2E tests (playwright)
npm run dev             # Dev mode (turborepo)
npm run release:alpha   # Publish all packages (@evjs/*)
```
