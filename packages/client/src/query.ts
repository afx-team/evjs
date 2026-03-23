/**
 * Server function → TanStack Query integration.
 *
 * Provides type-safe `useQuery` and `useSuspenseQuery` that accept
 * server functions directly, with full TArgs + TData inference.
 *
 * @example
 * import { useQuery, useSuspenseQuery } from "@evjs/runtime/client";
 *
 * // Server function — args & data fully typed
 * const { data: users } = useQuery(getUsers);            // data: User[]
 * const { data: user } = useQuery(getUser, userId);      // data: User
 * const { data } = useSuspenseQuery(getUsers);           // data: User[]
 *
 * // Standard TanStack options — pass-through
 * const { data } = useQuery({ queryKey: [...], queryFn: ... });
 *
 * // For other hooks (useInfiniteQuery, prefetch, loaders), use serverFn():
 * useInfiniteQuery({ ...serverFn(getPosts), getNextPageParam: ... });
 * context.queryClient.ensureQueryData(serverFn(getUsers));
 */

import type {
  UseQueryOptions,
  UseQueryResult,
  UseSuspenseQueryOptions,
  UseSuspenseQueryResult,
} from "@tanstack/react-query";
import {
  useQuery as _useQuery,
  useSuspenseQuery as _useSuspenseQuery,
} from "@tanstack/react-query";
import { __fn_call, getFnId } from "./transport";

// ── serverFn() — for loaders, prefetch, useInfiniteQuery, etc. ──

/**
 * Convert a server function + args into `{ queryKey, queryFn }`.
 * Use with any TanStack hook that accepts queryKey/queryFn options.
 *
 * @example
 * context.queryClient.ensureQueryData(serverFn(getUsers));
 * useInfiniteQuery({ ...serverFn(getPosts), getNextPageParam: ... });
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

// ── useQuery — server function overload + TanStack pass-through ──

/**
 * Type-safe `useQuery` that accepts server functions directly.
 *
 * @example
 * const { data } = useQuery(getUsers);           // data: User[]
 * const { data } = useQuery(getUser, userId);    // data: User
 * const { data } = useQuery({ queryKey, queryFn }); // standard TanStack
 */
export function useQuery<TArgs extends unknown[], TData>(
  fn: (...args: TArgs) => Promise<TData>,
  ...args: TArgs
): UseQueryResult<TData, Error>;
export function useQuery<
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
>(
  options: UseQueryOptions<TQueryFnData, TError, TData>,
): UseQueryResult<TData, TError>;
export function useQuery(
  fnOrOptions: ((...args: unknown[]) => Promise<unknown>) | UseQueryOptions,
  ...args: unknown[]
): UseQueryResult {
  if (typeof fnOrOptions === "function") {
    return _useQuery(serverFn(fnOrOptions, ...args));
  }
  return _useQuery(fnOrOptions);
}

// ── useSuspenseQuery — server function overload + TanStack pass-through ──

/**
 * Type-safe `useSuspenseQuery` that accepts server functions directly.
 * Data is guaranteed to be defined (no loading state).
 */
export function useSuspenseQuery<TArgs extends unknown[], TData>(
  fn: (...args: TArgs) => Promise<TData>,
  ...args: TArgs
): UseSuspenseQueryResult<TData, Error>;
export function useSuspenseQuery<
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
>(
  options: UseSuspenseQueryOptions<TQueryFnData, TError, TData>,
): UseSuspenseQueryResult<TData, TError>;
export function useSuspenseQuery(
  fnOrOptions:
    | ((...args: unknown[]) => Promise<unknown>)
    | UseSuspenseQueryOptions,
  ...args: unknown[]
): UseSuspenseQueryResult {
  if (typeof fnOrOptions === "function") {
    return _useSuspenseQuery(serverFn(fnOrOptions, ...args));
  }
  return _useSuspenseQuery(fnOrOptions);
}
