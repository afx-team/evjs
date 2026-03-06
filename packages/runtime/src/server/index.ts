/**
 * Server-side runtime utilities (environment-agnostic).
 *
 * For environment-specific adapters, use:
 * - @evjs/runtime/server/node
 * - @evjs/runtime/server/ecma
 *
 * For minimal function registration (no Hono), use:
 * - @evjs/runtime/server/register
 */

export type { CreateAppOptions } from "./app";
export { createApp } from "./app";
export { registerServerFn } from "./register";
export type { ServerFn } from "./register";
export { createRpcMiddleware } from "./handler";
