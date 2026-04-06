# Contributing to evjs

> Internal guide for developing the evjs monorepo.

## Project Identity

- **Name**: evjs (fullstack framework), `@evjs/*` (package scope)
- **Repository**: evaijs/evjs
- **CLI command**: `ev` (binary from `@evjs/cli`)
- **Linter**: Biome (`npx biome check --write`)
- **Node**: ESM-only (`"type": "module"` in all packages)

## Package Map

| Package | Path | Purpose |
|---------|------|---------|
| `@evjs/cli` | `packages/cli` | CLI binary (`ev dev`, `ev build`) |
| `@evjs/ev` | `packages/ev` | Config, plugin, and bundler types (`defineConfig`) |
| `@evjs/create-app` | `packages/create-app` | Project scaffolding (`npx @evjs/create-app`) |
| `@evjs/shared` | `packages/shared` | Runtime shared: errors, HTTP utils, constants |
| `@evjs/client` | `packages/client` | Client (React + TanStack) |
| `@evjs/server` | `packages/server` | Server (Hono) |
| `@evjs/build-tools` | `packages/build-tools` | Bundler-agnostic server function transforms (SWC) |
| `@evjs/manifest` | `packages/manifest` | Shared manifest schema types (`ManifestV1`) |
| `@evjs/bundler-webpack` | `packages/bundler-webpack` | Webpack adapter wrapping build-tools |

### Dependency Graph

```
@evjs/cli ──► @evjs/ev, @evjs/bundler-webpack
@evjs/bundler-webpack ──► @evjs/ev, @evjs/build-tools, @evjs/manifest
@evjs/ev ──► @evjs/manifest, @evjs/shared

@evjs/shared (zero deps — runtime only)
@evjs/client ──► @evjs/shared, @tanstack/react-router, @tanstack/react-query
@evjs/server ──► @evjs/shared, hono, @hono/node-server
```

## Coding Rules

1. **Imports**: All imports at top of file. Use `import type` for type-only imports.
2. **Linting**: Biome — no `any`, no `import * as` unless necessary.
3. **No manual server entries**: The framework generates server entry dynamically.
4. **No manual webpack configs**: Use `ev.config.ts` or convention-based defaults.
5. **Server function files**: Must start with `"use server";`. We recommend the `.server.ts` suffix or placing them in `src/api/`.
6. **Server function exports**: Must be named async function exports (no default exports).
7. **Module type**: All packages are ESM (`"type": "module"`). Use `.js` extensions in relative imports within compiled output.
8. **Config file**: Named `ev.config.ts` (not `evjs.config.ts`).
9. **Dependency resolution**: CLI uses `createRequire(import.meta.url)` for reliable loader resolution.

## Common Tasks

### Add a new server function
1. Create `src/api/[name].server.ts`
2. Add `"use server";` at the top
3. Export named async functions
4. Import and use in client with `query()` or `mutation()`

### Add a new route
1. Create a new file under `src/pages/` (e.g. `src/pages/about.tsx`)
2. Define route with `createRoute({ getParentRoute, path, component })` and export it
3. Import in `src/main.tsx` and add to route tree via `parentRoute.addChildren([newRoute])`

### Add a new example
1. Create directory under `examples/`
2. Add `package.json` with `"@evjs/ev": "*"` and `"@evjs/cli": "*"` as devDeps, `"private": true`
3. Add `src/main.tsx` + `index.html`
4. Create symlink in `packages/create-app/templates/` → `../../../examples/[name]`
5. Add to `packages/create-app/scripts/restore-templates.js` symlink map
6. Add an e2e test in `e2e/cases/[name].ts`

### Release a new version
1. Create a GitHub Release with a tag like `v0.1.0`
2. The release workflow automatically syncs the version to all packages and publishes to npm
3. **Do NOT bump versions locally** — the codebase keeps `"*"` for internal `@evjs/*` deps.

## Monorepo Commands

```bash
npm run build              # Build all packages + examples
npm run test               # Unit tests (vitest)
npm run test:e2e           # E2E tests (playwright)
npm run dev                # Dev mode (turborepo)
npx biome check --write    # Fix lint/format
```

## Build System Internals

### `ev build` Flow

1. `loadConfig(cwd)` — loads `ev.config.ts` or returns undefined for convention-based defaults
2. `createWebpackConfig(config, cwd)` — generates webpack config object (no temp files)
3. Calls `webpack()` Node API directly
4. `@evjs/bundler-webpack` runs as a webpack plugin:
   - Discovers `*.server.ts` files via glob
   - Applies SWC transforms (client + server variants)
   - Runs child compiler for server bundle
   - Emits `dist/server/manifest.json` and `dist/client/manifest.json`

### `ev dev` Flow

1. Same config resolution as `ev build`
2. Starts `WebpackDevServer` for client
3. Uses `compiler.hooks.done` to detect server bundle
4. Auto-starts Node API server via `@evjs/server/node`
5. Sets up proxy: `devServer.proxy["/api"] → localhost:3001`

## Agent Skills

The `skills/` directory contains user-facing guides for building apps with evjs. If you change CLI commands, config options, or runtime APIs, please update the relevant skills.

Available skill references: `init`, `dev`, `build`, `routing`, `server-fns`, `server-routes`, `config`
