# Build

## Command

```bash
ev build
```

Sets `NODE_ENV=production` and produces optimized bundles.

## Output Structure

```
dist/
├── client/
│   ├── manifest.json       # Client asset map + route metadata
│   ├── index.html          # Generated HTML
│   ├── main.[hash].js      # Client bundle
│   └── [chunk].[hash].js   # Code-split chunks
└── server/
    ├── manifest.json       # Server function registry
    └── main.[hash].js      # Server function bundle (CJS)
```

## What Happens During Build

### Server Function Transform

Files with `"use server"` are automatically processed with dual transforms:

| Side | What happens |
|------|-------------|
| **Client** | Function bodies are replaced with `__fn_call(fnId, args)` RPC stubs |
| **Server** | Original function bodies are preserved + `registerServerFn(fnId, fn)` injected |

Function IDs are stable SHA-256 hashes derived from `filePath + exportName`.

### Build Pipeline

1. `loadConfig(cwd)` — loads `ev.config.ts` or convention-based defaults
2. `createWebpackConfig(config, cwd)` — generates webpack config (no temp files)
3. Calls `webpack()` Node API directly
4. `@evjs/bundler-webpack` runs during compilation:
   - Discovers `*.server.ts` files via glob
   - Applies SWC transforms (client + server variants)
   - Runs child compiler for server bundle
   - Emits `dist/server/manifest.json` (function registry) and `dist/client/manifest.json` (asset map + routes)

## Server Manifest (`dist/server/manifest.json`)

Contains the server function registry:

```json
{
  "version": 1,
  "entry": "main.a1b2c3d4.js",
  "fns": {
    "a1b2c3d4": { "moduleId": "f9b6...", "export": "getUsers" }
  }
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
