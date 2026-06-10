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
- Shell/runtime packages for manifest-driven app/page/remote activation.
- Optional TanStack adapter split from shell/runtime core.
- Webpack adapter for framework validation while Utoopack lower-layer APIs catch up.
- Full-feature host/remote example plus end-to-end coverage for apps,
  component pages, SSR/PPR/RSC, remotes, and per-document HTML transforms.

## In Progress

- Utoopack dynamic dev plan updates for adding/removing entries without restarting `ev dev`.
- Utoopack build facts for framework-managed component entries and multiple server render entries.
- Production deployment plugin migrations to consume `BuildOutput` instead of v1 client/server manifests.

## Planned

- Full React Server Components transform/runtime adapter.
- RSC client/server reference manifests and Flight runtime integration.
- More production-grade PPR behavior such as stale revalidation strategies and
  deeper React streaming renderer integration.
