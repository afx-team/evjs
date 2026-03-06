import { serve } from "@hono/node-server";
import type { Hono } from "hono";

export interface NodeRunnerOptions {
  port?: number;
}

/**
 * Runner plugin for Node.js environments.
 * Takes a compiled Hono app and starts a native Node HTTP server.
 */
export function runNodeServer(app: Hono, options?: NodeRunnerOptions) {
  const port = options?.port || 3001;
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(
      `\x1b[32mev server API ready at http://localhost:${info.port}\x1b[0m`,
    );
  });

  return server;
}
