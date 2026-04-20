import {
  QueryClient,
  type QueryClientConfig,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { AnyRoute } from "@tanstack/react-router";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import type { AppRouteContext } from "./context";
import { initTransport } from "./transport";

/**
 * Options for creating an ev application.
 */
export interface CreateAppOptions<TRouteTree extends AnyRoute> {
  /** The root route tree produced by createRootRoute and addChildren. */
  routeTree: TRouteTree;
  /**
   * Optional configuration for the TanStack Query Client.
   */
  queryClientConfig?: QueryClientConfig;
  /**
   * server function endpoint path. When provided, automatically configures the transport.
   * Defaults to `/api/fn` if not specified.
   */
  endpoint?: string;
}

/**
 * An initialized ev application instance.
 *
 * Register the router type for full IDE type safety on `useParams`,
 * `useSearch`, `Link`, etc:
 *
 * ```tsx
 * const app = createApp({ routeTree });
 *
 * declare module "@tanstack/react-router" {
 *   interface Register {
 *     router: typeof app.router;
 *   }
 * }
 *
 * app.render("#app");
 * ```
 */
export interface App<TRouter> {
  /** The TanStack Router instance (use `typeof app.router` for type registration). */
  router: TRouter;
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
 * Register the router type globally for full IDE type-safety on
 * `useParams`, `useSearch`, `Link`, etc:
 *
 * @example
 * ```tsx
 * const app = createApp({ routeTree });
 *
 * declare module "@tanstack/react-router" {
 *   interface Register {
 *     router: typeof app.router;
 *   }
 * }
 *
 * app.render("#app");
 * ```
 */
export function createApp<TRouteTree extends AnyRoute>(
  options: CreateAppOptions<TRouteTree>,
) {
  const { routeTree, queryClientConfig, endpoint } = options;

  if (endpoint) {
    initTransport({ endpoint });
  }

  const queryClient = new QueryClient(queryClientConfig);

  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    context: { queryClient } as AppRouteContext,
  });

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
