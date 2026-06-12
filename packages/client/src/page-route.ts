import {
  createRoute as createTanStackRoute,
  Outlet,
} from "@tanstack/react-router";
import {
  type ComponentType,
  createContext,
  createElement,
  type ReactNode,
  useContext,
} from "react";
import { type App, createApp } from "./app.js";
import { createAppRootRoute } from "./context.js";

export interface PageProps<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
> {
  params: TParams;
  search: TSearch;
  loaderData: TLoaderData;
}

export type PageComponent<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
> = ComponentType<PageProps<TParams, TSearch, TLoaderData>>;

export interface PageProviderProps<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
> {
  value: PageProps<TParams, TSearch, TLoaderData>;
  children?: ReactNode;
}

const PageContext = createContext<PageProps | undefined>(undefined);

export function PageProvider({ value, children }: PageProviderProps) {
  return createElement(PageContext.Provider, { value }, children);
}

export function usePageContext<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
>(): PageProps<TParams, TSearch, TLoaderData> {
  const ctx = useContext(PageContext);
  if (!ctx) {
    throw new Error(
      "[evjs] Page route data hooks must be used inside an evjs page.",
    );
  }
  return ctx as PageProps<TParams, TSearch, TLoaderData>;
}

export function usePageParams<
  TParams extends Record<string, string> = Record<string, string>,
>(): TParams {
  return usePageContext<TParams>().params;
}

export function usePageSearch<
  TSearch extends Record<string, unknown> = Record<string, unknown>,
>(): TSearch {
  return usePageContext<Record<string, string>, TSearch>().search;
}

export function usePageLoaderData<TLoaderData = unknown>(): TLoaderData {
  return usePageContext<
    Record<string, string>,
    Record<string, unknown>,
    TLoaderData
  >().loaderData;
}

/** Framework-generated SPA bootstrap contract. */
export interface PageModule {
  default?: PageComponent;
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
  app: App<unknown>;
  routeTree: unknown;
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

  const rootRoute = createAppRootRoute({ component: RootRoute });
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
          createElement(Component, pageProps),
        );
      },
    } as never);
    return route;
  });
  const routeTree = rootRoute.addChildren(routes as never);
  const app = createApp({ routeTree } as never) as App<unknown>;

  return { app, routeTree };
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
