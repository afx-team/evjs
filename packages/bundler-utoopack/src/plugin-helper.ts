import type { EvBundlerCtx } from "@evjs/ev";
import type { ConfigComplete } from "@utoo/pack";

/**
 * Typed wrapper for utoopack configuration in plugin bundler hooks.
 *
 * Use this in your plugin's `bundler` hook to get type-safe
 * utoopack configuration access.
 *
 * @example
 * ```ts
 * import { utoopack } from "@evjs/bundler-utoopack";
 *
 * const myPlugin: EvPlugin = {
 *   name: "my-plugin",
 *   setup(ctx) {
 *     return {
 *       bundler: utoopack((config) => {
 *         // config is typed as ConfigComplete from @utoo/pack
 *       }),
 *     };
 *   },
 * };
 * ```
 */
export function utoopack(
  fn: (config: ConfigComplete, ctx: EvBundlerCtx) => void,
): (config: unknown, ctx: EvBundlerCtx) => void {
  return (config, ctx) => {
    if (ctx.config.bundler?.name === "utoopack") {
      fn(config as ConfigComplete, ctx);
    }
  };
}
