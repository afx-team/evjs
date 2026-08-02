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
import type { DefaultBundlerConfig } from "./load-config.js";

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
  type ResolvedConfig,
  resolveConfig,
} from "@evjs/ev/config";
export { type DefaultBundlerConfig, loadConfig } from "./load-config.js";

const defaultBundler: BundlerAdapter<DefaultBundlerConfig> = utoopackAdapter;

type ConfigWithBundler<TBundlerCfg> = Config<TBundlerCfg> & {
  readonly bundler: BundlerAdapter<TBundlerCfg>;
};

type DevOptionsWithBundler<TBundlerCfg> = DevOptions<TBundlerCfg> &
  (
    | { readonly bundler: BundlerAdapter<TBundlerCfg> }
    | {
        readonly fallbackBundler: BundlerAdapter<TBundlerCfg>;
      }
  );

type BuildOptionsWithBundler<TBundlerCfg> = BuildOptions<TBundlerCfg> & {
  readonly bundler: BundlerAdapter<TBundlerCfg>;
};

export function dev(
  userConfig?: Config<DefaultBundlerConfig>,
  options?: DevOptions<DefaultBundlerConfig>,
): Promise<void>;
export function dev<TBundlerCfg>(
  userConfig: ConfigWithBundler<TBundlerCfg>,
  options?: DevOptions<TBundlerCfg>,
): Promise<void>;
export function dev<TBundlerCfg>(
  userConfig: Config<TBundlerCfg> | undefined,
  options: DevOptionsWithBundler<TBundlerCfg>,
): Promise<void>;
export async function dev<TBundlerCfg>(
  userConfig?: Config<TBundlerCfg>,
  options?: DevOptions<TBundlerCfg>,
): Promise<void> {
  const { loadConfig } = await import("./load-config.js");
  const defaultLoadConfig = loadConfig<TBundlerCfg>;
  const reloadInitialConfig =
    options?.reloadInitialConfig ?? userConfig === undefined;
  const configLoader =
    options?.loadConfig ??
    (reloadInitialConfig ? defaultLoadConfig : undefined);
  const explicitBundler =
    options?.bundler ?? userConfig?.bundler ?? options?.fallbackBundler;
  if (explicitBundler) {
    await frameworkDev<TBundlerCfg>(userConfig, {
      ...options,
      loadConfig: configLoader,
      reloadInitialConfig,
    });
    return;
  }
  await frameworkDev<DefaultBundlerConfig>(
    userConfig as Config<DefaultBundlerConfig> | undefined,
    {
      ...(options as DevOptions<DefaultBundlerConfig> | undefined),
      fallbackBundler: defaultBundler,
      loadConfig:
        configLoader as DevOptions<DefaultBundlerConfig>["loadConfig"],
      reloadInitialConfig,
    },
  );
}

export function build(
  userConfig?: Config<DefaultBundlerConfig>,
  options?: BuildOptions<DefaultBundlerConfig>,
): Promise<void>;
export function build<TBundlerCfg>(
  userConfig: ConfigWithBundler<TBundlerCfg>,
  options?: BuildOptions<TBundlerCfg>,
): Promise<void>;
export function build<TBundlerCfg>(
  userConfig: Config<TBundlerCfg> | undefined,
  options: BuildOptionsWithBundler<TBundlerCfg>,
): Promise<void>;
export async function build<TBundlerCfg>(
  userConfig?: Config<TBundlerCfg>,
  options?: BuildOptions<TBundlerCfg>,
): Promise<void> {
  const explicitBundler = options?.bundler ?? userConfig?.bundler;
  if (explicitBundler) {
    await frameworkBuild<TBundlerCfg>(userConfig, {
      ...options,
      bundler: explicitBundler,
    });
    return;
  }
  await frameworkBuild<DefaultBundlerConfig>(
    userConfig as Config<DefaultBundlerConfig> | undefined,
    {
      ...(options as BuildOptions<DefaultBundlerConfig> | undefined),
      bundler: defaultBundler,
    },
  );
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
