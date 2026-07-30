import type { ConfigureBundlerContext, PluginHooks } from "@evjs/ev/plugin";
import type { WebpackConfig } from "./adapter/create-config.js";

/**
 * Typed wrapper for webpack configuration in plugin bundler hooks.
 *
 * Use this when a project intentionally switches from the default Utoopack
 * adapter to the webpack adapter.
 */
export function webpack(
  fn: (
    config: WebpackConfig,
    ctx: ConfigureBundlerContext<WebpackConfig>,
  ) => void | Promise<void>,
): NonNullable<PluginHooks["configureBundler"]> {
  return async (config, ctx) => {
    if (ctx.bundlerName !== "webpack") return;
    await fn(
      config as WebpackConfig,
      ctx as unknown as ConfigureBundlerContext<WebpackConfig>,
    );
  };
}
