import { utoopackAdapter } from "@evjs/bundler-utoopack";
import {
  type BuildOptions,
  type BundlerAdapter,
  type DevOptions,
  build as frameworkBuild,
  dev as frameworkDev,
  type PrepareFrameworkBuildOptions,
  prepareFrameworkBuild,
} from "@evjs/ev/_internal/build";
import type { Config } from "@evjs/ev/config";

export type {
  BuildOptions,
  BundlerAdapter,
  DevOptions,
  PrepareFrameworkBuildOptions,
} from "@evjs/ev/_internal/build";
export {
  CONFIG_DEFAULTS,
  type Config,
  defineConfig,
  type EvConfig,
  type ResolvedConfig,
  type ResolvedEvConfig,
  resolveConfig,
} from "@evjs/ev/config";
export type {
  BuildResult,
  BundlerCtx,
  ClientManifest,
  ContributionContext,
  EmitApi,
  EvBuildResult,
  EvBundlerCtx,
  EvDocument,
  EvPlugin,
  EvPluginConfigContext,
  EvPluginContext,
  EvPluginHooks,
  FrameworkIRView,
  FrameworkSlot,
  FrameworkSlotInput,
  GeneratedModuleRef,
  Plugin,
  PluginContext,
  PluginHooks,
  ServerManifest,
} from "@evjs/ev/plugin";
export { loadConfig } from "./load-config.js";

export type DefaultBundlerConfig =
  typeof utoopackAdapter extends BundlerAdapter<infer TBundlerCfg>
    ? TBundlerCfg
    : never;

const defaultBundler: BundlerAdapter<DefaultBundlerConfig> = utoopackAdapter;

export async function dev<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options?: DevOptions<TBundlerCfg>,
): Promise<void> {
  const { loadConfig } = await import("./load-config.js");
  const defaultLoadConfig = loadConfig<TBundlerCfg>;
  const bundler =
    options?.bundler ??
    userConfig?.bundler ??
    (defaultBundler as unknown as BundlerAdapter<TBundlerCfg>);
  await frameworkDev<TBundlerCfg>(userConfig, {
    ...options,
    bundler,
    loadConfig: options?.loadConfig ?? defaultLoadConfig,
  });
}

export async function build<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options?: BuildOptions<TBundlerCfg>,
): Promise<void> {
  const bundler =
    options?.bundler ??
    userConfig?.bundler ??
    (defaultBundler as unknown as BundlerAdapter<TBundlerCfg>);
  await frameworkBuild<TBundlerCfg>(userConfig, {
    ...options,
    bundler,
  });
}

export async function prepare<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options?: PrepareFrameworkBuildOptions<TBundlerCfg>,
): Promise<void> {
  const prepared = await prepareFrameworkBuild<TBundlerCfg>(
    userConfig,
    options,
  );
  await prepared.dispose();
}
