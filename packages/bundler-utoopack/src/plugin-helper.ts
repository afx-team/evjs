import type { EvBundlerCtx } from "@evjs/ev";
import type { ConfigComplete } from "@utoo/pack";

/**
 * Typed wrapper for utoopack configuration in plugin bundler hooks.
 *
 * Use this in your plugin's `bundlerConfig` hook to get full `ConfigComplete`
 * type safety instead of `unknown`.
 *
 * @example
 * ```ts
 * import { utoopack } from "@evjs/bundler-utoopack";
 *
 * const myPlugin: EvPlugin = {
 *   name: "my-plugin",
 *   setup(ctx) {
 *     return {
 *       bundlerConfig: utoopack((config) => {
 *         // config is typed as ConfigComplete from @utoo/pack
 *       }),
 *     };
 *   },
 * };
 * ```
 */
export function utoopack(
  fn: (config: ConfigComplete, ctx: EvBundlerCtx<ConfigComplete>) => void,
): (config: ConfigComplete, ctx: EvBundlerCtx<ConfigComplete>) => void {
  return (config, ctx) => {
    if (ctx.config.bundler?.name === "utoopack") {
      fn(config as ConfigComplete, ctx);
    }
  };
}
