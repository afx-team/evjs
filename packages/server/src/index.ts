/**
 * Server-side runtime utilities (environment-agnostic).
 *
 * For environment-specific adapters, use:
 * - @evjs/server/node
 * - @evjs/server/ecma
 *
 * For minimal function registration (no Hono), use:
 * - @evjs/server/register
 */

export type { Codec } from "@evjs/shared";
export { jsonCodec, ServerError } from "@evjs/shared";
export type { CreateAppOptions } from "./app";
export { createApp } from "./app";
export type {
  DispatchError,
  DispatchResult,
  DispatchSuccess,
  Middleware,
  MiddlewareContext,
} from "./dispatch";
export { dispatch, registerMiddleware } from "./dispatch";
export type { HandlerOptions } from "./handler";
export { createHandler } from "./handler";
export type { ServerFn } from "./register";
export { registerServerFn } from "./register";
