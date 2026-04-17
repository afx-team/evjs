# Changelog

All notable changes to evjs are documented here. Releases follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### ✨ Features

- **Added `@evjs/bundler-utoopack`** — Integrated the Turbopack-based `utoopack` bundler via a new adapter package. Leverages native `"use server"` support for lightning-fast server function compilation and HMR.

### ♻️ Refactoring

- **Renamed `route()` to `createRoute()`** — Aligned the server-side route factory naming with the existing client-side API for better consistency across the framework.

---

## [0.0.22] — 2026-04-10

### ♻️ Refactoring

- **Reorganized plugin architecture** — Split the monolithic `bundler-webpack/src/index.ts` (381 lines) into focused modules under `plugin/`:
  - `plugin/index.ts` — `EvWebpackPlugin` orchestrator
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

- Renamed internal `publicPath` to `assetPrefix` across `@evjs/build-tools`, `@evjs/bundler-webpack`, `@evjs/manifest`, and `@evjs/ev` for naming consistency with Next.js conventions
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
- Added typed `webpack()` helper in `@evjs/bundler-webpack` for type-safe bundler config manipulation inside plugins
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
- Removed dead `import "node:module"` side-effect import in webpack adapter
- Removed redundant `HotModuleReplacementPlugin` (already provided by webpack-dev-server)
- Added `toHttpMethod()` normalizer for safe, case-insensitive HTTP method handling
- Resolved all Biome lint warnings across the monorepo

### 📝 Documentation

- Fixed 6 phantom API references documenting non-existent functions (`handleServerFunctions`, `setContext`/`getContext`, `createNodeServer`, `WebSocketTransport`, `resolveProjectRoot`/`loadManifest`)
- Corrected API names: `createNodeServer` → `serve`, `createServer` → `createFetchHandler`
- Fixed `ServerError` constructor signature in docs (2 args, not 3)
- Fixed stale package paths (`packages/webpack-plugin` → `packages/bundler-webpack`)
- Fixed stale dependency graph (`@evjs/shared` now depends on `@evjs/manifest`)
- Fixed wrong config path (`server.functions.endpoint` → `server.endpoint`)
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
- **Renamed** `@evjs/webpack-plugin` → `@evjs/bundler-webpack` with relocated adapter logic
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
