/**
 * Client-side transport for calling server functions.
 *
 * When the build tools transform a `"use server"` module for the client
 * bundle, each exported function is replaced with a stub created by
 * `createServerReference(fnId, callServer)`. This module provides that factory.
 */

import {
  DEFAULT_ENDPOINT,
  DEFAULT_ERROR_STATUS,
  ServerFunctionError,
} from "@evjs/shared";

/**
 * Request context passed through server calls.
 * Used during SSR to forward headers/cookies, and in RSC for streaming.
 *
 * @experimental This interface is reserved for future SSR/RSC support.
 * Do not rely on it in production — the shape may change.
 */
export interface RequestContext {
  /** @experimental Request headers to forward (e.g. cookies during SSR). SSR is not yet supported. */
  headers?: Record<string, string>;
  /** Signal for aborting the request. */
  signal?: AbortSignal;
}

/**
 * Transport interface for client-server communication.
 * Implement this to use a custom request library or protocol.
 */
export interface ServerTransport {
  /** Standard request-response call for server functions. */
  send(
    fnId: string,
    args: unknown[],
    context?: RequestContext,
  ): Promise<unknown>;

  /**
   * Streaming call for RSC Flight protocol.
   * Returns a ReadableStream of serialized React elements.
   *
   * @experimental Not yet implemented. Reserved for future RSC support.
   * Do not use — this method signature may change.
   */
  stream?(
    fnId: string,
    args: unknown[],
    context?: RequestContext,
  ): ReadableStream<Uint8Array>;
}

export interface TransportOptions {
  /** Base URL for the server function endpoint. Defaults to the current origin. */
  baseUrl?: string;
  /** Path prefix for the server function endpoint. Defaults to `/api/fn`. */
  endpoint?: string;
  /** Custom transport. When provided, `baseUrl`, `endpoint`, and `headers` are ignored. */
  transport?: ServerTransport;
  /** Custom headers to send with requests, either static or a dynamic getter (e.g. for auth tokens). */
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Suppress warnings when re-initializing transport. Useful for HMR. */
  silent?: boolean;
}

/**
 * Default fetch-based transport.
 */
function createFetchTransport(
  baseUrl: string,
  endpoint: string,
  headersFactory?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>),
): ServerTransport {
  return {
    async send(
      fnId: string,
      args: unknown[],
      context?: RequestContext,
    ): Promise<unknown> {
      const url = `${baseUrl}${endpoint}`;

      const extraHeaders =
        typeof headersFactory === "function"
          ? await headersFactory()
          : headersFactory;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...extraHeaders,
          ...context?.headers,
        },
        body: JSON.stringify({ fnId, args }),
        signal: context?.signal,
      });

      if (!res.ok) {
        // Try to parse structured error body first
        let errorPayload: {
          error?: string;
          fnId?: string;
          status?: number;
          data?: unknown;
        } | null = null;
        try {
          errorPayload = await res.json();
        } catch {
          // Not JSON — fall back to text
        }

        if (errorPayload?.error) {
          const name = getFnName(errorPayload.fnId ?? fnId);
          throw new ServerFunctionError(
            `Server function "${name}" threw: ${errorPayload.error}`,
            errorPayload.fnId ?? fnId,
            errorPayload.status ?? res.status,
            { data: errorPayload.data },
          );
        }

        const text = await res.text().catch(() => res.statusText);
        const name = getFnName(fnId);
        throw new ServerFunctionError(
          `Server function "${name}" failed (${res.status}): ${text}`,
          fnId,
          res.status,
        );
      }

      const payload = await res.json();
      if (payload.error) {
        const name = getFnName(fnId);
        throw new ServerFunctionError(
          `Server function "${name}" threw: ${payload.error}`,
          (payload.fnId as string) ?? fnId,
          (payload.status as number) ?? DEFAULT_ERROR_STATUS,
          { data: payload.data },
        );
      }

      return payload.result;
    },
  };
}

let _transport: ServerTransport | null = null;

function getTransport(): ServerTransport {
  if (!_transport) {
    _transport = createFetchTransport("", DEFAULT_ENDPOINT);
  }
  return _transport;
}

/**
 * Configure the server transport. Call once at app startup if you need to
 * customise the endpoint URL or provide a custom transport.
 */
export function initTransport(options: TransportOptions): void {
  if (_transport !== null && !options.silent) {
    console.warn(
      "[ev] initTransport() was called more than once. " +
        "This overwrites the previous transport configuration.",
    );
  }
  if (options.transport) {
    _transport = options.transport;
  } else {
    _transport = createFetchTransport(
      options.baseUrl ?? "",
      options.endpoint ?? DEFAULT_ENDPOINT,
      options.headers,
    );
  }
}

/**
 * Call a server function by its unique ID.
 *
 * @internal Used by createServerReference. Do not call directly.
 */
export async function callServer(
  fnId: string,
  args: unknown[],
  context?: RequestContext,
): Promise<unknown> {
  return getTransport().send(fnId, args, context);
}

/** Minimal callable shape for server function stubs. */
type AnyFn = (...args: never[]) => unknown;

/**
 * A server function stub augmented with query metadata.
 *
 * These properties are attached at runtime by the build system's
 * `__fn_register` call. TypeScript source types won't reflect them,
 * so use this type when you need typed access to the metadata.
 *
 * @example
 * import type { ServerFunction } from "@evjs/client";
 * import { getUsers } from "./api/users.server";
 *
 * // Runtime properties (added by build system):
 * getUsers.queryKey()   // → ["<fnId>"]
 * getUsers.fnId         // → "<hash>"
 * getUsers.fnName       // → "getUsers"
 *
 * // For typed access in generic code:
 * function invalidate<T extends ServerFunction>(fn: T) {
 *   queryClient.invalidateQueries({ queryKey: fn.queryKey() });
 * }
 */
export interface ServerFunction<
  TArgs extends unknown[] = unknown[],
  TData = unknown,
> {
  (...args: TArgs): Promise<TData>;
  /** Build a TanStack Query key from the function ID + arguments. */
  queryKey(...args: TArgs): unknown[];
  /** Returns a QueryOptions object with queryKey and queryFn for TanStack Query loaders/prefetching. */
  queryOptions(...args: TArgs): {
    queryKey: unknown[];
    queryFn: (ctx?: { signal?: AbortSignal }) => Promise<TData>;
  };
  /** The internal function ID (stable SHA-256 hash). */
  readonly fnId: string;
  /** The human-readable export name. */
  readonly fnName: string;
}

/**
 * Internal registry mapping server function references to their IDs.
 * Uses WeakMap so function stubs can be garbage collected.
 */
const fnIdRegistry = new WeakMap<AnyFn, string>();

/**
 * Internal registry mapping function IDs to human-readable export names.
 */
const fnNameRegistry = new Map<string, string>();

/**
 * Look up the human-readable export name for a function ID.
 * Falls back to the fnId itself if no name is registered.
 */
export function getFnName(fnId: string): string {
  return fnNameRegistry.get(fnId) ?? fnId;
}

/**
 * Create a server reference stub for a server function.
 *
 * Returns a callable function that forwards calls to `callServerFn(fnId, args)`.
 * The returned function is augmented with `.queryKey()`, `.queryOptions()`,
 * `.fnId`, and `.fnName` metadata for use with TanStack Query.
 *
 * Follows the React Server Components convention.
 *
 * @param fnId - The unique function hash ID.
 * @param callServerFn - The transport function (typically `callServer`).
 * @param exportName - The human-readable export name.
 * @returns An augmented server function stub.
 */
export function createServerReference(
  fnId: string,
  callServerFn: typeof callServer,
  exportName?: string,
): ServerFunction {
  const fn = ((...args: unknown[]) =>
    callServerFn(fnId, args)) as unknown as ServerFunction;

  fnIdRegistry.set(fn as unknown as AnyFn, fnId);
  if (exportName) {
    fnNameRegistry.set(fnId, exportName);
  }

  fn.queryKey = (...args: unknown[]) => [fnId, ...args];
  fn.queryOptions = (...args: unknown[]) => ({
    queryKey: fn.queryKey(...args),
    queryFn: (ctx?: { signal?: AbortSignal }) =>
      callServerFn(fnId, args, { signal: ctx?.signal }) as Promise<unknown>,
  });
  Object.defineProperty(fn, "fnId", { value: fnId, writable: false });
  Object.defineProperty(fn, "fnName", {
    value: exportName ?? fnId,
    writable: false,
  });

  return fn;
}

/**
 * Look up the internal function ID for a server function stub.
 * Returns undefined if the function is not a registered server function.
 */
export function getFnId(fn: AnyFn): string | undefined {
  return fnIdRegistry.get(fn);
}

/**
 * Reset all transport state. **Test-only** — not available in production builds.
 * @internal
 */
export function __resetForTesting(): void {
  _transport = null;
  fnNameRegistry.clear();
}
