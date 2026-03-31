# ev Framework — Roadmap

## ✅ Stage 1 — Client-First SPA

Foundation: a zero-config React SPA with type-safe routing and data fetching.

- [x] `createApp({ routeTree })` — wires Router + QueryClient + DOM mount
- [x] Code-based routing via TanStack Router
  - [x] `createRoute`, `createRootRoute`, `createAppRootRoute`
  - [x] `Link`, `Outlet`, nested layouts
  - [x] Typed loader context with `queryClient`
- [x] Data fetching via TanStack Query
  - [x] Re-exported hooks: `useQuery`, `useMutation`, `useSuspenseQuery`, etc.
  - [x] `QueryClientProvider` wired automatically
- [x] CLI
  - [x] `npx @evjs/create-app` — scaffold from example templates
  - [x] `ev dev` — unified dev server (client HMR + server watch)
  - [x] `ev build` — single-command production build

## ✅ Stage 2 — Server Functions

Call server-side logic from the browser as normal async functions.

- [x] Build pipeline
  - [x] `"use server"` directive detection via SWC AST parsing
  - [x] Client transform: function bodies → `__fn_call(fnId, args)` server function stubs
  - [x] Server transform: original bodies kept + `registerServerFn(fnId, fn)` injected
  - [x] Stable function IDs derived from file path + export name (SHA-256)
  - [x] Bundler-agnostic transforms in `@evjs/build-tools`
- [x] Webpack integration
  - [x] `EvWebpackPlugin` with auto-discovery and child compiler
  - [x] `server-fn-loader` — thin adapter delegating to `@evjs/build-tools`
  - [x] Dynamic server entry generation (no manual config)
- [x] Query integration
  - [x] `query(fn).useQuery()` / `mutation(fn).useMutation()` — zero-boilerplate wrappers
  - [x] `createQueryProxy` / `createMutationProxy` — module-level typed proxies
  - [x] `.queryOptions()`, `.queryKey()` for prefetching and cache invalidation
- [x] Transport
  - [x] JSON-based server function wire format (`{ fnId, args }` → `{ result }`)
  - [x] Configurable endpoint: `initTransport({ baseUrl, endpoint })`
  - [x] Pluggable `ServerTransport` interface for custom protocols
- [x] Server runtime
  - [x] Hono-based server function handler with request validation
  - [x] `createApp()` — configurable API path via `server.functions.endpoint`
  - [x] Multi-runtime: Node.js, ECMA (Deno/Bun/edge) adapters
- [x] Manifest
  - [x] Versioned schema (`manifest.json` v1)
  - [x] Maps function IDs → module + export name
- [x] Dev experience
  - [x] Reverse proxy in dev server (`/api/*` → API server)
  - [x] E2E tests with parallel execution and dynamic ports

## ✅ Stage 3 — Zero-Config Fullstack Framework

DX improvements: unified CLI and zero-config builds.

- [x] Zero-config `ev build` / `ev dev` — no `webpack.config.cjs` needed
- [x] `ev.config.ts` with `defineConfig()` for optional customization
- [x] Config split: `ClientConfig` (entry, html, plugins, dev) + `ServerConfig` (entry, backend, functions, plugins, dev)
- [x] webpack Node API — no temp config files, no subprocess spawning
- [x] All examples migrated to zero-config
- [x] E2E tests use `ev build` directly

## ✅ Stage 4 — Plugin System & Build Metadata

Extensibility and richer build output.

- [x] Plugin module rules system (`client.plugins` / `server.plugins`)
  - [x] `EvPlugin` interface with `name` + `config` + `bundler` hooks
  - [x] `EvModuleRule` with `test`, `exclude`, `use` (string or `{ loader, options }`)
  - [x] Tailwind CSS example (`with-tailwind`) using `postcss-loader`
- [x] Manifest client section
  - [x] `client.assets: { js, css }` — bundle asset paths
  - [x] `client.routes: RouteEntry[]` — discovered route paths
- [x] Template symlinks for `npx @evjs/create-app` (no duplication between examples and templates)

## 🔲 Exploring

Future directions under consideration. Nothing committed yet.

- [ ] **MPA (Multi-Page Application)**
  - [ ] `client.pages` field: `Record<string, { entry, html? }>`
  - [ ] Multiple webpack entries + HtmlWebpackPlugin instances
  - [ ] Takes precedence over `client.entry` / `client.html` when set
- [ ] **Server context** _(next up)_
  - [ ] Provide request context (headers, cookies, auth) to server functions
  - [ ] Transparent to user code — no manual parameter passing

- [ ] **SSR**
  - [ ] Server-side rendering with fallback to CSR
  - [ ] HTML streaming and hydration
- [ ] **RSC**
  - [ ] React Server Components via Flight protocol
- [ ] **More bundlers**
  - [ ] Utoo, Rspack, and Vite plugins, leveraging `@evjs/build-tools`

