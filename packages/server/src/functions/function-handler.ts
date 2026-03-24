/**
 * Hono handler for dispatching server function calls.
 *
 * This is a thin HTTP adapter on top of the protocol-agnostic `dispatch()`
 * function. For custom transports (WebSocket, IPC), use `dispatch()` directly.
 */

import { Hono } from "hono";
import { dispatch } from "./dispatch";

/**
 * Create a Hono sub-app that handles server function requests.
 *
 * Expects `POST /` with a JSON body containing `{ fnId: string, args: unknown[] }`.
 * Responds with `{ result: unknown }` on success or `{ error: string }` on failure.
 *
 * @returns A Hono app to be mounted at the desired path (e.g. `/api/fn`).
 */
export function createHandler(): Hono {
  const handler = new Hono();

  handler.post("/", async (c) => {
    let body: { fnId: string; args: unknown[] };

    try {
      body = await c.req.json();
    } catch {
      return Response.json(
        { error: "Malformed request body", fnId: "", status: 400 },
        { status: 400 },
      );
    }

    const response = await dispatch(body.fnId, body.args ?? []);

    const status = "error" in response ? response.status : 200;
    const payload =
      "error" in response
        ? {
            error: response.error,
            fnId: response.fnId,
            status: response.status,
            data: response.data,
          }
        : { result: response.result };

    return Response.json(payload, { status });
  });

  return handler;
}
