# evjs

[![npm](https://img.shields.io/npm/v/@evjs/cli?style=flat-square&label=npm)](https://www.npmjs.com/package/@evjs/cli)
[![CI](https://img.shields.io/github/actions/workflow/status/afx-team/evjs/ci.yml?style=flat-square&label=CI)](https://github.com/afx-team/evjs/actions)

React fullstack framework with one Page-and-Route model for SPA and MPA
applications, server file routes, server functions, rendering, and deployment.

## ⚡ Features

- **One Page-and-Route Model** — each `src/pages/**/page.*` anchor owns its directory scope and derives its URL from that directory.
- **One Page Config Contract** — optional `page.config.ts` supplies static titles, named metadata, build-time rendering settings, and plugin-owned settings keyed by canonical plugin ids in SPA and MPA.
- **No Accidental Pages** — colocated files such as `components/index.tsx` stay private because only `page.*` creates a Page.
- **SPA and MPA Modes** — the same semantic Page/Route tree materializes as SPA Client Routes or MPA Documents through `routing.mode`.
- **Data Fetching** — [TanStack Query](https://tanstack.com/query) integration for server functions.
- **Server Functions** — reachable `"use server"` modules are transformed into typed client references.
- **Pluggable Transport** — HTTP, WebSocket, or custom protocols via a `TransportAdapter`.
- **Plugin System** — identify each plugin with one short canonical `id`, then extend the generated `.ev` framework IR through contributions and lifecycle hooks for config, bundler, HTML, and build output.
- **Server File Routes** — positive `src/apis/**/api.*` anchors map directory-owned Request/Response handlers to HTTP endpoints.
- **Typed Errors** — `ServerError` flows structured data server → client.
- **Runtime Targets** — [Hono](https://hono.dev/)-based server APIs for Node and standard Fetch runtimes.
- **CLI** — `ev dev` · `ev build` · `ev prepare` · `ev inspect`

## 🚀 Quick Start

```bash
npx @evjs/create-app my-app
cd my-app && npm install
npm run dev
```

The development command prints the selected browser and framework-server URLs.
Server-function modules are discovered through the `"use server"` directive
when they are reachable from the application graph; `.server.ts` is a naming
recommendation, not a discovery rule.

## 🧭 Framework IR

evjs materializes framework-owned code under `.ev/` before bundling. This
agent-readable IR records normalized Applications, Pages, Routes, Documents,
generated entry facades, plugin modules, slot attachments, import edges, and
the final manifest.

Use `ev prepare` to generate `.ev/` without writing `dist`, and use
`ev inspect --json` when you want a preflight report without writing generated
files. Plugin authors should use `emitIR()` for generated modules and
entry/runtime/HTML/resolution slots; keep loaders for real bundler transforms.

## 🏗️ Packages

### Public entry points

| Package | Purpose |
|---------|---------|
| [`@evjs/ev`](./packages/ev) | Framework API, Page-and-Route config, plugins, build orchestration, deployment helpers, and authoring subpaths |
| [`@evjs/cli`](./packages/cli) | Thin CLI wrapper (`ev dev`, `ev build`, `ev prepare`, `ev inspect`) with the default bundler |
| [`@evjs/create-app`](./packages/create-app) | Project scaffolding (`npx @evjs/create-app`) |
| [`@evjs/client`](./packages/client) | Standalone/manual browser runtime core |
| [`@evjs/server`](./packages/server) | Standalone/manual server runtime core for Hono and Fetch apps |
| [`@evjs/plugin-qiankun`](./packages/plugin-qiankun) | Optional qiankun integration |
| [`examples/`](./examples) | Starter templates |

Application code imports framework composition APIs from `@evjs/ev`
and file-convention authoring APIs from `@evjs/ev/route`, `@evjs/ev/navigation`,
`@evjs/ev/query`, `@evjs/ev/server-context`, or `@evjs/ev/transport`. `@evjs/client` and `@evjs/server` remain independent
standalone/manual runtime packages for apps that intentionally own those
surfaces directly.

See [ARCHITECTURE.md](./ARCHITECTURE.md) · [AGENTS.md](./AGENTS.md) · [AGENT.md](./AGENT.md)

## 🛠️ Development

```bash
npm install          # deps
npm run build        # all packages + examples
npm run test         # vitest
npm run test:e2e     # playwright
npm run check-types  # TypeScript
npm run lint         # Biome
```

## 📄 License

MIT © [Ant UED](https://xtech.antfin.com/)
