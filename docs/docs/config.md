# Configuration

evjs Core 0.3 has one application authoring model for SPA and MPA:

- `src/pages/**/page.*` is the canonical Page and client-route anchor;
- its containing directory determines Page scope and URL;
- `routing.mode` chooses SPA or MPA materialization without changing the
  semantic Page/Route tree.

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

The file tree supplies the rest:

```text
src/pages/
├── page.tsx                         # /
├── users/
│   ├── page.tsx                     # /users
│   └── $userId/
│       └── page.tsx                 # /users/:userId
└── (account)/
    └── settings/
        └── page.tsx                 # /settings
```

## File-convention Discovery

File conventions are enabled by default. Applications that own all runtime
composition can disable filesystem discovery with the single top-level switch:

```ts
export default defineConfig({
  conventions: false,
});
```

This disables `page.*` discovery under `src/pages`, `api.*` server request-route
discovery under `src/apis`, and both global and route-scoped middleware file
discovery.
It cannot be combined with an explicit `routing` or `server.routing`
declaration. There are no narrower convention disable switches.

SPA-only `application.routes` configuration does not depend on file
conventions. Neither do reachable modules marked with `"use server";` nor
modules emitted through plugin contributions. `app`, `pages`, and top-level
`routes` are not public configuration fields and are rejected.

## Routing

`routing` enables the canonical client Page-and-Route convention.

| Field | Meaning |
| --- | --- |
| `mode` | `"spa"` or `"mpa"`. This changes materialization only. |
| `html` | Shared HTML template. Defaults to `./index.html`. |
| `mount` | Shared mount selector. Defaults to `#app`. |

Canonical Page discovery always reads `src/pages`; `routing` has no client
root override.

Declare the mode explicitly so an unrelated `src/pages` directory is never
mistaken for a framework route tree:

```ts
export default defineConfig({
  routing: { mode: "spa" },
});
```

## Page and path rules

Each route directory may contain exactly one of `page.ts`, `page.tsx`,
`page.js`, or `page.jsx`. The Page module default-exports its component. The
directory is also the Page-private ownership scope.

| Directory segment | Semantic route segment |
| --- | --- |
| `users` | Static `users`. |
| `$userId` | Dynamic `:userId`. |
| `$...splat` | Terminal catch-all. |
| `(account)` | Pathless group. |

The build rejects malformed segments, multiple Page extension variants,
duplicate normalized paths, ambiguous dynamic parameter shapes, and generated
route-id collisions. `index.*` has no canonical client-route meaning and can be
used as an ordinary private module.

### Page routes with children

Directory nesting creates child routes. In SPA mode, a parent Page can render
the nested outlet:

```tsx
import { Outlet } from "@evjs/ev/navigation";

export default function UsersPage() {
  return (
    <main>
      <h1>Users</h1>
      <Outlet />
    </main>
  );
}
```

A directory without `page.*` can organize descendants. A `(group)` directory
also omits its own URL segment.

## SPA And MPA

The same file tree changes materialization according to `routing.mode`.

| Model object | SPA | MPA |
| --- | --- | --- |
| Page | `page.*` with its containing-directory scope | The same Page and scope |
| Route | Client Route in one browser route tree | The same semantic Route, used to select an independent Page entry |
| Document | Application-owned shell plus Page-owned Documents for static SSG Pages | One Page-owned HTML Document per static Page route |
| Source path | Route directory relative to `src/pages` | The same source path |

### SPA

```ts
export default defineConfig({
  routing: { mode: "spa" },
});
```

SPA supports nested routes, dynamic parameters, splats, and file-convention
layouts/boundaries.

### MPA

```ts
export default defineConfig({
  routing: { mode: "mpa" },
});
```

MPA discovery accepts the same `page.*` anchors and produces the same semantic
Page/Route identities. It accepts only static Page paths: `$param`, terminal
`$...splat`, and router-only boundaries fail during graph validation. Layouts
compose in both modes. These errors do not activate another authoring model. A
colocated `index.html` supplies that MPA Page's Document template.

## Application Extension Configuration

Plugin-owned Application configuration uses the top-level `extensions` bag:

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "spa" },
  extensions: {
    "@company/analytics": {
      enabled: true,
      channel: "checkout",
    },
  },
  plugins: [analyticsPlugin()],
});
```

Every key must be registered by an active plugin
`applicationExtension()` declaration. Core applies plugin defaults, merge, and
validation before `setup()`, then stores the same value on the normalized
Application. This contract is identical for canonical SPA, canonical MPA, and
explicit SPA `application.routes` configuration.

Values must be strict static JSON. Put functions and other executable options
in the plugin factory, for example `featurePlugin({ filter })`, or reference an
explicit generated/runtime module. Do not place secrets here: extension values
enter the build graph. They are not sent to the browser automatically; runtime
projection remains an explicit plugin contribution.

`application.extensions` is intentionally unsupported because `application`
owns explicit SPA route configuration. Application-wide plugin values stay in
top-level `extensions`, including after adopting canonical `page.*` routing.

## Page Scope And Configuration

The complete Page directory is its private ownership scope:

```text
src/pages/users/$userId/
├── page.tsx
├── page.config.ts
├── index.ts
├── model.ts
├── services.ts
└── components/
    └── ProfileCard.tsx
```

Only `page.*` is the Page entry. Other files never create routes, so Page code
does not need `_` prefixes. “Private” describes framework discovery and plugin
ownership, not a security boundary or import restriction. A descendant
directory with its own `page.*` creates a more specific Page scope.

Optional Page-level configuration uses an adjacent `page.config.ts`:

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "User profile",
  meta: {
    description: "View and manage a user profile.",
    keywords: "users,profile",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
  extensions: {
    "@company/feature": {
      enabled: true,
    },
  },
});
```

The module is evaluated synchronously while evjs constructs the build graph.
It must default-export a plain object containing static JSON data. Supported
core fields are `title`, `meta`, `render`, `hydrate`, `prerender`, and `rsc`.
Omitting `render` always selects CSR, and CSR must omit `hydrate`. Explicit SSR
and SSG Pages may use `hydrate: "none" | "load"`; ordinary SSR defaults to
`"load"`, SSG defaults to `"none"`, and RSC/PPR remain unhydrated at Page level.
`meta` is a string record for `<meta name="key" content="value">`; it does not
accept `property`, `charset`, links, scripts, functions, or a generic head
tree. Plugin-owned values must use registered namespaced keys under
`extensions`.

The plugin API targets the same normalized Page identity in both modes.
Core title/meta values are materialized for the Page in both modes. Configured
extension values are build-time graph data and are not automatically published
to browser runtime; the plugin must explicitly generate and attach any runtime
projection it needs.

## Other Configuration

### Server

When file conventions are enabled, positive `api.*` server request-route
anchors under `src/apis` are discovered by default. Configure the root only
when it intentionally lives elsewhere:

```ts
export default defineConfig({
  routing: { mode: "spa" },
  server: {
    basePath: "/__evjs",
    routing: {
      dir: "./src/apis",
    },
  },
});
```

`server.basePath` owns server-function, PPR, and RSC runtime paths. It must be
an absolute pathname using non-empty ASCII URL-safe segments containing only
letters, digits, `.`, `_`, `~`, or `-`. Empty and standalone `.` or `..`
segments, dynamic `:param` and
wildcard `*` segments, percent escapes, and raw non-ASCII characters are not
valid runtime endpoint configuration. There is no public
`server.functions.endpoint`.

Server middleware conventions are:

- `src/middleware.ts` for global server middleware;
- `<server.routing.dir>/**/middleware.ts` for middleware scoped to
  same-directory and descendant server file routes; it defaults to
  `src/apis/**/middleware.ts`.

`server.routing: { dir }` customizes the shared `api.*` and route-middleware
discovery root; it is not a disable switch.

Enable React Server Components per Page with `rsc: true` in `page.config.ts`.
The Flight endpoint is derived from `server.basePath`; optionally override it
with `server.rsc: { endpoint: "/custom/flight" }`. `server.rsc` is not an
enable switch, and its endpoint override follows the same absolute ASCII static
pathname rule.

The server-function endpoint is exact. RSC adds another exact endpoint only
when an RSC Page exists, and PPR reserves a rooted subtree only when PPR is
active. The BuildPlan rejects collisions among active endpoints and between a
reserved endpoint and any Page, redirect, or server request Route pattern.

### Dev Server

The browser dev server defaults to port `3000`; the server runtime defaults to
`3001`. They are preferred ports and may move together when occupied.

```ts
export default defineConfig({
  routing: { mode: "spa" },
  dev: {
    port: 4000,
    proxy: [
      {
        context: ["/api"],
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    ],
  },
  server: {
    dev: { port: 4001 },
  },
});
```

`dev.https` accepts `false`, `true`, or a `{ key, cert }` object.
`server.dev.https` accepts `false` or an explicit `{ key, cert }` object; the
framework server does not synthesize a certificate for `true`.

### Output

Browser assets default to `dist/client`; server artifacts default to
`dist/server`. Both values must be project-relative strict descendants of the
BuildPlan `distDir` (`dist` for framework commands), must use `/` as the
portable separator, and must not contain empty, `.` or `..` path segments.
They must resolve without symbolic links to separate, non-nested directories.
This keeps adapter writes and cleanup scoped to one framework-owned output
tree.

```ts
export default defineConfig({
  routing: { mode: "spa" },
  output: {
    client: "dist/public",
    server: "dist/runtime",
  },
});
```

After config and plugin setup finish, the BuildPlan owns the resolved output
paths. Adapters use those paths for cleanup, emitted assets, stats, and
manifests; `bundlerConfig()` hooks cannot override framework-owned client or
server output paths.

`output.crossOriginLoading` accepts `false`, `"anonymous"`, or
`"use-credentials"`.

### Transport

Set `transport.baseUrl` only when the browser calls the server runtime on a
different origin:

```ts
export default defineConfig({
  routing: { mode: "spa" },
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

### Plugins

Register plugins through `plugins`. A plugin may register namespaced
Application, Page, Route, and Document configuration owners and target the
normalized graph through the same `Plugin` interface that owns config, setup,
contributions, and lifecycle hooks. See [Plugins](./plugins).

### Bundler

Utoopack is the default. Supply a bundler adapter only when intentionally using
the validation/fallback backend:

```ts
import { defineConfig } from "@evjs/ev";
import { webpackAdapter } from "@evjs/bundler-webpack";

export default defineConfig({
  routing: { mode: "spa" },
  bundler: webpackAdapter,
});
```

Every adapter declares build capabilities for server rendering, RSC, and PPR,
plus dev-plan update capabilities for HTML, entries, routes, server output, and
resolution. `ev inspect` reports the selected adapter and any plan gaps; build
and dev fail before adapter execution when a required capability is missing.

## Route Inputs

Canonical Page discovery is enabled by `routing.mode`. An unrelated
`src/pages` directory is not interpreted as a route tree when `routing` is
absent. Only `page.*` anchors participate in this file convention.

### Explicit SPA route configuration

`application.routes` accepts nested `routes`, `page` or `component`, `layout`,
`wrappers`, redirects, and Application Document configuration through the
SPA-only explicit route-tree normalizer. `application.pageRoot` is the Page
source root for both `page` and `component` references in this explicit input;
it defaults to `./src/pages` and never changes canonical file discovery.
A `page` value selects a `page.*`-anchored directory relative to that root.
A `component` selects a module inside the same root: `@/pages/...` is a logical
alias for the configured `application.pageRoot`, while bare and `./` component
references are relative to it. Component paths and resolved symbolic links
cannot escape the configured Page source root. Layout and wrapper references
keep their project-source resolution semantics. The `children` spelling is
rejected; nested declarations use `routes`. Each explicit Route may carry a strict static,
namespaced `extensions` bag; the owning plugin must register every namespace
with `routeExtension()`. MPA materialization,
Document alias conflicts, and component references outside the Page root are
rejected.
Static segment identity is compared after exactly one URL decode. Raw and
percent-encoded aliases therefore cannot coexist, and a segment that decodes
to `.` or `..` is rejected because WHATWG URL parsing removes it before route
matching.

An explicit component ending in `index.*` or `page.*` claims its containing
directory as the Page scope. A flat component such as
`<application.pageRoot>/403.tsx` remains module-scoped so it cannot
accidentally claim other flat Pages in the configured root; a module-scoped
Page does not discover an adjacent `page.config.ts`.

### Canonical Page tree

With `routing.mode`, each published Page lives in the directory for its public
URL and uses `page.*`. Static title, named metadata, rendering settings, and
plugin-owned Page values live in the adjacent `page.config.ts`. Dynamic,
terminal catch-all, and pathless segments use `$param`, `$...splat`, and
`(group)` directories. Run `ev inspect` to review the normalized
Page/Route/Document graph.

Provider ids may appear in raw CoreGraph/debug artifacts as internal
provenance. Normal `ev inspect` routing output hides them and reports
normalized Page, route, source, and document information; providers are not a
user-selectable routing architecture.

The following fields are not part of the public configuration:

- `app`
- `pages`
- top-level `routes`
- top-level `html`
- `application.topology` or `application.mode`
- `server.entry`
- `server.functions`
- `server.functionRuntime`
- `routing.routes`
- `routing.entry`
- top-level `functions` or `serverFunctions`
