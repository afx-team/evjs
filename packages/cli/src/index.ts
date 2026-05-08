import { utoopackAdapter } from "@evjs/bundler-utoopack";
import {
  type BuildOptions,
  type BundlerAdapter,
  type DevOptions,
  type EvConfig,
  build as frameworkBuild,
  dev as frameworkDev,
} from "@evjs/ev";

export {
  type BuildOptions,
  type BundlerAdapter,
  CONFIG_DEFAULTS,
  type DevOptions,
  defineConfig,
  type EvBuildResult,
  type EvBundlerCtx,
  type EvConfig,
  type EvPlugin,
  type EvPluginContext,
  type EvPluginHooks,
  type ResolvedEvConfig,
  resolveConfig,
} from "@evjs/ev";
export { loadConfig } from "./load-config.js";

const defaultBundler = utoopackAdapter as unknown as BundlerAdapter;

export async function dev(
  userConfig?: EvConfig,
  options?: DevOptions,
): Promise<void> {
  await frameworkDev(userConfig, {
    ...options,
    bundler: options?.bundler ?? userConfig?.bundler ?? defaultBundler,
  });
}

export async function build(
  userConfig?: EvConfig,
  options?: BuildOptions,
): Promise<void> {
  await frameworkBuild(userConfig, {
    ...options,
    bundler: options?.bundler ?? userConfig?.bundler ?? defaultBundler,
  });
}
