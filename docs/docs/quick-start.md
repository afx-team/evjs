# Quick Start

## Create a New Project

```bash
npx @evjs/create-app my-app
cd my-app && npm install
```

Both arguments are optional — if omitted, the CLI prompts interactively.

### Available Templates

| Template | Description |
|----------|-------------|
| `basic` | Routing + server functions |
| `mpa` | Multi-page application setup |
| `api-routes` | Programmatic REST API routes via `createRoute()` |
| `complex-routing` | Params, search, root layout, loaders, nested paths |
| `with-tailwind` | Tailwind CSS via PostCSS |
| `with-trpc` | tRPC interop example |
| `with-sqlite` | Full-stack CRUD with SQLite |
| `custom-ws-transport` | Custom WebSocket transport |
| `plugin-authoring` | Plugin lifecycle and bundler hook examples |

## Development

```bash
ev dev
```

Your browser opens to `http://localhost:3000` with Hot Module Replacement.
Server functions in `"use server"` modules are auto-discovered from explicit
app/page/server roots.

## Production Build

```bash
ev build
```

## Project Structure

```
my-app/
├── .gitignore              # Ignores generated evjs type files
├── index.html              # HTML template (must have <div id="app">)
├── ev.config.ts            # Optional config
├── src/
│   ├── layout/
│   │   └── index.tsx       # Optional SPA root layout
│   ├── pages/              # Page routes
│   │   ├── index.tsx       # /
│   │   └── users/$id.tsx   # /users/$id
│   └── api/                # Server-only modules
│       ├── users.server.ts # "use server" functions
│       └── health.routes.ts
├── package.json
└── tsconfig.json
```

## Pages

```tsx
// src/pages/users/$id.tsx
import { usePageParams, useQuery } from "@evjs/client";
import { getUser } from "../../api/users.server";

export default function UserPage() {
  const { id } = usePageParams();
  const { data } = useQuery(getUser, id);
  return <main>{data?.name}</main>;
}
```

When `src/pages` exists and the project does not declare explicit `app`,
`pages`, or `remote` config, evjs automatically builds an SPA from the file
tree. The generated routing glue stays inside the framework; SPA mode only
writes `src/evjs-route-types.d.ts` for TypeScript and scaffolded apps ignore it
by default.

## MPA Mode

Use the same `src/pages` files for an MPA and switch the routing mode:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

Each page is emitted as its own HTML document and client entry without
SPA router setup. The `layout/index.tsx` convention is SPA-only and lives beside
the page route directory using that exact path; MPA pages compose shared wrappers
as normal components.

## Packages

| Package | Purpose |
|---------|---------|
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | Framework API, config, plugins, and build orchestration (`defineConfig`, `dev`, `build`) |
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | Thin CLI wrapper (`ev dev`, `ev build`) with the default bundler |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | Project scaffolding (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | Browser runtime, transport, page hooks, navigation helpers, and remote host helpers |
| [`@evjs/server`](https://github.com/evaijs/evjs/tree/main/packages/server) | Hono/fetch server runtime, server functions, routes, and SSR/PPR/RSC request handling |

Manifest schemas, build tools, page runtime, and shell internals are internal
modules under the public packages above. Application code should normally
import through `@evjs/ev`, `@evjs/client`, and `@evjs/server`.

## Required Dependencies

```json
{
  "dependencies": {
    "@evjs/client": "<same version>",
    "@evjs/server": "<same version>",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@evjs/ev": "<same version>",
    "@evjs/cli": "<same version>",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^6.0.2"
  }
}
```

:::important

Keep all `@evjs/*` packages in your app on the same version. When upgrading evjs, upgrade `@evjs/client`, `@evjs/server`, `@evjs/ev`, `@evjs/cli`, and any other `@evjs/*` packages together.

:::

## Key Rules

- Config file: `ev.config.ts` (not `evjs.config.ts`)
- Import `defineConfig` from `@evjs/ev`, not from `@evjs/server`
- HTML must have `<div id="app">` for the render target
- Do NOT add `"type": "module"` to your **project's** `package.json` — the server bundle uses CJS format
- Prefer `src/pages` as the route source of truth.
- Keep `src/evjs-route-types.d.ts` generated and ignored; do not import it.
- Use `routing.mode: "mpa"` for independent pages without a client router.
