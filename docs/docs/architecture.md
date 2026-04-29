# Architecture

## Overview

evjs is a React fullstack framework with type-safe routing (TanStack Router), data fetching (TanStack Query), and server functions (`"use server"`). It uses a Hono-based API server and is designed to be bundler-agnostic.

## Build-Time Architecture

```
┌─────────────────────────── Build Time ───────────────────────────┐
│                                                                  │
│  @evjs/cli ──► @evjs/bundler-utoopack ──► @evjs/manifest           │
│                      ▲                    (manifests)            │
│  @evjs/build-tools ──┘                                           │
│  (bundler-agnostic)                                              │
│                                                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
┌──────── Client (Browser) ────────┐ ┌──────── Server (Node/Edge) ──────┐
│                                  │ │                                   │
│  TanStack Router                 │ │  Hono App (createApp)             │
│  TanStack Query                  │ │  registerServerReference() + createRoute()│
│  createServerReference() stubs   │ │  createFetchHandler()             │
│  ServerTransport ────────────────┼─┼──► POST /api/fn ──► registry     │
│                                  │ │                                   │
└──────────────────────────────────┘ └───────────────────────────────────┘
```

## Package Dependency Graph

```
@evjs/cli ──► @evjs/bundler-utoopack ──► @evjs/build-tools ──► @swc/core
    │
    └──► webpack (Node API)

@evjs/shared ──► @evjs/manifest

@evjs/server ──► @evjs/shared, hono, @hono/node-server
@evjs/client ──► @evjs/shared, @tanstack/react-router, @tanstack/react-query
```

## Configuration Flow

```
ev.config.ts ──► defineConfig({ entry, html, dev, server, plugins })
                    │
                    ├── entry, html ──► webpack entry + HtmlPlugin
                    ├── plugins ──► EvPlugin[] (setup → buildStart/bundler/transformHtml/buildEnd)
                    ├── dev.port ──► dev server port
                    ├── server.endpoint ──► EvBundlerPlugin + proxy path
                    ├── server.dev.port ──► API server port
                    └── server.dev.https ──► HTTPS for API server
                    │
                    ▼
            plugin.setup(ctx) → collect hooks
                    │
                    ▼
            hooks.buildStart() → hooks.bundlerConfig(config) → BundlerAdapter.dev/build()
                    │
                    ▼
              bundler compile → generateHtml() → hooks.transformHtml(doc) → hooks.buildEnd(result)
```

## Server Function Pipeline

The `"use server"` directive triggers two separate transforms during build:

```
               ┌── Client Build ──► import { createServerReference } from '@evjs/client/transport'
               │                    export const getUsers = createServerReference(fnId, "getUsers")
.server.ts ────┤
               │
               │
               └── Server Build ──► import { registerServerReference } from '@evjs/server/register'
                                    // original body preserved
                                    registerServerReference("getUsers", fnId, "getUsers")
```

## Dev Server Architecture

```
Browser ──(:3000)──► Dev Server ──► HMR (static assets)
                          │
                          └── /api/* proxy ──► Node Server (:3001)
                                                    │
                                              Hono App
                                                    │
                                              POST /api/fn
                                                    │
                                              registry.get(fnId)(...args)
```

`ev dev` uses the bundler Node API directly:
1. Creates webpack compiler + dev server in-process
2. Polls for `dist/server/manifest.json`
3. Writes a CJS bootstrap and runs it with `node --watch`

## Build Flow (`ev build`)

1. `loadConfig(cwd)` — loads `ev.config.ts` or returns defaults
2. `createWebpackConfig(config, cwd)` — generates webpack config (no temp files)
3. Calls `utoopack()` Node API directly
4. `@evjs/bundler-utoopack` runs during compilation:
   - Discovers `*.server.ts` via glob
   - Applies SWC transforms (client + server variants)
   - Runs child compiler for server bundle
   - Emits `dist/server/manifest.json` and `dist/client/manifest.json`

## Deployment Adapters

```
Node.js          server.entry.mjs ──► @hono/node-server
ECMA (Deno/Bun)  server.entry.mjs ──► createFetchHandler(app)
Service Worker   sw.entry.js ──► self.addEventListener('fetch', ...)
```
