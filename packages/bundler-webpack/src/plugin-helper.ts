import type { EvBundlerCtx } from "@evjs/ev";

/**
 * Typed wrapper for webpack configuration in plugin bundler hooks.
 *
 * Use this in your plugin's `bundler` hook to get full `webpack.Configuration`
 * type safety instead of `unknown`.
 *
 * @example
 * ```ts
 * import { webpack } from "@evjs/bundler-webpack";
 *
 * const myPlugin: EvPlugin = {
 *   name: "my-plugin",
 *   setup(ctx) {
 *     return {
 *       bundler: webpack((config) => {
 *         config.module.rules.push({ test: /\.svg$/, use: ["@svgr/webpack"] });
 *       }),
 *     };
 *   },
 * };
 * ```
 */
export function webpack(
  fn: (config: import("webpack").Configuration, ctx: EvBundlerCtx) => void,
): (config: unknown, ctx: EvBundlerCtx) => void {
  return (config, ctx) => {
    if (ctx.config.bundler?.name === "webpack") {
      fn(config as import("webpack").Configuration, ctx);
    }
  };
}
