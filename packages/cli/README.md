# @evjs/cli

> Thin command-line wrapper for the **evjs** fullstack framework.

## Install

```bash
npm install -g @evjs/cli
```

## Convention over Configuration

No configuration file is needed. `ev dev` and `ev build` delegate to `@evjs/ev` and inject the default utoopack adapter:

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
| `ev inspect` | Explain framework discovery without running a bundler or writing `dist` |

> **Scaffolding:** Use `npx @evjs/create-app` to scaffold a new project.

### `ev dev`

Uses the default bundler adapter directly (no temp config files):
1. **dev server** (port 3000) — client bundle with HMR.
2. **Node API Server** (port 3001) — auto-starts when server bundle is emitted, uses `node --watch`.

### `ev build`

Runs the production build through `@evjs/ev` with `NODE_ENV=production`:
- `dist/client/` — optimized client assets with content hashes.
- `dist/server/main.[hash].js` — server bundle.
- `dist/manifest.json` — single framework manifest with client, server, route, and function metadata.

### `ev inspect`

Runs the framework preflight path without bundling. Use it to inspect page
routes, ignored/rejected route files, server functions, server routes, render
metadata, runtime paths, planned entries, and diagnostics. Add
`--json` for machine-readable output.

## Configuration

Create `ev.config.ts` in the project root (optional):

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  entry: "./src/main.tsx",
  html: "./index.html",
  dev: { port: 3000 },
  server: {
    dev: { port: 3001 },
  },
});
```

The `dev` and `server.dev` fields accept extra options that are merged with defaults.

## Project Structure

```
my-app/
├── ev.config.ts          # optional config
├── index.html            # HTML template
├── package.json
├── tsconfig.json
└── src/
    ├── pages/             # page routes
    │   ├── index.tsx
    │   └── users/$id.tsx
    ├── api/               # server functions
    │   ├── users.server.ts
    │   └── posts.server.ts
    └── server.ts          # optional server entry
```

## Common Mistakes

1. **Don't create `custom bundler config file`** — use `ev.config.ts` instead
2. **Don't install bundler internals manually** — the default adapter is provided by `@evjs/cli`
3. **Config file must be `ev.config.ts`** — not `evjs.config.ts`
4. **Import `defineConfig` from `@evjs/ev`** — not from `@evjs/server`

## Bundled Dependencies

Users do NOT need to install these — they're included through `@evjs/cli`:
- `@evjs/bundler-utoopack`
- build tools under `@evjs/ev`
- the bundler's underlying compiler dependencies
