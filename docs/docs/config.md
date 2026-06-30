# Configuration

evjs is zero-config by default. Most apps only add `ev.config.ts` to choose SPA
or MPA routing, customize server file routes, or adjust deployment-facing paths.

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

## Defaults And Scope

| Setting | Default / behavior |
| --- | --- |
| `html` | `./index.html` as the shared template for an explicit app or conventional page routing. MPA routes can also use colocated `.html` templates. |
| `dev.port` | `3000` |
| `dev.https` | `false` |
| `server.dev.port` | `3001` |
| `server.dev.https` | `false` |
| `server.basePath` | `/__evjs` |
| `routing.mode` | `spa` |
| `routing.dir` | `./src/pages` when `routing` is enabled |
| `routing.mount` | `#app` |
| `server.routing` | `true`; scans `./src/apis` by default and drops out when no route modules exist |
| `server.routing.dir` | `./src/apis` |
| `output.client` | `dist/client` |
| `output.server` | `dist/server` |
| `output.crossOriginLoading` | `"anonymous"` |

Server function, PPR, and RSC runtime paths are derived from
`server.basePath`. There is no separate public `server.functions` or function
endpoint config.

There is no top-level `entry` config. Conventional file routing creates the
page app entry internally; manually bootstrapped SPAs use `app.entry`.

## Common Configs

For a conventional SPA using `src/pages`, config can stay minimal:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

For MPA output, keep the same `src/pages` files and switch the mode:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

Server file routes under `src/apis` are discovered by default. Configure
`server.routing.dir` only when the route directory should live somewhere else.

Only spell out fields you want to change:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  dev: {
    port: 4000,
  },
  server: {
    dev: {
      port: 4001,
    },
  },
});
```

## Routing

`routing` owns client page discovery from `src/pages`:

```ts
export default defineConfig({
  routing: {
    mode: "spa",
    dir: "./src/pages",
    mount: "#app",
  },
});
```

When `src/pages` exists and the project does not declare explicit `app` or
`pages` config, SPA routing is enabled automatically.

In SPA routing mode, the browser entry is generated from the discovered page
tree. Use `app.entry` only when the app intentionally uses an explicit SPA
bootstrap instead of file routing.

SPA root layout discovery looks for `layout/index.tsx` beside the route
directory, such as `src/layout/index.tsx` for `src/pages`. Use
`routing.conventions.layout` only when the shell intentionally lives elsewhere:

```ts
export default defineConfig({
  routing: {
    conventions: {
      layout: "./src/shell/AppLayout.tsx",
    },
  },
});
```

Layout conventions are SPA-only; MPA pages should compose shared React
components or reuse HTML templates.

MPA file routes can use colocated HTML templates. For example,
`src/pages/about.html` is used by `src/pages/about.tsx`, and
`src/pages/product/index.html` is used by `src/pages/product/index.tsx`. Routes
without a colocated template use the top-level `html` template unless you set
`routing.html`.

## Pages

Prefer `routing` for normal file-based SPA/MPA apps. Use `pages` only when an
output cannot be expressed by the `src/pages` directory shape.

String values and `{ component }` values are evjs-managed React pages:

```ts
export default defineConfig({
  pages: {
    home: "./src/pages/Home.tsx",
    dashboard: {
      path: "/dashboard",
      component: "./src/pages/dashboard/Page.tsx",
      html: "./src/pages/public.html",
      mount: "#app",
    },
  },
});
```

Use `{ entry }` only when a page owns its own browser bootstrap:

```ts
export default defineConfig({
  pages: {
    landing: {
      entry: "./src/landing/main.tsx",
      html: "./src/landing/index.html",
    },
  },
});
```

Component page objects may declare render metadata directly:

```ts
export default defineConfig({
  pages: {
    campaign: {
      path: "/campaign",
      component: "./src/pages/campaign/Page.tsx",
      render: "ssr",
      hydrate: "load",
    },
  },
});
```

The same metadata can live in the component module as literal exports:

```tsx
export const render = "ssr";
export const hydrate = "load";

export default function CampaignPage() {
  return <main>Campaign</main>;
}
```

## Explicit App

Use `app.entry` only for a manually bootstrapped SPA:

```ts
export default defineConfig({
  app: {
    entry: "./src/main.tsx",
    html: "./index.html",
  },
});
```

## Server

`server.basePath` controls the server runtime boundary. Keep the default unless
your deployment platform requires a fixed path:

```ts
export default defineConfig({
  server: {
    basePath: "/__evjs",
  },
});
```

Server file routes are enabled by default and scan `./src/apis`. Object form
currently supports `dir`; there is no `prefix` option. Put files under a folder
such as `src/apis/api` when URLs should start with `/api`.

Server middleware conventions are enabled by default with server file-route
discovery:

- `src/middleware.ts` for global server middleware.
- `src/apis/**/middleware.ts` for API route middleware scoped to descendant
  server file routes.

Enable React Server Components support with `server.rsc: true`:

```ts
export default defineConfig({
  server: {
    rsc: true,
  },
});
```

## Dev Server

The browser dev server defaults to port `3000`; the server dev runtime defaults
to port `3001`:

```ts
export default defineConfig({
  dev: {
    port: 4000,
  },
  server: {
    dev: {
      port: 4001,
    },
  },
});
```

`dev.https` and `server.dev.https` accept `false`, `true`, or an object with
`key` and `cert`.

Add `dev.proxy` for your own backend services:

```ts
export default defineConfig({
  dev: {
    proxy: [
      {
        context: ["/api"],
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    ],
  },
});
```

## Output

By default evjs writes browser assets to `dist/client` and server artifacts to
`dist/server`. Change these when a deployment platform expects another layout:

```ts
export default defineConfig({
  output: {
    client: "dist",
    server: "dist-server",
  },
});
```

`output.crossOriginLoading` controls the `crossorigin` attribute evjs adds to
generated JavaScript and CSS tags. It accepts `false`, `"anonymous"`, or
`"use-credentials"`.

## Transport

Same-origin apps do not need transport config. Set `transport.baseUrl` only when
the browser talks to the server runtime on another origin:

```ts
export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

## Plugins

Register framework plugins with `plugins`:

```ts
export default defineConfig({
  plugins: [
    {
      name: "build-timer",
      setup() {
        const start = Date.now();
        return {
          buildEnd() {
            console.log("Build finished", Date.now() - start);
          },
        };
      },
    },
  ],
});
```

See the [Plugins guide](./plugins) for hook signatures, per-document HTML
context, and bundler helpers.

## Bundler

Utoopack is the default. Pass a bundler adapter only when you intentionally need
to switch:

```ts
import { defineConfig } from "@evjs/ev";
import { utoopackAdapter } from "@evjs/bundler-utoopack";

export default defineConfig({
  bundler: utoopackAdapter,
});
```

## Unsupported Old Fields

These are intentionally not public config fields:

- `server.entry`
- `server.functions`
- `server.functionRuntime`
- `routing.routes`
- `routing.entry`
- top-level `functions` or `serverFunctions`

Use `server.routing.dir` to customize the server file-route directory,
`"use server"` modules for server functions, `server.basePath` for server
runtime paths, and `pages` for explicit page outputs.
