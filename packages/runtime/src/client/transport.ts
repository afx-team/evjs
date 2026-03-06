/**
 * Client-side transport for calling server functions.
 *
 * When the Webpack loader transforms a `"use server"` module for the client
 * bundle, each exported function is replaced with a stub that calls
 * `__ev_call(fnId, args)`. This module provides that helper.
 */

import { DEFAULT_RPC_ENDPOINT } from "../constants";

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
  send(fnId: string, args: unknown[], context?: RequestContext): Promise<unknown>;

  /**
   * Streaming call for RSC Flight protocol.
   * Returns a ReadableStream of serialized React elements.
   *
   * @experimental Not yet implemented. Reserved for future RSC support.
   * Do not use — this method signature may change.
   */
  stream?(fnId: string, args: unknown[], context?: RequestContext): ReadableStream<Uint8Array>;
}

export interface TransportOptions {
  /** Base URL for the RPC endpoint. Defaults to the current origin. */
  baseUrl?: string;
  /** Path prefix for the RPC endpoint. Defaults to `/api/rpc`. */
  endpoint?: string;
  /** Custom transport. When provided, `baseUrl` and `endpoint` are ignored. */
  transport?: ServerTransport;
}

/**
 * Default fetch-based transport.
 */
function createFetchTransport(baseUrl: string, endpoint: string): ServerTransport {
  return {
    async send(fnId: string, args: unknown[], context?: RequestContext): Promise<unknown> {
      const url = `${baseUrl}${endpoint}`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...context?.headers,
        },
        body: JSON.stringify({ fnId, args }),
        signal: context?.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(
          `[ev] Server function "${fnId}" failed (${res.status}): ${text}`,
        );
      }

      const payload = await res.json();

      if (payload.error) {
        throw new Error(
          `[ev] Server function "${fnId}" threw: ${payload.error}`,
        );
      }

      return payload.result;
    },
  };
}

let _transport: ServerTransport | null = null;

function getTransport(): ServerTransport {
  if (!_transport) {
    _transport = createFetchTransport("", DEFAULT_RPC_ENDPOINT);
  }
  return _transport;
}

/**
 * Configure the server transport. Call once at app startup if you need to
 * customise the endpoint URL or provide a custom transport.
 */
export function configureTransport(options: TransportOptions): void {
  if (options.transport) {
    _transport = options.transport;
  } else {
    _transport = createFetchTransport(
      options.baseUrl ?? "",
      options.endpoint ?? DEFAULT_RPC_ENDPOINT,
    );
  }
}

/**
 * Call a server function by its unique ID.
 *
 * @internal This function is auto-injected by the Webpack loader.
 * Do not call directly — use server functions as normal imports instead.
 *
 * @param fnId - The unique identifier assigned to the server function by the
 *   Webpack loader (e.g. `"user_server_getUser"`).
 * @param args - The arguments to pass to the server function. Must be
 *   JSON-serializable.
 * @returns A promise that resolves with the server function's return value.
 */
export async function __ev_call(
  fnId: string,
  args: unknown[],
  context?: RequestContext,
): Promise<unknown> {
  return getTransport().send(fnId, args, context);
}
