# AGENT.md

> Package ownership and focused validation for the evjs monorepo.

## Package Map

| Package | Path | Responsibility |
| --- | --- | --- |
| `@evjs/cli` | `packages/cli` | CLI commands and default Utoopack selection. |
| `@evjs/ev` | `packages/ev` | Config, plugins, graph analysis, build planning, generated IR, HTML, output linking, and deployment helpers. |
| `@evjs/create-app` | `packages/create-app` | Project scaffolding and template restoration. |
| `@evjs/plugin-qiankun` | `packages/plugin-qiankun` | Optional qiankun bridge plugin. |
| `@evjs/shared` | `packages/shared` | Shared runtime helpers and manifest contracts. |
| `@evjs/client` | `packages/client` | Browser runtime, navigation, Page context, query transport, shell, and RSC client primitives. |
| `@evjs/server` | `packages/server` | Hono/Fetch runtime, request context, server functions/routes, and framework rendering. |
| `@evjs/bundler-utoopack` | `packages/bundler-utoopack` | Default bundler adapter. |
| `@evjs/bundler-webpack` | `packages/bundler-webpack` | Validation/fallback bundler adapter. |

## Core Model

- `src/pages/**/page.*` is the canonical Page and client Route anchor. The
  containing directory owns Page-private source and derives the URL.
- `routing.mode` selects SPA or MPA materialization without changing semantic
  Application, Page, Route, or Document identity.
- adjacent `page.config.ts` supplies static Page metadata, rendering settings,
  and a generated `plugins` map keyed by canonical ids for installed Page-aware
  plugins.
- top-level `config.plugins` installs plugin factories and supplies each
  plugin's independent Application configuration. Route and Document behavior
  is derived from normalized Pages rather than configured on separate owners.
- `application.routes` is an explicit SPA-only input into the same CoreGraph.
- `src/apis/**/api.*` supplies framework-managed request Routes;
  `src/middlewares/middleware.*` composes global middleware in export order,
  and route-tree `middleware.ts` supplies scoped middleware.
- reachable `"use server"` modules supply named server functions.
- `.ev` contains the generated graph/plan snapshots, entry facades, plugin
  modules, slots, import edges, and IR manifest compiled by bundler adapters.

## Import Map

| Import | Use |
| --- | --- |
| `@evjs/ev` | Basic config and Page-config authoring. |
| `@evjs/ev/config` | Advanced config utilities and resolved types. |
| `@evjs/ev/plugin` | Plugin descriptors, typed settings, hooks, and framework view. |
| `@evjs/ev/deployment` | Deployment artifact helpers and built-in adapters. |
| `@evjs/ev/route` | Page params, search, and loader data. |
| `@evjs/ev/navigation` | File-convention SPA navigation helpers. |
| `@evjs/ev/query` | Server-function query helpers. |
| `@evjs/ev/server-context` | Framework request context. |
| `@evjs/ev/transport` | Browser-to-framework-server transport. |
| `@evjs/client`, `@evjs/server` | Standalone/manual runtime applications. |
| `@evjs/ev/_internal/*` | CLI, bundler adapters, and generated framework code. |

All packages are ESM. Relative imports that survive compilation use `.js`
extensions, and type-only imports use `import type`.

## Common Mistakes

1. Treating a colocated `index.*`, component, hook, or model as a Page. Only a
   supported `page.*` anchor publishes a Page.
2. Treating `routing.mode` as a second routing model. It changes
   materialization only.
3. Mixing canonical `routing` with `application.routes`, selecting MPA for an
   explicit route tree, or nesting explicit routes with `children`.
4. Putting Page metadata or rendering fields on the component export instead
   of adjacent `page.config.ts`.
5. Putting callbacks or secrets in Page plugin values. Page settings are
   strict JSON graph data; executable options belong in the Application
   factory configuration or plugin code, and runtime projection is explicit.
6. Publishing server request Routes from basenames other than `api.*`, using
   lowercase method exports, or exporting route middleware from the anchor.
7. Scanning programmatic `@evjs/server` `createRoute()` calls as framework
   routes. They belong to the standalone runtime.
8. Recomputing route, runtime, or output semantics inside a bundler adapter.
   Consume `BuildPlan` and return build facts.
9. Watching every transitive source file as a graph root. Keep framework
   dependencies narrower than the bundler module graph.
10. Passing unvalidated objects to framework server integration. Generated
    runtime paths consume linked framework output contracts.

## Focused Validation

Prefer Turbo package filters so workspace dependencies are built through the
repository graph:

```bash
npx turbo run test --filter=@evjs/ev
npx turbo run test --filter=@evjs/client
npx turbo run test --filter=@evjs/server
npx turbo run test --filter=@evjs/bundler-utoopack
npx turbo run test --filter=@evjs/bundler-webpack
```

For a single test file, build the package graph first, then invoke that
workspace directly:

```bash
npx turbo run build --filter=@evjs/ev
npm --workspace @evjs/ev test -- tests/build-tools-graph-plan.test.ts
```

| Surface | Primary implementation | Focused validation |
| --- | --- | --- |
| Page convention and graph | `packages/ev/src/_internal/build/page-route-conventions.ts`, `page-routes.ts`, `graph/*`, `plan/*` | `npx turbo run test --filter=@evjs/ev` |
| Server routes and middleware | `server-route-conventions.ts`, `server-routes.ts`, `server-conventions.ts` | `npx turbo run test --filter=@evjs/ev` |
| Config and package surface | `packages/ev/src/config`, package manifests | `npx turbo run test --filter=@evjs/ev` |
| Shared contracts | `packages/shared/src/manifest` | `npx turbo run test --filter=@evjs/shared` |
| Server functions | `packages/ev/src/_internal/build/server-fns.ts`, client/server function runtimes | `npx turbo run test --filter=@evjs/client --filter=@evjs/server` |
| SSR, SSG, PPR, RSC | graph/plan, client RSC, server framework rendering | `npx turbo run test --filter=@evjs/ev --filter=@evjs/client --filter=@evjs/server` |
| Bundler mapping | `packages/bundler-*/src/adapter` and manifest generators | corresponding bundler package test |
| Documentation | `docs/docs`, Chinese translations, package/example READMEs | `npm run lint`, `npm --workspace evjs-docs run build`, `git diff --check` |

Finish repository changes with:

```bash
npm run check-types
npm run lint
npm test
git diff --check
```
