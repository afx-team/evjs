import { parsePageSearch } from "@evjs/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AnyRoute,
  AnyRouter,
  RouterConstructorOptions,
  RouterHistory,
  TrailingSlashOption,
} from "@tanstack/react-router";
import {
  createRouter,
  RouterProvider,
  stringifySearchWith,
} from "@tanstack/react-router";
import {
  type ComponentType,
  createElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { formatErrorDetail } from "../shared/validation.js";
import type { AppRouteContext } from "./context.js";

const stringifyRawSearch = stringifySearchWith(String);

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

/** Options for mounting or hydrating a standalone application. */
export interface AppRenderOptions {
  /** Reuse server-rendered DOM after the router's initial data load. */
  hydrate?: boolean;
}

/** Options for handing an Application tree to a framework-owned React root. */
export interface AppComponentOptions {
  /** Release the component handle when the owning mount session is aborted. */
  signal?: AbortSignal;
}

/**
 * A rootless Application tree owned by an external React host.
 *
 * The host must stop rendering `element`/`Component` before calling `dispose()`.
 * Creating this handle never calls ReactDOM `createRoot()` or `hydrateRoot()`.
 */
export interface AppComponentHandle {
  /** Stable component for hosts that need a component type. */
  readonly Component: ComponentType;
  /** Ready-to-render element backed by the same router, QueryClient, and wrappers as `render()`. */
  readonly element: ReactElement;
  /** Release this Application's component-mode ownership. Idempotent. */
  dispose(): void;
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
   * @param options - Select hydration when the server already rendered the app.
   */
  render(
    container: string | HTMLElement,
    options?: AppRenderOptions,
  ): void | Promise<void>;
  /**
   * Hand the complete Application React tree to an external root owner without
   * creating a second DOM root.
   */
  createComponent(options?: AppComponentOptions): AppComponentHandle;
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
  return createAppRuntime(options);
}

/** @internal Framework bootstrap with React wrappers outside all CSR providers. */
export function createFrameworkApp(
  options: CreateAppOptions<AnyRoute>,
  rootWrappers: readonly AppRootWrapper[],
): App<AnyRouter> {
  return createAppRuntime(options, rootWrappers) as App<AnyRouter>;
}

type AppRootWrapper = ComponentType<{ children?: ReactNode }>;

function createAppRuntime<
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
  rootWrappers: readonly AppRootWrapper[] = [],
) {
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
    parseSearch: routerOptions?.parseSearch ?? parsePageSearch,
    stringifySearch: routerOptions?.stringifySearch ?? stringifyRawSearch,
    context: { queryClient } as AppRouteContext,
  });

  let root: ReturnType<typeof createRoot> | undefined;
  let renderGeneration = 0;
  let rootOwner: "dom" | symbol | undefined;

  function createApplicationTree(): ReactElement {
    return rootWrappers.reduceRight<ReactElement>(
      (children, RootWrapper) =>
        createElement(RootWrapper, undefined, children),
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  function render(
    container: string | HTMLElement,
    renderOptions: AppRenderOptions = {},
  ): void | Promise<void> {
    if (typeof rootOwner === "symbol") {
      throw new Error(
        "[evjs] App render() cannot create a DOM root while a component handle owns the Application. Dispose the component handle first.",
      );
    }
    const el = resolveAppContainer(container);
    assertAppRenderOptions(renderOptions);
    const generation = ++renderGeneration;
    const tree = createApplicationTree();
    rootOwner = "dom";

    if (renderOptions.hydrate) {
      return hydrateAfterRouterLoad(el, tree, generation);
    }

    let nextRoot: ReturnType<typeof createRoot> | undefined;
    try {
      nextRoot = createRoot(el);
      root = nextRoot;
      nextRoot.render(tree);
    } catch (error) {
      try {
        nextRoot?.unmount();
      } finally {
        if (root === nextRoot) root = undefined;
        rootOwner = undefined;
      }
      throw error;
    }
  }

  async function hydrateAfterRouterLoad(
    element: HTMLElement,
    tree: ReactNode,
    generation: number,
  ): Promise<void> {
    try {
      await router.load();
      if (generation !== renderGeneration) return;
      root = hydrateRoot(element, tree);
    } catch (error) {
      if (generation === renderGeneration && !root) rootOwner = undefined;
      throw error;
    }
  }

  function createComponent(
    componentOptions: AppComponentOptions = {},
  ): AppComponentHandle {
    assertAppComponentOptions(componentOptions);
    if (rootOwner !== undefined) {
      throw new Error(
        rootOwner === "dom"
          ? "[evjs] App createComponent() cannot acquire the Application after render() created a DOM root. Unmount the Application first."
          : "[evjs] App createComponent() cannot acquire the Application more than once. Dispose the active component handle first.",
      );
    }
    if (componentOptions.signal?.aborted) {
      throw new Error(
        "[evjs] App createComponent() cannot acquire the Application with an aborted signal.",
      );
    }

    const token = Symbol("evjs-application-component-owner");
    rootOwner = token;
    let disposed = false;
    const Component = function EvjsApplicationComponent(): ReactElement {
      return createApplicationTree();
    };
    const abort = () => handle.dispose();
    const handle: AppComponentHandle = {
      Component,
      element: createElement(Component),
      dispose() {
        if (disposed) return;
        disposed = true;
        componentOptions.signal?.removeEventListener("abort", abort);
        if (rootOwner === token) rootOwner = undefined;
      },
    };
    componentOptions.signal?.addEventListener("abort", abort, { once: true });
    return handle;
  }

  function unmount(): void {
    renderGeneration += 1;
    root?.unmount();
    root = undefined;
    if (rootOwner === "dom") rootOwner = undefined;
  }

  return { router, queryClient, render, createComponent, unmount };
}

/** @internal */
export function resolveAppContainer(
  container: string | HTMLElement,
): HTMLElement {
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

function assertAppRenderOptions(options: AppRenderOptions): void {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("[evjs] App render options must be an object.");
  }
  if (options.hydrate !== undefined && typeof options.hydrate !== "boolean") {
    throw new Error(
      "[evjs] App render options.hydrate must be a boolean when provided.",
    );
  }
}

function assertAppComponentOptions(options: AppComponentOptions): void {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("[evjs] App component options must be an object.");
  }
  if (
    options.signal !== undefined &&
    (!("aborted" in options.signal) ||
      typeof options.signal.addEventListener !== "function" ||
      typeof options.signal.removeEventListener !== "function")
  ) {
    throw new Error(
      "[evjs] App component options.signal must be an AbortSignal when provided.",
    );
  }
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
