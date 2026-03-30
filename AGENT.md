# AGENT.md

> Guide for AI coding agents working on the evjs meta-framework.

## Package Map

| Package | Path | Key Files |
|---------|------|-----------|
| `@evjs/cli` | `packages/cli` | `src/cli.ts` (CLI entry), `src/index.ts` (programmatic API: `dev`, `build`), `src/config.ts` (EvConfig types + defineConfig), `src/create-webpack-config.ts`, `src/load-config.ts` |
| `@evjs/create-app` | `packages/create-app` | `src/index.ts` (scaffolding logic) |
| `@evjs/shared` | `packages/shared` | `src/errors.ts` (ServerError, ServerFunctionError), `src/constants.ts`, `src/http.ts` |
| `@evjs/client` | `packages/client` | `src/query.ts` (useQuery, getFnQueryOptions), `src/transport.ts` (__fn_call, initTransport), `src/route.ts`, `src/context.ts` |
| `@evjs/server` | `packages/server` | `src/app.ts` (createApp), `src/functions/dispatch.ts`, `src/functions/register.ts`, `src/routes/route-handler.ts` |
| `@evjs/build-tools` | `packages/build-tools` | `src/transforms/index.ts`, `src/entry.ts`, `src/codegen.ts`, `src/types.ts` (RUNTIME constants), `src/utils.ts` |
| `@evjs/webpack-plugin` | `packages/webpack-plugin` | `src/index.ts` (EvWebpackPlugin + ManifestCollector), `src/server-fn-loader.ts` |
| `@evjs/manifest` | `packages/manifest` | `src/index.ts` (ManifestV1 types) |

## Coding Rules

1. **ESM only** — all packages use `"type": "module"`. Use `.js` extensions in relative imports within compiled output.
2. **Imports** — all imports at top, use `import type` for type-only imports.
3. **Linter** — Biome. No `any`, no `import * as`. Run `npx biome check --write` before committing.
4. **Server functions** — files must start with `"use server";`. We recommend the `.server.ts` suffix or `src/api/` convention.
5. **Server function exports** — named async functions only. No default exports, no arrow function exports.
6. **Config file** — named `ev.config.ts` (not `evjs.config.ts`).
7. **Dependency resolution** — CLI uses `createRequire(import.meta.url)` for loader path resolution.
8. **No manual server entries** — framework generates server entry dynamically via data URIs.
9. **No manual webpack configs** — `createWebpackConfig()` generates config in-memory.
10. **No cloud provider names** — use generic terms ("edge runtimes", "serverless platform").

## Key APIs

| API | Package | Purpose |
|-----|---------|---------|
| `createApp({ routeTree })` | `@evjs/client` | Client-side app factory (Router + QueryClient + DOM mount) |
| `createApp({ routeHandlers })` | `@evjs/server` | Server app factory (Hono + server function handler) |
| `useQuery(fn, ...args)` | `@evjs/client` | Type-safe query hook accepting server functions directly |
| `getFnQueryOptions(fn, ...args)` | `@evjs/client` | Convert server function to `{ queryKey, queryFn }` for loaders/prefetch |
| `route(path, definition)` | `@evjs/server` | Programmatic REST route handler |
| `defineConfig(config)` | `@evjs/cli` | Type-safe `ev.config.ts` helper |
| `transformServerFile(source, options)` | `@evjs/build-tools` | SWC-based "use server" file transform |
| `ServerError(message, { status, data })` | `@evjs/shared` | Structured error for server functions |

## Common Mistakes

1. ❌ Using `export default` for server functions → ✅ Use named exports only
2. ❌ Using arrow functions: `export const fn = async () =>` → ✅ Use `export async function fn()`
3. ❌ Wrapping args: `useQuery(fn, [id])` → ✅ Spread args: `useQuery(fn, id)`
4. ❌ Calling `useQueryClient()` outside React → ✅ Pass `queryClient` instance to utility functions
5. ❌ Using `invalidate()` method on proxy → ✅ Use `queryClient.invalidateQueries({ queryKey: fn.queryKey() })`
6. ❌ Forgetting `"use server";` directive → build-tools silently skips the file
7. ❌ Using global `useParams()` → ✅ Use route-scoped `myRoute.useParams()` for type safety

## Testing

```bash
npm run test         # Vitest unit tests across all packages
npm run test:e2e     # Playwright E2E tests
npx biome check .    # Lint + format check
```

## Adding New Features

- **New server function**: Create `src/api/[name].server.ts` (recommended) with `"use server";`, export named async functions
- **New route**: Define with `createRoute({ getParentRoute, path, component })`, add to route tree
- **New example**: Create `examples/[name]/`, add symlink in `packages/cli/templates/`, add E2E test in `e2e/cases/`
- **New route handler**: Use `route("/api/path", { GET, POST, ... })` and pass to `createApp({ routeHandlers })`
