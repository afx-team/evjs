---
name: evjs-build
description: Guide on the `ev build` production build process and output structure.
---

# Instruction

Use this skill when helping a user build an evjs project for production or understand the output.

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
const app = bundle.createApp({ endpoint: "/api/fn" });

const { serve } = require("@evjs/runtime/server/node");
serve(app, { port: 3001 });
```

For ECMA-based runtimes (Deno, Bun, Cloudflare Workers):

```ts
import { createFetchHandler } from "@evjs/runtime/server/ecma";
const app = bundle.createApp({ endpoint: "/api/fn" });
export default createFetchHandler(app);
```

## Server Functions in the Build

Files with `"use server"` are automatically processed:

| Side | What happens |
|------|-------------|
| **Client** | Function bodies are replaced with RPC stubs that call the server |
| **Server** | Functions are registered with unique IDs in the function registry |

## Key Points

- No configuration needed — works zero-config out of the box
- Client bundles use content-hash filenames for cache busting
- Server bundle externalizes `node_modules` (except `@evjs/*` packages)
- `dist/manifest.json` maps function IDs to their module and export names
