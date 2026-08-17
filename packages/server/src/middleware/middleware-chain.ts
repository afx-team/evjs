import type { MiddlewareHandler } from "hono";

/** An explicitly ordered, non-empty middleware chain. */
export type MiddlewareChain = readonly [
  MiddlewareHandler,
  ...MiddlewareHandler[],
];
