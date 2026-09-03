/**
 * Server application factory.
 *
 * Creates a Hono app with server function handler and optional route handlers.
 * This app is runtime-agnostic and can be mounted in Node, Edge, or Bun.
 */

import {
  APPLICATION_JSON_CONTENT_TYPE,
  compareRoutePathsBySpecificity,
  getFunctionEndpoint,
  getPathPatternValidationError,
  getRequestFnId,
  getServerRouteParamSegmentValidationError,
  isApplicationJsonContentType,
  isHttpMethod,
  type PathPatternValidationError,
  type ServerRouteParamSegmentValidationError,
  serverRoutePathShapeFromPath,
} from "@evjs/shared";
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
  assertFrameworkRuntime,
  type FrameworkServerOptions,
  handleFrameworkRenderRequest,
  handlePprRegionRequest,
  handleRscFlightRequest,
} from "../framework-rendering/runtime.js";
import { assertMiddlewareArray } from "../middleware/middleware-chain.js";
import { mountRoute } from "../routes/mount-route.js";
import type { RouteHandler } from "../routes/route-handler.js";
import {
  createServerFunctionRegistry,
  type DispatchError,
  isServerFunctionRegistry,
  type ServerFunctionRegistry,
} from "../server-functions/registry.js";
import { textResponse } from "../shared/responses.js";
import { isRecord } from "../shared/validation.js";

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
  /**
   * Server functions owned by this application.
   *
   * Create the registry with `createServerFunctionRegistry()` and register
   * functions before passing it to `createApp()`.
   */
  serverFunctions?: ServerFunctionRegistry;
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
  assertCreateAppOptions(options);
  const {
    routes = [],
    middlewares = [],
    framework,
    serverFunctions = createServerFunctionRegistry(),
  } = options ?? {};
  const endpoint = toRuntimePathname(
    framework?.runtime.runtime.server.fn ?? getFunctionEndpoint(),
  );
  const maxServerFunctionBodySize = 1024 * 1024;

  const app = new Hono();

  // Initialize Hono's native context storage
  app.use(contextStorage());

  // Mount global middleware
  for (const mw of middlewares) {
    app.use(mw);
  }

  // A more-specific path owns the request, including its 405 response. Keep
  // each route's handlers and fallback together so a static route cannot fall
  // through to a less-specific dynamic route for a method it does not expose.
  // Preserve the caller's index for diagnostics after ordering the routes.
  const orderedRoutes = routes
    .map((handler, routeIndex) => ({ handler, routeIndex }))
    .sort((left, right) =>
      compareProgrammaticRoutePathsBySpecificity(
        left.handler.path,
        right.handler.path,
      ),
    );

  // Mount route handlers (before server function endpoint for priority)
  for (const { handler, routeIndex } of orderedRoutes) {
    mountRoute(app, handler, routeIndex);
  }

  // Mount server function endpoint. Request size policy can move to
  // user/deployment middleware when an app needs a different limit.
  for (const endpointPath of exactRuntimePathVariants(endpoint)) {
    app.post(
      endpointPath,
      bodyLimit({
        maxSize: maxServerFunctionBodySize,
        onError: (c) => c.json(createServerFunctionBodyTooLargeResponse(), 413),
      }),
      async (c) => {
        if (!isServerFunctionJsonRequest(c.req.raw)) {
          return c.json(
            createUnsupportedServerFunctionMediaTypeResponse(),
            415,
          );
        }

        let body: unknown;

        try {
          body = await c.req.json();
        } catch (err) {
          if (isBodyLimitError(err)) {
            return c.json(createServerFunctionBodyTooLargeResponse(), 413);
          }
          return c.json(
            createMalformedServerFunctionRequestBodyResponse(),
            400,
          );
        }

        const response = isRecord(body)
          ? await serverFunctions.dispatch(
              body.fnId,
              readServerFunctionArgs(body),
            )
          : createInvalidServerFunctionRequest();

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

        return createServerFunctionJsonResponse(
          c,
          payload,
          status,
          "error" in response
            ? response.fnId
            : isRecord(body)
              ? getRequestFnId(body.fnId)
              : "",
        );
      },
    );
    app.all(endpointPath, (c) => {
      const payload = createServerFunctionMethodNotAllowedResponse();
      if (c.req.method === "HEAD") {
        return new Response(null, {
          status: 405,
          headers: {
            Allow: "POST",
            "Content-Type": APPLICATION_JSON_CONTENT_TYPE,
          },
        });
      }
      return c.json(payload, 405, { Allow: "POST" });
    });
  }

  const rscPath =
    framework?.rsc && framework.runtime.runtime.server.rsc
      ? toRuntimePathname(framework.runtime.runtime.server.rsc)
      : undefined;
  if (framework?.rsc && rscPath) {
    for (const endpointPath of exactRuntimePathVariants(rscPath)) {
      app.all(endpointPath, async (c, next) => {
        const response = await handleRscFlightRequest(framework, c.req.raw);
        if (!response) return next();
        return response;
      });
    }
  }

  if (framework?.render) {
    const pprPath = toRuntimePathname(
      framework.runtime.runtime.server.ppr ??
        joinPath(framework.runtime.runtime.server.basepath, "ppr"),
    );
    app.on(["GET", "HEAD"], [`${pprPath}/*`], async (c, next) => {
      const response = await handlePprRegionRequest(framework, c.req.raw);
      if (!response) return next();
      return response;
    });
    app.all(`${pprPath}/*`, (c, next) => {
      if (c.req.method === "GET" || c.req.method === "HEAD") {
        return next();
      }
      return textResponse("Method Not Allowed", 405, {
        Allow: "GET, HEAD",
      });
    });

    app.on(["GET", "HEAD"], ["*"], async (c, next) => {
      const response = await handleFrameworkRenderRequest(framework, c.req.raw);
      if (!response) return next();
      return response;
    });
  }

  return app;
}

function createInvalidServerFunctionRequest(): DispatchError {
  return {
    error: "Missing or invalid 'fnId' in request body",
    fnId: "",
    status: 400,
  };
}

function createServerFunctionBodyTooLargeResponse(): DispatchError {
  return {
    error: "Server function request body exceeds the 1 MiB limit.",
    fnId: "",
    status: 413,
  };
}

function createMalformedServerFunctionRequestBodyResponse(): DispatchError {
  return {
    error: "Malformed request body",
    fnId: "",
    status: 400,
  };
}

function createUnsupportedServerFunctionMediaTypeResponse(): DispatchError {
  return {
    error: `Server function requests must use Content-Type "${APPLICATION_JSON_CONTENT_TYPE}".`,
    fnId: "",
    status: 415,
  };
}

function isServerFunctionJsonRequest(request: Request): boolean {
  return isApplicationJsonContentType(request.headers.get("Content-Type"));
}

function createServerFunctionJsonResponse(
  context: HonoContext<HonoEnv, string>,
  payload: unknown,
  status: number,
  fnId: string,
): Response {
  try {
    return context.json(payload, status as ContentfulStatusCode);
  } catch {
    return context.json(createServerFunctionSerializationError(fnId), 500);
  }
}

function createServerFunctionSerializationError(fnId: string): DispatchError {
  return {
    error: "Server function response is not JSON serializable.",
    fnId,
    status: 500,
  };
}

function readServerFunctionArgs(body: Record<string, unknown>): unknown {
  return Object.hasOwn(body, "args") ? body.args : [];
}

function createServerFunctionMethodNotAllowedResponse(): DispatchError {
  return {
    error: "Method Not Allowed",
    fnId: "",
    status: 405,
  };
}

function isBodyLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "BodyLimitError" || error.message === "Payload Too Large")
  );
}

function assertCreateAppOptions(
  options: CreateAppOptions | undefined,
): asserts options is CreateAppOptions | undefined {
  if (options === undefined) return;
  if (!isRecord(options)) {
    throw new Error("[evjs] createApp() options must be an object.");
  }

  if (options.routes !== undefined) {
    if (!Array.isArray(options.routes)) {
      throw new Error(
        "[evjs] createApp() routes must be an array of route handlers.",
      );
    }
    options.routes.forEach(assertRouteHandler);
    assertUniqueRoutePaths(options.routes);
  }

  if (options.middlewares !== undefined) {
    assertMiddlewareArray(options.middlewares, "createApp() middlewares");
  }

  if (options.framework !== undefined) {
    assertFrameworkServerOptions(options.framework);
  }

  if (
    options.serverFunctions !== undefined &&
    !isServerFunctionRegistry(options.serverFunctions)
  ) {
    throw new Error(
      "[evjs] createApp() serverFunctions must be created by createServerFunctionRegistry().",
    );
  }
}

function assertFrameworkServerOptions(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error(
      "[evjs] createApp() framework must be a framework server object.",
    );
  }

  if (!isRecord(value.runtime)) {
    throw new Error(
      "[evjs] createApp() framework.runtime must be a framework runtime object.",
    );
  }
  assertFrameworkRuntime(value.runtime, "createApp() framework.runtime");
  assertOptionalRenderCoordinator(value.render, "framework.render");
  assertOptionalRscCoordinator(value.rsc, "framework.rsc");
  assertOptionalPprRuntimeOptions(value.ppr, "framework.ppr");
  assertOptionalFunction(
    value.allowPageRenderRequest,
    "framework.allowPageRenderRequest",
  );
}

function assertOptionalRenderCoordinator(value: unknown, name: string): void {
  if (value === undefined || typeof value === "function") return;
  if (isRecord(value) && typeof value.render === "function") return;
  throw new Error(
    `[evjs] createApp() ${name} must be a render function or coordinator object.`,
  );
}

function assertOptionalRscCoordinator(value: unknown, name: string): void {
  if (value === undefined || typeof value === "function") return;
  if (isRecord(value) && typeof value.renderFlight === "function") return;
  throw new Error(
    `[evjs] createApp() ${name} must be an RSC Flight function or coordinator object.`,
  );
}

function assertOptionalPprRuntimeOptions(value: unknown, name: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error(`[evjs] createApp() ${name} must be an object.`);
  }

  if (value.regionCache !== undefined) {
    if (
      !isRecord(value.regionCache) ||
      typeof value.regionCache.get !== "function" ||
      typeof value.regionCache.set !== "function"
    ) {
      throw new Error(
        `[evjs] createApp() ${name}.regionCache must provide get() and set() methods.`,
      );
    }
    if (
      value.regionCache.delete !== undefined &&
      typeof value.regionCache.delete !== "function"
    ) {
      throw new Error(
        `[evjs] createApp() ${name}.regionCache.delete must be a function when provided.`,
      );
    }
  }

  const maxRegionCacheEntries = value.maxRegionCacheEntries;
  if (
    maxRegionCacheEntries !== undefined &&
    (typeof maxRegionCacheEntries !== "number" ||
      !Number.isSafeInteger(maxRegionCacheEntries) ||
      maxRegionCacheEntries <= 0)
  ) {
    throw new Error(
      `[evjs] createApp() ${name}.maxRegionCacheEntries must be a positive integer.`,
    );
  }

  const staleWhileRevalidate = value.staleWhileRevalidate;
  if (
    staleWhileRevalidate !== undefined &&
    (typeof staleWhileRevalidate !== "number" ||
      !Number.isInteger(staleWhileRevalidate) ||
      staleWhileRevalidate <= 0)
  ) {
    throw new Error(
      `[evjs] createApp() ${name}.staleWhileRevalidate must be a positive integer number of seconds.`,
    );
  }
}

function assertOptionalFunction(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`[evjs] createApp() ${name} must be a function.`);
  }
}

function assertRouteHandler(route: RouteHandler, index: number): void {
  const name = `routes[${index}]`;
  if (!isRecord(route)) {
    throw new Error(
      `[evjs] createApp() ${name} must be a route handler object.`,
    );
  }

  const pathError = getPathPatternValidationError(route.path);
  if (pathError) {
    throw new Error(
      `[evjs] createApp() ${name}.path ${formatRoutePathError(pathError)}`,
    );
  }
  const paramError = getServerRouteParamSegmentValidationError(route.path);
  if (paramError) {
    throw new Error(
      `[evjs] createApp() ${name}.path ${formatServerRouteParamValidationError(paramError)}`,
    );
  }

  if (!isRecord(route.methods)) {
    throw new Error(
      `[evjs] createApp() ${name}.methods must be an object map.`,
    );
  }

  let hasMethodHandler = false;
  for (const [method, handler] of Object.entries(route.methods)) {
    if (!isHttpMethod(method)) {
      throw new Error(
        `[evjs] createApp() ${name}.methods.${method} is not a supported HTTP method.`,
      );
    }
    if (handler !== undefined && typeof handler !== "function") {
      throw new Error(
        `[evjs] createApp() ${name}.methods.${method} must be a function.`,
      );
    }
    if (typeof handler === "function") {
      hasMethodHandler = true;
    }
  }
  if (!hasMethodHandler) {
    throw new Error(
      `[evjs] createApp() ${name}.methods must include at least one HTTP method handler.`,
    );
  }

  assertMiddlewareArray(route.middlewares, `createApp() ${name}.middlewares`);
}

function toRuntimePathname(endpoint: string): string {
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

/** One optional trailing slash is part of the shared exact-path semantics. */
function exactRuntimePathVariants(pathname: string): string[] {
  return pathname === "/" ? [pathname] : [pathname, `${pathname}/`];
}

function formatRoutePathError(error: PathPatternValidationError): string {
  switch (error) {
    case "empty":
      return "must be a non-empty string.";
    case "missing-leading-slash":
      return 'must start with "/".';
    case "whitespace":
      return "must not contain whitespace.";
    case "query-or-hash":
      return "must not include a query string or hash.";
  }
}

function formatServerRouteParamValidationError(
  error: ServerRouteParamSegmentValidationError,
): string {
  switch (error.error) {
    case "empty":
      return `contains dynamic segment "${error.segment}" without a param name.`;
    case "reserved":
      return `uses reserved dynamic param name "${error.name}" in segment "${error.segment}". Use a safe application-specific name.`;
    case "duplicate":
      return `uses duplicate dynamic param name "${error.name}" in segment "${error.segment}". Use unique param names within one route path.`;
  }
}

function assertUniqueRoutePaths(routes: RouteHandler[]): void {
  const seenPaths = new Set<string>();
  const seenShapes = new Map<string, { index: number; path: string }>();
  routes.forEach((route, index) => {
    if (seenPaths.has(route.path)) {
      throw new Error(
        `[evjs] createApp() routes[${index}].path duplicates route path "${route.path}".`,
      );
    }
    seenPaths.add(route.path);

    const routeShape = serverRoutePathShapeFromPath(route.path);
    const previousShapeOwner = seenShapes.get(routeShape);
    if (previousShapeOwner) {
      throw new Error(
        `[evjs] createApp() routes[${index}].path has the same route shape as routes[${previousShapeOwner.index}].path "${previousShapeOwner.path}". Use one route handler per URL shape.`,
      );
    }
    seenShapes.set(routeShape, { index, path: route.path });
  });
}

function compareProgrammaticRoutePathsBySpecificity(
  leftPath: string,
  rightPath: string,
): number {
  return compareRoutePathsBySpecificity(
    toCanonicalSpecificityPath(leftPath),
    toCanonicalSpecificityPath(rightPath),
  );
}

/** Translate Hono's wildcard syntax without treating `$`-prefixed literals as parameters. */
function toCanonicalSpecificityPath(routePath: string): string {
  return routePath
    .split("/")
    .map((segment) => {
      if (segment === "*") return "$";
      if (segment.startsWith("$")) return `%24${segment.slice(1)}`;
      return segment;
    })
    .join("/");
}

function joinPath(base: string, segment: string): string {
  return `${base.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`;
}
