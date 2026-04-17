import type { EvBundlerCtx } from "@evjs/ev";

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
 *         config.define = { ...config.define, MY_VAR: '"hello"' };
 *       }),
 *     };
 *   },
 * };
 * ```
 */
export function utoopack(
  fn: (config: Record<string, unknown>, ctx: EvBundlerCtx) => void,
): (config: unknown, ctx: EvBundlerCtx) => void {
  return fn as (config: unknown, ctx: EvBundlerCtx) => void;
}
