# AGENTS.md

> Repository instructions for coding agents working in the evjs monorepo.

## Start here

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) for package ownership, contributor
  workflow, and focused validation.
- Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing graph, build,
  runtime, bundler, or deployment ownership.
- Use [docs/docs/](./docs/docs) for public framework behavior.

The Page-and-Route authoring source of truth is the convention matrix in
[docs/docs/project-structure.md](./docs/docs/project-structure.md). Update its
English and Chinese versions together whenever pages, API routes, server
functions, examples, or scaffolds change.

Before editing, inspect the affected package, its tests, and the implementation
source listed below. When prose and tested behavior disagree, fix the prose or
the implementation rather than preserving the mismatch.

## Source map

| Concern | Implementation source | Primary coverage |
| --- | --- | --- |
| Page files and URL segments | `packages/ev/src/_internal/build/page-route-conventions.ts` | `page-routes.ts`, `packages/ev/tests/build-tools-page-routes.test.ts` |
| API route files and URL segments | `packages/ev/src/_internal/build/server-route-conventions.ts` | `server-routes.ts`, `packages/ev/tests/build-tools-server-routes.test.ts` |
| Global and route middleware | `packages/ev/src/_internal/build/server-conventions.ts` | `packages/ev/tests/build-tools-server-routes.test.ts`, `packages/ev/tests/commands.test.ts` |
| Public configuration and routing mode | `packages/ev/src/config/index.ts` | `packages/ev/tests/config.test.ts` |
| Graph and build planning | `packages/ev/src/_internal/build/graph/*`, `plan/*` | `packages/ev/tests/build-tools-graph-plan.test.ts` |
| Plugin settings and generated Page types | `packages/ev/src/config/plugins.ts`, `_internal/build/plugin-settings.ts`, `plugin-types.ts` | `packages/ev/tests/plugin-settings.test.ts`, `plugin-types.test.ts` |
| Shared output contracts | `packages/shared/src/manifest` | `packages/shared/tests/manifest.test.ts` |

## Working rules

1. Use `@evjs/ev` for simple configuration, its public authoring subpaths for
   application code, `@evjs/ev/plugin` for plugin authoring, and
   `@evjs/ev/deployment` for deployment helpers. Reserve
   `@evjs/ev/_internal/*` for the CLI, adapters, and generated framework code.
2. Publish Pages only with `src/pages/**/page.*`, and keep exactly one
   supported `page.*` file in each Page directory. The directory determines the
   URL; other colocated files remain ordinary source.
   `application.routes` is an advanced SPA-only alternative to `routing` and
   uses `routes` for nesting.
3. Publish API routes only with `src/apis/**/api.*`, and keep exactly one
   supported `api.*` file in each route directory. Export uppercase HTTP
   methods, put global middleware in
   `src/middlewares/middleware.*` and route-specific middleware in
   `src/apis/**/middleware.ts`.
4. Server-function modules begin with `"use server";` and export supported named
   values. Adjacent `page.config.ts` owns static metadata, rendering choices,
   and page-level plugin options.
5. Install plugins through `config.plugins`. Keep application and page options
   independent, and derive route or document behavior from the page tree.
6. Keep framework semantics in `packages/ev/src/_internal/build` and shared
   contracts in `packages/shared/src/manifest`. Bundler adapters consume the
   build plan; they do not rediscover routes or rendering behavior. Utoopack is
   the default adapter and Webpack is the validation or fallback adapter.
7. Treat `.ev`, `src/route-types.d.ts`, `src/plugin-types.d.ts`, `dist`,
   `.turbo`, and `node_modules` as generated output. Do not edit them or copy
   them into scaffolds.
8. Keep English and Chinese documentation behaviorally equivalent. User docs
   should explain framework design and user workflows, not implementation call
   flow. Describe current behavior; keep release history in `CHANGELOG.md` and
   active gaps in `ROADMAP.md`.

## Validation

Use the focused commands in [CONTRIBUTING.md](./CONTRIBUTING.md) while editing.
Before submitting a repository change, run:

```bash
npm run check-types
npm run lint
npm test
git diff --check
```

For documentation-only changes, run `npm run lint`, build the documentation,
and run `git diff --check`. Add focused tests when prose defines a runtime
contract or a diagnostic URL.
