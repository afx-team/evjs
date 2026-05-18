/**
 * @evjs/ev — config, plugin, and bundler types for the evjs framework.
 */

export type { BundlerAdapter } from "./bundler.js";
export { type BuildOptions, build, type DevOptions, dev } from "./commands.js";
export {
  CONFIG_DEFAULTS,
  type DevConfig,
  defineConfig,
  type EvBuildResult,
  type EvBundlerCtx,
  type EvConfig,
  type EvDocument,
  type EvPlugin,
  type EvPluginConfigContext,
  type EvPluginContext,
  type EvPluginHooks,
  isMpa,
  type PageConfig,
  type PageObjectConfig,
  type ResolvedDevConfig,
  type ResolvedEvConfig,
  type ResolvedServerConfig,
  type ResolvedServerDevConfig,
  type ResolvedSsrConfig,
  resolveConfig,
  type ServerConfig,
  type ServerDevConfig,
  type ServerFunctionsConfig,
  type SsrConfig,
} from "./config.js";
export { type BuildHtmlOptions, buildHtml } from "./html.js";
export { type ConfigPatch, merge } from "./merge.js";
