import { EVJS_QUERY_DEHYDRATION_KEY } from "@evjs/shared";
import {
  hydrate as hydrateQueryClient,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type {
  AnyRoute,
  RouterConstructorOptions,
  RouterHistory,
  TrailingSlashOption,
} from "@tanstack/react-router";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { RouterClient } from "@tanstack/react-router/ssr/client";
import { Component, type ErrorInfo, type ReactNode, useRef } from "react";
import type { ErrorInfo as HydrationRootErrorInfo } from "react-dom/client";
import { createRoot, hydrateRoot } from "react-dom/client";
import type { AppRouteContext } from "./context";

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

export interface HydrationErrorContext {
  /**
   * `recoverable` is reported by React when hydration can continue.
   * `fallback` means ev switched from `RouterClient` hydration to CSR.
   */
  phase: "recoverable" | "fallback";
  errorInfo?: ErrorInfo | HydrationRootErrorInfo;
}

export type HydrationErrorHandler = (
  error: unknown,
  context: HydrationErrorContext,
) => void;

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
  /**
   * Hydration strategy used by `app.render()`.
   *
   * `auto` hydrates when the target container already has server-rendered
   * children and falls back to CSR otherwise.
   */
  hydrate?: boolean | "auto";
  /**
   * Called when React reports a recoverable hydration mismatch or when ev
   * falls back from SSR hydration to client rendering.
   */
  onHydrationError?: HydrationErrorHandler;
}

export interface RenderOptions {
  /** Overrides the hydration strategy configured in `createApp()`. */
  hydrate?: boolean | "auto";
}

function hydrateEvQueryState(queryClient: QueryClient, dehydrated: unknown) {
  if (!dehydrated || typeof dehydrated !== "object") return;

  const state = (dehydrated as Record<string, unknown>)[
    EVJS_QUERY_DEHYDRATION_KEY
  ];
  if (state) {
    hydrateQueryClient(queryClient, state);
  }
}

interface HydrationErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  onError: (error: unknown, errorInfo: ErrorInfo) => void;
}

interface HydrationErrorBoundaryState {
  didFail: boolean;
}

class HydrationErrorBoundary extends Component<
  HydrationErrorBoundaryProps,
  HydrationErrorBoundaryState
> {
  state: HydrationErrorBoundaryState = { didFail: false };

  static getDerivedStateFromError(): HydrationErrorBoundaryState {
    return { didFail: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    this.props.onError(error, errorInfo);
  }

  render() {
    return this.state.didFail ? this.props.fallback : this.props.children;
  }
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
  render(container: string | HTMLElement, options?: RenderOptions): void;
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
    hydrate = "auto",
    basepath,
    history,
    router: routerOptions,
    onHydrationError,
  } = options;

  const userHydrate = routerOptions?.hydrate;

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
    hydrate: async (dehydrated) => {
      hydrateEvQueryState(queryClient, dehydrated);
      await userHydrate?.(dehydrated);
    },
  });

  let root: ReturnType<typeof createRoot> | undefined;

  function reportHydrationError(
    error: unknown,
    context: HydrationErrorContext,
  ) {
    onHydrationError?.(error, context);
  }

  function prepareHydrationFallback() {
    // TanStack Router sets these while hydrating. Clear them before falling
    // back to CSR so RouterProvider can run the normal client load path.
    const mutableRouter = router as typeof router & { ssr?: unknown };
    mutableRouter.ssr = undefined;
    (
      mutableRouter.options as typeof mutableRouter.options & {
        ssr?: unknown;
      }
    ).ssr = undefined;
  }

  function ClientRenderFallback() {
    const prepared = useRef(false);
    if (!prepared.current) {
      prepared.current = true;
      prepareHydrationFallback();
    }

    return <RouterProvider router={router} />;
  }

  function shouldHydrate(
    el: HTMLElement,
    option: boolean | "auto" | undefined,
    hasRouterSsrPayload: boolean,
  ): boolean {
    if (option === true) return true;
    if (option === false) return false;
    return el.hasChildNodes() && hasRouterSsrPayload;
  }

  function render(
    container: string | HTMLElement,
    options?: RenderOptions,
  ): void {
    const el =
      typeof container === "string"
        ? document.querySelector<HTMLElement>(container)
        : container;

    if (!el) {
      throw new Error(
        `[ev] Could not find container element: ${String(container)}`,
      );
    }

    const hasRouterSsrPayload =
      typeof window !== "undefined" &&
      Boolean((window as unknown as { $_TSR?: unknown }).$_TSR);
    const shouldHydrateRoot = shouldHydrate(
      el,
      options?.hydrate ?? hydrate,
      hasRouterSsrPayload,
    );

    const app = (
      <QueryClientProvider client={queryClient}>
        {shouldHydrateRoot && hasRouterSsrPayload ? (
          <HydrationErrorBoundary
            fallback={<ClientRenderFallback />}
            onError={(error, errorInfo) =>
              reportHydrationError(error, {
                phase: "fallback",
                errorInfo,
              })
            }
          >
            <RouterClient router={router} />
          </HydrationErrorBoundary>
        ) : (
          <RouterProvider router={router} />
        )}
      </QueryClientProvider>
    );

    if (shouldHydrateRoot) {
      try {
        root = hydrateRoot(el, app, {
          onRecoverableError: (error, errorInfo) => {
            reportHydrationError(error, {
              phase: "recoverable",
              errorInfo,
            });
          },
        });
      } catch (error) {
        reportHydrationError(error, { phase: "fallback" });
        root = createRoot(el);
        root.render(
          <QueryClientProvider client={queryClient}>
            <ClientRenderFallback />
          </QueryClientProvider>,
        );
      }
      return;
    }

    root = createRoot(el);
    root.render(app);
  }

  function unmount(): void {
    root?.unmount();
    root = undefined;
  }

  return { router, queryClient, render, unmount };
}
