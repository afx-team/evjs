# Implementation Status

Release history lives in the repository `CHANGELOG.md`. This page records the
architecture boundaries enforced by the current implementation.

## Framework core

- `routing.mode`, `src/pages/**/page.*`, and adjacent `page.config.ts`
  normalize into one Application/Page/Route/Document CoreGraph for SPA and
  MPA.
- `application.routes` is an explicit SPA-only input into that same graph.
- `src/apis/**/api.*` supplies request Routes with explicit method middleware
  composition. `src/middlewares/middleware.*` supplies global middleware.
- `BuildPlan` drives generated `.ev` entries, bundler adapters, dev routing,
  output ownership, and deployment linking.
- `BuildOutput` remains in memory; `dist/deployment-metadata.json` is the
  serialized deployment metadata shared with deployment tools.
- Plugins can own namespaced Application, Page, Route, and Document data and
  attach generated entry, wrapper, middleware, HTML, alias, and external
  contributions.
- A long-lived dev Supervisor owns framework-input watching and replaces a
  complete immutable Session for semantic config, graph, plan, or generated-IR
  changes. Bundler adapters own ordinary module watch/HMR inside a Session.
- Built-in Node, static, and edge deployment adapters consume the linked
  output model.

## Bundler capabilities

| Capability | Utoopack | Webpack |
| --- | --- | --- |
| Client build | Supported | Supported |
| Server rendering build | Supported | Supported |
| RSC build | Unsupported | Supported |
| PPR build | Unsupported | Supported |

Framework preflight reads these declarations from the selected adapter and
fails before bundling when a BuildPlan requires an unsupported build
capability.

## Open adapter gaps

- Utoopack build facts and entry APIs for PPR and RSC.

Track completed work in the changelog. Keep this page aligned with adapter
capability declarations and focused tests.
