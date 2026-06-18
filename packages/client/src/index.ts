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
export { initTransport } from "./transport.js";
