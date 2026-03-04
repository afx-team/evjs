# Client-First Framework Skeleton (`@evai/runtime`)

Provide a thin framework layer over `@tanstack/react-router` (code-based routing) and `@tanstack/react-query`. The goal is a minimal but opinionated `createApp()` API that wires up the router, query client, and DOM rendering in one call, prioritizing client-centric rendering but laying the groundwork for future SSR support.

## Proposed Changes

### `packages/runtime/src/client/`

#### [NEW] [create-app.ts](file:///Users/xusd320/Codes/github/evai/packages/runtime/src/client/create-app.ts)

The main framework entry point. Exports `createApp(opts)` which:
1. Accepts a `routeTree` (built by the consumer using `createRootRoute` / `createRoute` / `addChildren`)
2. Accepts optional `router` overrides (e.g. `defaultPreload`, `defaultErrorComponent`)
3. Creates a `QueryClient` and a TanStack `Router` internally
4. Returns an object with a `render(elementOrId)` method that calls `ReactDOM.createRoot` and renders `createElement(QueryClientProvider, ..., createElement(RouterProvider, ...))`

```ts
interface CreateAppOptions {
  routeTree: AnyRoute
  router?: Partial<RouterConstructorOptions<...>>  // forwarded overrides
  queryClient?: QueryClientOptions
}

interface App {
  router: AnyRouter
  queryClient: QueryClient
  render(container: string | HTMLElement): void
}
```

#### [NEW] [route.ts](file:///Users/xusd320/Codes/github/evai/packages/runtime/src/client/route.ts)

Convenience re-exports for route creation APIs:
- `createRootRoute`, `createRoute`, `createRootRouteWithContext`
- `Outlet`, `Link`, `linkOptions`
- Common hooks: `useMatch`, `useParams`, `useSearch`, `useNavigate`, `useRouter`, `useRouterState`, `useLoaderData`, `useLoaderDeps`, `useRouteContext`, `useLocation`

#### [NEW] [index.ts](file:///Users/xusd320/Codes/github/evai/packages/runtime/src/client/index.ts)

Barrel export that re-exports everything from `./create-app.ts` and `./route.ts`.

## Stage 2.5: Production Manifest & Stable IDs

To support production builds with hashed filenames, we need stable identifiers for server functions and a manifest to map them to their implementations.

### [Component Name] @evai/webpack-plugin
#### [MODIFY] [server-fn-loader.ts](file:///Users/xusd320/Codes/github/evai/packages/webpack-plugin/src/server/server-fn-loader.ts)
- Generate stable IDs using a hash of the relative module path and export name.
- Pass metadata to the `EvaiWebpackPlugin`.

#### [NEW] [index.ts](file:///Users/xusd320/Codes/github/evai/packages/webpack-plugin/src/index.ts)
- Implement `EvaiWebpackPlugin`.
- Collect server function metadata.
- Emit `evai-manifest.json`.

### [Component Name] @evai/runtime
#### [MODIFY] [handler.ts](file:///Users/xusd320/Codes/github/evai/packages/runtime/src/server/handler.ts)
- Add support for loading the manifest to resolve functions if needed (optional for now, registration works well for eager loads).

---

### `packages/runtime/src/`

#### [MODIFY] [index.ts](file:///Users/xusd320/Codes/github/evai/packages/runtime/src/index.ts)

Re-export `./client/index.ts` so consumers can import from `@evai/runtime` directly for now.

## Verification Plan

### Automated Tests
- Run `npm run check-types` from the repo root (Turborepo orchestrated `tsc --noEmit` on `@evai/runtime`). This validates that all imports from `@tanstack/react-router` and `@tanstack/react-query` resolve correctly and the public API types are coherent.

### Manual Verification
- Build `examples/basic-server-fns` with hashed filenames enabled (`[contenthash]`).
- Verify `evai-manifest.json` is generated.
- Verify that the server can still execute functions using the stable IDs.
