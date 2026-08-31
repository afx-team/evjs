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
  composeRewrites,
  createRouter,
  type LocationRewrite,
  RouterProvider,
  stringifySearchWith,
  trimPath,
} from "@tanstack/react-router";
import { type ComponentType, createElement, type ReactNode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { formatErrorDetail } from "../shared/validation.js";
import type { AppRouteContext } from "./context.js";

const stringifyRawSearch = stringifySearchWith(String);
const OUTSIDE_BASEPATH_MARKER = "/__evjs_outside_basepath__";

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
  const configuredBasepath = routerOptions?.basepath ?? basepath;
  const basepathRewrite = createStrictBasepathRewrite(configuredBasepath);
  const rewrite = basepathRewrite
    ? routerOptions?.rewrite
      ? composeRewrites([basepathRewrite, routerOptions.rewrite])
      : basepathRewrite
    : routerOptions?.rewrite;

  const router = createRouter<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TRouterHistory,
    TDehydrated
  >({
    ...routerOptions,
    routeTree,
    // TanStack Router's built-in basepath rewrite treats paths outside the
    // mount as application-relative paths. EVJS supplies a strict rewrite and
    // keeps the Router's internal basepath at root to avoid composing both.
    basepath: basepathRewrite ? "/" : configuredBasepath,
    rewrite,
    history: routerOptions?.history ?? history,
    defaultPreload: routerOptions?.defaultPreload ?? "intent",
    parseSearch: routerOptions?.parseSearch ?? parsePageSearch,
    stringifySearch: routerOptions?.stringifySearch ?? stringifyRawSearch,
    context: { queryClient } as AppRouteContext,
  });

  if (basepathRewrite && configuredBasepath) {
    // Preserve the configured public metadata for consumers such as Link while
    // the Router continues to use the strict rewrite assembled above.
    router.basepath = configuredBasepath;
    router.options.basepath = configuredBasepath;
    installStrictBasepathMatchBoundary(router);
  }

  let root: ReturnType<typeof createRoot> | undefined;
  let renderGeneration = 0;

  function render(
    container: string | HTMLElement,
    renderOptions: AppRenderOptions = {},
  ): void | Promise<void> {
    const el = resolveAppContainer(container);
    assertAppRenderOptions(renderOptions);
    const generation = ++renderGeneration;
    const tree = rootWrappers.reduceRight<ReactNode>(
      (children, RootWrapper) =>
        createElement(RootWrapper, undefined, children),
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    if (renderOptions.hydrate) {
      return hydrateAfterRouterLoad(el, tree, generation);
    }

    root = createRoot(el);
    root.render(tree);
  }

  async function hydrateAfterRouterLoad(
    element: HTMLElement,
    tree: ReactNode,
    generation: number,
  ): Promise<void> {
    await router.load();
    if (generation !== renderGeneration) return;
    root = hydrateRoot(element, tree);
  }

  function unmount(): void {
    renderGeneration += 1;
    root?.unmount();
    root = undefined;
  }

  return { router, queryClient, render, unmount };
}

function installStrictBasepathMatchBoundary(router: AnyRouter): void {
  if (!router.routeTree.options.notFoundComponent) {
    const rootPageNotFoundComponent = Object.values(router.routesById).find(
      (route) =>
        route !== router.routeTree &&
        route.fullPath === "/" &&
        route.options.notFoundComponent,
    )?.options.notFoundComponent;
    if (rootPageNotFoundComponent) {
      router.routeTree.options.notFoundComponent = rootPageNotFoundComponent;
    }
  }

  const matchRoutes = router.matchRoutes;
  router.matchRoutes = ((...args: unknown[]) => {
    const matches = Reflect.apply(matchRoutes, router, args) as ReturnType<
      AnyRouter["matchRoutes"]
    >;
    const location = args[0];
    const pathname =
      typeof location === "string"
        ? location
        : location && typeof location === "object"
          ? Reflect.get(location, "pathname")
          : undefined;
    if (
      typeof pathname !== "string" ||
      (pathname !== OUTSIDE_BASEPATH_MARKER &&
        !pathname.startsWith(`${OUTSIDE_BASEPATH_MARKER}/`))
    ) {
      return matches;
    }
    const boundaryMatch = matches.find((match) => {
      const route = router.routesById[match.routeId];
      return Reflect.get(
        route?.options.staticData ?? {},
        "__evjsOutsideBasepath",
      );
    });
    if (boundaryMatch) return matches;
    const rootMatch = matches[0];
    return rootMatch ? [{ ...rootMatch, globalNotFound: true }] : matches;
  }) as unknown as AnyRouter["matchRoutes"];
}

function createStrictBasepathRewrite(
  basepath: string | undefined,
): LocationRewrite | undefined {
  if (!basepath) return undefined;
  const trimmedBasepath = trimPath(basepath);
  if (!trimmedBasepath || trimmedBasepath === "/") return undefined;
  const normalizedBasepath = `/${trimmedBasepath}`;
  const normalizedBasepathWithSlash = `${normalizedBasepath}/`;
  const checkBasepath = normalizedBasepath.toLowerCase();
  const checkBasepathWithSlash = normalizedBasepathWithSlash.toLowerCase();

  return {
    input: ({ url }) => {
      const pathname = url.pathname.toLowerCase();
      if (pathname === checkBasepath) {
        url.pathname = "/";
      } else if (pathname.startsWith(checkBasepathWithSlash)) {
        url.pathname = url.pathname.slice(normalizedBasepath.length);
      } else {
        url.pathname =
          url.pathname === "/"
            ? OUTSIDE_BASEPATH_MARKER
            : `${OUTSIDE_BASEPATH_MARKER}${url.pathname}`;
      }
      return url;
    },
    output: ({ url }) => {
      if (url.pathname === OUTSIDE_BASEPATH_MARKER) {
        url.pathname = "/";
      } else if (url.pathname.startsWith(`${OUTSIDE_BASEPATH_MARKER}/`)) {
        url.pathname = url.pathname.slice(OUTSIDE_BASEPATH_MARKER.length);
      } else {
        url.pathname =
          url.pathname === "/"
            ? normalizedBasepath
            : `${normalizedBasepath}${url.pathname}`;
      }
      return url;
    },
  };
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
