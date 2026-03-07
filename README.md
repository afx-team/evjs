# evf

[![npm](https://img.shields.io/npm/v/evf?style=flat-square&label=npm)](https://www.npmjs.com/package/evf)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-evaijs%2Fevjs-blue?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTQgMTkuNXYtMTVBMi41IDIuNSAwIDAgMSA2LjUgMkgxOXYyMEg2LjVhMi41IDIuNSAwIDAgMS0yLjUtMi41eiIvPjxwYXRoIGQ9Ik04IDdoOCIvPjxwYXRoIGQ9Ik04IDExaDgiLz48cGF0aCBkPSJNOCAxNWg1Ii8+PC9zdmc+)](https://deepwiki.com/evaijs/evf)
[![Vibe Coding](https://img.shields.io/badge/vibe-coding-ff69b4?style=flat-square)](https://en.wikipedia.org/wiki/Vibe_coding)

> **A React meta-framework with server functions and multi-runtime support.**

**evf** is a React meta-framework that brings type-safe routing, server functions, and pluggable transports together. It runs on Node.js, Deno, Bun, and Edge runtimes.

## 🎯 Our Goal

**Ev**aluation + **Ev**olution + **F**ramework

- **Evaluation** — Run on Node.js, Deno, Bun, and Edge runtimes with the same codebase.
- **Evolution** — Evolving alongside AI tooling to improve the developer experience.
- **Framework** — Type-safe routing, server functions, and pluggable transports built on TanStack and Hono.

## ⚡ Features

- **Type-Safe Routing** — Built on [TanStack Router](https://tanstack.com/router).
- **Isomorphic Data Fetching** — Powered by [TanStack Query](https://tanstack.com/query).
- **Server Functions** — Use `"use server"` to define server-side logic callable as standard async functions.
- **Dynamic Server Discovery** — Auto-detects server functions in real-time, no manual configuration.
- **Pluggable Transport** — HTTP, WebSocket, or any custom protocol via the `ServerTransport` interface.
- **Pluggable Codec** — JSON by default, swap in MessagePack, Protobuf, or any serialization format.
- **Server Middleware** — Cross-cutting concerns (auth, logging, rate limiting) via `registerMiddleware()`.
- **Typed Errors** — Structured error data flows from server to client via `ServerError`.
- **Runtime-Agnostic Server** — Hono-based server with adapters for Node, Deno, Bun, and Edge.
- **Single-Config Build** — Harmonized client/server builds via Webpack Child Compilers.
- **Unified CLI** — Scaffold and manage projects with the `ev` command.

## 🏗️ Monorepo Structure

- [`packages/evf`](./packages/evf) — Meta-framework CLI and config.
- [`packages/runtime`](./packages/runtime) — Core framework runtime (Client & Server).
- [`packages/build-tools`](./packages/build-tools) — Bundler-agnostic build utilities.
- [`packages/manifest`](./packages/manifest) — Shared manifest schema types.
- [`packages/webpack-plugin`](./packages/webpack-plugin) — Webpack adapter for build-tools.
- [`examples/`](./examples) — Starter templates and reference implementations.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed diagrams.

## 🚀 Quick Start

```bash
# Install
npm install -g evf@alpha

# Scaffold
mkdir my-app && cd my-app
ev init

# Develop
ev dev
```

## 🛠️ Development

This monorepo uses [Turborepo](https://turbo.build/repo) and npm workspaces.

```bash
npm install     # Install dependencies
npm run build   # Build all packages
npm run dev     # Start dev mode
```

## 📄 License

MIT © [xusd320](https://github.com/xusd320)
