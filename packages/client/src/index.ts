/**
 * Client-side runtime utilities.
 */

export { ServerFunctionError } from "@evjs/shared";
export type {
  PageComponent,
  PageProps,
} from "./page-route.js";
export {
  usePageContext,
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "./page-route.js";
export {
  getFnQueryKey,
  getFnQueryOptions,
  useMutation,
  useQuery,
  useSuspenseQuery,
} from "./query.js";
export type {
  ActiveLinkOptions,
  LinkOptions,
  LinkProps,
  NavigateOptions,
  QueryKey,
  ToOptions,
  UseInfiniteQueryOptions,
  UseInfiniteQueryResult,
  UseLinkPropsOptions,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
  UseSuspenseQueryOptions,
  UseSuspenseQueryResult,
} from "./tanstack.js";
export {
  isNotFound,
  isRedirect,
  keepPreviousData,
  Link,
  Navigate,
  notFound,
  QueryClient,
  QueryClientProvider,
  redirect,
  useInfiniteQuery,
  useIsFetching,
  useLinkProps,
  useLocation,
  useNavigate,
  usePrefetchQuery,
  useQueryClient,
} from "./tanstack.js";
// biome-ignore lint/suspicious/noEmptyInterface: Users augment this interface with their app router type.
export interface Register {}

type ClientRegister = Register;

// Bridge evjs' public Register interface into TanStack Router's global types.
declare module "@tanstack/react-router" {
  interface Register extends ClientRegister {}
}

export type { PageRuntimeOptions } from "./page.js";
export { startPageRuntime } from "./page.js";
export type {
  RemoteRuntimeContext,
  RscDebugPayload,
  RscDebugPayloadMountOptions,
  RscFlightFetchOptions,
} from "./react.js";
export {
  fetchRscDebugPayload,
  fetchRscFlight,
  loadRscDebugPage,
  mountRscDebugPayload,
  useRemoteContext,
} from "./react.js";
export type {
  RemoteAppHookOptions,
  RemoteAppHookResult,
  RemoteAppProps,
  RemoteAppRuntimeController,
  RemoteAppRuntimeOptions,
  RemoteAppShellOptions,
  RemoteAppState,
  RemoteAppStatus,
  RemoteAppTargetOptions,
} from "./remote-app.js";
export {
  createRemoteAppManifest,
  formatRemoteSharedNegotiation,
  getRemoteSharedVersion,
  RemoteApp,
  resolveRemoteAppManifestUrl,
  startRemoteAppRuntime,
  useRemoteHost,
} from "./remote-app.js";
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
export {
  callServer,
  createServerReference,
  getFnId,
  getFnName,
  initTransport,
  initTransportFromManifest,
} from "./transport.js";
