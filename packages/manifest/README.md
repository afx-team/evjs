# @evjs/manifest

Shared manifest schema types for the **evjs** fullstack framework.

## Installation

```bash
npm install @evjs/manifest
```

## Purpose

Defines the structure of the manifest files emitted by `@evjs/bundler-utoopack` and consumed by `@evjs/client` and `@evjs/server`. Two separate manifests are emitted during the build:

## Server Manifest (`dist/server/manifest.json`)

```json
{
  "version": 1,
  "entry": "main.a1b2c3d4.js",
  "assets": {
    "js": ["main.a1b2c3d4.js"],
    "css": []
  },
  "fns": {
    "<fnId>": {
      "assets": {
        "js": ["main.a1b2c3d4.js"],
        "css": []
      }
    }
  },
  "routes": [
    {
      "path": "/api/users",
      "methods": ["GET", "POST"],
      "assets": {
        "js": ["main.a1b2c3d4.js"],
        "css": []
      }
    }
  ]
}
```

## Client Manifest (`dist/client/manifest.json`)

```json
{
  "version": 1,
  "assets": {
    "js": ["main.abc123.js"],
    "css": ["main.def456.css"]
  },
  "routes": [
    { "path": "/" },
    { "path": "/posts/$postId" }
  ]
}
```

## Exported Types

- **`ManifestAssets`** — emitted asset lists (`{ js, css }`).
- **`ServerManifest`** — server manifest (`dist/server/manifest.json`) with `entry`, `assets`, `fns`, and optional `routes`.
- **`ClientManifest`** — client manifest (`dist/client/manifest.json`) with `assets` and optional `routes`.
- **`ServerFnEntry`** — server function metadata (`{ assets }`), keyed by function ID.
- **`ServerRouteEntry`** — server route handler metadata (`{ path, methods, assets }`).
- **`RouteEntry`** — a discovered client route (`{ path }`).
