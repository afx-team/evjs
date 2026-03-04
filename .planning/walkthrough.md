# Walkthrough

## Stage 1: Client-First SPA — Complete ✅

### What was built

`@evai/runtime` — a thin React framework over TanStack Router (code-based routing) and React Query.

**Core package** (`packages/runtime/`):
- [create-app.tsx](file:///Users/xusd320/Codes/github/evai/packages/runtime/src/client/create-app.tsx) — `createApp()` factory that wires Router + QueryClient + DOM mount
- [route.ts](file:///Users/xusd320/Codes/github/evai/packages/runtime/src/client/route.ts) — re-exports of route creation APIs, components, and hooks
- [client/index.ts](file:///Users/xusd320/Codes/github/evai/packages/runtime/src/client/index.ts) — client barrel export
- [server/index.ts](file:///Users/xusd320/Codes/github/evai/packages/runtime/src/server/index.ts) — server barrel export (stub)
- [index.ts](file:///Users/xusd320/Codes/github/evai/packages/runtime/src/index.ts) — root barrel re-export

**Example app** (`examples/basic-csr/`):
- Webpack-based client-only SPA with Home, About, and Posts pages
- Imports from `@evai/runtime/client`

### Package exports

```json
{
  ".":        { "types": "./esm/index.d.ts",        "import": "./esm/index.js" },
  "./client": { "types": "./esm/client/index.d.ts",  "import": "./esm/client/index.js" },
  "./server": { "types": "./esm/server/index.d.ts",  "import": "./esm/server/index.js" }
}
```

### Peer dependencies

- `react >= 18.0.0`
- `react-dom >= 18.0.0`

### Tooling

- **Biome** configured at root for linting and formatting
- **Turborepo** for monorepo orchestration
- **Webpack** as the default bundler for examples

### Validation

- `npm run check-types` — passes across all packages and examples
- `npm run build` — compiles `@evai/runtime` via `tsc` and bundles `basic-csr` via Webpack
- Dev server runs at `http://localhost:3000`

## Key decisions

| Decision | Rationale |
|----------|-----------|
| Package name `@evai/runtime` | Reflects broader scope beyond routing — includes rendering, data fetching, and future SSR |
| `react`/`react-dom` as `peerDependencies` (≥18) | Consumers provide their own React — supports both React 18 and 19 |
| Barrel exports as `.ts`, components as `.tsx` | Clean import paths; only files with JSX use `.tsx` |
| Webpack as default bundler | User preference; utoo/utoopack support removed |
