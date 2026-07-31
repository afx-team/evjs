# AGENTS.md

> Entry point for coding agents working in the evjs monorepo.

Read this file first, then use the focused guides when needed:

- [AGENT.md](./AGENT.md) for package ownership, common mistakes, and tests.
- [ARCHITECTURE.md](./ARCHITECTURE.md) for graph, build, runtime, and deployment ownership.
- [CONTRIBUTING.md](./CONTRIBUTING.md) for contributor workflow and coding rules.
- [docs/docs/](./docs/docs) for user-facing framework behavior.

The Page-and-Route authoring source of truth is the convention matrix in
[docs/docs/project-structure.md](./docs/docs/project-structure.md). Update its
English and Chinese versions together whenever page routes, server functions,
server routes, examples, or scaffolds change.

## Source Of Truth

| Concern | Canonical implementation | Discovery / coverage |
| --- | --- | --- |
| Page markers and URL segments | `packages/ev/src/_internal/build/page-route-conventions.ts` | `page-routes.ts`, `packages/ev/tests/build-tools-page-routes.test.ts` |
| Server request-route markers and URL segments | `packages/ev/src/_internal/build/server-route-conventions.ts` | `server-routes.ts`, `packages/ev/tests/build-tools-server-routes.test.ts` |
| Public config and SPA/MPA selection | `packages/ev/src/config/index.ts` | `packages/ev/tests/config.test.ts` |
| Semantic graph and build plan | `packages/ev/src/_internal/build/graph/*`, `plan/*` | `packages/ev/tests/build-tools-graph-plan.test.ts` |
| Typed plugin settings and generated Page types | `packages/ev/src/config/plugins.ts`, `_internal/build/plugin-settings.ts`, `plugin-types.ts` | `packages/ev/tests/plugin-settings.test.ts`, `plugin-types.test.ts` |
| Shared graph/output contracts | `packages/shared/src/manifest` | `packages/shared/tests/manifest.test.ts` |

## Architecture Rules

1. Framework-owned Pages use positive `src/pages/**/page.*` anchors. The
   containing directory owns the Page scope and determines its URL.
   `routing.mode` selects SPA or MPA materialization for the same semantic
   Page/Route tree.
2. Server request Routes use positive
   `src/apis/**/api.{ts,tsx,js,jsx}` anchors. Their directories
   determine request paths and filesystem middleware scope.
3. `@evjs/ev` is the framework control plane for config, plugins, graph
   analysis, build planning, generated IR, HTML, output linking, and deployment
   helpers. Framework semantics belong in
   `packages/ev/src/_internal/build`; shared contracts belong in
   `packages/shared/src/manifest`.
4. Bundler adapters consume `BuildPlan` and return build facts. They do not own
   route discovery, rendering semantics, or output identity.
5. `@evjs/client` and `@evjs/server` are independent runtime cores.
   Programmatic client route trees and server `createRoute()` declarations are
   runtime APIs, not file-convention inputs.
6. `.ev` is generated framework IR for graph/plan snapshots, entry facades,
   plugin artifacts, slots, import edges, and the final IR manifest.

## Working Rules

1. Keep simple config imports on `@evjs/ev`. Use `@evjs/ev/config` for advanced
   config utilities, `@evjs/ev/plugin` for plugin authoring,
   `@evjs/ev/deployment` for deployment helpers, and focused public authoring
   subpaths (`route`, `navigation`, `query`, `server-context`, `transport`) in
   file-convention application source. CLI, adapters, and generated code use
   `@evjs/ev/_internal/*`.
2. Prefer a subpath export on the package that owns a capability before adding
   another distributed package.
3. Keep exactly one supported `page.*` variant per Page directory. Static,
   `$param`, terminal `$...splat`, and `(group)` directories define client path
   segments. Other colocated files are ordinary Page source.
4. Explicit `application.routes` and `component`/`routes` configuration are
   SPA-only inputs into the same CoreGraph. They cannot be combined with
   canonical `routing`, cannot select MPA, and use `routes` rather than
   `children` for nesting.
5. Keep exactly one supported `api.*` variant per server Route directory and
   export uppercase HTTP method handlers. Framework middleware lives in
   `src/middleware.ts`; scoped request-route middleware lives in
   `src/apis/**/middleware.ts`.
6. Server functions start with `"use server";` and export named callable
   functions or supported named async values. They do not default-export or
   runtime re-export functions.
7. Adjacent build-time `page.config.ts` owns static title, named `meta`,
   `render`, `hydrate`, `prerender`, `rsc`, and the generated short-keyed
   `plugins` map. `meta` emits only `<meta name="..." content="...">`. CSR
   omits `hydrate`; PPR and RSC use `render: "ssr"` without Page-level
   hydration.
8. Applications install and configure plugins through `config.plugins`,
   normally as `pluginFactory(applicationOptions)`. Authors declare a stable
   `name`, one short `key` whenever Application or Page options exist, and
   independent contracts with `pluginOptions()`. The same key identifies both
   owner settings. Page values are strict JSON; the key may be omitted on a
   Page, set to `false`, set to `true` when defaults exist, or hold an options
   object according to the plugin's declared defaults and `withPageOptIn()`
   activation mode. Route and Document contributions derive from the normalized
   Page graph instead of exposing separate plugin configuration surfaces.
   `definePluginPreset()` is the only nested composition boundary; raw nested
   arrays and async entries are invalid. `.when(condition, reason?)` keeps
   contracts and generated Page keys installed while disabling execution,
   whereas falsy array entries omit the plugin and its Page keys. Ordering uses
   stable authored order plus required/present-optional dependency edges; do
   not reintroduce a global `enforce` tier. Public context config projects
   plugin/bundler metadata only. `prepare` and `inspect` analyze deterministic
   IR without activating `setup()` or `dispose()`.
9. Treat `.ev`, `src/route-types.d.ts`, `src/plugin-types.d.ts`, `dist`,
   `.turbo`, and `node_modules` as generated output. Scaffolds and templates
   must not copy generated route or plugin types. Keep declarations under
   `src` because normal application tsconfigs include `src` and exclude `.ev`.
10. `createApp({ framework })` consumes validated generated output contracts.
    Use the generated React framework server bridge unless a deployment adapter
    intentionally owns the runtime integration.
11. Utoopack is the default user path. Webpack is the validation/fallback
    adapter for capabilities that require its broader build or dev-update
    support.
12. Keep English and Chinese documentation behaviorally equivalent. Prefer
    declarative current behavior over migration history or speculative future
    design; release history belongs in `CHANGELOG.md` and active gaps belong in
    `ROADMAP.md`.

## Validation

Use focused package checks while editing, then finish with:

```bash
npm run check-types
npm run lint
npm test
git diff --check
```

For documentation-only changes, run `npm run lint`, build the documentation,
and run `git diff --check`. Add focused tests when the prose encodes a runtime
contract or a diagnostic URL.
