# evjs Overview

> High-level conceptual map of evjs features.

## Full-Stack Architecture

This graph maps out the **Client Side** and **Server Side**, illustrating how Rendering (SSR/RSC) and APIs (Server Functions/Route Handlers) operate within the backend before accessing your Data Layer.

```mermaid
flowchart LR
    %% Client Nodes
    subgraph ClientSide ["💻 Client Side (evjs Frontend)"]
        UI["React Application (Client Components)"]
        RPC["RPC Client (Auto-generated)"]
        FETCH["Standard HTTP Clients (fetch, cURL)"]
    end

    %% Server Nodes
    subgraph ServerSide ["⚙️ Server Side (evjs Backend)"]
        subgraph RenderingLayer ["🖼️ Rendering Layer"]
            SSR["Server-Side Rendering (SSR HTML)"]
            RSC["React Server Components (RSC Virtual DOM)"]
        end
        
        subgraph APILayer ["🔌 APIs and Endpoints"]
            SF["⚡ Server Functions (Invisible RPC bridge)"]
            RH["🌐 Route Handlers (Public API Endpoints)"]
        end

        subgraph DataLayer ["🗄️ Data Layer"]
            DB[("Relational or Document DB")]
            KV[("Key-Value Store")]
        end
    end

    %% Internal Data Flow
    SSR -->|"Read"| DB
    SSR -->|"Read"| KV
    
    RSC -->|"Read"| DB
    RSC -->|"Read"| KV
    
    SF -->|"Read/Write"| DB
    SF -->|"Read/Write"| KV
    
    RH -->|"Read/Write"| DB
    RH -->|"Read/Write"| KV

    %% Network Flow
    UI --> RPC
    UI --> FETCH
    
    UI -.->|"Initial Request"| SSR
    UI -.->|"RSC Fetch"| RSC
    
    RPC -->|"POST /api/fn"| SF
    FETCH -->|"GET/POST /api"| RH

    %% Styling
    style UI fill:#6366f1,color:#fff
    style FETCH fill:#6366f1,color:#fff
    style RPC fill:#6366f1,color:#fff
    
    style SSR fill:#8b5cf6,color:#fff
    style RSC fill:#8b5cf6,color:#fff
    
    style SF fill:#10b981,color:#fff
    style RH fill:#10b981,color:#fff
    
    style DB fill:#ec4899,color:#fff
    style KV fill:#ec4899,color:#fff
```
