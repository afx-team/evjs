# Contributing to evjs

> Internal guide for developing the evjs monorepo.

## Project Identity

- **Name**: evjs, `@evjs/*` package scope
- **Repository**: evaijs/evjs
- **CLI command**: `ev` from `@evjs/cli`
- **Linter**: Biome via `npm run lint` or `npx biome check --write`
- **Node packages**: ESM-only package output

## Package Map

| Package | Path | Purpose |
| --- | --- | --- |
| `@evjs/cli` | `packages/cli` | CLI binary and programmatic command entrypoints |
| `@evjs/ev` | `packages/ev` | Config, plugin lifecycle, graph analysis, build planning, HTML, deployment helpers, and bundler adapter contracts |
| `@evjs/create-app` | `packages/create-app` | Project scaffolding from examples/templates |
| `@evjs/shared` | `packages/shared` | Runtime shared helpers plus `@evjs/shared/manifest` graph/plan/output schemas |
| `@evjs/client` | `packages/client` | Browser runtime, transport, React page runtime, shell, route DSL, RSC client, and TanStack compatibility subpath |
| `@evjs/server` | `packages/server` | Server functions, REST routes, SSR/PPR/RSC request coordination, and Node/fetch runtimes |
| `@evjs/bundler-utoopack` | `packages/bundler-utoopack` | Default Utoopack adapter; consumes `BuildPlan` and links `BuildOutput` where supported |
| `@evjs/bundler-webpack` | `packages/bundler-webpack` | Validation/fallback adapter for new architecture features that Utoopack cannot build yet |

`packages/build-tools` and `packages/manifest` no longer exist as public workspace packages. Build-tool helpers live under `packages/ev/src/build-tools`, and manifest schemas/linkers live under `packages/shared/src/manifest`.

## Dependency Graph

```txt
@evjs/cli
  -> @evjs/ev
  -> @evjs/bundler-utoopack

@evjs/ev
  -> @evjs/shared
  -> selected BundlerAdapter

@evjs/bundler-utoopack
  -> @evjs/ev
  -> @evjs/shared
  -> @utoo/pack

@evjs/bundler-webpack
  -> @evjs/ev
  -> @evjs/shared
  -> webpack

@evjs/client
  -> @evjs/shared
  -> @tanstack/react-router
  -> @tanstack/react-query

@evjs/server
  -> @evjs/shared
  -> hono
  -> @hono/node-server
```

## Coding Rules

1. Keep imports at the top of files and use `import type` for type-only imports.
2. Use Biome formatting and linting. Avoid `any` and broad namespace imports unless there is a concrete reason.
3. Do not add hidden production source files such as `.evjs/server/entry.ts`; framework-owned entries should be library/runtime entries or bundler adapter mechanics.
4. Keep framework semantics out of bundler adapters. Adapters consume `BuildPlan` and return build facts.
5. Server function files must start with `"use server";` and export named functions or supported named async values.
6. Use `ev.config.ts`; new docs should import `defineConfig` from `@evjs/ev`.
7. Keep TanStack-specific imports in `@evjs/client/tanstack` for new code. The top-level `@evjs/client` re-export remains for compatibility.
8. Use `server.basePath` for framework server runtime paths. Do not reintroduce public `server.functions.endpoint` config.

## Common Tasks

### Add a server function

1. Create `src/api/[name].server.ts`.
2. Add `"use server";` at the top.
3. Export named async functions.
4. Import and use them in client code with `useQuery(fn, ...args)`, `useMutation(fn)`, or `getFnQueryOptions(fn, ...args)`.

### Add a TanStack route

1. Create a route module under the app source tree.
2. Import TanStack helpers from `@evjs/client/tanstack`.
3. Add the route to the application's real `routeTree`.
4. If the framework must analyze the route graph, point `apps.*.routes` to the same route source file in `ev.config.ts`.

### Add a configured page

1. Add `pages.[id]` in `ev.config.ts`.
2. Use `{ entry }` for user-owned bootstrap pages or `{ component, render, hydrate }` for framework-managed pages.
3. Use `path` only when the framework server should route a URL to that page.
4. In dev, page additions should flow through `BuildPlanUpdate`; do not require restarting the ev dev server.

### Add an example

1. Create a directory under `examples/`.
2. Add a private `package.json` with workspace `@evjs/*` dependencies.
3. Add `ev.config.ts`, source files, and `index.html` as needed.
4. Add or update the create-app template mapping when the example is user-facing.
5. Add an e2e case under `e2e/cases/`.

## Build System Internals

### `ev build`

```txt
load ev.config.ts
run config/setup hooks
createAppGraph()
run appGraph hooks
createBuildPlan()
run buildPlan hooks
selected bundler builds the BuildPlan
linkBuildOutput()
run buildOutput hooks
emit dist/manifest.json and HTML documents
run buildEnd({ output })
```

### `ev dev`

```txt
start from the same graph and BuildPlan pipeline
start selected bundler dev controller
serve HTML and manifest from framework state
component/style edits stay in bundler HMR
config/route/server declaration edits rebuild graph and diff BuildPlan
call bundlerDevController.updatePlan(update, graph) when the adapter supports it
```

Utoopack is still the default adapter. Some new architecture features are currently validated through the webpack adapter until Utoopack exposes the required lower-layer APIs.

## Monorepo Commands

```bash
npm run build
npm run test
npm run test:e2e
npm run check-types
npm run lint
npx biome check --write
```

## Agent Skills

The local evjs skill and docs should be updated whenever CLI commands, config options, plugin hooks, runtime APIs, examples, or templates change.
