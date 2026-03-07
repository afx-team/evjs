/**
 * Hono middleware for dispatching RPC calls to registered server functions.
 *
 * This is a thin HTTP adapter on top of the protocol-agnostic `dispatch()`
 * function. For custom transports (WebSocket, IPC), use `dispatch()` directly.
 */

import { Hono } from "hono";
import { type Codec, jsonCodec } from "../codec.js";
import { dispatch } from "./dispatch";

export interface RpcMiddlewareOptions {
  /** Custom codec for request/response encoding. Defaults to JSON. */
  codec?: Codec;
}

/**
 * Create a Hono sub-app that handles RPC requests.
 *
 * Expects `POST /` with a serialized body containing `{ fnId: string, args: unknown[] }`.
 * Responds with `{ result: unknown }` on success or `{ error: string }` on failure.
 *
 * @returns A Hono app to be mounted at the desired path (e.g. `/api/rpc`).
 */
export function createRpcMiddleware(options?: RpcMiddlewareOptions): Hono {
  const codec = options?.codec ?? jsonCodec;
  const rpc = new Hono();

  rpc.post("/", async (c) => {
    const raw = await c.req.text();
    const body = codec.deserialize(raw) as {
      fnId: string;
      args: unknown[];
    };

    const response = await dispatch(body.fnId, body.args ?? []);

    const contentType = codec.contentType ?? "application/json";
    const serialized = codec.serialize(
      "error" in response
        ? { error: response.error, fnId: response.fnId }
        : { result: response.result },
    );

    return new Response(serialized, {
      status: "error" in response ? response.status : 200,
      headers: { "Content-Type": contentType },
    });
  });

  return rpc;
}
