/**
 * Programmatic route handler factory.
 *
 * Creates REST-style HTTP handlers that mount onto the Hono app,
 * complementing the existing RPC server functions.
 *
 * @example
 * ```ts
 * import { createRoute } from "@evjs/server";
 *
 * export const usersHandler = createRoute("/api/users", {
 *   GET: async (req) => Response.json(await db.getUsers()),
 *   POST: async (req) => {
 *     const body = await req.json();
 *     return Response.json(await db.createUser(body), { status: 201 });
 *   },
 * });
 * ```
 */

import { type HttpMethod, isHttpMethod } from "@evjs/shared";
import type { Context as HonoContext, Env as HonoEnv } from "hono";
import { Hono } from "hono";

/**
 * A route handler function.
 * Receives a standard Web `Request` and the Hono `Context`.
 * Access route params via `ctx.req.param()`.
 */
export type RouteHandlerFn<TPath extends string = string> = (
  request: Request,
  ctx: HonoContext<HonoEnv, TPath>,
) => Response | Promise<Response>;

/**
 * Per-handler middleware.
 * Call `next()` to proceed to the handler or next middleware.
 */
export type RouteMiddleware<TPath extends string = string> = (
  request: Request,
  next: () => Promise<Response>,
  ctx: HonoContext<HonoEnv, TPath>,
) => Response | Promise<Response>;

/**
 * Route handler definition — HTTP method handlers + optional middleware.
 */
export type RouteHandlerDefinition<TPath extends string = string> = Partial<
  Record<HttpMethod, RouteHandlerFn<TPath>>
> & {
  /**
   * Optional per-route middleware stack. Runs before any handler.
   *
   * **Note:** Middleware executes independently for each HTTP method.
   * If a route defines GET and POST with middleware, the middleware
   * chain runs separately for GET requests and POST requests.
   */
  middleware?: RouteMiddleware<TPath>[];
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
 * const handler = createRoute("/api/users/:id", {
 *   middleware: [authMiddleware],
 *   GET: async (req, ctx) => {
 *     const { id } = ctx.req.param();
 *     const user = await db.getUser(id);
 *     return Response.json(user);
 *   },
 *   DELETE: async (req, ctx) => {
 *     const { id } = ctx.req.param();
 *     await db.deleteUser(id);
 *     return new Response(null, { status: 204 });
 *   },
 * });
 * ```
 */
export function createRoute<const T extends string>(
  path: T & (string extends T ? never : T),
  definition: RouteHandlerDefinition<T>,
): RouteHandler {
  const app = new Hono();
  const { middleware = [], ...methods } = definition;

  // Collect defined method names for auto-OPTIONS and HEAD derivation.
  const definedMethods: HttpMethod[] = [];
  for (const key of Object.keys(methods)) {
    if (isHttpMethod(key)) {
      definedMethods.push(key);
    }
  }

  // Auto-implement OPTIONS if not explicitly defined.
  if (!methods.OPTIONS && definedMethods.length > 0) {
    definedMethods.push("OPTIONS");
    methods.OPTIONS = () =>
      new Response(null, {
        status: 204,
        headers: { Allow: definedMethods.join(", ") },
      });
  }

  // Auto-derive HEAD from GET if GET is defined but HEAD is not.
  if (methods.GET && !methods.HEAD) {
    definedMethods.push("HEAD");
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

    app.on(method, path, async (c: HonoContext) => {
      // Build middleware chain.
      let idx = 0;
      const next = (): Promise<Response> => {
        if (idx < middleware.length) {
          const mw = middleware[idx++];
          return Promise.resolve(mw(c.req.raw, next, c));
        }
        return Promise.resolve(handler(c.req.raw, c));
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
