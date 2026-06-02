import type { BuildOutput, RouteNode } from "@evjs/shared/manifest";

export type {
  QueryKey,
  UseInfiniteQueryOptions,
  UseInfiniteQueryResult,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
  UseSuspenseQueryOptions,
  UseSuspenseQueryResult,
} from "@tanstack/react-query";
export {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useIsFetching,
  usePrefetchQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  type ActivationRequest,
  createActivationRequestFromUrl,
  type ShellDriver,
} from "./shell.js";

export type { AppRouteContext } from "./context.js";
export { createAppRootRoute } from "./context.js";
export type {
  ActiveLinkOptions,
  AnyRootRoute,
  AnyRoute,
  AnyRouteMatch,
  AnyRouter,
  AwaitOptions,
  BlockerFn,
  ErrorComponentProps,
  ErrorRouteComponent,
  HistoryLocation,
  HistoryState,
  LinkOptions,
  LinkProps,
  LocationRewrite,
  LocationRewriteFunction,
  MatchRouteOptions,
  NavigateOptions,
  NotFoundError,
  NotFoundRouteComponent,
  NotFoundRouteProps,
  ParsedLocation,
  ParsedPath,
  RegisteredRouter,
  RouteComponent,
  RouteMask,
  RouteMatch,
  RouteOptions,
  RouterConstructorOptions,
  RouterEvent,
  RouterEvents,
  RouterHistory,
  RouterListener,
  RouterOptions,
  RouterProps,
  RouterState,
  SearchFilter,
  SearchMiddleware,
  SearchParser,
  SearchSchemaInput,
  SearchSerializer,
  ShouldBlockFn,
  ToMaskOptions,
  ToOptions,
  UseBlockerOpts,
  UseLinkPropsOptions,
  UseMatchRouteOptions,
} from "./route.js";
export {
  Await,
  Block,
  CatchBoundary,
  CatchNotFound,
  ClientOnly,
  composeRewrites,
  createBrowserHistory,
  createHashHistory,
  createLink,
  createMemoryHistory,
  createRootRoute,
  createRootRouteWithContext,
  createRoute,
  createRouteMask,
  createRouter,
  DefaultGlobalNotFound,
  defaultParseSearch,
  defaultStringifySearch,
  defer,
  ErrorComponent,
  getRouteApi,
  isNotFound,
  isRedirect,
  Link,
  lazyRouteComponent,
  linkOptions,
  Match,
  Matches,
  MatchRoute,
  Navigate,
  notFound,
  Outlet,
  parseSearchWith,
  RouteApi,
  RouterContextProvider,
  RouterProvider,
  redirect,
  retainSearchParams,
  rootRouteWithContext,
  ScrollRestoration,
  stringifySearchWith,
  stripSearchParams,
  useAwaited,
  useBlocker,
  useCanGoBack,
  useChildMatches,
  useElementScrollRestoration,
  useHydrated,
  useLinkProps,
  useLoaderData,
  useLoaderDeps,
  useLocation,
  useMatch,
  useMatches,
  useMatchRoute,
  useNavigate,
  useParams,
  useParentMatches,
  useRouteContext,
  useRouter,
  useRouterState,
  useSearch,
} from "./route.js";

const routeMetaSymbol = Symbol.for("evjs.routeMeta");

// biome-ignore lint/suspicious/noEmptyInterface: Users augment this interface with their app router type.
export interface Register {}

type TanStackRegister = Register;

declare module "@tanstack/react-router" {
  interface Register extends TanStackRegister {}
}

export interface RouteMeta {
  id?: string;
  module?: string;
  render?: RouteNode["render"];
  hydrate?: RouteNode["hydrate"];
  runtime?: RouteNode["runtime"];
}

export interface TanStackRoutes<TRouteTree> {
  kind: "evjs.tanstack.routes";
  routeTree: TRouteTree;
  toRouteGraph(): RouteNode[];
}

export interface DefineTanStackRoutesOptions<TRouteTree> {
  routeTree: TRouteTree;
  routes?: RouteNode[];
}

export interface TanStackRouterLike {
  state?: {
    location?: {
      href?: string;
      pathname?: string;
    };
  };
  subscribe?: (event: string, callback: () => void) => (() => void) | undefined;
}

export interface TanStackDriverOptions<TRouter extends TanStackRouterLike> {
  router: TRouter;
  manifest: BuildOutput;
  event?: string;
  resolve?: (router: TRouter) => ActivationRequest;
}

export function tanstackRoutes(source: string): string {
  return source;
}

export function defineTanStackRoutes<TRouteTree>(
  options: DefineTanStackRoutesOptions<TRouteTree>,
): TanStackRoutes<TRouteTree> {
  const routes = options.routes ? [...options.routes] : [];

  return {
    kind: "evjs.tanstack.routes",
    routeTree: options.routeTree,
    toRouteGraph() {
      return routes.map((route) => ({ ...route }));
    },
  };
}

export function withRouteMeta<TRoute extends object>(
  route: TRoute,
  meta: RouteMeta,
): TRoute {
  Object.defineProperty(route, routeMetaSymbol, {
    configurable: true,
    enumerable: false,
    value: meta,
    writable: true,
  });

  return route;
}

export function getRouteMeta(route: object): RouteMeta | undefined {
  return (route as { [routeMetaSymbol]?: RouteMeta })[routeMetaSymbol];
}

export function createTanStackDriver<TRouter extends TanStackRouterLike>(
  options: TanStackDriverOptions<TRouter>,
): ShellDriver {
  function current(): ActivationRequest {
    return (
      options.resolve?.(options.router) ??
      createActivationRequestFromUrl(
        options.manifest,
        getRouterUrl(options.router),
      )
    );
  }

  return {
    current,
    subscribe(callback) {
      return (
        options.router.subscribe?.(options.event ?? "onResolved", () => {
          callback(current());
        }) ?? (() => {})
      );
    },
  };
}

function getRouterUrl(router: TanStackRouterLike): string {
  const location = router.state?.location;
  return location?.href ?? location?.pathname ?? "/";
}
