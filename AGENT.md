# AGENT.md

> Guide for AI coding agents working on the evjs fullstack framework.

## Package Map

| Package | Path | Key Files |
| --- | --- | --- |
| `@evjs/cli` | `packages/cli` | `src/index.ts`, `src/load-config.ts` |
| `@evjs/ev` | `packages/ev` | `src/config.ts`, `src/plugin.ts`, `src/bundler.ts`, `src/commands.ts`, `src/deployment.ts`, `src/build-tools/*` |
| `@evjs/create-app` | `packages/create-app` | `src/index.ts`, template restore scripts |
| `@evjs/shared` | `packages/shared` | `src/build-identifier.ts`, `src/constants.ts`, `src/errors.ts`, `src/http.ts`, `src/page-route-data.ts`, `src/path-pattern.ts`, `src/server-function-id.ts`, `src/server-route-data.ts`, `src/manifest/*` |
| `@evjs/client` | `packages/client` | `src/app.tsx`, `src/navigation.ts`, `src/transport.ts`, `src/page-route.ts`, `src/page.ts`, `src/react.ts`, `src/rsc.ts`, `src/shell/*` |
| `@evjs/server` | `packages/server` | `src/app.ts`, `src/framework.ts`, `src/react.ts`, `src/react-renderer.ts`, `src/functions/*`, `src/routes/*`, `src/runtimes/*` |
| `@evjs/bundler-utoopack` | `packages/bundler-utoopack` | `src/adapter/index.ts`, `src/adapter/create-config.ts`, `src/manifest-generator.ts` |
| `@evjs/bundler-webpack` | `packages/bundler-webpack` | `src/adapter/index.ts`, `src/adapter/create-config.ts`, `src/manifest-generator.ts`, webpack validation tests |

There is no longer a public `@evjs/build-tools` or `@evjs/manifest` workspace package. The implementation moved into `@evjs/ev` internals and `@evjs/shared/manifest`.

## Core Principles

1. File conventions are the framework ownership model. `src/pages` plus
   `routing` owns client SPA/MPA routes; `src/apis` plus `server.routing` owns
   server file routes; `src/middleware.ts` and `src/apis/**/middleware.ts` own
   server middleware convention discovery.
2. `@evjs/ev` is the framework control plane for config, plugin hooks, graph
   analysis, build plans, manifests, deployment helpers, and convention
   discovery. Do not move runtime APIs into `@evjs/ev`.
3. `@evjs/client` and `@evjs/server` are runtime core packages. They expose
   standalone/runtime primitives that can be used independently from file
   conventions; evjs framework builds consume them through generated entries and
   manifests.
4. Programmatic `@evjs/server` APIs such as `createApp()` and `createRoute()`
   are runtime primitives, not a second evjs framework routing mode. The
   framework does not scan source files for programmatic route declarations.

## Coding Rules

1. All packages are ESM. Use `.js` extensions in relative imports that survive compilation.
2. Keep imports at the top and use `import type` for type-only imports.
3. Run Biome before finalizing changes.
4. Do not add generated `.evjs` production source files. Prefer runtime/library entries or bundler adapter mechanics.
5. Keep `@evjs/bundler-*` adapters semantic-free: they consume `BuildPlan` and return build facts.
6. `server.functions.endpoint` is not a public config option. Use `server.basePath`; runtime paths are derived into `BuildOutput.runtime.server`.
7. Page route code should use `src/pages`, page hooks, `Link`, and static page
   exports. TanStack route trees are a framework implementation detail for
   file-based SPA routing.
8. Server route code owned by the framework should use `src/apis` route modules
   with uppercase HTTP method exports. Do not add `server.entry`, `route.ts`
   sentinels, `foo.get.ts` method suffixes, or route-module middleware exports.
9. Application-facing runtime code should import page hooks, navigation,
   transport, and RSC helpers from `@evjs/client`, and
   server functions/routes/rendering APIs from `@evjs/server`.
   Generated page bootstrap, React page mounting, server-function stubs,
   route-tree construction, and shell runtime code belong behind focused
   generated-only `@evjs/client/internal/*` subpaths.
10. Utoopack remains the default. Do not present webpack as the normal user path; it is the validation/fallback backend for features blocked on Utoopack APIs.
11. Route/path/build-ID/server-function-ID conventions should use the shared
    helpers in `@evjs/shared` first. Keep caller-specific error text local, but
    avoid re-copying validation rules into config, build analysis, client
    runtime, or server runtime code.

## Key APIs

| API | Package | Purpose |
| --- | --- | --- |
| `defineConfig(config)` | `@evjs/ev` | Type-safe `ev.config.ts` helper |
| `src/pages` + `routing` | `@evjs/ev` | File-based SPA/MPA route source; users write page modules, not route trees |
| `src/apis` + `server.routing` | `@evjs/ev` | File-based server route source; users write Request/Response method modules |
| `createPagesApp()` | `@evjs/client/internal` | Internal/framework-managed page route runtime used by generated SPA entries |
| `Link`, page hooks, page metadata exports | `@evjs/client` / page modules | Public page authoring API for params, search, loader data, navigation, and render metadata |
| React page runtime | `@evjs/client/internal/react-page` | Framework-managed component page mount/hydration |
| Server-function stubs | `@evjs/client/internal/server-functions` | Generated client references for `"use server"` modules |
| Shell runtime | `@evjs/client/internal` | Manifest-driven app/page activation and generated module registration |
| RSC client runtime | `@evjs/client` | React Flight client integration |
| `createApp({ routes, middlewares })` | `@evjs/server` | Standalone server runtime app composition; independent from evjs file-convention discovery |
| `createReactFrameworkServer()` | `@evjs/server/react` | React SSR/RSC framework server integration |
| `nodeDeploymentAdapter()` | `@evjs/ev` | Production Node deployment artifact and server module emission |

## Common Mistakes

1. Using old `@evjs/build-tools` or `@evjs/manifest` imports. Use internal `@evjs/ev` helpers or `@evjs/shared/manifest`.
2. Putting route ownership in plugin options. Use `src/pages` for
   framework-managed SPA/MPA routes and `pages.*.path` only for lower-level
   standalone page outputs.
3. Exposing generated TanStack route trees, `__root.tsx`, or `.evjs` route
   files to application authors. The framework owns those details.
4. Adding extra page filename dialects. Dynamic segments use `$param`, route
   groups use `(group)` pathless segments, layout modules use `layout.*` or
   `layout/index.*`, and non-route support files in `src/pages` must follow the
   ignored private/hidden/test/story/client/server conventions.
5. Reintroducing alternate server composition paths. `server.entry` and
   programmatic `createRoute()` source extraction are not framework routing
   inputs; use `src/apis` file routes.
6. Watching every source file for graph invalidation. `fileDependencies` should stay narrower than the analysis closure.
7. Using `await import(href)` as the default browser shell loader. Shell modules are registered by scripts so lower browser targets and non-Vite bundlers are not tied to dynamic import comments.
8. Treating `server.functions` manifest output as user config.
9. Passing loose objects to `createApp({ framework })`. Framework server
   manifests must be generated `BuildOutput` shapes, and shared manifest shape
   validation belongs in `@evjs/shared/manifest`; use
   `createReactFrameworkServer()` unless an adapter intentionally owns that
   contract.
10. Reintroducing public packages for build tools, manifest helpers, router
   glue, or runtime internals. Prefer top-level public APIs or subpath exports
   on the existing package that owns the behavior.

## Testing

```bash
npm run lint
npm run check-types
npm run test
npm run test:e2e
```

Use focused package checks while editing, then run the repo gates before
finishing. Prefer the current npm workspace form so arguments are passed to the
workspace script predictably:

```bash
npm --workspace @evjs/ev test -- tests/build-tools-graph-plan.test.ts tests/deployment.test.ts tests/config.test.ts
npm --workspace @evjs/client test -- tests/shell.test.ts tests/page-runtime.test.ts
npm --workspace @evjs/server test -- tests/app.test.ts tests/react-renderer.test.ts
npm --workspace @evjs/bundler-webpack test -- tests/adapter.test.ts
```

| Surface | Primary files | Focused validation |
| --- | --- | --- |
| File route convention and SPA/MPA graph | `packages/ev/src/build-tools/page-route-conventions.ts`, `page-routes.ts`, `graph/index.ts`, `plan/index.ts` | `npm --workspace @evjs/ev test -- tests/build-tools-page-routes.test.ts tests/build-tools-graph-plan.test.ts tests/commands.test.ts` |
| Server file route and middleware conventions | `packages/ev/src/build-tools/server-routes.ts`, `server-conventions.ts`, `server-routes-entry.ts`, `graph/index.ts`, `plan/index.ts` | `npm --workspace @evjs/ev test -- tests/build-tools-server-routes.test.ts tests/build-tools-graph-plan.test.ts tests/commands.test.ts` |
| Config and package surface | `packages/ev/src/config.ts`, package manifests | `npm --workspace @evjs/ev test -- tests/config.test.ts tests/package-surface.test.ts` |
| Server functions and route handlers | `packages/server/src/app.ts`, `functions/*`, `routes/*`, `packages/client/src/transport.ts`, `packages/ev/src/build-tools/server-fns.ts` | `npm --workspace @evjs/server test -- tests/app.test.ts tests/dispatch.test.ts tests/register.test.ts tests/route-handler.test.ts` and `npm --workspace @evjs/client test -- tests/transport.test.ts` |
| SSR, SSG, PPR, and RSC | `packages/ev/src/build-tools/graph/index.ts`, `plan/index.ts`, `packages/server/src/framework.ts`, `react-renderer.ts`, `packages/client/src/rsc.ts` | `npm --workspace @evjs/ev test -- tests/build-tools-graph-plan.test.ts` and `npm --workspace @evjs/server test -- tests/react-renderer.test.ts tests/app.test.ts` |
| Bundler adapters | `packages/bundler-utoopack/src/adapter/*`, `packages/bundler-webpack/src/adapter/*` | `npm --workspace @evjs/bundler-utoopack test` and `npm --workspace @evjs/bundler-webpack test -- tests/adapter.test.ts` |
| Documentation-only behavior changes | `docs/docs/*`, `docs/i18n/*`, `README.md`, `AGENTS.md`, `AGENT.md` | `npm run lint`, `git diff --check`, plus the focused behavior test when prose encodes a runtime contract |

## Adding New Features

- Add framework semantics in `packages/ev/src/build-tools` and `@evjs/shared/manifest` first.
- If the feature changes file conventions, update English and Chinese
  `project-structure`, `file-conventions`, config, and relevant examples
  together.
- Add bundler support by mapping `BuildPlan` to the selected adapter.
- Add runtime behavior under `packages/client/src/*` or `packages/server/src/*`
  according to ownership. Export application-facing client APIs from
  `@evjs/client`, server APIs from `@evjs/server`, and keep generated bootstrap
  or shell primitives behind generated-only `@evjs/client/internal/*` subpaths.
- Cover cross-cutting behavior in the focused example that owns it:
  `examples/render-modes` or `examples/deployment-adapters`.
