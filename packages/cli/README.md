# @evjs/cli

> CLI and configuration for the **@evjs/cli** meta-framework.

## Install

```bash
npm install -g @evjs/cli
```

## Convention over Configuration

No configuration file is needed. `ev dev` and `ev build` work out of the box with sensible defaults:

- Entry: `./src/main.tsx`
- HTML: `./index.html`
- Client dev server: port 3000
- API server (dev): port 3001
- Server functions auto-discovered via `"use server"` directive

## Commands

| Command | Description |
|---------|-------------|
| `ev dev` | Start dev server (client HMR + API watch) |
| `ev build` | Production build (client + server) |

> **Scaffolding:** Use `npx @evjs/create-app` to scaffold a new project.

### `ev dev`

Uses webpack Node API directly (no temp config files):
1. **WebpackDevServer** (port 3000) — client bundle with HMR.
2. **Node API Server** (port 3001) — auto-starts when server bundle is emitted, uses `node --watch`.

### `ev build`

Runs webpack via Node API with `NODE_ENV=production`:
- `dist/client/` — optimized client assets with content hashes.
- `dist/server/main.[hash].js` — server bundle (entry discovered via `dist/manifest.json`).

## Configuration

Create `ev.config.ts` in the project root (optional):

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  client: {
    entry: "./src/main.tsx",
    html: "./index.html",
    plugins: [{ name: "tailwind", module: { rules: [{ test: /\.css$/, use: ["style-loader", "css-loader", "postcss-loader"] }] } }],
    dev: { port: 3000 },
  },
  server: {
    endpoint: "/api/fn",

    dev: { port: 3001 },
  },
});
```

The `client.dev` and `server.dev` fields accept extra options that are merged with defaults.

## Project Structure

```
my-app/
├── ev.config.ts          # optional config
├── index.html            # HTML template
├── package.json
├── tsconfig.json
└── src/
    ├── main.tsx           # app bootstrap (keep minimal)
    ├── routes.tsx         # route tree + components
    ├── api/               # server functions
    │   ├── users.server.ts
    │   └── posts.server.ts

        └── auth.ts
```

## Common Mistakes

1. **Don't create `webpack.config.cjs`** — use `ev.config.ts` instead
2. **Don't install webpack manually** — it's a dependency of `@evjs/cli`
3. **Config file must be `ev.config.ts`** — not `evjs.config.ts`
4. **Import `defineConfig` from `@evjs/cli`** — not from `@evjs/server`

## Bundled Dependencies

Users do NOT need to install these — they're included in `@evjs/cli`:
- `webpack`, `webpack-dev-server`
- `html-webpack-plugin`, `swc-loader`, `@swc/core`
- `@evjs/webpack-plugin`, `@evjs/build-tools`
