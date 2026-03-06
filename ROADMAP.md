# ev Framework — Roadmap

## ✅ Stage 1 — Client-First SPA

Foundation: a zero-config React SPA with type-safe routing and data fetching.

- `createApp({ routeTree })` — wires Router + QueryClient + DOM mount
- Code-based routing via TanStack Router (`createRoute`, `Link`, `Outlet`)
- Data fetching via TanStack Query (re-exported hooks)
- `createAppRootRoute` with typed loader context (`queryClient`)
- CLI: `ev init` / `ev dev` / `ev build`

## ✅ Stage 2 — React Server Functions

Call server-side logic from the browser as normal async functions.

- `"use server"` directive detection and transformation
- Client transform: function bodies → `__ev_call(fnId, args)` RPC stubs
- Server transform: original bodies kept + `registerServerFn(fnId, fn)` injected
- Webpack plugin with auto-discovery and child compiler
- `query()` / `mutation()` proxies for zero-boilerplate TanStack Query integration
- `createQueryProxy` / `createMutationProxy` for module-level typed proxies
- Configurable RPC endpoint (`configureTransport`, `createApp({ rpcEndpoint })`)
- Pluggable `ServerTransport` interface
- Multi-runtime deployment: Node.js, ECMA (Deno/Bun/Workers), Service Worker
- Bundler-agnostic core (`@evjs/build-tools`) with Webpack adapter
- Versioned manifest schema (`manifest.json` v1)
- JSON-based RPC wire format (`{ fnId, args }` → `{ result }`)

## 🔲 Exploring

Future directions under consideration. Nothing committed yet.

- **Server context** _(next up)_: Providing request context (headers, cookies, auth) to server functions
- **Pluggable serialization**: Extendable serialize/deserialize hooks so users can bring their own library (e.g. `superjson`, `devalue`) — framework stays JSON by default
- **SSR**: Server-side rendering with HTML streaming and hydration
- **RSC**: React Server Components via Flight protocol
- **More bundlers**: Vite and Rspack plugins (leveraging `@evjs/build-tools`)
