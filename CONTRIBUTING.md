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
4. Put helpers in other colocated modules and scoped middleware in
   `middleware.ts`.

### Add plugin-owned configuration

1. Declare independent Application and optional Page contracts with
   `definePlugin()` and `pluginOptions()`.
2. Install the factory in `config.plugins` and pass its typed Application
   options there.
3. Configure installed Page-aware plugins under their canonical id in adjacent
   `page.config.ts`. Page values are strict JSON; callbacks and
   secrets stay in Application options or plugin code.
4. Derive Route or Document behavior from the normalized Page graph and
   project runtime behavior explicitly through `contribute()` or another
   runtime contract.

### Add an example

1. Create a private workspace under `examples/`.
2. Add `ev.config.ts`, source files, and an HTML template when needed.
3. Add or update create-app template mappings for user-facing starters.
4. Add an e2e case for behavior that crosses build/runtime boundaries.

## Build Pipeline

`ev prepare`, `ev build`, and `ev dev` share the same semantic preparation:

```txt
load config
run configure hooks and resolve Application plugin settings
run setup hooks
create CoreGraph while resolving Page plugin settings
collect generated contributions with contribute/contributePage
derive BuildPlan
materialize .ev
```

`ev build` then asks the selected bundler for build facts, links `BuildOutput`,
runs `beforeBuild` after fresh facts, links and transforms output, writes
deployment metadata and Documents, and runs `afterBuild` only after canonical
output is published. `prepare` and `inspect` do not run the before/after pair.

`ev dev` keeps normal source edits on the bundler watch/HMR path. Framework
input changes recreate and diff the graph/plan, then call the adapter's
`updatePlan()` capability when needed.

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
