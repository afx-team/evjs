# Build

## Command

```bash
ev build
```

Sets `NODE_ENV=production` and produces optimized bundles.

## Output Structure

### Fullstack (default)

```
dist/
├── client/
│   ├── manifest.json       # Client asset map + route metadata
│   ├── index.html          # Generated HTML
│   ├── main.[hash].js      # Client bundle
│   └── [chunk].[hash].js   # Code-split chunks
└── server/
    ├── manifest.json       # Server function + route registry
    └── main.[hash].js      # Server function bundle (CJS)
```

### CSR-only (`server: false`)

When `server: false` is set in `ev.config.ts`, the output is flat:

```
dist/
├── manifest.json         # Client asset map + route metadata
├── index.html            # Generated HTML
├── main.[hash].js        # Client bundle
└── [chunk].[hash].js     # Code-split chunks
```

> **Note:** With `server: false`, any `"use server"` module will cause a build error.

## What Happens During Build

### Server Function Transform

Files with `"use server"` are automatically processed with dual transforms:

| Side | What happens |
|------|-------------|
| **Client** | Function bodies are replaced with `createServerReference()` RPC stubs |
| **Server** | Original function bodies are preserved + `registerServerReference()` injected |

Function IDs use the same algorithm as Utoopack server references: `sha256(moduleId + "#" + exportName)`, truncated to 16 hex characters. The manifest generator analyzes source exports and uses Utoopack `stats.json` module IDs when available, so the IDs match the values emitted in client stubs and server registration code.

### Build Pipeline

1. `loadConfig(cwd)` — loads `ev.config.ts` or convention-based defaults
2. `BundlerAdapter.build()` — generates bundler config and runs compilation
3. The active bundler adapter runs during compilation:
   - Runs the client and server bundle compilation
   - Reads Utoopack stats for emitted asset names and module IDs
   - Analyzes source files for client routes, server routes, and `"use server"` exports
   - Computes function IDs with Utoopack-compatible module ID hashing
   - Emits `dist/server/manifest.json` (function + route registry) and `dist/client/manifest.json` (asset map + client routes)

## Server Manifest (`dist/server/manifest.json`)

Contains the server function and route handler registry:

```json
{
  "version": 1,
  "entry": "main.a1b2c3d4.js",
  "assets": {
    "js": ["main.a1b2c3d4.js"],
    "css": []
  },
  "fns": {
    "a1b2c3d4": {
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

Contains client build metadata:

```json
{
  "version": 1,
  "assets": { "js": ["main.abc123.js"], "css": ["styles.def456.css"] },
  "routes": [{ "path": "/" }, { "path": "/users" }, { "path": "/posts/$postId" }]
}
```

## Key Points

- Works out of the box with convention-based defaults
- Client bundles use content-hash filenames for cache busting
- Server bundle externalizes `node_modules` (except `@evjs/*` packages)
- No temp config files — webpack is driven via Node API
