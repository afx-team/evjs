/**
 * Page authoring APIs for evjs file-convention applications.
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
export { ServerFunctionError } from "@evjs/shared";
export type { PageProps } from "./page-context.js";
export {
  usePageContext,
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "./page-context.js";
export type {
  ActiveLinkOptions,
  LinkOptions,
  LinkProps,
  NavigateOptions,
  Redirect,
  RedirectOptions,
  ToOptions,
  UseLinkPropsOptions,
} from "./page-navigation.js";
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
} from "./page-navigation.js";
// biome-ignore lint/suspicious/noEmptyInterface: Generated page route types augment this interface.
export interface Register {}
export type {
  CreatePageRouteRegister,
  PageRouteLoaderData,
  PageRouteParams,
  PageRoutePath,
  PageRouteSearch,
  PageRouteTypeDefinition,
  PageRouteTypeDefinitions,
} from "./page-route-types.js";
