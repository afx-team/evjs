import {
  QueryClient,
  type QueryClientConfig,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { AnyRoute, AnyRouter } from "@tanstack/react-router";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";

export interface CreateAppOptions<TRouteTree extends AnyRoute> {
  routeTree: TRouteTree;
  routerOptions?: Omit<
    Parameters<typeof import("@tanstack/react-router").createRouter>[0],
    "routeTree"
  >;
  queryClientConfig?: QueryClientConfig;
}

export interface App {
  router: AnyRouter;
  queryClient: QueryClient;
  render(container: string | HTMLElement): void;
}

export function createApp<TRouteTree extends AnyRoute>(
  options: CreateAppOptions<TRouteTree>,
): App {
  const { routeTree, routerOptions, queryClientConfig } = options;

  const queryClient = new QueryClient(queryClientConfig);

  const router = createRouter({
    ...routerOptions,
    routeTree,
  } as Parameters<typeof createRouter>[0]);

  function render(container: string | HTMLElement): void {
    const el =
      typeof container === "string"
        ? document.querySelector<HTMLElement>(container)
        : container;

    if (!el) {
      throw new Error(
        `[evai] Could not find container element: ${String(container)}`,
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
