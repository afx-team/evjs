/**
 * Client-side runtime utilities.
 */

export { ServerFunctionError } from "@evjs/shared";
// Cherry-picked re-exports from @tanstack/react-query
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
export type {
  App,
  CreateAppOptions,
  CreateAppRouterOptions,
  RenderOptions,
} from "./app";
export { createApp } from "./app";
export type { AppRouteContext } from "./context";
export { createAppRootRoute } from "./context";
export {
  getFnQueryKey,
  getFnQueryOptions,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from "./query";
// biome-ignore lint/suspicious/noEmptyInterface: Users augment this interface with their app router type.
export interface Register {}

type EvRegister = Register;

// Bridge evjs' public Register interface into TanStack Router's global types.
declare module "@tanstack/react-router" {
  interface Register extends EvRegister {}
}

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
} from "./route";
export {
  Await,
  Block,
  CatchBoundary,
  CatchNotFound,
  ClientOnly,
  composeRewrites,
  createBrowserHistory,
  createHashHistory,
  createLazyRoute,
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
} from "./route";
export type {
  HeaderFactory,
  RequestContext,
  ServerFunction,
  TransportAdapter,
  TransportOptions,
} from "./transport";
export { getFnName, initTransport } from "./transport";
