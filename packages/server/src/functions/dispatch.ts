/**
 * Protocol-agnostic server function dispatcher.
 *
 * Looks up a registered server function by ID, invokes it with the
 * given arguments, and returns a structured result. This is the core
 * dispatch logic used by the HTTP handler and can be used directly
 * to build custom transport adapters (WebSocket, IPC, etc.).
 */

import { DEFAULT_ERROR_STATUS, ServerError } from "@evjs/shared";
import { registry } from "./register.js";

/** Successful dispatch result. */
export interface DispatchSuccess {
  result: unknown;
}

/** Failed dispatch result. */
export interface DispatchError {
  error: string;
  fnId: string;
  /** HTTP-equivalent status code for the error. */
  status: number;
  /** Structured error data (if thrown via ServerError). */
  data?: unknown;
}

export type DispatchResult = DispatchSuccess | DispatchError;

/**
 * Dispatch a server function call to a registered server function.
 *
 * @param fnId - The unique function ID.
 * @param args - The arguments to pass to the function.
 * @returns A structured result: `{ result }` on success, `{ error, fnId, status }` on failure.
 *
 * @example
 * ```ts
 * // WebSocket adapter
 * ws.on("message", async (data) => {
 *   const { fnId, args } = JSON.parse(data);
 *   const response = await dispatch(fnId, args);
 *   ws.send(JSON.stringify(response));
 * });
 * ```
 */
export async function dispatch(
  fnId: string,
  args: unknown[],
): Promise<DispatchResult> {
  if (!fnId || typeof fnId !== "string") {
    return {
      error: "Missing or invalid 'fnId' in request body",
      fnId: fnId ?? "",
      status: 400,
    };
  }

  if (!Array.isArray(args)) {
    return {
      error: "'args' must be an array",
      fnId,
      status: 400,
    };
  }

  const fn = registry.get(fnId);
  if (!fn) {
    return {
      error: `Server function "${fnId}" not found`,
      fnId,
      status: 404,
    };
  }

  try {
    const result = await fn(...args);
    return { result };
  } catch (err) {
    if (err instanceof ServerError) {
      return {
        error: err.message,
        fnId,
        status: err.status,
        data: err.data,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: message, fnId, status: DEFAULT_ERROR_STATUS };
  }
}
