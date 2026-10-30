import type { Env, Input, MiddlewareHandler } from "hono";
import type { BlankInput } from "hono/types";

/** An explicitly ordered, non-empty middleware chain. */
export type MiddlewareChain<
  // biome-ignore lint/suspicious/noExplicitAny: Preserve Hono's default environment for existing middleware chains.
  E extends Env = any,
  P extends string = string,
  I extends Input = BlankInput,
> = readonly [MiddlewareHandler<E, P, I>, ...MiddlewareHandler<E, P, I>[]];

/** Validate a resolved convention export before flattening its chain. */
export function normalizeMiddleware(
  value: unknown,
  source: string,
  options: { allowEmpty?: boolean } = {},
): readonly MiddlewareHandler[] {
  if (isMiddlewareFunction(value)) return Object.freeze([value]);
  if (!Array.isArray(value) || (value.length === 0 && !options.allowEmpty)) {
    throw new Error(
      `[evjs] ${source} must be a middleware function or ${options.allowEmpty ? "an array" : "a non-empty array"} of middleware functions.`,
    );
  }
  assertMiddlewareArray(value, source);
  return Object.freeze([...value]);
}

/** Assembled application/route stacks may be empty; authored chains may not. */
export function assertMiddlewareArray(
  value: unknown,
  source: string,
): asserts value is readonly MiddlewareHandler[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `[evjs] ${source} must be an array of middleware functions.`,
    );
  }
  for (let index = 0; index < value.length; index++) {
    if (!isMiddlewareFunction(value[index])) {
      throw new Error(
        `[evjs] ${source}[${index}] must be a middleware function.`,
      );
    }
  }
}

function isMiddlewareFunction(value: unknown): value is MiddlewareHandler {
  if (typeof value !== "function") return false;
  const tag = Object.prototype.toString.call(value);
  return (
    tag !== "[object GeneratorFunction]" &&
    tag !== "[object AsyncGeneratorFunction]" &&
    !/^class\b/.test(Function.prototype.toString.call(value))
  );
}
