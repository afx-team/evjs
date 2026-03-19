# Contributing to evjs

> Internal guide for developing the evjs monorepo.

## Project Identity

- **Name**: evjs (meta-framework), `@evjs/*` (package scope)
- **Repository**: evaijs/evjs
- **CLI command**: `ev` (binary from `@evjs/cli`)
- **Linter**: Biome (`npx biome check --write`)
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

## Coding Rules

1. **Imports**: All imports at top of file. Use `import type` for type-only imports.
2. **Linting**: Biome — no `any`, no `import * as` unless necessary.
3. **No manual server entries**: The framework generates server entry dynamically.
4. **No manual webpack configs**: Use `ev.config.ts` or zero-config defaults.
5. **Server function files**: Must start with `"use server";`, use `.server.ts` or `src/api/`.
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
1. Define route in `routes.tsx` with `createRoute({ getParentRoute, path, component })`
2. Add to route tree via `parentRoute.addChildren([newRoute])`

### Add a new example
1. Create directory under `examples/`
2. Add `package.json` with `"@evjs/cli": "*"` as devDep, `"private": true`
3. Add `src/main.tsx` + `index.html`
4. Symlink in `packages/cli/templates/` → `../../../examples/[name]`
5. Add to `packages/cli/scripts/restore-templates.js` symlink map

### Release a new version
1. Run `npm run changeset` to create a changeset describing the change
2. Push to `main` — CI will open a "Version Packages" PR
3. Merge the PR — CI publishes to npm automatically
4. **Do NOT bump versions locally** — the codebase keeps `"*"` for internal `@evjs/*` deps.

## Monorepo Commands

```bash
npm run build              # Build all packages + examples
npm run test               # Unit tests (vitest)
npm run test:e2e           # E2E tests (playwright)
npm run dev                # Dev mode (turborepo)
npx biome check --write    # Fix lint/format
npm run changeset          # Create a changeset
npm run version            # Apply changesets (CI does this)
npm run release            # Publish to npm (CI does this)
```

## Build System Internals

### `ev build` Flow

1. `resolveWebpackConfig(cwd)` — loads `ev.config.ts` or uses zero-config defaults
2. `createWebpackConfig(evjsConfig)` — generates webpack config object (no temp files)
3. Calls `webpack()` Node API directly
4. `@evjs/webpack-plugin` runs as a webpack plugin:
   - Discovers `*.server.ts` files via glob
   - Applies SWC transforms (client + server variants)
   - Runs child compiler for server bundle
   - Emits `dist/manifest.json` with server function registry

### `ev dev` Flow

1. Same config resolution as `ev build`
2. Starts `WebpackDevServer` for client
3. Uses `compiler.hooks.done` to detect server bundle
4. Auto-starts Node API server via `@evjs/runtime/server/node`
5. Sets up proxy: `devServer.proxy["/api/fn"] → localhost:3001`

## Agent Skills

The `.agent/skills/` directory contains user-facing guides for building apps with evjs. If you change CLI commands, config options, or runtime APIs, please update the relevant skills.

Available skills: `init`, `dev`, `build`, `server-functions`
