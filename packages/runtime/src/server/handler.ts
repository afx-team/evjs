/**
 * Hono middleware for dispatching server function calls to registered server functions.
 *
 * This is a thin HTTP adapter on top of the protocol-agnostic `dispatch()`
 * function. For custom transports (WebSocket, IPC), use `dispatch()` directly.
 */

import { Hono } from "hono";
import { type Codec, jsonCodec } from "../codec";
import { DEFAULT_CONTENT_TYPE } from "../constants";
import { dispatch } from "./dispatch";

export interface HandlerOptions {
  /** Custom codec for request/response encoding. Defaults to JSON. */
  codec?: Codec;
}

/**
 * Create a Hono sub-app that handles server function requests.
 *
 * Expects `POST /` with a serialized body containing `{ fnId: string, args: unknown[] }`.
 * Responds with `{ result: unknown }` on success or `{ error: string }` on failure.
 *
 * @returns A Hono app to be mounted at the desired path (e.g. `/api/fn`).
 */
export function createHandler(options?: HandlerOptions): Hono {
  const codec = options?.codec ?? jsonCodec;
  const handler = new Hono();

  handler.post("/", async (c) => {
    let body: { fnId: string; args: unknown[] };

    try {
      const raw = await c.req.text();
      body = codec.deserialize(raw) as { fnId: string; args: unknown[] };
    } catch {
      const contentType = codec.contentType ?? DEFAULT_CONTENT_TYPE;
      return new Response(
        codec.serialize({
          error: "Malformed request body",
          fnId: "",
          status: 400,
        }),
        { status: 400, headers: { "Content-Type": contentType } },
      );
    }

    const response = await dispatch(body.fnId, body.args ?? [], { hono: c });

    const contentType = codec.contentType ?? DEFAULT_CONTENT_TYPE;
    const serialized = codec.serialize(
      "error" in response
        ? {
            error: response.error,
            fnId: response.fnId,
            status: response.status,
            data: response.data,
          }
        : { result: response.result },
    );

    return new Response(serialized, {
      status: "error" in response ? response.status : 200,
      headers: { "Content-Type": contentType },
    });
  });

  return handler;
}
