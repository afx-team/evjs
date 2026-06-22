/**
 * Client-side runtime utilities.
 */

export { ServerFunctionError } from "@evjs/shared";
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
export type { App, CreateAppOptions, CreateAppRouterOptions } from "./app.js";
export { createApp } from "./app.js";
export type { AppRouteContext } from "./context.js";
export { createAppRootRoute } from "./context.js";
export type {
  ActiveLinkOptions,
  LinkOptions,
  LinkProps,
  NavigateOptions,
  Redirect,
  RedirectOptions,
  ToOptions,
  UseLinkPropsOptions,
} from "./navigation.js";
export {
  isNotFound,
  isRedirect,
  Link,
  Navigate,
  notFound,
  redirect,
  useLinkProps,
  useLocation,
  useNavigate,
} from "./navigation.js";
export {
  usePageContext,
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "./page-context.js";
export {
  getFnQueryKey,
  getFnQueryOptions,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from "./query.js";
// biome-ignore lint/suspicious/noEmptyInterface: Generated SPA route types augment this interface.
export interface Register {}

export type {
  RscDebugPayload,
  RscDebugPayloadMountOptions,
  RscFlightFetchOptions,
} from "./react.js";
export {
  fetchRscDebugPayload,
  fetchRscFlight,
  loadRscDebugPage,
  mountRscDebugPayload,
} from "./react.js";
export type {
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
  LocationRewrite,
  LocationRewriteFunction,
  MatchRouteOptions,
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
  UseBlockerOpts,
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
  lazyRouteComponent,
  linkOptions,
  Match,
  Matches,
  MatchRoute,
  Outlet,
  parseSearchWith,
  RouteApi,
  RouterContextProvider,
  RouterProvider,
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
  useLoaderData,
  useLoaderDeps,
  useMatch,
  useMatches,
  useMatchRoute,
  useParams,
  useParentMatches,
  useRouteContext,
  useRouter,
  useRouterState,
  useSearch,
} from "./route.js";
export type {
  PageRouteLoaderData,
  PageRouteParams,
  PageRoutePath,
  PageRouteSearch,
} from "./route-types.js";
export type {
  ReactRscModelOptions,
  ReactRscMountOptions,
  ReactRscRuntimeBootstrap,
} from "./rsc.js";
export {
  createReactRscModel,
  mountReactRscPage,
  startReactRscPageRuntime,
  unmountReactRscPage,
} from "./rsc.js";
export type {
  HeaderFactory,
  RequestContext,
  ServerFunction,
  TransportAdapter,
  TransportOptions,
} from "./transport.js";
export { getFnName, initTransport } from "./transport.js";
