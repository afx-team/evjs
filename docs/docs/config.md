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

Use `apps` when the app boundary has its own runtime entry, mount point, or real route source:

```ts
export default defineConfig({
  apps: {
    console: {
      entry: "./src/console/main.tsx",
      html: "./src/console/index.html",
      routes: "./src/console/routes.tsx",
      mount: "#app",
    },
  },
});
```

`apps.*.routes` points to the same route module your runtime imports. Router plugins, such as the TanStack adapter, should register adapter behavior and should not own app route paths.

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
    campaign: {
      path: "/campaign",
      component: "./src/pages/campaign/Page.tsx",
      html: "./src/pages/public.html",
      render: "ssr",
      hydrate: "load",
      mount: "#app",
    },
  },
});
```

When `path` is present, the page also contributes a framework route. Use this for SSR, SSG, PPR, and other framework-served pages so URL, component, render mode, and hydration stay in one declaration. If `path` is omitted, the page is emitted as an HTML document such as `campaign.html`.

PPR pages should declare dynamic regions in the page component tree:

```ts
export default defineConfig({
  pages: {
    campaign: {
      path: "/campaign",
      component: "./src/pages/campaign/Page.tsx",
      render: "ppr",
      ppr: {
        delivery: "stream",
      },
    },
  },
});
```

```tsx
import { lazy, Suspense } from "react";

const OfferRegion = lazy(() => import("./Offer.region"));

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
export const PPR = {
  cache: { revalidate: 60 },
} as const;

export default function OfferRegion() {
  return <section>Live offer inventory</section>;
}
```

The framework analyzes the page module and turns Suspense lazy boundaries into
internal region renderers. Region ids are derived from the lazy component name,
so `OfferRegion` becomes `offer`. `pages.*.ppr.regions` remains available as a
low-level escape hatch, but Suspense declarations are the preferred API.

`pages.*.ppr.delivery` controls the initial document response. `"merge"` is the
default non-streaming mode: the framework server renders the shell and regions,
then returns one complete HTML response. `"stream"` sends the shell first and
then patches resolved regions into the same document response. Neither mode
requires the browser to fetch `/__evjs/ppr` during initial navigation.

PPR pages are server-composed and do not create a full-page client hydration
entry. Interactive PPR work should be modeled as explicit client islands or
region-level hydration instead of hydrating the whole page shell.

`render: "rsc"` is reserved until the dedicated RSC transform/runtime adapter lands.

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
