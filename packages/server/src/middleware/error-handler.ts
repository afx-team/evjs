import type { Context, ErrorHandler, Hono, MiddlewareHandler } from "hono";

// Direct calls can cross separately bundled copies of the server runtime.
const errorHandlerKey = Symbol.for("@evjs/server/request-error-handler");

/** Share the application's error handler with nested, directly called chains. */
export function createErrorHandlerMiddleware(app: Hono): MiddlewareHandler {
  let handler: ErrorHandler | undefined;
  const onError = app.onError;
  app.onError = (nextHandler) => {
    handler = nextHandler;
    return onError(nextHandler);
  };

  return async (context, next) => {
    const previous = Object.getOwnPropertyDescriptor(context, errorHandlerKey);
    Object.defineProperty(context, errorHandlerKey, {
      value: handler ?? previous?.value ?? defaultErrorHandler,
      configurable: true,
    });
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

// Match Hono's default response policy without accessing its private handler.
const defaultErrorHandler: ErrorHandler = (error, context) => {
  if ("getResponse" in error) {
    const response = error.getResponse();
    return context.newResponse(response.body, response);
  }
  console.error(error);
  return context.text("Internal Server Error", 500);
};
