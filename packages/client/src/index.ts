/**
 * Client-side runtime utilities.
 */

export { ServerFunctionError } from "@evjs/shared";
// Cherry-picked re-exports from @tanstack/react-query
export type {
  QueryClientConfig,
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
  useMutation,
  usePrefetchQuery,
  useQueryClient,
} from "@tanstack/react-query";
export type { App, CreateAppOptions } from "./app";
export { createApp } from "./app";
export type { AppRouteContext } from "./context";
export { createAppRootRoute } from "./context";
export { serverFn, useQuery, useSuspenseQuery } from "./query";
export type {
  AnyRootRoute,
  AnyRoute,
  AnyRouteMatch,
  AnyRouter,
  ErrorComponentProps,
  ErrorRouteComponent,
  LinkOptions,
  LinkProps,
  NavigateOptions,
  NotFoundError,
  NotFoundRouteComponent,
  NotFoundRouteProps,
  RegisteredRouter,
  RouteComponent,
  RouteMatch,
  RouterOptions,
  RouterState,
  SearchSchemaInput,
} from "./route";
export {
  CatchBoundary,
  CatchNotFound,
  createLink,
  createRootRoute,
  createRootRouteWithContext,
  createRoute,
  createRouteMask,
  createRouter,
  DefaultGlobalNotFound,
  ErrorComponent,
  getRouteApi,
  isNotFound,
  isRedirect,
  Link,
  lazyRouteComponent,
  linkOptions,
  Navigate,
  notFound,
  Outlet,
  RouterProvider,
  redirect,
  useBlocker,
  useCanGoBack,
  useLoaderData,
  useLoaderDeps,
  useLocation,
  useMatch,
  useMatchRoute,
  useNavigate,
  useParams,
  useRouteContext,
  useRouter,
  useRouterState,
  useSearch,
} from "./route";
export type {
  RequestContext,
  ServerTransport,
  TransportOptions,
} from "./transport";
export { getFnName, initTransport } from "./transport";
