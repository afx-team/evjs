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

This disables `page.*` discovery under `src/pages`, server file-route discovery
under `src/apis`, and both global and route-scoped middleware file discovery.
It cannot be combined with an explicit `routing` or `server.routing`
declaration. There are no narrower convention disable switches.

The SPA-only `application.routes` migration input does not depend on file
conventions. Neither do reachable modules marked with `"use server";` nor
modules emitted through plugin contributions. Removed `app`, `pages`, and
top-level `routes` declarations produce migration errors.

## Routing

`routing` enables the canonical client Page-and-Route convention.

| Field | Meaning |
| --- | --- |
| `mode` | `"spa"` or `"mpa"`. This changes materialization only. |
| `dir` | Project-relative Page-route root. Defaults to `./src/pages`. |
| `html` | Shared HTML template. Defaults to `./index.html`. |
| `mount` | Shared mount selector. Defaults to `#app`. |

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
| Route | Client Route in one browser route tree | Document Route from the same semantic pattern |
| Document | Normally one Application-owned HTML Document | Normally one Page-owned HTML Document per Page route |
| Source path | Route directory relative to `routing.dir` | The same source path |

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
Page/Route identities. Dynamic-route output and React layout/boundary
materialization remain staged. Unsupported combinations fail during graph/plan
validation; they do not activate another authoring model. A colocated
`index.html` supplies that MPA Page's Document template.

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

When file conventions are enabled, server routes under `src/apis` are
discovered by default. Configure the directory only when it intentionally lives
elsewhere:

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

`server.basePath` owns server-function, PPR, and RSC runtime paths. There is no
public `server.functions.endpoint`.

Server middleware conventions are:

- `src/middleware.ts` for global server middleware;
- `src/apis/**/middleware.ts` for middleware scoped to descendant server file
  routes.

`server.routing: { dir }` customizes the discovery root; it is not a disable
switch.

Enable React Server Components per Page with `rsc: true` in `page.config.ts`.
The Flight endpoint is derived from `server.basePath`; optionally override it
with `server.rsc: { endpoint: "/custom/flight" }`. `server.rsc` is not an
enable switch.

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
`dist/server`.

```ts
export default defineConfig({
  routing: { mode: "spa" },
  output: {
    client: "dist",
    server: "dist-server",
  },
});
```

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

Register plugins through `plugins`. A plugin may extend Page configuration and
target the normalized graph through the same `Plugin` interface that owns
config, setup, contributions, and lifecycle hooks. See [Plugins](./plugins) and
[Plugin Migration](./plugin-migration-0.2-to-0.3).

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

## Migrating Existing Applications

Canonical Page discovery is enabled by `routing.mode`. An unrelated
`src/pages` directory is not interpreted as a route tree when `routing` is
absent. Core 0.3 does not expose a Smallfish or evjs 0.2 reader switch; convert
those source trees before starting the application.

### Bigfish SPA route configuration

Bigfish-style `routes`, `component`, `children`, `layout`, `wrappers`, and document
configuration can enter through the SPA-only migration normalizer. MPA
topology, alias conflicts, and component references outside the project are
rejected.

Move those component modules into route directories and rename each route
entry to `page.*`. The corresponding directories encode the same path tree;
after the tree is canonical, set `routing.mode: "spa"` and remove the explicit
route declaration.

### Smallfish applications

Before running Core 0.3, keep or reshape each public URL directory, rename its
`index.*` entry to `page.*`, map `config.json` title and supported
`<meta name>` entries to core `title` and `meta`, and move remaining
plugin-owned values to namespaced `page.config.ts` extensions. Delete
`config.json`, then configure only `routing.mode: "mpa"`.

### evjs 0.2 applications

Before running Core 0.3, move every published filename route into the
directory for its URL and rename the entry to `page.*`. Move title, supported
named metadata, rendering, and plugin-owned Page settings to adjacent
`page.config.ts`, then configure only `routing.mode: "spa" | "mpa"`. Use
`ev inspect` after conversion to verify the normalized Page/Route/Document
graph.

Provider ids may appear in raw CoreGraph/debug artifacts as internal
provenance. Normal `ev inspect` routing output hides them and reports
normalized Page, route, source, and document information; providers are not a
user-selectable routing architecture.

The following obsolete fields remain unsupported:

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
