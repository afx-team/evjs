# Configuration

evjs is zero-config by default. Most apps only add `ev.config.ts` to choose SPA
or MPA file routing and to configure server/runtime features. Use lower-level
app and page output config only when the file convention cannot describe the
target.

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

The top-level config object accepts only `entry`, `html`, `dev`, `server`,
`transport`, `app`, `routing`, `bundler`, `plugins`, and
`pages`. Framework metadata such as generated app declarations, page-route
runtime wiring, and server-function endpoints is derived by evjs instead of
being configured directly.

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
`pages` config, SPA routing is enabled automatically.
Set `routing: false` to disable file-route discovery explicitly.
The exported config must be an object. When enabled with options, `routing`
must be an object; arrays and `null` are rejected.

SPA mode can use a root layout module. By default evjs looks for a single
`layout.*` or `layout/index.*` source module beside the route directory, such
as `src/layout.tsx` or `src/layout/index.tsx` for `src/pages`. If more than one
candidate exists, keep one file or configure `routing.layout` explicitly. Set
`routing.layout` to a module path when a migrated app has its shell in another
location. Explicit layout modules must be source modules, not declaration,
test, spec, story, client-only, or server-only files. Set it to `false` to
disable external root layout discovery:

```ts
export default defineConfig({
  routing: {
    mode: "spa",
    layout: "./src/shell/AppLayout.tsx",
  },
});
```

`routing.layout` is not supported in MPA mode. Route-directory layout modules
are SPA route conventions. MPA pages should compose shared shells as normal
React components, or use page-specific/shared HTML templates when the document
wrapper needs to differ.

`routing.mode` must be either `spa` or `mpa`. When provided, `routing.dir`,
`routing.html`, and `routing.mount` must be non-empty strings. `routing.layout`
must be either `false` or a non-empty module path.

Use top-level `entry` / `html` only for a manually bootstrapped single app.
Applications that use `src/pages` should not create a separate client router or
framework bootstrap manually:

```ts
export default defineConfig({
  entry: "./src/main.tsx",
  html: "./index.html",
});
```

Top-level `entry` and `html` must be non-empty strings when provided. For the
lower-level `app` declaration, use a string or `{ source }` for a lifecycle
module, or `{ entry, html?, mount? }` for a browser entry that owns its own
bootstrap:

```ts
export default defineConfig({
  app: {
    entry: "./src/main.tsx",
    html: "./index.html",
    mount: "#app",
  },
});
```

`app` must be a string module path or an object; `null` and arrays are rejected.
Object-form `app` must specify exactly one of `source` or `entry`. `source`,
`entry`, `html`, and `mount` must be non-empty strings when provided.
Object-form `app` accepts only `source`, `entry`, `html`, and `mount`.
Configured HTML templates from top-level `html`, `app.html`, `routing.html`,
and `pages.*.html` must point to files and are validated before the bundler
runs. When a config object declares `mount`, that selector must match an
element in the corresponding HTML template. Shared templates are allowed; each
declared mount selector is checked independently.

## Pages

`pages` is the explicit lower-level API for independent page outputs and
non-conventional routes. Prefer `routing: { mode: "mpa" }` when the page set
maps directly to `src/pages`. String pages are shorthand for framework-managed
React component modules. Use `{ entry }` only when a page owns its own
bootstrap:

```ts
export default defineConfig({
  pages: {
    home: "./src/pages/Home.tsx",
    about: {
      entry: "./src/pages/about/main.tsx",
      html: "./src/pages/about/index.html",
    },
  },
});
```

The object `{ component }` form is equivalent to the string shorthand, and is
the form to use when the page needs `path`, `html`, or `mount`:

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

Component page objects can also declare framework render metadata directly:

```ts
export default defineConfig({
  pages: {
    dashboard: {
      path: "/dashboard",
      component: "./src/pages/dashboard/Page.tsx",
      render: "ssr",
      hydrate: "visible",
    },
  },
});
```

`pages` must be an object map. Page ids must be non-empty build identifiers:
use letters, numbers, underscores, or hyphens, not path separators. Each page
value must be a string module path or a page object, and each page must specify
exactly one module contract: `entry`, `component`, or `app`. Those module paths
must be non-empty strings. Page objects accept only `path`, `entry`,
`component`, `app`, `html`, `mount`, `render`, `hydrate`, `prerender`, and
`rsc`. When provided, `path` must start with `/` and be unique across explicit
pages. Dynamic parameter names do not create different URL shapes, so
`/users/:id` and `/users/:userId` conflict. It is a URL pathname, so it must not
contain whitespace, a query string, or a hash. `html` / `mount` must also be
non-empty strings. Page ids feed generated build entry names and HTML filenames,
so they must not collide with app entries or other page outputs.

```tsx
// src/pages/dashboard/Page.tsx
export const render = "ssr";
export const hydrate = "load";

export default function DashboardPage() {
  return <main>Dashboard</main>;
}
```

When `path` is present, the page also contributes a framework route. Use this
for SSR, SSG, PPR, and other framework-served pages so URL and component stay
in config. Rendering metadata can live either in the component page config or
as static exports from the component module. Config metadata wins for fields it
declares; static exports fill omitted fields. If `path` is omitted, the page is
emitted as an HTML document such as `campaign.html`.
Route-derived page IDs must be unique; evjs reports collisions such as
`/admin/panel` and `/admin_panel` both deriving `admin_panel`. Rename one file
route, or use explicit `pages` config with unique page ids when generated IDs
would collide.

### Page Module Static Exports

evjs reads these named static exports from framework-managed page modules when
the corresponding component page config field is omitted. Use literal values so
graph analysis can resolve them without executing user code. Invalid literal
values fail during app graph analysis before bundling.
PPR is not a separate `render` value; use `render = "ssr"` with
`prerender = { partial: true }`.
`prerender` objects may only contain `partial`, `delivery`, and `revalidate`,
and must declare at least one of those properties. `revalidate` must be `false`
or a positive integer number of seconds. Use `true` for full prerendering
without options.
The analyzer supports direct `export const` declarations and local export
specifiers such as `const mode = "ssr"; export { mode as render };`. It does
not follow re-exports from another module for page metadata; exporting a
metadata name from another module is reported as invalid. Runtime metadata
exports must be local variables with a static initializer; uninitialized
declarations such as `export let render;`, function exports, and class exports
are invalid. Type-only exports
such as `export type { mode as render }` and ambient declarations such as
`export declare const render: "ssr"` are ignored because they do not emit a
runtime value. Export each metadata name only once; duplicate `render`,
`hydrate`, `prerender`, or `rsc` exports are graph-analysis errors instead of
last-write-wins behavior.

| Export | Values | Meaning |
| --- | --- | --- |
| `render` | `"csr"` | Client-rendered page. The page is mounted in the browser and does not create a server document renderer. This is the default when `render` is omitted. |
| `render` | `"ssr"` | Server-rendered document. The framework server renders HTML for the request, then the browser hydrates according to `hydrate`. Requires `server` to be enabled. |
| `render` | `"ssg"` | Static document intent. The manifest marks the page as fully prerendered/static, and the default hydration mode is `none`. Deployment adapters can serve it as static HTML when no dynamic server capability is required. |
| `hydrate` | `"none"` | Do not hydrate the whole page in the browser. Use this for static pages, RSC documents, or PPR shells where interactivity is modeled by explicit islands/regions. |
| `hydrate` | `"load"` | Hydrate after the page runtime loads. This is the default for non-SSG server-rendered pages. |
| `hydrate` | `"visible"` | Declare that hydration may wait until the mount point is visible. Runtimes/adapters that do not implement visibility scheduling may fall back to `load`. |
| `hydrate` | `"idle"` | Declare that hydration may wait for an idle browser period. Runtimes/adapters that do not implement idle scheduling may fall back to `load`. |
| `prerender` | `true` | Mark a non-CSR page as fully prerenderable without enabling partial prerendering. The manifest reports `rendering.prerender = "full"`; use `render = "ssg"` when the initial HTML should be statically delivered. |
| `prerender` | `{ partial: true }` | Enable PPR. The framework derives dynamic regions from `Suspense` + `lazy(() => import(...))` boundaries in the page tree. |
| `prerender.delivery` | `"merge"` | Non-streaming PPR delivery. The server resolves shell and regions, then returns one complete HTML response. This is the default for partial prerendering. |
| `prerender.delivery` | `"stream"` | Streaming PPR delivery. The server can flush the shell before all regions finish, then patch resolved regions into the same response. |
| `prerender.revalidate` | positive integer | Declare a revalidation interval, in seconds, for prerendered output. |
| `prerender.revalidate` | `false` | Declare that the prerendered output should not revalidate automatically. |
| `rsc` | `true` | Enable the RSC page path. Use with `render = "ssr"`. RSC documents default to `hydrate = "none"`; explicit `load`, `visible`, or `idle` hydration is rejected. Requires `server.rsc` support from the active bundler/server adapter. |

`rsc = false` is accepted as a no-op for compatibility, but it emits a warning.
Remove it unless the page should become an RSC page with `rsc = true`.

### Rendering Support Contract

Page rendering modes are intentionally narrow. Unsupported combinations fail
before bundling so deployment adapters can trust the manifest:

| Capability | Required page contract | SPA document output | MPA document output | Server/runtime requirement | Unsupported combination |
| --- | --- | --- | --- | --- | --- |
| CSR | Omit `render`, or export `render = "csr"` | App HTML fallback | One HTML document per page | No server required | None |
| SSR | `render = "ssr"` | Route-owned server document | Route-owned server document, no static HTML file | Framework server document route | `server: false` |
| SSG | `render = "ssg"` | App HTML fallback plus static metadata for the route page | Standalone static HTML document | Server build required for generation/manifest linking | `server: false` |
| PPR | `render = "ssr"` + `prerender = { partial: true }` on a component page | Route-owned server document with server-composed regions | Route-owned server document with server-composed regions | Framework server document route plus optional `runtime.server.ppr` direct/debug endpoint | RSC on the same page, full-page hydration entry, `server: false` |
| RSC | `render = "ssr"` + `rsc = true` on a component page | Route-owned server document plus RSC Flight endpoint | Route-owned server document plus RSC Flight endpoint | Framework server document route plus `runtime.server.rsc` | PPR on the same page, `hydrate` other than `"none"`, `server: false` |
If a page needs both RSC data flow and partial prerendered regions, keep those
capabilities on separate page routes for now. A single component page must choose
either `rsc = true` or `prerender = { partial: true }`.

`server: false` is only valid for CSR pages, MPA client entries
builds, and static assets. SSR, SSG, PPR, RSC, server functions, and server
routes require the framework server to be enabled during build.

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
| `cache` | `{ revalidate: positive integer }` | Cache the region output and revalidate after the given number of seconds. |
| `hydrate` | `"none"` | Do not hydrate the region in the browser. This is the default when the region is server-only. |
| `hydrate` | `"load"` | Hydrate the region once its client runtime loads. |
| `hydrate` | `"visible"` | Declare visibility-based region hydration. Unsupported runtimes may fall back to `load`. |
| `hydrate` | `"idle"` | Declare idle-time region hydration. Unsupported runtimes may fall back to `load`. |

Invalid region static export literals fail during graph analysis before
bundling, matching page module metadata validation.
Region metadata follows the same runtime-export rule as page metadata:
runtime exports must be local variables with a static initializer. Re-exported,
function, and class metadata exports are invalid, while type-only exports and
ambient `declare` declarations are ignored. Export each region metadata name
only once; duplicate `cache` or `hydrate` exports are graph-analysis errors.

When the framework composes a PPR page response, it derives a default
`Cache-Control` from the declared region cache policies. If any region is
`"no-store"` or omits `cache`, the page response defaults to `no-store`. If all
regions declare `{ revalidate }`, the page response defaults to the smallest
region `s-maxage`. A `Cache-Control` header returned by the shell renderer is
preserved.
Server adapters can add `framework.ppr.staleWhileRevalidate` at runtime. When
set, cacheable PPR region responses and composed page responses include
`stale-while-revalidate`, and stale region entries are served while the
framework refreshes the cache in the background.

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

`hydrate = "none"` may be omitted on RSC pages because it is the default for
RSC documents. If `hydrate` is declared, it must be `"none"`; full-page browser
hydration modes are not valid for RSC documents.
RSC Flight responses default to `Cache-Control: no-store` because they can
depend on request state and server data. A `Cache-Control` header returned by
the RSC renderer is preserved.
RSC pages cannot also declare partial prerendering. Split RSC and PPR behavior
into separate page routes until the combined runtime contract is available.

The current webpack validation adapter exercises the full RSC request path. The
default Utoopack adapter still needs equivalent client/server reference metadata
before it can run the same path.

`react-server-dom-webpack` is an optional peer dependency of the evjs client and
server runtimes. Install it in applications that use RSC directly, or use a
bundler/server adapter that provides the RSC runtime path.

Server-rendered RSC documents include a small `__EVJS_RSC_BOOTSTRAP__` payload
that points the client runtime at the Flight endpoint, page id, mount selector,
public path, page assets, and optional page route metadata. The client runtime
validates that payload before requesting Flight data and reports malformed JSON,
invalid build/page identifiers, invalid public paths, malformed page assets, or
missing required fields as startup errors. Custom runtimes that call
`startReactRscPageRuntime({ document })` use that document for both bootstrap
lookup and mount selector resolution.

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

`dev`, `server`, `server.dev`, and `transport` must be objects when provided;
use `server: false` to disable the framework server. `server.entry` must be a
non-empty module path when provided, and evjs validates configured source
paths such as `server.entry` during app graph analysis before the bundler runs.
`server.basePath` must be a non-empty URL
pathname that starts with `/`, without whitespace, a query string, or a hash;
trailing slashes are normalized away. If `server.rsc` is configured as an
object, `server.rsc.endpoint` follows the same URL pathname rule. HTTPS
key/cert values for `dev.https` and `server.dev.https` must be non-empty
strings, and HTTPS object config cannot be `null` or an array. `dev.port` and
`server.dev.port` must be integer TCP ports from `1` to `65535`.

Derived runtime paths:

```txt
/__evjs/fn       server functions
/__evjs/ppr      PPR region direct/debug endpoint when PPR pages exist
/__evjs/rsc      RSC Flight endpoint when server.rsc is enabled
```

PPR page loads do not require the browser to call `/__evjs/ppr`; the framework
server resolves declared regions while serving the page route. Direct/debug
region calls use exactly `GET /__evjs/ppr/<pageId>/<regionId>`; `pageId` and
`regionId` use the build-identifier rule, and extra path segments are not
matched.
Successful RSC page model responses must use
`Content-Type: text/x-component`, allowing optional content-type parameters.
Client-side RSC debug JSON helpers only parse responses served with
`Content-Type: application/json`, allowing optional content-type parameters.
Debug payloads must use `version: 1`, `type: "evjs.rsc"`, include a
build-identifier `buildId`, and expose well-formed asset lists before
`loadRscDebugPage()` mounts diagnostic HTML.

Use `transport.baseUrl` only when the browser calls a framework server on another origin:

```ts
export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

`transport` must be an object when provided. `transport.baseUrl` must be an
absolute HTTP(S) URL when provided and must not contain leading or trailing
whitespace.

User `dev.proxy` rules are appended before the framework proxy when the
framework server is enabled. Each rule must be an object with a non-empty
`context` array of pathname patterns and a `target` absolute HTTP(S) URL;
`null` and array entries are rejected. Context patterns must start with `/`,
must not contain whitespace, a query string, or a hash, and must not repeat
within the same rule. Targets must not contain leading or trailing whitespace.
Optional `changeOrigin` and `secure` values must be booleans.

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

`plugins` must be an array of plugin objects. Each plugin needs a non-empty
`name` without leading or trailing whitespace. When provided, `dependencies`
and `optionalDependencies` must be arrays of non-empty plugin names, and
`enforce` must be `pre`, `normal`, or `post`. Plugin objects accept only
`name`, `dependencies`, `optionalDependencies`, `enforce`, `config`, and
`setup`.

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

`bundler` must be an adapter object with a non-empty `name` and `build` / `dev`
functions, and accepts only those three keys. `null`, arrays, unknown keys, and
incomplete adapter objects are rejected during config resolution before command
startup.

`@evjs/bundler-webpack` exists for framework validation while Utoopack lower-layer APIs catch up. Utoopack remains the default runtime path.
