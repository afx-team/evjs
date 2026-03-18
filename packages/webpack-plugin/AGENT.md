# @evjs/webpack-plugin — Agent Guide

> AI-agent reference for the `@evjs/webpack-plugin` package. This is an internal package used by `@evjs/cli` — application developers don't configure it directly.

## Overview

Webpack adapter wrapping `@evjs/build-tools`. Provides:
1. **`EvWebpackPlugin`** — webpack plugin for server function discovery + child compilation
2. **`server-fn-loader`** — webpack loader for `"use server"` file transforms

## EvWebpackPlugin

Auto-discovers `"use server"` files, generates server entry, spawns a server-targeted child compiler, and emits `dist/manifest.json`.

```js
const { EvWebpackPlugin } = require("@evjs/webpack-plugin");

new EvWebpackPlugin({
  server: {
    appFactory: "@evjs/runtime/server#createApp",       // default
    runner: "@evjs/runtime/server#serve",                // for self-starting servers
    middleware: ["./src/middleware/auth#default"],        // middleware imports
  },
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `server.appFactory` | `string` | `"@evjs/runtime/server#createApp"` | Hono app factory module ref |
| `server.runner` | `string?` | `undefined` | Runner module ref (e.g., `"@evjs/runtime/server#serve"`) |
| `server.middleware` | `string[]` | `[]` | Middleware module refs prepended to server entry |

### What It Does (Build Pipeline)

1. **Discovery** — globs for `*.server.{ts,js,tsx,jsx}` in source tree
2. **Client transform** — `server-fn-loader` replaces function bodies with `__fn_call` stubs
3. **Server entry generation** — calls `generateServerEntry()` from `@evjs/build-tools`
4. **Child compiler** — spawns a webpack child compilation targeting `node` with the server entry
   - **Externals**: all third-party `node_modules` are externalized (essential for native addons like `better-sqlite3`); `@evjs/*` packages are bundled into the CJS output
5. **Manifest emission** — writes `dist/manifest.json` via `processAssets` hook

### Output

```
dist/
├── client/              # client webpack output
│   ├── main.[hash].js
│   └── index.html
├── manifest.json        # unified manifest (server + client)
└── server/
    └── main.[hash].js   # server bundle (Node.js)
```

### Manifest Format

```json
{
  "version": 1,
  "server": {
    "entry": "main.a1b2c3d4.js",
    "fns": {
      "abc123:getUsers": {
        "moduleId": "./api/users.server",
        "export": "getUsers"
      }
    }
  }
}
```

## server-fn-loader

Webpack loader for `"use server"` files. Automatically detects whether it's running in the client or server compiler and applies the appropriate transform.

```js
{
  test: /\.server\.(ts|tsx|js|jsx)$/,
  use: [
    { loader: "swc-loader" },
    { loader: "@evjs/webpack-plugin/server-fn-loader" },
  ],
}
```

**Client compiler** → replaces function bodies with `__fn_call` RPC stubs
**Server compiler** → preserves function bodies, appends `registerServerFn()` calls

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | `EvWebpackPlugin` — main plugin |
| `src/server-fn-loader.ts` | Webpack loader for `"use server"` transforms |

## Integration with @evjs/cli

`@evjs/cli` creates the webpack config in `create-webpack-config.ts`:

1. Adds `EvWebpackPlugin` to plugins
2. Adds `server-fn-loader` to module rules (before `swc-loader`)
3. Configures dev server proxy for `/api/fn` → API server
4. In dev mode, sets `runner` to `"@evjs/runtime/server#serve"` for auto-start
