# @evjs/cli

> Thin command-line wrapper for the **evjs** fullstack framework.

## Install

```bash
npm install -g @evjs/cli
```

## Canonical Conventions

`ev dev` and `ev build` delegate to `@evjs/ev` and inject the default
Utoopack adapter. Framework-managed applications declare whether the canonical
Page tree is materialized as an SPA or MPA:

- Page and client-route anchors: `./src/pages/**/page.*`
- Page scope and URL: the complete containing directory
- Optional build-time Page config: adjacent `page.config.ts`
- Shared HTML template: `./index.html`
- Client dev server: port 3000
- API server (dev): port 3001
- Server functions auto-discovered via `"use server"` directive
- Server request routes auto-discovered from `./src/apis`

`routing.mode` selects SPA or MPA materialization for the same semantic
Page-and-Route tree. It does not select a different file convention.

## Commands

| Command | Description |
|---------|-------------|
| `ev dev` | Start dev server (client HMR + API watch) |
| `ev build` | Production build (client + server) |
| `ev prepare` | Generate `.ev` framework IR without bundling or writing `dist` |
| `ev inspect` | Explain framework discovery without running a bundler or writing generated output |

> **Scaffolding:** Use `npx @evjs/create-app` to scaffold a new project.

### `ev dev`

Uses the default bundler adapter directly (no temp config files):
1. **dev server** (port 3000) — client bundle with HMR.
2. **Node API Server** (port 3001) — auto-starts when server bundle is emitted, uses `node --watch`.

### `ev build`

Runs the production build through `@evjs/ev` with `NODE_ENV=production`:
- `dist/client/` — optimized client assets with content hashes.
- `dist/server/main.[hash].js` — server bundle.
- `dist/deployment-metadata.json` — canonical deployment metadata for tooling
  and adapters.

### `ev prepare`

Runs config resolution, file-convention discovery, generated contributions, and
entry facade generation without invoking the bundler. It writes `.ev/` so tools
and agents can inspect `.ev/manifest.json`, `.ev/framework/core-graph.json`,
`.ev/framework/build-plan.json`, generated entries, and plugin generated
modules.

### `ev inspect`

Runs the framework preflight path without bundling and without writing `dist` or
`.ev`. Use it to inspect page routes, ignored/rejected route files, server
functions, server routes, render metadata, runtime paths, planned entries, and diagnostics. Add
`--json` for machine-readable output.

## Configuration

Create `ev.config.ts` in the project root and select the materialization mode:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
  dev: { port: 3000 },
  server: {
    dev: { port: 3001 },
  },
});
```

The `dev` and `server.dev` fields accept extra options that are merged with
defaults. Change only `routing.mode` to `"mpa"` to materialize the same Page
tree as Page-owned Documents. Dynamic-route output and React route facets in
MPA remain staged; `ev inspect` and `ev build` report unsupported combinations.

## Project Structure

```text
my-app/
├── ev.config.ts
├── index.html                         # shared HTML template
├── package.json
├── tsconfig.json
└── src/
    ├── pages/
    │   ├── page.tsx                    # /
    │   ├── page.config.ts             # optional build-time Page config
    │   ├── components/
    │   │   └── index.tsx              # private source, not a Page
    │   └── users/
    │       └── $userId/
    │           └── page.tsx            # /users/:userId
    ├── api/
    │   └── users.server.ts            # reachable server functions
    ├── apis/
    │   └── api/
    │       └── health.ts              # server request route
    └── middleware.ts                  # optional server middleware
```

Only `page.*` creates a canonical client Page and Route. Other files below a
Page directory, including `index.*`, are ordinary Page-private source and need
no `_` prefix. The Page directory determines the URL in both SPA and MPA mode.

## Common Mistakes

1. **Do not create `src/main.tsx` or top-level `entry` for a canonical app** —
   add `src/pages/**/page.tsx` anchors and declare `routing.mode`.
2. **Do not use `index.tsx` as a new Page anchor** — it is ordinary private
   source in the canonical model.
3. **Do not create a custom bundler config file** — use `ev.config.ts` instead.
4. **Do not install bundler internals manually** — the default adapter is
   provided by `@evjs/cli`.
5. **Config file must be `ev.config.ts`** — not `evjs.config.ts`.
6. **Import `defineConfig` and `definePageConfig` from `@evjs/ev`** — not from
   `@evjs/server`.

Explicit `application.routes` and Bigfish-style route config remain SPA-only
route-tree migration inputs in `@evjs/ev`; they normalize into the same Core
graph, reject MPA materialization, and are not additional canonical routing models.
Before running a Smallfish or evjs
0.2 application, move or rename every published entry to `page.tsx`, move Page
configuration to `page.config.ts`, and configure only
`routing.mode: "spa" | "mpa"`. There is no compatibility-reader switch.

## Bundled Dependencies

Users do NOT need to install these — they're included through `@evjs/cli`:
- `@evjs/bundler-utoopack`
- build tools under `@evjs/ev`
- the bundler's underlying compiler dependencies
