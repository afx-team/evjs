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
  ┌─────────────────────────────────────────────────────────────┐
  │                                                             │
  │  "use server"       ──▶  Build  ──▶   Client Bundle        │
  │   Your Functions              │       (Transparent stubs)   │
  │                               │                             │
  │                               └──▶   Server Bundle          │
  │                                      (Original functions)   │
  │                                                             │
  │  CLI: ev init · ev dev · ev build                           │
  │  Builder: Webpack  ·  🔮 Future: Utoo(Turbopack)           │
  └─────────────────────────────────────────────────────────────┘

  ┌───────────────────────────┐     ┌───────────────────────────┐
  │ Client (Browser)          │     │ Server (Node.js)          │
  │                           │     │                           │
  │ React Components          │     │ Hono HTTP Server          │
  │         │                 │     │         │                 │
  │         ▼                 │     │         ▼                 │
  │ Query & Mutation Proxies  │     │ Function Dispatcher       │
  │ (TanStack Query)          │ ──▶ │ (Auto-registered fns)     │
  │                           │ ◀── │                           │
  │ Call server functions     │     │ Execute & respond         │
  │ as if they were local     │     │ transparently             │
  │                           │     │                           │
  └───────────────────────────┘     └───────────────────────────┘

  🔮 Future: Server-Side Rendering · React Server Components
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
