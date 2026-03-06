# Architecture

## Overview

`ev` is a React meta-framework with type-safe routing (TanStack Router), data fetching (TanStack Query), and server functions (`"use server"`). It uses a Hono-based API server and is designed to be bundler-agnostic.

```
┌──────────────────────────────────────────────────────┐
│ Build Time                                           │
│                                                      │
│   @evjs/cli             @evjs/build-tools            │
│   (ev dev / build)      (bundler-agnostic core)      │
│        │                     │                       │
│        ▼                     ▼                       │
│   @evjs/webpack-plugin  ← thin adapter              │
│   (EvWebpackPlugin + server-fn-loader)               │
│        │                                             │
│        ▼                                             │
│   @evjs/manifest (manifest.json v1 schema)           │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│ Runtime                                              │
│                                                      │
│   Client (Browser)          Server (Node/Edge/Bun)   │
│   ────────────────          ──────────────────────   │
│   TanStack Router           Hono App (createApp)     │
│   TanStack Query            registerServerFn()       │
│   __ev_call() stubs         createRpcMiddleware()    │
│   ServerTransport           Runner API (runNodeServer)│
└──────────────────────────────────────────────────────┘
```

## Package Dependency Graph

```
@evjs/cli
  └─▶ spawns webpack with @evjs/webpack-plugin

@evjs/webpack-plugin
  └─▶ @evjs/build-tools (pure functions, no bundler deps)

@evjs/build-tools
  └─▶ @swc/core (parse + print)

@evjs/runtime
  ├─▶ hono, @hono/node-server (server)
  ├─▶ @tanstack/react-router (client)
  └─▶ @tanstack/react-query (client)
```

## Server Function Pipeline

```
Source (.server.ts)
  │
  ├─ Client Build ──▶ transforms/client/
  │                   Replaces function bodies with:
  │                     import { __ev_call } from "@evjs/runtime/client/transport"
  │                     export function getUsers(...args) { return __ev_call(fnId, args) }
  │                     getUsers.evId = fnId
  │
  └─ Server Build ──▶ transforms/server/
                      Keeps original source, prepends:
                        import { registerServerFn } from "@evjs/runtime/server"
                      Appends:
                        registerServerFn(fnId, getUsers)
```

## Build-Tools Internals

```
packages/build-tools/src/
  codegen.ts              SWC parseSync→printSync code emitter
  entry.ts                Server entry generation
  types.ts                Shared types + RUNTIME identifier constants
  utils.ts                detectUseServer, makeFnId, parseModuleRef
  index.ts                Barrel re-exports
  transforms/
    index.ts              Orchestrator: parse → extract → delegate
    utils.ts              extractExportNames (AST traversal)
    client/
      index.ts            buildClientOutput (__ev_call stubs)
    server/
      index.ts            buildServerOutput (registerServerFn + manifest)
```

### RUNTIME Constants

All runtime identifiers used in generated code are centralized in `types.ts`:

```ts
export const RUNTIME = {
  serverModule: "@evjs/runtime/server",
  clientTransportModule: "@evjs/runtime/client/transport",
  registerServerFn: "registerServerFn",
  clientCall: "__ev_call",
  fnIdProp: "evId",
} as const;
```

## Dev Server Architecture

```
Browser ──▶ Webpack Dev Server (port 3000)
               │
               ├─ Static assets (HMR)
               │
               └─ /api/* ──proxy──▶ Node Server (port 3001)
                                      │
                                      └─ Hono App
                                           └─ POST /api/rpc (default, configurable via rpcEndpoint)
                                                └─ registry.get(fnId)(...args)
```

## Deployment Adapters

```
┌─ Node.js ──────────────────────────────────┐
│  server.entry.mjs → @hono/node-server      │
└────────────────────────────────────────────┘

┌─ ECMA (Deno/Bun/Workers) ──────────────────┐
│  server.entry.mjs → @evjs/runtime/server/ecma │
│  export default createHandler(app)         │
└────────────────────────────────────────────┘

┌─ Service Worker (browser-offline) ─────────┐
│  swMock.entry.js → self.addEventListener   │
│  Intercepts fetch, routes to Hono app      │
└────────────────────────────────────────────┘

## Roadmap

- [x] **Stage 1: Client-first SPA (Router + Query)**
- [x] **Stage 2: React Server Functions (use server)**
- [ ] **Stage 3: Production Readiness & Architecture**
  - [ ] **Parallel Compilation**: Move server build out of the `finishModules` blocked phase into a parallel sibling compiler for faster HMR.
  - [ ] **Smart Serialization**: Integrate `superjson` or `seroval` to support Complex JS types (Date, Map, Set, Error) across the RPC boundary.
  - [ ] **Server Context**: Implement `AsyncLocalStorage` to provide request context (Cookies, Headers, Auth) invisibly to server functions.
  - [ ] **Error Boundaries**: Standardize how server-side RPC errors reflect in the client UI.
- [ ] **Stage 4: Server-Side Rendering (SSR)**
  - [ ] HTML streaming & Hydration
- [ ] **Stage 5: React Server Components (RSC)**
