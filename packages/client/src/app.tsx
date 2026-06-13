import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnyRoute } from "@tanstack/react-router";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";

/**
 * Options for creating a framework-owned SPA runtime.
 */
export interface CreateAppOptions<TRouteTree extends AnyRoute> {
  /** The root route tree assembled by the generated page-route bootstrap. */
  routeTree: TRouteTree;
  /**
   * Optional custom QueryClient instance.
   */
  queryClient?: QueryClient;
}

/**
 * An initialized framework-owned SPA runtime.
 */
export interface App {
  /** The TanStack Query Client instance. */
  queryClient: QueryClient;
  /**
   * Mount the application into the DOM.
   * @param container - A CSS selector string or an HTMLElement.
   */
  render(container: string | HTMLElement): void;
  /**
   * Unmount the application from the DOM.
   */
  unmount(): void;
}

/**
 * Create a framework-owned SPA runtime from the generated page route tree.
 */
export function createApp<TRouteTree extends AnyRoute>(
  options: CreateAppOptions<TRouteTree>,
): App {
  const { routeTree, queryClient = new QueryClient() } = options;

  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    context: { queryClient },
  });

  let root: ReturnType<typeof createRoot> | undefined;

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

    root = createRoot(el);
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  function unmount(): void {
    root?.unmount();
    root = undefined;
  }

  return { queryClient, render, unmount };
}
