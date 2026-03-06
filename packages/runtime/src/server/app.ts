/**
 * Server application factory.
 *
 * Creates a Hono app with RPC middleware.
 * This app is runtime-agnostic and can be mounted in Node, Edge, or Bun.
 */

import { Hono } from "hono";
import { createRpcMiddleware } from "./handler.js";

/** Options for createApp. */
export interface CreateAppOptions {
  /** Port to listen on. Defaults to 3001. */
  port?: number;
  /** RPC endpoint path. Defaults to "/api/rpc". */
  rpcEndpoint?: string;
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
  const { rpcEndpoint = "/api/rpc" } = options ?? {};

  const app = new Hono();

  // Mount RPC endpoint
  app.route(rpcEndpoint, createRpcMiddleware());

  return app;
}
