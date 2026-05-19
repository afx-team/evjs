# Architecture

## Overview

evjs is a React fullstack framework with type-safe routing (TanStack Router), data fetching (TanStack Query), and server functions (`"use server"`). It uses a Hono-based API server and is designed to be bundler-agnostic.

## Build-Time Architecture

```
┌─────────────────────────── Build Time ───────────────────────────┐
│                                                                  │
│  @evjs/cli ──► @evjs/ev ──► BundlerAdapter ──► @evjs/bundler-utoopack │
│                     │                         ├── @evjs/build-tools  │
│                     │                         └── @evjs/manifest     │
│               config, plugins, orchestration        (manifests)      │
│                                                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
┌──────── Client (Browser) ────────┐ ┌──────── Server (Node/Edge) ──────┐
│                                  │ │                                   │
│  TanStack Router                 │ │  Hono App (createApp)             │
│  TanStack Query                  │ │  registerServerReference() + createRoute()│
│  createServerReference() stubs   │ │  fetch handler                    │
│  TransportAdapter ───────────────┼─┼──► POST api/fn ─► registry     │
│                                  │ │                                   │
└──────────────────────────────────┘ └───────────────────────────────────┘
```

## Package Dependency Graph

```
@evjs/cli ──► @evjs/ev ──► @evjs/manifest
    │
    └──► @evjs/bundler-utoopack ──► @evjs/build-tools ──► @swc/core

@evjs/shared ──► @evjs/manifest

@evjs/server ──► @evjs/shared, hono, @hono/node-server
@evjs/client ──► @evjs/shared, @tanstack/react-router, @tanstack/react-query
```

## Configuration Flow

```
ev.config.ts ──► defineConfig({ entry, html, dev, server, plugins })
                    │
                    ├── entry, html ──► Utoopack entries + HTML templates
                    ├── plugins ──► EvPlugin[] (setup → buildStart/bundler/transformHtml/buildEnd)
                    ├── dev.port ──► dev server port
                    ├── server.functions.endpoint ──► server function defines + proxy path
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
                                              POST api/fn
                                                    │
                                              registry.get(fnId)(...args)
```

`ev dev` uses the active bundler adapter directly:
1. Starts the Utoopack dev server for client HMR
2. Polls for `dist/server/manifest.json`
3. Writes a CJS bootstrap and runs the server bundle with Node

## Build Flow (`ev build`)

1. `loadConfig(cwd)` — loads `ev.config.ts` or returns defaults
2. `createUtoopackConfig(config, cwd, hooks)` — maps evjs config into Utoopack config
3. Calls the Utoopack Node API through `@evjs/bundler-utoopack`
4. `@evjs/bundler-utoopack` runs during compilation:
   - Runs client and server bundle compilation
   - Uses Utoopack server function config for `"use server"` references
   - Analyzes stats and source metadata for assets, routes, and functions
   - Emits `dist/server/manifest.json` and `dist/client/manifest.json`

## Deployment Adapters

```
Node.js          server.entry.mjs ──► @hono/node-server
Fetch runtimes    server.entry.mjs ──► export default { fetch }
Service Worker   sw.entry.js ──► self.addEventListener('fetch', ...)
```
