# @evjs/bundler-webpack

Webpack adapter for the **evjs** fullstack framework. Thin wrapper over [`@evjs/build-tools`](../build-tools) that connects bundler-agnostic build logic to Webpack's plugin and loader APIs.

## Installation

```bash
npm install @evjs/bundler-webpack
```

## Exports

| Export | Description |
|--------|-------------|
| `EvWebpackPlugin` | Plugin that auto-discovers `"use server"` files and manages server builds |
| `server-fn-loader` | Loader that transforms `"use server"` files for client/server |

## How It Works

### EvWebpackPlugin

1. **Scans client modules** for `"use server"` files via `detectUseServer()` from build-tools.
2. **Generates a server entry** via `generateServerEntry()` — produces a virtual data-URI module.
3. **Spawns a child compiler** targeting Node.js — builds the server bundle alongside the client.
4. **Emits `dist/server/manifest.json`** and **`dist/client/manifest.json`** with function registry and client assets respectively.

### server-fn-loader

Auto-detects whether it's running in the client or server compiler and delegates to `transformServerFile()`:
- **Client compiler** → replaces function bodies with RPC stubs.
- **Server compiler** → keeps original source, appends registrations, and reports to the manifest.

## Usage

```js
const { EvWebpackPlugin } = require("@evjs/bundler-webpack");

module.exports = {
  plugins: [
    new EvWebpackPlugin({
      server: {
        // App factory (default: "@evjs/server#createApp")
        appFactory: "@evjs/server#createApp",
        // Runtime — bake into bundle for self-starting dev server
        runtime: process.env.NODE_ENV === "development"
          ? "@evjs/server/node#serve"
          : undefined,
        // Extra imports (config, etc.)
        setup: [],
      },
    }),
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [
          { loader: "swc-loader" },
          { loader: "@evjs/bundler-webpack/server-fn-loader" },
        ],
      },
    ],
  },
};
```

### Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `server.appFactory` | `string` | `"@evjs/server#createApp"` | Module ref for app factory |
| `server.runtime` | `string?` | `undefined` | Module ref for auto-starting the server |
| `server.setup` | `string[]` | `[]` | Extra imports to prepend to server entry |
