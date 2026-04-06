# Configuration

evjs is **zero-config by default**. Optionally create `ev.config.ts` in the project root to override defaults. The `defineConfig` helper provides full type-safety.

```ts
import { defineConfig } from "@evjs/ev";
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
import { defineConfig } from "@evjs/ev";

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

## Plugins

Register plugins via the `plugins` array. Each plugin has a `name` and a `setup()` function that returns lifecycle hooks:

```ts
export default defineConfig({
  plugins: [
    {
      name: "my-plugin",
      setup(ctx) {
        return {
          buildStart() { /* ... */ },
          bundler(config) { /* ... */ },
          transformHtml(doc) { /* ... */ },
          buildEnd(result) { /* ... */ },
        };
      },
    },
  ],
});
```

See the **[Plugins guide](./plugins.md)** for the full API reference, `EvDocument` DOM interface, type-safe bundler helpers, and recipes.

## Bundler Options

The `bundler` field selects the compilation engine.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `"webpack"` | `"webpack"` | The active bundler adapter. Future: `"utoopack"` (planned) |

### Built-in Support: CSS & Tailwind
evjs includes **built-in PostCSS/Tailwind support**. If a `postcss.config.js` file is detected in the project root, the internal Webpack adapter automatically enables `postcss-loader`. No plugin or custom hook is required for standard Tailwind setups.

### Complete Example

This example demonstrates a production-ready setup with custom loaders and build analytics.

```ts
import { defineConfig } from "@evjs/ev";
import { webpack } from "@evjs/bundler-webpack";

export default defineConfig({
  entry: "./src/entry-client.tsx",
  server: {
    entry: "./src/entry-server.ts",
    endpoint: "/api/rpc",
    dev: { port: 4001 },
  },

  dev: { port: 4000 },

  plugins: [
    {
      name: "mdx-support",
      setup() {
        return {
          bundler: webpack((config) => {
            config.module?.rules?.push({
              test: /\.mdx$/,
              use: ["mdx-loader"],
            });
          }),
        };
      },
    },
    {
      name: "build-timer",
      setup(ctx) {
        const t0 = Date.now();
        return {
          buildStart() {
            console.log(`Building (${ctx.mode})...`);
          },
          buildEnd(result) {
            console.log(`Done in ${Date.now() - t0}ms`);
            console.log(`Assets: ${result.clientManifest.assets.js.length} JS`);
          },
        };
      },
    },
  ],
});
```

