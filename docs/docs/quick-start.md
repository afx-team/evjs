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
| `api-routes` | REST API routes via default server file routes |
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
app, page, server file-route, and server middleware convention import graphs.

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
│   ├── apis/               # Server file routes
│   │   ├── users.server.ts # "use server" functions
│   │   └── api/
│   │       └── health.ts   # /api/health
│   └── middleware.ts       # Global server middleware
├── package.json
└── tsconfig.json
```

## Pages

```tsx
// src/pages/users/$id.tsx
import { usePageParams } from "@evjs/ev/route";
import { useQuery } from "@evjs/ev/query";
import { getUser } from "../../apis/users.server";

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

SPA root layout discovery is optional. Use `src/layout/index.tsx` beside the
default route directory, or set `routing.conventions.layout` to another module
path when the shell intentionally lives elsewhere. Nested SPA route layouts can
live below a route segment, such as `src/pages/posts/layout.tsx`.

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
shared wrappers as normal components and do not accept
`routing.conventions.layout`.

## Packages

| Package | Purpose |
|---------|---------|
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | Framework API, config, plugins, build orchestration, deployment helpers, and file-convention authoring subpaths |
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | Thin CLI wrapper (`ev dev`, `ev build`, `ev inspect`) with the default bundler |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | Project scaffolding (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | Standalone/manual browser runtime core for apps that do not use evjs file conventions |
| [`@evjs/server`](https://github.com/evaijs/evjs/tree/main/packages/server) | Standalone/manual server runtime core for hand-written Hono/fetch apps and route primitives |

Manifest schemas, build tools, generated page runtime, and shell internals are
internal modules under the public packages above. Application config/build code
imports framework composition APIs from `@evjs/ev`. File-convention application
source imports route data helpers from `@evjs/ev/route`, navigation helpers from `@evjs/ev/navigation`, query helpers from `@evjs/ev/query`, request helpers from
`@evjs/ev/server-context`, and custom server-function transport helpers from
`@evjs/ev/transport`. Browser-only CSR apps that own their build pipeline can
use `@evjs/client` without depending on `@evjs/ev`.
The `@evjs/ev/*` subpaths are curated around evjs file-convention authoring
semantics. They are not mirrors of `@evjs/client` or `@evjs/server`, which are
lower-level standalone/manual runtime packages.
Use `@evjs/cli` and `@evjs/create-app` as tools, not application imports.
Bundler adapters such as `@evjs/bundler-utoopack` and shared contract modules
such as `@evjs/shared` are only for custom framework tooling or adapter work.

Generated framework code resolves client and server runtime internals through
`@evjs/ev/_internal/*`, so ordinary file-convention apps do not install
`@evjs/client` or `@evjs/server` directly.

## Required Dependencies

```json
{
  "dependencies": {
    "@evjs/ev": "<same version>",
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
packages only when application source imports the standalone/manual runtime
surfaces directly. Scaffolded file-convention templates include `@evjs/ev` and
`@evjs/cli`; `@evjs/client` and `@evjs/server` are runtime dependencies of
`@evjs/ev` for generated framework code. If you add adapter packages, upgrade
them together with the rest of the framework packages.

:::

## Key Rules

- Config file: `ev.config.ts` (not `evjs.config.ts`)
- Import `defineConfig` from `@evjs/ev`.
- HTML must have `<div id="app">` for the render target
- Do NOT add `"type": "module"` to your **project's** `package.json` — the server bundle uses CJS format
- Prefer `src/pages` as the route source of truth.
- Keep `src/route-types.d.ts` generated and ignored; do not import it.
- Use `routing.mode: "mpa"` for independent pages without a client router.
