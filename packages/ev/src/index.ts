/**
 * @evjs/ev — config, plugin, and bundler types for the evjs framework.
 */

export type { BundlerAdapter } from "./bundler.js";
export {
  CONFIG_DEFAULTS,
  defineConfig,
  type EvBuildResult,
  type EvBundlerCtx,
  type EvConfig,
  type EvDocument,
  type EvPlugin,
  type EvPluginContext,
  type EvPluginHooks,
  type ResolvedDevConfig,
  type ResolvedEvConfig,
  type ResolvedServerConfig,
  type ResolvedServerDevConfig,
  resolveConfig,
} from "./config.js";
export { type BuildHtmlOptions, buildHtml } from "./html.js";
