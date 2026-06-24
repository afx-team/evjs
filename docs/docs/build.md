# Build

## Command

```bash
ev build
```

`ev build` resolves config, creates an `AppGraph`, derives a `BuildPlan`, runs the selected bundler, links a single `BuildOutput`, and emits HTML.

Use `ev inspect` when you need to explain what evjs discovers before bundling:

```bash
ev inspect
ev inspect --json
```

`ev inspect` resolves config and framework declarations, but it does not run a
bundler and does not write `dist`. It reports routing mode, discovered page
routes, ignored or rejected route files, generated route type location, server
functions, server routes, page render metadata, runtime server paths,
planned entries/documents, and diagnostics. If any diagnostic is an error, the
command exits non-zero; warnings are printed without failing the command.

## Output

CSR-only output (`server: false`) is flat:

```txt
dist/
├── index.html
├── main.[hash].js
├── [chunk].[hash].js
└── manifest.json
```

Server-enabled output uses separate manifests:

```txt
dist/
├── client/
│   ├── index.html
│   ├── main.[hash].js
│   └── manifest.json
├── server/
│   ├── main.[hash].js
│   └── manifest.json
└── build-output.json
```

`dist/build-output.json` is the complete private `BuildOutput` handoff artifact
for tools that need the full framework model after build. `dist/client/manifest.json`
and `dist/server/manifest.json` are deterministic views derived from it: the
client manifest is browser-safe public metadata, while the server manifest
contains server bundle metadata (`entry`, `assets`, `fns`, and `routes`).
Deployment adapters can consume `BuildOutput` during the build and embed the
equivalent runtime data into platform files, so a deployed server package does
not have to read `dist/build-output.json` at startup. CSR-only output stays flat
and writes the public manifest to `dist/manifest.json`. HTML may embed the
public manifest as `__EVJS_MANIFEST__`; when the browser runtime fetches it
through `manifestUrl`, `data-evjs-manifest`, or `/manifest.json`, the response
must be successful JSON with
`Content-Type: application/json`, allowing optional content-type parameters.

## Build Pipeline

1. Load and resolve `ev.config.ts`.
2. Run config/setup plugin hooks.
3. `createAppGraph()` analyzes the file-based page route files, lower-level app/page outputs, server entry,.
4. `createBuildPlan()` produces concrete client/server entries and HTML documents.
5. The selected bundler compiles `BuildPlan.entries`.
6. `linkBuildOutput()` combines `AppGraph`, `BuildPlan`, and bundler facts.
7. evjs emits framework manifests.
8. evjs generates each planned HTML document and calls `transformHtml(doc, ctx)`.
9. evjs calls `buildEnd({ output, isRebuild })`.

Manifest linking does not rescan user source after bundling.

## Programmatic Preparation

Tools that need framework semantics without invoking a bundler can call
`prepareFrameworkBuild()` from `@evjs/ev`. It resolves config, applies
page-routing defaults, initializes plugins, runs `buildStart` hooks, reports
graph diagnostics, and returns the resolved config, graph file dependencies,
plugin watch files, and `dispose()`. `AppGraph` and `BuildPlan` remain internal
framework state.

The preparation API stops before bundler execution, manifest emission, HTML
emission, and deployment adapter output.

For a CLI preflight with human-readable diagnostics, prefer `ev inspect`. It
uses the same graph and plan preparation path, while keeping `AppGraph` and
`BuildPlan` as framework internals.

## Server Functions

Files with `"use server"` are transformed into browser-callable references and server registrations:

| Side | What happens |
|------|-------------|
| Client | Function bodies are replaced with internal RPC stubs |
| Server | Function implementations are registered for framework server dispatch |

Function output is recorded in `BuildOutput.server.functions`. Its object keys
are server function ids: non-empty strings without leading or trailing
whitespace. They are not build identifiers, so generated ids can use separators
such as `fn:refund`. The public endpoint is derived from `server.basePath`:

```txt
server.basePath = /__evjs
runtime.server.fn = /__evjs/fn
```

## Framework Pages

File-based routes and configured component pages both become framework-managed
component pages. The lower-level `pages` string shorthand means "component
page"; `{ entry }` pages compile as user-owned client entries for cases that
cannot use the page-file convention. Component pages add explicit metadata so a
bundler adapter can wrap the real component import with the generic page
runtime. The `BuildPlan.import` remains the user component path; evjs does not
write hidden production source files.

SSR/PPR pages add server render entries to the plan. PPR pages produce a shell
renderer. Partial prerendering is experimental in evjs 0.2: the public
authoring model is React `Suspense`, while the current compatibility
implementation can additionally produce internal region renderers for the
limited `Suspense` + direct `lazy(() => import(...))` shape. Runtime
postponed/resume for arbitrary Suspense boundaries is not implemented yet. When
internal regions exist, the framework server resolves them while serving the
page route, so the initial browser navigation stays one document request. PPR
supports two document delivery modes:

- `merge` is the default non-streaming mode. The server waits for resolved
  regions and returns a complete HTML response.
- `stream` sends the shell first, then sends region patches in the same HTML
  response as each region resolves.

PPR component pages do not create a page-level browser entry. Their public
manifest hydration mode is `none` until explicit client islands or region-level
hydration are modeled.

File-route pages that export `render = "ssg"` keep the same route-owned document
contract in SPA mode: the app HTML fallback is still the only planned SPA
document, while the page records `rendering.html = "static"` and gets a server
renderer for static generation/deployment adapters. Use a configured component
page without `path` when you need a standalone static HTML file such as
`pricing.html`.

In MPA mode, a file-route page that exports `render = "ssg"` keeps the MPA
document contract: it emits its own static HTML document, such as
`pricing.html`, and a server renderer for static generation. It does not create
a browser page entry unless the page opts into hydration.
MPA file-route pages that export `render = "ssr"` are route-owned server
documents instead: they get a `page-server` renderer and, when hydrated, a
page-level browser entry, but no static HTML file is emitted.

Internal PPR regions carry cache metadata in the manifest:

```json
{
  "pages": {
    "campaign": {
      "render": "ssr",
      "rendering": {
        "component": "server",
        "html": "partial",
        "prerender": "partial",
        "streaming": false,
        "hydrate": "none"
      },
      "ppr": {
        "delivery": "stream",
        "regions": {
          "region_a1b2c3d4e5f6": {
            "cache": { "revalidate": 60 }
          }
        }
      }
    }
  }
}
```

## Key Points

- Server-enabled builds emit `dist/client/manifest.json`,
  `dist/server/manifest.json`, and `dist/build-output.json`; CSR-only
  builds emit `dist/manifest.json`.
- `dist/build-output.json` is the complete private `BuildOutput` handoff for
  post-build tools and debugging; runtime deployments may embed equivalent data
  instead of reading that file at startup.
- Manifest object keys that become runtime ids, including app ids, page ids,
  and opaque internal PPR region ids, must be build identifiers: letters,
  numbers, underscores, or hyphens.
- App and page runtime modules must link to a JavaScript asset; manifest
  emission fails if a client entry only produced CSS or no assets.
- Server-enabled builds must link the server runtime entry to a JavaScript
  asset; deployment adapters rely on `server.entry` to import the framework
  handler.
- Build entry names are manifest asset keys. They must be build identifiers and
  must be globally unique across app, page, runtime, and server entries.
- `BuildOutput.server.renderers` keys are renderer build entry names and must use
  the same build-identifier rule.
- In full BuildOutput manifests, each SSR, SSG, or RSC document page with server
  HTML must have a `page-server` renderer owned by that page id, or by a route
  id whose `BuildOutput.routes` entry points to that page. PPR pages use their
  `ppr-shell` and `ppr-region` renderer references instead.
- `BuildOutput.routes` ids must be unique non-empty strings without leading or
  trailing whitespace. Page route paths must keep one entry per normalized URL
  path and dynamic URL shape; `pageId` and `appId` must point to existing
  manifest pages or apps.
- RSC reference maps are not build-identifier keyed: reference ids may contain
  file paths, URLs, hashes, or server-function punctuation. They still must use
  non-empty trimmed string keys, and each value must be an object with a
  non-empty trimmed `module` and optional non-empty trimmed `exportName`.
- `BuildOutput.rsc.endpoint` may be omitted when the RSC section only carries
  reference metadata. It is required as soon as `BuildOutput.rsc.pages` contains
  Flight-rendered pages; manifest emission fails before writing an RSC page
  output that has no `runtime.server.rsc` endpoint.
- In full BuildOutput manifests, each `BuildOutput.rsc.pages[id].renderer` must point
  to an `rsc-page` server renderer owned by the same page id. Public manifests
  may omit server renderer metadata because it is redacted.
- `BuildOutput.server.routes` must keep one entry per URL path and dynamic URL
  shape. Dynamic params must be named safely and uniquely inside one route path.
- The public manifest is redacted: browser-visible output must not expose local
  source paths or private build metadata.
- Public manifest validation uses the same structural contract, but treats
  server-only metadata such as source modules and server renderer references as
  optional because those fields are intentionally redacted.
- Source analysis happens before bundler config creation and is cached in dev.
- Component/style edits stay in the bundler HMR path.
- The default Utoopack adapter can relink HTML-only dev plan updates from
  existing build stats. Adding or removing configured page entries in dev still
  requires a restart until Utoopack exposes a lower-layer entry update API.
