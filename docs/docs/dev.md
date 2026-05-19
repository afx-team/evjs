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
    Browser -->|":3000"| DEV["Dev Server"]
    DEV -->|"HMR"| Browser
    DEV -->|"/api/* proxy"| API["API Server :3001"]
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
    port: 3000,                   // Client dev server port
    https: false,                 // HTTPS mode
  },
  server: {
    functions: {
      endpoint: "api/fn",         // Default
    },
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

## API Server Runtime

In dev mode, evjs runs the built server bundle through a small Node bootstrap that calls `@evjs/server/node`. For production, deploy the emitted `{ fetch }` handler with the runtime wrapper that matches your host.

## Programmatic API

`ev dev` and `ev build` can also be used programmatically:

```ts
import { dev, build } from "@evjs/ev";
import { utoopackAdapter } from "@evjs/bundler-utoopack";

// Start dev server with an explicit bundler adapter
await dev({ dev: { port: 3000 } }, { cwd: "./my-app", bundler: utoopackAdapter });

// Run production build
await build({ entry: "./src/main.tsx" }, { cwd: "./my-app", bundler: utoopackAdapter });
```

`@evjs/cli` also exports compatibility wrappers that inject the default utoopack adapter, matching the `ev dev` and `ev build` commands.

## Transport

The default HTTP transport works without app code. Call `initTransport()` at app
startup only when you need to customize the built-in HTTP adapter or replace it
with a custom adapter.

- In **dev mode**: the client dev server proxies `/api/*` → `:3001`, so the default `api/fn` endpoint works automatically
- In **production**: client and server are typically on the same origin
- The transport is **runtime-agnostic** — the client always posts to the same endpoint regardless of server runtime
- Use `credentials` and `headers` for the built-in HTTP adapter; fetch `mode` is not configurable
