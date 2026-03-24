/**
 * Programmatic route handler factory.
 *
 * Creates REST-style HTTP handlers that mount onto the Hono app,
 * complementing the existing RPC server functions.
 *
 * @example
 * ```ts
 * import { route } from "@evjs/server";
 *
 * export const usersHandler = route("/api/users", {
 *   GET: async (req) => Response.json(await db.getUsers()),
 *   POST: async (req) => {
 *     const body = await req.json();
 *     return Response.json(await db.createUser(body), { status: 201 });
 *   },
 * });
 * ```
 */

import {
  type HttpMethod,
  isHttpMethod,
} from "@evjs/shared";
import type { Context as HonoContext } from "hono";
import { Hono } from "hono";

/**
 * Context passed to route handler functions.
 */
export interface RouteHandlerContext {
  /** Resolved dynamic route params (e.g. `{ id: "123" }`). */
  params: Record<string, string>;
  /** The underlying Hono context, for advanced use cases. */
  hono: HonoContext;
}

/**
 * A route handler function.
 * Receives a standard Web `Request` and returns a `Response`.
 */
export type RouteHandlerFn = (
  request: Request,
  context: RouteHandlerContext,
) => Response | Promise<Response>;

/**
 * Per-handler middleware.
 * Call `next()` to proceed to the handler or next middleware.
 */
export type RouteMiddleware = (
  request: Request,
  context: RouteHandlerContext,
  next: () => Promise<Response>,
) => Response | Promise<Response>;

/**
 * Route handler definition — HTTP method handlers + optional middleware.
 */
export type RouteHandlerDefinition = Partial<
  Record<HttpMethod, RouteHandlerFn>
> & {
  /** Optional per-route middleware stack. Runs before any handler. */
  middleware?: RouteMiddleware[];
};

/**
 * A created route handler, ready to be mounted on a Hono app.
 */
export interface RouteHandler {
  /** The path pattern for this handler (e.g. `/api/users/:id`). */
  path: string;
  /** The Hono sub-app containing all mounted method handlers. */
  app: Hono;
}

/**
 * Create a programmatic route handler.
 *
 * @param path - URL path pattern (uses Hono's path syntax, e.g. `/api/users/:id`).
 * @param definition - HTTP method handlers and optional middleware.
 * @returns A `RouteHandler` that can be mounted via `createApp({ routeHandlers })`.
 *
 * @example
 * ```ts
 * const handler = route("/api/users/:id", {
 *   middleware: [authMiddleware],
 *   GET: async (req, { params }) => {
 *     const user = await db.getUser(params.id);
 *     return Response.json(user);
 *   },
 *   DELETE: async (req, { params }) => {
 *     await db.deleteUser(params.id);
 *     return new Response(null, { status: 204 });
 *   },
 * });
 * ```
 */
export function route(
  path: string,
  definition: RouteHandlerDefinition,
): RouteHandler {
  const app = new Hono();
  const { middleware = [], ...methods } = definition;

  // Collect defined method names for auto-OPTIONS and HEAD derivation.
  const definedMethods: HttpMethod[] = [];
  for (const key of Object.keys(methods)) {
    if (isHttpMethod(key)) {
      definedMethods.push(key.toUpperCase() as HttpMethod);
    }
  }

  // Auto-implement OPTIONS if not explicitly defined.
  if (!methods.OPTIONS && definedMethods.length > 0) {
    const allowed = [...definedMethods, "OPTIONS"].join(", ");
    methods.OPTIONS = () =>
      new Response(null, {
        status: 204,
        headers: { Allow: allowed },
      });
  }

  // Auto-derive HEAD from GET if GET is defined but HEAD is not.
  if (methods.GET && !methods.HEAD) {
    const getHandler = methods.GET;
    methods.HEAD = async (req, ctx) => {
      const res = await getHandler(req, ctx);
      return new Response(null, {
        status: res.status,
        headers: res.headers,
      });
    };
  }

  // Mount each method handler with middleware chain.
  for (const [method, handler] of Object.entries(methods)) {
    if (!handler || !isHttpMethod(method)) continue;

    app.on(method.toUpperCase(), path, async (c: HonoContext) => {
      const params = c.req.param() as Record<string, string>;
      const ctx: RouteHandlerContext = { params, hono: c };

      // Build middleware chain.
      let idx = 0;
      const next = (): Promise<Response> => {
        if (idx < middleware.length) {
          const mw = middleware[idx++];
          return Promise.resolve(mw(c.req.raw, ctx, next));
        }
        return Promise.resolve(handler(c.req.raw, ctx));
      };

      return next();
    });
  }

  // 405 Method Not Allowed for any unregistered methods.
  app.all(path, () => {
    const allowed = definedMethods.join(", ");
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: allowed },
    });
  });

  return { path, app };
}
