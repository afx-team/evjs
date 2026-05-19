/**
 * Client-side transport for calling server functions.
 *
 * When the build tools transform a `"use server"` module for the client
 * bundle, each exported function is replaced with a stub created by
 * `createServerReference(fnId, callServer)`. This module provides that factory.
 */

import {
  DEFAULT_ERROR_STATUS,
  getFunctionEndpoint,
  ServerFunctionError,
} from "@evjs/shared";

/**
 * Request context passed through server calls.
 *
 * Keep this limited to per-call controls. HTTP request defaults such as
 * headers and credentials belong on TransportOptions.
 *
 * Future SSR/RSC header forwarding should be derived from the real incoming
 * Request, or from a dedicated SSR request context, with explicit allow-listing
 * instead of adding generic headers here.
 */
export interface RequestContext {
  /** Signal for aborting the request. */
  signal?: AbortSignal;
}

interface StoredRequestContext {
  baseUrl?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

interface RequestContextStore {
  getStore(): StoredRequestContext | undefined;
}

export interface TransportAdapter {
  /** Execute a server function call. */
  send?(
    fnId: string,
    args: unknown[],
    context?: RequestContext,
  ): Promise<unknown>;
  /**
   * Experimental extension point reserved for future RSC Flight requests.
   *
   * Not part of the stable adapter contract yet; this signature may change
   * when RSC support is implemented.
   */
  flight?(
    request: Request,
    context?: RequestContext,
  ): Promise<Response | ReadableStream<Uint8Array>>;
  /**
   * Experimental extension point reserved for future SSR document rendering.
   *
   * Not part of the stable adapter contract yet; this signature may change
   * when SSR support is implemented.
   */
  render?(request: Request, context?: RequestContext): Promise<Response>;
}

type MaybePromise<T> = T | Promise<T>;

export type HeaderFactory = (
  context: RequestContext,
) => MaybePromise<HeadersInit | undefined>;

interface HttpRequestDefaults {
  /** Credentials policy for HTTP server function requests. */
  credentials?: RequestCredentials;
  /** Static headers or a factory evaluated for each transport call. */
  headers?: HeadersInit | HeaderFactory;
}

export interface TransportOptions {
  /** Base URL for the server function endpoint. Defaults to the current page URL. */
  baseUrl?: string;
  /** Credentials policy for HTTP server function requests. */
  credentials?: RequestCredentials;
  /** Static headers or a factory evaluated for each transport call. */
  headers?: HeadersInit | HeaderFactory;
  /** Server functions configuration */
  functions?: {
    /** Path prefix for the server function endpoint. Defaults to `api/fn`. */
    endpoint?: string;
  };
  /** Adapter capabilities for custom runtimes or protocols. */
  adapter?: TransportAdapter;
  /** Suppress warnings when re-initializing transport. Useful for HMR. */
  silent?: boolean;
}

interface TransportRuntime {
  adapter: TransportAdapter;
}

const FALLBACK_BASE_URL = "http://localhost/";

function getDefaultBaseUrl(): URL {
  const base = new URL(globalThis.location?.href ?? FALLBACK_BASE_URL);
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  return base;
}

function resolveBaseUrl(baseUrl?: string): URL {
  if (baseUrl === undefined) {
    return getDefaultBaseUrl();
  }

  return new URL(baseUrl, getDefaultBaseUrl());
}

function resolveEndpointUrl(
  baseUrl: string | undefined,
  endpoint: string,
): URL {
  const base = resolveBaseUrl(baseUrl);
  if (!base.pathname.endsWith("/")) {
    base.pathname += "/";
  }

  return new URL(endpoint, base);
}

const REQUEST_CONTEXT_KEY = Symbol.for("evjs.transport.requestContext");

function getRequestContextStore(): RequestContextStore | undefined {
  const store = (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT_KEY];
  if (typeof store !== "object" || store === null) return undefined;

  const candidate = store as Partial<RequestContextStore>;
  if (typeof candidate.getStore === "function")
    return candidate as RequestContextStore;
}

function getStoredRequestContext(): StoredRequestContext | undefined {
  return getRequestContextStore()?.getStore();
}

function mergeRequestContext(
  stored: StoredRequestContext | undefined,
  explicit: RequestContext | undefined,
): StoredRequestContext | undefined {
  if (!stored) return explicit;
  if (!explicit) return stored;

  return {
    ...stored,
    signal: explicit.signal ?? stored.signal,
  };
}

function mergeHeaders(...values: (HeadersInit | undefined)[]): Headers {
  const headers = new Headers();
  for (const value of values) {
    if (!value) continue;
    new Headers(value).forEach((headerValue, headerName) => {
      headers.set(headerName, headerValue);
    });
  }
  return headers;
}

async function resolveFetchInit(
  defaults: HttpRequestDefaults,
  context?: RequestContext,
): Promise<RequestInit> {
  const init: RequestInit = {};
  if (defaults.credentials !== undefined) {
    init.credentials = defaults.credentials;
  }

  const resolvedHeaders =
    typeof defaults.headers === "function"
      ? await defaults.headers(context ?? {})
      : defaults.headers;

  const headers = mergeHeaders(resolvedHeaders);
  if ([...headers.keys()].length > 0) {
    init.headers = headers;
  }
  return init;
}

/**
 * Default fetch-based adapter.
 */
function createFetchAdapter(
  resolveUrl: (baseUrl?: string) => URL,
  requestDefaults: HttpRequestDefaults,
): TransportAdapter {
  return {
    async send(fnId, args, context): Promise<unknown> {
      const requestContext = mergeRequestContext(
        getStoredRequestContext(),
        context,
      );
      const fetchInit = await resolveFetchInit(requestDefaults, context);
      const init: RequestInit = {
        ...fetchInit,
        method: "POST",
        headers: mergeHeaders(
          { "Content-Type": "application/json" },
          requestContext?.headers,
          fetchInit.headers,
        ),
        body: JSON.stringify({ fnId, args }),
        signal: requestContext?.signal,
      };

      const res = await fetch(resolveUrl(requestContext?.baseUrl), init);

      if (!res.ok) {
        // Read body as text once, then try to parse as JSON.
        // Response body is a one-shot stream — reading it twice would fail.
        const rawText = await res.text().catch(() => res.statusText);
        let errorPayload: {
          error?: string;
          fnId?: string;
          status?: number;
          data?: unknown;
        } | null = null;
        try {
          if (res.headers.get("Content-Type")?.includes("application/json")) {
            errorPayload = JSON.parse(rawText);
          }
        } catch {
          // Not JSON — use raw text for error message
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

        const name = getFnName(fnId);
        throw new ServerFunctionError(
          `Server function "${name}" failed (${res.status}): ${rawText}`,
          fnId,
          res.status,
        );
      }

      let payload: {
        result?: unknown;
        error?: string;
        fnId?: string;
        status?: number;
        data?: unknown;
      };
      try {
        payload = await res.json();
      } catch {
        throw new ServerFunctionError(
          `Server function "${getFnName(fnId)}" returned invalid JSON`,
          fnId,
          res.status,
        );
      }
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

let _runtime: TransportRuntime | null = null;

function createTransportRuntime(options: TransportOptions): TransportRuntime {
  const endpoint = options.functions?.endpoint ?? getFunctionEndpoint();
  return {
    adapter:
      options.adapter ??
      createFetchAdapter(
        (baseUrl) => resolveEndpointUrl(baseUrl ?? options.baseUrl, endpoint),
        {
          credentials: options.credentials,
          headers: options.headers,
        },
      ),
  };
}

function getRuntime(): TransportRuntime {
  if (!_runtime) {
    _runtime = createTransportRuntime({});
  }
  return _runtime;
}

/**
 * Configure the transport runtime. Call once at app startup if you need to
 * customize HTTP request defaults, endpoint URLs, or adapter capabilities.
 */
export function initTransport(options: TransportOptions): void {
  if (_runtime !== null && !options.silent) {
    console.warn(
      "[ev] initTransport() was called more than once. " +
        "This overwrites the previous transport configuration.",
    );
  }
  _runtime = createTransportRuntime(options);
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
  const runtime = getRuntime();
  const send = runtime.adapter.send;
  if (!send) {
    throw new Error("[ev] Transport adapter does not implement send().");
  }

  return send(fnId, args, context);
}

/** Minimal callable shape for server function stubs. */
type AnyFn = (...args: never[]) => unknown;

/**
 * A server function stub augmented with query metadata.
 *
 * These properties are attached at runtime by the
 * `createServerReference` call. TypeScript source types won't reflect them,
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
 * Follows the server reference argument order used by the compiler/runtime.
 *
 * @param fnId - The unique function hash ID.
 * @param exportName - The human-readable export name.
 * @returns An augmented server function stub.
 */
export function createServerReference(
  fnId: string,
  exportName?: string,
): ServerFunction {
  const fn = ((...args: unknown[]) =>
    callServer(fnId, args)) as unknown as ServerFunction;

  fnIdRegistry.set(fn as unknown as AnyFn, fnId);
  if (exportName) {
    fnNameRegistry.set(fnId, exportName);
  }

  fn.queryKey = (...args: unknown[]) => [fnId, ...args];
  fn.queryOptions = (...args: unknown[]) => ({
    queryKey: fn.queryKey(...args),
    queryFn: (ctx?: { signal?: AbortSignal }) =>
      callServer(fnId, args, { signal: ctx?.signal }) as Promise<unknown>,
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
  _runtime = null;
  fnNameRegistry.clear();
}
