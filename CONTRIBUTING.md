# Contributing to evjs

> Development guide for the evjs monorepo.

## Project Identity

- **Repository**: `afx-team/evjs`
- **Package scope**: `@evjs/*`
- **CLI command**: `ev`
- **Modules**: ESM-only package output
- **Formatting and linting**: Biome

## Package Ownership

| Package | Responsibility |
| --- | --- |
| `@evjs/cli` | CLI commands and default Utoopack selection. |
| `@evjs/ev` | Framework config, plugins, graph/build planning, generated IR, HTML, output linking, and deployment helpers. |
| `@evjs/create-app` | Project scaffolding. |
| `@evjs/plugin-qiankun` | Optional qiankun integration. |
| `@evjs/shared` | Shared helpers and manifest contracts. |
| `@evjs/client` | Browser and framework client runtime primitives. |
| `@evjs/server` | Hono/Fetch and framework server runtime primitives. |
| `@evjs/bundler-utoopack` | Default bundler adapter. |
| `@evjs/bundler-webpack` | Validation/fallback bundler adapter. |

The workspace dependency graph is intentionally one-directional:

```txt
@evjs/cli
  ├─> @evjs/ev
  └─> @evjs/bundler-utoopack

@evjs/ev
  ├─> @evjs/client
  ├─> @evjs/server
  └─> @evjs/shared

@evjs/client
  -> @evjs/shared

@evjs/server
  -> @evjs/shared

@evjs/bundler-utoopack / @evjs/bundler-webpack
  ├─> @evjs/ev
  └─> @evjs/shared

@evjs/plugin-qiankun
  -> @evjs/ev
```

Internal workspace dependency versions remain `"*"` in source manifests.
Release automation replaces them with the release version before publishing.

## Coding Rules

1. Keep imports at the top, use `import type` for type-only imports, and include
   `.js` on relative imports that survive compilation.
2. Keep framework semantics in `packages/ev/src/_internal/build` and shared
   contracts in `packages/shared/src/manifest`. Bundler adapters consume
   `BuildPlan` and return facts.
3. Keep the `@evjs/ev` root small. Use `@evjs/ev/config`, `/plugin`,
   `/deployment`, and the public application-authoring subpaths for their
   documented responsibilities. Reserve `@evjs/ev/_internal/*` for the CLI,
   adapters, and generated code.
4. Framework Pages use `src/pages/**/page.*`; server request Routes use
   `src/apis/**/api.*`. The containing directory owns scope and URL
   in both trees.
5. Put Page metadata, rendering settings, and the generated plugin map keyed by
   canonical plugin id in adjacent `page.config.ts`. Configure plugins at
   Application scope through factory calls in `config.plugins`; do not add Route
   or Document plugin configuration surfaces.
6. Server-function modules begin with `"use server";` and export named callable
   values. Use `.server.*` when colocation makes the boundary easier to see.
7. Keep `.ev`, `src/route-types.d.ts`, `src/plugin-types.d.ts`, `dist`,
   `.turbo`, and `node_modules` out of authored source and scaffold templates.
8. Prefer a subpath export on the package that owns a capability before adding
   a distributed package.
9. Update English and Chinese docs together when behavior changes. Keep release
   history in `CHANGELOG.md` and active implementation gaps in `ROADMAP.md`.
10. Keep package roots, public subpath `index.ts` files, and executable entry
    modules as stable façades. Put implementation in a named capability domain,
    and import focused leaf modules inside that domain instead of its barrel.
11. Name middleware list fields and arguments `middlewares`, matching
    `createApp()`, `createRoute()`, and `withMiddlewares(handler, middlewares)`.
    Use `MiddlewareHandler` for one function and `MiddlewareChain` for an
    ordered chain. Capability, hook, and module names stay singular:
    `server.request.middleware`, `clientDevMiddleware`, and `middleware.*`.
    Name concrete middleware factories by behavior, such as `requestLogger()`.

## Common Tasks

### Add a Page

1. Create `src/pages/<route>/page.tsx` and default-export the component.
2. Use `$param`, terminal `$...splat`, and `(group)` directories for dynamic,
   catch-all, and pathless segments.
3. Keep components, hooks, models, services, tests, styles, and assets in the
   Page directory; only `page.*` creates another Page.
4. Add adjacent `page.config.ts` for static metadata, rendering, or typed
   Page plugin settings.

### Add a server function

1. Create a reachable module that begins with `"use server";`.
2. Export named functions or supported named async values.
3. Call generated references through the public query or transport APIs.

### Add a server request Route

1. Create the URL directory below `src/apis`.
2. Add one `api.ts`, `api.tsx`, `api.js`, or `api.jsx` anchor.
3. Export uppercase HTTP method handlers.
4. Put helpers and shared middleware chains in ordinary colocated modules.
5. Compose individual methods with `withMiddlewares(handler, middlewares)`
   from `@evjs/ev/api`.
   That entry also exports `RouteHandlerFn`. Import middleware types and
   `requestLogger` from `@evjs/ev/middleware`, and request context helpers
   from `@evjs/ev/server-context`.

### Add global server middleware

1. Put individual middleware modules in `src/middlewares`.
2. Default-export one handler or an ordered non-empty list from
   `src/middlewares/middleware.ts`; use `satisfies MiddlewareChain` to type a
   list in TypeScript, imported from `@evjs/ev/middleware`.
3. Keep ordering explicit in that anchor; `index.*` and other sibling modules
   are ordinary source and are not auto-discovered.

### Add plugin-owned configuration

1. Declare independent Application and optional Page contracts with
   `definePlugin()` and `pluginOptions()`.
2. Install the factory in `config.plugins` and pass its typed Application
   options there.
3. Configure installed Page-aware plugins under their canonical id in adjacent
   `page.config.ts`. Page values are strict JSON; callbacks and
   secrets stay in Application options or plugin code.
4. Derive Route or Document behavior from the normalized Page graph and
   project runtime behavior explicitly through `emitIR()` or another
   runtime contract.

### Add an example

1. Create a private workspace under `examples/`.
2. Add `ev.config.ts`, source files, and an HTML template when needed.
3. Add or update create-app template mappings for user-facing starters.
4. Add an e2e case for behavior that crosses build/runtime boundaries.

## Build Pipeline

`ev prepare`, `ev build`, and `ev dev` complete semantic planning before
plugin setup:

```txt
load config
run configure hooks and resolve Application plugin settings
create CoreGraph while resolving Page plugin settings
collect generated contributions with emitIR/emitPageIR
derive BuildPlan
render the complete .ev image in memory
select the successful revision and publish it on publishing paths
run setup hooks
```

`ev inspect` is the write-free exception: it completes the same planning in
memory, then runs setup and dispose without publishing `.ev` or generated
types. A planning failure therefore never reaches setup on any path.

`ev build` then asks the selected bundler for fresh build facts, runs
`beforeBuild`, links and transforms `BuildOutput`, writes
deployment metadata and Documents, and runs `afterBuild` only after canonical
output is published. `prepare` and `inspect` do not run the before/after pair.

`ev dev` keeps normal source edits on the bundler watch/HMR path. A long-lived
Supervisor watches framework-owned inputs and prepares candidate revisions
without writing `.ev`. It compares a stable semantic fingerprint of config,
graph, plan, generated IR, plugin settings, and opaque dependency content.
Failed and semantically unchanged candidates never run setup. Only an accepted
candidate is published and set up as a new immutable Session with fixed config,
graph, plan, hooks, and adapter inputs; semantic no-ops keep the active Session.

Preparation errors keep the active Session and wait for another real input
change instead of retrying automatically. After replacement starts, errors are
fail-stop; do not attempt to resurrect or overlap a closed Session. Port
changes remain a manual `ev dev` restart. Dev adapters implement one immutable
`dev(context)` lifetime, honor its abort signal, return an idempotently
closable controller, and leave ordinary module watching and HMR adapter-owned.
Generated `.ev` state is disposable and must be reconstructible directly from
authored inputs.

## Focused Validation

Use Turbo filters while editing so workspace dependencies build through the
repository graph:

```bash
npx turbo run test --filter=@evjs/ev
npx turbo run test --filter=@evjs/shared
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

| Change area | Primary implementation | Focused validation |
| --- | --- | --- |
| Pages, routes, graph, and build plan | `packages/ev/src/_internal/build/discovery/page-routes.ts`, `graph/*`, `plan/*` | `npx turbo run test --filter=@evjs/ev` |
| API routes and middleware | `packages/ev/src/_internal/build/conventions/server-route-conventions.ts`, `discovery/server-routes.ts`, `discovery/server-conventions.ts` | `npx turbo run test --filter=@evjs/ev` |
| Configuration and package exports | `packages/ev/src/config`, package manifests | `npx turbo run test --filter=@evjs/ev` |
| Shared output contracts | `packages/shared/src/manifest` | `npx turbo run test --filter=@evjs/shared` |
| Server functions | `packages/ev/src/_internal/build/analysis/server-fns.ts`, client and server runtimes | `npx turbo run test --filter=@evjs/client --filter=@evjs/server` |
| SSR, SSG, PPR, and RSC | graph and plan code, client RSC, server rendering | `npx turbo run test --filter=@evjs/ev --filter=@evjs/client --filter=@evjs/server` |
| Bundler mapping | `packages/bundler-*/src/adapter/{config,development,execution,output}` | Test the affected bundler package. |
| Documentation | `docs/docs`, Chinese translations, package and example READMEs | `npm run lint`, `npm --workspace evjs-docs run build`, `git diff --check` |

## Commands

```bash
npm install
npm run build
npm run check-types
npm run lint
npm test
npm run test:e2e
git diff --check
```

Use focused Turbo filters while editing; run the repository gates before
submitting. Documentation changes should also build the docs workspace:

```bash
npm --workspace evjs-docs run build
```
