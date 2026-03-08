# @evjs/cli — Agent Guide

> AI-agent reference for developing apps with the `@evjs/cli` package.

## Overview

`@evjs/cli` is the CLI and configuration layer. Users install it as a devDependency. It provides:

- **`ev init`** — scaffold a new project from templates
- **`ev dev`** — start dev server (webpack-dev-server + API server)
- **`ev build`** — production build (client + server bundles)
- **`defineConfig`** — type-safe config export for `ev.config.ts`

## Quick Start

```bash
npx @evjs/cli@latest init my-app
cd my-app && npm install
ev dev     # http://localhost:3000
```

## Configuration (`ev.config.ts`)

Optional — everything works zero-config. Create `ev.config.ts` in project root when needed:

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  client: {
    entry: "./src/main.tsx",           // default
    html: "./index.html",              // default
    dev: {
      port: 3000,                      // webpack-dev-server port
      open: true,                      // auto-open browser
      https: false,                    // enable HTTPS
      historyApiFallback: true,        // SPA routing fallback
    },
    transport: {
      baseUrl: "",                     // API base URL (for separate API host)
      endpoint: "/api/fn",             // server function endpoint path
    },
  },
  server: {
    endpoint: "/api/fn",               // must match client transport endpoint
    runner: "@evjs/runtime/server/node",
    middleware: [
      "./src/middleware/auth.ts",      // middleware module paths
      "./src/middleware/logging.ts",
    ],
    dev: {
      port: 3001,                      // API server port in dev mode
    },
  },
});
```

### Config Defaults

| Key | Default |
|-----|---------|
| `client.entry` | `"./src/main.tsx"` |
| `client.html` | `"./index.html"` |
| `client.dev.port` | `3000` |
| `server.endpoint` | `"/api/fn"` |
| `server.dev.port` | `3001` |
| `server.runner` | `"@evjs/runtime/server/node"` |

## Project Structure

```
my-app/
├── ev.config.ts          # optional config
├── index.html            # HTML template
├── package.json
├── tsconfig.json
└── src/
    ├── main.tsx           # app bootstrap (keep minimal)
    ├── routes.tsx         # route tree + components
    ├── api/               # server functions
    │   ├── users.server.ts
    │   └── posts.server.ts
    └── middleware/         # server middleware (optional)
        └── auth.ts
```

## CLI Commands

### `ev init [project-name]`
Interactive scaffolding. Templates:
- `basic-csr` — client-side rendering only
- `basic-server-fns` — server functions example
- `configured-server-fns` — advanced config example
- `trpc-server-fns` — tRPC integration

### `ev dev`
- Starts webpack-dev-server on port 3000
- Auto-starts API server on port 3001
- Proxies `/api/fn` requests to API server
- Hot reloads client; restarts server on changes
- `NODE_ENV=development`

### `ev build`
- Outputs client bundle to `dist/client/`
- Outputs server bundle to `dist/server/`
- Emits `dist/server/manifest.json` with server function registry
- `NODE_ENV=production`

## Common Mistakes

1. **Don't create `webpack.config.cjs`** — use `ev.config.ts` instead
2. **Don't install webpack manually** — it's a dependency of `@evjs/cli`
3. **Config file must be `ev.config.ts`** — not `evjs.config.ts` or `evjs.config.ts`
4. **Import `defineConfig` from `@evjs/cli`** — not from `@evjs/runtime`

## Dependencies (bundled)

Users do NOT need to install these — they're included in `@evjs/cli`:
- `webpack`, `webpack-dev-server`, `webpack-cli`
- `html-webpack-plugin`, `swc-loader`, `@swc/core`
- `@evjs/webpack-plugin`
