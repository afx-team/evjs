# Build

## Command

```bash
ev build
```

`ev build` resolves config, creates an `AppGraph`, derives a `BuildPlan`, runs the selected bundler, links a single `BuildOutput`, and emits HTML.

## Output

Fullstack output:

```txt
dist/
├── client/
│   ├── index.html
│   ├── main.[hash].js
│   └── [chunk].[hash].js
├── server/
│   └── server.[hash].js
└── manifest.json
```

CSR-only output (`server: false`) is flat:

```txt
dist/
├── index.html
├── main.[hash].js
├── [chunk].[hash].js
└── manifest.json
```

`dist/manifest.json` is the framework contract consumed by runtime, server, shell, and deployment adapters.

## Build Pipeline

1. Load and resolve `ev.config.ts`.
2. Run config/setup plugin hooks.
3. `createAppGraph()` analyzes explicit app/page/server roots.
4. `createBuildPlan()` produces concrete client/server entries and HTML documents.
5. The selected bundler compiles `BuildPlan.entries`.
6. `linkBuildOutput()` combines `AppGraph`, `BuildPlan`, and bundler facts.
7. evjs emits `dist/manifest.json`.
8. evjs generates each planned HTML document and calls `transformHtml(doc, ctx)`.
9. evjs calls `buildEnd({ output, isRebuild })`.

Manifest linking does not rescan user source after bundling.

## Server Functions

Files with `"use server"` are transformed into browser-callable references and server registrations:

| Side | What happens |
|------|-------------|
| Client | Function bodies are replaced with `createServerReference()` RPC stubs |
| Server | Function implementations are registered for `@evjs/server` dispatch |

Function output is recorded in `BuildOutput.server.functions`. The public endpoint is derived from `server.basePath`:

```txt
server.basePath = /__evjs
runtime.server.fn = /__evjs/fn
```

## Framework Pages

String pages and `{ entry }` pages compile as user-owned client entries. Component pages add explicit metadata so a bundler adapter can wrap the real component import with the generic page runtime. The `BuildPlan.import` remains the user component path; evjs does not write hidden production source files.

SSR/PPR pages add server render entries to the plan. PPR pages produce a shell
renderer and one renderer per declared dynamic region. At runtime the framework
server resolves those regions while serving the page route, so the initial
browser navigation stays one document request. PPR regions carry cache metadata
in the manifest:

PPR component pages do not create a page-level browser entry. Their public
manifest hydration mode is `none` until explicit client islands or region-level
hydration are modeled.

```json
{
  "pages": {
    "campaign": {
      "render": "ppr",
      "ppr": {
        "regions": {
          "inventory": {
            "cache": { "revalidate": 60 }
          }
        }
      }
    }
  }
}
```

## Key Points

- One framework manifest: `dist/manifest.json`.
- `BuildOutput` replaces legacy client/server manifests.
- Source analysis happens before bundler config creation and is cached in dev.
- Component/style edits stay in the bundler HMR path.
- Adding configured pages in dev requires bundler `updatePlan()` support; the current Utoopack adapter fails clearly until the lower-layer API exists.
