/**
 * Server application factory.
 *
 * Creates a Hono app with the RPC middleware mounted and starts
 * a Node.js HTTP server via @hono/node-server.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createRpcMiddleware } from "./handler";

/** Options for createServer. */
export interface CreateServerOptions {
  /** Port to listen on. Defaults to 3001. */
  port?: number;
}

/**
 * Create and start an ev server.
 *
 * Mounts the RPC middleware at `/api/rpc` and starts listening.
 * In Stage 3, this will be extended with SSR middleware.
 *
 * @param options - Server configuration.
 * @returns The Hono app instance (for extension or testing).
 */
export function createServer(options?: CreateServerOptions): Hono {
  const { port = 3001 } = options ?? {};

  const app = new Hono();

  // Mount RPC endpoint
  app.route("/api/rpc", createRpcMiddleware());

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`ev server running at http://localhost:${info.port}`);
  });

  return app;
}
