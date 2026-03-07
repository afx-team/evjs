/**
 * Server application factory.
 *
 * Creates a Hono app with RPC middleware.
 * This app is runtime-agnostic and can be mounted in Node, Edge, or Bun.
 */

import { Hono } from "hono";
import type { Codec } from "../codec";
import { DEFAULT_RPC_ENDPOINT } from "../constants";
import { createRpcMiddleware } from "./handler";

/** Options for createApp. */
export interface CreateAppOptions {
  /** RPC endpoint path. Defaults to "/api/rpc". */
  rpcEndpoint?: string;
  /** Custom codec for the RPC endpoint. Defaults to JSON. */
  codec?: Codec;
}

/**
 * Create an ev API server application.
 *
 * Mounts the RPC middleware at `/api/rpc`.
 * In Stage 3, this will be extended with SSR middleware.
 *
 * @param options - Application configuration.
 * @returns A runtime-agnostic Hono app instance.
 */
export function createApp(options?: CreateAppOptions): Hono {
  const { rpcEndpoint = DEFAULT_RPC_ENDPOINT, codec } = options ?? {};

  const app = new Hono();

  // Health check for load balancers / container orchestrators
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Mount RPC endpoint
  app.route(rpcEndpoint, createRpcMiddleware({ codec }));

  return app;
}
