# Roadmap

## ✅ Stage 1 — Client-First SPA

Foundation: a zero-config React SPA with type-safe routing and data fetching.

- `createApp({ routeTree })` — wires Router + QueryClient + DOM mount
- Code-based routing via TanStack Router (nested layouts, typed loaders)
- Data fetching via TanStack Query (re-exported hooks)
- CLI: `npx @evjs/create-app`, `ev dev`, `ev build`

## ✅ Stage 2 — Server Functions

Call server-side logic from the browser as normal async functions.

- `"use server"` directive detection via SWC AST parsing
- Client/server transforms with stable SHA-256 function IDs
- `query(fn).useQuery()` / `mutation(fn).useMutation()` — zero-boilerplate wrappers
- Pluggable `TransportAdapter` interface
- Hono-based server with multi-runtime adapters
- Server context helpers for request access (`request`, `headers`, `cookies`, `waitUntil`)
- Versioned manifest schema (`manifest.json` v1)

## ✅ Stage 3 — Zero-Config Fullstack Framework

- Zero-config `ev build` / `ev dev` — no `custom bundler config file` needed
- `ev.config.ts` with `defineConfig()` for optional customization
- MPA via `pages` for multi-entry builds
- bundler Node API — no temp config files, no subprocess spawning

## ✅ Stage 4 — Plugin System & Build Metadata

- `EvPlugin` interface with `name` + `setup()` → lifecycle hooks (`buildStart`, `bundlerConfig`, `transformHtml`, `buildEnd`)
- Manifest client section (`client.assets`, `client.routes`)
- Template symlinks for `npx @evjs/create-app`

## ✅ Stage 5 — Bundler-Agnostic Architecture

- `BundlerAdapter` interface for pluggable bundler backends
- `@evjs/bundler-utoopack` — default adapter using `@utoo/pack`
- `@evjs/bundler-utoopack` — utoopack adapter
- `ev.config.ts` `bundler` field to switch adapters

## 🔲 Exploring

Future directions under consideration:

- **SSR** — server-side rendering with hydration
- **More bundlers** — Rspack, Vite plugins via `@evjs/build-tools`
