/**
 * Server application factory.
 *
 * Creates a Hono app with server function handler and optional route handlers.
 * This app is runtime-agnostic and can be mounted in Node, Edge, or Bun.
 */

import { getFunctionEndpoint } from "@evjs/shared";
import type {
  Context as HonoContext,
  Env as HonoEnv,
  MiddlewareHandler,
} from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { contextStorage } from "hono/context-storage";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  type FrameworkServerOptions,
  handleFrameworkRenderRequest,
  handlePprRegionRequest,
  handleRscFlightRequest,
} from "./framework.js";
import { dispatch } from "./functions/dispatch.js";
import type { RouteHandler } from "./routes/index.js";

export interface CreateAppOptions {
  /**
   * Route handlers to mount on the app.
   * Created via `createRoute()`.
   */
  routes?: RouteHandler[];
  /**
   * Global Hono middlewares to mount before the server handles any request.
   * Useful for CORS, rate limiting, logging, CSRF protection, etc.
   */
  middlewares?: MiddlewareHandler[];
  /**
   * Framework-managed SSR/PPR/RSC request coordination.
   *
   * Server functions and programmatic routes stay in this app. Framework
   * renderers attach here so deployment adapters do not own render semantics.
   */
  framework?: FrameworkServerOptions;
}

/**
 * Create an ev API server application.
 *
 * Mounts the server function handler at the framework runtime endpoint,
 * plus any programmatic route handlers.
 *
 * @param options - Application configuration.
 * @returns A runtime-agnostic Hono app instance.
 */
export function createApp(options?: CreateAppOptions): Hono {
  const { routes = [], middlewares = [], framework } = options ?? {};
  const endpoint = getFunctionEndpoint();
  const maxBodySize = 1024 * 1024;

  const app = new Hono();

  // Initialize Hono's native context storage
  app.use(contextStorage());

  // Mount global middleware
  for (const mw of middlewares) {
    app.use(mw);
  }

  // Mount route handlers (before server function endpoint for priority)
  for (const handler of routes) {
    for (const [method, routeHandlerFn] of Object.entries(handler.methods)) {
      if (!routeHandlerFn) continue;

      app.on([method], [handler.path], ...handler.middlewares, (c) =>
        routeHandlerFn(c.req.raw, c as HonoContext<HonoEnv, string>),
      );
    }
    // 405 Method Not Allowed for any unregistered methods.
    app.all(handler.path, () => {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: handler.allowedMethods.join(", ") },
      });
    });
  }

  // Mount server function endpoint. Request size policy can move to
  // user/deployment middleware when an app needs a different limit.
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

  const rscPath = framework?.rsc
    ? framework.manifest.runtime.server?.rsc
    : undefined;
  if (framework?.rsc && rscPath) {
    app.all(rscPath, async (c, next) => {
      const response = await handleRscFlightRequest(framework, c.req.raw);
      if (!response) return next();
      return response;
    });
  }

  if (framework?.render) {
    const pprPath =
      framework.manifest.runtime.server?.ppr ??
      joinPath(framework.manifest.runtime.server?.basePath ?? "/__evjs", "ppr");
    app.on(["GET", "HEAD"], [`${pprPath}/*`], async (c, next) => {
      const response = await handlePprRegionRequest(framework, c.req.raw);
      if (!response) return next();
      return response;
    });

    app.on(["GET", "HEAD"], ["*"], async (c, next) => {
      const response = await handleFrameworkRenderRequest(framework, c.req.raw);
      if (!response) return next();
      return response;
    });
  }

  return app;
}

function joinPath(base: string, segment: string): string {
  return `${base.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`;
}
