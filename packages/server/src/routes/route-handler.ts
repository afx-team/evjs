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
import type {
  Context as HonoContext,
  Env as HonoEnv,
  MiddlewareHandler,
} from "hono";

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
 * Route handler definition — HTTP method handlers + optional middleware.
 */
export type RouteHandlerDefinition<TPath extends string = string> = Partial<
  Record<HttpMethod, RouteHandlerFn<TPath>>
> & {
  /**
   * Optional per-route middleware stack. Runs before any handler.
   */
  middlewares?: MiddlewareHandler[];
};

/**
 * A created route handler, ready to be mounted on a Hono app.
 */
export interface RouteHandler {
  /** The path pattern for this handler (e.g. `/api/users/:id`). */
  path: string;
  /** The normalized HTTP method handlers. */
  methods: Partial<Record<HttpMethod, RouteHandlerFn<any>>>;
  /** Route-level middleware. */
  middlewares: MiddlewareHandler[];
  /** Allowed HTTP methods for this route (used for 405 responses). */
  allowedMethods: HttpMethod[];
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
  const { middlewares = [], ...methods } = definition;

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

  return {
    path,
    methods: methods as Partial<Record<HttpMethod, RouteHandlerFn<any>>>,
    middlewares,
    allowedMethods: definedMethods,
  };
}
