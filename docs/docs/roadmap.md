# Roadmap

## Completed Foundation

- Zero-config React app build with `ev dev` and `ev build`.
- Explicit app entries through `entry` / `html` and `apps`.
- Multi-page output through `pages`.
- Server functions from `"use server"` modules.
- Hono/fetch server runtime with explicit server routes.
- Plugin system with config, graph, plan, bundler, output, HTML, and build hooks.
- Bundler adapter contract based on `BuildPlan` and `BuildOutput`.
- Single framework manifest at `dist/manifest.json`.
- Manifest-driven app/page/remote activation from the public `@evjs/client`
  package.
- TanStack compatibility and TanStack-free React route declarations from
  `@evjs/client`.
- Webpack adapter for framework validation while Utoopack lower-layer APIs catch up.
- Full-feature host/remote example plus end-to-end coverage for apps,
  component pages, SSR/PPR/RSC, remotes, and per-document HTML transforms.
- Public manifest redaction so browser-visible output does not expose local
  source paths.
- Built-in Node, static, and edge deployment adapter artifacts.

## In Progress

- Utoopack dynamic dev plan updates for adding/removing entries without restarting `ev dev`.
- Utoopack build facts for framework-managed component entries and multiple server render entries.
- Utoopack reference metadata needed for RSC and framework-managed render entries.
- Production hardening for RSC/PPR cache behavior across non-root public paths
  and split edge/origin deployments.

## Planned

- Route-first user model refinement so advanced rendering lives primarily in
  route declarations, while `pages` remains the standalone page shorthand.
- Unified server request context and middleware semantics across server
  functions, server routes, SSR, PPR, and RSC.
- More production-grade PPR behavior such as stale revalidation strategies,
  pluggable region caches, explicit client islands, and deeper React streaming
  renderer integration.
- Utoopack lower-layer parity for dynamic entries, structured build results,
  multiple server entry classes, and RSC/client reference metadata.
