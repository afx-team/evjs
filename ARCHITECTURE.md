# Architecture

## Overview

`evjs` is a zero-config React meta-framework with type-safe routing (TanStack Router), data fetching (TanStack Query), and server functions (`"use server"`). It uses a Hono-based API server and is designed to be bundler-agnostic.

```
┌──────────────────────────────────────────────────────┐
│ Build Time                                           │
│                                                      │
│   @evjs/cli             @evjs/build-tools             │
│   (ev dev / build)     (bundler-agnostic core)       │
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
│   __fn_call() stubs         createHandler()          │
│   ServerTransport           Runner API               │
└──────────────────────────────────────────────────────┘
```

## Package Dependency Graph

```
@evjs/cli
  └─▶ webpack Node API (no temp files)
  └─▶ @evjs/webpack-plugin

@evjs/webpack-plugin
  └─▶ @evjs/build-tools (pure functions, no bundler deps)

@evjs/build-tools
  └─▶ @swc/core (parse + print)

@evjs/runtime
  ├─▶ hono, @hono/node-server (server)
  ├─▶ @tanstack/react-router (client)
  └─▶ @tanstack/react-query (client)
```

## Configuration Flow

```
ev.config.ts (optional)
  │
  ▼
defineConfig({ client, server })
  │
  ├─ client.entry, client.html      → webpack entry + HtmlWebpackPlugin
  ├─ client.dev.port                 → WebpackDevServer port
  ├─ server.endpoint                 → EvWebpackPlugin options
  ├─ server.middleware               → server entry middleware
  └─ server.dev.port                 → API server port (dev proxy target)
  │
  ▼
createWebpackConfig() → webpack config object (in-memory, no temp files)
  │
  ▼
webpack Node API (webpack() / WebpackDevServer)
```

## Server Function Pipeline

```
Source (.server.ts)
  │
  ├─ Client Build ──▶ transforms/client/
  │                   Replaces function bodies with:
  │                     import { __fn_call } from "@evjs/runtime/client/transport"
  │                     export function getUsers(...args) { return __fn_call(fnId, args) }
  │
  └─ Server Build ──▶ transforms/server/
                      Keeps original source, prepends:
                        import { registerServerFn } from "@evjs/runtime/server/register"
                      Appends:
                        registerServerFn(fnId, getUsers)
```

## Build-Tools Structure

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
      index.ts            buildClientOutput (__fn_call stubs)
    server/
      index.ts            buildServerOutput (registerServerFn + manifest)
```

### RUNTIME Constants

All runtime identifiers used in generated code are centralized in `types.ts`:

```ts
export const RUNTIME = {
  serverModule: "@evjs/runtime/server/register",
  appModule: "@evjs/runtime/server",
  clientTransportModule: "@evjs/runtime/client/transport",
  registerServerFn: "registerServerFn",
  clientCall: "__fn_call",
  clientRegister: "__fn_register",
} as const;
```

## Dev Server Architecture

```
Browser ──▶ WebpackDevServer (port 3000)
               │
               ├─ Static assets (HMR)
               │
               └─ /api/* ──proxy──▶ Node Server (port 3001)
                                      │
                                      └─ Hono App
                                           └─ POST /api/fn
                                                └─ registry.get(fnId)(...args)
```

`ev dev` uses the webpack Node API directly:
1. Creates webpack compiler + WebpackDevServer in-process
2. Polls for `dist/server/manifest.json`
3. Writes a CJS bootstrap and runs it with `node --watch`

## Deployment Adapters

```
┌─ Node.js ──────────────────────────────────┐
│  server.entry.mjs → @hono/node-server      │
└────────────────────────────────────────────┘

┌─ ECMA (Deno/Bun/Workers) ──────────────────┐
│  server.entry.mjs → @evjs/runtime/server/ecma │
│  export default createFetchHandler(app)         │
└────────────────────────────────────────────┘

┌─ Service Worker (browser-offline) ─────────┐
│  swMock.entry.js → self.addEventListener   │
│  Intercepts fetch, routes to Hono app      │
└────────────────────────────────────────────┘
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the full, detailed roadmap.
