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
| `@evjs/plugin-qiankun` | `packages/plugin-qiankun` | Optional qiankun master/slave micro-frontend bridge plugin |
| `@evjs/shared` | `packages/shared` | Runtime shared helpers plus `@evjs/shared/manifest` graph/plan/output schemas |
| `@evjs/client` | `packages/client` | Browser runtime core for standalone CSR, transport, page hooks, navigation helpers, and RSC client |
| `@evjs/server` | `packages/server` | Server runtime core for server functions, REST routes, SSR/PPR/RSC request coordination, and Node/fetch runtimes |
| `@evjs/bundler-utoopack` | `packages/bundler-utoopack` | Default Utoopack adapter; consumes `BuildPlan` and links `BuildOutput` where supported |
| `@evjs/bundler-webpack` | `packages/bundler-webpack` | Validation/fallback adapter for new architecture features that Utoopack cannot build yet |

`packages/build-tools` and `packages/manifest` no longer exist as public workspace packages. Build-tool helpers live in `packages/ev/src/_internal/build`; downstream tooling that only needs config loading can use `@evjs/ev/build-tools`. Manifest schemas/linkers live under `packages/shared/src/manifest`.

## Core Principles

- Framework-owned applications use one Page-and-Route file convention. Pages
  live at `src/pages/**/page.*`; the containing directory determines Page scope
  and URL, optional `page.config.ts` owns build-time Page capabilities, and
  `routing.mode` selects SPA/MPA output. Server file routes remain
  under `src/apis`, framework request middleware in `src/middleware.ts`, API
  route middleware in `src/apis/**/middleware.ts`, and server functions in
  reachable `"use server"` modules.
- `@evjs/ev` owns config, plugins, convention discovery, graph/build planning,
  manifest/deployment helpers, and bundler contracts. It should not expose
  client or server runtime mirrors; its runtime-facing subpaths are curated
  file-convention authoring and generated-only entries.
- `@evjs/client` and `@evjs/server` are runtime core packages. Their APIs can
  be used independently from evjs file conventions; do not treat programmatic
  server runtime APIs as framework route declarations.

## Dependency Graph

```txt
@evjs/cli
  -> @evjs/ev
  -> @evjs/bundler-utoopack

@evjs/ev
  -> @evjs/shared

@evjs/bundler-utoopack
  -> @evjs/ev
  -> @utoo/pack

@evjs/bundler-webpack
  -> @evjs/ev
  -> webpack

@evjs/client
  -> @evjs/shared
  -> @tanstack/react-router
  -> @tanstack/react-query

@evjs/server
  -> @evjs/client
  -> @evjs/shared
  -> hono
  -> @hono/node-server
```

Internal `@evjs/*` runtime dependency versions stay `"*"` in source manifests
for workspace development. Release automation rewrites those dependencies to the
concrete release version before publishing, so app-facing packages move together
and adapters depend on `@evjs/ev` instead of on each other.

## Coding Rules

1. Keep imports at the top of files and use `import type` for type-only imports.
2. Use Biome formatting and linting. Avoid `any` and broad namespace imports unless there is a concrete reason.
3. Do not add hidden production source files such as `.evjs/server/entry.ts`.
   Framework-owned entry composition belongs in the generated `.ev` IR, not in
   adapter-specific virtual entry loaders or ad hoc hidden source trees.
4. Keep framework semantics out of bundler adapters. Adapters consume `BuildPlan` and return build facts.
5. Server function files must start with `"use server";`, use `.server.*`
   filenames when colocated with route convention files, and export named
   functions or supported named async values.
6. Use `ev.config.ts`; new docs should import `defineConfig` from `@evjs/ev`.
7. Simple config imports stay on `@evjs/ev`. Advanced config utilities use
   `@evjs/ev/config`, plugin authoring details use `@evjs/ev/plugin`, config-loading tooling can use `@evjs/ev/build-tools`, and
   CLI/adapter/generated code uses `@evjs/ev/_internal/*`. File-convention app source imports
   route data helpers from `@evjs/ev/route`, navigation helpers from `@evjs/ev/navigation`, query helpers from `@evjs/ev/query`, request helpers from `@evjs/ev/server-context`,
   and custom transport helpers from `@evjs/ev/transport`; standalone/manual
   runtime imports use `@evjs/client` and `@evjs/server`. Prefer a subpath
   export on the package that owns the behavior before adding another
   distributed package. Subpath exports stay intentional and documented; do not
   add convenience aliases.
8. Keep generated page bootstrap, server-function stubs, server runtime
   bootstrap, and shell runtime primitives behind focused generated-only
   `@evjs/ev/_internal/*` subpaths.
9. Use `server.basePath` for framework server runtime paths. Do not reintroduce public `server.functions.endpoint` config.
10. Do not reintroduce `server.entry` or framework-side source extraction of
    `createRoute()` calls. Server framework routes are file routes under
    `src/apis`; `@evjs/server`'s `createRoute()` remains a runtime package API.

## Common Tasks

### Add a server function

1. Create a reachable `[name].server.ts` module, colocated with the caller or
   related server route.
2. Add `"use server";` at the top.
3. Export named async functions.
4. Import and use them in client code with `useQuery(fn, ...args)`, `useMutation(fn)`, or `getFnQueryOptions(fn, ...args)`.

### Add a page route

1. Create `src/pages/<route>/page.tsx` and default-export a React component.
2. Use directory segments to express the URL: `$param` for a dynamic segment,
   terminal `$...splat` for a catch-all, and `(group)` for pathless grouping.
3. Keep Page-private components, hooks, models, and services inside that Page
   directory. A nested `components/index.tsx` stays private because only
   `page.*` is a Page anchor.
4. Put static Page title, supported named metadata, rendering fields, and
   namespaced plugin extensions in an adjacent `page.config.ts`; do not put
   them in component exports. Plugins explicitly project extension values
   needed at runtime.

### Add a server file route

1. Create a route module under `src/apis`.
2. Export uppercase HTTP method handlers such as `GET` or `POST`.
3. Keep helper exports out of route candidates; place helpers in colocated
   non-route modules and import them.
4. Add framework request middleware with `src/middleware.ts` or API route
   middleware with `src/apis/**/middleware.ts`, not route-module middleware
   exports.

### Migrate a stored Page application

1. Establish one directory for every published URL and move or rename its
   component entry to `page.tsx`.
2. Move `title`, supported named metadata, `render`, `hydrate`, `rsc`,
   `prerender`, and plugin-owned Page settings into adjacent `page.config.ts`.
3. Keep Page-private code in the Page directory; `_` prefixes are not required.
4. Configure only `routing.mode: "spa" | "mpa"` and use `ev inspect` to verify
   the resulting Page/Route/Document graph.

This source conversion is required before running Smallfish or evjs 0.2
applications on Core 0.3. Do not add a runtime compatibility switch.
Explicit `application.routes` and Bigfish route config may remain temporarily
as SPA-only route-tree migration inputs, but they cannot select MPA
materialization and new examples use the canonical Page tree.

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
createCoreGraph()
createBuildPlan()
selected bundler builds the BuildPlan
linkBuildOutput()
run buildOutput hooks
emit dist/deployment-metadata.json and HTML documents
run buildEnd({ output })
```

### `ev dev`

```txt
start from the same graph and BuildPlan pipeline
start selected bundler dev controller
serve HTML and manifest from framework state
component/style edits stay in bundler HMR
config/page-route/server-file-route/middleware convention edits rebuild graph and diff BuildPlan
call bundlerDevController.updatePlan(update) when the adapter supports it
```

Utoopack is still the default adapter. It supports HTML-only dev plan relinking;
some broader architecture features are currently validated through the webpack
adapter until Utoopack exposes the required lower-layer APIs.

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
