# Build

## Commands

```bash
ev inspect
ev inspect --json
ev prepare
ev build
```

- `ev inspect` validates and reports framework inputs without writing `.ev` or
  `dist`.
- `ev prepare` writes generated framework IR under `.ev` without running the
  bundler.
- `ev build` resolves config, builds the graph and plan, runs the selected
  bundler, links build facts, and writes production output.

`ev prepare`, `ev build`, and `ev dev` share one per-project operation lock.
Starting a second output-mutating command for the same project fails with the
active operation and process ID instead of racing writes to `.ev`, route types,
`dist`, or deployment artifacts. Different project directories remain
independent.

## Inspect

For a canonical application, the routing summary uses the public
Page-and-Route vocabulary: mode, Page root, discovered `page.*` anchors,
directory-derived route patterns, Documents, and diagnostics.

Canonical inspect output does not present a provider, resolver implementation,
or route-types path. It reports resolved Pages, Routes, Documents, server
functions, server routes, rendering metadata, installed plugin settings, Page
config sources, provenance, and diagnostics. Errors make inspect exit non-zero.

## Generated IR

`ev prepare` writes `.ev`, including:

- normalized CoreGraph;
- generated framework and plugin modules;
- entry facades and framework slots;
- import edges;
- final BuildPlan;
- manifest inputs and provenance.

Canonical applications write the validated semantic graph to
`.ev/framework/core-graph.json`. `.ev` is generated and must not be edited.

## Output

By default browser and server files are separated:

```text
dist/
├── client/
│   ├── index.html
│   ├── main.[hash].js
│   └── [chunk].[hash].js
├── server/
│   └── main.[hash].js
└── deployment-metadata.json
```

Use `output.client` and `output.server` when the host requires another layout.
Both directories must use portable `/`-separated project-relative paths with no
empty, `.`, or `..` segments. They must remain separate, non-nested, symlink-free
strict descendants of the BuildPlan `distDir`:

```ts
export default defineConfig({
  routing: { mode: "spa" },
  output: {
    client: "dist/public",
    server: "dist/runtime",
  },
});
```

The finalized BuildPlan is the single source of truth for adapter cleanup,
emitted assets, stats, and manifest paths. A plugin `configureBundler()` hook may
change supported low-level bundler settings, but it cannot override a
framework-owned client or server output path.

Bundler server facts use `serverEntryAssets`, keyed by each exact server
BuildPlan entry name. Every server entry must emit exactly one self-contained
JavaScript asset. When a bundler reports a complete server asset inventory,
that inventory must contain each declared entry asset and no additional
unowned JavaScript chunks; Core never infers server ownership from module
stats or filenames.

Generated HTML embeds the `ClientRuntime` required by browser bootstrap.
`deployment-metadata.json` is the canonical serialized deployment projection;
the complete `BuildOutput` remains in memory. Application code must not import
or edit deployment metadata.

## Browser Compatibility

Browser compatibility is enabled with a browser target such as
`target: { android: 5, ios: 8 }`. The configured Android/iOS versions become
the Browserslist target, and
their JavaScript syntax output is ES5 in development and production. Webpack
transpiles both application code and client-side framework/third-party
dependencies to that syntax baseline; semantic server-function and RSC loaders
remain scoped to project source. Utoopack receives the same Android/iOS target.
When `target` is omitted, adapters retain their existing client targets and
dependency transpilation scope and no core-js is injected.

The compatibility target is framework-owned: a plugin `configureBundler()`
hook cannot replace it. Node, build-time, server-function, and server-renderer
compilations retain their existing Node target.

Targeted client entries bundle `core-js/stable` by default. Setting an external
`polyfill.coreJs` UMD URL removes that import and adds a blocking script before
EVJS runtime data and deferred client bundles in every Document with client
JavaScript. See [Polyfills](./config#polyfills) for configuration, loading order,
scope, and bundle-size details.

## SPA And MPA Output

`routing.mode` controls route and Document materialization:

| Routing mode | Route output | Document output |
| --- | --- | --- |
| `spa` | Client Routes in one browser route tree | One Application-owned shell, plus a Page-owned output for each static SSG Page |
| `mpa` | Independent Page entries for static semantic routes | One Page-owned Document per static Page route |

Both use the same `src/pages/**/page.*` entry, directory scope, and
semantic route pattern.

Static SPA SSG Pages use their semantic route as the output path: `/` writes
`index.html`, while `/report` writes `report/index.html`. When a root SSG Page
owns `index.html` in a mixed SPA that also needs a client-route fallback, Core
keeps the Application shell separately at `__evjs/<application-id>.html`.

MPA keeps those semantic routes internally but exposes Page Documents as HTML
URLs: `/` writes and serves `index.html`, `/report` uses `report.html`, and
`/foo/bar` uses `foo/bar.html`. CSR emits those files directly. An ordinary MPA
SSR Page with a Page client entry also emits the same canonical HTML as an
empty, independently bootable CSR fallback, while its route remains
server-rendered. PPR and RSC Pages remain request-time-only because they do not
have an ordinary Page client entry. Outputs are derived from route segments,
not Page ids.

MPA materializes only static Page routes. `$param` and terminal
`$...splat` remain valid SPA route identities, but selecting MPA for either
fails graph validation because one dynamic pattern does not identify one
build-time HTML output. Route layouts compose in both modes; router-only
boundary facets remain SPA-only and MPA rejects them explicitly.

Place `index.html` beside an MPA Page when it needs a Page-specific Document
template:

```text
src/pages/report/
├── page.tsx
└── index.html
```

Canonical SPA/MPA Pages both discover an optional `page.config.ts` from their
Page directory:

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Report",
  meta: {
    description: "A generated business report.",
    keywords: "report,analytics",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "ssr",
  hydrate: "load",
  plugins: {
    analytics: {
      channel: "report",
    },
  },
});
```

The module is synchronously evaluated at graph-build time. Core rendering
fields flow into the rendering BuildPlan. For emitted MPA/SSG Documents and
compiled SSR/PPR/RSC request-time document shells, static `title` and named
`meta` materialize missing tags and override matching template baseline
values; omitted values preserve the baseline. Page plugin settings remain
static graph data unless the owning plugin explicitly projects them into a
generated runtime artifact. Plugin `transformHtml` hooks run after
framework metadata, assets, and structured HTML contributions materialize and
may explicitly override the result.

Every server-rendered Page receives a request-time document shell during the
build. For an MPA SSR Page with a CSR fallback, evjs first applies assets,
structured HTML contributions, and `transformHtml` to the canonical fallback,
then derives the server shell from that final Document without running the hook
again. Other server-rendered Pages compile their configured template directly
into the shell. This preserves authored
`<html>`, `<head>`, and `<body>` attributes and content while applying the same
assets, Page metadata, `html.tag` contributions, and `transformHtml` hooks as a
static Document. The default React renderer inserts the Page HTML and
request-specific bootstrap data into that shell.

Supplying a custom `renderDocument` completely replaces the compiled shell:
`ctx.page.metadata` remains available, but the custom renderer owns the
template baseline, assets, and document structure. Insert
`renderReactPageMetadata(ctx)` from `@evjs/server/react` to retain the core
safe-serialization and SPA cleanup behavior. Build-time `transformHtml` hooks
do not post-process the arbitrary per-request string returned by a custom
document renderer.

## Page Rendering Settings

Page components do not export literal `render`, `hydrate`, `prerender`, or
`rsc` settings. Put those values in adjacent `page.config.ts`:

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssr",
  hydrate: "none",
  prerender: { partial: true },
});
```

Static generation uses the supported `"ssg"` rendering contract. RSC and
partial-prerendered Pages must omit `hydrate` or set it to `"none"`. RSC Pages
use `render: "ssr"` and `rsc: true`; their Flight endpoint is derived from
`server.basePath` unless `server.rsc.endpoint` overrides it. Both runtime path
settings must use non-empty ASCII URL-safe segments containing only letters,
digits, `.`, `_`, `~`, or `-`. Empty and standalone `.` or `..` segments,
`:param`, `*`, percent escapes, and raw non-ASCII characters are rejected.
RSC and partial prerendering cannot be combined on one Page. These settings
normalize to Core Page rendering fields without changing Page identity.

Omitting `render` always normalizes the Page to `"csr"`. CSR mounts a new
client tree and therefore must omit `hydrate`; only explicitly selected SSR or
SSG Pages can configure `hydrate: "load" | "none"`. Ordinary SSR defaults to
load hydration, SSG defaults to no hydration, and RSC/PPR remain unhydrated at
the Page level. Generated runtime metadata still uses an effective `"load"`
client activation for CSR bootstrap, but that internal value is not a Page
authoring option.

The server-function and active RSC endpoints are exact paths. An active PPR
endpoint owns its rooted subtree. Build planning requires those active
endpoints to be disjoint and rejects any Page, redirect, or server request
Route pattern that can match a reserved runtime path. `server.basePath` derives
default endpoints but does not reserve a request subtree of its own; dev and
generated Node/Edge deployment routing preserve that distinction.

## Server Functions And Routes

Reachable modules beginning with `"use server";` contribute supported named
server functions.

Server request Routes are discovered independently from positive `api.*`
anchors under `src/apis`:

```ts
// src/apis/api/health/api.ts
export const GET = async () => Response.json({ ok: true });
```

## Build Checks

Check user-controlled inputs first:

- `ev.config.ts` declares `routing.mode`;
- every published client Page uses exactly one `page.*` extension variant;
- each Page uses at most one `page.config.ts` or `page.config.js`, whose
  default export is static JSON data;
- Page entries default-export a component;
- route directories use valid static, `$param`, terminal `$...splat`, and
  `(group)` segments without normalized-path conflicts;
- MPA does not use unsupported dynamic paths or router-only boundary facets;
- templates contain the configured mount element;
- Page `title` and each `meta` name/content value are valid static strings;
- Page rendering metadata in `page.config.ts` uses supported values and
  combinations;
- `"use server"` modules begin with the directive and export named callables;
- each published server request Route uses exactly one `api.*` extension
  variant in its URL directory;
- `api.*` anchors export uppercase HTTP methods only.
- every URL-owning client Route (Page or redirect) is disjoint from server
  request Route patterns, including across static, dynamic, and terminal splat
  matches. Static aliases are compared after exactly one URL decode, so
  `/%75sers` aliases `/users` while double-encoded text remains distinct.

Before building, run `ev inspect` and review Page sources, Page config, routes,
Documents, provenance, and diagnostics.

## Key Points

- SPA and MPA apps build from the same `page.*` Page-and-Route tree.
- `ev inspect` reports `routingMode`, Page root, source, and Document defaults
  without exposing an internal provider choice.
- `.ev`, manifests, build output, and generated route-type declarations
  are generated.
- Bundler adapters consume BuildPlan as the source of routing, runtime, and
  output ownership, then return build facts.
- When stats expose a reliable complete physical inventory, adapters return it
  through `BundlerBuildFacts.emittedFiles`. Each reported side is complete;
  an omitted client or server side means unknown, never an empty output.
