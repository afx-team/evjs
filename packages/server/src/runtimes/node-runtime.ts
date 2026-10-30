import fs from "node:fs";
import https from "node:https";
import { serve as honoServe } from "@hono/node-server";
import { getLogger } from "@logtape/logtape";

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
 * Registers SIGTERM/SIGINT handlers for graceful shutdown while the returned
 * server is open.
 */
export function serve(
  app: {
    fetch: (
      request: Request,
      ...args: unknown[]
    ) => Response | Promise<Response>;
  },
  options?: NodeRunnerOptions,
) {
  const port = resolvePort(options?.port, process.env.PORT);
  const hostname = options?.host;
  const serverOptions: Record<string, unknown> = {
    fetch: app.fetch,
    port,
    hostname,
  };

  let httpsEnabled = false;
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
      httpsEnabled = true;
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          `HTTPS requested but TLS setup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      logger.warn`HTTPS requested but failed to set up TLS; falling back to HTTP: ${err}`;
    }
  }

  const protocol = httpsEnabled ? "https" : "http";
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
  let forceExitTimer: NodeJS.Timeout | undefined;
  let shuttingDown = false;
  const removeSignalHandlers = () => {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    if (forceExitTimer) {
      clearTimeout(forceExitTimer);
      forceExitTimer = undefined;
    }
  };
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info`Shutting down server...`;
    process.exitCode = 0;
    server.close(removeSignalHandlers);
    // Force exit after 10 seconds if connections don't drain
    forceExitTimer = setTimeout(() => process.exit(1), 10_000);
    forceExitTimer.unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  server.once("close", removeSignalHandlers);
  server.once("error", removeSignalHandlers);

  return server;
}

function resolvePort(
  optionPort: number | undefined,
  envPort: string | undefined,
): number {
  if (optionPort !== undefined) {
    return assertPort(optionPort, "options.port");
  }
  const normalizedEnvPort = envPort?.trim();
  if (!normalizedEnvPort) return 3001;
  if (!/^\d+$/.test(normalizedEnvPort)) {
    return assertPort(Number.NaN, "process.env.PORT");
  }
  return assertPort(Number(normalizedEnvPort), "process.env.PORT");
}

function assertPort(value: number, source: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(
      `[evjs] ${source} must be an integer TCP port from 0 to 65535.`,
    );
  }
  return value;
}
