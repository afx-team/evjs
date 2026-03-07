# evf

Command-line interface for the **ev** framework.

## Installation

```bash
npm install -g evf
```

## Commands

| Command | Description |
|---------|-------------|
| `ev init [name]` | Scaffold a new project from a template |
| `ev dev` | Start unified dev server (client HMR + API watch) |
| `ev build` | Production build for client and server |

### `ev init [name]`

Interactive project scaffolding with template selection:

| Template | Description |
|----------|-------------|
| `basic-csr` | Client-side rendered SPA |
| `basic-server-fns` | SPA with React Server Functions |
| `trpc-server-fns` | Server Functions with tRPC integration |

Options:
- `-t, --template <template>` — Skip interactive selection.

### `ev dev`

Starts two processes concurrently:
1. **Webpack Dev Server** (port 3000) — client bundle with HMR.
2. **Node API Server** (port 3001) — auto-detected once the server bundle is emitted. Uses `node --watch` for live reload on changes.

Sets `NODE_ENV=development`, which enables the `runner` in `EvWebpackPlugin` for self-starting server bundles.

### `ev build`

Runs a single Webpack build with `NODE_ENV=production`, producing:
- `dist/client/` — optimized client assets.
- `dist/server/main.[hash].js` — server bundle (filename from `dist/server/manifest.json`).

## Configuration

The CLI detects `webpack.config.cjs` in the project root. Server function support comes from `@evjs/webpack-plugin` — no additional CLI config needed.
