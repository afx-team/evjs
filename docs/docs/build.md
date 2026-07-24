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

## Inspect

For a canonical application, the routing summary uses the public
Page-and-Route vocabulary: mode, Page root, discovered `page.*` anchors,
directory-derived route patterns, Documents, and diagnostics.

Canonical inspect output does not present a provider, resolver implementation,
or route-types path. It reports resolved Pages, Routes, Documents, server
functions, server routes, rendering metadata, extension registry state, Page
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

Use `output.client` and `output.server` when the host requires another layout:

```ts
export default defineConfig({
  routing: { mode: "spa" },
  output: {
    client: "dist",
    server: "dist-server",
  },
});
```

Generated HTML embeds the `ClientRuntime` required by browser bootstrap.
`deployment-metadata.json` is the canonical serialized deployment projection;
the complete `BuildOutput` remains in memory. Core does not emit split
client/server compatibility manifests. Application code must not import or
edit deployment metadata.

## SPA And MPA Output

`routing.mode` controls route and Document materialization:

| Topology | Route output | Document output |
| --- | --- | --- |
| `spa` | Client Routes in one browser route tree | Normally one Application-owned Document |
| `mpa` | Static Document Routes | One Page entry and Page-owned Document per Page route |

Both use the same `<routing.dir>/**/page.*` entry, directory scope, and
semantic route pattern.

MPA discovers the same static, dynamic, and splat Page/Route identities.
Dynamic-route output and React layout/boundary projection remain staged.
Unsupported combinations fail graph/plan validation rather than silently
switching conventions or ignoring facets.

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
  extensions: {
    "@company/analytics": {
      channel: "report",
    },
  },
});
```

The module is synchronously evaluated at graph-build time. Core rendering
fields flow into the rendering BuildPlan. Static `title` and named `meta`
materialize missing tags and override matching template baseline values for
Page-owned MPA/SSG Documents; omitted values preserve the baseline. Registered
plugin extensions remain static graph data unless the owning plugin explicitly
projects them into a generated runtime artifact. Plugin `transformHtml` hooks
run after framework metadata materialization and may explicitly override the
result.

The default React server document also emits Page metadata for SSR, PPR, and
RSC responses, including the ownership markers needed for later SPA
navigation. Supplying a custom `renderDocument` replaces that complete
document contract: `ctx.page.metadata` remains available, but the custom
renderer owns the template baseline and must insert
`renderReactPageMetadata(ctx)` from `@evjs/server/react` to retain the core
safe-serialization and SPA cleanup behavior. Build-time `transformHtml` hooks
do not post-process arbitrary per-request custom document strings.

## Migrating Rendering Settings

Do not preserve literal `render`, `hydrate`, `prerender`, or `rsc` exports from
an old Page component. During the one-time source migration, move those values
to adjacent `page.config.ts`:

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssr",
  hydrate: "none",
  prerender: { partial: true },
});
```

Static generation uses the supported `"ssg"` rendering contract. RSC Pages use
`render: "ssr"`, `rsc: true`, and `hydrate: "none"`. Their Flight endpoint is
derived from `server.basePath` unless `server.rsc.endpoint` overrides it. RSC
and partial prerendering cannot be combined on one Page. These settings
normalize to the rendering extension without changing Page identity.

## Server Functions And Routes

Reachable modules beginning with `"use server";` contribute supported named
server functions.

Server request routes are discovered independently under `src/apis`:

```ts
// src/apis/api/health.ts
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
- MPA does not use combinations that its current materializer reports as
  unsupported;
- templates contain the configured mount element;
- Page `title` and each `meta` name/content value are valid static strings;
- Page rendering metadata in `page.config.ts` uses supported values and
  combinations;
- `"use server"` modules begin with the directive and export named callables;
- `src/apis` route modules export uppercase HTTP methods.

For a migrated app, complete the source conversion first, then run
`ev inspect` and review Page sources, Page config, routes, Documents,
provenance, and diagnostics.

## Key Points

- New SPA and MPA apps build from the same `page.*` Page-and-Route tree.
- `ev inspect` reports topology, Page root, source, and Document defaults
  without exposing an internal provider choice.
- `.ev`, manifests, build output, and generated route-type declarations
  are generated.
- Bundler adapters consume BuildPlan and return build facts; they do not own
  routing semantics.
