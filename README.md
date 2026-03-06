# ev

> **React Framework with Type-Safe Routing & Server Functions.**

`ev` is a modern React framework built for speed, type-safety, and simplicity. It leverages the best-of-breed primitives from the TanStack ecosystem and adds seamless React Server Functions (RSF) with a Hono-based API server.

## ⚡ Features

- **Type-Safe Routing**: Built on [TanStack Router](https://tanstack.com/router).
- **Isomorphic Data Fetching**: Powered by [TanStack Query](https://tanstack.com/query).
- **Server Functions**: Use `"use server"` to define server-side logic callable as standard async functions.
- **Dynamic Server Discovery**: Auto-detects server functions in real-time — no manual configuration or imports.
- **Single-Config Build**: Harmonized client/server builds via Webpack Child Compilers.
- **Unified CLI**: Scaffold and manage projects with the `ev` command.
- **Modern Build**: Optimized with SWC and HMR for both client and API.

## 🏗️ Monorepo Structure

- [`packages/cli`](./packages/cli): The command-line interface.
- [`packages/runtime`](./packages/runtime): Core framework runtime (Client & Server).
- [`packages/manifest`](./packages/manifest): Shared manifest schema types.
- [`packages/webpack-plugin`](./packages/webpack-plugin): Build-time integration for RSF.
- [`examples/`](./examples): Starter templates and reference implementations.

### Architecture Overview

```text
  ┌────────────────────────────────────────────────────────┐
  │ Development & Build Time                               │
  │                                                        │
  │     [ CLI Tool ]  ────────▶  [ Build Integration ]     │
  │    (Scaffolding &             (Split 'use server' &      │
  │      Dev Server)               'use client' files,       │
  │                               build client & server      │
  │                                   simultaneously)        │
  │                                       │                  │
  │                                       ▼                  │
  │                              [ Shared Manifest ]         │
  │                                 (RPC Schemas)          │
  │                                                        │
  │  Current Builder: Webpack                              │
  │  🔮 Future: Utoo(Turbopack)                            │
  └───────────────────────────────────────┬────────────────┘
                                          │
                                          ▼
  ┌────────────────────────────────────────────────────────┐
  │ Application Runtime                                    │
  │                                                        │
  │   Client (Browser)                 Server (Node)       │
  │  ──────────────────               ───────────────      │
  │                                                        │
  │  [ React App ]                        [ Hono ]         │
  │        │                              (Server)         │
  │        ▼                                  │            │
  │  [ TanStack Query ]                       ▼            │
  │  (Data Fetching)                   [ Server Fns ]      │
  │        │                            (use server)       │
  │        ▼                                  ▲            │
  │  [ Client Runtime ]                       │            │
  │  (RPC Stubs)  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛            │
  │                      RPC over HTTP                     │
  │                                                        │
  │  🔮 Future Capabilities:                               │
  │     - React Server Components (RSC)                    │
  │     - Server-Side Rendering (SSR)                      │
  └────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

1. **Install the CLI**:
   ```bash
   npm install -g @evjs/cli@alpha
   ```

2. **Initialize a Project**:
   ```bash
   mkdir my-app && cd my-app
   ev init
   ```

3. **Start Development**:
   ```bash
   ev dev
   ```

## 🛠️ Development

This monorepo uses [Turborepo](https://turbo.build/repo) and npm workspaces.

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Start dev mode
npm run dev
```

## 📄 License

MIT © [xusd320](https://github.com/xusd320)
