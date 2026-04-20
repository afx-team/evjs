import fs from "node:fs";
import https from "node:https";
import { serve as honoServe } from "@hono/node-server";
import { getLogger } from "@logtape/logtape";
import type { Hono } from "hono";

const logger = getLogger(["evjs", "server"]);

export interface NodeRunnerOptions {
  port?: number;
  host?: string;
  /** Enable HTTPS. Must be an object with explicit key/cert payloads or file paths. */
  https?: { key: string; cert: string };
}

/**
 * Start a Node.js HTTP(S) server for the given Hono app.
 *
 * Port resolution order: options.port → PORT env → 3001 default.
 * Registers SIGTERM/SIGINT handlers for graceful shutdown.
 *
 * When `https` is enabled, generates a self-signed certificate using
 * Node's built-in crypto module for local development.
 */
export function serve(app: Hono, options?: NodeRunnerOptions) {
  const port = options?.port || Number(process.env.PORT) || 3001;
  const hostname = options?.host;
  const serverOptions: Record<string, unknown> = {
    fetch: app.fetch,
    port,
    hostname,
  };

  if (options?.https) {
    try {
      let key: string;
      let cert: string;

      if (typeof options.https === "object") {
        const isPem = (str: string) => str.trimStart().startsWith("-----BEGIN");
        key = isPem(options.https.key)
          ? options.https.key
          : fs.readFileSync(options.https.key, "utf8");
        cert = isPem(options.https.cert)
          ? options.https.cert
          : fs.readFileSync(options.https.cert, "utf8");
        logger.info`HTTPS enabled with user-provided certificate`;
      } else {
        throw new Error(
          "HTTPS requires an explicit { key, cert } object in @evjs/server.",
        );
      }

      serverOptions.createServer = https.createServer;
      serverOptions.serverOptions = { key, cert };
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          `HTTPS requested but TLS setup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      logger.warn`HTTPS requested but failed to set up TLS; falling back to HTTP: ${err}`;
    }
  }

  const protocol = options?.https ? "https" : "http";
  const server = honoServe(
    serverOptions as Parameters<typeof honoServe>[0],
    (info) => {
      const address =
        info.address === "0.0.0.0" || info.address === "::"
          ? "localhost"
          : info.address;
      logger.info`Server API ready at ${protocol}://${address}:${info.port}`;
    },
  );

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
