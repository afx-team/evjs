# ev

[![npm](https://img.shields.io/npm/v/@evjs/cli?style=flat-square&label=npm)](https://www.npmjs.com/package/@evjs/cli)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-evaijs%2Fevjs-blue?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTQgMTkuNXYtMTVBMi41IDIuNSAwIDAgMSA2LjUgMkgxOXYyMEg2LjVhMi41IDIuNSAwIDAgMS0yLjUtMi41eiIvPjxwYXRoIGQ9Ik04IDdoOCIvPjxwYXRoIGQ9Ik04IDExaDgiLz48cGF0aCBkPSJNOCAxNWg1Ii8+PC9zdmc+)](https://deepwiki.com/evaijs/evjs)
[![Vibe Coding](https://img.shields.io/badge/vibe-coding-ff69b4?style=flat-square)](https://en.wikipedia.org/wiki/Vibe_coding)

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
