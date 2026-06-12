# Project Structure

evjs applications should use file routes as the default client boundary. For
documentation and new applications, use one complete structure and delete
folders that the app does not need yet.

## Recommended Structure

```text
my-evjs-app/
├── ev.config.ts                 # framework config
├── index.html                   # shared HTML template with <div id="app">
├── package.json
├── public/                      # copied static files
├── tsconfig.json
└── src/
    ├── server.ts                # framework/server entry
    ├── styles.css               # global CSS / Tailwind entry
    ├── pages/                   # file routes
    │   ├── __root.tsx           # optional SPA root layout
    │   ├── index.tsx            # /
    │   ├── dashboard.tsx        # /dashboard
    │   ├── campaign.tsx         # /campaign
    │   ├── insights.tsx         # /insights
    │   └── users/$userId.tsx    # /users/$userId
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

- `ev.config.ts` customizes file-route mode, server paths, remotes, plugins, or
  explicit page outputs only when defaults are not enough.
- `pages/` is the client route source of truth. SPA mode maps it to an internal
  TanStack Router tree; MPA mode maps it to independent page entries.
- Rendering metadata lives with page modules.
- `api/*.server.ts` contains server functions.
- `api/*.routes.ts` contains standard HTTP route handlers.
- `server.ts` composes `@evjs/server` routes, middleware, and framework rendering.
- `features/` keeps domain logic out of route/page files.

## Matching Config

The matching `ev.config.ts` can stay small:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  fileRoutes: {
    mode: "spa",
    dir: "./src/pages",
    mount: "#app",
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

Use `fileRoutes: { mode: "mpa" }` when every route should be emitted as its own
HTML document without TanStack Router. Use the lower-level `pages` config only
for page outputs that do not map cleanly to `src/pages`.

## Page Modules

Each file under `src/pages` default-exports a React component. Dynamic segments
use `$param`, and `index.tsx` maps to the directory root. Rendering metadata
belongs with the page component:

```tsx
// src/pages/campaign.tsx
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

Page files should stay thin. Read params/search, export page-local loader or
rendering metadata, and compose components from `features/` or `components/`.
Business logic belongs in domain modules.

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

- `pages/` is the file-route source folder and can include SSR/PPR/RSC components.
- `api/` is the server boundary.
- `features/` owns business domains.
- `components/` owns generic UI.
- `lib/` contains browser-safe shared helpers.
- Keep server secrets and Node-only APIs in `api/` or modules imported only by
  server-only code.
