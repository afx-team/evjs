# Unified MPA

Minimal multi-page application using the same `page.tsx` file
convention as SPA applications.

## Run

```bash
npm run dev
```

Open `/` on the URL printed by the CLI, then follow the static link to
`/about`.

## Build

```bash
npm run build
```

## Key Files

| File | Purpose |
| --- | --- |
| `ev.config.ts` | Selects MPA routing mode |
| `index.html` | Shared fallback HTML template |
| `src/pages/page.tsx` | Root Page for `/` |
| `src/pages/page.config.ts` | Static title/meta and rendering config for `/` |
| `src/pages/components/PageScopeNote.tsx` | Colocated root Page component without an `_` prefix |
| `src/pages/about/page.tsx` | Page for `/about` |
| `src/pages/about/page.config.ts` | Static title/meta for `/about` |
| `src/pages/about/index.html` | Optional Page-specific HTML template baseline |

## What It Demonstrates

- Multi-page build via `routing.mode: "mpa"`
- The same directory-derived `page.tsx` routes as SPA
- The same static `title` and named `meta` contract as SPA
- One independent router-free React entry per Page
- A complete Page directory acts as private source scope, so colocated helpers,
  components, hooks, and models do not need `_` prefixes
- Page config title/meta add missing tags and override matching values in a
  shared or colocated HTML template while omitted keys preserve that template
  baseline
- `/about` omits `viewport`, so its colocated HTML viewport remains the
  Document baseline
- A colocated `index.html` customizes one MPA Page without route configuration
- `/` and `/about` remain semantic routes while MPA emits their Documents at
  `/index.html` and `/about.html`
- No `@evjs/client`, `@evjs/server`, or generated `route-types.d.ts`
  dependency is needed for this router-free client output

Explicit `component`/`routes` config is a SPA-only route-tree input and is not
accepted as an MPA authoring model.
