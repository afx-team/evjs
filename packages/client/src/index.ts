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
export {
  usePageContext,
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "./framework/page/page-context.js";
export {
  getFnQueryKey,
  getFnQueryOptions,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from "./server-functions/query.js";
export type {
  App,
  CreateAppOptions,
  CreateAppRouterOptions,
} from "./standalone/app.js";
export { createApp } from "./standalone/app.js";
export type { AppRouteContext } from "./standalone/context.js";
export { createAppRootRoute } from "./standalone/context.js";
export type {
  ActiveLinkOptions,
  LinkOptions,
  LinkProps,
  NavigateOptions,
  Redirect,
  RedirectOptions,
  ToOptions,
  UseLinkPropsOptions,
} from "./standalone/navigation.js";
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
} from "./standalone/navigation.js";
// biome-ignore lint/suspicious/noEmptyInterface: Generated SPA route types augment this interface.
export interface Register {}

export type {
  PageRouteLoaderData,
  PageRouteParams,
  PageRoutePath,
  PageRouteSearch,
} from "./framework/page/route-types.js";
export type {
  RscDebugPayload,
  RscDebugPayloadMountOptions,
  RscFlightFetchOptions,
} from "./rsc/react.js";
export {
  fetchRscDebugPayload,
  fetchRscFlight,
  loadRscDebugPage,
  mountRscDebugPayload,
} from "./rsc/react.js";
export type {
  ReactRscModelOptions,
  ReactRscMountOptions,
  ReactRscRuntimeBootstrap,
} from "./rsc/rsc.js";
export {
  createReactRscModel,
  mountReactRscPage,
  startReactRscPageRuntime,
  unmountReactRscPage,
} from "./rsc/rsc.js";
export type {
  HeaderFactory,
  RequestContext,
  RuntimeTransportOptions,
  ServerFunction,
  TransportAdapter,
  TransportOptions,
} from "./server-functions/transport.js";
export { getFnName, initTransport } from "./server-functions/transport.js";
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
} from "./standalone/route.js";
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
} from "./standalone/route.js";
