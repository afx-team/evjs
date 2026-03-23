import { serve as honoServe } from "@hono/node-server";
import { getLogger } from "@logtape/logtape";
import type { Hono } from "hono";

const logger = getLogger(["evjs", "server"]);

export interface NodeRunnerOptions {
  port?: number;
  host?: string;
}

/**
 * Start a Node.js HTTP server for the given Hono app.
 *
 * Port resolution order: options.port → PORT env → 3001 default.
 * Registers SIGTERM/SIGINT handlers for graceful shutdown.
 */
export function serve(app: Hono, options?: NodeRunnerOptions) {
  const port = options?.port || Number(process.env.PORT) || 3001;
  const hostname = options?.host;
  const server = honoServe({ fetch: app.fetch, port, hostname }, (info) => {
    const address =
      info.address === "0.0.0.0" || info.address === "::"
        ? "localhost"
        : info.address;
    logger.info`Server API ready at http://${address}:${info.port}`;
  });

  // Graceful shutdown for container/orchestrator environments
  const shutdown = () => {
    logger.info`Shutting down server...`;
    server.close(() => process.exit(0));
    // Force exit after 10 seconds if connections don't drain
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return server;
}
