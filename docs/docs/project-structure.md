# Project Structure

evjs does not require file-based routing or a large scaffold. For documentation
and new applications, use one complete structure and delete folders that the app
does not need yet.

## Recommended Structure

```text
my-evjs-app/
├── ev.config.ts                 # framework config
├── index.html                   # shared HTML template with <div id="app">
├── package.json
├── public/                      # copied static files
├── tsconfig.json
└── src/
    ├── app.tsx                  # primary app declaration and client entry
    ├── routes/
    │   ├── operations.ts        # operations route group
    │   └── engagement.ts        # engagement route group
    ├── server.ts                # framework/server entry
    ├── styles.css               # global CSS / Tailwind entry
    ├── pages/                   # route/page components
    │   ├── Dashboard.tsx        # SSR route/page component
    │   ├── Campaign.tsx         # PPR route/page shell
    │   ├── OfferRegion.tsx      # Suspense-driven PPR region
    │   ├── Insights.tsx         # RSC route/page component
    │   ├── Support.tsx          # CSR standalone page
    │   └── RemoteApp.tsx        # remote host page
    ├── api/
    │   ├── operators.server.ts  # "use server" functions
    │   └── health.routes.ts     # Request/Response route handlers
    ├── components/              # reusable UI
    ├── features/                # domain modules
    │   └── operations/
    │       ├── components/
    │       ├── hooks/
    │       ├── model.ts
    │       └── types.ts
    ├── lib/                     # browser-safe shared helpers
    └── hooks/                   # app-wide React hooks
```

This shape covers the complete framework surface:

- `ev.config.ts` points the SPA app at one app declaration source.
- `app.tsx` owns the app document, client entry, mount point, and route groups.
- Route groups such as `routes/operations.ts` own path-to-component wiring and
  are imported by `app.tsx`, not configured separately.
- `pages/` contains React components used by app routes or standalone pages.
  Rendering metadata lives with those page modules.
- `api/*.server.ts` contains server functions.
- `api/*.routes.ts` contains standard HTTP route handlers.
- `server.ts` composes `@evjs/server` routes, middleware, and framework rendering.
- `features/` keeps domain logic out of route/page files.

## Matching Config

The matching `ev.config.ts` keeps application boundaries explicit:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  html: "./index.html",
  app: "./src/app.tsx",

  pages: {
    support: {
      path: "/support",
      component: "./src/pages/Support.tsx",
      mount: "#app",
    },
  },

  server: {
    entry: "./src/server.ts",
    rsc: true,
  },

  remotes: {
    crm: {
      manifest: "https://assets.example.com/crm/evjs-remote.json",
      activeWhen: ["/crm/*"],
    },
  },
});
```

`entry` / `html` can still be used as a shorthand for a single simple app, but
new applications should prefer `app` once the app has route declarations,
framework-managed rendering, or a non-default mount point. `pages` is for
standalone page outputs, not app-owned routes such as `/dashboard`,
`/campaign`, or `/insights`.

## App Declaration

An app declaration can be TanStack Router based or TanStack-free. For
framework-managed rendering without TanStack Router, use `defineReactApp()`:

```ts
// src/app.tsx
import { defineReactApp } from "@evjs/client";
import { engagementRoutes } from "./routes/engagement";
import { operationsRoutes } from "./routes/operations";
import "./styles.css";

function App() {
  return <main>Operations console</main>;
}

export default defineReactApp({
  html: "../index.html",
  mount: "#app",
  component: App,
  routes: [...operationsRoutes, ...engagementRoutes],
});
```

```ts
// src/routes/operations.ts
import { route } from "@evjs/client";
import Dashboard from "../pages/Dashboard";
import Insights from "../pages/Insights";

export const operationsRoutes = [
  route("/dashboard", Dashboard, {
    id: "dashboard",
  }),
  route("/insights", Insights, {
    id: "insights",
  }),
];
```

```ts
// src/routes/engagement.ts
import { route } from "@evjs/client";
import Campaign from "../pages/Campaign";

export const engagementRoutes = [
  route("/campaign", Campaign, {
    id: "campaign",
  }),
];
```

`defineReactApp()` is the app boundary and, when `component` or `render` is
provided, the browser entry. Feature modules own the actual `route()` calls, so
large apps can split route groups by domain without splitting app configuration
across `ev.config.ts` and route files. Route targets are ordinary static React
imports, so the graph stays analyzable without making users write component
module path strings. Rendering metadata belongs with the page component:

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

If an app intentionally needs a generated or separate runtime entry, add
`entry: "./main.tsx"` to the declaration. That is an escape hatch, not the
default app model.

Route files should stay thin. Read params/search, wire paths to components, and
compose components from `features/` or `components/`. Put render metadata next
to the page component and business logic in domain modules.

## Server Boundary

Put server-only code under `src/api/` by default.

```ts
// src/api/operators.server.ts
"use server";

export async function listOperators() {
  return [{ id: "ada", name: "Ada Lovelace" }];
}
```

```ts
// src/api/health.routes.ts
import { createRoute } from "@evjs/server";

export const healthRoute = createRoute("/api/health", {
  GET: async () => Response.json({ ok: true }),
});
```

Mount routes and framework rendering in `src/server.ts`:

```ts
import { createApp, requestLogger } from "@evjs/server";
import { createReactFrameworkServer } from "@evjs/server/react";
import { healthRoute } from "./api/health.routes";

const framework = createReactFrameworkServer();

const app = createApp({
  middlewares: [requestLogger()],
  routes: [healthRoute],
  framework,
});

export default { fetch: app.fetch };
```

## Remote Builds

Host applications consume remotes through `remotes`. A package that is itself a
remote app declares `remote` in its config and can reuse the same `src/`
organization:

```ts
export default defineConfig({
  remote: {
    name: "crm",
    baseUrl: "https://assets.example.com/crm/",
    entries: {
      default: {
        app: "./src/remote.tsx",
        activeWhen: ["/crm/*"],
      },
    },
  },
});
```

Remote modules can default-export React components. Explicit `mount`,
`hydrate`, and `unmount` lifecycle exports are only needed for advanced cases.

## Naming Guidance

- `apps/` is for additional application entries, not for every page.
- `pages/` is for route/page components, including SSR/PPR/RSC components.
- `api/` is the server boundary.
- `features/` owns business domains.
- `components/` owns generic UI.
- `lib/` contains browser-safe shared helpers.
- Keep server secrets and Node-only APIs in `api/` or modules imported only by
  server-only code.
