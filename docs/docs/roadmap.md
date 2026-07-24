# Roadmap

## Completed Foundation

- Zero-config React app build with `ev dev` and `ev build`.
- Canonical Page-and-Route convention with positive Page-directory `page.*`
  anchors, optional build-time `page.config.ts`, directory-derived URLs, and
  SPA/MPA `routing.mode`.
- Server functions from `"use server"` modules.
- Hono/fetch server runtime with explicit server routes.
- Plugin system with config, bundler, output, HTML, and build hooks.
- Bundler adapter contract based on `BuildPlan` and `BuildOutput`.
- Programmatic `prepareFrameworkBuild()` API for framework preflight without
  exposing internal graph/plan state or invoking a bundler or platform adapter.
- `ev inspect` CLI preflight for explaining page route discovery, server
  declarations, render metadata, runtime paths, planned entries, and diagnostics
  without running a bundler or writing `dist`.
- Configurable client/server output directories plus canonical deployment
  metadata at `dist/deployment-metadata.json`.
- ClientRuntime-driven Application/Page activation through the public
  `@evjs/client` runtime package and generated framework bootstraps.
- Framework-owned SPA page routes and router-free page runtime for MPA.
- Webpack adapter for framework validation while Utoopack lower-layer APIs catch up.
- Focused render-mode and deployment-adapter examples plus end-to-end coverage for apps,
  component pages, SSR/PPR/RSC, and per-document HTML transforms.
- Public manifest redaction so browser-visible output does not expose local
  source paths.
- Built-in Node, static, and edge deployment adapter artifacts.
- Page data hooks for params, search, and loader data without exposing router
  internals.
- Unified server request context and middleware semantics across server
  functions, server routes, SSR, PPR, and RSC.
- PPR page response cache headers derived from region policies for merged,
  streamed, and HEAD responses.
- PPR region runtime cache hardening with pluggable cache providers,
  stale-while-revalidate headers, and background stale refresh for split
  edge/origin deployments.
- RSC Flight responses default to `Cache-Control: no-store` while preserving
  explicit renderer cache headers.

## In Progress

- [Core 0.3](./core-0.3-rfc) now resolves one canonical
  `routing.mode + page.* + page.config.ts` model into a validated CoreGraph
  for SPA and MPA, emits `.ev/framework/core-graph.json`, and diagnoses invalid
  Page/Route/Document ownership or Page configuration.
- Continue hardening the Bigfish explicit route normalizer and one-time source
  migration guidance for Smallfish and evjs 0.2 without promoting stored
  models as runtime readers.
- Canonical MPA emits Page-owned Documents from static semantic Routes and
  composes file-convention layouts; dynamic routes and router-only boundary
  facets are explicitly rejected.
- The plugin API now has dependency-ordered, reload-safe `describe`,
  namespaced Application and Page defaults/config/validation, strict static
  serialization, resolved extension views, and cross-runtime `page.wrapper`
  contributions. See the
  [0.2 migration guide](./plugin-migration-0.2-to-0.3).
- Continue the plugin API with owned Route/Document schemas, graph
  transforms/selectors, additional semantic facets, typed runtime hooks, and
  generic extension entries.

## Planned

- Bigfish route-normalizer coverage, Smallfish/evjs 0.2 source codemods,
  capability reports, and representative plugin ports.
- Removal of built-in SSR/PPR/RSC branches from Core after generic extension
  entries, Documents, request facets, and manifest projections are available.
- Utoopack lower-layer parity for generic dynamic entries, structured build
  facts, and extension-owned client/server/build environments.
