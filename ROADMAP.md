# ev Framework Roadmap

This roadmap tracks the current architecture direction. Historical milestones
are preserved in `CHANGELOG.md`; this file should reflect active reality.

## Completed Core Architecture

- [x] Explicit config and static declaration model for apps, pages,
      server functions, server routes, SSR/PPR/RSC render metadata.
- [x] `AppGraph`, `BuildPlan`, and `BuildOutput` schemas under
      `@evjs/shared/manifest`.
- [x] Graph analysis and build planning under `@evjs/ev/src/build-tools`.
- [x] Single framework manifest output at `dist/manifest.json`.
- [x] Stage-based plugin hooks: `buildStart`, `bundlerConfig`, `buildOutput`,
      per-document `transformHtml`, `buildEnd({ output })`, and `dispose`.
- [x] Programmatic `prepareFrameworkBuild()` API for resolving config,
      running framework preflight hooks, reporting graph diagnostics, and
      returning resolved config, graph file dependencies, plugin watch files,
      and `dispose()` without invoking a bundler or platform adapter.
- [x] `ev inspect` CLI preflight for explaining route discovery, server
      declarations, render metadata, runtime paths, planned entries, and
      diagnostics without invoking a bundler or writing `dist`.
- [x] Consolidated package shape around `@evjs/ev`, `@evjs/client`,
      `@evjs/server`, `@evjs/shared`, `@evjs/cli`, and `@evjs/create-app`.
- [x] Single top-level `@evjs/client` entry with framework-managed page,
      navigation, shell, RSC, and static route APIs.
- [x] RSC client runtime exports remain available from `@evjs/client`, while
      `react-server-dom-webpack/client` is loaded only when RSC APIs are used.
- [x] React page runtime, shell runtime, and framework-managed page activation.
- [x] `@evjs/server` framework rendering boundary for SSR, PPR, and RSC Flight.
- [x] Production Node deployment adapter driven by `BuildOutput`.
- [x] Focused render-mode and deployment-adapter examples plus e2e coverage on
      the webpack validation path.

## Adapter Status

- [x] `@evjs/bundler-utoopack` remains the default adapter and consumes
      `BuildPlan` where its lower-layer APIs are sufficient.
- [x] `@evjs/bundler-webpack` validates the complete new architecture path.
- [ ] Priority 1: Utoopack dynamic dev entry/server update API for configured
      page additions/removals.
- [ ] Priority 2: Utoopack generic entry wrapping/loadable entry facts for
      component pages.
- [ ] Priority 3: Utoopack multi server-entry support and structured build facts
      for SSR/PPR/RSC renderers.
- [ ] Priority 4: Utoopack RSC client/server reference to chunk metadata.
- [ ] Priority 5: Utoopack structured dev build callbacks and stats delivery.

## Remaining Product Work

- [ ] Platform-specific deployment adapters after runtime contracts are concrete
      for each platform.
- [ ] RSC server actions beyond the current `"use server"` RPC/action transport.
- [ ] More granular internal `BuildPlanUpdate` reasons if real adapters need
      them.
- [ ] Further graph dependency narrowing once bundlers expose module/reference
      facts that can replace framework-side static import closure analysis.
- [ ] Migration guides for external deployment plugins that still consume older
      split manifests.
