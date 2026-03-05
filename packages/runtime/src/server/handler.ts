/**
 * Hono middleware for dispatching RPC calls to registered server functions.
 *
 * The Webpack server-fn-loader calls `registerServerFn()` at module load
 * time, populating the registry. This middleware handles incoming
 * `POST /api/rpc` requests and dispatches them to the correct function.
 */

import { Hono } from "hono";

/** A registered server function. */
type ServerFn = (...args: unknown[]) => Promise<unknown>;

/** Internal registry mapping function IDs to implementations. */
const registry = new Map<string, ServerFn>();

/**
 * Register a server function so it can be invoked via RPC.
 * Called automatically by the Webpack-transformed server bundles at load time.
 *
 * @param fnId - The unique ID for this function.
 * @param fn - The actual function implementation.
 */
export function registerServerFn(fnId: string, fn: ServerFn): void {
  registry.set(fnId, fn);
}

/**
 * Create a Hono sub-app that handles RPC requests.
 *
 * Expects `POST /` with JSON body `{ fnId: string, args: unknown[] }`.
 * Responds with `{ result: unknown }` on success or `{ error: string }` on failure.
 *
 * @returns A Hono app to be mounted at the desired path (e.g. `/api/rpc`).
 */
export function createRpcMiddleware(): Hono {
  const rpc = new Hono();

  rpc.post("/", async (c) => {
    const { fnId, args } = await c.req.json<{
      fnId: string;
      args: unknown[];
    }>();

    const fn = registry.get(fnId);
    if (!fn) {
      return c.json({ error: `Server function "${fnId}" not found` }, 404);
    }

    try {
      const result = await fn(...(args ?? []));
      return c.json({ result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return rpc;
}
