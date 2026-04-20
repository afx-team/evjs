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
 * // Cache invalidation — use getFnQueryKey():
 * queryClient.invalidateQueries({ queryKey: getFnQueryKey(getUsers) });
 *
 * // For other hooks (useInfiniteQuery, prefetch, loaders), use getFnQueryOptions():
 * useInfiniteQuery({ ...getFnQueryOptions(getPosts), getNextPageParam: ... });
 * context.queryClient.ensureQueryData(getFnQueryOptions(getUsers));
 */

import type {
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
  UseSuspenseQueryOptions,
  UseSuspenseQueryResult,
} from "@tanstack/react-query";
import {
  useMutation as _useMutation,
  useQuery as _useQuery,
  useSuspenseQuery as _useSuspenseQuery,
} from "@tanstack/react-query";
import type { ServerFunction } from "./transport";
import { callServer, getFnId } from "./transport";

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
// biome-ignore lint/suspicious/noExplicitAny: Required for broad generic inference
export function getFnQueryKey<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  ...args: Parameters<T>
): unknown[] {
  const fnId = getFnId(fn);
  if (!fnId) {
    throw new Error(
      `getFnQueryKey() only accepts server functions. Got: ${fn.name || "anonymous"}`,
    );
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
// biome-ignore lint/suspicious/noExplicitAny: Required for broad generic inference
export function getFnQueryOptions<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  ...args: Parameters<T>
): {
  queryKey: unknown[];
  queryFn: (ctx: { signal: AbortSignal }) => ReturnType<T>;
} {
  const fnId = getFnId(fn);
  if (!fnId) {
    throw new Error(
      `getFnQueryOptions() only accepts server functions. Got: ${fn.name || "anonymous"}`,
    );
  }
  // biome-ignore lint/suspicious/noExplicitAny: Bypass strict internal typing for user return
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
    return _useQuery(
      (fnOrOptions as unknown as ServerFunction).queryOptions(...args),
    );
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
    return _useSuspenseQuery(
      (fnOrOptions as unknown as ServerFunction).queryOptions(...args),
    );
  }
  return _useSuspenseQuery(fnOrOptions);
}

// ── useMutation — server function overload + TanStack pass-through ──

/**
 * Type-safe `useMutation` that accepts server functions directly.
 *
 * @example
 * const { mutateAsync } = useMutation(createUser);
 * await mutateAsync({ name: "Alice", email: "alice@example.com" });
 *
 * // With additional TanStack options:
 * const { mutateAsync } = useMutation(createUser, {
 *   onSuccess: () => queryClient.invalidateQueries({ queryKey: getFnQueryKey(getUsers) }),
 * });
 *
 * // Standard TanStack pass-through:
 * const { mutateAsync } = useMutation({ mutationFn: createUser });
 */
export function useMutation<TArgs extends unknown[], TData>(
  fn: (...args: TArgs) => Promise<TData>,
  options?: Omit<
    UseMutationOptions<TData, Error, TArgs extends [infer A] ? A : TArgs>,
    "mutationFn"
  >,
): UseMutationResult<TData, Error, TArgs extends [infer A] ? A : TArgs>;
export function useMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext>;
export function useMutation(
  fnOrOptions:
    | ((...args: unknown[]) => Promise<unknown>)
    // biome-ignore lint/suspicious/noExplicitAny: Implementation signature must be wide enough for both overloads
    | UseMutationOptions<any, any, any, any>,
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature must be wide enough for both overloads
  extraOptions?: Omit<UseMutationOptions<any, any, any, any>, "mutationFn">,
  // biome-ignore lint/suspicious/noExplicitAny: Implementation signature must be wide enough for both overloads
): UseMutationResult<any, any, any, any> {
  if (typeof fnOrOptions === "function") {
    const fnId = getFnId(fnOrOptions);
    if (!fnId) {
      throw new Error(
        `useMutation() only accepts server functions (with "use server" directive). Got: ${fnOrOptions.name || "anonymous"}`,
      );
    }
    // biome-ignore lint/suspicious/noExplicitAny: Wrap server fn for single-arg call convention
    const mutationFn = (vars: any) => {
      const args = Array.isArray(vars) ? vars : [vars];
      return callServer(fnId, args);
    };
    return _useMutation({ ...extraOptions, mutationFn });
  }
  return _useMutation(fnOrOptions);
}
