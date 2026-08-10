# evjs Implementation Status

Release history lives in [CHANGELOG.md](./CHANGELOG.md). This file records only
active architecture boundaries that are enforced by the current code.

## Framework Core

- Canonical `src/pages/**/page.*` Pages and explicit SPA route trees normalize
  into one Application/Page/Route/Document CoreGraph.
- Adjacent `page.config.ts` owns static metadata, rendering settings, and the
  generated Page-level `plugins` map. Plugins derive Route and Document
  behavior from the normalized Page graph rather than separate owner configs.
- Positive `src/apis/**/api.*` anchors own request Routes and
  filesystem-scoped middleware.
- `BuildPlan` drives generated `.ev` entries, bundler adapters, dev routing,
  output ownership, and deployment linking.
- `BuildOutput` is the complete in-memory result;
  `dist/deployment-metadata.json` is the canonical serialized deployment
  projection.
- One plugin model covers independent Application and Page options; generated
  IR contributions cover entry, wrapper, middleware, HTML, alias, and external
  slots.
- A long-lived dev Supervisor owns framework-input watching and replaces a
  complete immutable Session for semantic config, graph, plan, or generated-IR
  changes. Bundler adapters own ordinary module watch/HMR inside a Session.
- Node, static, and edge deployment adapters consume the linked output model.

## Bundler Build Capability Matrix

The adapters declare these capabilities in code and framework preflight
enforces them:

| Capability | Utoopack | Webpack |
| --- | --- | --- |
| Client build | Yes | Yes |
| Server rendering build | Yes | Yes |
| RSC build | No | Yes |
| PPR build | No | Yes |

## Open Adapter Gaps

- Utoopack build facts and entry APIs for PPR and RSC.

These gaps should be closed by changing adapter capabilities and their focused
tests together. User-facing docs should describe the declared capability
matrix rather than a planned implementation.
