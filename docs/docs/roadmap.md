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
- Pluggable `ServerTransport` interface
- Hono-based server with multi-runtime adapters
- Versioned manifest schema (`manifest.json` v1)

## ✅ Stage 3 — Zero-Config Fullstack Framework

- Zero-config `ev build` / `ev dev` — no `webpack.config.cjs` needed
- `ev.config.ts` with `defineConfig()` for optional customization
- webpack Node API — no temp config files, no subprocess spawning

## ✅ Stage 4 — Plugin System & Build Metadata

- `EvPlugin` interface with `name` + `config` + `bundler` hooks
- Manifest client section (`client.assets`, `client.routes`)
- Template symlinks for `npx @evjs/create-app`

## 🔲 Exploring

Future directions under consideration:

- **MPA** — `client.pages` field for multi-entry builds
- **Server context** — request context (headers, cookies, auth) for server functions
- **SSR** — server-side rendering with hydration
- **RSC** — React Server Components via Flight protocol
- **More bundlers** — Rspack, Vite plugins via `@evjs/build-tools`
