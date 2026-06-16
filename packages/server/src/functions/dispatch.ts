/**
 * Protocol-agnostic server function dispatcher.
 *
 * Looks up a registered server function by ID, invokes it with the
 * given arguments, and returns a structured result. This is the core
 * dispatch logic used by the HTTP handler and can be used directly
 * to build custom transport adapters (WebSocket, IPC, etc.).
 */

import {
  DEFAULT_ERROR_STATUS,
  getRequestFnId,
  isHttpErrorStatus,
  isServerFunctionId,
  ServerError,
} from "@evjs/shared";
import { isRecord } from "../validation.js";
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
 * @param fnId - The raw function ID from the transport payload.
 * @param args - The raw argument list from the transport payload.
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
  fnId: unknown,
  args: unknown,
): Promise<DispatchResult> {
  if (!isServerFunctionId(fnId)) {
    return {
      error: "Missing or invalid 'fnId' in request body",
      fnId: getRequestFnId(fnId),
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

  if (!registry.has(fnId)) {
    return {
      error: `Server function "${fnId}" not found`,
      fnId,
      status: 404,
    };
  }

  const fn = registry.get(fnId);
  if (typeof fn !== "function") {
    return {
      error: `[evjs] Server function "${fnId}" registry entry must be a function.`,
      fnId,
      status: DEFAULT_ERROR_STATUS,
    };
  }

  try {
    const result = await fn(...args);
    return { result };
  } catch (err) {
    const serverError = getStructuredServerError(err);
    if (serverError) {
      return {
        error: serverError.message,
        fnId,
        status: serverError.status,
        data: serverError.data,
      };
    }
    const safeMessage = isProductionRuntime()
      ? "Internal server error"
      : formatThrownValue(err);
    return { error: safeMessage, fnId, status: DEFAULT_ERROR_STATUS };
  }
}

interface StructuredServerError {
  message: string;
  status: number;
  data: unknown;
}

function getStructuredServerError(
  value: unknown,
): StructuredServerError | undefined {
  if (value instanceof ServerError) {
    return {
      message: value.message,
      status: value.status,
      data: value.data,
    };
  }

  if (!isRecord(value) || value.name !== "ServerError") return undefined;
  if (typeof value.message !== "string") return undefined;
  if (!isHttpErrorStatus(value.status)) return undefined;
  return {
    message: value.message,
    status: value.status,
    data: value.data,
  };
}

function formatThrownValue(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return String(value);
  } catch {
    return "Unknown server function error";
  }
}

function isProductionRuntime(): boolean {
  return globalThis.process?.env?.NODE_ENV === "production";
}
