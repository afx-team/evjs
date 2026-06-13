import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute as createTanStackRoute,
  Outlet,
} from "@tanstack/react-router";
import { type ComponentType, createElement, type ReactNode } from "react";
import { type App, createApp } from "./app.js";
import { PageProvider } from "./page-context.js";

interface PageRouteContext {
  queryClient: QueryClient;
}

const createPageRootRoute = createRootRouteWithContext<PageRouteContext>();

/** Framework-generated SPA bootstrap contract. */
export interface PageModule {
  default?: ComponentType;
  beforeLoad?: (...args: never[]) => unknown;
  loader?: (...args: never[]) => unknown;
  validateSearch?: (...args: never[]) => unknown;
  pendingComponent?: ComponentType;
  errorComponent?: ComponentType;
  notFoundComponent?: ComponentType;
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

/** Framework-generated SPA bootstrap. */
export function createPagesApp(options: CreatePagesAppOptions): PagesApp {
  function RootRoute() {
    const outlet = createElement(Outlet);
    const RootComponent = options.rootModule?.default;
    return RootComponent
      ? createElement(RootComponent, undefined, outlet)
      : outlet;
  }

  const rootRoute = createPageRootRoute({ component: RootRoute });
  const routes = options.routes.map((definition, index) => {
    let route: unknown;
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
        const routeApi = route as {
          useParams: () => Record<string, string>;
          useSearch: () => Record<string, unknown>;
          useLoaderData: () => unknown;
        };
        const pageProps = {
          params: routeApi.useParams(),
          search: routeApi.useSearch(),
          loaderData: routeApi.useLoaderData(),
        };

        return createElement(
          PageProvider,
          { value: pageProps },
          createElement(Component),
        );
      },
    } as never);
    return route;
  });
  const app = createApp({
    routeTree: rootRoute.addChildren(routes as never),
  } as never);

  return { app };
}

function pickRouteOptions(mod: PageModule) {
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
