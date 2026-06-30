/**
 * Server-side runtime utilities (environment-agnostic).
 *
 * For environment-specific adapters, use:
 * - @evjs/server/node
 * - @evjs/server/fetch
 *
 * Framework-generated server function registrations use:
 * - @evjs/server/internal/server-functions
 */

export { ServerError } from "@evjs/shared";
export type { MiddlewareHandler } from "hono";
export type { CreateAppOptions } from "./app/app.js";
export { createApp } from "./app/app.js";
export type {
  FrameworkRenderCoordinatorOptions,
  FrameworkRuntime,
  FrameworkServerModuleLoader,
  FrameworkServerOptions,
  ModuleRenderCoordinatorOptions,
  PprRegionCache,
  PprRegionCacheEntry,
  PprRuntimeOptions,
  RscCoordinator,
  RscFlightContext,
  RscFlightHandler,
  ServerRenderContext,
  ServerRenderCoordinator,
  ServerRendererModule,
  ServerRendererRegistry,
  ServerRendererRegistryEntry,
  ServerRenderHandler,
  ServerRenderResult,
} from "./framework-rendering/framework.js";
export {
  createFrameworkRenderCoordinator,
  createModuleRenderCoordinator,
  handleFrameworkRenderRequest,
  handlePprRegionRequest,
  handleRscFlightRequest,
} from "./framework-rendering/framework.js";
export type {
  RequestLogEntry,
  RequestLoggerOptions,
} from "./middleware/request-logger.js";
export { requestLogger } from "./middleware/request-logger.js";
export {
  deleteCookie,
  generateCookie,
  generateSignedCookie,
  getContext,
  getCookie,
  getSignedCookie,
  headers,
  request,
  setCookie,
  setSignedCookie,
  waitUntil,
} from "./request-context/context.js";
export type {
  RouteHandler,
  RouteHandlerDefinition,
  RouteHandlerFn,
} from "./routes/index.js";
export { createRoute } from "./routes/index.js";
export type {
  DispatchError,
  DispatchResult,
  DispatchSuccess,
  ServerFn,
} from "./server-functions/index.js";
export {
  dispatch,
  registerServerReference,
} from "./server-functions/index.js";
