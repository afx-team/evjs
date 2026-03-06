import { serve } from "@hono/node-server";
import type { Hono } from "hono";

export interface NodeRunnerOptions {
  port?: number;
  host?: string;
}

/**
 * Runner plugin for Node.js environments.
 * Takes a compiled Hono app and starts a native Node HTTP server.
 */
export function runNodeServer(app: Hono, options?: NodeRunnerOptions) {
  const port = options?.port || 3001;
  const hostname = options?.host;
  const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
    const address = info.address === "0.0.0.0" || info.address === "::" ? "localhost" : info.address;
    console.log(
      `\x1b[32mev server API ready at http://${address}:${info.port}\x1b[0m`,
    );
  });

  return server;
}
