/**
 * Server-side handler for processing RPC requests from client-side
 * server function stubs.
 *
 * Usage (with any HTTP server, e.g. Express / Node http):
 *
 * ```ts
 * import { createHandler } from "ev-runtime/server";
 *
 * const handler = createHandler();
 *
 * // Express
 * app.post("/api/rpc", handler);
 *
 * // Node http
 * http.createServer((req, res) => {
 *   if (req.method === "POST" && req.url === "/api/rpc") {
 *     handler(req, res);
 *   }
 * });
 * ```
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** A registered server function. */
type ServerFn = (...args: unknown[]) => Promise<unknown>;

/** Internal registry mapping function IDs to implementations. */
const registry = new Map<string, ServerFn>();

/**
 * Register a server function so it can be invoked by the RPC handler.
 * Called by the Webpack-transformed server bundles at module load time.
 */
export function registerServerFn(fnId: string, fn: ServerFn): void {
  registry.set(fnId, fn);
}

/**
 * Read the full request body as a string.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Create a Node.js HTTP request handler that dispatches incoming RPC
 * calls to registered server functions.
 *
 * Expects `POST` requests with JSON body `{ fnId: string, args: unknown[] }`.
 * Responds with `{ result: unknown }` on success or `{ error: string }` on failure.
 */
export function createHandler() {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Only accept POST
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    try {
      const body = await readBody(req);
      const { fnId, args } = JSON.parse(body) as {
        fnId: string;
        args: unknown[];
      };

      const fn = registry.get(fnId);
      if (!fn) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Server function "${fnId}" not found` }));
        return;
      }

      const result = await fn(...(args ?? []));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  };
}
