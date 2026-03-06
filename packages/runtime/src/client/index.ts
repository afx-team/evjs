/**
 * Client-side runtime utilities.
 */

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
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
export type { AppRouteContext } from "./context";
export { createAppRootRoute } from "./context";
export type { App, CreateAppOptions } from "./create-app";
export { createApp } from "./create-app";
export * from "./query";
export * from "./route";
export type {
  RequestContext,
  ServerTransport,
  TransportOptions,
} from "./transport";
export { configureTransport } from "./transport";
