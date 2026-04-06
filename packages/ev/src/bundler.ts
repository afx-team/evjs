import type { EvPluginHooks, ResolvedEvConfig } from "./config.js";

/**
 * Interface that all bundler adapters must implement.
 */
export interface BundlerAdapter {
  /**
   * Run a production build.
   */
  build(
    config: ResolvedEvConfig,
    cwd: string,
    hooks: EvPluginHooks[],
  ): Promise<void>;

  /**
   * Start a development server.
   *
   * @param callbacks.onServerBundleReady - Called when the server bundle is compiled.
   * The CLI uses this to launch the API server runtime.
   */
  dev(
    config: ResolvedEvConfig,
    cwd: string,
    callbacks: { onServerBundleReady: () => void },
    hooks: EvPluginHooks[],
  ): Promise<void>;
}
