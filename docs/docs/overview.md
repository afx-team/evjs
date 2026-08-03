# What is evjs?

> **ev** = **Ev**aluation · **Ev**olution — evaluate across runtimes, evolve with AI tooling.

evjs is a React fullstack framework with one Page-and-Route application model,
server functions, route handlers, rendering customization, and
deployment-oriented output.

The framework keeps a clear split between:

- **application code**: React pages, server functions, and server routes;
- **application model**: positive `src/pages/**/page.*` anchors whose
  directories determine Page scope and URL, plus optional build-time
  `page.config.ts`;
- **server file conventions**: positive `src/apis/**/api.*` anchors,
  middleware, and server-only modules;
- **framework IR**: generated `.ev` entries, plugin artifacts, slots, and manifest data;
- **bundlers**: Utoopack by default, with webpack available as a validation adapter;
- **deployment output**: browser assets, optional server bundles, and deployment metadata.

SPA page routes keep navigation, loader, search, and params semantics inside
the framework. MPA page routes use the page runtime without adding a router.

## Features

- **One Page-and-Route model** — `src/pages/**/page.*` anchors Pages and Routes; each containing directory owns private code and determines its URL.
- **One Page config model** — optional `page.config.ts` supplies static titles, named metadata, core rendering settings, and Page plugin settings keyed by canonical plugin ids in both SPA and MPA.
- **SPA and MPA materialization** — `routing.mode` keeps the same semantic Page/Route tree while selecting a browser route tree or independent Page-owned Documents.
- **Page rendering settings** — `page.config.ts` normalizes SSR, SSG, PPR, and RSC settings without changing canonical Page identity; Page components do not export rendering configuration.
- **Server functions** — `"use server"` modules become browser-callable functions.
- **Server routes** — positive `src/apis/**/api.*` anchors expose standard Web `Request`/`Response` handlers; their directories determine URLs and private scope.
- **Unified server runtime** — server functions, server routes, SSR, PPR, and RSC share the same server boundary.
- **Agent-readable framework IR** — `.ev` records generated entries, plugin modules, slot attachments, import edges, and manifest data before bundling.
- **Plugin system** — generated contributions for framework IR plus config, bundler, HTML, build output, and build lifecycle hooks.
- **Deployment output** — static assets plus optional Node, static-host, or edge deployment artifacts.

## Full-Stack Architecture

```mermaid
flowchart TB
  subgraph Source["Application source"]
    Pages["Page directories\npage.tsx + page.config.ts"]
    APIs["src/apis/**/api.ts\nserver routes"]
    Functions["use server directive\nserver functions"]
    Config["ev.config.ts\nrouting.mode + plugins"]
  end

  subgraph Framework["Framework planning"]
    Discovery["Resolve + normalize\nCoreGraph"]
    IR[".ev framework IR\nentries + plugin modules + slots"]
    Manifest["Manifest data\nruntime + deployment metadata"]
  end

  subgraph Output["Build output"]
    Assets["Browser assets"]
    HTML["HTML documents"]
    ServerBundle["Server bundle"]
  end

  subgraph Runtime["Runtime targets"]
    Browser["Browser app\nSPA / MPA / hydration"]
    Server["Framework server\nfunctions + routes + SSR/PPR/RSC"]
    Deploy["Deployment adapters\nNode / static / edge"]
  end

  Pages --> Discovery
  APIs --> Discovery
  Functions --> Discovery
  Config --> Discovery
  Discovery --> IR
  IR --> Manifest
  Manifest --> Assets
  Manifest --> HTML
  Manifest --> ServerBundle
  Assets --> Browser
  HTML --> Browser
  ServerBundle --> Server
  Browser <-->|"framework requests"| Server
  Assets --> Deploy
  HTML --> Deploy
  ServerBundle --> Deploy

  classDef source fill:#eef6ff,stroke:#8fb5e8,color:#102a43;
  classDef ir fill:#f3f0ff,stroke:#a78bfa,color:#2e1065;
  classDef output fill:#ecfdf5,stroke:#34d399,color:#064e3b;
  classDef runtime fill:#fff7ed,stroke:#fb923c,color:#7c2d12;
  class Pages,APIs,Functions,Config source;
  class Discovery,IR,Manifest ir;
  class Assets,HTML,ServerBundle output;
  class Browser,Server,Deploy runtime;
```

## How It Fits Together

evjs discovers positively anchored `page.*` routes and optional build-time
`page.config.ts` from `src/pages`, positively anchored `api.*` server request
Routes from `src/apis`, and server functions from reachable `"use server"`
modules. It then materializes
`.ev` as the framework IR: generated entry facades, plugin generated modules,
structured slot attachments, and a manifest that agents and tools can inspect
before any bundler-specific work.

`ev build` consumes that IR to emit browser files and, when the app uses server
capabilities, a server bundle that deployment adapters can run on Node, static
hosts, edge workers, or a split CDN/origin setup.
