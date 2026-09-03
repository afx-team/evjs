import type { Context, Env, Input } from "hono";
import { textResponse } from "../shared/responses.js";
import { isRecord } from "../shared/validation.js";
import type { RouteHandlerFn } from "./route-handler.js";

export async function invokeRouteHandler<
  P extends string,
  E extends Env,
  I extends Input,
>(
  handler: RouteHandlerFn<P, E, I>,
  request: Request,
  context: Context<E, P, I>,
  source: string,
): Promise<Response> {
  const response = await handler(request, context);
  if (isResponseLike(response)) return response;

  return textResponse(`[evjs] ${source} must return a Response.`, 500);
}

function isResponseLike(value: unknown): value is Response {
  if (value instanceof Response) return true;
  if (!isRecord(value)) return false;
  return (
    Object.prototype.toString.call(value) === "[object Response]" &&
    typeof value.status === "number" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.clone === "function" &&
    isRecord(value.headers) &&
    typeof value.headers.get === "function" &&
    typeof value.headers.has === "function"
  );
}
