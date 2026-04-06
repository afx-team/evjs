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
