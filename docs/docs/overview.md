# What is evjs?

> **ev** = **Ev**aluation · **Ev**olution — evaluate across runtimes, evolve with AI tooling.

evjs is a zero-config React fullstack framework built on [TanStack Router](https://tanstack.com/router), [TanStack Query](https://tanstack.com/query), and [Hono](https://hono.dev). It provides a seamless development experience for building type-safe, full-stack web applications.

## Features

- **Convention over Configuration** — `ev dev` / `ev build`, no boilerplate needed
- **Type-Safe Routing** — TanStack Router with full inference
- **Data Fetching** — TanStack Query with built-in proxies
- **Server Functions** — `"use server"` directive, auto-discovered at build time
- **Pluggable Transport** — HTTP, WebSocket, or custom via `ServerTransport`
- **Plugin System** — extend builds with custom module rules (Tailwind, SVG, etc.)
- **Route Handlers** — Standard Request/Response REST endpoints via `createRoute()`
- **Typed Errors** — `ServerError` flows structured data from server → client
- **Multi-Runtime** — Hono-based server with Node, Deno, Bun, Edge adapters

## Full-Stack Architecture

```mermaid
flowchart LR
    subgraph ClientSide ["💻 Client Side"]
        UI["React App"]
        RPC["RPC Client"]
        FETCH["HTTP Client"]
    end

    subgraph ServerSide ["⚙️ Server Side"]
        subgraph RenderingLayer ["🖼️ Rendering"]
            SSR["SSR"]
            RSC["RSC"]
        end

        subgraph APILayer ["🔌 APIs"]
            SF["⚡ Server Functions"]
            RH["🌐 Route Handlers"]
        end

        subgraph DataLayer ["🗄️ Data"]
            DB[("Database")]
            KV[("KV Store")]
        end
    end

    SSR -->|Read| DB
    SSR -->|Read| KV
    RSC -->|Read| DB
    RSC -->|Read| KV
    SF -->|Read/Write| DB
    SF -->|Read/Write| KV
    RH -->|Read/Write| DB
    RH -->|Read/Write| KV

    UI --> RPC
    UI --> FETCH
    UI -.->|Initial Request| SSR
    UI -.->|RSC Fetch| RSC
    RPC -->|POST /api/fn| SF
    FETCH -->|GET/POST /api| RH
```
