# @evjs/manifest

Shared manifest schema types for the **ev** framework build system.

## Installation

```bash
npm install @evjs/manifest
```

## Purpose

Defines the structure of the unified manifest file emitted by `@evjs/webpack-plugin` and consumed by `@evjs/runtime`. A single `dist/manifest.json` contains both server and client build metadata:

## Manifest (v1)

```json
{
  "version": 1,
  "server": {
    "entry": "main.a1b2c3d4.js",
    "fns": {
      "<fnId>": {
        "moduleId": "f9b6...",
        "export": "getUsers"
      }
    }
  },
  "client": {
    "assets": {
      "js": ["main.abc123.js"],
      "css": ["main.def456.css"]
    },
    "routes": [
      { "path": "/" },
      { "path": "/posts/$postId" }
    ]
  }
}
```

## Exported Types

- **`Manifest`** — unified manifest (`dist/manifest.json`) with `server` and `client` sections.
- **`ServerManifestSection`** — server section (`{ entry, fns, rsc? }`).
- **`ClientManifestSection`** — client section (`{ assets: { js, css }, routes? }`).
- **`ServerFnEntry`** — server function metadata (`{ moduleId, export }`).
- **`RouteEntry`** — a discovered client route (`{ path }`).
- **`RscEntry`** — React Server Components (reserved for future).
- **`PageEntry`** — per-page assets for MPA (reserved for future).
- **`ServerManifest`** — deprecated alias, use `Manifest` instead.
- **`ClientManifest`** — deprecated alias, use `Manifest` instead.
