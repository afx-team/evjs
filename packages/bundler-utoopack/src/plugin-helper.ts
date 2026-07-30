import { merge } from "@evjs/ev/config";
import type { BundlerCtx, PluginHooks } from "@evjs/ev/plugin";
import type { ConfigComplete } from "@utoo/pack";

export type { ConfigPatch } from "@evjs/ev/config";

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
 * const myPlugin: Plugin = {
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
  fn: (
    config: ConfigComplete,
    ctx: BundlerCtx<ConfigComplete>,
  ) => void | Promise<void>,
): NonNullable<PluginHooks["bundlerConfig"]> {
  return async (config, ctx) => {
    if (ctx.bundlerName !== "utoopack") return;
    await fn(
      config as ConfigComplete,
      ctx as unknown as BundlerCtx<ConfigComplete>,
    );
  };
}
export { merge };
