/**
 * Client-side RPC helper for calling server functions.
 *
 * When the Webpack loader transforms a `"use server"` module for the client
 * bundle, each exported function is replaced with a stub that calls
 * `__ev_rpc(fnId, args)`. This module provides that helper.
 */

import { DEFAULT_RPC_ENDPOINT } from "../constants.js";

export interface RpcOptions {
  /** Base URL for the RPC endpoint. Defaults to the current origin. */
  baseUrl?: string;
  /** Path prefix for the RPC endpoint. Defaults to `/api/rpc`. */
  endpoint?: string;
}

let _options: Required<RpcOptions> = {
  baseUrl: "",
  endpoint: DEFAULT_RPC_ENDPOINT,
};

/**
 * Configure the RPC client. Call once at app startup if you need to
 * customise the endpoint URL.
 */
export function configureRpc(options: RpcOptions): void {
  _options = { ..._options, ...options };
}

/**
 * Call a server function by its unique ID.
 *
 * @param fnId - The unique identifier assigned to the server function by the
 *   Webpack loader (e.g. `"user_server_getUser"`).
 * @param args - The arguments to pass to the server function. Must be
 *   JSON-serializable.
 * @returns A promise that resolves with the server function's return value.
 */
export async function __ev_rpc(
  fnId: string,
  args: unknown[],
): Promise<unknown> {
  const url = `${_options.baseUrl}${_options.endpoint}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fnId, args }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(
      `[ev/rpc] Server function "${fnId}" failed (${res.status}): ${text}`,
    );
  }

  const payload = await res.json();

  if (payload.error) {
    throw new Error(
      `[ev/rpc] Server function "${fnId}" threw: ${payload.error}`,
    );
  }

  return payload.result;
}
