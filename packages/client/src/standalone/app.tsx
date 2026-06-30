import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AnyRoute,
  RouterConstructorOptions,
  RouterHistory,
  TrailingSlashOption,
} from "@tanstack/react-router";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { formatErrorDetail } from "../shared/validation.js";
import type { AppRouteContext } from "./context.js";

/**
 * Router options available to standalone CSR applications.
 */
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
 * Options for creating a standalone or framework-owned SPA runtime.
 */
export interface CreateAppOptions<
  TRouteTree extends AnyRoute,
  TTrailingSlashOption extends TrailingSlashOption = "never",
  TDefaultStructuralSharingOption extends boolean = false,
  TRouterHistory extends RouterHistory = RouterHistory,
  TDehydrated extends Record<string, unknown> = Record<string, unknown>,
> {
  /** The root route tree assembled by application code or generated bootstrap. */
  routeTree: TRouteTree;
  /**
   * The base path for the application.
   */
  basepath?: string;
  /**
   * Optional custom history for the router, such as memory or hash history.
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
 * An initialized standalone or framework-owned SPA runtime.
 */
export interface App<TRouter = unknown> {
  /** The TanStack Router instance. */
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
 * Create a standalone or framework-owned SPA runtime from a route tree.
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
    const el = resolveAppContainer(container);

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

function resolveAppContainer(container: string | HTMLElement): HTMLElement {
  if (typeof container === "string") {
    const selector = assertAppContainerSelector(container);
    const doc = resolveAppDocument(selector);
    let element: HTMLElement | null;
    try {
      element = doc.querySelector<HTMLElement>(selector);
    } catch (error) {
      throw new Error(
        `[evjs] App container selector "${selector}" is invalid${formatErrorDetail(error)}`,
      );
    }
    if (!element) {
      throw new Error(
        `[evjs] Could not find app container element: ${selector}`,
      );
    }
    return element;
  }

  if (!container || typeof container !== "object") {
    throw new Error(
      "[evjs] App container must be a selector string or HTMLElement.",
    );
  }
  return container;
}

function assertAppContainerSelector(selector: string): string {
  if (!selector.trim()) {
    throw new Error(
      "[evjs] App container selector must be a non-empty string.",
    );
  }
  if (selector.trim() !== selector) {
    throw new Error(
      "[evjs] App container selector must not include leading or trailing whitespace.",
    );
  }
  return selector;
}

function resolveAppDocument(selector: string): Document {
  const doc = globalThis.document;
  if (!doc) {
    throw new Error(
      `[evjs] Document is not available to resolve app container selector "${selector}".`,
    );
  }
  if (typeof doc.querySelector !== "function") {
    throw new Error(
      "[evjs] App container selector document.querySelector must be a function.",
    );
  }
  return doc;
}
