# AGENTS.md

> Entry point for coding agents working in the evjs monorepo.

Read this file first, then use the deeper guides when you need details:

- [AGENT.md](./AGENT.md) for package ownership, common mistakes, and focused test commands.
- [ARCHITECTURE.md](./ARCHITECTURE.md) for build graph, manifest, runtime, and deployment ownership.
- [CONTRIBUTING.md](./CONTRIBUTING.md) for contributor workflow and coding rules.
- [docs/docs/](./docs/docs) for user-facing API and framework behavior.

The file-convention source of truth is the convention matrix in
[docs/docs/project-structure.md](./docs/docs/project-structure.md). When a
change touches page routes, server functions, server routes, examples,
or scaffolds, update the English and Chinese project-structure docs together.
The implementation source for page-route file rules is
`packages/ev/src/build-tools/page-route-conventions.ts`; the discovery behavior
and diagnostics live in `packages/ev/src/build-tools/page-routes.ts`, with
coverage in `packages/ev/tests/build-tools-page-routes.test.ts`.

## Core Principles

- Framework-owned app structure is file-convention first. Client routes are
  discovered from `src/pages` through top-level `routing`; server request routes
  are discovered from `src/apis` through `server.routing`; server middleware is
  discovered from `src/middleware.ts` and `src/apis/**/middleware.ts`.
- `@evjs/ev` is the config, plugin, graph, build-plan, manifest, and deployment
  control plane. It owns convention discovery and composes generated framework
  output; its runtime-facing subpaths are curated authoring and generated-only
  entries, not generic runtime mirrors.
- `@evjs/client` and `@evjs/server` are independent runtime cores. Public
  client/server APIs live there and stay usable outside evjs file conventions.
  Their runtime APIs are not a second framework routing/configuration mode.

## Working Rules

1. Keep config/build/plugin imports on `@evjs/ev`. File-convention app source
   imports page helpers from `@evjs/ev/page`, request helpers from
   `@evjs/ev/request`, and custom transport helpers from `@evjs/ev/transport`.
   Standalone/manual runtime imports use `@evjs/client` and `@evjs/server`;
   `@evjs/ev` root does not re-export client or server runtime packages.
2. Do not add new distributed `@evjs/*` packages without first trying a subpath
   export on an existing package.
3. Keep framework semantics in `packages/ev/src/build-tools` and manifest
   contracts in `packages/shared/src/manifest`; bundler adapters consume
   `BuildPlan` and return build facts.
4. Treat `src/route-types.d.ts`, `dist`, `.turbo`, and `node_modules` as
   generated output. Scaffolded apps and template packs should not copy generated
   route types.
5. Page route conventions are strict: `src/pages`, `$param` dynamic segments,
   `index` for directory roots, `(group)` pathless route groups, `_`-prefixed
   private files, ignored colocated support files, and SPA layout source
   modules named `layout.*` or `layout/index.*`. Keep one page file per URL
   path, one parameter naming choice per dynamic URL shape, and unique
   generated route IDs. Do not add alternate filename dialects unless the build
   graph, docs, scaffolds, and generated route types are updated together.
6. Server file route conventions are strict: `src/apis`, `$param` dynamic
   segments, `index` for directory roots, `(group)` pathless route groups,
   uppercase HTTP method exports only, ignored helper files without route
   exports, and filesystem-scoped `middleware.ts`. Keep one server route module
   per URL path and one parameter naming choice per dynamic URL shape. Do not
   add `route.ts` sentinels, method suffix files, bracket routes, catch-all
   routes, optional params, route-module middleware exports, or a `server.entry`
   composition path.
7. Server functions must start with `"use server";` and export named callable
   functions or supported named async values. No default exports or runtime
   re-exports.
8. Non-CSR page rendering requires server output. PPR and RSC use
   `render: "ssr"` component pages; PPR plus RSC on one page is unsupported
   until the runtime explicitly supports it.
9. `createApp({ framework })` consumes generated `BuildOutput` manifests. Do
   not pass ad hoc manifest objects; use `createReactFrameworkServer()` unless
   a deployment adapter intentionally owns that contract.
10. Programmatic `@evjs/server` app and route APIs remain runtime primitives.
    evjs framework routing does not inspect or publish programmatic
    `createRoute()` declarations.
11. Utoopack is the default user path. Webpack is the validation/fallback adapter
   for framework features still blocked on lower-level Utoopack APIs.

## Validation

Use focused package checks while editing, then finish with the repo gates:

```bash
npm run check-types
npm run lint
npm test
git diff --check
```

For changes touching docs only, still run `npm run lint` and `git diff --check`;
run focused tests when the docs encode behavior covered by tests.
