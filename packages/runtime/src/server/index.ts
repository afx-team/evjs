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
export { createRpcMiddleware } from "./handler";
export type { ServerFn } from "./register";
export { registerServerFn } from "./register";
