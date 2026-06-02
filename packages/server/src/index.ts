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
export type { CreateAppOptions } from "./app.js";
export { createApp } from "./app.js";
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
} from "./context.js";
export type {
  FrameworkServerOptions,
  ManifestRenderCoordinatorOptions,
  ManifestServerModuleLoader,
  ModuleRenderCoordinatorOptions,
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
} from "./framework.js";
export {
  createManifestRenderCoordinator,
  createModuleRenderCoordinator,
  handleFrameworkRenderRequest,
  handlePprRegionRequest,
  handleRscFlightRequest,
} from "./framework.js";
export type {
  DispatchError,
  DispatchResult,
  DispatchSuccess,
  ServerFn,
} from "./functions/index.js";
export { dispatch, registerServerReference } from "./functions/index.js";
export type {
  RouteHandler,
  RouteHandlerDefinition,
  RouteHandlerFn,
} from "./routes/index.js";
export { createRoute } from "./routes/index.js";
