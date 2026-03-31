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
  server: {
    entry: "./src/server.ts",        // Explicit server entry (optional)
    backend: "node",                 // "node" | "bun" | "deno run --allow-net"
    endpoint: "/api/fn",             // Server function RPC endpoint

    dev: {
      port: 3001,
      https: false,
    },
  },

  // ── Plugins ──
  plugins: [
    {
      name: "my-plugin",
      config(config, ctx) {
        // Framework-level config hook
        if (ctx.mode === "development") {
          config.dev ??= {};
          config.dev.port = 8080;
        }
      },
      bundler(bundlerConfig, ctx) {
        // Bundler-level config hook (e.g. Webpack)
        // bundlerConfig is the raw configuration object
      }
    },
  ],

  // ── Bundler Escape Hatch ──
  bundler: {
    name: "webpack", // "webpack" | "utoopack" (future)
    config(bundlerConfig, ctx) {
      // Direct access to the underlying bundler configuration
    }
  }
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
| `https` | `boolean` | `false` | Enable HTTPS |

## Server Options

### `server.entry`

Explicit server entry file. If provided, overrides the auto-generated entry. Use this when you need to mount custom route handlers.

### `server.backend`

The runtime command used to start the server:

| Value | Behavior |
|-------|----------|
| `"node"` (default) | Uses `--watch` for auto-restart in dev |
| `"bun"` | Passes args as-is |
| `"deno run --allow-net"` | Split on whitespace, extra args forwarded |

:::warning

The ECMA adapter (`@evjs/server/ecma`) only exports a `{ fetch }` handler — it does **not** start a listening server. For `ev dev`, always use `"node"` as the backend. Use ECMA adapters only for production targets like Deno or Bun.

:::

### `server.endpoint`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | `/api/fn` | Path for server function RPC calls |

### `server.dev`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | `3001` | API server port in dev mode |
| `https` | `boolean` | `false` | Enable HTTPS for the API server |

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
- `EvBundlerCtx`: `{ mode: "development" | "production", config: EvConfig }`

## Bundler Options

The `bundler` field provides access to the underlying compilation engine.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `"webpack" \| "utoopack"` | `"webpack"` | The active bundler adapter |
| `config` | `(bundlerConfig: unknown, ctx: EvBundlerCtx) => void` | `undefined` | Escape hatch to modify bundler config |

### Built-in Support: CSS & Tailwind
evjs includes **built-in PostCSS/Tailwind support**. If a `postcss.config.js` file is detected in the project root, the internal Webpack adapter automatically enables `postcss-loader`. No plugin or custom `bundler` hook is required for standard Tailwind setups.

A plugin can either mutate the config object directly or return a new one.

## Examples

### Minimal (custom ports only)

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  dev: { port: 4000 },
  server: { dev: { port: 4001 } },
});
```

### Plugin that adjusts config per mode

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  plugins: [
    {
      name: "env-config",
      config(config, ctx) {
        if (ctx.mode === "production") {
          config.server ??= {};
          config.server.endpoint = "/api/v2";
        }
      },
    },
  ],
});
```
