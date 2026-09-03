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
  Input,
  MiddlewareHandler,
} from "hono";
import type { BlankInput } from "hono/types";
import { assertMiddlewareArray } from "../middleware/middleware-chain.js";
import { createHeadHandler } from "./api-handler.js";

/**
 * A route handler function.
 * Receives a standard Web `Request` and the Hono `Context`.
 * Access route params via `ctx.req.param()`.
 */
export type RouteHandlerFn<
  TPath extends string = string,
  E extends HonoEnv = HonoEnv,
  I extends Input = BlankInput,
> = (
  request: Request,
  ctx: HonoContext<E, TPath, I>,
) => Response | Promise<Response>;

/**
 * Route handler definition — HTTP method handlers + optional middleware.
 */
export type RouteHandlerDefinition<
  TPath extends string = string,
  E extends HonoEnv = HonoEnv,
  I extends Input = BlankInput,
> = Partial<Record<HttpMethod, RouteHandlerFn<TPath, E, I>>> & {
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
  /** The normalized HTTP method handlers, including automatic HEAD/OPTIONS. */
  methods: Readonly<Partial<Record<HttpMethod, RouteHandlerFn<string>>>>;
  /** Route-level middleware. */
  middlewares: MiddlewareHandler[];
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
export function createRoute<
  const T extends string,
  GetEnv extends HonoEnv = HonoEnv,
  GetInput extends Input = BlankInput,
  PostEnv extends HonoEnv = HonoEnv,
  PostInput extends Input = BlankInput,
  PutEnv extends HonoEnv = HonoEnv,
  PutInput extends Input = BlankInput,
  PatchEnv extends HonoEnv = HonoEnv,
  PatchInput extends Input = BlankInput,
  DeleteEnv extends HonoEnv = HonoEnv,
  DeleteInput extends Input = BlankInput,
  HeadEnv extends HonoEnv = HonoEnv,
  HeadInput extends Input = BlankInput,
  OptionsEnv extends HonoEnv = HonoEnv,
  OptionsInput extends Input = BlankInput,
>(
  path: T & (string extends T ? never : T),
  // Infer each method independently: one method's middleware cannot provide
  // variables or validated input to another method on the same route.
  definition: {
    GET?: RouteHandlerFn<NoInfer<T>, GetEnv, GetInput>;
    POST?: RouteHandlerFn<NoInfer<T>, PostEnv, PostInput>;
    PUT?: RouteHandlerFn<NoInfer<T>, PutEnv, PutInput>;
    PATCH?: RouteHandlerFn<NoInfer<T>, PatchEnv, PatchInput>;
    DELETE?: RouteHandlerFn<NoInfer<T>, DeleteEnv, DeleteInput>;
    HEAD?: RouteHandlerFn<NoInfer<T>, HeadEnv, HeadInput>;
    OPTIONS?: RouteHandlerFn<NoInfer<T>, OptionsEnv, OptionsInput>;
  } & Pick<RouteHandlerDefinition<T>, "middlewares">,
): RouteHandler;
export function createRoute(
  path: string,
  definition: RouteHandlerDefinition,
): RouteHandler {
  const pathError = getCreateRoutePathError(path);
  if (pathError) {
    throw new Error(`[evjs] createRoute() ${pathError}`);
  }

  assertRouteDefinition(definition);
  const { middlewares = [], ...methods } = definition;

  if (collectRouteMethods(methods).length === 0) {
    throw new Error(
      "[evjs] createRoute() must declare at least one HTTP method handler.",
    );
  }

  // Keep automatic methods available to callers before the route is mounted.
  if (!methods.OPTIONS) {
    methods.OPTIONS = () =>
      new Response(null, {
        status: 204,
        headers: { Allow: collectRouteMethods(methods).join(", ") },
      });
  }
  if (methods.GET && !methods.HEAD) {
    methods.HEAD = createHeadHandler(methods.GET);
  }

  return {
    path,
    methods: Object.freeze(
      methods as Partial<Record<HttpMethod, RouteHandlerFn<string>>>,
    ),
    middlewares,
  };
}

function collectRouteMethods(methods: Record<string, unknown>): HttpMethod[] {
  return Object.entries(methods)
    .filter(
      (entry): entry is [HttpMethod, RouteHandlerFn<string>] =>
        isHttpMethod(entry[0]) && typeof entry[1] === "function",
    )
    .map(([method]) => method);
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
      assertMiddlewareArray(value, "createRoute() middlewares");
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
