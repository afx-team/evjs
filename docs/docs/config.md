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

PPR pages declare dynamic regions explicitly:

```ts
export default defineConfig({
  pages: {
    campaign: {
      path: "/campaign",
      component: "./src/pages/campaign/Page.tsx",
      render: "ppr",
      ppr: {
        regions: {
          offer: {
            component: "./src/pages/campaign/Offer.region.tsx",
            cache: "no-store",
          },
          inventory: {
            component: "./src/pages/campaign/Inventory.region.tsx",
            cache: { revalidate: 60 },
          },
        },
      },
    },
  },
});
```

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

Configure the framework server boundary with `server.basePath`:

```ts
export default defineConfig({
  server: {
    entry: "./src/server.ts",
    basePath: "/_framework",
    dev: {
      port: 3001,
      https: false,
    },
  },
});
```

Derived runtime paths:

```txt
/_framework/fn       server functions
/_framework/ppr      PPR region endpoint when PPR pages exist
/_framework/rsc      RSC Flight endpoint when server.rsc is enabled
```

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
