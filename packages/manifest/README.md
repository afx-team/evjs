# @evjs/manifest

Shared manifest schema types for the **evjs** fullstack framework.

## Installation

```bash
npm install @evjs/manifest
```

## Purpose

Defines the structure of the manifest files emitted by `@evjs/bundler-webpack` and consumed by `@evjs/client` and `@evjs/server`. Two separate manifests are emitted during the build:

## Server Manifest (`dist/server/manifest.json`)

```json
{
  "version": 1,
  "entry": "main.a1b2c3d4.js",
  "fns": {
    "<fnId>": {
      "moduleId": "f9b6...",
      "export": "getUsers"
    }
  }
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

- **`ServerManifest`** — server manifest (`dist/server/manifest.json`) with `entry`, `fns`, and optional `rsc`.
- **`ClientManifest`** — client manifest (`dist/client/manifest.json`) with `assets` and optional `routes`.
- **`ServerFnEntry`** — server function metadata (`{ moduleId, export }`).
- **`RouteEntry`** — a discovered client route (`{ path }`).
- **`RscEntry`** — React Server Components (reserved for future).
