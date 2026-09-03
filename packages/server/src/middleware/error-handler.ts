import type {
  Context,
  ErrorHandler,
  Hono,
  MiddlewareHandler,
  Next,
} from "hono";
import { matchedRoutes } from "hono/route";
import { COMPOSED_HANDLER } from "hono/utils/constants";
import { getPath } from "hono/utils/url";

// Direct calls can cross separately bundled copies of the server runtime.
const errorHandlerKey = Symbol.for("@evjs/server/request-error-handler");
const requestErrorHandlers = new WeakMap<Request, ErrorHandler>();
const errorContinuations = new WeakSet<Next>();

/** Capture the dispatching instance before Hono creates its request context. */
export const getRequestPath: Hono["getPath"] = function (this: Hono, request) {
  const handler = getHonoErrorHandler(this);
  if (handler) requestErrorHandlers.set(request, handler);
  return getPath(request);
};

/** Share the application's error handler with nested, directly called chains. */
export function createErrorHandlerMiddleware(): MiddlewareHandler {
  const middleware: MiddlewareHandler = async (context, next) => {
    if (errorContinuations.has(next)) return next();
    // getPath runs with the actual instance, including basePath() clones.
    // Mounted sub-applications use their native Hono boundary when present.
    // An unknown parent policy must remain Hono's responsibility.
    const requestHandler = requestErrorHandlers.get(context.req.raw);
    requestErrorHandlers.delete(context.req.raw);
    const previous = Object.getOwnPropertyDescriptor(context, errorHandlerKey);
    const handler =
      getMountedErrorHandler(context, middleware) ??
      requestHandler ??
      previous?.value;
    if (handler) {
      Object.defineProperty(context, errorHandlerKey, {
        value: handler,
        configurable: true,
      });
    }
    try {
      await next();
    } finally {
      if (previous) {
        Object.defineProperty(context, errorHandlerKey, previous);
      } else {
        Reflect.deleteProperty(context, errorHandlerKey);
      }
    }
  };
  return middleware;
}

function getMountedErrorHandler(
  context: Context,
  middleware: MiddlewareHandler,
): ErrorHandler | undefined {
  const boundary = matchedRoutes(context)[context.req.routeIndex]?.handler;
  if (!boundary || boundary === middleware) return undefined;

  // Only re-enter Hono's error wrappers around this middleware. The marked
  // continuation bypasses our setup and throws directly into that boundary.
  const seen = new Set<unknown>();
  let inner: unknown = boundary;
  while (inner !== middleware) {
    if (typeof inner !== "function" || seen.has(inner)) return undefined;
    seen.add(inner);
    inner = Reflect.get(inner, COMPOSED_HANDLER);
  }
  return async (error, currentContext) => {
    const reject: Next = async () => {
      throw error;
    };
    errorContinuations.add(reject);
    try {
      await boundary(currentContext, reject);
      return currentContext.res;
    } finally {
      errorContinuations.delete(reject);
    }
  };
}

// Hono copies this runtime field to basePath() clones and reads it for both
// dispatch and sub-application error boundaries. If it is unavailable, let
// errors propagate to Hono rather than inventing another application's policy.
function getHonoErrorHandler(app: Hono): ErrorHandler | undefined {
  const handler: unknown = Reflect.get(app, "errorHandler");
  return typeof handler === "function" ? (handler as ErrorHandler) : undefined;
}

/** Resolve errors before the calling middleware resumes after await next(). */
export async function invokeWithErrorHandler<T>(
  context: Context,
  invoke: () => Promise<T>,
): Promise<T | Response> {
  try {
    return await invoke();
  } catch (error) {
    const handler = Object.getOwnPropertyDescriptor(context, errorHandlerKey)
      ?.value as ErrorHandler | undefined;
    if (!(error instanceof Error) || !handler) throw error;
    context.error = error;
    context.res = await handler(error, context);
    return context.res;
  }
}
