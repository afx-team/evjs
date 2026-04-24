# Dev Server

## Command

```bash
ev dev
```

No flags needed — configuration comes from `ev.config.ts` or convention-based defaults.

## What It Does

`ev dev` starts **two servers** simultaneously:

| Server | Default Port | Purpose |
|--------|-------------|---------|
| **Dev Server** | `3000` | Client bundle with Hot Module Replacement (HMR) |
| **API Server** | `3001` | Server functions + route handlers, auto-started after first build |

The client dev server automatically proxies `/api/*` requests to the API server.

```mermaid
flowchart LR
    Browser -->|":3000"| WDS["Dev Server"]
    WDS -->|"HMR"| Browser
    WDS -->|"/api/* proxy"| API["API Server :3001"]
    API --> Hono["Hono App"]
    Hono --> Registry["Server Function Registry"]
```

## Configuration

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  entry: "./src/main.tsx",         // Default
  html: "./index.html",            // Default
  dev: {
    port: 3000,                   // WDS port
    https: false,                 // HTTPS mode
  },
  server: {
    endpoint: "/api/fn",           // Default
    runtime: "node",               // Or "bun", "deno", etc.
    dev: {
      port: 3001,                 // API port
      https: false,               // HTTPS for API server
    },
  },
});
```

## How It Works

1. `loadConfig(cwd)` loads `ev.config.ts`.
2. `resolveConfig()` applies defaults, then `plugin.setup()` collects lifecycle hooks.
3. `hooks.buildStart()` runs before compilation.
4. `BundlerAdapter.dev()` is invoked (applying plugin `bundlerConfig` hooks to the config).
5. Starts `dev server` for client HMR.
6. The adapter signals `onServerBundleReady` after discovery.
7. The CLI core auto-starts the API server via `@evjs/server/node`.
8. Sets up reverse proxy: `devServer.proxy["/api"] → localhost:3001`.

## Custom Runtimes

The `server.runtime` field supports any executable:

- `"node"` (default) — uses `--watch` for auto-restart
- `"bun"` — passes args as-is
- `"deno run --allow-net"` — split on whitespace, extra args forwarded

:::warning

The ECMA environment adapter (`@evjs/server/ecma`) only exports a `{ fetch }` handler — it does **not** start a listening server. For `ev dev`, you **must** use a runtime that starts an HTTP server (default: `"node"`).

:::

## Programmatic API

`ev dev` and `ev build` can also be used programmatically:

```ts
import { dev, build } from "@evjs/cli";

// Start dev server (loads ev.config.ts and uses defaults)
await dev({ dev: { port: 3000 } }, { cwd: "./my-app" });

// Run production build
await build({ entry: "./src/main.tsx" }, { cwd: "./my-app" });
```

## Transport

`initTransport` is called automatically by `createApp()` to configure how the client communicates with the server.

- In **dev mode**: WDS proxies `/api/*` → `:3001`, so the default `/api/fn` endpoint works automatically
- In **production**: client and server are typically on the same origin
- The transport is **runtime-agnostic** — the client always posts to the same endpoint regardless of server runtime
