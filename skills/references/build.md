# Build (`ev build`)

## Command

```bash
ev build
```

Sets `NODE_ENV=production` and produces optimized bundles.

## Output Structure

```
dist/
├── manifest.json           # Server function registry
├── client/
│   ├── index.html          # Generated HTML
│   ├── main.[hash].js      # Client bundle
│   └── [chunk].[hash].js   # Code-split chunks
└── server/
    └── server.js           # Server function bundle (CJS)
```

## Running in Production

```ts
// start.js
const bundle = require("./dist/server/server.js");
const app = bundle.createApp(); // uses DEFAULT_ENDPOINT from @evjs/shared

const { serve } = require("@evjs/server/node");
serve(app, { port: 3001 });
```

For ECMA-based runtimes (Deno, Bun):

```ts
import { createFetchHandler } from "@evjs/server/ecma";
const app = bundle.createApp();
export default createFetchHandler(app);
```

## Server Functions in the Build

Files with `"use server"` are automatically processed:

| Side | What happens |
|------|-------------|
| **Client** | Function bodies are replaced with RPC stubs that call the server |
| **Server** | Functions are registered with unique IDs in the function registry |

## Key Points

- Works out of the box with convention-based defaults
- Client bundles use content-hash filenames for cache busting
- Server bundle externalizes `node_modules` (except `@evjs/*` packages)
- `dist/manifest.json` maps function IDs to their module and export names
