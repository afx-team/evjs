# Configuration

Use `ev.config.ts` for application-wide choices. Page-specific metadata,
rendering, and plugin options belong in adjacent `page.config.ts` files.

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "spa" },
});
```

TypeScript configuration is recommended for completion and for typed
page-plugin settings.

## Top-level options

| Option | Purpose | Default |
| --- | --- | --- |
| `routing` | Enable canonical pages and select SPA or MPA | Not enabled until declared |
| `conventions` | Enable all framework file conventions | `true` |
| `dev` | Browser development server | Port `3000` |
| `server` | Server runtime, build resolution, and development server | Base path `/__evjs`, dev port `3001` |
| `transport` | Browser-to-server origin | Same origin |
| `target` | Production Android and iOS compatibility target | Bundler default |
| `polyfill` | External core-js source for an enabled target | Bundled core-js |
| `output` | Browser/server directories and asset CORS policy | `dist/client`, `dist/server` |
| `plugins` | Install and configure integrations | `[]` |
| `bundler` | Select a non-default bundler adapter | Utoopack from the CLI |
| `application` | Advanced explicit SPA route tree | Not set |

## Routing

Declaring `routing` enables the canonical `src/pages/**/page.*` tree:

```ts
export default defineConfig({
  routing: {
    mode: "spa",
    html: "./index.html",
    mount: "#app",
  },
});
```

| Field | Type | Meaning |
| --- | --- | --- |
| `mode` | `"spa" \| "mpa"` | Required navigation/document model |
| `html` | `string` | Shared HTML template; defaults to `./index.html` |
| `mount` | `string` | React mount selector; defaults to `#app` |

The page root is fixed at `src/pages`. SPA and MPA read the same page files.
See [Pages and Routing](./client-routes) for their capability differences.

## Page configuration

An optional `page.config.ts` sits beside one `page.*` anchor:

```ts title="src/pages/profile/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Profile",
  meta: {
    description: "View and update your profile.",
  },
  render: "ssr",
  hydrate: "load",
  plugins: {
    analytics: { channel: "profile" },
  },
});
```

| Field | Purpose |
| --- | --- |
| `title` | Static document title for the page |
| `meta` | String map emitted as named `<meta>` elements |
| `render` | `"csr"`, `"ssr"`, or `"ssg"` |
| `hydrate` | `"load"` or `"none"` for explicit SSR/SSG pages |
| `prerender` | Static or partial prerendering options |
| `rsc` | Enable RSC for an SSR page |
| `document.aliases` | Additional `.html` or `.htm` output paths for a page-owned static document |
| `plugins` | Static page options keyed by installed plugin id |

The default export must be static JSON data. Read [Rendering](./rendering) for
valid render/hydration combinations and [Using Plugins](./plugins) for plugin
scope.

## Development server

```ts
export default defineConfig({
  dev: {
    port: 4000,
    https: false,
    cliShortcuts: true,
    proxy: [
      {
        context: ["/backend"],
        target: "http://localhost:8080",
        pathRewrite: { "^/backend": "" },
        changeOrigin: true,
        secure: true,
      },
    ],
  },
  server: {
    dev: {
      port: 4001,
      https: false,
    },
  },
});
```

### `dev`

| Field | Type | Default |
| --- | --- | --- |
| `port` | `number` | `3000` |
| `https` | `boolean \| { key, cert }` | `false` |
| `proxy` | `DevProxyRule[]` | `[]` |
| `cliShortcuts` | `boolean` | `true` |

A proxy rule accepts `context`, `target`, optional `pathRewrite`,
`changeOrigin`, and `secure`. The default Utoopack adapter supports boolean
client HTTPS. Select the Webpack adapter when the client dev server requires a
custom key/certificate pair.

### `server.dev`

| Field | Type | Default |
| --- | --- | --- |
| `port` | `number` | `3001` |
| `https` | `false \| { key, cert }` | `false` |

The server requires an explicit key/certificate pair for HTTPS. See
[Local Development](./dev) for URLs, port fallback, and restart behavior.

## Server

```ts
export default defineConfig({
  server: {
    basePath: "/__evjs",
    rsc: {
      endpoint: "/__evjs/rsc",
    },
    resolve: {
      alias: {
        "server-sdk": "./src/server/sdk.ts",
      },
    },
    externals: {
      "native-addon": "commonjs native-addon",
    },
  },
});
```

| Field | Purpose |
| --- | --- |
| `basePath` | Prefix used for framework server-function, PPR, and RSC endpoints |
| `rsc.endpoint` | Override the RSC Flight endpoint; does not enable RSC by itself |
| `resolve.alias` | Module aliases for server build entries only |
| `externals` | External module requests for server build entries only |
| `dev` | Server development port and HTTPS |

`basePath` defaults to `/__evjs`. Keep the default unless a host or reverse
proxy reserves it. Runtime paths must be absolute static URL paths; dynamic
segments, wildcards, percent escapes, and `.`/`..` segments are invalid.

Enable RSC in a page's `page.config.ts`, not in `server.rsc`.

## Browser compatibility

Set both minimum platforms to enable production syntax lowering and core-js:

```ts
export default defineConfig({
  target: {
    android: 6,
    ios: 10,
  },
});
```

The minimum accepted values are Android 5 and iOS 8. Both fields are required.
This changes production browser output; it does not change Node.js or server
compilation.

By default, targeted client entries bundle `core-js/stable`. To load an
external UMD build instead, provide an absolute HTTP(S) URL:

```ts
export default defineConfig({
  target: { android: 6, ios: 10 },
  polyfill: {
    coreJs: "https://cdn.example.com/core-js-bundle.min.js",
  },
});
```

`polyfill` is valid only with `target`. It covers ECMAScript built-ins, not Web
APIs such as `fetch`, `AbortController`, or Streams.

## Output

```ts
export default defineConfig({
  output: {
    client: "dist/public",
    server: "dist/runtime",
    crossOriginLoading: "anonymous",
  },
});
```

| Field | Type | Default |
| --- | --- | --- |
| `client` | project-relative path | `dist/client` |
| `server` | project-relative path | `dist/server` |
| `crossOriginLoading` | `false \| "anonymous" \| "use-credentials"` | `"anonymous"` |

Client and server directories must be separate, non-nested descendants of
`dist` and cannot contain empty, `.` or `..` path segments.

`crossOriginLoading` sets the `crossorigin` attribute for generated JavaScript
and CSS tags and applies the same policy to dynamically loaded chunks.

## Cross-origin server transport

Same-origin applications need no transport configuration. When browser code
must call an evjs server on another origin, set an absolute URL:

```ts
export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

This affects framework browser-to-server calls such as server functions. It
does not act as a general API-client base URL.

## Plugins

Install plugins through factory calls:

```ts
import { analytics } from "@company/evjs-plugin-analytics";

export default defineConfig({
  plugins: [
    analytics({
      endpoint: "/events",
      debug: false,
    }),
  ],
});
```

The factory argument is the plugin's application configuration. Conditional
entries may use `false`, `null`, or `undefined`. Page-aware plugins expose
their page contract under the plugin id in `page.config.ts#plugins`.

Application options and page options are separate contracts. They are not
merged with each other. See [Using Plugins](./plugins).

## Bundler

The CLI selects Utoopack by default. Supply another adapter only when the
application needs a capability or validation path it provides:

```ts
import { webpackAdapter } from "@evjs/bundler-webpack";

export default defineConfig({
  routing: { mode: "spa" },
  bundler: webpackAdapter,
});
```

Run `ev inspect` after changing the bundler. It reports capabilities required
by the application's rendering choices.

## Disabling conventions

Advanced standalone applications can disable page, API route, and middleware
file discovery together:

```ts
export default defineConfig({
  conventions: false,
});
```

There are no per-directory switches. `conventions: false` cannot be combined
with canonical `routing`. Reachable `"use server"` modules and explicit
`application.routes` remain available.

For the explicit SPA route-tree API, read
[Advanced Convention Control](./advanced-conventions).
