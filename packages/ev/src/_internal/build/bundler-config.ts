import type { ResolvedConfig } from "../../config/index.js";
import { resolveBundlerConfig } from "../../config/index.js";
import type { BundlerAdapter } from "./bundler.js";

export function resolveBundler<TBundlerCfg>(
  configBundler: BundlerAdapter<TBundlerCfg> | undefined,
  optionBundler: BundlerAdapter<TBundlerCfg> | undefined,
): BundlerAdapter<TBundlerCfg> {
  const bundler =
    optionBundler === undefined
      ? configBundler
      : resolveBundlerConfig<TBundlerCfg>(optionBundler, "options.bundler");
  if (!bundler) {
    throw new Error(
      "[evjs] No bundler configured. Pass a bundler adapter in ev.config.ts or through dev/build options.",
    );
  }
  return bundler;
}

export function withActiveBundler<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  bundler: BundlerAdapter<TBundlerCfg>,
): ResolvedConfig<TBundlerCfg> {
  if (config.bundler === bundler) {
    return config;
  }

  return {
    ...config,
    bundler,
  };
}
