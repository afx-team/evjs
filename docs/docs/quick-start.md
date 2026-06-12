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
| `complex-routing` | Params, search, layouts, loaders, nested routes |
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
├── index.html              # HTML template (must have <div id="app">)
├── ev.config.ts            # Optional config
├── src/
│   ├── pages/              # File routes
│   │   ├── __root.tsx      # Root layout
│   │   ├── index.tsx       # /
│   │   └── users/$id.tsx   # /users/$id
│   └── api/                # Server-only modules
│       ├── users.server.ts # "use server" functions
│       └── health.routes.ts
├── package.json
└── tsconfig.json
```

## File Routes

```tsx
// src/pages/users/$id.tsx
import { definePage, getFnQueryOptions, useQuery } from "@evjs/client";
import { getUser } from "../../api/users.server";

export const loader = ({ params, context }) =>
  context.queryClient.ensureQueryData(getFnQueryOptions(getUser, params.id));

export default definePage<{ id: string }>(function UserPage({ params }) {
  const { data } = useQuery(getUser, params.id);
  return <main>{data?.name}</main>;
});
```

When `src/pages` exists and `src/main.tsx` does not, evjs automatically builds a
TanStack Router-backed SPA from the file tree. Router objects, route trees, and
global router registrations stay inside the framework.

## MPA Mode

Use the same `src/pages` files for an MPA and switch the file-route mode:

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  fileRoutes: {
    mode: "mpa",
  },
});
```

Each page is emitted as its own HTML document and client entry without
TanStack Router.

## Packages

| Package | Purpose |
|---------|---------|
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | Framework API, config, plugins, and build orchestration (`defineConfig`, `dev`, `build`) |
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | Thin CLI wrapper (`ev dev`, `ev build`) with the default bundler |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | Project scaffolding (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | Browser runtime, transport, page runtime, shell exports, and page helpers |
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
- Use `fileRoutes.mode: "mpa"` for independent pages without a client router.
