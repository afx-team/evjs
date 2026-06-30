import type { BundlerCtx, PluginHooks } from "@evjs/ev/plugin";
import type { WebpackConfig } from "./adapter/create-config.js";

type WebpackBundlerConfigHook = NonNullable<
  PluginHooks<WebpackConfig>["bundlerConfig"]
>;

/**
 * Typed wrapper for webpack configuration in plugin bundler hooks.
 *
 * Use this when a project intentionally switches from the default Utoopack
 * adapter to the webpack adapter.
 */
export function webpack(
  fn: (
    config: WebpackConfig,
    ctx: BundlerCtx<WebpackConfig>,
  ) => void | Promise<void>,
): WebpackBundlerConfigHook {
  return async (config, ctx) => {
    if (ctx.bundlerName === "webpack") {
      await fn(config, ctx);
    }
  };
}
