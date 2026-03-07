import {
  QueryClient,
  type QueryClientConfig,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { AnyRoute, AnyRouter } from "@tanstack/react-router";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { initTransport } from "./transport";

/**
 * Options for creating an ev application.
 */
export interface CreateAppOptions<TRouteTree extends AnyRoute> {
  /** The root route tree produced by createRootRoute and addChildren. */
  routeTree: TRouteTree;
  /**
   * Optional configuration for the TanStack Router.
   */
  routerOptions?: Omit<
    Parameters<typeof import("@tanstack/react-router").createRouter>[0],
    "routeTree"
  >;
  /**
   * Optional configuration for the TanStack Query Client.
   */
  queryClientConfig?: QueryClientConfig;
  /**
   * RPC endpoint path. When provided, automatically configures the transport.
   * Defaults to `/api/rpc` if not specified.
   */
  rpcEndpoint?: string;
}

/**
 * An initialized ev application instance.
 */
export interface App {
  /** The TanStack Router instance. */
  router: AnyRouter;
  /** The TanStack Query Client instance. */
  queryClient: QueryClient;
  /**
   * Mount the application into the DOM.
   * @param container - A CSS selector string or an HTMLElement.
   */
  render(container: string | HTMLElement): void;
}

/**
 * Create a new ev application instance.
 *
 * This function initializes the router and query client and returns
 * an app object that can be mounted into the DOM.
 *
 * @param options - Application configuration options.
 * @returns An initialized App instance.
 *
 * @example
 * ```tsx
 * const app = createApp({ routeTree });
 * app.render("#app");
 * ```
 */
export function createApp<TRouteTree extends AnyRoute>(
  options: CreateAppOptions<TRouteTree>,
): App {
  const { routeTree, routerOptions, queryClientConfig, rpcEndpoint } = options;

  if (rpcEndpoint) {
    initTransport({ endpoint: rpcEndpoint });
  }

  const queryClient = new QueryClient(queryClientConfig);

  const router = createRouter({
    ...routerOptions,
    routeTree,
    context: { queryClient, ...routerOptions?.context },
  } as Parameters<typeof createRouter>[0]);

  function render(container: string | HTMLElement): void {
    const el =
      typeof container === "string"
        ? document.querySelector<HTMLElement>(container)
        : container;

    if (!el) {
      throw new Error(
        `[ev] Could not find container element: ${String(container)}`,
      );
    }

    const root = createRoot(el);
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  return { router, queryClient, render };
}
