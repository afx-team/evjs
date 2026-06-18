# Roadmap

## Completed Foundation

- Zero-config React app build with `ev dev` and `ev build`.
- Page route SPA discovery through `src/pages`.
- Page route MPA output through `routing.mode: "mpa"`.
- Explicit multi-page output through `pages`.
- Server functions from `"use server"` modules.
- Hono/fetch server runtime with explicit server routes.
- Plugin system with config, bundler, output, HTML, and build hooks.
- Bundler adapter contract based on `BuildPlan` and `BuildOutput`.
- Programmatic `prepareFrameworkBuild()` API for framework preflight without
  exposing internal graph/plan state or invoking a bundler or platform adapter.
- `ev inspect` CLI preflight for explaining page route discovery, server
  declarations, render metadata, runtime paths, planned entries, and diagnostics
  without running a bundler or writing `dist`.
- Single framework manifest at `dist/manifest.json`.
- Manifest-driven app/page activation through the public
  `@evjs/client` runtime package.
- Framework-owned SPA page routes and router-free page runtime for MPA.
- Webpack adapter for framework validation while Utoopack lower-layer APIs catch up.
- Focused render-mode and deployment-adapter examples plus end-to-end coverage for apps,
  component pages, SSR/PPR/RSC, and per-document HTML transforms.
- Public manifest redaction so browser-visible output does not expose local
  source paths.
- Built-in Node, static, and edge deployment adapter artifacts.
- Route-specific page data hook types from generated SPA routes, covering
  params, search, and loader data without exposing router internals.
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

- Utoopack parity priority 1: dynamic entry/server dev plan updates for
  adding/removing entries without restarting `ev dev`.
- Utoopack parity priority 2: generic entry wrapping/loadable entry facts for
  framework-managed component pages.
- Utoopack parity priority 3: multi server-entry build facts for SSR/PPR/RSC
  renderers.
- Utoopack parity priority 4: RSC client/server reference metadata.

## Planned

- More production-grade PPR behavior for explicit client islands and deeper
  React streaming renderer integration.
- Utoopack lower-layer parity for dynamic entries, structured build results,
  multiple server entry classes, and RSC/client reference metadata.
