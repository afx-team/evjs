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
  - [x] `ev init` — scaffold from example templates
  - [x] `ev dev` — unified dev server (client HMR + server watch)
  - [x] `ev build` — single-command production build

## ✅ Stage 2 — Server Functions

Call server-side logic from the browser as normal async functions.

- [x] Build pipeline
  - [x] `"use server"` directive detection via SWC AST parsing
  - [x] Client transform: function bodies → `__ev_call(fnId, args)` RPC stubs
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
  - [x] JSON-based RPC wire format (`{ fnId, args }` → `{ result }`)
  - [x] Configurable endpoint: `configureTransport({ baseUrl, endpoint })`
  - [x] Pluggable `ServerTransport` interface for custom protocols
- [x] Server runtime
  - [x] Hono-based RPC handler with request validation
  - [x] `createApp({ rpcEndpoint })` — configurable API path
  - [x] Multi-runtime: Node.js, ECMA (Deno/Bun/Workers), Service Worker adapter
- [x] Manifest
  - [x] Versioned schema (`manifest.json` v1)
  - [x] Maps function IDs → module + export name
- [x] Dev experience
  - [x] Reverse proxy in dev server (`/api/*` → API server)
  - [x] E2E tests with parallel execution and dynamic ports

## 🔲 Exploring

Future directions under consideration. Nothing committed yet.

- [ ] **Server context** _(next up)_
  - [ ] Provide request context (headers, cookies, auth) to server functions
  - [ ] Transparent to user code — no manual parameter passing
- [ ] **Pluggable serialization**
  - [ ] Extendable serialize/deserialize hooks
  - [ ] Framework stays JSON by default
- [ ] **SSR**
  - [ ] Server-side rendering with fallback to CSR
  - [ ] HTML streaming and hydration
- [ ] **RSC**
  - [ ] React Server Components via Flight protocol
- [ ] **More bundlers**
  - [ ] Utoo, Rspack, and Vite plugins, leveraging `@evjs/build-tools`

