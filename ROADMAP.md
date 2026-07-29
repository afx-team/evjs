# evjs Implementation Status

Release history lives in [CHANGELOG.md](./CHANGELOG.md). This file records only
active architecture boundaries that are enforced by the current code.

## Framework Core

- Canonical `src/pages/**/page.*` Pages and explicit SPA route trees normalize
  into one Application/Page/Route/Document CoreGraph.
- Adjacent `page.config.ts` owns static metadata, rendering settings, and
  namespaced Page, Route, and Page-owned Document extensions.
- Positive `src/apis/**/api.*` anchors own request Routes and
  filesystem-scoped middleware.
- `BuildPlan` drives generated `.ev` entries, bundler adapters, dev routing,
  output ownership, and deployment linking.
- `BuildOutput` is the complete in-memory result;
  `dist/deployment-metadata.json` is the canonical serialized deployment
  projection.
- Plugin extension ownership covers Application, Page, Route, and Document;
  generated contributions cover entry, wrapper, middleware, HTML, alias, and
  external slots.
- Node, static, and edge deployment adapters consume the linked output model.

## Bundler Capability Matrix

The adapters declare these capabilities in code and framework preflight
enforces them:

| Capability | Utoopack | Webpack |
| --- | --- | --- |
| Client build | Yes | Yes |
| Server rendering build | No | Yes |
| RSC build | No | Yes |
| PPR build | No | Yes |
| Generated/HTML-only dev plan update | Yes | Yes |
| Entry/Route/server/resolution dev plan update | Restart required | Restart required |

## Open Adapter Gaps

- Utoopack build facts and entry APIs for server rendering, PPR, and RSC.
- In-process structural dev-plan updates for entries, Routes, server topology,
  module resolution, and bundler configuration.

These gaps should be closed by changing adapter capabilities and their focused
tests together. User-facing docs should describe the declared capability
matrix rather than a planned implementation.
