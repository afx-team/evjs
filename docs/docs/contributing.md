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
3. **Page routes** — Source of truth is `src/pages` by default. Route files use
   `.tsx`, `.jsx`, `.ts`, or `.js`; dynamic segments use `$param`; `index` maps
   to the directory root; `(group)` segments are pathless; `_`-prefixed
   files/folders are private; bracket, catch-all, empty, and optional segments
   are unsupported
4. **Layouts** — SPA root layouts are discovered from a single `layout.*` or
   `layout/index.*` source module beside the route directory. SPA route layouts
   live inside the route directory as `layout.*` or `layout/index.*`. MPA
   routing does not consume framework layouts
5. **Server functions** — Must start with `"use server";`, use `.server.ts` or `src/api/`
6. **Server function exports** — Named callable exports only: function
   declarations or `const` arrow/function expressions. No default exports,
   cross-module re-exports, or exported non-function values
7. **Config file** — Named `ev.config.ts` (not `evjs.config.ts`)
8. **Package boundaries** — Config/build imports stay on `@evjs/ev`; runtime
   imports use `@evjs/client` and `@evjs/server`. Use subpath exports on the
   package that owns the behavior before adding another distributed package.
   Subpath exports stay intentional and documented; do not add convenience
   aliases. `@evjs/cli` owns the default Utoopack adapter; `@evjs/shared` is a
   shared contract package, not an app API
9. **Rendering contracts** — Non-CSR render modes require `server` output. PPR
   and RSC require component page modules with `render: "ssr"`, and PPR + RSC on
   the same page is unsupported until the runtime supports that combination
## Common Tasks

### Add a new server function
1. Create `src/api/[name].server.ts`
2. Add `"use server";` at the top
3. Export named function declarations or `const` async function expressions
4. Import and use in client with `useQuery(fn)` or `useMutation(fn)`

### Add a new route
1. Add a page file under `src/pages`
2. Use `$param` for dynamic segments and `index.tsx` for directory roots
3. Put page-local loader/search/render metadata next to the default component export

### Add a new example
1. Create directory under `examples/`
2. Add `package.json` with `"@evjs/cli": "*"` as devDep
3. Add `src/pages/index.tsx` + `index.html`
4. Create symlink in `packages/create-app/templates/`
5. Add an e2e test in `e2e/cases/`

### Release a new version
1. Create a GitHub Release with a tag like `v0.1.0`
2. The release workflow automatically syncs versions and publishes to npm
3. **Do NOT bump versions locally** — the codebase uses `"*"` for internal deps
