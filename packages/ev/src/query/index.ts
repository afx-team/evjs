/**
 * Server-function query APIs for evjs file-convention applications.
 */

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
} from "@evjs/client";
export {
  getFnQueryKey,
  getFnQueryOptions,
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
} from "@evjs/client";
