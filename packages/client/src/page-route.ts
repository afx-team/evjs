import {
  getPageRouteParamSegmentValidationError,
  getPathPatternValidationError,
  type PageRouteParamSegmentValidationError,
  type PathPatternValidationError,
  pageRoutePathShapeFromPath,
} from "@evjs/shared";
import type { QueryClient } from "@tanstack/react-query";
import type {
  AnyRoute,
  ErrorRouteComponent,
  NotFoundRouteComponent,
  RouteComponent,
} from "@tanstack/react-router";
import {
  createRootRouteWithContext,
  createRoute as createTanStackRoute,
  Outlet,
} from "@tanstack/react-router";
import { type ComponentType, createElement, type ReactNode } from "react";
import { type App, createApp } from "./app.js";
import { PageProvider } from "./page-context.js";
import { isReactComponentExport } from "./react-component.js";

interface PageRouteContext {
  queryClient: QueryClient;
}

const createPageRootRoute = createRootRouteWithContext<PageRouteContext>();

/** Framework-generated SPA bootstrap contract. */
export interface PageModule {
  default?: RouteComponent;
  beforeLoad?: (...args: unknown[]) => unknown;
  loader?: (...args: unknown[]) => unknown;
  validateSearch?: (...args: unknown[]) => unknown;
  pendingComponent?: RouteComponent;
  errorComponent?: ErrorRouteComponent;
  notFoundComponent?: NotFoundRouteComponent;
}

/** Framework-generated SPA bootstrap contract. */
export interface RootLayoutModule {
  default?: ComponentType<{ children?: ReactNode }>;
}

/** Framework-generated SPA bootstrap contract. */
export interface PageDefinition {
  path: string;
  module: PageModule;
}

/** Framework-generated SPA bootstrap contract. */
export interface CreatePagesAppOptions {
  routes: PageDefinition[];
  rootModule?: RootLayoutModule;
}

/** Framework-generated SPA bootstrap contract. */
export interface PagesApp {
  app: App;
}

type PageModuleRouteOptions = Omit<PageModule, "default">;

/** Framework-generated SPA bootstrap. */
export function createPagesApp(options: CreatePagesAppOptions): PagesApp {
  assertCreatePagesAppOptions(options);
  const routeTree = createGeneratedRouteTree(options);
  const app = createApp({ routeTree });

  return { app };
}

function createGeneratedRouteTree(options: CreatePagesAppOptions): AnyRoute {
  function RootRoute() {
    const outlet = createElement(Outlet);
    const RootComponent = options.rootModule?.default;
    return RootComponent
      ? createElement(RootComponent, undefined, outlet)
      : outlet;
  }

  const rootRoute = createPageRootRoute({ component: RootRoute });
  const routes = options.routes.map((definition, index) =>
    createGeneratedPageRoute(rootRoute, definition, index),
  );

  return rootRoute.addChildren(routes);
}

function createGeneratedPageRoute<TRootRoute extends AnyRoute>(
  rootRoute: TRootRoute,
  definition: PageDefinition,
  index: number,
): AnyRoute {
  let route: AnyRoute;
  // Generated route paths are runtime data, so TanStack's literal route generics
  // cannot be preserved past this generated route-tree adapter boundary.
  route = createTanStackRoute({
    getParentRoute: () => rootRoute,
    path: definition.path,
    ...pickRouteOptions(definition.module),
    component: function EvPageRoute() {
      const Component = definition.module.default;
      if (!Component) {
        throw new Error(
          `[evjs] Page route ${definition.path || index} must export a default React component.`,
        );
      }
      const pageProps = {
        params: route.useParams(),
        search: route.useSearch(),
        loaderData: route.useLoaderData(),
      };

      return createElement(
        PageProvider,
        { value: pageProps },
        createElement(Component),
      );
    },
  });

  return route;
}

function assertCreatePagesAppOptions(
  options: unknown,
): asserts options is CreatePagesAppOptions {
  if (!isRecord(options)) {
    throw new Error("[evjs] createPagesApp() options must be an object.");
  }
  if (!Array.isArray(options.routes)) {
    throw new Error("[evjs] createPagesApp() routes must be an array.");
  }
  if (options.rootModule !== undefined && !isRecord(options.rootModule)) {
    throw new Error("[evjs] createPagesApp() rootModule must be an object.");
  }
  if (
    options.rootModule?.default !== undefined &&
    !isReactComponentExport(options.rootModule.default)
  ) {
    throw new Error(
      "[evjs] createPagesApp() rootModule.default must be a React component.",
    );
  }

  const routePathOwners = new Map<string, string>();
  const routeShapeOwners = new Map<string, { path: string; owner: string }>();
  options.routes.forEach((definition, index) => {
    const routePath = `routes[${index}]`;
    if (!isRecord(definition)) {
      throw new Error(
        `[evjs] createPagesApp() ${routePath} must be an object.`,
      );
    }
    assertRoutePath(definition.path, `${routePath}.path`);
    assertUniqueRoutePath(definition.path, routePath, routePathOwners);
    assertUniqueRouteShape(definition.path, routePath, routeShapeOwners);
    if (!isRecord(definition.module)) {
      throw new Error(
        `[evjs] createPagesApp() ${routePath}.module must be an object.`,
      );
    }
    if (definition.module.default == null) {
      throw new Error(
        `[evjs] Page route ${definition.path} must export a default React component.`,
      );
    }
    if (!isReactComponentExport(definition.module.default)) {
      throw new Error(
        `[evjs] Page route ${definition.path} default export must be a React component.`,
      );
    }
    assertOptionalFunction(
      definition.module.beforeLoad,
      `${routePath}.module.beforeLoad`,
    );
    assertOptionalFunction(
      definition.module.loader,
      `${routePath}.module.loader`,
    );
    assertOptionalFunction(
      definition.module.validateSearch,
      `${routePath}.module.validateSearch`,
    );
    assertOptionalReactComponent(
      definition.module.pendingComponent,
      `${routePath}.module.pendingComponent`,
    );
    assertOptionalReactComponent(
      definition.module.errorComponent,
      `${routePath}.module.errorComponent`,
    );
    assertOptionalReactComponent(
      definition.module.notFoundComponent,
      `${routePath}.module.notFoundComponent`,
    );
  });
}

function assertRoutePath(
  value: unknown,
  path: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `[evjs] createPagesApp() ${path} must be a non-empty route path string.`,
    );
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] createPagesApp() ${path} must not include leading or trailing whitespace.`,
    );
  }

  const error = getPathPatternValidationError(value);
  if (error) {
    throw new Error(
      `[evjs] createPagesApp() ${path} ${formatRoutePathError(error)}`,
    );
  }

  const paramError = getPageRouteParamSegmentValidationError(value);
  if (paramError) {
    throw new Error(
      `[evjs] createPagesApp() ${path} ${formatRouteParamError(paramError)}`,
    );
  }
}

function formatRoutePathError(error: PathPatternValidationError): string {
  switch (error) {
    case "empty":
      return "must be a non-empty route path string.";
    case "missing-leading-slash":
      return 'must start with "/".';
    case "whitespace":
      return "must not contain whitespace.";
    case "query-or-hash":
      return "must not include a query string or hash.";
  }
}

function formatRouteParamError(
  error: PageRouteParamSegmentValidationError,
): string {
  switch (error.error) {
    case "empty":
      return `contains dynamic segment "${error.segment}" without a param name.`;
    case "reserved":
      return `uses reserved dynamic param name "${error.name}" in segment "${error.segment}". Use a safe application-specific name.`;
    case "duplicate":
      return `uses duplicate dynamic param name "${error.name}" in segment "${error.segment}". Use unique param names within one route path.`;
    case "duplicate-wildcard":
      return `contains more than one wildcard segment "${error.segment}". Use at most one wildcard segment in a route path.`;
  }
}

function assertUniqueRoutePath(
  value: string,
  path: string,
  routePathOwners: Map<string, string>,
): void {
  const previousOwner = routePathOwners.get(value);
  if (previousOwner) {
    throw new Error(
      `[evjs] createPagesApp() ${path}.path duplicates ${previousOwner}.path "${value}".`,
    );
  }
  routePathOwners.set(value, path);
}

function assertUniqueRouteShape(
  value: string,
  path: string,
  routeShapeOwners: Map<string, { path: string; owner: string }>,
): void {
  const routeShape = pageRoutePathShapeFromPath(value);
  const previousOwner = routeShapeOwners.get(routeShape);
  if (previousOwner) {
    throw new Error(
      `[evjs] createPagesApp() ${path}.path "${value}" has the same route shape as ${previousOwner.owner}.path "${previousOwner.path}". Use one dynamic param name for each URL shape.`,
    );
  }
  routeShapeOwners.set(routeShape, { path: value, owner: path });
}

function assertOptionalFunction(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`[evjs] createPagesApp() ${path} must be a function.`);
  }
}

function assertOptionalReactComponent(value: unknown, path: string): void {
  if (value !== undefined && !isReactComponentExport(value)) {
    throw new Error(
      `[evjs] createPagesApp() ${path} must be a React component.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pickRouteOptions(mod: PageModule): Partial<PageModuleRouteOptions> {
  return {
    ...(typeof mod.beforeLoad === "function"
      ? { beforeLoad: mod.beforeLoad }
      : {}),
    ...(typeof mod.loader === "function" ? { loader: mod.loader } : {}),
    ...(typeof mod.validateSearch === "function"
      ? { validateSearch: mod.validateSearch }
      : {}),
    ...(mod.pendingComponent ? { pendingComponent: mod.pendingComponent } : {}),
    ...(mod.errorComponent ? { errorComponent: mod.errorComponent } : {}),
    ...(mod.notFoundComponent
      ? { notFoundComponent: mod.notFoundComponent }
      : {}),
  };
}
