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
import { isRecord } from "../shared/validation.js";
import type { ServerFunction } from "./transport.js";
import { callServer, getServerFunction } from "./transport-runtime.js";

// biome-ignore lint/suspicious/noConfusingVoidType: TanStack uses void variables to allow mutate() without an argument.
type NoMutationVariables = void;
type ServerMutationVariables<TArgs extends unknown[]> = TArgs extends []
  ? NoMutationVariables
  : TArgs extends [infer Arg]
    ? Arg
    : TArgs;
type AsyncServerFunction<TArgs extends unknown[], TData> = (
  ...args: TArgs
) => Promise<TData>;
type ServerMutationOptions = Omit<
  UseMutationOptions<unknown, unknown, unknown, unknown>,
  "mutationFn"
>;

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
export function getFnQueryKey<TArgs extends unknown[], TData>(
  fn: AsyncServerFunction<TArgs, TData>,
  ...args: TArgs
): unknown[] {
  return requireServerFunction(
    fn,
    "[evjs] getFnQueryKey() only accepts compiler-generated server function stubs. Plain functions do not carry the server-boundary metadata required for query keys.",
  ).queryKey(...args);
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
export function getFnQueryOptions<TArgs extends unknown[], TData>(
  fn: AsyncServerFunction<TArgs, TData>,
  ...args: TArgs
): {
  queryKey: unknown[];
  queryFn: (ctx?: { signal?: AbortSignal }) => Promise<TData>;
} {
  return requireServerFunction(
    fn,
    "[evjs] getFnQueryOptions() only accepts compiler-generated server function stubs. Plain functions do not carry the server-boundary metadata required for query options.",
  ).queryOptions(...args);
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
    const serverFunction = requireServerFunction(
      fnOrOptions,
      '[evjs] useQuery() only accepts server functions generated from "use server" modules. Plain async functions do not carry the server-boundary metadata required for framework dispatch.',
    );
    return _useQuery(serverFunction.queryOptions(...args));
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
    const serverFunction = requireServerFunction(
      fnOrOptions,
      '[evjs] useSuspenseQuery() only accepts server functions generated from "use server" modules. Plain async functions do not carry the server-boundary metadata required for framework dispatch.',
    );
    return _useSuspenseQuery(serverFunction.queryOptions(...args));
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
    UseMutationOptions<TData, Error, ServerMutationVariables<TArgs>>,
    "mutationFn"
  >,
): UseMutationResult<TData, Error, ServerMutationVariables<TArgs>>;
export function useMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext>;
export function useMutation(
  fnOrOptions: unknown,
  extraOptions?: unknown,
): UseMutationResult<unknown, unknown, unknown, unknown> {
  if (typeof fnOrOptions === "function") {
    const fn = fnOrOptions as (...args: unknown[]) => Promise<unknown>;
    const serverFunction = requireServerFunction(
      fn,
      '[evjs] useMutation() only accepts server functions generated from "use server" modules. Plain async functions do not carry the server-boundary metadata required for framework dispatch.',
    );
    const mutationFn = (variables: unknown) => {
      const args = serializeMutationArgs(serverFunction, variables);
      return callServer(serverFunction.fnId, args);
    };
    assertServerMutationOptions(extraOptions);
    return _useMutation({ ...extraOptions, mutationFn });
  }
  return _useMutation(
    fnOrOptions as UseMutationOptions<unknown, unknown, unknown, unknown>,
  );
}

function serializeMutationArgs(
  fn: ServerFunction,
  variables: unknown,
): unknown[] {
  if (fn.fnArity === 0) return [];
  if (fn.fnArity === 1) return [variables];
  if (typeof fn.fnArity === "number" && fn.fnArity > 1) {
    if (!Array.isArray(variables)) {
      throw new Error(
        `[evjs] useMutation() server function "${fn.fnName}" expects ${fn.fnArity} arguments. Pass mutation variables as a tuple array.`,
      );
    }
    if (variables.length !== fn.fnArity) {
      throw new Error(
        `[evjs] useMutation() server function "${fn.fnName}" expects ${fn.fnArity} arguments but received ${variables.length}.`,
      );
    }
    return variables;
  }

  if (variables === undefined) return [];
  return Array.isArray(variables) ? variables : [variables];
}

function requireServerFunction<TArgs extends unknown[], TData>(
  fn: AsyncServerFunction<TArgs, TData>,
  message: string,
): ServerFunction<TArgs, TData> {
  const serverFunction = getServerFunction(fn);
  if (serverFunction) return serverFunction;
  throw new Error(`${message} Received ${formatFunctionCandidate(fn)}.`);
}

function formatFunctionCandidate(value: unknown): string {
  const name = typeof value === "function" ? value.name : undefined;
  return name ? `function "${name}"` : "an anonymous function";
}

function assertServerMutationOptions(
  options: unknown,
): asserts options is ServerMutationOptions | undefined {
  if (options === undefined) return;
  if (!isRecord(options)) {
    throw new Error(
      "[evjs] useMutation() server function options must be an object when provided.",
    );
  }
  if ("mutationFn" in options) {
    throw new Error(
      "[evjs] useMutation() server function options must not include mutationFn. Pass the server function as the first argument instead.",
    );
  }
}
