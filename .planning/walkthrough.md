# Walkthrough — Client-Only Router Framework

## What was built

A minimal framework skeleton in `@evai/shell` that wraps **TanStack Router** (code-based routing) and **React Query** behind an opinionated `createApp()` API.

## Files created

| File | Purpose |
|------|---------|
| [route.ts](file:///Users/xusd320/Codes/github/evai/packages/shell/src/client/route.ts) | Re-exports of route creation APIs, components, hooks, and types from `@tanstack/react-router` |
| [create-app.tsx](file:///Users/xusd320/Codes/github/evai/packages/shell/src/client/create-app.tsx) | `createApp()` factory — creates Router + QueryClient, returns `{ router, queryClient, render() }` |
| [client/index.tsx](file:///Users/xusd320/Codes/github/evai/packages/shell/src/client/index.tsx) | Barrel export for the client module |
| [src/index.ts](file:///Users/xusd320/Codes/github/evai/packages/shell/src/index.ts) | Root barrel — re-exports from `./client/` |

## Consumer usage

```tsx
import {
  createApp,
  createRootRoute,
  createRoute,
  Outlet,
  Link,
} from "@evai/shell";

const rootRoute = createRootRoute({
  component: () => (
    <div>
      <nav><Link to="/">Home</Link></nav>
      <Outlet />
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <h1>Welcome</h1>,
});

const routeTree = rootRoute.addChildren([indexRoute]);

const app = createApp({ routeTree });
app.render("#app");
```

## Verification

```
$ npm run check-types

• turbo 2.8.13
• Packages in scope: @evai/shell
• Running check-types in 1 packages

@evai/shell:check-types: > tsc --noEmit

 Tasks:    1 successful, 1 total
```
