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
- Reachable server functions discovered via the `"use server"` directive
- Server request-route anchors auto-discovered from `./src/apis/**/api.*`

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

Uses the default bundler adapter directly:

1. **browser dev server** (preferred port 3000) — client bundle with HMR;
2. **framework server** (preferred port 3001) — starts when the active
   BuildPlan emits a server runtime.

### `ev build`

Runs the production build through `@evjs/ev` with `NODE_ENV=production`:
- `dist/client/` — optimized client assets with content hashes.
- `dist/server/` — server artifacts when the BuildPlan requires them.
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
tree as Page-owned Documents. MPA accepts static Page paths and rejects
dynamic/catch-all paths and router-only boundary facets.

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
    │       └── health/
    │           └── api.ts             # /api/health server request route
    └── middleware.ts                  # optional server middleware
```

Only `page.*` creates a canonical client Page and Route. Other files below a
Page directory, including `index.*`, are ordinary Page-private source and need
no `_` prefix. The Page directory determines the URL in both SPA and MPA mode.

## Authoring Boundaries

1. Canonical apps publish Pages through `src/pages/**/page.*` and declare
   `routing.mode`; colocated `index.*` files remain ordinary source.
2. Configure the framework in `ev.config.ts`; the CLI supplies the default
   bundler adapter.
3. Import `defineConfig` and `definePageConfig` from `@evjs/ev`.

Explicit `application.routes` and `component`/`routes` config are SPA-only
route-tree inputs in `@evjs/ev`; they normalize into the same CoreGraph and
cannot be combined with canonical `routing` discovery.

## Bundled Dependencies

Users do NOT need to install these — they're included through `@evjs/cli`:
- `@evjs/bundler-utoopack`
- build tools under `@evjs/ev`
- the bundler's underlying compiler dependencies
