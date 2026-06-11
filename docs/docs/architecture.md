# Architecture

evjs is a React framework built around explicit source declarations, a framework graph, a bundler-independent build plan, and one runtime manifest.

```txt
source declarations
  -> AppGraph
  -> BuildPlan
  -> bundler build
  -> BuildOutput
  -> runtime / shell / deployment adapters
```

## Public Packages

```txt
@evjs/ev
  config, plugin lifecycle, dev/build orchestration, framework build types

@evjs/client
  browser runtime, server-function transport, page runtime, shell exports,
  route helpers, and TanStack compatibility

@evjs/server
  Hono/fetch app, server functions, server routes, SSR/PPR/RSC request boundary
```

## Internal Modules

```txt
@evjs/ev/build-tools
  source analysis, route/server-function extraction, graph/plan helpers,
  framework transforms, HTML helpers

@evjs/shared/manifest
  AppGraph, BuildPlan, BuildOutput, and manifest schemas

@evjs/client internal modules
  framework-managed runtime, shell, route DSL, transport, RSC client runtime,
  and TanStack compatibility behind the single public client entry

@evjs/bundler-utoopack
  default bundler adapter used by @evjs/cli

@evjs/bundler-webpack
  validation/fallback adapter for component pages, SSR/PPR/RSC, remotes,
  and dev plan updates while Utoopack lower-layer APIs catch up
```

`@evjs/ev/build-tools` does not import bundler adapters. Bundler adapters consume `BuildPlan`; they do not rediscover framework semantics from source files after bundling.

## Build Flow

```mermaid
sequenceDiagram
  participant CLI as "@evjs/cli"
  participant EV as "@evjs/ev"
  participant Tools as "@evjs/ev/build-tools"
  participant Bundler as "BundlerAdapter"
  participant Manifest as "manifest linker"
  participant Plugins as "Plugins"

  CLI->>EV: dev/build(config)
  EV->>Plugins: config hooks
  EV->>EV: resolveConfig()
  EV->>Plugins: setup hooks
  EV->>Tools: createAppGraph(config)
  Tools-->>EV: AppGraph + diagnostics + fileDependencies
  EV->>Plugins: appGraph(graph)
  EV->>Tools: createBuildPlan(config, graph)
  Tools-->>EV: BuildPlan
  EV->>Plugins: buildPlan(plan)
  EV->>Bundler: build(plan)
  Bundler-->>EV: bundler stats/assets
  EV->>Manifest: linkBuildOutput(graph, plan, bundlerFacts)
  Manifest-->>EV: BuildOutput
  EV->>Plugins: buildOutput(output)
  EV->>EV: emit dist/manifest.json
  loop each HTML document
    EV->>Plugins: transformHtml(doc, htmlContext)
  end
  EV->>Plugins: buildEnd({ output, isRebuild })
```

The manifest is `dist/manifest.json`. Legacy `dist/client/manifest.json` and `dist/server/manifest.json` are not the new framework contract.

TanStack compatibility is intentionally kept in `@evjs/client`. The architecture
does not require `@evjs/client` itself to avoid TanStack; it requires the
framework to support applications that do not use TanStack Router.

## Runtime Flow

```mermaid
sequenceDiagram
  participant Browser
  participant Shell as "@evjs/client"
  participant Runtime as "@evjs/client"
  participant Server as "@evjs/server"
  participant Manifest as "BuildOutput"

  Browser->>Runtime: page/app boot
  Runtime->>Manifest: load embedded or /manifest.json
  Runtime->>Shell: createShell({ manifest, drivers })
  Shell->>Manifest: resolve app/page/remote target
  Shell->>Shell: negotiate remote shared scope
  Shell->>Browser: import JS/CSS module assets
  Shell->>Runtime: mount/hydrate/unmount lifecycle

  Browser->>Server: POST runtime.server.fn
  Server->>Server: dispatch registered server function
  Server-->>Browser: JSON result/error

  Browser->>Server: GET page route
  Server->>Manifest: match route/page/renderer
  Server-->>Browser: SSR HTML

  Browser->>Server: GET PPR page route
  Server->>Manifest: match shell and region renderers
  Server->>Server: render/cache declared regions
  Server-->>Browser: PPR HTML in the same route response

  Browser->>Server: GET runtime.server.rsc?page=id
  Server->>Manifest: read RSC renderer and reference manifests
  Server-->>Browser: React Flight stream
```

PPR does not require the browser to fetch region endpoints during initial page
load. The framework server can use either `merge` or `stream` delivery for the
page route. `merge` is the default non-streaming mode and returns the final
server-composed HTML after shell and regions resolve. `stream` sends shell HTML
first, then sends region patches in the same document response. The derived
`runtime.server.ppr` endpoint remains available for direct/debug access and
cache validation.

In a single server process, region resolution is an internal framework call. In
an edge deployment, the same contract can split across layers: the edge can
serve a cached shell and resolve dynamic regions by server-to-server calls to an
internal origin/FaaS endpoint. The browser still sees only the page route:

```mermaid
sequenceDiagram
  participant Browser
  participant Edge as Edge/CDN
  participant Origin as Internal FaaS / Origin

  Browser->>Edge: GET /campaign
  Edge->>Edge: load cached PPR shell
  Edge->>Edge: read public manifest PPR region metadata
  Edge->>Origin: GET /__evjs/ppr/campaign/offer
  Origin->>Origin: render/cache offer region
  Origin-->>Edge: region HTML fragment + cache headers
  Edge->>Edge: apply region cache policy
  alt delivery = merge
    Edge-->>Browser: complete composed HTML
  else delivery = stream
    Edge-->>Browser: shell HTML, then region patch in same response
  end
```

That split means `GET /__evjs/ppr/...` may appear in edge-to-origin logs but not
in browser network logs. The long-term runtime boundary is a replaceable region
resolver: local Node/dev can call the renderer in-process, while edge adapters
can fetch an internal FaaS endpoint without changing the public page protocol.

The preferred PPR authoring model is React `Suspense` with a
`lazy(() => import(...))` child. The page component declares
`export const render = "ssr"` plus
`export const prerender = { partial: true, delivery }`. Dynamic regions can
declare `export const cache` and `export const hydrate` in their own modules.
PPR is a prerendering strategy on top of SSR, not a separate document render
mode.

PPR page hydration is page-level `none` in the public manifest. Client
interactivity should be introduced through explicit client islands or
region-level hydration metadata, not by hydrating the whole PPR shell.

RSC uses the same `@evjs/server` boundary for Flight requests. The Webpack
validation path uses React Flight client consumption and React client/server
reference manifests; Utoopack still needs equivalent lower-layer metadata before
it can run the same path.

Remote shared dependencies use an explicit host-provided share scope. The shell
checks remote `shared` requirements before loading the remote entry, supports
`shareKey`, singleton checks, eager metadata, and semver-style ranges including
compound comparators and `||`, and exposes provided entries to remote React
components through the shell context. Host applications can observe negotiation
results with `onRemoteSharedNegotiated()` for diagnostics, telemetry, or policy
UI; ordinary remote components should not render framework dependency versions.
React host pages should use `useRemoteHost()` / `RemoteApp` instead of
constructing shell manifests manually; the helper owns remote app manifest
creation, query-string manifest override for debugging, default React share
scope registration, remote manifest loading, shell activation, and disposal.
Default-exported React remote modules are automatically adapted to shell
lifecycle modules. Explicit `init()`, `mount()`, `hydrate()`, and `unmount()`
exports remain available only as an advanced lifecycle escape hatch. Automatic
package loading/version selection remains outside this implementation.

## Configuration Ownership

```txt
entry/html
  single app shorthand

app
  app declaration source that owns entry, html, route groups, mount point

pages.*
  standalone page shorthand: path, entry/component/app, mount point

server.basePath
  derives framework server runtime paths: fn, ppr, rsc

transport.baseUrl
  browser-to-framework-server origin override

plugins
  framework and bundler extension points
```

`app` points to one app declaration source. That source owns the application
document, client entry, route groups, and mount point. It should not carry one
rendering strategy, because one app can contain CSR, SSR, PPR, RSC, and remote
routes at the same time.

Route declarations own path-to-component wiring. Page modules own rendering
metadata through static exports such as `render`, `hydrate`, `componentModel`,
and `prerender`. When graph creation sees a route component with SSR, RSC, or
partial prerender metadata, it derives an internal page from that route. That
page provides a stable `pageId`, render metadata, server renderers, PPR regions,
assets, and manifest output, but it does not emit an independent HTML document.
The app document remains the HTML owner.

`pages.*` remains the standalone page shorthand. It is useful when a page is not
inside an app declaration source, or when a simple MPA-style page should own its
own HTML document. Rendering metadata still belongs in the referenced page
module, not in `ev.config.ts`.

## Server Function Pipeline

```txt
"use server" module
  -> build-tools extraction
  -> client transform creates createServerReference(fnId)
  -> server transform/register path
  -> BuildOutput.server.functions
  -> @evjs/server dispatches POST runtime.server.fn
```

The public config exposes `server.basePath`; the function endpoint is derived from that base path.

## Deployment

Deployment adapters consume `BuildOutput`. `@evjs/ev` provides:

- `createDeploymentArtifact(output)` for platform-neutral routing/assets/server metadata;
- `nodeDeploymentAdapter()` for a concrete Node production target that emits
  `dist/deployment.node.json` and `dist/server.mjs`;
- `staticDeploymentAdapter()` for static-host routing metadata and `_redirects`;
- `edgeDeploymentAdapter()` for edge-worker style runtime bootstraps that call the
  framework server bundle and an asset binding.

Platform-specific adapters should derive their routing, framework endpoint, SSR,
PPR, RSC, remote, shared dependency, and asset metadata from `BuildOutput`
instead of reading bundler stats.

The deployment model is capability-driven:

```txt
static-only
  CSR / MPA client entries / SSG / remote manifests / assets

unified node
  static assets + framework endpoints + SSR/PPR/RSC + server functions/routes

unified edge worker
  asset binding + edge-compatible framework server bundle

edge + origin/FaaS split
  edge caches assets/shells
  origin/FaaS resolves functions, routes, SSR/RSC, and PPR regions
```

Adapters should classify `BuildOutput` first, then emit platform routes. Static
hosting must not claim support for SSR, PPR, RSC, server functions, or server
routes unless a server-capable runtime is attached.

## Dev Updates

Framework-level declaration changes are handled separately from normal HMR:

```txt
config / route declaration / server declaration change
  -> recreate AppGraph
  -> recreate BuildPlan
  -> diff BuildPlan
  -> devPlanUpdate hooks
  -> bundlerDevController.updatePlan(update, nextGraph)
```

The current Utoopack adapter reports a clear unsupported error for dynamic entry
updates until Utoopack exposes the lower-layer API. The webpack adapter can apply
the update in-process for architecture validation. Style and asset edits remain
on the bundler HMR path.

Graph analysis reads a static import closure to discover server functions,
server routes, route declarations, and RSC references. Dev only watches explicit
graph roots and files that already contain framework markers; ordinary component
and style edits stay on the bundler HMR path. If a plain component starts
declaring framework semantics, a configured route/server root or config change
should introduce it into the watched framework graph set.
