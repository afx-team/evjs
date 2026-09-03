import type { Env, Input, MiddlewareHandler } from "hono";
import { every } from "hono/combine";
import type { BlankInput } from "hono/types";
import type {
  IfAnyThenEmptyObject,
  UnionToIntersection,
} from "hono/utils/types";
import { invokeWithErrorHandler } from "../middleware/error-handler.js";
import { normalizeMiddleware } from "../middleware/middleware-chain.js";
import { invokeRouteHandler } from "./invoke-handler.js";
import type { RouteHandlerFn } from "./route-handler.js";

// Symbol metadata survives a separately bundled copy of the authoring helper.
const pipelineKey = Symbol.for("@evjs/server/route-handler-pipeline");
const headPipelineKey = Symbol.for("@evjs/server/head-handler-pipeline");

type MiddlewareDetails<T> = T extends readonly MiddlewareHandler[]
  ? MiddlewareDetails<T[number]>
  : T extends MiddlewareHandler<infer E, infer P, infer I>
    ? { env: IfAnyThenEmptyObject<E>; path: P; input: IfAnyThenEmptyObject<I> }
    : never;

type SpecificPath<T> = T extends { path: infer P extends string }
  ? string extends P
    ? never
    : P
  : never;

type MiddlewarePath<T> = [SpecificPath<MiddlewareDetails<T>>] extends [never]
  ? string
  : SpecificPath<MiddlewareDetails<T>>;

type MiddlewareEnv<T> = UnionToIntersection<MiddlewareDetails<T>["env"]> & Env;
type MiddlewareInput<T> = UnionToIntersection<MiddlewareDetails<T>["input"]> &
  Input;

export interface RouteHandlerPipeline<
  P extends string = string,
  E extends Env = Env,
  I extends Input = BlankInput,
> {
  readonly middlewares: readonly MiddlewareHandler[];
  readonly handler: RouteHandlerFn<P, E, I>;
}

/**
 * Compose middleware around an HTTP method handler in explicit order.
 *
 * @param handler - The Request/Context handler to run after middleware.
 * @param middlewares - One middleware or a non-empty ordered array.
 *
 * Bind generic middleware factory results to variables first so TypeScript
 * can infer this handler's context from the second argument.
 */
export function withMiddlewares<
  const M extends
    | MiddlewareHandler
    | readonly [MiddlewareHandler, ...MiddlewareHandler[]],
  P extends string = MiddlewarePath<M>,
  E extends Env = MiddlewareEnv<M>,
  I extends Input = MiddlewareInput<M>,
>(handler: RouteHandlerFn<P, E, I>, middlewares: M): RouteHandlerFn<P, E, I> {
  if (typeof handler !== "function") {
    throw new Error("[evjs] withMiddlewares() handler must be a function.");
  }
  const chain = normalizeMiddleware(
    middlewares,
    "withMiddlewares() middlewares",
  );

  const inner = getRouteHandlerPipeline(handler);
  const pipeline = Object.freeze({
    middlewares: Object.freeze([...chain, ...inner.middlewares]),
    handler: inner.handler,
  });
  const composed = every(
    ...pipeline.middlewares.map(
      (middleware): MiddlewareHandler =>
        (context, next) =>
          invokeWithErrorHandler(context, () => middleware(context, next)),
    ),
  );
  const wrapped: RouteHandlerFn<P, E, I> = async (request, context) => {
    // Direct calls use Hono's composition helper, which retains route params.
    // Mounted routes expand the metadata into the application's native chain.
    await composed(context, async () => {
      context.res = await invokeWithErrorHandler(context, () =>
        invokeRouteHandler(
          pipeline.handler,
          request,
          context,
          "withMiddlewares() handler",
        ),
      );
    });
    if (!context.finalized) {
      throw new Error(
        "[evjs] withMiddlewares() middleware must return a Response or await next().",
      );
    }
    return context.res;
  };
  Object.defineProperty(wrapped, pipelineKey, { value: pipeline });
  return wrapped;
}

export function getRouteHandlerPipeline<
  P extends string,
  E extends Env,
  I extends Input,
>(
  handler: RouteHandlerFn<P, E, I>,
  method?: string,
): RouteHandlerPipeline<P, E, I> {
  // Only a mounted HEAD request can delegate final body removal to Hono.
  // Ordinary composition must keep the callable HEAD wrapper intact.
  if (method === "HEAD") {
    const headPipeline = Object.getOwnPropertyDescriptor(
      handler,
      headPipelineKey,
    )?.value as RouteHandlerPipeline<P, E, I> | undefined;
    if (headPipeline) return headPipeline;
  }
  return (
    (Object.getOwnPropertyDescriptor(handler, pipelineKey)?.value as
      | RouteHandlerPipeline<P, E, I>
      | undefined) ?? {
      middlewares: [],
      handler,
    }
  );
}

/** Keep automatic HEAD directly callable and its middleware in Hono's chain. */
export function createHeadHandler<
  P extends string,
  E extends Env,
  I extends Input,
>(get: RouteHandlerFn<P, E, I>): RouteHandlerFn<P, E, I> {
  const head: RouteHandlerFn<P, E, I> = async (request, context) => {
    const response = await get(request, context);
    context.res = new Response(null, {
      status: response.status,
      headers: response.headers,
    });
    return context.res;
  };
  // Mounted requests use GET's native pipeline; Hono strips the final body.
  Object.defineProperty(head, headPipelineKey, {
    value: Object.freeze(getRouteHandlerPipeline(get)),
  });
  return head;
}
