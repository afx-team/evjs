# ev

[![Vibe Coded](https://img.shields.io/badge/vibe-coded-ff69b4?style=flat-square)](https://en.wikipedia.org/wiki/Vibe_coding)

> **React Framework with Type-Safe Routing & Server Functions.**

`ev` is a modern React framework built for speed, type-safety, and simplicity. It leverages the best-of-breed primitives from the TanStack ecosystem and adds seamless React Server Functions (RSF) with a Hono-based API server.

## ⚡ Features

- **Type-Safe Routing**: Built on [TanStack Router](https://tanstack.com/router).
- **Isomorphic Data Fetching**: Powered by [TanStack Query](https://tanstack.com/query).
- **Server Functions**: Use `"use server"` to define server-side logic callable as standard async functions.
- **Dynamic Server Discovery**: Auto-detects server functions in real-time — no manual configuration or imports.
- **Pluggable Transport**: Configurable `ServerTransport` interface for custom protocols and libraries.
- **Runtime-Agnostic Server**: Hono-based server with Runner API for Node, Edge, or Bun.
- **Configurable Builds**: Plugin options for `appFactory`, `runner`, and `setup` imports.
- **Single-Config Build**: Harmonized client/server builds via Webpack Child Compilers.
- **Unified CLI**: Scaffold and manage projects with the `ev` command.

## 🏗️ Monorepo Structure

- [`packages/cli`](./packages/cli): The command-line interface.
- [`packages/runtime`](./packages/runtime): Core framework runtime (Client & Server).
- [`packages/build-tools`](./packages/build-tools): Bundler-agnostic build utilities.
- [`packages/manifest`](./packages/manifest): Shared manifest schema types.
- [`packages/webpack-plugin`](./packages/webpack-plugin): Webpack adapter for build-tools.
- [`examples/`](./examples): Starter templates and reference implementations.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed diagrams covering the build pipeline, server function transforms, and dev server setup.

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
