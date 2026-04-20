import type { EvBundlerCtx } from "@evjs/ev";

/**
 * Typed wrapper for webpack configuration in plugin bundler hooks.
 *
 * Use this in your plugin's `bundlerConfig` hook to get full `webpack.Configuration`
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
 *       bundlerConfig: webpack((config) => {
 *         config.module.rules.push({ test: /\.svg$/, use: ["@svgr/webpack"] });
 *       }),
 *     };
 *   },
 * };
 * ```
 */
export function webpack<T = unknown>(
  fn: (
    config: import("webpack").Configuration,
    ctx: EvBundlerCtx<import("webpack").Configuration>,
  ) => void,
): (config: T, ctx: EvBundlerCtx<T>) => void {
  return (config, ctx) => {
    if (ctx.config.bundler?.name === "webpack") {
      fn(
        config as unknown as import("webpack").Configuration,
        ctx as unknown as EvBundlerCtx<import("webpack").Configuration>,
      );
    }
  };
}
