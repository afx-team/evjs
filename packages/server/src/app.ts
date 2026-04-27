/**
 * Server application factory.
 *
 * Creates a Hono app with server function handler and optional route handlers.
 * This app is runtime-agnostic and can be mounted in Node, Edge, or Bun.
 */

import { DEFAULT_ENDPOINT } from "@evjs/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { contextStorage } from "hono/context-storage";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { dispatch } from "./functions/dispatch.js";
import type { RouteHandler } from "./routes/index.js";

/** Options for createApp. */
export interface CreateAppOptions {
  /** Server function endpoint path. Defaults to "/api/fn". */
  endpoint?: string;
  /**
   * Maximum request body size in bytes for server function calls.
   * Defaults to 1MB (1048576 bytes).
   */
  bodyLimit?: number;
  /**
   * Route handlers to mount on the app.
   * Created via `createRoute()`.
   */
  routeHandlers?: RouteHandler[];
}

/**
 * Create an ev API server application.
 *
 * Mounts the server function handler at the configured endpoint,
 * plus any programmatic route handlers.
 *
 * @param options - Application configuration.
 * @returns A runtime-agnostic Hono app instance.
 */
export function createApp(options?: CreateAppOptions): Hono {
  const {
    endpoint = DEFAULT_ENDPOINT,
    bodyLimit: maxBodySize = 1024 * 1024,
    routeHandlers = [],
  } = options ?? {};

  const app = new Hono();

  // Initialize Hono's native context storage
  app.use(contextStorage());

  // Mount route handlers (before server function endpoint for priority)
  for (const handler of routeHandlers) {
    app.route("/", handler.app);
  }

  // Mount server function endpoint with configurable body size limit
  app.post(endpoint, bodyLimit({ maxSize: maxBodySize }), async (c) => {
    let body: { fnId: string; args: unknown[] };

    try {
      body = await c.req.json();
    } catch (_err) {
      return c.json(
        { error: "Malformed request body", fnId: "", status: 400 },
        400,
      );
    }

    if (!body || typeof body.fnId !== "string") {
      return c.json(
        {
          error: "Missing or invalid 'fnId' in request body",
          fnId: "",
          status: 400,
        },
        400,
      );
    }

    const response = await dispatch(body.fnId, body.args ?? []);

    const status = "error" in response ? response.status : 200;
    const payload =
      "error" in response
        ? {
            error: response.error,
            fnId: response.fnId,
            status: response.status,
            data: response.data,
          }
        : { result: response.result };

    return c.json(payload, status as ContentfulStatusCode);
  });

  return app;
}
