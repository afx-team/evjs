# evf

Command-line interface for the ev framework.

## Commands

### `ev init [name]`
Scaffold a new project. Templates: `basic-csr`, `basic-server-fns`, `trpc-server-fns`.
Option: `-t, --template <template>` to skip interactive selection.

### `ev dev`
Starts two processes:
1. Webpack Dev Server (port 3000) — client HMR.
2. Node API Server (port 3001) — auto-starts via `node --watch` when server bundle is emitted.
Sets `NODE_ENV=development`.

### `ev build`
Production build with `NODE_ENV=production`.
Output: `dist/client/` (assets) + `dist/server/main.[hash].js` (server bundle, discovered via `dist/server/manifest.json`).

## Configuration
Detects `webpack.config.cjs` in project root. Uses `@evjs/webpack-plugin` for server function support.
