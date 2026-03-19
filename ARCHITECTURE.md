# Architecture

## Overview

`evjs` is a zero-config React meta-framework with type-safe routing (TanStack Router), data fetching (TanStack Query), and server functions (`"use server"`). It uses a Hono-based API server and is designed to be bundler-agnostic.

```mermaid
flowchart TD
    subgraph "Build Time"
        C["@evjs/cli\n(ev dev / build)"] --> P["@evjs/webpack-plugin\n(EvWebpackPlugin + server-fn-loader)"]
        BT["@evjs/build-tools\n(bundler-agnostic core)"] --> P
        P --> M["@evjs/manifest\n(manifest.json v1 schema)"]
    end
    
    M --> Runtime
    
    subgraph "Runtime"
        subgraph "Client (Browser)"
            CR["TanStack Router"]
            CQ["TanStack Query"]
            CS["__fn_call() stubs"]
            CT["ServerTransport"]
        end
        subgraph "Server (Node/Edge/Bun)"
            SH["Hono App (createApp)"]
            SR["registerServerFn()"]
            SCH["createHandler()"]
            SRA["Runner API"]
        end
    end
```

## Package Dependency Graph

```mermaid
flowchart TD
    cli["@evjs/cli"] --> plugin["@evjs/webpack-plugin"]
    cli --> webpack["webpack Node API\n(no temp files)"]
    plugin --> bt["@evjs/build-tools\n(pure functions, no bundler deps)"]
    bt --> swc["@swc/core\n(parse + print)"]
    
    rt["@evjs/runtime"] --> hono["hono, @hono/node-server (server)"]
    rt --> router["@tanstack/react-router (client)"]
    rt --> query["@tanstack/react-query (client)"]
```

## Configuration Flow

```mermaid
flowchart TD
    ec["ev.config.ts (optional)"] --> dc["defineConfig({ client, server })"]
    dc -->|client.entry, client.html| html["webpack entry + HtmlWebpackPlugin"]
    dc -->|client.dev.port| wds["WebpackDevServer port"]
    dc -->|server.endpoint| ewp["EvWebpackPlugin options"]
    dc -->|server.middleware| sm["server entry middleware"]
    dc -->|server.dev.port| api["API server port\n(dev proxy target)"]
    
    dc --> cwc["createWebpackConfig()\nwebpack config object\n(in-memory, no temp files)"]
    cwc --> wapi["webpack Node API\n(webpack() / WebpackDevServer)"]
```

## Server Function Pipeline

```mermaid
flowchart TD
    src["Source (.server.ts)"]
    
    src --> cb["Client Build\n(transforms/client/)"]
    cb --> cb1["import { __fn_call } from '@evjs/runtime/client/transport'"]
    cb1 --> cb2["export function getUsers(...args) { return __fn_call(fnId, args) }"]
    
    src --> sb["Server Build\n(transforms/server/)"]
    sb --> sb1["import { registerServerFn } from '@evjs/runtime/server/register'"]
    sb1 --> sb2["body preserved\nregisterServerFn(fnId, getUsers)"]
```

## Build-Tools Structure

```mermaid
flowchart LR
    subgraph "packages/build-tools/src/"
        direction TB
        codegen["codegen.ts\n(SWC parseSync→printSync code emitter)"]
        entry["entry.ts\n(Server entry generation)"]
        types["types.ts\n(Shared types + RUNTIME ident constants)"]
        utils["utils.ts\n(detectUseServer, makeFnId, parseModuleRef)"]
        idx["index.ts\n(Barrel re-exports)"]
        
        subgraph "transforms/"
            direction TB
            tidx["index.ts\n(Orchestrator: parse → extract → delegate)"]
            tutils["utils.ts\n(extractExportNames AST traversal)"]
            
            subgraph "client/"
                cidx["index.ts\n(buildClientOutput __fn_call stubs)"]
            end
            
            subgraph "server/"
                sidx["index.ts\n(buildServerOutput registerServerFn + manifest)"]
            end
        end
    end
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

```mermaid
flowchart LR
    Browser -->|port 3000| wds["WebpackDevServer"]
    wds -->|Static assets| hmr["HMR"]
    wds -->|/api/* proxy| ns["Node Server (port 3001)"]
    ns --> hono["Hono App"]
    hono --> post["POST /api/fn"]
    post --> reg["registry.get(fnId)(...args)"]
```

`ev dev` uses the webpack Node API directly:
1. Creates webpack compiler + WebpackDevServer in-process
2. Polls for `dist/manifest.json`
3. Writes a CJS bootstrap and runs it with `node --watch`

## Deployment Adapters

```mermaid
flowchart TD
    subgraph "Node.js"
        n1["server.entry.mjs"] --> n2["@hono/node-server"]
    end
    
    subgraph "ECMA (Deno/Bun/Workers)"
        e1["server.entry.mjs"] --> e2["@evjs/runtime/server/ecma\ncreateFetchHandler(app)"]
    end
    
    subgraph "Service Worker (browser-offline)"
        sw1["swMock.entry.js"] --> sw2["self.addEventListener\n(Intercepts fetch, routes to Hono app)"]
    end
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the full, detailed roadmap.
