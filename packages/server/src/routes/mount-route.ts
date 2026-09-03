import { type HttpMethod, isHttpMethod } from "@evjs/shared";
import type { Hono, MiddlewareHandler } from "hono";
import { textResponse } from "../shared/responses.js";
import {
  getRouteHandlerPipeline,
  type RouteHandlerPipeline,
} from "./api-handler.js";
import { invokeRouteHandler } from "./invoke-handler.js";
import type { RouteHandler } from "./route-handler.js";

export function mountRoute(
  app: Hono,
  route: RouteHandler,
  routeIndex: number,
): void {
  const methods = new Map<
    HttpMethod,
    RouteHandlerPipeline & { source: string }
  >();
  for (const [method, handler] of Object.entries(route.methods)) {
    if (!handler || !isHttpMethod(method)) continue;
    methods.set(method, {
      ...getRouteHandlerPipeline(handler, method),
      source: `createApp() routes[${routeIndex}].methods.${method}`,
    });
  }
  const allowedMethods = [...methods.keys()].join(", ");
  // Preserve Hono's implicit HEAD fallback for manually constructed routes.
  const get = methods.get("GET");
  if (get && !methods.has("HEAD")) methods.set("HEAD", get);

  const methodMiddlewares: MiddlewareHandler[] = [];
  for (const [method, pipeline] of methods) {
    for (const middleware of pipeline.middlewares) {
      methodMiddlewares.push(async (context, next) => {
        if (context.req.method === method) return middleware(context, next);
        await next();
      });
    }
  }

  // Hono matches HEAD through its GET router and removes the final body.
  // Register ALL and dispatch using the original request method so explicit
  // HEAD, automatic responses, and method middleware share the same context.
  const checkMethod: MiddlewareHandler = async (context, next) => {
    const method = context.req.method;
    if (!isHttpMethod(method) || !methods.has(method)) {
      // Existing 405 responses run global middleware, without route policy.
      return textResponse("Method Not Allowed", 405, { Allow: allowedMethods });
    }
    await next();
  };
  const dispatch: MiddlewareHandler = async (context) => {
    const method = context.req.method;
    const pipeline = isHttpMethod(method) ? methods.get(method) : undefined;
    if (pipeline) {
      return invokeRouteHandler(
        pipeline.handler,
        context.req.raw,
        context,
        pipeline.source,
      );
    }
    return textResponse("Method Not Allowed", 405, { Allow: allowedMethods });
  };
  app.on(
    ["ALL"],
    [route.path],
    checkMethod,
    ...route.middlewares,
    ...methodMiddlewares,
    dispatch,
  );
}
