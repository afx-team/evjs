# evjs

[![npm](https://img.shields.io/npm/v/@evjs/cli?style=flat-square&label=npm)](https://www.npmjs.com/package/@evjs/cli)
[![CI](https://img.shields.io/github/actions/workflow/status/evaijs/evjs/ci.yml?style=flat-square&label=CI)](https://github.com/evaijs/evjs/actions)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-evaijs%2Fevjs-blue?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTQgMTkuNXYtMTVBMi41IDIuNSAwIDAgMSA2LjUgMkgxOXYyMEg2LjVhMi41IDIuNSAwIDAgMS0yLjUtMi41eiIvPjxwYXRoIGQ9Ik04IDdoOCIvPjxwYXRoIGQ9Ik04IDExaDgiLz48cGF0aCBkPSJNOCAxNWg1Ii8+PC9zdmc+)](https://deepwiki.com/evaijs/evjs)
[![Vibe Coding](https://img.shields.io/badge/vibe-coding-ff69b4?style=flat-square)](https://en.wikipedia.org/wiki/Vibe_coding)

React fullstack framework, built on TanStack + Hono.

> **ev** = **Ev**aluation · **Ev**olution — evaluate across runtimes, evolve with AI tooling.


## ⚡ Features

- **Convention over Configuration** — `ev dev` / `ev build`, no boilerplate needed.
- **Type-Safe Routing** — [TanStack Router](https://tanstack.com/router).
- **Data Fetching** — [TanStack Query](https://tanstack.com/query) with built-in proxies.
- **Server Functions** — `"use server"` directive, auto-discovered at build time.
- **Pluggable Transport** — HTTP, WebSocket, or custom via `ServerTransport`.
- **Plugin System** — extend builds with custom loaders (Tailwind, SVG, etc.).
- **Programmatic Route Handlers** — Standard Request/Response REST API endpoints via `createRoute()`.
- **Typed Errors** — `ServerError` flows structured data server → client.
- **Multi-Runtime** — Hono-based server with Node, Deno, Bun, Edge adapters.
- **CLI** — `ev dev` · `ev build`

## 🚀 Quick Start

```bash
npx @evjs/create-app my-app
cd my-app && npm install
ev dev
```

After `ev dev`, your browser opens to `http://localhost:3000` with hot module
replacement. Server functions in `*.server.ts` files are auto-discovered — no
config needed.

## 🏗️ Packages

| Package | Purpose |
|---------|---------|
| [`@evjs/cli`](./packages/cli) | CLI binary (`ev dev`, `ev build`) |
| [`@evjs/ev`](./packages/ev) | Config, plugin, and bundler types (`defineConfig`) |
| [`@evjs/create-app`](./packages/create-app) | Project scaffolding (`npx @evjs/create-app`) |
| [`@evjs/shared`](./packages/shared) | Runtime shared: errors, HTTP utils, constants |
| [`@evjs/client`](./packages/client) | Client runtime (React + TanStack) |
| [`@evjs/server`](./packages/server) | Server runtime (Hono) |
| [`@evjs/build-tools`](./packages/build-tools) | Server function transforms |
| [`@evjs/bundler-webpack`](./packages/bundler-webpack) | Webpack adapter |
| [`@evjs/manifest`](./packages/manifest) | Shared manifest schema types |
| [`examples/`](./examples) | Starter templates |

See [ARCHITECTURE.md](./ARCHITECTURE.md) · [AGENT.md](./AGENT.md)

## 🛠️ Development

```bash
npm install          # deps
npm run build        # all packages + examples
npm run test         # vitest
npm run test:e2e     # playwright
```

## 📄 License

MIT © [Ant UED](https://xtech.antfin.com/)

