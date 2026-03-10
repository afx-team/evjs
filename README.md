# evjs

[![npm](https://img.shields.io/npm/v/@evjs/cli?style=flat-square&label=npm)](https://www.npmjs.com/package/@evjs/cli)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-evaijs%2Fevjs-blue?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTQgMTkuNXYtMTVBMi41IDIuNSAwIDAgMSA2LjUgMkgxOXYyMEg2LjVhMi41IDIuNSAwIDAgMS0yLjUtMi41eiIvPjxwYXRoIGQ9Ik04IDdoOCIvPjxwYXRoIGQ9Ik04IDExaDgiLz48cGF0aCBkPSJNOCAxNWg1Ii8+PC9zdmc+)](https://deepwiki.com/evaijs/evjs)
[![Vibe Coding](https://img.shields.io/badge/vibe-coding-ff69b4?style=flat-square)](https://en.wikipedia.org/wiki/Vibe_coding)

React meta-framework, built on TanStack + Hono.

> **ev** = **Ev**aluation · **Ev**olution — evaluate across runtimes, evolve with AI tooling.


## ⚡ Features

- **Zero Config** — `ev dev` / `ev build`, no boilerplate needed.
- **Type-Safe Routing** — [TanStack Router](https://tanstack.com/router).
- **Data Fetching** — [TanStack Query](https://tanstack.com/query) with built-in proxies.
- **Server Functions** — `"use server"` directive, auto-discovered at build time.
- **Pluggable Transport** — HTTP, WebSocket, or custom via `ServerTransport`.
- **Pluggable Codec** — JSON / MessagePack / Protobuf / custom.
- **Middleware** — `registerMiddleware()` for cross-cutting concerns.
- **Typed Errors** — `ServerError` flows structured data server → client.
- **Multi-Runtime** — Hono-based server with Node, Deno, Bun, Edge adapters.
- **CLI** — `ev init` · `ev dev` · `ev build`

## 🚀 Quick Start

```bash
npx @evjs/cli@latest init my-app
cd my-app && npm install
ev dev
```

After `ev dev`, your browser opens to `http://localhost:3000` with hot module
replacement. Server functions in `*.server.ts` files are auto-discovered — no
config needed.

## 🏗️ Packages

| Package | Purpose |
|---------|---------|
| [`@evjs/cli`](./packages/cli) | CLI + `defineConfig` |
| [`@evjs/runtime`](./packages/runtime) | Client (React) + Server (Hono) |
| [`@evjs/build-tools`](./packages/build-tools) | Server function transforms |
| [`@evjs/webpack-plugin`](./packages/webpack-plugin) | Webpack adapter |
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

MIT © [xusd320](https://github.com/xusd320)

