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

The dev server runs at `http://localhost:3000` with Hot Module Replacement.
Server functions in reachable `"use server"` modules are auto-discovered from
app, page, and server entry import graphs.

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
`pages` config, evjs automatically builds an SPA from the file
tree. The generated routing glue stays inside the framework; SPA mode only
writes `src/route-types.d.ts` for TypeScript and scaffolded apps ignore it
by default.

SPA root layout discovery is optional. Use one `layout.*` or `layout/index.*`
source module beside the route directory, such as `src/layout.tsx` or
`src/layout/index.tsx`, set `routing.layout` to another module path, or set
`routing.layout: false` when the app should not have a framework root layout.
SPA route layouts can also live inside the route directory as `layout.*` or
`layout/index.*` modules.

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
SPA router setup. Framework layout conventions are SPA-only; MPA pages compose
shared wrappers as normal components and do not accept `routing.layout`.

## Packages

| Package | Purpose |
|---------|---------|
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | Framework API, config, plugins, build orchestration, and deployment helpers |
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | Thin CLI wrapper (`ev dev`, `ev build`, `ev inspect`) with the default bundler |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | Project scaffolding (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | Browser runtime core for standalone CSR, page hooks, navigation, transport, and RSC |
| [`@evjs/server`](https://github.com/evaijs/evjs/tree/main/packages/server) | Server runtime core for Hono/fetch apps, server functions, routes, rendering, and deployment |

Manifest schemas, build tools, generated page runtime, and shell internals are
internal modules under the public packages above. Application config/build code
imports framework composition APIs from `@evjs/ev`; runtime code imports from
`@evjs/client`, `@evjs/server`, or `@evjs/server/react`. Browser-only CSR apps
that own their build pipeline can use `@evjs/client` without depending on
`@evjs/ev`.
Use `@evjs/cli` and `@evjs/create-app` as tools, not application imports.
Bundler adapters such as `@evjs/bundler-utoopack` and shared contract modules
such as `@evjs/shared` are only for custom framework tooling or adapter work.

Declare `@evjs/client` when application source or generated SPA entries need the
browser runtime. Declare `@evjs/server` when the app uses server functions,
server routes, framework rendering, or deployment runtime wrappers.

## Required Dependencies

```json
{
  "dependencies": {
    "@evjs/client": "<same version>",
    "@evjs/ev": "<same version>",
    "@evjs/server": "<same version>",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@evjs/cli": "<same version>",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^6.0.2"
  }
}
```

:::important

Keep all `@evjs/*` packages in your app on the same version. Declare runtime
packages that application source imports directly; scaffolded full-stack
templates usually include `@evjs/client` and `@evjs/server` alongside
`@evjs/ev` and `@evjs/cli`. If you add adapter packages, upgrade them together
with the rest of the framework packages.

:::

## Key Rules

- Config file: `ev.config.ts` (not `evjs.config.ts`)
- Import `defineConfig` from `@evjs/ev`, not from `@evjs/server`
- HTML must have `<div id="app">` for the render target
- Do NOT add `"type": "module"` to your **project's** `package.json` — the server bundle uses CJS format
- Prefer `src/pages` as the route source of truth.
- Keep `src/route-types.d.ts` generated and ignored; do not import it.
- Use `routing.mode: "mpa"` for independent pages without a client router.
