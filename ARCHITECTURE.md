# Architecture

## Overview

`evjs` is a zero-config React meta-framework with type-safe routing (TanStack Router), data fetching (TanStack Query), and server functions (`"use server"`). It uses a Hono-based API server and is designed to be bundler-agnostic.

```mermaid
flowchart TD
    subgraph build["🔨 Build Time"]
        C["@evjs/cli\nev dev · ev build"]
        BT["@evjs/build-tools\nbundler-agnostic core"]
        P["@evjs/webpack-plugin\nEvWebpackPlugin + loader"]
        M["@evjs/manifest\nmanifest.json v1"]
        C --> P
        BT --> P
        P --> M
    end

    M --> client
    M --> server

    subgraph client["🖥️ Client · Browser"]
        CR["TanStack Router"]
        CQ["TanStack Query"]
        CS["__fn_call stubs"]
        CT["ServerTransport"]
        CR ~~~ CQ
        CS --> CT
    end

    subgraph server["⚙️ Server · Node / Edge / Bun"]
        SH["Hono App"]
        SR["registerServerFn"]
        SCH["createHandler"]
        SRA["Backend API"]
        SH --> SCH
        SCH --> SR
        SCH --> SRA
    end

    CT -.->|"POST /api/fn"| SH

    style build fill:#1a1a2e,stroke:#16213e,color:#e0e0e0
    style client fill:#0f3460,stroke:#16213e,color:#e0e0e0
    style server fill:#533483,stroke:#16213e,color:#e0e0e0
    style C fill:#e94560,stroke:#e94560,color:#fff
    style M fill:#f5a623,stroke:#f5a623,color:#1a1a2e
    style CT fill:#0f3460,stroke:#53c8e0,color:#e0e0e0
    style SH fill:#533483,stroke:#53c8e0,color:#e0e0e0
```

## Package Dependency Graph

```mermaid
flowchart TD
    cli["@evjs/cli"] --> plugin["@evjs/webpack-plugin"]
    cli --> webpack["webpack Node API"]
    plugin --> bt["@evjs/build-tools"]
    bt --> swc["@swc/core"]

    rt["@evjs/runtime"] --> hono["hono"]
    rt --> router["@tanstack/react-router"]
    rt --> query["@tanstack/react-query"]

    style cli fill:#e94560,stroke:#e94560,color:#fff
    style plugin fill:#f5a623,stroke:#f5a623,color:#1a1a2e
    style bt fill:#0f3460,stroke:#0f3460,color:#e0e0e0
    style rt fill:#533483,stroke:#533483,color:#e0e0e0
    style swc fill:#2d3436,stroke:#636e72,color:#dfe6e9
    style webpack fill:#2d3436,stroke:#636e72,color:#dfe6e9
    style hono fill:#2d3436,stroke:#636e72,color:#dfe6e9
    style router fill:#2d3436,stroke:#636e72,color:#dfe6e9
    style query fill:#2d3436,stroke:#636e72,color:#dfe6e9
```

## Configuration Flow

```mermaid
flowchart TD
    ec["ev.config.ts"] --> dc["defineConfig"]

    dc -->|"client.entry\nclient.html"| html["webpack entry\nHtmlWebpackPlugin"]
    dc -->|"client.dev.port"| wds["WebpackDevServer"]
    dc -->|"server.endpoint"| ewp["EvWebpackPlugin"]
    dc -->|"server.middleware"| sm["Server middleware"]
    dc -->|"server.dev.port"| api["API server port"]

    dc --> cwc["createWebpackConfig"]
    cwc --> wapi["webpack Node API"]

    style ec fill:#f5a623,stroke:#f5a623,color:#1a1a2e
    style dc fill:#e94560,stroke:#e94560,color:#fff
    style cwc fill:#0f3460,stroke:#0f3460,color:#e0e0e0
    style wapi fill:#2d3436,stroke:#636e72,color:#dfe6e9
    style html fill:#533483,stroke:#533483,color:#e0e0e0
    style wds fill:#533483,stroke:#533483,color:#e0e0e0
    style ewp fill:#533483,stroke:#533483,color:#e0e0e0
    style sm fill:#533483,stroke:#533483,color:#e0e0e0
    style api fill:#533483,stroke:#533483,color:#e0e0e0
```

## Server Function Pipeline

```mermaid
flowchart LR
    src["📄 .server.ts\nsource"]

    src --> cb["Client Build"]
    cb --> cb1["import __fn_call"]
    cb1 --> cb2["export function getUsers\nreturn __fn_call(fnId, args)"]

    src --> sb["Server Build"]
    sb --> sb1["import registerServerFn"]
    sb1 --> sb2["body preserved\nregisterServerFn(fnId, fn)"]

    style src fill:#f5a623,stroke:#f5a623,color:#1a1a2e
    style cb fill:#0f3460,stroke:#0f3460,color:#e0e0e0
    style cb1 fill:#0f3460,stroke:#16213e,color:#dfe6e9
    style cb2 fill:#0f3460,stroke:#53c8e0,color:#e0e0e0
    style sb fill:#533483,stroke:#533483,color:#e0e0e0
    style sb1 fill:#533483,stroke:#16213e,color:#dfe6e9
    style sb2 fill:#533483,stroke:#53c8e0,color:#e0e0e0
```

## Build-Tools Structure

```mermaid
flowchart LR
    subgraph pkg["packages/build-tools/src/"]
        direction TB
        codegen["codegen.ts\nSWC code emitter"]
        entry["entry.ts\nServer entry gen"]
        types["types.ts\nRUNTIME constants"]
        utils["utils.ts\ndetectUseServer · makeFnId"]
        idx["index.ts\nBarrel exports"]

        subgraph transforms["transforms/"]
            direction TB
            tidx["index.ts\nOrchestrator"]
            tutils["utils.ts\nAST traversal"]
            subgraph cl["client/"]
                cidx["index.ts\n__fn_call stubs"]
            end
            subgraph sv["server/"]
                sidx["index.ts\nregisterServerFn"]
            end
        end
    end

    style pkg fill:#1a1a2e,stroke:#16213e,color:#e0e0e0
    style transforms fill:#0f3460,stroke:#16213e,color:#e0e0e0
    style cl fill:#0f3460,stroke:#53c8e0,color:#e0e0e0
    style sv fill:#533483,stroke:#53c8e0,color:#e0e0e0
    style tidx fill:#0f3460,stroke:#0f3460,color:#e0e0e0
    style tutils fill:#0f3460,stroke:#0f3460,color:#e0e0e0
    style codegen fill:#1a1a2e,stroke:#636e72,color:#dfe6e9
    style entry fill:#1a1a2e,stroke:#636e72,color:#dfe6e9
    style types fill:#f5a623,stroke:#f5a623,color:#1a1a2e
    style utils fill:#1a1a2e,stroke:#636e72,color:#dfe6e9
    style idx fill:#1a1a2e,stroke:#636e72,color:#dfe6e9
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
    browser["🌐 Browser"]
    browser -->|"port 3000"| wds["WebpackDevServer\nHMR + static"]
    wds -->|"/api/* proxy"| ns["Node Server\nport 3001"]
    ns --> hono["Hono App"]
    hono --> post["POST /api/fn"]
    post --> reg["registry.get(fnId)\n(...args)"]

    style browser fill:#e94560,stroke:#e94560,color:#fff
    style wds fill:#0f3460,stroke:#0f3460,color:#e0e0e0
    style ns fill:#533483,stroke:#533483,color:#e0e0e0
    style hono fill:#533483,stroke:#53c8e0,color:#e0e0e0
    style post fill:#f5a623,stroke:#f5a623,color:#1a1a2e
    style reg fill:#2d3436,stroke:#636e72,color:#dfe6e9
```

`ev dev` uses the webpack Node API directly:
1. Creates webpack compiler + WebpackDevServer in-process
2. Polls for `dist/manifest.json`
3. Writes a CJS bootstrap and runs it with `node --watch`

## Deployment Adapters

```mermaid
flowchart TD
    subgraph node["Node.js"]
        n1["server.entry.mjs"] --> n2["@hono/node-server"]
    end

    subgraph ecma["ECMA · Deno / Bun / Workers"]
        e1["server.entry.mjs"] --> e2["createFetchHandler"]
    end

    subgraph sw["Service Worker · offline"]
        sw1["swMock.entry.js"] --> sw2["self.addEventListener\nIntercept fetch → Hono"]
    end

    style node fill:#0f3460,stroke:#16213e,color:#e0e0e0
    style ecma fill:#533483,stroke:#16213e,color:#e0e0e0
    style sw fill:#1a1a2e,stroke:#16213e,color:#e0e0e0
    style n1 fill:#0f3460,stroke:#53c8e0,color:#e0e0e0
    style n2 fill:#2d3436,stroke:#636e72,color:#dfe6e9
    style e1 fill:#533483,stroke:#53c8e0,color:#e0e0e0
    style e2 fill:#2d3436,stroke:#636e72,color:#dfe6e9
    style sw1 fill:#1a1a2e,stroke:#53c8e0,color:#e0e0e0
    style sw2 fill:#2d3436,stroke:#636e72,color:#dfe6e9
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the full, detailed roadmap.
