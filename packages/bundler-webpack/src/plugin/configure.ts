import type { ConfigureBundlerContext, PluginHooks } from "@evjs/ev/plugin";
import type { WebpackConfigs } from "../adapter/config/create-config.js";

/**
 * Typed wrapper for webpack configurations in plugin bundler hooks.
 *
 * Use this when a project intentionally switches from the default Utoopack
 * adapter to the webpack adapter.
 */
export function webpack(
  fn: (
    configs: WebpackConfigs,
    ctx: ConfigureBundlerContext<WebpackConfigs>,
  ) => void | Promise<void>,
): NonNullable<PluginHooks["configureBundler"]> {
  return async (configs, ctx) => {
    if (ctx.bundlerName !== "webpack") return;
    await fn(
      configs as WebpackConfigs,
      ctx as unknown as ConfigureBundlerContext<WebpackConfigs>,
    );
  };
}
