import type { ClientManifest, ServerManifest } from "@evjs/manifest";
import type { ResolvedEvConfig } from "./config.js";

/**
 * Context passed to plugin bundler hooks.
 */
export interface EvBundlerCtx {
  /** The current mode. */
  mode: "development" | "production";
  /** The fully resolved framework config. */
  config: ResolvedEvConfig;
}

/**
 * An evjs plugin.
 */
export interface EvPlugin {
  /** Plugin name for debugging and logging. */
  name: string;

  /**
   * Initialize the plugin and return lifecycle hooks.
   *
   * Receives the fully resolved config and build context. All returned
   * hooks share state through closure.
   */
  setup?: (
    ctx: EvPluginContext,
  ) => EvPluginHooks | undefined | Promise<EvPluginHooks | undefined>;
}

/**
 * Context passed to plugin setup().
 */
export interface EvPluginContext {
  /** Current mode. */
  mode: "development" | "production";
  /** The fully resolved framework config. */
  config: ResolvedEvConfig;
}

/**
 * Lifecycle hooks returned from plugin setup().
 */
export interface EvPluginHooks {
  /** Called before compilation begins. */
  buildStart?: () => void | Promise<void>;

  /**
   * Modify the underlying bundler configuration directly.
   *
   * The config type is `unknown` by default. Use the typed helper exported
   * by each bundler adapter for type safety (e.g., `webpack()` from
   * `@evjs/bundler-webpack`).
   */
  bundler?: (config: unknown, ctx: EvBundlerCtx) => void;

  /** Called after compilation completes. Receives build result with manifests. */
  buildEnd?: (result: EvBuildResult) => void | Promise<void>;
}

/**
 * Build result passed to the buildEnd hook.
 */
export interface EvBuildResult {
  /** The client manifest (assets, routes). */
  clientManifest: ClientManifest;
  /** The server manifest (entry, fns). Undefined if server is disabled. */
  serverManifest?: ServerManifest;
  /** True if this is a rebuild triggered by file change (dev watch mode only). */
  isRebuild: boolean;
}
