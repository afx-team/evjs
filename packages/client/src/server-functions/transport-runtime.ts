/**
 * Client-side transport runtime for calling server functions.
 *
 * When the build tools transform a `"use server"` module for the client
 * bundle, each exported function is replaced with a stub created by
 * `createServerReference(fnId, callServer)`. This module provides that factory.
 */

import {
  APPLICATION_JSON_CONTENT_TYPE,
  assertServerFunctionId,
  DEFAULT_ERROR_STATUS,
  formatContentTypeHeaderValue,
  getFunctionEndpoint,
  getUrlStringValidationError,
  isApplicationJsonContentType,
  isHeadersInit,
  isHttpErrorStatus,
  isServerFunctionExportName,
  isServerFunctionId,
  ServerFunctionError,
  type UrlStringValidationError,
} from "@evjs/shared";
import {
  type FetchResponseObject,
  getFetchResponseContentType,
  readFetchErrorResponseBody,
} from "../shared/fetch-response.js";
import {
  assertClientRuntimeTransport,
  type ClientRuntime,
  getClientRuntimeTransport,
  getGlobalRuntimeTransport,
  hasClientRuntimeTransport,
  type RuntimeTransportOptions,
} from "../shared/runtime-config.js";
import { formatErrorDetail, isRecord } from "../shared/validation.js";

export type { RuntimeTransportOptions } from "../shared/runtime-config.js";

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

export interface TransportAdapter {
  /** Execute a server function call. */
  send?(
    fnId: string,
    args: unknown[],
    context?: RequestContext,
  ): Promise<unknown>;
}

type MaybePromise<T> = T | Promise<T>;

export type HeaderFactory = (
  context: RequestContext,
) => MaybePromise<HeadersInit | undefined>;

interface BaseTransportOptions {
  /** Base URL for framework server calls. Defaults to the current page origin. */
  baseUrl?: string;
  /** Credentials policy for framework server requests. */
  credentials?: RequestCredentials;
}

interface HttpRequestDefaults {
  /** Credentials policy for framework server requests. */
  credentials?: RequestCredentials;
  /** Static headers or a factory evaluated for each transport call. */
  headers?: HeadersInit | HeaderFactory;
}

export interface TransportOptions extends BaseTransportOptions {
  /** Static headers or a factory evaluated for each transport call. */
  headers?: HeadersInit | HeaderFactory;
  /** Server function endpoint override for standalone/custom runtimes. */
  functions?: {
    /** Path or URL for the server function endpoint. */
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

interface ServerFunctionErrorPayload {
  error: string;
  fnId?: unknown;
  status?: unknown;
  data?: unknown;
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

function createInvalidFetchResponseError(
  fnId: string,
  detail: string,
): ServerFunctionError {
  return new ServerFunctionError(
    `Server function "${getFnName(fnId)}" received an invalid fetch Response object: ${detail}`,
    fnId,
    0,
  );
}

function createRequestPreparationError(
  fnId: string,
  error: unknown,
): ServerFunctionError {
  const cause = error instanceof Error ? error : undefined;
  return new ServerFunctionError(
    `Server function "${getFnName(fnId)}" failed to prepare the request${formatErrorDetail(error)}`,
    fnId,
    0,
    { cause },
  );
}

function assertFetchResponseObject(
  value: unknown,
  fnId: string,
): asserts value is FetchResponseObject {
  if (!isRecord(value)) {
    throw createInvalidFetchResponseError(
      fnId,
      "fetch returned a non-object response.",
    );
  }
  if (typeof value.ok !== "boolean") {
    throw createInvalidFetchResponseError(
      fnId,
      "fetch Response.ok must be a boolean.",
    );
  }
}

function assertFetchResponseText(
  response: FetchResponseObject,
  fnId: string,
): asserts response is FetchResponseObject & {
  text: () => Promise<string>;
} {
  if (typeof response.text !== "function") {
    throw createInvalidFetchResponseError(
      fnId,
      "fetch Response.text must be a function.",
    );
  }
}

function assertFetchErrorResponse(
  response: FetchResponseObject,
  fnId: string,
): asserts response is FetchResponseObject & {
  status: number;
  statusText: string;
  text: () => Promise<string>;
} {
  if (typeof response.status !== "number") {
    throw createInvalidFetchResponseError(
      fnId,
      "fetch Response.status must be a number when ok is false.",
    );
  }
  if (typeof response.statusText !== "string") {
    throw createInvalidFetchResponseError(
      fnId,
      "fetch Response.statusText must be a string when ok is false.",
    );
  }
  assertFetchResponseText(response, fnId);
}

function assertFetchResponseJson(
  response: FetchResponseObject,
  fnId: string,
): asserts response is FetchResponseObject & {
  json: () => Promise<unknown>;
} {
  if (typeof response.json !== "function") {
    throw createInvalidFetchResponseError(
      fnId,
      "fetch Response.json must be a function.",
    );
  }
}

function assertFetchSuccessResponse(
  response: FetchResponseObject,
  fnId: string,
): asserts response is FetchResponseObject & {
  json: () => Promise<unknown>;
} {
  assertFetchResponseJson(response, fnId);
  const contentType = getFetchResponseContentType(response);
  if (isApplicationJsonContentType(contentType)) return;

  throw new ServerFunctionError(
    `Server function "${getFnName(fnId)}" returned invalid response Content-Type ${formatContentTypeHeaderValue(
      contentType,
    )}; expected "${APPLICATION_JSON_CONTENT_TYPE}".`,
    fnId,
    getFetchResponseStatus(response),
  );
}

function getFetchResponseStatus(response: FetchResponseObject): number {
  return typeof response.status === "number" ? response.status : 0;
}

async function readFetchErrorResponseText(
  response: FetchResponseObject & {
    statusText: string;
  },
): Promise<string> {
  const responseBody = await readFetchErrorResponseBody(response);
  return responseBody || response.statusText;
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
  resolveUrl: () => URL,
  requestDefaults: HttpRequestDefaults,
): TransportAdapter {
  return {
    async send(fnId, args, context): Promise<unknown> {
      let init: RequestInit;
      try {
        const fetchInit = await resolveFetchInit(requestDefaults, context);
        init = {
          ...fetchInit,
          method: "POST",
          headers: mergeHeaders(fetchInit.headers, {
            "Content-Type": APPLICATION_JSON_CONTENT_TYPE,
          }),
          body: JSON.stringify({ fnId, args }),
          signal: context?.signal,
        };
      } catch (error) {
        throw createRequestPreparationError(fnId, error);
      }

      let res: FetchResponseObject;
      try {
        const response = await fetch(resolveUrl(), init);
        assertFetchResponseObject(response, fnId);
        res = response;
      } catch (error) {
        if (error instanceof ServerFunctionError) {
          throw error;
        }
        const cause = error instanceof Error ? error : undefined;
        throw new ServerFunctionError(
          `Server function "${getFnName(fnId)}" failed to reach the server${formatErrorDetail(error)}`,
          fnId,
          0,
          { cause },
        );
      }

      if (!res.ok) {
        assertFetchErrorResponse(res, fnId);
        const responseStatus = res.status;
        // Read body as text once, then try to parse as JSON.
        // Response body is a one-shot stream — reading it twice would fail.
        const responseText = await readFetchErrorResponseText(res);
        let errorPayload: unknown = null;
        try {
          if (isApplicationJsonContentType(getFetchResponseContentType(res))) {
            errorPayload = JSON.parse(responseText);
          }
        } catch {
          // Not JSON — use response text for error message
        }

        if (isServerFunctionErrorPayload(errorPayload)) {
          const payloadFnId = resolveErrorPayloadFnId(errorPayload.fnId, fnId);
          const name = getFnName(payloadFnId);
          throw new ServerFunctionError(
            `Server function "${name}" threw: ${errorPayload.error}`,
            payloadFnId,
            resolveErrorPayloadStatus(errorPayload.status, responseStatus),
            { data: errorPayload.data },
          );
        }

        const name = getFnName(fnId);
        throw new ServerFunctionError(
          `Server function "${name}" failed (${responseStatus}): ${responseText}`,
          fnId,
          responseStatus,
        );
      }

      let payload: unknown;
      assertFetchSuccessResponse(res, fnId);
      try {
        payload = await res.json();
      } catch {
        throw new ServerFunctionError(
          `Server function "${getFnName(fnId)}" returned invalid JSON`,
          fnId,
          getFetchResponseStatus(res),
        );
      }
      if (!isRecord(payload)) {
        throw new ServerFunctionError(
          `Server function "${getFnName(fnId)}" returned invalid response payload`,
          fnId,
          getFetchResponseStatus(res),
        );
      }
      if ("error" in payload) {
        if (!isServerFunctionErrorPayload(payload)) {
          throw new ServerFunctionError(
            `Server function "${getFnName(fnId)}" returned invalid response payload`,
            fnId,
            getFetchResponseStatus(res),
          );
        }
        const payloadFnId = resolveErrorPayloadFnId(payload.fnId, fnId);
        const name = getFnName(payloadFnId);
        throw new ServerFunctionError(
          `Server function "${name}" threw: ${payload.error}`,
          payloadFnId,
          resolveErrorPayloadStatus(payload.status, DEFAULT_ERROR_STATUS),
          { data: payload.data },
        );
      }

      return readServerFunctionSuccessResult(payload);
    },
  };
}

function readServerFunctionSuccessResult(payload: Record<string, unknown>) {
  return Object.hasOwn(payload, "result") ? payload.result : undefined;
}

let _runtime: TransportRuntime | null = null;
let _runtimeSource: "default" | "global" | "client-runtime" | "user" | null =
  null;

function createTransportRuntime(options: TransportOptions): TransportRuntime {
  const endpoint = options.functions?.endpoint ?? getFunctionEndpoint();

  return {
    adapter:
      options.adapter ??
      createFetchAdapter(() => resolveEndpointUrl(options.baseUrl, endpoint), {
        credentials: options.credentials,
        headers: options.headers,
      }),
  };
}

function getRuntime(): TransportRuntime {
  if (!_runtime) {
    const transport = getGlobalRuntimeTransport();
    _runtime = createTransportRuntime(transport ?? {});
    _runtimeSource = transport ? "global" : "default";
  }
  return _runtime;
}

/**
 * Configure the transport runtime. Call once at app startup if you need to
 * customize HTTP request defaults, server origin, or adapter capabilities.
 */
export function initTransport(options: TransportOptions = {}): void {
  assertTransportOptions(options);
  if (_runtime !== null && !options.silent) {
    console.warn(
      "[evjs] initTransport() was called more than once. " +
        "This overwrites the previous transport configuration.",
    );
  }
  _runtime = createTransportRuntime(options);
  _runtimeSource = "user";
}

/**
 * Initialize the default HTTP transport from the generated client runtime.
 *
 * Framework-managed runtimes call this before loading user modules. Explicit
 * initTransport() calls still win, so custom adapters are not overwritten.
 */
export function initTransportFromRuntime(
  runtime: Pick<ClientRuntime, "runtime">,
): void {
  const transport =
    readClientRuntimeTransport(runtime) ?? getGlobalRuntimeTransport();
  if (!transport || _runtimeSource === "user") return;

  _runtime = createTransportRuntime(transport);
  _runtimeSource = "client-runtime";
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
  assertServerFunctionCall(fnId, args);
  const runtime = getRuntime();
  const send = runtime.adapter.send;
  if (!send) {
    throw new Error("[evjs] Transport adapter does not implement send().");
  }

  return send(fnId, args, context);
}

/** Minimal callable shape for server function stubs. */
type AnyFn = (...args: unknown[]) => unknown;

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
 * getUsers.fnArity      // → declared parameter count
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
  /** The number of declared parameters in the original server function. */
  readonly fnArity?: number;
}

/**
 * Internal registry mapping server function references to their IDs.
 * Uses WeakMap so function stubs can be garbage collected.
 */
const fnIdRegistry = new WeakMap<object, string>();

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
 * @param exportName - The human-readable export name.
 * @returns An augmented server function stub.
 */
export function createServerReference(
  fnId: string,
  exportName?: string,
  arity?: number,
): ServerFunction {
  assertServerReferenceMetadata(fnId, exportName);
  const fnArity = normalizeServerReferenceArity(arity);
  const queryKey = (...args: unknown[]) => [fnId, ...args];
  const queryOptions = (...args: unknown[]) => ({
    queryKey: queryKey(...args),
    queryFn: (ctx?: { signal?: AbortSignal }) =>
      callServer(fnId, args, { signal: ctx?.signal }),
  });
  const fn = defineServerFunctionMetadata(
    (...args: unknown[]) => callServer(fnId, args),
    {
      fnId,
      fnName: exportName ?? fnId,
      fnArity,
      queryKey,
      queryOptions,
    },
  );

  fnIdRegistry.set(fn, fnId);
  if (exportName) {
    fnNameRegistry.set(fnId, exportName);
  }

  return fn;
}

interface ServerFunctionMetadata {
  fnId: string;
  fnName: string;
  fnArity?: number;
  queryKey: (...args: unknown[]) => unknown[];
  queryOptions: (...args: unknown[]) => {
    queryKey: unknown[];
    queryFn: (ctx?: { signal?: AbortSignal }) => Promise<unknown>;
  };
}

function defineServerFunctionMetadata(
  fn: (...args: unknown[]) => Promise<unknown>,
  metadata: ServerFunctionMetadata,
): ServerFunction {
  Object.defineProperty(fn, "queryKey", {
    value: metadata.queryKey,
    writable: false,
    enumerable: true,
  });
  Object.defineProperty(fn, "queryOptions", {
    value: metadata.queryOptions,
    writable: false,
    enumerable: true,
  });
  Object.defineProperty(fn, "fnId", {
    value: metadata.fnId,
    writable: false,
  });
  Object.defineProperty(fn, "fnName", {
    value: metadata.fnName,
    writable: false,
  });
  if (metadata.fnArity !== undefined) {
    Object.defineProperty(fn, "fnArity", {
      value: metadata.fnArity,
      writable: false,
    });
  }

  return fn as ServerFunction;
}

function normalizeServerReferenceArity(
  arity: number | undefined,
): number | undefined {
  if (arity === undefined) return undefined;
  if (Number.isInteger(arity) && arity >= 0) return arity;
  throw new Error(
    "[evjs] createServerReference() arity must be a non-negative integer.",
  );
}

function assertServerFunctionCall(fnId: string, args: unknown[]): void {
  assertServerFunctionId(fnId, "callServer()");
  if (!Array.isArray(args)) {
    throw new Error("[evjs] callServer() args must be an array.");
  }
}

function assertServerReferenceMetadata(
  fnId: string,
  exportName: string | undefined,
): void {
  assertServerFunctionId(fnId, "createServerReference()");
  if (exportName === undefined) return;

  if (!isServerFunctionExportName(exportName)) {
    throw new Error(
      "[evjs] createServerReference() exportName must be a non-empty string without leading or trailing whitespace when provided.",
    );
  }
}

function isServerFunctionErrorPayload(
  value: unknown,
): value is ServerFunctionErrorPayload {
  return isRecord(value) && typeof value.error === "string";
}

function resolveErrorPayloadFnId(value: unknown, fallback: string): string {
  return isServerFunctionId(value) ? value : fallback;
}

function resolveErrorPayloadStatus(value: unknown, fallback: number): number {
  if (isHttpErrorStatus(value)) return value;
  if (isHttpErrorStatus(fallback)) return fallback;
  return DEFAULT_ERROR_STATUS;
}

function assertTransportOptions(
  options: unknown,
): asserts options is TransportOptions {
  if (!isRecord(options)) {
    throw new Error("[evjs] initTransport() options must be an object.");
  }

  assertBaseTransportOptions(options, "initTransport()");

  if (options.headers !== undefined && typeof options.headers !== "function") {
    if (!isHeadersInit(options.headers)) {
      throw new Error(
        "[evjs] initTransport() headers must be valid HeadersInit or a header factory.",
      );
    }
  }

  if (options.functions !== undefined) {
    assertTransportFunctionsOptions(options.functions);
  }

  if (options.adapter !== undefined) {
    assertTransportAdapter(options.adapter);
  }

  if (options.silent !== undefined && typeof options.silent !== "boolean") {
    throw new Error("[evjs] initTransport() silent must be a boolean.");
  }
}

function assertTransportFunctionsOptions(
  functions: unknown,
  source = "initTransport() functions",
): asserts functions is NonNullable<TransportOptions["functions"]> {
  if (!isRecord(functions)) {
    throw new Error(`[evjs] ${source} must be an object.`);
  }

  if (functions.endpoint !== undefined) {
    assertTransportEndpoint(functions.endpoint, `${source}.endpoint`);
  }
}

function assertBaseTransportOptions(
  options: Record<string, unknown>,
  source: string,
): void {
  if (options.baseUrl !== undefined) {
    assertTransportBaseUrl(
      options.baseUrl,
      formatTransportOptionSource(source, "baseUrl"),
    );
  }

  if (
    options.credentials !== undefined &&
    options.credentials !== "omit" &&
    options.credentials !== "same-origin" &&
    options.credentials !== "include"
  ) {
    throw new Error(
      `[evjs] ${formatTransportOptionSource(source, "credentials")} must be "omit", "same-origin", or "include".`,
    );
  }
}

function formatTransportOptionSource(source: string, key: string): string {
  return source.endsWith(")") ? `${source} ${key}` : `${source}.${key}`;
}

function assertTransportAdapter(
  adapter: unknown,
): asserts adapter is TransportAdapter {
  if (!isRecord(adapter)) {
    throw new Error("[evjs] initTransport() adapter must be an object.");
  }

  if (adapter.send !== undefined && typeof adapter.send !== "function") {
    throw new Error(
      "[evjs] initTransport() adapter.send must be a function when provided.",
    );
  }

  for (const key of ["flight", "render"] as const) {
    if (adapter[key] !== undefined) {
      throw new Error(
        `[evjs] initTransport() adapter.${key} is not supported. Custom transports only support send(fnId, args, context).`,
      );
    }
  }
}

function assertTransportBaseUrl(value: unknown, source: string): string {
  const error = getUrlStringValidationError(value, {
    baseUrl: getDefaultBaseUrl(),
  });
  if (error) {
    throw new Error(`[evjs] ${source} ${formatTransportBaseUrlError(error)}`);
  }
  return value as string;
}

function assertTransportEndpoint(value: unknown, source: string): string {
  const error = getUrlStringValidationError(value, {
    baseUrl: getDefaultBaseUrl(),
  });
  if (error) {
    throw new Error(`[evjs] ${source} ${formatTransportBaseUrlError(error)}`);
  }
  return value as string;
}

function formatTransportBaseUrlError(error: UrlStringValidationError): string {
  switch (error) {
    case "empty":
      return "must be a non-empty URL string.";
    case "whitespace":
      return "must not contain leading or trailing whitespace.";
    case "invalid-url":
      return "must be a valid URL string.";
  }
}

function readClientRuntimeTransport(
  runtime: unknown,
): RuntimeTransportOptions | undefined {
  if (!isRecord(runtime)) {
    throw new Error(
      "[evjs] initTransportFromRuntime() runtime must be a client runtime object.",
    );
  }
  if (!isRecord(runtime.runtime)) {
    throw new Error(
      "[evjs] initTransportFromRuntime() runtime.runtime must be an object.",
    );
  }

  const transport = getClientRuntimeTransport(
    runtime as Pick<ClientRuntime, "runtime">,
  );
  if (transport === undefined) return undefined;
  assertClientRuntimeTransport(
    transport,
    "initTransportFromRuntime() runtime.runtime.transport",
  );
  return hasClientRuntimeTransport(transport) ? transport : undefined;
}

/**
 * Look up the internal function ID for a server function stub.
 * Returns undefined if the function is not a registered server function.
 */
export function getFnId(fn: AnyFn): string | undefined {
  return fnIdRegistry.get(fn);
}

export function getServerFunction<
  TArgs extends unknown[] = unknown[],
  TData = unknown,
>(
  fn: (...args: TArgs) => Promise<TData>,
): ServerFunction<TArgs, TData> | undefined {
  const fnId = fnIdRegistry.get(fn);
  if (!fnId) return undefined;

  return hasServerFunctionMetadata(fn, fnId) ? fn : undefined;
}

function hasServerFunctionMetadata<TArgs extends unknown[], TData>(
  fn: (...args: TArgs) => Promise<TData>,
  fnId: string,
): fn is ServerFunction<TArgs, TData> {
  const candidate = fn as Partial<ServerFunction<TArgs, TData>>;
  return (
    candidate.fnId === fnId &&
    typeof candidate.queryKey === "function" &&
    typeof candidate.queryOptions === "function"
  );
}

/**
 * Reset all transport state. **Test-only** — not available in production builds.
 * @internal
 */
export function __resetForTesting(): void {
  _runtime = null;
  _runtimeSource = null;
  delete globalThis.__EVJS_TRANSPORT__;
  fnNameRegistry.clear();
}
