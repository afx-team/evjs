# Configuration (`ev.config.ts`)

## Overview

evjs is **zero-config by default**. Optionally create `ev.config.ts` in the project root to override defaults. The `defineConfig` helper provides full type-safety.

```ts
import { defineConfig } from "@evjs/cli";
export default defineConfig({ /* ... */ });
```

## Defaults

All fields are optional. These are the built-in defaults:

| Setting | Default |
|---------|---------|
| `client.entry` | `./src/main.tsx` |
| `client.html` | `./index.html` |
| `client.dev.port` | `3000` |
| `server.dev.port` | `3001` |
| `server.endpoint` | `/api/fn` |

## Full Reference

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  client: {
    // ── Entry & HTML ──
    entry: "./src/main.tsx",
    html: "./index.html",

    // ── Plugins ──
    plugins: [
      {
        name: "tailwind",
        loaders: [
          { test: /\.css$/, use: ["style-loader", "css-loader", "postcss-loader"] },
        ],
      },
    ],

    // ── Dev server ──
    dev: {
      port: 3000,
      open: true,                // Open browser on start
      https: false,              // Enable HTTPS
      historyApiFallback: true,  // SPA routing (rewrites to index.html)
    },

    // ── Transport (how client calls server functions) ──
    transport: {
      baseUrl: "http://localhost:3001", // Override server origin
      endpoint: "/api/fn",             // Must match server.endpoint
    },
  },

  server: {
    // ── Server functions ──
    endpoint: "/api/fn",
    backend: "node",                       // "node" | "bun" | "deno run --allow-net"

    // ── Plugins ──
    plugins: [
      // Server-side plugins (same interface as client plugins)
    ],

    // ── Dev server ──
    dev: {
      port: 3001,
    },
  },
});
```

## Client Options

### `client.entry`
Path to the client entry point. Must export the `createApp()` call.

### `client.html`
Path to the HTML template. Must contain a mount element (e.g. `<div id="app">`).

### `client.plugins`

Array of `EvPlugin` objects that extend the build pipeline. Each plugin can declare loaders.

#### Plugin Interface

```ts
interface EvPlugin {
  name: string;
  loaders?: EvPluginLoader[];
}

interface EvPluginLoader {
  test: RegExp;          // File matching pattern
  exclude?: RegExp;      // Pattern to exclude
  use: EvLoaderEntry | EvLoaderEntry[];
}

// A loader entry: string or object with options
type EvLoaderEntry =
  | string
  | { loader: string; options?: Record<string, unknown> };
```

#### Examples

```ts
// Simple loader
{ name: "css", loaders: [{ test: /\.css$/, use: "css-loader" }] }

// Loader chain
{ name: "tailwind", loaders: [{
  test: /\.css$/,
  use: ["style-loader", "css-loader", "postcss-loader"],
}]}

// Per-loader options
{ name: "css-modules", loaders: [{
  test: /\.module\.css$/,
  use: [
    "style-loader",
    { loader: "css-loader", options: { modules: true } },
  ],
}]}

// With exclude
{ name: "svg", loaders: [{
  test: /\.svg$/,
  exclude: /node_modules/,
  use: "@svgr/webpack",
}]}
```

### `client.dev`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | Webpack Dev Server port |
| `open` | `boolean` | — | Open browser on start |
| `https` | `boolean` | — | Enable HTTPS |
| `historyApiFallback` | `boolean` | — | Rewrite 404s to `index.html` for SPA routing |

### `client.transport`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | — | Override server origin (useful for cross-origin setups) |
| `endpoint` | `string` | `/api/fn` | Path prefix for server function RPC calls |

> [!NOTE]
> In dev mode, the client dev server proxies `/api/*` to the API server automatically, so `baseUrl` is usually not needed.

## Server Options

### `server.endpoint`
The path at which the server handles function RPC calls. Must match `client.transport.endpoint`.

### `server.backend`
The runtime command used to start the server. Supports:

| Value | Behavior |
|-------|----------|
| `"node"` (default) | Uses `--watch` for auto-restart in dev |
| `"bun"` | Passes args as-is |
| `"deno run --allow-net"` | Split on whitespace, extra args forwarded |

> [!WARNING]
> The ECMA adapter (`@evjs/server/ecma`) only exports a `{ fetch }` handler — it does **not** start a listening server. For `ev dev`, always use `"node"` as the backend. Use ECMA adapters only for production targets like Deno or Bun.


### `server.plugins`

Same `EvPlugin` interface as `client.plugins`. Server-side plugin loaders are applied to the server bundle.

### `server.dev`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3001` | API server port in dev mode |

## Examples

### Minimal (custom ports only)

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  client: { dev: { port: 4000 } },
  server: { dev: { port: 4001 } },
});
```

### With Tailwind CSS

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  client: {
    plugins: [{
      name: "tailwind",
      loaders: [{
        test: /\.css$/,
        use: ["style-loader", "css-loader", "postcss-loader"],
      }],
    }],
  },
});
```

