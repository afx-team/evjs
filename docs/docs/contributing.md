# Contributing

> Internal guide for developing the evjs monorepo.

## Project Identity

- **Name**: evjs (fullstack framework), `@evjs/*` (package scope)
- **Repository**: [evaijs/evjs](https://github.com/evaijs/evjs)
- **CLI command**: `ev` (binary from `@evjs/cli`)
- **Linter**: Biome (`npx biome check --write`)
- **Module type**: ESM-only (`"type": "module"` in all packages)

## Setup

```bash
git clone https://github.com/evaijs/evjs.git
cd evjs
npm install
```

## Commands

```bash
npm run build              # Build all packages + examples
npm run test               # Unit tests (vitest)
npm run test:e2e           # E2E tests (playwright)
npm run dev                # Dev mode (turborepo)
npx biome check --write    # Fix lint/format
```

## Coding Rules

1. **Imports** — All imports at top of file. Use `import type` for type-only imports
2. **Linting** — Biome enforced; no `any`, no `import * as` unless necessary
3. **Server functions** — Must start with `"use server";`, use `.server.ts` or `src/api/`
4. **Server function exports** — Named async function exports only (no default exports)
5. **Config file** — Named `ev.config.ts` (not `evjs.config.ts`)

## Common Tasks

### Add a new server function
1. Create `src/api/[name].server.ts`
2. Add `"use server";` at the top
3. Export named async functions
4. Import and use in client with `query()` or `mutation()`

### Add a new route
1. Define route in `routes.tsx` with `createRoute()`
2. Add to route tree via `parentRoute.addChildren([newRoute])`

### Add a new example
1. Create directory under `examples/`
2. Add `package.json` with `"@evjs/cli": "*"` as devDep
3. Add `src/main.tsx` + `index.html`
4. Create symlink in `packages/cli/templates/`
5. Add an e2e test in `e2e/cases/`

### Release a new version
1. Create a GitHub Release with a tag like `v0.1.0`
2. The release workflow automatically syncs versions and publishes to npm
3. **Do NOT bump versions locally** — the codebase uses `"*"` for internal deps
