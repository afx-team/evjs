# Changelog

All notable changes to evjs are documented here. Releases follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [0.2.1] — 2026-06-23

### 🐛 Bug Fixes

- **Plugin API tolerance** — Kept `EvPlugin*`, `EvConfig`, and `ResolvedEvConfig` type names, defaulted plugin bundler config types to Utoopack, preserved no-argument lifecycle hook signatures, and ignored extra plugin metadata fields instead of treating them as fatal configuration errors. Projects can still switch to webpack through `webpackAdapter` and the typed `webpack()` helper.

### 🧹 Code Quality

- **Remote component cleanup** — Removed remaining shared-scope and remote component runtime leftovers so the client shell no longer exposes unused shared dependency registration APIs.

---

## [0.2.0] — 2026-06-23

### ⚠️ Breaking Changes

- **Graph-driven framework contracts** — Reworked framework build and development around the `AppGraph -> BuildPlan -> BuildOutput` pipeline, with framework semantics owned by `@evjs/ev` build tools and manifest contracts owned by `@evjs/shared/manifest`.
- **Package surface cleanup** — Removed the legacy public `@evjs/build-tools` and `@evjs/manifest` packages, and kept `@evjs/ev` focused on config, build, plugin, and deployment APIs while runtime APIs live in `@evjs/client` and `@evjs/server`.
- **Plugin and endpoint contracts** — Removed the old `commandStart` plugin hook and derived server function, PPR, and RSC paths from `server.basePath` instead of exposing a separate public server function endpoint config.
- **Rendering contracts** — Standardized non-CSR page rendering around generated build manifests; PPR uses `render = "ssr"` plus `prerender = { partial: true }`, and PPR plus RSC on the same page remains unsupported.

### ✨ Highlights

- **Graph-driven build pipeline** — Added build graph analysis, build planning, linked framework output, dev-time plan updates, and `ev inspect` for preflight diagnostics.
- **Framework page routes and render modes** — Added strict `src/pages` discovery, pathless route groups, layout source modules, generated route types, SSR, SSG, experimental PPR, and RSC integration.
- **Deployment output** — Added `nodeDeploymentAdapter()` and deployment metadata for production Node servers that mount framework endpoints, SSR/PPR/RSC document routes, server functions, server routes, and static assets.
- **Webpack validation adapter** — Added `@evjs/bundler-webpack` as the validation/fallback adapter for dynamic entries, server output, SSR, PPR, RSC, and framework build contracts that still need lower-level Utoopack parity.
- **Cross-origin asset loading** — Added `output.crossOriginLoading` to apply `crossorigin` attributes to emitted HTML assets and dynamic chunk loading in Utoopack and webpack builds.
- **PPR authoring model** — Aligned experimental PPR with React `Suspense`, switched PPR region IDs to opaque internal identifiers, and added diagnostics for unsupported Suspense boundaries until runtime postponed/resume support lands.

### 🧪 Testing

- **Architecture coverage** — Added broad graph, plan, manifest, page-route, server-rendering, RSC, shell runtime, deployment, and bundler adapter tests, plus render-mode and deployment-adapter E2E coverage.

### 📝 Documentation

- **0.2 architecture refresh** — Updated English and Chinese docs, examples, agent guidance, and contributor docs for the graph-driven architecture, page-route conventions, render modes, deployment model, plugin lifecycle, and package boundaries.

---

## [0.1.11] — 2026-05-26

### ✨ Improvements

- **Enable publicPath: auto by default** — Upgrade `@utoo/pack` to 1.4.9, enable `public: "auto"` in utoopack bundler adapter.

---

## [0.1.10] — 2026-05-19

### ✨ Improvements

- **MPA page config shorthand** — Added support for string-valued `pages` entries so apps can define page entries without repeating the default HTML template path.

### ♻️ Refactoring

- **Client transport options** — Simplified `@evjs/client` transport option handling and updated the custom transport docs and example to match the public runtime API.

### 🧪 Testing

- **Scaffold E2E isolation** — Isolated scaffold E2E environment setup to avoid cross-test environment leakage in CI.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.10` release line.

---

## [0.1.9] — 2026-05-14

### ⚠️ Breaking Changes

- **Plugin dependency API** — Replaced plugin `dependsOn` with Egg-style `dependencies` and `optionalDependencies`, separating required plugin dependencies from optional ordering dependencies.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.9` release line.

---

## [0.1.8] — 2026-05-13

### ✨ Improvements

- **Plugin dependency ordering** — Added `dependsOn` for evjs plugins so plugin packages can declare internal ordering constraints while app users only enable the plugins they need.

### 📝 Documentation

- **Plugin ordering guide** — Documented dependency-resolved plugin order and the validation for missing, duplicate, or circular plugin dependencies.
- **Release line updates** — Updated user-facing dependency examples to the `0.1.8` release line.

---

## [0.1.7] — 2026-05-13

### ✨ Improvements

- **Async bundler config hooks** — Allowed plugin `bundlerConfig` hooks and the typed `utoopack()` helper to return promises, ensuring async Utoopack config mutations finish before build/dev config is used.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.7` release line.

---

## [0.1.6] — 2026-05-13

### 🐛 Bug Fixes

- **Utoopack dev HTML emission** — Fixed `ev dev` so Utoopack emits development HTML and manifests for both full-stack apps (`dist/client/index.html`) and CSR-only apps (`dist/index.html`).
- **Relative server function dev proxy** — Fixed the default relative server function endpoint so `POST /api/fn` is proxied to the API dev server instead of returning a client dev-server 405 response.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.6` release line.

---

## [0.1.5] — 2026-05-11

### ✨ Improvements

- **evjs client router type registration** — Added `@evjs/client` as the public module augmentation target for TanStack Router registration, keeping route type setup inside the evjs client API surface.

### 🐛 Bug Fixes

- **Relative server function endpoint default** — Restored the default server function endpoint to a relative path so generated apps work behind their current origin.
- **WebSocket transport E2E dispatch** — Fixed the custom WebSocket transport E2E bootstrap to dispatch RPC calls to the server function API endpoint instead of a malformed URL.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.5` release line.

---

## [0.1.4] — 2026-05-09

### ♻️ Refactoring

- **Server function endpoint config** — Moved the ev config endpoint option to `server.functions.endpoint`, matching the rest of the server function settings and resolved config shape.

### ✨ Runtime

- **Router global catch boundary opt-out** — Added a `createApp()` runtime option that passes through TanStack Router's native `disableGlobalCatchBoundary`.
- **Broader TanStack Router passthrough** — Re-exported additional TanStack Router components, hooks, history helpers, search middleware utilities, URL rewrite helpers, and router event types from `@evjs/client`.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.4` release line.

---

## [0.1.3] — 2026-05-09

### ✨ Improvements

- **General type-safe config merging** — Moved `merge()` into `@evjs/ev` so plugins can apply typed nested patches to evjs framework config and utoopack config through the same helper.
- **Utoopack helper simplification** — Kept `@evjs/bundler-utoopack` exporting `merge()` for concise plugin authoring while sharing the generic implementation from `@evjs/ev`.

### 📝 Documentation

- **Release line updates** — Updated user-facing dependency examples to the `0.1.3` release line.
- **Project structure cleanup** — Removed stale generated-folder notes from the project structure guide.

---

## [0.1.2] — 2026-05-09

### ✨ Highlights

- **Type-safe utoopack config merging** — Added the `merge()` helper to `@evjs/bundler-utoopack` so plugins can apply typed nested utoopack config patches without manual `cfg.module ??= {}` style boilerplate.
- **Cleaner plugin authoring examples** — Simplified utoopack hook examples to use `bundlerConfig: utoopack((cfg) => ...)` directly instead of manually forwarding `(config, ctx)`.
- **Project structure guide refresh** — Reworked the project structure docs around minimal apps, full-stack layouts, server functions, route handlers, custom server entries, MPA builds, and generated folders.

### 📝 Documentation

- **Plugin lifecycle clarity** — Clarified plugin hook execution order and the difference between generic `bundlerConfig` hooks and typed bundler helpers.
- **User package version guidance** — Moved `@evjs/*` lockstep version guidance into the user-facing Quick Start docs and updated examples for the `0.1.2` release line.
- **Roadmap and stale docs cleanup** — Marked completed MPA and server context work, refreshed stale framework guides, and kept English and Simplified Chinese docs aligned.

---

## [0.1.1] — 2026-05-09

### ✨ Highlights

- **Build orchestration in `@evjs/ev`** — Moved dev/build orchestration out of the CLI package so `@evjs/cli` stays a thin command wrapper around the framework runtime.
- **Manifest output refinements** — Refactored server manifest asset metadata and wired server function endpoint configuration through build-time defines.
- **Dev server readiness improvements** — Tightened dev server startup coordination, API process recovery behavior, and server bundle callback recovery so watch-mode failures are easier to recover from.

### 🐛 Bug Fixes

- **tRPC example forwarding** — Updated the tRPC example server function bridge to call arbitrary procedures with the original path, operation type, and input instead of hard-coding one procedure.
- **CI install stability** — Kept CI on `npm install` so platform-specific optional dependencies do not corrupt lockfile state across macOS and Linux installs.

### 🧪 Testing

- **Broader E2E coverage** — Improved end-to-end assertions across API routes, basic routing, complex routing, MPA, scaffolding, SQLite, Tailwind, and tRPC examples.
- **Bundler config coverage** — Added utoopack adapter coverage for default configuration behavior and manifest generation edge cases.

---

## [0.1.0] — 2026-05-07

### ✨ Highlights

- **Initial public milestone** — Promoted evjs to `0.1.0` as the first tagged milestone intended for GitHub-driven releases and npm publication.
- **Full-stack React framework core** — Ships TanStack Router based client routing, Hono-powered server routes and server functions, plugin hooks, and the `utoopack` bundler integration as the supported framework baseline.
- **Scaffolding and examples** — Includes `create-app` templates plus runnable examples for API routes, complex routing, MPA, custom websocket transport, Tailwind, tRPC, SQLite, and plugin authoring.

### ⚠️ Important Notes

- **Asset prefix removal** — The top-level `assetPrefix` config and related runtime injection were removed in `0.0.32`; production asset URLs are now emitted as root-relative paths.
- **Server entry export shape** — Server entries now export an object like `export default { fetch: app.fetch };` instead of exporting `fetch` directly.

---

## [0.0.33] — 2026-05-07

### 🐛 Bug Fixes

- **Default utoopack plugin context** — `ev build` and `ev dev` now inject the active default bundler into plugin setup context before collecting hooks, so `bundlerConfig` helpers like `utoopack()` work even when users rely on the implicit default bundler instead of explicitly setting `bundler: utoopackAdapter`.

---

## [0.0.32] — 2026-05-07

### ⚠️ Breaking Changes

- **Removed `assetPrefix`** — Deleted the top-level `assetPrefix` config, removed `window.assetPrefix` runtime injection, and dropped `assetPrefix` from emitted client manifests. Client asset URLs now build as root-relative paths.
- **Standardized Server Entry Exports** — The server entry point now exports an object `{ fetch }` instead of a bare `fetch` function. `createApp().fetch` should now be exported as `export default { fetch: app.fetch };`.

### ♻️ Refactoring

- **Server Runtimes Integration** — The `node` and `fetch` runtimes are now integrated internally into `@evjs/server/runtimes`, eliminating external loading discrepancies in E2E testing scenarios.
- **Simplified HTML and bundler asset paths** — `generateHtml()` and the utoopack adapter no longer thread a CDN/public-path prefix through HTML generation, manifest emission, or bundler runtime setup.

### 🐛 Bug Fixes

- **Template Metadata** — Fixed template metadata for the `create-app` scaffolding CLI to ensure correct package naming and metadata on new projects.

### 📝 Documentation

- **Removed stale CDN-prefix guidance** — Updated config and deployment docs to stop advertising `assetPrefix`, and documented that custom asset-base behavior now requires a proxy layer or custom bundler/HTML extension.

---

## [0.0.30] — 2026-05-06

### ✨ Features

- **Basic routing example expansion** — Expanded `examples/basic` with static (`/about`), dynamic (`/users/$userId`), and search-param (`/search?tab=`) routes to demonstrate more routing patterns in one example.
- **Custom router history support** — Added optional `history` support to `createApp()` and re-exported hash and memory history helpers from `@evjs/client`, allowing examples and apps to switch between browser, hash, and memory routing.

### 🐛 Bug Fixes

- **Default dev server entry fallback** — Projects without an explicit `server.entry` now get a generated default server entry, restoring server function support in dev for minimal examples like `examples/basic`.
- **Browser-history deep-link fallback in dev** — Utoopack dev serving now falls back to the SPA shell for route URLs like `/about` and `/users/1`, preventing `405` responses on direct navigation.

### 🧹 Code Quality

- **Monorepo lint and type cleanup** — Resolved repository lint issues and tightened plugin hook test typing so push-time validation passes cleanly.

---

## [0.0.29] — 2026-04-29

### ✨ Features

- **Cookie API Enhancements** — Split `cookies()` into `getCookie`, `setCookie`, and `deleteCookie` for better clarity. Added support for signed cookies via `getSignedCookie`, `setSignedCookie`, `generateCookie`, and `generateSignedCookie`, aligning signatures with Hono.
- **Server Options Refactoring** — Redesigned `CreateAppOptions` and optimized `RouteHandler` to streamline server creation.
- **Core Architecture** — Core architecture and stability improvements.

### 📝 Documentation & Examples

- **Server Context Examples** — Demonstrated server context hooks in the `basic-server-fns` example.
- **Runtime Identifiers Cleanup** — Updated stale `__fn_call` and `registerServerFn` references across all documentation and comments to accurately reflect the `createServerReference` and `registerServerReference` implementations.
- **README Updates** — Added the official Hono URL to the root README.

---

## [0.0.28] — 2026-04-28

### ✨ Features

- **Server Context API** — Refactored server context API to align with Hono's `context-storage`, providing global hooks like `request()`, `headers()`, `cookies()`, and `waitUntil()`.
- **Performance** — Optimized `waitUntil` execution to prevent unnecessary closure creation.

---

## [0.0.27] — 2026-04-24

### ✨ Features

- **Removed webpack backend support** — Removed webpack-specific bundler support and aligned the framework around `@evjs/bundler-utoopack`.
- **MPA support** — Added Multi-Page Application support via `pages` config entries in `ev.config.ts`.

### 🧪 Testing

- **MPA end-to-end coverage** — Added Playwright e2e coverage for the new `basic-mpa` example.

### 🧰 Scaffolding

- **`create-app` template updates** — Added `basic-mpa` template support and updated template link mappings.

### 📝 Documentation

- **Bundler terminology cleanup** — Updated docs and package READMEs to reflect utoopack-oriented terminology.

---

## [0.0.26] — 2026-04-24

### ✨ Features

- **Added `cwd`** — Added `cwd` to the plugin helper.

### 🐛 Bug Fixes

- **Type strictness in plugin helpers** — Fixed `EvBundlerCtx<Configuration>` type mappings in `@evjs/bundler-utoopack` to securely expose the full typed bundler configuration to plugins.

### 📝 Documentation

- **Plugin examples** — Updated bundler configuration examples for plugin developers.

---

## [0.0.25] — 2026-04-21

### ✨ Features

- **Micro-frontend support** — Added `unmount` method to `createApp` for micro-frontend support.

### ♻️ Refactoring

- **Simplified QueryClient** — Simplified `QueryClient` default assignment.

---

## [0.0.24] — 2026-04-21

### ✨ Features

- **Route basepath and QueryClient IoC** — Added `basepath` routing feature and refactored TanStack `QueryClient` as an injected dependency, dropping the `queryClientConfig` parameter.

---

## [0.0.23] — 2026-04-21

### ✨ Features

- **Added `@evjs/bundler-utoopack`** — Integrated the Turbopack-based `utoopack` bundler via a new adapter package. Leverages native `"use server"` support for lightning-fast server function compilation and HMR.

### ♻️ Refactoring

- **Renamed `route()` to `createRoute()`** — Aligned the server-side route factory naming with the existing client-side API for better consistency across the framework.

### 🐛 Bug Fixes

- **Resolved E2E timeouts** — Increased dev server timeout in e2e tests.

---

## [0.0.22] — 2026-04-10

### ♻️ Refactoring

- **Reorganized plugin architecture** — Split the monolithic `bundler-webpack/src/index.ts` (381 lines) into focused modules under `plugin/`:
  - `plugin/index.ts` — `EvBundlerPlugin` orchestrator
  - `plugin/server-compiler.ts` — "use server" module scanning and child compiler
- **Moved `ManifestCollector` to `@evjs/manifest`** — Manifest building logic (`ManifestCollector`, `resolveRoutes`, `ExtractedRoute`) now lives in the zero-dependency manifest package alongside the types it produces
- **Moved `buildHtml()` to `@evjs/ev`** — Framework-level HTML transforms (assetPrefix injection, plugin `transformHtml` hooks) extracted to the core package; accepts a pre-parsed doc to avoid heavy build-tool dependencies
- **`@evjs/ev` stays lightweight** — Removed `@evjs/build-tools` dependency; `@evjs/ev` now only depends on `@evjs/manifest` and `@evjs/shared`

---

## [0.0.21] — 2026-04-10

### ✨ Features

- **Runtime `publicPath` via `window.assetPrefix`** — Webpack's chunk loader now reads `window.assetPrefix` at runtime, so dynamically loaded chunks resolve against the deploy-time CDN URL without requiring a rebuild. The prefix can be injected into `index.html` at deploy time by rewriting the `<script>window.assetPrefix="..."</script>` tag.

### 📝 Documentation

- Updated `assetPrefix` docs in `deploy.md` (EN + zh-Hans) to reflect runtime publicPath behavior
- Updated `config.ts` docstring to mention runtime chunk loading and deploy-time rewriting

---

## [0.0.20] — 2026-04-08

### ✨ Features

- **`assetPrefix` config option** — New top-level config field for deploying static assets to a CDN. Set `assetPrefix: "https://cdn.example.com/"` in `ev.config.ts` to prefix all JS/CSS asset URLs in the production build output
- **Runtime `window.assetPrefix`** — The configured prefix is injected as a `<script>window.assetPrefix="..."</script>` tag in the `<head>` of `index.html`, enabling deployment-time rewriting and dynamic asset URL construction in React components
- **`assetPrefix` ignored in dev** — During `ev dev`, the prefix is always forced to `"/"` to preserve local HMR and dev server stability

### 📝 Documentation

- Added CDN deployment section to `deploy.md` (EN + zh-Hans)
- Added `assetPrefix` reference to `config.md` (EN + zh-Hans) with defaults table, client options description, and full reference example
- Updated `evjs-dev` AI skill with CDN deployment gotcha

### 🧹 Code Quality

- Renamed internal `publicPath` to `assetPrefix` across `@evjs/build-tools`, `@evjs/bundler-utoopack`, `@evjs/manifest`, and `@evjs/ev` for naming consistency with Next.js conventions
- Added `Window.assetPrefix` global type augmentation in `@evjs/client` for type-safe access

---

## [0.0.19] — 2026-04-07

### 🐛 Bug Fixes

- **Resolved manifest route paths** — Route extraction now parses `getParentRoute` hierarchy and produces fully resolved URL paths (e.g. `/posts/$postId` instead of bare `$postId`), eliminating duplicate `"/"` entries in `manifest.json`
- **Removed duplicate index routes** — Index routes under non-root parents are excluded from the manifest since they resolve to the same URL as their parent
- **Fixed ANSI escape codes in build output** — Webpack stats no longer emit raw `\x1B[...` sequences in the logger

### ✨ Features

- **`extractRoutes()` / `resolveRoutes()`** — New build-tools APIs for extracting route metadata from `createRoute()` calls and resolving full URL paths from the parent-child hierarchy

### 📦 Dependencies

- Upgraded `domparser-rs` from `^0.0.7` to `^0.1.0` — migrated from `NodeRepr` to standard DOM type hierarchy (`Document`, `Element`, `Node`)

### 🧪 Testing

- Added 21 unit tests for route extraction and resolution in `@evjs/build-tools`
- Updated `ManifestCollector` tests for resolved route output

---

## [0.0.18] — 2026-04-06

### ✨ Features

- **`transformHtml` plugin hook** — New lifecycle hook receives a parsed DOM document (`EvDocument`) instead of a raw HTML string, enabling robust, structured HTML manipulation via standard DOM methods
- **`EvDocument` interface** — Bundler-agnostic DOM subset in `@evjs/ev` covering querying, attributes, tree mutation, content insertion, traversal, and document-level accessors
- **Custom HTML generation** — New `generateHtml()` utility in `@evjs/build-tools` using `domparser-rs` for template parsing and asset injection (replaces `HtmlWebpackPlugin` for asset injection)
- **`basic-plugins` example** — New example demonstrating all four plugin hooks (`buildStart`, `bundler`, `transformHtml`, `buildEnd`)

### 🧪 Testing

- Added Playwright e2e tests for `basic-plugins` (4 browser tests)
- Added `transformHtml` DOM manipulation e2e scenarios to `plugin-hooks.test.ts` (3 tests: meta injection, comment injection, multi-plugin composition)
- Added 13 unit tests for `generateHtml` in `@evjs/build-tools`

### 📝 Documentation

- New dedicated **Plugins** guide (`docs/docs/plugins.md`) with lifecycle diagram, `EvDocument` API reference, type-safe bundler helpers, and practical recipes (CSP nonce, analytics, deploy manifest)
- Chinese (zh-Hans) translation of the Plugins guide
- Added Plugins page to sidebar under Core Concepts
- Updated architecture diagrams and roadmap to include `transformHtml` in the hook lifecycle

---

## [0.0.17] — 2026-04-05

### ✨ Features

- **Plugin lifecycle API** — Refactored `EvPlugin` from top-level config/bundler hooks to a `name` + `setup(ctx)` pattern returning lifecycle hooks (`buildStart`, `bundler`, `buildEnd`)
- New `EvPluginContext`, `EvPluginHooks`, and `EvBuildResult` types for full type-safe plugin authoring
- Added typed `utoopack()` helper in `@evjs/bundler-utoopack` for type-safe bundler config manipulation inside plugins
- Removed legacy `EvConfigCtx` and `bundler.config` escape hatch
- CLI now orchestrates full `setup → buildStart → bundler → buildEnd` lifecycle

### 🔒 Security & Hardening

- **Production HTTPS enforcement** — TLS cert failures now throw instead of silently falling back to unencrypted HTTP
- **Server function input validation** — `Array.isArray(args)` guard in `dispatch()` prevents malformed payloads from spreading incorrectly
- **Request body validation** — Early `fnId` type check returns a structured 400 error for malformed RPC requests
- **Structured error propagation** — Client transport now parses JSON error bodies on non-2xx responses, preserving `ServerError.data` end-to-end

### 🧹 Code Quality

- Added missing `@evjs/manifest` dependency to `@evjs/shared`
- Removed unused `glob` and `picocolors` from `@evjs/cli`
- Removed dead `import "node:module"` side-effect import in utoopack adapter
- Removed redundant `HotModuleReplacementPlugin` (already provided by webpack-dev-server)
- Added `toHttpMethod()` normalizer for safe, case-insensitive HTTP method handling
- Resolved all Biome lint warnings across the monorepo

### 📝 Documentation

- Fixed 6 phantom API references documenting non-existent functions (`handleServerFunctions`, `setContext`/`getContext`, `createNodeServer`, `WebSocketTransport`, `resolveProjectRoot`/`loadManifest`)
- Corrected API names: `createNodeServer` → `serve`, `createServer` → `createFetchHandler`
- Fixed `ServerError` constructor signature in docs (2 args, not 3)
- Fixed stale package paths (`packages/webpack-plugin` → `packages/bundler-webpack`)
- Fixed stale dependency graph (`@evjs/shared` now depends on `@evjs/manifest`)
- Fixed wrong server function endpoint config path in docs
- Synced all fixes to Chinese (zh-Hans) documentation

---

## [0.0.16] — 2026-04-03

### ✨ Features

- **CSR-only mode** — `server: false` in `ev.config.ts` produces a flat `dist/` output with no server bundle; `"use server"` modules cause a build error

### 🧹 Code Quality

- Codebase review fixes across 15 files (19 issues)
- Fixed outdated `createHandler()` references → `createFetchHandler()`

### 🐛 Bug Fixes

- Improved E2E test isolation with dynamic ports and unique temp dirs
- Fixed E2E tests to use correct manifest path `dist/client/manifest.json`

---

## [0.0.15] — 2026-04-03

### ✨ Changes

- **Split build manifest** into separate `dist/client/manifest.json` and `dist/server/manifest.json` for improved build modularity
- Updated `@evjs/manifest` types: `ServerManifest` + `ClientManifest` replace the unified `Manifest`
- Fixed project structure docs to use code-based routing and `global.ts`

---

## [0.0.14] — 2026-04-02

### ⚠️ Breaking Changes

- **`server.backend` renamed to `server.runtime`** — The config field that specifies the JS runtime command (`node`, `bun`, `deno`) has been renamed for clarity. Update your `ev.config.ts` if you were using this field.

---

## [0.0.13] — 2026-04-02

### 🐛 Bug Fixes

- **CSR-only dev server fix** — `ManifestCollector.entry` defaulted to `"main.js"`, causing CSR-only apps to crash on `ev dev`. The entry is now `undefined` when no server bundle is produced.

---

## [0.0.12] — 2026-04-01

### 🐛 Bug Fixes

- Fixed `create-app` scaffolding: restored `basic-server-routes` symlink after npm pack
- Fixed `bundler-webpack`: removed `devServerOverrides` spread leaking `https` into devServer config
- Removed fallback RSA certificate generation for HTTPS (explicit key/cert now required)
- Fixed E2E `ENOTEMPTY` race condition by spawning node directly

---

## [0.0.11] — 2026-04-01

### ✨ Changes

- Reverted scaffolding package name from `create-ev-app` back to `@evjs/create-app`
- Reverted registry publishing to use token-based auth for stability

---

## [0.0.10] — 2026-04-01

### 🐛 Bug Fixes

- Updated docs landing page terminal preview
- Removed npm caching from CI workflows to resolve `husky` permission errors
- Fixed stale `create-evjs-app` references in lockfile

---

## [0.0.9] — 2026-04-01

### ✨ Changes

- Renamed scaffolding package `@evjs/create-app` → `create-evjs-app` (later reverted in v0.0.11)

---

## [0.0.8] — 2026-04-01

### ✨ Features

- **String literal route paths** — Enforced compile-time string literal types for `path` in `createRoute()` and `route()`, ensuring routes are statically analyzable

### 📝 Documentation

- Added comprehensive READMEs for all published packages
- Standardized scaffolding command to `npx create-evjs-app`

---

## [0.0.7] — 2026-03-31

### ✨ Features

- **Bundler adapter architecture** — Decoupled bundler logic with a new adapter layer, enabling future bundler backends (Rspack, Vite)
- **Renamed** `@evjs/webpack-plugin` → `@evjs/bundler-utoopack` with relocated adapter logic
- **Docusaurus site** — Redesigned landing page, added config/dev/build/deploy guides, Mermaid diagrams, and Chinese (zh-Hans) i18n

### 🐛 Bug Fixes

- Fixed `ERR_REQUIRE_CYCLE_MODULE` in Node 22 CI
- Fixed mobile navbar sidebar z-index stacking
- Cleaned up technical debt and lint warnings

---

## [0.0.6] — 2026-03-30

### ✨ Features

- **`getFnQueryOptions()`** — New extractor replacing deprecated `serverFn()` wrapper for TanStack Query integration
- **Project structure guide** — Documented recommended FSD (Feature-Sliced Design) conventions

---

## [0.0.5] — 2026-03-30

### ✨ Features

- **Server function metadata** — `.queryKey()`, `.fnId`, `.fnName` properties on server function stubs for cache invalidation and introspection
- **Docusaurus documentation site** — Full docs with config, dev, build, deploy pages; Mermaid diagram support; GitHub Pages deployment
- **Chinese (zh-Hans) i18n** — Complete translated documentation

### 🧹 Code Quality

- Renamed `EvPlugin` loaders to `module.rules` for webpack alignment

---

## [0.0.4] — 2026-03-26

### 🐛 Bug Fixes

- Added `declaration: true` to `packages/cli/tsconfig.json` to emit type declarations during build

---

## [0.0.3] — 2026-03-26

### ✨ Features

- **Programmatic CLI API** — Extracted `dev(config?, options?)` and `build(config?, options?)` for programmatic usage alongside the CLI
- **HTTPS support** — Added self-signed HTTPS generation for the local dev server (`server.dev.https`)
- **Config cleanup** — Restructured `ServerConfig` with nested endpoints, removed stale dev options

---

## [0.0.2] — 2026-03-24

### 🎉 First Stable Release

The first stable release of evjs — a React fullstack framework with server functions and programmatic route handlers.

- **Server Functions** — `"use server"` RPC with type-safe `useQuery`/`useSuspenseQuery`
- **Route Handlers** — `route(path, { GET, POST, ... })` REST API with middleware, auto-OPTIONS, auto-HEAD, 405 fallback
- **Zero-Config CLI** — `ev dev`, `ev build` with Webpack, SWC, and HMR
- **Plugin System** — `EvPlugin` with module rules for custom loaders (Tailwind, SVG, etc.)
- **Multi-Runtime** — Hono-based server with Node.js and ECMA (Deno/Bun) adapters
- **TypeScript 6** — Full TypeScript 6.0 support across all packages
