# Walkthrough — @evjs Router Framework

## What was built

A minimal framework skeleton in `@evjs/runtime` that wraps **TanStack Router** and **React Query** behind an opinionated `createApp()` API.

## Key Files

| File | Purpose |
|------|---------|
| [route.ts](../packages/runtime/src/client/route.ts) | Re-exports of route creation APIs from `@tanstack/react-router` |
| [create-app.tsx](../packages/runtime/src/client/create-app.tsx) | `createApp()` factory — creates Router + QueryClient |
| [handler.ts](../packages/runtime/src/server/handler.ts) | Server-side RPC dispatcher for server functions |

## Consumer usage

```tsx
import { createApp, createRoute } from "@evjs/runtime";

const app = createApp({ routeTree });
app.render("#app");
```

## Verification

- `tsc --noEmit`: Verified framework types are coherent.
- `evcli build`: Successfully generates bundles and `manifest.json`.
- `evcli dev`: Launches dev server with HR.
