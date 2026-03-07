# @evjs/cli — Agent Guide

> AI-agent reference for the `@evjs/cli` CLI package.

## What This Package Does

The `@evjs/cli` package is the CLI and config layer of the ev meta-framework. It provides:

1. **`ev init`** — scaffolds projects from templates
2. **`ev dev`** — starts WebpackDevServer + Node API server
3. **`ev build`** — runs production webpack build
4. **`defineConfig`** — type-safe configuration export

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry — Commander commands (`init`, `dev`, `build`) |
| `src/config.ts` | `EvfConfig` types + `defineConfig()` helper |
| `src/load-config.ts` | Loads `ev.config.ts` / `.js` / `.mjs` from project root |
| `src/create-webpack-config.ts` | Generates webpack config object from `EvfConfig` |

## Config Shape

```ts
interface EvfConfig {
  client?: {
    entry?: string;        // default: "./src/main.tsx"
    html?: string;         // default: "./index.html"
    dev?: { port?: number; ... };  // default port: 3000
    transport?: { baseUrl?: string; endpoint?: string };
  };
  server?: {
    runner?: string;
    endpoint?: string;     // default: "/api/fn"
    middleware?: string[];
    dev?: { port?: number; ... };  // default port: 3001
  };
}
```

## How Build Works

1. `ev build` / `ev dev` calls `resolveWebpackConfig(cwd)`
2. If `ev.config.ts` exists → load it, pass to `createWebpackConfig()`
3. If no config and no `webpack.config.cjs` → use zero-config defaults
4. `createWebpackConfig()` returns a webpack config **object** (no temp files)
5. CLI calls `webpack()` Node API directly

## Dependencies

Webpack toolchain (`webpack`, `webpack-dev-server`, `html-webpack-plugin`, `swc-loader`, `@evjs/webpack-plugin`) are **dependencies of @evjs/cli** — users don't need to install them separately.

## Rules

- Do NOT generate temp config files — use webpack Node API directly
- Module resolution uses `createRequire(import.meta.url)` for reliable dep resolution
- Config file name is `ev.config.ts` (not `ev.config.ts`)
