/**
 * @evjs/shared — types and utilities shared by @evjs/client and @evjs/server.
 */

export type { BundlerAdapter } from "./bundler.js";
export {
  CONFIG_DEFAULTS,
  defineConfig,
  type EvBuildResult,
  type EvBundlerCtx,
  type EvConfig,
  type EvPlugin,
  type EvPluginContext,
  type EvPluginHooks,
  type ResolvedBundlerConfig,
  type ResolvedDevConfig,
  type ResolvedEvConfig,
  type ResolvedServerConfig,
  type ResolvedServerDevConfig,
  resolveConfig,
} from "./config.js";
export {
  DEFAULT_ENDPOINT,
  DEFAULT_ERROR_STATUS,
} from "./constants.js";
export { ServerError, ServerFunctionError } from "./errors.js";
export type { HttpMethod } from "./http.js";
export { HTTP_METHODS, isHttpMethod } from "./http.js";
