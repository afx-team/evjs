/**
 * Server function → TanStack Query options utility.
 *
 * Converts a server function into `{ queryKey, queryFn }` that works with
 * ANY TanStack Query hook: useQuery, useSuspenseQuery, usePrefetchQuery,
 * useInfiniteQuery, queryClient.ensureQueryData, etc.
 *
 * @example
 * import { serverFn } from "@evjs/runtime/client";
 * import { useQuery, useSuspenseQuery } from "@evjs/runtime/client";
 *
 * useQuery(serverFn(getUsers));
 * useSuspenseQuery(serverFn(getUser, userId));
 * useInfiniteQuery({ ...serverFn(getPosts), getNextPageParam: ... });
 * context.queryClient.ensureQueryData(serverFn(getUsers));
 */

import { __fn_call, getFnId } from "./transport";

/**
 * Convert a server function + args into TanStack Query options.
 *
 * Returns `{ queryKey, queryFn }` compatible with any TanStack Query hook.
 *
 * @example
 * useQuery(serverFn(getUsers));
 * useSuspenseQuery(serverFn(getUser, userId));
 * context.queryClient.ensureQueryData(serverFn(getUsers));
 */
export function serverFn<TArgs extends unknown[], TData>(
  fn: (...args: TArgs) => Promise<TData>,
  ...args: TArgs
): {
  queryKey: unknown[];
  queryFn: (ctx: { signal: AbortSignal }) => Promise<TData>;
} {
  const fnId = getFnId(fn);
  if (!fnId) {
    throw new Error(
      `serverFn() only accepts server functions (with "use server" directive). Got: ${fn.name || "anonymous"}`,
    );
  }
  return {
    queryKey: [fnId, ...args],
    queryFn: ({ signal }) =>
      __fn_call(fnId, args, { signal }) as Promise<TData>,
  };
}
