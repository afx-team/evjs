# AGENT.md

> Guide for AI coding agents working on the evjs fullstack framework.

## Package Map

| Package | Path | Key Files |
| --- | --- | --- |
| `@evjs/cli` | `packages/cli` | `src/index.ts`, `src/load-config.ts` |
| `@evjs/ev` | `packages/ev` | `src/config.ts`, `src/plugin.ts`, `src/bundler.ts`, `src/commands.ts`, `src/deployment.ts`, `src/build-tools/*` |
| `@evjs/create-app` | `packages/create-app` | `src/index.ts`, template restore scripts |
| `@evjs/shared` | `packages/shared` | `src/constants.ts`, `src/errors.ts`, `src/http.ts`, `src/manifest/*` |
| `@evjs/client` | `packages/client` | `src/app.tsx`, `src/transport.ts`, `src/page.ts`, `src/react.ts`, `src/rsc.ts`, `src/routes.ts`, `src/shell.ts`, `src/tanstack.ts` |
| `@evjs/server` | `packages/server` | `src/app.ts`, `src/framework.ts`, `src/react.ts`, `src/react-renderer.ts`, runtime adapters |
| `@evjs/bundler-utoopack` | `packages/bundler-utoopack` | `src/adapter/index.ts`, `src/adapter/create-config.ts`, `src/manifest-generator.ts` |
| `@evjs/bundler-webpack` | `packages/bundler-webpack` | `src/adapter.ts`, webpack validation path and tests |

There is no longer a public `@evjs/build-tools` or `@evjs/manifest` workspace package. The implementation moved into `@evjs/ev` internals and `@evjs/shared/manifest`.

## Coding Rules

1. All packages are ESM. Use `.js` extensions in relative imports that survive compilation.
2. Keep imports at the top and use `import type` for type-only imports.
3. Run Biome before finalizing changes.
4. Do not add generated `.evjs` production source files. Prefer runtime/library entries or bundler adapter mechanics.
5. Keep `@evjs/bundler-*` adapters semantic-free: they consume `BuildPlan` and return build facts.
6. `server.functions.endpoint` is not a public config option. Use `server.basePath`; runtime paths are derived into `BuildOutput.runtime.server`.
7. New TanStack code should import route helpers from `@evjs/client/tanstack`. Top-level `@evjs/client` remains compatible.
8. Utoopack remains the default. Do not present webpack as the normal user path; it is the validation/fallback backend for features blocked on Utoopack APIs.

## Key APIs

| API | Package | Purpose |
| --- | --- | --- |
| `defineConfig(config)` | `@evjs/ev` | Type-safe `ev.config.ts` helper |
| `createApp({ routeTree })` | `@evjs/client` | Compatibility SPA facade around TanStack Router and Query |
| TanStack route helpers | `@evjs/client/tanstack` | Recommended import surface for TanStack APIs |
| React page runtime | `@evjs/client/react` | Framework-managed component page mount/hydration |
| Shell runtime | `@evjs/client/shell` | Manifest-driven app/page/remote activation and shared scope negotiation |
| RSC client runtime | `@evjs/client/rsc` | React Flight client integration |
| `createApp({ routes, middlewares })` | `@evjs/server` | Server functions, REST routes, SSR/PPR/RSC framework requests |
| `createReactFrameworkServer()` | `@evjs/server/react` | React SSR/RSC framework server integration |
| `nodeDeploymentAdapter()` | `@evjs/ev` | Production Node deployment artifact and server module emission |

## Common Mistakes

1. Using old `@evjs/build-tools` or `@evjs/manifest` imports. Use internal `@evjs/ev` helpers or `@evjs/shared/manifest`.
2. Putting route ownership in plugin options. Use `apps.*.routes` or `pages.*.path`.
3. Reintroducing file-convention routing. The architecture is explicit config/static declaration based.
4. Watching every source file for graph invalidation. `fileDependencies` should stay narrower than the analysis closure.
5. Using `await import(href)` as the default browser shell loader. Shell modules are registered by scripts so lower browser targets and non-Vite bundlers are not tied to dynamic import comments.
6. Treating `server.functions` manifest output as user config.

## Testing

```bash
npm run lint
npm run check-types
npm run test
npm run test:e2e
```

For focused architecture work, also run the relevant package tests such as:

```bash
npm test --workspace @evjs/ev -- --run tests/build-tools-graph-plan.test.ts tests/deployment.test.ts tests/config.test.ts
npm test --workspace @evjs/client -- --run tests/shell.test.ts
npm test --workspace @evjs/bundler-webpack -- --run tests/adapter.test.ts
```

## Adding New Features

- Add framework semantics in `packages/ev/src/build-tools` and `@evjs/shared/manifest` first.
- Add bundler support by mapping `BuildPlan` to the selected adapter.
- Add runtime behavior under `@evjs/client/*` or `@evjs/server/*` according to ownership.
- Cover the feature in `examples/full-features` when it crosses graph, bundler, manifest, runtime, and server boundaries.
