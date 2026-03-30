/**
 * Server function → TanStack Query integration.
 *
 * Provides type-safe `useQuery` and `useSuspenseQuery` that accept
 * server functions directly, with full TArgs + TData inference.
 *
 * @example
 * import { useQuery, useSuspenseQuery } from "@evjs/client";
 *
 * // Server function — args & data fully typed
 * const { data: users } = useQuery(getUsers);            // data: User[]
 * const { data: user } = useQuery(getUser, userId);      // data: User
 * const { data } = useSuspenseQuery(getUsers);           // data: User[]
 *
 * // Standard TanStack options — pass-through
 * const { data } = useQuery({ queryKey: [...], queryFn: ... });
 *
 * // Cache invalidation — use .queryKey() directly:
 * queryClient.invalidateQueries({ queryKey: getUsers.queryKey() });
 *
 * // For other hooks (useInfiniteQuery, prefetch, loaders), use .queryOptions():
 * useInfiniteQuery({ ...getPosts.queryOptions(), getNextPageParam: ... });
 * context.queryClient.ensureQueryData(getUsers.queryOptions());
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
import type { ServerFunction } from "./transport";
import { getFnId } from "./transport";

/**
 * Extracts the stable query key for a given server function and its arguments.
 * 
 * At runtime, server functions are augmented by the evjs compiler to carry internal metadata 
 * (like unique function IDs and query key generators). However, in plain TypeScript, importing 
 * a raw function from a `.server.ts` file only gives you its standard `() => Promise<T>` type signature.
 * 
 * This helper bridges the type gap, providing a completely type-safe way to extract the 
 * underlying TanStack Query key from the server function stub without triggering static TS errors.
 */
export function getFnQueryKey<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  ...args: Parameters<T>
): unknown[] {
  const fnId = getFnId(fn);
  if (!fnId) {
    throw new Error(`getFnQueryKey() only accepts server functions. Got: ${fn.name || "anonymous"}`);
  }
  return (fn as unknown as ServerFunction).queryKey(...args);
}

/**
 * Extracts the { queryKey, queryFn } object for TanStack Query options.
 * 
 * At runtime, server functions are augmented by the evjs compiler to carry internal metadata 
 * (like unique function IDs and query key generators). However, in plain TypeScript, importing 
 * a raw function from a `.server.ts` file only gives you its standard `() => Promise<T>` type signature.
 * 
 * This helper bridges the type gap, providing a completely type-safe way to extract the 
 * underlying TanStack Query Options from the server function stub without triggering static TS errors.
 */
export function getFnQueryOptions<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  ...args: Parameters<T>
): { queryKey: unknown[]; queryFn: (ctx: { signal: AbortSignal }) => ReturnType<T> } {
  const fnId = getFnId(fn);
  if (!fnId) {
    throw new Error(`getFnQueryOptions() only accepts server functions. Got: ${fn.name || "anonymous"}`);
  }
  return (fn as unknown as ServerFunction).queryOptions(...args) as any;
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
    const fnId = getFnId(fnOrOptions);
    if (!fnId) {
      throw new Error(
        `useQuery() only accepts server functions (with "use server" directive). Got: ${fnOrOptions.name || "anonymous"}`,
      );
    }
    return _useQuery((fnOrOptions as unknown as ServerFunction).queryOptions(...args));
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
    const fnId = getFnId(fnOrOptions);
    if (!fnId) {
      throw new Error(
        `useSuspenseQuery() only accepts server functions (with "use server" directive). Got: ${fnOrOptions.name || "anonymous"}`,
      );
    }
    return _useSuspenseQuery((fnOrOptions as unknown as ServerFunction).queryOptions(...args));
  }
  return _useSuspenseQuery(fnOrOptions);
}
