# evjs

[![npm](https://img.shields.io/npm/v/@evjs/cli?style=flat-square&label=npm)](https://www.npmjs.com/package/@evjs/cli)
[![CI](https://img.shields.io/github/actions/workflow/status/evaijs/evjs/ci.yml?style=flat-square&label=CI)](https://github.com/evaijs/evjs/actions)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-evaijs%2Fevjs-blue?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTQgMTkuNXYtMTVBMi41IDIuNSAwIDAgMSA2LjUgMkgxOXYyMEg2LjVhMi41IDIuNSAwIDAgMS0yLjUtMi41eiIvPjxwYXRoIGQ9Ik04IDdoOCIvPjxwYXRoIGQ9Ik04IDExaDgiLz48cGF0aCBkPSJNOCAxNWg1Ii8+PC9zdmc+)](https://deepwiki.com/evaijs/evjs)
[![Vibe Coding](https://img.shields.io/badge/vibe-coding-ff69b4?style=flat-square)](https://en.wikipedia.org/wiki/Vibe_coding)

React fullstack framework with file-based SPA routes, router-free MPA pages, server functions, and a Hono server runtime.

> **ev** = **Ev**aluation · **Ev**olution — evaluate across runtimes, evolve with AI tooling.


## ⚡ Features

- **Convention over Configuration** — `ev dev` / `ev build`, no boilerplate needed.
- **Page Routes** — `src/pages` is the client route source of truth.
- **SPA and MPA Modes** — SPA is generated from `src/pages` with typed page hooks; MPA emits independent router-free pages.
- **Data Fetching** — [TanStack Query](https://tanstack.com/query) with built-in proxies.
- **Server Functions** — `"use server"` directive, auto-discovered at build time.
- **Pluggable Transport** — HTTP, WebSocket, or custom via `ServerTransport`.
- **Plugin System** — extend builds with custom loaders (Tailwind, SVG, etc.).
- **Programmatic Route Handlers** — Standard Request/Response REST API endpoints via `createRoute()`.
- **Typed Errors** — `ServerError` flows structured data server → client.
- **Multi-Runtime** — [Hono](https://hono.dev/)-based server with Node, Deno, Bun, Edge adapters.
- **CLI** — `ev dev` · `ev build` · `ev inspect`

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

### Public entry points

| Package | Purpose |
|---------|---------|
| [`@evjs/ev`](./packages/ev) | Framework API, config, plugins, and build orchestration (`defineConfig`, `dev`, `build`) |
| [`@evjs/cli`](./packages/cli) | Thin CLI wrapper (`ev dev`, `ev build`, `ev inspect`) with the default bundler |
| [`@evjs/create-app`](./packages/create-app) | Project scaffolding (`npx @evjs/create-app`) |
| [`@evjs/client`](./packages/client) | Browser runtime core for standalone CSR, page hooks, navigation, transport, and RSC |
| [`@evjs/server`](./packages/server) | Server runtime core for Hono/fetch apps, server functions, routes, rendering, and deployment |
| [`examples/`](./examples) | Starter templates |

Internal modules such as manifest schemas, build tools, page runtime, and shell
live inside the public packages above instead of separate application-facing
packages. Application code imports framework composition APIs from `@evjs/ev`
and runtime APIs from `@evjs/client` or `@evjs/server`. Browser-only apps can
use `@evjs/client` without depending on `@evjs/ev`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) · [AGENTS.md](./AGENTS.md) · [AGENT.md](./AGENT.md)

## 🛠️ Development

```bash
npm install          # deps
npm run build        # all packages + examples
npm run test         # vitest
npm run test:e2e     # playwright
```

## 📄 License

MIT © [Ant UED](https://xtech.antfin.com/)
