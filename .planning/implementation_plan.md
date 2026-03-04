# @evjs Implementation Plan (Client-First + Server Functions)

Provide a thin framework layer over `@tanstack/react-router` and `@tanstack/react-query`.

## Proposed Changes

### Core Foundation (`packages/runtime`)
#### [NEW] [create-app.ts](../packages/runtime/src/client/create-app.ts)
- `createApp()` factory to initialize router and query client.
#### [NEW] [route.ts](../packages/runtime/src/client/route.ts)
- Re-exports for route creation and navigation hooks.
#### [NEW] [handler.ts](../packages/runtime/src/server/handler.ts)
- Server-side RPC dispatcher for server functions.

### Build Infrastructure (`packages/webpack-plugin`)
#### [MODIFY] [server-fn-loader.ts](../packages/webpack-plugin/src/server-fn-loader.ts)
- Uses `@swc/core` for AST transformations.
- Generates stable SHA-256 function IDs based on relative paths.
- Strips bodies on client, wraps in registration on server.
#### [NEW] [index.ts](../packages/webpack-plugin/src/index.ts)
- `EvaiWebpackPlugin` for manifest generation.
- Emits `manifest.json` mapping stable IDs to assets.

### CLI Tooling (`packages/cli`)
#### [NEW] [package.json](../packages/cli/package.json)
- Registers `@evjscli` binary.
#### [NEW] [index.ts](../packages/cli/src/index.ts)
- `init`: Project scaffolding from templates.
- `dev`/`build`: Wrapped Webpack commands.

## Ongoing: Stage 3 — Server-Side Rendering (SSR)
### [Component Name] packages/runtime
#### [NEW] [server-entry.tsx](../packages/runtime/src/server/server-entry.tsx)
- Implement `renderToPipeableStream` for HTML streaming.
- Integrate with TanStack Router's server-side rendering logic.
