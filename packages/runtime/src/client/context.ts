import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";

/** Default context available in route loaders. */
export interface AppRouteContext {
  queryClient: QueryClient;
}

/**
 * Create a root route with the app's default context (queryClient).
 *
 * Use this instead of `createRootRoute` when you want typed access
 * to `context.queryClient` in `loader` / `beforeLoad`.
 *
 * @example
 * ```tsx
 * const rootRoute = createAppRootRoute({ component: Root });
 *
 * const usersRoute = createRoute({
 *   getParentRoute: () => rootRoute,
 *   path: "/users",
 *   loader: ({ context }) =>
 *     context.queryClient.ensureQueryData(query(getUsers).queryOptions([])),
 * });
 * ```
 */
export const createAppRootRoute = createRootRouteWithContext<AppRouteContext>();
