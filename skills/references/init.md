# Init Reference

## Scaffolding

```bash
npx @evjs/cli init my-app
cd my-app
npm install  # or tnpm install
```

Both arguments are optional — if omitted, the CLI prompts interactively.

## Available Templates

Templates available via `ev init`:

| Template | Description |
|----------|-------------|
| `basic-csr` | Client-side rendering only, no server functions |
| `basic-server-fns` | Minimal server functions with `"use server"` |
| `configured-server-fns` | Server functions with `ev.config.ts` + Query proxy |
| `complex-routing` | Params, search, layouts, loaders, nested routes |
| `with-tailwind` | Tailwind CSS via plugin loaders (`ev.config.ts`) |

Additional examples in the `examples/` directory (not in `ev init`):

| Example | Description |
|---------|-------------|
| `server-fns-query` | Advanced query/mutation patterns and prefetching |
| `sqlite-server-fns` | Server functions with `node:sqlite` database |
| `trpc-server-fns` | tRPC integration with server functions |
| `websocket-fns` | WebSocket transport for server functions |
| `basic-fns-ecma` | ECMA adapter (Deno/Bun) deployment |

## Project Structure

```
my-app/
├── index.html              # HTML template (must have <div id="app">)
├── ev.config.ts            # optional config
├── src/
│   ├── main.tsx            # app bootstrap (keep minimal)
│   ├── global.ts           # global typings & transport init
│   ├── routes.tsx          # route tree + components
│   └── api/                # server function files
│       └── *.server.ts
├── package.json
└── tsconfig.json
```

## App Bootstrap (`src/main.tsx`)

Minimal bootstrap that imports global configuration:

```tsx
// src/main.tsx
import { createApp } from "@evjs/runtime/client";
import { routeTree } from "./routes";
import "./global"; // Initialize transport & typings

const app = createApp({ routeTree });
app.render("#app");
```

```tsx
// src/global.ts
import { initTransport } from "@evjs/runtime/client";

// Global TanStack Router registration
declare module "@tanstack/react-router" {
  interface Register {
    router: any; 
  }
}

// Global transport configuration (optional here, see deploy.md)
// initTransport({ ... });
```

## Required Dependencies

```json
{
  "dependencies": {
    "@evjs/runtime": "*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@evjs/cli": "*",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

## Key Rules

- Config file: `ev.config.ts` (not `evjs.config.ts`)
- Import `defineConfig` from `@evjs/cli`, not `@evjs/runtime`
- HTML must have `<div id="app">` for the render target
- Do NOT add `"type": "module"` to `package.json` — the server bundle uses CommonJS
- `src/main.tsx` should be kept minimal — define routes in `routes.tsx`
- Global typings and transport init go in `src/global.ts`, imported by `main.tsx`
