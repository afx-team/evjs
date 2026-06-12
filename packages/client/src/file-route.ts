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

export interface FileRoutePageProps<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
> {
  params: TParams;
  search: TSearch;
  loaderData: TLoaderData;
}

export type FileRoutePageComponent<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
> = ComponentType<FileRoutePageProps<TParams, TSearch, TLoaderData>>;

export interface FileRouteProviderProps<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
> {
  value: FileRoutePageProps<TParams, TSearch, TLoaderData>;
  children?: ReactNode;
}

const FileRouteContext = createContext<FileRoutePageProps | undefined>(
  undefined,
);

export function FileRouteProvider({ value, children }: FileRouteProviderProps) {
  return createElement(FileRouteContext.Provider, { value }, children);
}

export function useFileRouteContext<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
>(): FileRoutePageProps<TParams, TSearch, TLoaderData> {
  const ctx = useContext(FileRouteContext);
  if (!ctx) {
    throw new Error(
      "[evjs] useFileRouteContext() must be used inside an evjs file route page.",
    );
  }
  return ctx as FileRoutePageProps<TParams, TSearch, TLoaderData>;
}

export function useFileRouteParams<
  TParams extends Record<string, string> = Record<string, string>,
>(): TParams {
  return useFileRouteContext<TParams>().params;
}

export function useFileRouteSearch<
  TSearch extends Record<string, unknown> = Record<string, unknown>,
>(): TSearch {
  return useFileRouteContext<Record<string, string>, TSearch>().search;
}

export function useFileRouteLoaderData<TLoaderData = unknown>(): TLoaderData {
  return useFileRouteContext<
    Record<string, string>,
    Record<string, unknown>,
    TLoaderData
  >().loaderData;
}

export interface FileRouteModule {
  default?: FileRoutePageComponent;
  beforeLoad?: (...args: never[]) => unknown;
  loader?: (...args: never[]) => unknown;
  validateSearch?: (...args: never[]) => unknown;
  pendingComponent?: ComponentType;
  errorComponent?: ComponentType;
  notFoundComponent?: ComponentType;
}

export interface FileRouteRootModule {
  default?: ComponentType<{ children?: ReactNode }>;
}

export interface FileRouteDefinition {
  path: string;
  module: FileRouteModule;
}

export interface CreateFileRouteAppOptions {
  routes: FileRouteDefinition[];
  rootModule?: FileRouteRootModule;
}

export interface FileRouteApp {
  app: App<unknown>;
  routeTree: unknown;
}

export function createFileRouteApp(
  options: CreateFileRouteAppOptions,
): FileRouteApp {
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
      component: function EvFileRoute() {
        const Component = definition.module.default;
        if (!Component) {
          throw new Error(
            `[evjs] File route ${definition.path || index} must export a default React component.`,
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
          FileRouteProvider,
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

function pickRouteOptions(mod: FileRouteModule) {
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
