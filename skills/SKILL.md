---
name: evjs
description: Develop, migrate, review, or debug evjs applications and framework code involving ev.config.ts, Page routes, server functions, server request routes, rendering modes, plugins, bundlers, generated .ev IR, deployment, or ev dev/inspect/prepare/build.
---

# evjs Development

## Workflow

1. Determine whether the target is a file-convention application, a
   standalone runtime application, or the evjs framework repository.
2. Read the target `package.json`, `ev.config.ts`, Page tree, and relevant
   tests before editing. In the framework repository, read `AGENTS.md` and use
   implementation/tests as the behavior source of truth.
3. Use the canonical authoring model and public import boundary below.
4. Run `ev inspect --json` when discovery, graph ownership, rendering, or
   adapter capability needs verification.
5. Run the target workspace's focused type checks/tests plus lint and
   `git diff --check`.

## Canonical Authoring Model

- Enable Page discovery with `routing: { mode: "spa" | "mpa" }`.
- Publish Pages only with `src/pages/**/page.{ts,tsx,js,jsx}`. The containing
  directory owns Page-private source and determines the URL.
- Put static `title`, named `meta`, `render`, `hydrate`, `prerender`, `rsc`,
  and the generated Page `plugins` map keyed by canonical plugin id in adjacent build-time
  `page.config.ts`.
- Use `$param`, terminal `$...splat`, and `(group)` directories for dynamic,
  catch-all, and pathless client segments.
- Publish server request Routes only with
  `src/apis/**/api.{ts,tsx,js,jsx}` and uppercase HTTP method
  exports. Use `src/middleware.ts` globally and route-tree `middleware.ts` for
  scoped request-route middleware.
- Define server functions in reachable modules beginning with
  `"use server";` and export named callable values. `.server.*` is a naming
  convention, not the discovery mechanism.
- Treat `application.routes` as an explicit SPA-only input into the same
  CoreGraph. It cannot be combined with canonical `routing` or select MPA, and
  nested declarations use `routes`.
- Install plugins through `config.plugins`, normally as
  `pluginFactory(applicationConfig)`. Application and Page contracts remain
  independent; Page values are strict static JSON. Plugins derive Route and
  Document behavior from normalized Pages and explicitly project runtime
  behavior.

## Import Boundaries

- Use `@evjs/ev` for `defineConfig()` and `definePageConfig()`.
- Use `@evjs/ev/route`, `/navigation`, `/query`, `/server-context`, and
  `/transport` in file-convention application source.
- Use `@evjs/ev/plugin` for plugin authoring and `@evjs/ev/deployment` for
  deployment helpers.
- Use `@evjs/client` and `@evjs/server` only when the application intentionally
  owns standalone/manual runtime composition.
- Reserve `@evjs/ev/_internal/*` for the CLI, bundler adapters, and generated
  framework code.

## Generated And Runtime Boundaries

- Treat `.ev`, `src/route-types.d.ts`, `src/plugin-types.d.ts`, and `dist` as
  generated output. Keep generated declarations under `src` so the project
  TypeScript program consumes them.
- Bundler adapters consume `BuildPlan` and return build facts; framework
  semantics stay in `@evjs/ev`.
- `BuildOutput` is the complete in-memory result.
  `dist/deployment-metadata.json` is the canonical serialized deployment
  projection.
- Programmatic client route trees and `@evjs/server` `createRoute()` are
  standalone runtime APIs, not framework convention inputs.

## References

- [Quick start](../docs/docs/quick-start.md)
- [Project structure and convention matrix](../docs/docs/project-structure.md)
- [Configuration](../docs/docs/config.md)
- [Client routes](../docs/docs/client-routes.md)
- [Server functions](../docs/docs/server-functions.md)
- [Server request routes](../docs/docs/server-routes.md)
- [Plugins](../docs/docs/plugins.md)
- [Plugin authoring](../docs/docs/plugin-authoring.md)
- [Plugin hooks](../docs/docs/plugin-hooks.md)
- [Generated contributions](../docs/docs/generated-contributions.md)
- [Build and deployment](../docs/docs/build.md)
- [Framework architecture](../ARCHITECTURE.md)
