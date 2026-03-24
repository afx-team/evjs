/**
 * Server application factory.
 *
 * Creates a Hono app with server function handler and optional route handlers.
 * This app is runtime-agnostic and can be mounted in Node, Edge, or Bun.
 */

import { DEFAULT_ENDPOINT } from "@evjs/shared";
import { Hono } from "hono";
import { dispatch } from "./functions/dispatch.js";
import type { RouteHandler } from "./routes";

/** Options for createApp. */
export interface CreateAppOptions {
  /** Server function endpoint path. Defaults to "/api/fn". */
  endpoint?: string;
  /**
   * Route handlers to mount on the app.
   * Created via `route()`.
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
  const { endpoint = DEFAULT_ENDPOINT, routeHandlers = [] } = options ?? {};

  const app = new Hono();

  // Mount route handlers (before server function endpoint for priority)
  for (const handler of routeHandlers) {
    app.route("/", handler.app);
  }

  // Mount server function endpoint
  app.post(endpoint, async (c) => {
    let body: { fnId: string; args: unknown[] };

    try {
      body = await c.req.json();
    } catch (_err) {
      return c.json(
        { error: "Malformed request body", fnId: "", status: 400 },
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(payload, status as any);
  });

  return app;
}
