# Configuration

evjs is zero-config by default. Create `ev.config.ts` when an app needs to
customize routing, page outputs, framework server paths, remotes, plugins, or a
non-default bundler.

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

## Defaults

| Setting | Default |
|---------|---------|
| `entry` | `./src/main.tsx` |
| `html` | `./index.html` |
| `routing.mode` | `spa` |
| `dev.port` | `3000` |
| `server.dev.port` | `3001` |
| `server.basePath` | `/__evjs` |
| server function endpoint | `${server.basePath}/fn` |

The server function endpoint is derived from `server.basePath`; there is no separate public function-endpoint config.

## Routing

`src/pages` is the primary client-routing model. SPA mode builds one
framework-owned app from those page files:

```ts
export default defineConfig({
  routing: {
    mode: "spa",
    dir: "./src/pages",
    mount: "#app",
  },
});
```

MPA mode uses the same files but emits one independent page per route without a
client router:

```ts
export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

When `src/pages` exists and the project does not declare explicit `app`,
`pages`, or `remote` config, SPA routing is enabled automatically.

Use top-level `entry` / `html` only for a manually bootstrapped single app:

```ts
export default defineConfig({
  entry: "./src/main.tsx",
  html: "./index.html",
});
```

## Pages

`pages` is the explicit lower-level API for independent page outputs. Prefer
`routing: { mode: "mpa" }` when the page set maps directly to `src/pages`.
String pages and `{ entry }` pages are user-owned bootstraps:

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

### Page Module Static Exports

evjs reads these named static exports from framework-managed page modules. Use
literal values so graph analysis can resolve them without executing user code.
Invalid literal values fail during app graph analysis before bundling.
PPR is not a separate `render` value; use `render = "ssr"` with
`prerender = { partial: true }`.

| Export | Values | Meaning |
| --- | --- | --- |
| `render` | `"csr"` | Client-rendered page. The page is mounted in the browser and does not create a server document renderer. This is the default when `render` is omitted. |
| `render` | `"ssr"` | Server-rendered document. The framework server renders HTML for the request, then the browser hydrates according to `hydrate`. Requires `server` to be enabled. |
| `render` | `"ssg"` | Static document intent. The manifest marks the page as fully prerendered/static, and the default hydration mode is `none`. Deployment adapters can serve it as static HTML when no dynamic server capability is required. |
| `hydrate` | `"none"` | Do not hydrate the whole page in the browser. Use this for static pages, RSC documents, or PPR shells where interactivity is modeled by explicit islands/regions. |
| `hydrate` | `"load"` | Hydrate after the page runtime loads. This is the default for non-SSG server-rendered pages. |
| `hydrate` | `"visible"` | Declare that hydration may wait until the mount point is visible. Runtimes/adapters that do not implement visibility scheduling may fall back to `load`. |
| `hydrate` | `"idle"` | Declare that hydration may wait for an idle browser period. Runtimes/adapters that do not implement idle scheduling may fall back to `load`. |
| `prerender` | `true` | Mark the page as prerenderable without enabling partial prerendering. |
| `prerender` | `{ partial: true }` | Enable PPR. The framework derives dynamic regions from `Suspense` + `lazy(() => import(...))` boundaries in the page tree. |
| `prerender.delivery` | `"merge"` | Non-streaming PPR delivery. The server resolves shell and regions, then returns one complete HTML response. This is the default for partial prerendering. |
| `prerender.delivery` | `"stream"` | Streaming PPR delivery. The server can flush the shell before all regions finish, then patch resolved regions into the same response. |
| `prerender.revalidate` | `number` | Declare a revalidation interval, in seconds, for prerendered output. |
| `prerender.revalidate` | `false` | Declare that the prerendered output should not revalidate automatically. |
| `rsc` | `true` | Enable the RSC page path. Use with `render = "ssr"` and `hydrate = "none"`. Requires `server.rsc` support from the active bundler/server adapter. |

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

Region modules can declare these static exports:

| Export | Values | Meaning |
| --- | --- | --- |
| `cache` | `"no-store"` | Always render the region dynamically. Use this for request-specific or user-specific data. |
| `cache` | `{ revalidate: number }` | Cache the region output and revalidate after the given number of seconds. |
| `hydrate` | `"none"` | Do not hydrate the region in the browser. This is the default when the region is server-only. |
| `hydrate` | `"load"` | Hydrate the region once its client runtime loads. |
| `hydrate` | `"visible"` | Declare visibility-based region hydration. Unsupported runtimes may fall back to `load`. |
| `hydrate` | `"idle"` | Declare idle-time region hydration. Unsupported runtimes may fall back to `load`. |

`prerender.delivery` controls the initial document response. `"merge"` is the
default non-streaming mode: the framework server renders the shell and regions,
then returns one complete HTML response. `"stream"` sends the shell first and
then patches resolved regions into the same document response. Neither mode
requires the browser to fetch `/__evjs/ppr` during initial navigation.

PPR pages are server-composed and do not create a full-page client hydration
entry. Interactive PPR work should be modeled as explicit client islands or
region-level hydration instead of hydrating the whole page shell.

RSC pages use SSR document rendering with an explicit RSC flag:

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
export const rsc = true;
export const hydrate = "none";

export default function InsightsPage() {
  return <main>Insights</main>;
}
```

The current webpack validation adapter exercises the full RSC request path. The
default Utoopack adapter still needs equivalent client/server reference metadata
before it can run the same path.

`react-server-dom-webpack` is an optional peer dependency of the evjs client and
server runtimes. Install it in applications that use RSC directly, or use a
bundler/server adapter that provides the RSC runtime path.

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
