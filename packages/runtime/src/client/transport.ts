/**
 * Client-side transport for calling server functions.
 *
 * When the Webpack loader transforms a `"use server"` module for the client
 * bundle, each exported function is replaced with a stub that calls
 * `__ev_call(fnId, args)`. This module provides that helper.
 */

import { type Codec, jsonCodec } from "../codec";
import {
  DEFAULT_CONTENT_TYPE,
  DEFAULT_ENDPOINT,
  DEFAULT_ERROR_STATUS,
} from "../constants";
import { ServerFunctionError } from "../errors";

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
  /** Custom transport. When provided, `baseUrl` and `endpoint` are ignored. */
  transport?: ServerTransport;
  /** Custom codec. Defaults to JSON. */
  codec?: Codec;
}

/**
 * Default fetch-based transport.
 */
function createFetchTransport(
  baseUrl: string,
  endpoint: string,
  codec: Codec = jsonCodec,
): ServerTransport {
  return {
    async send(
      fnId: string,
      args: unknown[],
      context?: RequestContext,
    ): Promise<unknown> {
      const url = `${baseUrl}${endpoint}`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": codec.contentType ?? DEFAULT_CONTENT_TYPE,
          ...context?.headers,
        },
        body: codec.serialize({ fnId, args }),
        signal: context?.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        const name = getFnName(fnId);
        throw new ServerFunctionError(
          `Server function "${name}" failed (${res.status}): ${text}`,
          fnId,
          res.status,
        );
      }

      const raw = await res.text();
      const payload = codec.deserialize(raw) as Record<string, unknown>;

      if (payload.error) {
        const name = getFnName(fnId);
        throw new ServerFunctionError(
          `Server function "${name}" threw: ${payload.error}`,
          (payload.fnId as string) ?? fnId,
          DEFAULT_ERROR_STATUS,
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
  if (process.env.NODE_ENV !== "production" && _transport !== null) {
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
      options.codec,
    );
  }
}

/**
 * Call a server function by its unique ID.
 *
 * @internal This function is auto-injected by the Webpack loader.
 * Do not call directly — use server functions as normal imports instead.
 */
export async function __ev_call(
  fnId: string,
  args: unknown[],
  context?: RequestContext,
): Promise<unknown> {
  return getTransport().send(fnId, args, context);
}

/**
 * Internal registry mapping server function references to their IDs.
 * Uses WeakMap so function stubs can be garbage collected.
 */
// biome-ignore lint/suspicious/noExplicitAny: must accept any function shape
const fnIdRegistry = new WeakMap<(...args: any[]) => any, string>();

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
 * Register a server function stub with its ID and optional export name.
 *
 * @internal Called by build-tools codegen. Do not use directly.
 */
export function __ev_register(
  // biome-ignore lint/suspicious/noExplicitAny: must accept any function shape
  fn: (...args: any[]) => any,
  fnId: string,
  exportName?: string,
): void {
  fnIdRegistry.set(fn, fnId);
  if (exportName) {
    fnNameRegistry.set(fnId, exportName);
  }
}

/**
 * Look up the internal function ID for a server function stub.
 * Returns undefined if the function is not a registered server function.
 */
// biome-ignore lint/suspicious/noExplicitAny: must accept any function shape
export function getFnId(fn: (...args: any[]) => any): string | undefined {
  return fnIdRegistry.get(fn);
}

/**
 * Reset all transport state. **Test-only** — not available in production builds.
 * @internal
 */
export function __resetForTesting(): void {
  if (process.env.NODE_ENV === "production") return;
  _transport = null;
  fnNameRegistry.clear();
}
