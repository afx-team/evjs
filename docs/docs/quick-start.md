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
| `with-tailwind` | Tailwind CSS via plugin loaders |
| `with-trpc` | tRPC interop example |
| `with-sqlite` | Full-stack CRUD with SQLite |
| `custom-ws-transport` | Custom WebSocket transport |
| `plugin-authoring` | Plugin lifecycle and bundler hook examples |

## Development

```bash
ev dev
```

Your browser opens to `http://localhost:3000` with Hot Module Replacement. Server functions in `*.server.ts` files are auto-discovered — no config needed.

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
│   ├── main.tsx            # App bootstrap
│   ├── global.ts           # Global typings & transport init
│   ├── pages/              # Route modules (code-defined TanStack Router tree)
│   │   ├── __root.tsx      # Root layout
│   │   └── home.tsx        # Home page (index route)
│   └── api/                # Server function files
│       └── *.server.ts
├── package.json
└── tsconfig.json
```

## App Bootstrap

```tsx
// src/main.tsx
import { createApp } from "@evjs/client";
import { rootRoute } from "./pages/__root";
import { homeRoute } from "./pages/home";
import "./global";

const routeTree = rootRoute.addChildren([homeRoute]);
const app = createApp({ routeTree });
app.render("#app");
```

```ts
// src/global.ts
declare module "@evjs/client" {
  interface Register {
    router: any;
  }
}
```

## Packages

| Package | Purpose |
|---------|---------|
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | Framework API, config, plugins, and build orchestration (`defineConfig`, `dev`, `build`) |
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | Thin CLI wrapper (`ev dev`, `ev build`) with the default bundler |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | Project scaffolding (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | Client runtime (React + TanStack) |
| [`@evjs/server`](https://github.com/evaijs/evjs/tree/main/packages/server) | Server runtime (Hono) |
| [`@evjs/build-tools`](https://github.com/evaijs/evjs/tree/main/packages/build-tools) | Server function transforms |
| [`@evjs/bundler-utoopack`](https://github.com/evaijs/evjs/tree/main/packages/bundler-utoopack) | Utoopack adapter |
| [`@evjs/manifest`](https://github.com/evaijs/evjs/tree/main/packages/manifest) | Shared manifest schema |

## Required Dependencies

```json
{
  "dependencies": {
    "@evjs/client": "^0.1.9",
    "@evjs/server": "^0.1.9",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@evjs/ev": "^0.1.9",
    "@evjs/cli": "^0.1.9",
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
- `src/main.tsx` should be minimal — define routes in `pages/`
