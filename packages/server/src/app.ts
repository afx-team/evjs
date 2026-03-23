/**
 * Server application factory.
 *
 * Creates a Hono app with server function handler.
 * This app is runtime-agnostic and can be mounted in Node, Edge, or Bun.
 */

import type { Codec } from "@evjs/shared";
import { DEFAULT_ENDPOINT } from "@evjs/shared";
import { Hono } from "hono";
import { createHandler } from "./handler";

/** Options for createApp. */
export interface CreateAppOptions {
  /** server function endpoint path. Defaults to "/api/fn". */
  endpoint?: string;
  /** Custom codec for the server function endpoint. Defaults to JSON. */
  codec?: Codec;
}

/**
 * Create an ev API server application.
 *
 * Mounts the server function handler at the configured endpoint.
 *
 * @param options - Application configuration.
 * @returns A runtime-agnostic Hono app instance.
 */
export function createApp(options?: CreateAppOptions): Hono {
  const { endpoint = DEFAULT_ENDPOINT, codec } = options ?? {};

  const app = new Hono();

  // Mount server function endpoint
  app.route(endpoint, createHandler({ codec }));

  return app;
}
