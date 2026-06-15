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

import {
  getPathPatternValidationError,
  getServerRouteParamSegmentValidationError,
  HTTP_METHOD_LIST_DESCRIPTION,
  type HttpMethod,
  isHttpMethod,
  type PathPatternValidationError,
  type ServerRouteParamSegmentValidationError,
} from "@evjs/shared";
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
  methods: Partial<Record<HttpMethod, RouteHandlerFn<string>>>;
  /** Route-level middleware. */
  middlewares: MiddlewareHandler[];
  /** Allowed HTTP methods for this route (used for 405 responses). */
  allowedMethods: HttpMethod[];
}

const SUPPORTED_DEFINITION_KEYS = `${HTTP_METHOD_LIST_DESCRIPTION} or "middlewares"`;

/**
 * Create a programmatic route handler.
 *
 * @param path - URL path pattern (uses Hono's path syntax, e.g. `/api/users/:id`).
 * @param definition - HTTP method handlers and optional middleware.
 * @returns A `RouteHandler` that can be mounted via `createApp({ routes })`.
 *
 * @example
 * ```ts
 * const handler = createRoute("/api/users/:id", {
 *   middlewares: [authMiddleware],
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
  const pathError = getCreateRoutePathError(path);
  if (pathError) {
    throw new Error(`[evjs] createRoute() ${pathError}`);
  }

  assertRouteDefinition(definition);
  const routeDefinition = definition as RouteHandlerDefinition<T>;
  const { middlewares = [], ...methods } = routeDefinition;

  // Collect defined method names for auto-OPTIONS and HEAD derivation.
  const definedMethods: HttpMethod[] = [];
  for (const key of Object.keys(methods)) {
    if (isHttpMethod(key)) {
      definedMethods.push(key);
    }
  }
  if (definedMethods.length === 0) {
    throw new Error(
      "[evjs] createRoute() must declare at least one HTTP method handler.",
    );
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
    methods: methods as Partial<Record<HttpMethod, RouteHandlerFn<string>>>,
    middlewares,
    allowedMethods: definedMethods,
  };
}

function getCreateRoutePathError(path: unknown): string | undefined {
  const error = getPathPatternValidationError(path);
  if (error) return formatCreateRoutePathValidationError(error);

  const paramError = getServerRouteParamSegmentValidationError(path as string);
  if (paramError) return formatServerRouteParamValidationError(paramError);

  return undefined;
}

function formatCreateRoutePathValidationError(
  error: PathPatternValidationError,
): string {
  switch (error) {
    case "empty":
      return "path must be a non-empty string.";
    case "missing-leading-slash":
      return 'path must start with "/".';
    case "whitespace":
      return "path must not contain whitespace.";
    case "query-or-hash":
      return "path must not include a query string or hash.";
  }
}

function formatServerRouteParamValidationError(
  error: ServerRouteParamSegmentValidationError,
): string {
  switch (error.error) {
    case "empty":
      return `path contains dynamic segment "${error.segment}" without a param name.`;
    case "reserved":
      return `path uses reserved dynamic param name "${error.name}" in segment "${error.segment}". Use a safe application-specific name.`;
    case "duplicate":
      return `path uses duplicate dynamic param name "${error.name}" in segment "${error.segment}". Use unique param names within one route path.`;
  }
}

function assertRouteDefinition(
  definition: unknown,
): asserts definition is Record<string, unknown> {
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  ) {
    throw new Error("[evjs] createRoute() definition must be an object.");
  }

  for (const [key, value] of Object.entries(definition)) {
    if (key === "middleware") {
      throw new Error(
        '[evjs] createRoute() definition uses "middleware"; use "middlewares" for per-route middleware.',
      );
    }

    if (key === "middlewares") {
      if (
        !Array.isArray(value) ||
        value.some((middleware) => typeof middleware !== "function")
      ) {
        throw new Error(
          "[evjs] createRoute() middlewares must be an array of functions.",
        );
      }
      continue;
    }

    if (!isHttpMethod(key)) {
      throw new Error(
        `[evjs] createRoute() definition key "${key}" is not supported. Use ${SUPPORTED_DEFINITION_KEYS}.`,
      );
    }

    if (typeof value !== "function") {
      throw new Error(
        `[evjs] createRoute() ${key} handler must be a function.`,
      );
    }
  }
}
