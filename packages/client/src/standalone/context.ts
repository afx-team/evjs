import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";

/** Default context available in route loaders. */
export interface AppRouteContext {
  queryClient: QueryClient;
}

/**
 * Create a root route with the app's default query client context.
 */
export const createAppRootRoute = createRootRouteWithContext<AppRouteContext>();
