import { utoopackAdapter } from "@evjs/bundler-utoopack";
import {
  type BuildOptions,
  type BundlerAdapter,
  type Config,
  type DevOptions,
  build as frameworkBuild,
  dev as frameworkDev,
} from "@evjs/ev";

export {
  type BuildOptions,
  type BuildResult,
  type BundlerAdapter,
  type BundlerCtx,
  CONFIG_DEFAULTS,
  type Config,
  type DevOptions,
  defineConfig,
  type Plugin,
  type PluginContext,
  type PluginHooks,
  type ResolvedConfig,
  resolveConfig,
} from "@evjs/ev";
export { loadConfig } from "./load-config.js";

const defaultBundler = utoopackAdapter as unknown as BundlerAdapter;

export async function dev(
  userConfig?: Config,
  options?: DevOptions,
): Promise<void> {
  const { loadConfig } = await import("./load-config.js");
  await frameworkDev(userConfig, {
    ...options,
    bundler: options?.bundler ?? userConfig?.bundler ?? defaultBundler,
    loadConfig: options?.loadConfig ?? loadConfig,
  });
}

export async function build(
  userConfig?: Config,
  options?: BuildOptions,
): Promise<void> {
  await frameworkBuild(userConfig, {
    ...options,
    bundler: options?.bundler ?? userConfig?.bundler ?? defaultBundler,
  });
}
