# evjs

[![npm](https://img.shields.io/npm/v/@evjs/cli?style=flat-square&label=npm)](https://www.npmjs.com/package/@evjs/cli)
[![CI](https://img.shields.io/github/actions/workflow/status/evaijs/evjs/ci.yml?style=flat-square&label=CI)](https://github.com/evaijs/evjs/actions)
[![DeepWiki](https://img.shields.io/badge/DeepWiki-evaijs%2Fevjs-blue?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTQgMTkuNXYtMTVBMi41IDIuNSAwIDAgMSA2LjUgMkgxOXYyMEg2LjVhMi41IDIuNSAwIDAgMS0yLjUtMi41eiIvPjxwYXRoIGQ9Ik04IDdoOCIvPjxwYXRoIGQ9Ik04IDExaDgiLz48cGF0aCBkPSJNOCAxNWg1Ii8+PC9zdmc+)](https://deepwiki.com/evaijs/evjs)
[![Vibe Coding](https://img.shields.io/badge/vibe-coding-ff69b4?style=flat-square)](https://en.wikipedia.org/wiki/Vibe_coding)

React fullstack framework with file-based SPA/MPA pages, server file routes,
server functions, and independent client/server runtime cores.

> **ev** = **Ev**aluation · **Ev**olution — evaluate across runtimes, evolve with AI tooling.


## ⚡ Features

- **Convention over Configuration** — `ev dev` / `ev build`, no boilerplate needed.
- **Page Routes** — `src/pages` is the client route source of truth.
- **SPA and MPA Modes** — SPA is generated from `src/pages` with typed page hooks; MPA emits independent router-free pages.
- **Data Fetching** — [TanStack Query](https://tanstack.com/query) with built-in proxies.
- **Server Functions** — `"use server"` directive, auto-discovered at build time.
- **Pluggable Transport** — HTTP, WebSocket, or custom via `ServerTransport`.
- **Plugin System** — extend builds with custom loaders (Tailwind, SVG, etc.).
- **Server File Routes** — `src/apis` maps Request/Response method modules to HTTP endpoints.
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
| [`@evjs/ev`](./packages/ev) | Framework API, config, plugins, build orchestration, deployment helpers, and file-convention authoring subpaths |
| [`@evjs/cli`](./packages/cli) | Thin CLI wrapper (`ev dev`, `ev build`, `ev inspect`) with the default bundler |
| [`@evjs/create-app`](./packages/create-app) | Project scaffolding (`npx @evjs/create-app`) |
| [`@evjs/client`](./packages/client) | Standalone/manual browser runtime core |
| [`@evjs/server`](./packages/server) | Standalone/manual server runtime core for Hono/fetch apps and route primitives |
| [`examples/`](./examples) | Starter templates |

Internal modules such as manifest schemas, build tools, page runtime, and shell
live inside the public packages above instead of separate application-facing
packages. Application code imports framework composition APIs from `@evjs/ev`
and file-convention authoring APIs from `@evjs/ev/page`, `@evjs/ev/request`,
or `@evjs/ev/transport`. `@evjs/client` and `@evjs/server` remain independent
standalone/manual runtime packages for apps that intentionally own those
surfaces directly.

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
