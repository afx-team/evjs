import { DEFAULT_ERROR_STATUS } from "./constants.js";
import { isHttpErrorStatus } from "./http.js";

/**
 * Error thrown when a server function call fails.
 * Available on both client and server.
 */
export class ServerFunctionError extends Error {
  /** The unique function ID. */
  readonly fnId: string;
  /** HTTP status code from the server. */
  readonly status: number;
  /** Structured error data from the server (if any). */
  readonly data?: unknown;

  constructor(
    message: string,
    fnId: string,
    status: number,
    options?: { cause?: Error; data?: unknown },
  ) {
    super(message);
    this.name = "ServerFunctionError";
    this.fnId = fnId;
    this.status = status;
    this.data = options?.data;
    if (options?.cause) this.cause = options.cause;
  }
}

/**
 * Throwable error for server functions to return structured error data.
 *
 * @example
 * ```ts
 * export async function getUser(id: string) {
 *   const user = db.find(id);
 *   if (!user) throw new ServerError("User not found", { status: 404, data: { id } });
 *   return user;
 * }
 * ```
 */
export class ServerError extends Error {
  readonly status: number;
  readonly data?: unknown;

  constructor(message: string, options?: { status?: number; data?: unknown }) {
    super(message);
    this.name = "ServerError";
    this.status = normalizeServerErrorStatus(options?.status);
    this.data = options?.data;
  }
}

function normalizeServerErrorStatus(status: number | undefined): number {
  if (status === undefined) return DEFAULT_ERROR_STATUS;
  if (isHttpErrorStatus(status)) return status;
  throw new Error(
    "[evjs] ServerError status must be an integer HTTP error status between 400 and 599.",
  );
}
