/**
 * Hono middleware for dispatching RPC calls to registered server functions.
 *
 * The Webpack server-fn-loader calls `registerServerFn()` at module load
 * time, populating the registry. This middleware handles incoming
 * `POST /api/rpc` requests and dispatches them to the correct function.
 */

import { Hono } from "hono";
import { registry } from "./register";

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
    const body = await c.req.json<{
      fnId: string;
      args: unknown[];
    }>();

    if (!body.fnId || typeof body.fnId !== "string") {
      return c.json(
        { error: "Missing or invalid 'fnId' in request body" },
        400,
      );
    }

    const fn = registry.get(body.fnId);
    if (!fn) {
      return c.json({ error: `Server function "${body.fnId}" not found` }, 404);
    }

    try {
      const result = await fn(...(body.args ?? []));
      return c.json({ result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return rpc;
}
