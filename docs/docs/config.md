# Configuration

evjs is **zero-config by default**. Optionally create `ev.config.ts` in the project root to override defaults. The `defineConfig` helper provides full type-safety.

```ts
import { defineConfig } from "@evjs/cli";
export default defineConfig({ /* ... */ });
```

## Defaults

All fields are optional. These are the built-in defaults:

| Setting | Default |
|---------|---------|
| `entry` | `./src/main.tsx` |
| `html` | `./index.html` |
| `dev.port` | `3000` |
| `server.runtime` | `"node"` |
| `server.dev.port` | `3001` |
| `server.endpoint` | `/api/fn` |

## Full Reference

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  // ── Entry & HTML ──
  entry: "./src/main.tsx",
  html: "./index.html",

  // ── Client dev server ──
  dev: {
    port: 3000,
    https: false,
  },

  // ── Server (optional) ──
  // Set to `false` for CSR-only apps (flat dist/ output, no server bundle)
  // server: false,
  server: {
    entry: "./src/server.ts",        // Explicit server entry (optional)
    runtime: "node",                 // "node" | "bun" | "deno run --allow-net"
    endpoint: "/api/fn",             // Server function RPC endpoint

    dev: {
      port: 3001,
      https: false,
    },
  },
});
```

## Client Options

### `entry`

Path to the client entry point. Must export the `createApp()` call.

### `html`

Path to the HTML template. Must contain a mount element (e.g. `<div id="app">`).

### `dev`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3000` | Webpack Dev Server port |
| `https` | `boolean \| { key: string; cert: string }` | `false` | Enable HTTPS. Pass `true` for auto-certs or an object with explicit key/cert. |

## Server Options

The `server` field accepts an object for fullstack apps, or `false` to disable the server entirely (CSR-only mode).

```ts
// CSR-only: flat dist/ output, no server bundle
export default defineConfig({ server: false });
```

When `server: false`:
- Build output goes to `dist/` instead of `dist/client/` + `dist/server/`
- Any `"use server"` module causes a **build error**
- No API proxy is configured in dev mode

### `server.entry`

Explicit server entry file. If provided, overrides the auto-generated entry. Use this when you need to mount custom route handlers.

### `server.runtime`

The runtime command used to start the server:

| Value | Behavior |
|-------|----------|
| `"node"` (default) | Uses `--watch` for auto-restart in dev |
| `"bun"` | Passes args as-is |
| `"deno run --allow-net"` | Split on whitespace, extra args forwarded |

:::warning

The ECMA adapter (`@evjs/server/ecma`) only exports a `{ fetch }` handler — it does **not** start a listening server. For `ev dev`, always use `"node"` as the runtime. Use ECMA adapters only for production targets like Deno or Bun.

:::

### `server.endpoint`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | `/api/fn` | Path for server function RPC calls |

### `server.dev`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3001` | API server port in dev mode |
| `https` | `{ key: string; cert: string } \| false` | `false` | Enable HTTPS for the API server. Must provide explicit key/cert. |

Plugins offer two hooks to extend the framework:

### `config(config, ctx)`
Modifies the framework-level `EvConfig`. Useful for changing ports, entry points, or routing endpoints.

```ts
config(config, ctx) {
  if (ctx.mode === "development") {
    config.dev ??= {};
    config.dev.port = 8080;
  }
}
```

### `bundler(bundlerConfig, ctx)`
Modifies the underlying bundler configuration (e.g., Webpack). The `bundlerConfig` argument is `unknown`, as it depends on the active adapter. `ctx` includes the fully resolved framework `config`.

```ts
bundler(bundlerConfig, ctx) {
  const webpackConfig = bundlerConfig as any;
  webpackConfig.module.rules.push({
    test: /\.mdx$/,
    use: ["mdx-loader"]
  });
}
```

Context types:
- `EvConfigCtx`: `{ mode: "development" | "production" }`
- `EvBundlerCtx`: `{ mode: "development" | "production", config: ResolvedEvConfig }`

## Bundler Options

The `bundler` field provides access to the underlying compilation engine.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `"webpack" \| "utoopack"` | `"webpack"` | The active bundler adapter |
| `config` | `(bundlerConfig: unknown, ctx: EvBundlerCtx) => void` | `undefined` | Escape hatch to modify bundler config |

### Built-in Support: CSS & Tailwind
evjs includes **built-in PostCSS/Tailwind support**. If a `postcss.config.js` file is detected in the project root, the internal Webpack adapter automatically enables `postcss-loader`. No plugin or custom `bundler` hook is required for standard Tailwind setups.

A plugin can either mutate the config object directly or return a new one.

### Meaningful Complete Example

This example demonstrates a production-ready setup with custom loaders, environment variables, and specialized entry points.

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  // 1. Custom Entry Points
  entry: "./src/entry-client.tsx",
  server: {
    entry: "./src/entry-server.ts",
    endpoint: "/api/rpc",
    dev: { port: 4001 },
  },

  dev: { port: 4000 },

  // 2. Specialized Plugins
  plugins: [
    {
      name: "mdx-support",
      bundler(bundlerConfig, ctx) {
        // Only add MDX support for Webpack
        if (ctx.config.bundler.name === "webpack") {
          const webpackConfig = bundlerConfig as any;
          webpackConfig.module.rules.push({
            test: /\.mdx$/,
            use: ["mdx-loader"],
          });
        }
      },
    },
  ],

  // 3. Direct Bundler Escape Hatch
  bundler: {
    config(bundlerConfig, ctx) {
      // Inject global environment variables via Webpack
      if (ctx.config.bundler.name === "webpack") {
        const webpack = require("webpack");
        const webpackConfig = bundlerConfig as any;
        webpackConfig.plugins.push(
          new webpack.DefinePlugin({
            __VERSION__: JSON.stringify("1.2.3"),
          })
        );
      }
    },
  },
});
```

