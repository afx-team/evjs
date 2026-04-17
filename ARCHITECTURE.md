# Architecture

## Overview

`evjs` is a React fullstack framework with type-safe routing (TanStack Router), data fetching (TanStack Query), and server functions (`"use server"`). It uses a Hono-based API server and is designed to be bundler-agnostic.

```
┌─────────────────────────── Build Time ───────────────────────────┐
│                                                                  │
│  @evjs/cli ──► BundlerAdapter ──► @evjs/bundler-webpack        │
│                      │           (adapter logic)             │
│                      ▼                                       │
│  @evjs/build-tools ──┴──► @evjs/manifest (manifests)          │
│  (bundler-agnostic)                                              │
│                                                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
┌──────── Client (Browser) ────────┐ ┌──────── Server (Node/Edge) ──────┐
│                                  │ │                                   │
│  TanStack Router                 │ │  Hono App (createApp)             │
│  TanStack Query                  │ │  registerServerFn() + createRoute()     │
│  __fn_call() stubs               │ │  createFetchHandler()             │
│  ServerTransport ────────────────┼─┼──► POST /api/fn ──► registry     │
│                                  │ │                                   │
└──────────────────────────────────┘ └───────────────────────────────────┘
```

## Package Dependency Graph

```
@evjs/ev ──► @evjs/manifest, @evjs/shared

@evjs/shared (zero deps — runtime only: errors, HTTP, constants)

@evjs/cli ──► @evjs/ev, @evjs/bundler-webpack
@evjs/bundler-webpack ──► @evjs/ev, @evjs/build-tools, @evjs/manifest
@evjs/server ──► @evjs/shared, hono, @hono/node-server
@evjs/client ──► @evjs/shared, @tanstack/react-router, @tanstack/react-query
```

## Configuration Flow

```
ev.config.ts ──► defineConfig({ entry, html, dev, server, plugins })
                    │
                    ├── entry, html ──► webpack entry + HtmlPlugin
                    ├── dev.port ──► WebpackDevServer port
                    ├── server.endpoint ──► EvWebpackPlugin + proxy path
                    └── plugins ──► EvPlugin[] (setup → buildStart/bundler/transformHtml/buildEnd)
                    │
                    ▼
            plugin.setup(ctx) → collect hooks
                    │
                    ▼
            hooks.buildStart() → hooks.bundler(config) → BundlerAdapter.dev/build()
                    │
                    ▼
              webpack Node API → generateHtml() → hooks.transformHtml(doc) → hooks.buildEnd(result)
```

## Server Function Pipeline

```
               ┌── Client Build ──► import { __fn_call } from 'transport'
               │                    export function getUsers(...args) {
.server.ts ────┤                      return __fn_call(fnId, args)
               │                    }
               │
               └── Server Build ──► import { registerServerFn } from 'server'
                                    // original body preserved
                                    registerServerFn(fnId, getUsers)
```

## Build-Tools Structure

```
packages/build-tools/src/
├── index.ts          barrel exports
├── codegen.ts        SWC parseSync → printSync code emitter
├── entry.ts          server entry generation
├── html.ts           HTML template parsing + asset injection (domparser-rs)
├── routes.ts         route metadata extraction from createRoute() calls
├── types.ts          shared types + RUNTIME identifier constants
├── utils.ts          detectUseServer, makeFnId, parseModuleRef
└── transforms/
    ├── index.ts      orchestrator: parse → extract → delegate
    ├── utils.ts      extractExportNames (AST traversal)
    ├── client/
    │   └── index.ts  buildClientOutput (__fn_call stubs)
    └── server/
        └── index.ts  buildServerOutput (registerServerFn + manifest)
```

### RUNTIME Constants

All runtime identifiers used in generated code are centralized in `types.ts`:

```ts
export const RUNTIME = {
  serverModule: "@evjs/server/register",
  appModule: "@evjs/server",
  clientTransportModule: "@evjs/client/transport",
  registerServerFn: "registerServerFn",
  clientCall: "__fn_call",
  clientRegister: "__fn_register",
} as const;
```

## Dev Server Architecture

```
Browser ──(:3000)──► WebpackDevServer ──► HMR (static assets)
                          │
                          └── /api/* proxy ──► Node Server (:3001)
                                                    │
                                              Hono App
                                                    │
                                              POST /api/fn
                                                    │
                                              registry.get(fnId)(...args)
```

`ev dev` uses the webpack Node API directly:
1. Creates webpack compiler + WebpackDevServer in-process
2. Polls for `dist/server/manifest.json`
3. Writes a CJS bootstrap and runs it with `node --watch`

## Deployment Adapters

```
Node.js          server.entry.mjs ──► @hono/node-server
ECMA (Deno/Bun)  server.entry.mjs ──► createFetchHandler(app)
Service Worker   sw.entry.js ──► self.addEventListener('fetch', ...)
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the full, detailed roadmap.
