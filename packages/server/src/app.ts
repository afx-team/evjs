/**
 * Server application factory.
 *
 * Creates a Hono app with server function handler and optional route handlers.
 * This app is runtime-agnostic and can be mounted in Node, Edge, or Bun.
 */

import { DEFAULT_ENDPOINT } from "@evjs/shared";
import { Hono } from "hono";
import { createHandler } from "./functions";
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
  const {
    endpoint = DEFAULT_ENDPOINT,
    routeHandlers = [],
  } = options ?? {};

  const app = new Hono();

  // Mount route handlers (before server function endpoint for priority)
  for (const handler of routeHandlers) {
    app.route("/", handler.app);
  }

  // Mount server function endpoint
  app.route(endpoint, createHandler());

  return app;
}
