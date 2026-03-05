/**
 * Server application factory.
 *
 * Creates a Hono app with RPC middleware and starts a Node.js HTTP
 * server via @hono/node-server.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createRpcMiddleware } from "./handler";

/** Options for createServer. */
export interface CreateServerOptions {
  /** Port to listen on. Defaults to 3001. */
  port?: number;
  /** RPC endpoint path. Defaults to "/api/rpc". */
  rpcEndpoint?: string;
}

/**
 * Create and start an ev API server.
 *
 * Mounts the RPC middleware at `/api/rpc` and starts listening.
 * In Stage 3, this will be extended with SSR middleware.
 *
 * @param options - Server configuration.
 * @returns The Hono app instance (for extension or testing).
 */
export function createServer(options?: CreateServerOptions): Hono {
  const { port = 3001, rpcEndpoint = "/api/rpc" } = options ?? {};

  const app = new Hono();

  // Mount RPC endpoint
  app.route(rpcEndpoint, createRpcMiddleware());

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`ev server running at http://localhost:${info.port}`);
  });

  return app;
}
