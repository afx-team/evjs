/**
 * Protocol-agnostic server function dispatcher.
 *
 * Looks up a registered server function by ID, invokes it with the
 * given arguments, and returns a structured result. This is the core
 * dispatch logic used by the HTTP handler and can be used directly
 * to build custom transport adapters (WebSocket, IPC, etc.).
 */

import { DEFAULT_ERROR_STATUS, ServerError } from "@evjs/shared";
import { registry } from "./register";

/**
 * Context passed to middleware functions.
 */
export interface MiddlewareContext {
  /** The function ID being called. */
  fnId: string;
  /** The arguments passed to the function. */
  args: unknown[];
  /**
   * Transport-specific metadata.
   * When using the default HTTP handler, this contains `{ hono: Context }`.
   * Custom transports (like WebSockets) can provide their own context maps here.
   */
  transport: Record<string, unknown>;
}

/**
 * Middleware function type.
 * Call `next()` to proceed to the next middleware or the function itself.
 *
 * @example
 * ```ts
 * registerMiddleware(async (ctx, next) => {
 *   console.log(`Calling ${ctx.fnId}`);
 *   const start = Date.now();
 *   const result = await next();
 *   console.log(`${ctx.fnId} took ${Date.now() - start}ms`);
 *   return result;
 * });
 * ```
 */
export type Middleware = (
  ctx: MiddlewareContext,
  next: () => Promise<unknown>,
) => Promise<unknown>;

const middlewares: Middleware[] = [];

/**
 * Register a middleware that wraps all server function calls.
 * Middleware functions run in registration order.
 */
export function registerMiddleware(fn: Middleware): void {
  middlewares.push(fn);
}

/**
 * Reset the middleware stack. **Test-only** — not available in production builds.
 * @internal
 */
export function __resetForTesting(): void {
  if (process.env.NODE_ENV === "production") return;
  middlewares.length = 0;
}

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
  transport: Record<string, unknown> = {},
): Promise<DispatchResult> {
  if (!fnId || typeof fnId !== "string") {
    return {
      error: "Missing or invalid 'fnId' in request body",
      fnId: fnId ?? "",
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
    // Build middleware chain
    let index = 0;
    const runFn = () => fn(...args);
    const next = (): Promise<unknown> => {
      if (index < middlewares.length) {
        const mw = middlewares[index++];
        return mw({ fnId, args, transport }, next);
      }
      return runFn();
    };

    const result = await next();
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
