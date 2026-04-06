# Quick Start

## Create a New Project

```bash
npx @evjs/create-app my-app
cd my-app && npm install
```

Both arguments are optional — if omitted, the CLI prompts interactively.

### Available Templates

| Template | Description |
|----------|-------------|
| `basic-csr` | Client-side rendering only, no server functions |
| `basic-server-fns` | Minimal server functions with `"use server"` |
| `configured-server-fns` | Server functions with `ev.config.ts` + Query proxy |
| `complex-routing` | Params, search, layouts, loaders, nested routes |
| `with-tailwind` | Tailwind CSS via plugin loaders |

## Development

```bash
ev dev
```

Your browser opens to `http://localhost:3000` with Hot Module Replacement. Server functions in `*.server.ts` files are auto-discovered — no config needed.

## Production Build

```bash
ev build
```

## Project Structure

```
my-app/
├── index.html              # HTML template (must have <div id="app">)
├── ev.config.ts            # Optional config
├── src/
│   ├── main.tsx            # App bootstrap
│   ├── global.ts           # Global typings & transport init
│   ├── routes.tsx          # Route tree + components
│   └── api/                # Server function files
│       └── *.server.ts
├── package.json
└── tsconfig.json
```

## App Bootstrap

```tsx
// src/main.tsx
import { createApp } from "@evjs/client";
import { routeTree } from "./routes";
import "./global";

const app = createApp({ routeTree });
app.render("#app");
```

```ts
// src/global.ts
import { initTransport } from "@evjs/client";

declare module "@tanstack/react-router" {
  interface Register {
    router: any;
  }
}
```

## Packages

| Package | Purpose |
|---------|---------|
| [`@evjs/cli`](https://github.com/evaijs/evjs/tree/main/packages/cli) | CLI binary (`ev dev`, `ev build`) |
| [`@evjs/ev`](https://github.com/evaijs/evjs/tree/main/packages/ev) | Config, plugin, and bundler types (`defineConfig`) |
| [`@evjs/create-app`](https://github.com/evaijs/evjs/tree/main/packages/create-app) | Project scaffolding (`npx @evjs/create-app`) |
| [`@evjs/client`](https://github.com/evaijs/evjs/tree/main/packages/client) | Client runtime (React + TanStack) |
| [`@evjs/server`](https://github.com/evaijs/evjs/tree/main/packages/server) | Server runtime (Hono) |
| [`@evjs/build-tools`](https://github.com/evaijs/evjs/tree/main/packages/build-tools) | Server function transforms |
| [`@evjs/bundler-webpack`](https://github.com/evaijs/evjs/tree/main/packages/bundler-webpack) | Webpack adapter |
| [`@evjs/manifest`](https://github.com/evaijs/evjs/tree/main/packages/manifest) | Shared manifest schema |

## Required Dependencies

```json
{
  "dependencies": {
    "@evjs/client": "0.0.0",
    "@evjs/server": "0.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@evjs/cli": "*",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^6.0.2"
  }
}
```

## Key Rules

- Config file: `ev.config.ts` (not `evjs.config.ts`)
- Import `defineConfig` from `@evjs/ev`, not from `@evjs/server`
- HTML must have `<div id="app">` for the render target
- Do NOT add `"type": "module"` to your **project's** `package.json` — the server bundle uses CJS format
- `src/main.tsx` should be minimal — define routes in `routes.tsx`
