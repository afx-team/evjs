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

export { ServerError } from "@evjs/shared";
export type { CreateAppOptions } from "./app";
export { createApp } from "./app";
export type {
  DispatchError,
  DispatchResult,
  DispatchSuccess,
  ServerFn,
} from "./functions";
export { dispatch, registerServerFn } from "./functions";
export type {
  RouteHandler,
  RouteHandlerContext,
  RouteHandlerDefinition,
  RouteHandlerFn,
  RouteMiddleware,
} from "./routes";
export { route } from "./routes";
