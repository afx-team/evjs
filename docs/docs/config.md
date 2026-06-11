# Configuration

evjs is zero-config by default. Create `ev.config.ts` when an app needs explicit entries, pages, framework server paths, remotes, plugins, or a non-default bundler.

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  entry: "./src/main.tsx",
  html: "./index.html",
});
```

## Defaults

| Setting | Default |
|---------|---------|
| `entry` | `./src/main.tsx` |
| `html` | `./index.html` |
| `dev.port` | `3000` |
| `server.dev.port` | `3001` |
| `server.basePath` | `/__evjs` |
| server function endpoint | `${server.basePath}/fn` |

The server function endpoint is derived from `server.basePath`; there is no separate public function-endpoint config.

## Applications

Use top-level `entry` / `html` for a single app:

```ts
export default defineConfig({
  entry: "./src/main.tsx",
  html: "./index.html",
});
```

Use `app` when the SPA has its own declaration source, mount point, or
framework-managed route/page modules:

```ts
export default defineConfig({
  app: "./src/console/app.tsx",
});
```

```ts
// src/console/app.tsx
import { defineReactApp } from "@evjs/client";
import { operationsRoutes } from "./routes/operations";

function ConsoleApp() {
  return <main>Console</main>;
}

export default defineReactApp({
  html: "./index.html",
  mount: "#app",
  component: ConsoleApp,
  routes: [...operationsRoutes],
});
```

The app declaration source owns the app entry, `html`, `mount`, and route
groups, so app configuration does not split across `ev.config.ts` and route
files. Add `entry: "./main.tsx"` only when you intentionally want a separate
runtime entry. The lower-level object form remains available when a tool wants
to generate config directly:

```ts
export default defineConfig({
  app: {
    entry: "./src/console/main.tsx",
    html: "./src/console/index.html",
    mount: "#app",
  },
});
```

Router plugins, such as the TanStack adapter, should register adapter behavior
and should not own app route paths.

## Pages

`pages` declares independent page outputs. String pages and `{ entry }` pages are user-owned bootstraps:

```ts
export default defineConfig({
  pages: {
    home: "./src/pages/home/main.tsx",
    about: {
      entry: "./src/pages/about/main.tsx",
      html: "./src/pages/about/index.html",
    },
  },
});
```

Framework-managed component pages let evjs own mount/hydrate through the page runtime:

```ts
export default defineConfig({
  pages: {
    dashboard: {
      path: "/dashboard",
      component: "./src/pages/dashboard/Page.tsx",
      html: "./src/pages/public.html",
      mount: "#app",
    },
  },
});
```

```tsx
// src/pages/dashboard/Page.tsx
export const render = "ssr";
export const hydrate = "load";

export default function DashboardPage() {
  return <main>Dashboard</main>;
}
```

When `path` is present, the page also contributes a framework route. Use this for SSR, SSG, PPR, and other framework-served pages so URL and component stay in config while rendering metadata stays with the component module. If `path` is omitted, the page is emitted as an HTML document such as `campaign.html`.

PPR pages should declare dynamic regions in the page component tree:

```ts
export default defineConfig({
  pages: {
    campaign: {
      path: "/campaign",
      component: "./src/pages/campaign/Page.tsx",
    },
  },
});
```

```tsx
import { lazy, Suspense } from "react";

const OfferRegion = lazy(() => import("./Offer.region"));

export const render = "ssr";
export const hydrate = "none";
export const prerender = {
  partial: true,
  delivery: "stream",
} as const;

export default function CampaignPage() {
  return (
    <Suspense fallback={<p>Loading</p>}>
      <OfferRegion />
    </Suspense>
  );
}
```

```tsx
// ./Offer.region.tsx
export const cache = { revalidate: 60 } as const;

export default function OfferRegion() {
  return <section>Live offer inventory</section>;
}
```

The framework analyzes the page module and turns Suspense lazy boundaries into
internal region renderers. Region ids are derived from the lazy component name,
so `OfferRegion` becomes `offer`.

`prerender.delivery` controls the initial document response. `"merge"` is the
default non-streaming mode: the framework server renders the shell and regions,
then returns one complete HTML response. `"stream"` sends the shell first and
then patches resolved regions into the same document response. Neither mode
requires the browser to fetch `/__evjs/ppr` during initial navigation.

PPR pages are server-composed and do not create a full-page client hydration
entry. Interactive PPR work should be modeled as explicit client islands or
region-level hydration instead of hydrating the whole page shell.

RSC pages use SSR document rendering with the RSC component model:

```ts
export default defineConfig({
  pages: {
    insights: {
      path: "/insights",
      component: "./src/pages/Insights.tsx",
    },
  },
  server: {
    rsc: true,
  },
});
```

```tsx
// src/pages/Insights.tsx
export const render = "ssr";
export const componentModel = "rsc";
export const hydrate = "none";

export default function InsightsPage() {
  return <main>Insights</main>;
}
```

The current webpack validation adapter exercises the full RSC request path. The
default Utoopack adapter still needs equivalent client/server reference metadata
before it can run the same path.

## Server

Set `server: false` for CSR-only output:

```ts
export default defineConfig({ server: false });
```

When `server: false`:

- build output is flat `dist/`;
- `"use server"` modules are build errors;
- no framework server proxy is configured in dev.

The framework server boundary defaults to `/__evjs`. Configure
`server.basePath` only when a deployment platform requires a different path:

```ts
export default defineConfig({
  server: {
    entry: "./src/server.ts",
    dev: {
      port: 3001,
      https: false,
    },
  },
});
```

Derived runtime paths:

```txt
/__evjs/fn       server functions
/__evjs/ppr      PPR region direct/debug endpoint when PPR pages exist
/__evjs/rsc      RSC Flight endpoint when server.rsc is enabled
```

PPR page loads do not require the browser to call `/__evjs/ppr`; the framework
server resolves declared regions while serving the page route.

Use `transport.baseUrl` only when the browser calls a framework server on another origin:

```ts
export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

## Remotes

Remote apps are manifest-driven:

```ts
export default defineConfig({
  remotes: {
    crm: {
      manifest: "https://assets.example.com/crm/manifest.json",
      activeWhen: ["/app/crm/*"],
    },
  },
});
```

## Plugins

```ts
export default defineConfig({
  plugins: [
    {
      name: "build-timer",
      setup() {
        const start = Date.now();
        return {
          buildEnd({ output }) {
            console.log("Build", output.buildId, Date.now() - start);
          },
        };
      },
    },
  ],
});
```

See the [Plugins guide](./plugins.md) for hook signatures, per-document HTML context, and bundler helpers.

## Bundler

The CLI uses Utoopack by default. You can pass an adapter explicitly:

```ts
import { defineConfig } from "@evjs/ev";
import { utoopackAdapter } from "@evjs/bundler-utoopack";

export default defineConfig({
  bundler: utoopackAdapter,
});
```

`@evjs/bundler-webpack` exists for framework validation while Utoopack lower-layer APIs catch up. Utoopack remains the default runtime path.
