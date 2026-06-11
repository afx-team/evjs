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
│   ├── main.tsx            # App bootstrap
│   ├── pages/              # TanStack route modules or app pages
│   │   ├── __root.tsx      # Root layout
│   │   └── home.tsx        # Home route
│   └── api/                # Server-only modules
│       ├── users.server.ts # "use server" functions
│       └── health.routes.ts
├── package.json
└── tsconfig.json
```

## App Bootstrap With TanStack Router

```tsx
// src/main.tsx
import { createApp } from "@evjs/client";
import { rootRoute } from "./pages/__root";
import { homeRoute } from "./pages/home";
import "./global";

const routeTree = rootRoute.addChildren([homeRoute]);
const app = createApp({ routeTree });

declare module "@evjs/client" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
```

TanStack Router is the default template path because it gives strong route
typing and loader integration. New architecture features can also be expressed
through framework route declarations or standalone `pages`.

## TanStack-Free Route Declaration

For an app that should not use TanStack Router, declare the app boundary and
framework routes in one app declaration source:

```ts
// src/app.tsx
import { defineReactApp, route } from "@evjs/client";
import Campaign from "./pages/Campaign";
import Dashboard from "./pages/Dashboard";

function App() {
  return <main>Operations console</main>;
}

export default defineReactApp({
  html: "../index.html",
  mount: "#app",
  component: App,
  routes: [
    route("/dashboard", Dashboard, {
      id: "dashboard",
    }),
    route("/campaign", Campaign, {
      id: "campaign",
    }),
  ],
});
```

```tsx
// src/pages/Dashboard.tsx
export const render = "ssr";
export const hydrate = "load";

export default function Dashboard() {
  return <main>Server-rendered dashboard</main>;
}
```

```tsx
// src/pages/Campaign.tsx
import { Suspense } from "react";
import { OfferRegion } from "./OfferRegion";
import { OfferSkeleton } from "./OfferSkeleton";

export const render = "ssr";
export const hydrate = "none";
export const prerender = {
  partial: true,
  delivery: "stream",
} as const;

export default function Campaign() {
  return (
    <main>
      <Suspense fallback={<OfferSkeleton />}>
        <OfferRegion />
      </Suspense>
    </main>
  );
}
```

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  app: "./src/app.tsx",
});
```

The app declaration source is the graph source for build-time analysis. Route
groups can still be split into imported files, but `ev.config.ts` only points at
the app boundary.

## Packages

| Package | Purpose |
|---------|---------|
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | Framework API, config, plugins, and build orchestration (`defineConfig`, `dev`, `build`) |
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | Thin CLI wrapper (`ev dev`, `ev build`) with the default bundler |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | Project scaffolding (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | Browser runtime, transport, page runtime, shell exports, static route helpers, and TanStack compatibility |
| [`@evjs/server`](https://github.com/evaijs/evjs/tree/main/packages/server) | Hono/fetch server runtime, server functions, routes, and SSR/PPR/RSC request handling |

Manifest schemas, build tools, page runtime, shell, and route DSL are internal
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
- `src/main.tsx` should be minimal. Put app graph declarations in `src/app.tsx`
  or route/page modules imported by it.
- Use `pages` for standalone page outputs. Use `app` for the SPA declaration
  boundary.
