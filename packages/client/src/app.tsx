import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AnyRoute,
  RouterConstructorOptions,
  RouterHistory,
  TrailingSlashOption,
} from "@tanstack/react-router";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import type { AppRouteContext } from "./context.js";

export type CreateAppRouterOptions<
  TRouteTree extends AnyRoute,
  TTrailingSlashOption extends TrailingSlashOption = "never",
  TDefaultStructuralSharingOption extends boolean = false,
  TRouterHistory extends RouterHistory = RouterHistory,
  TDehydrated extends Record<string, unknown> = Record<string, unknown>,
> = Omit<
  RouterConstructorOptions<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TRouterHistory,
    TDehydrated
  >,
  "context" | "routeTree"
>;

/**
 * Options for creating an ev application.
 */
export interface CreateAppOptions<
  TRouteTree extends AnyRoute,
  TTrailingSlashOption extends TrailingSlashOption = "never",
  TDefaultStructuralSharingOption extends boolean = false,
  TRouterHistory extends RouterHistory = RouterHistory,
  TDehydrated extends Record<string, unknown> = Record<string, unknown>,
> {
  /** The root route tree produced by createRootRoute and addChildren. */
  routeTree: TRouteTree;
  /**
   * The base path for the application (e.g., '/app').
   */
  basepath?: string;
  /**
   * Optional custom history for the router (e.g., memory or hash history).
   */
  history?: TRouterHistory;
  /** TanStack Router options passed through to `createRouter()`. */
  router?: CreateAppRouterOptions<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TRouterHistory,
    TDehydrated
  >;
  /**
   * Optional custom QueryClient instance.
   */
  queryClient?: QueryClient;
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
 * declare module "@evjs/client" {
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
  /**
   * Unmount the application from the DOM.
   */
  unmount(): void;
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
 * declare module "@evjs/client" {
 *   interface Register {
 *     router: typeof app.router;
 *   }
 * }
 *
 * app.render("#app");
 * ```
 */
export function createApp<
  TRouteTree extends AnyRoute,
  TTrailingSlashOption extends TrailingSlashOption = "never",
  TDefaultStructuralSharingOption extends boolean = false,
  TRouterHistory extends RouterHistory = RouterHistory,
  TDehydrated extends Record<string, unknown> = Record<string, unknown>,
>(
  options: CreateAppOptions<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TRouterHistory,
    TDehydrated
  >,
): App<
  ReturnType<
    typeof createRouter<
      TRouteTree,
      TTrailingSlashOption,
      TDefaultStructuralSharingOption,
      TRouterHistory,
      TDehydrated
    >
  >
> {
  const {
    routeTree,
    queryClient = new QueryClient(),
    basepath,
    history,
    router: routerOptions,
  } = options;

  const router = createRouter<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TRouterHistory,
    TDehydrated
  >({
    ...routerOptions,
    routeTree,
    basepath: routerOptions?.basepath ?? basepath,
    history: routerOptions?.history ?? history,
    defaultPreload: routerOptions?.defaultPreload ?? "intent",
    context: { queryClient } as AppRouteContext,
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

  return { router, queryClient, render, unmount };
}
