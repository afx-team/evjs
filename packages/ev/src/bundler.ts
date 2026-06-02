import type {
  AppGraph,
  BuildOutput,
  BuildPlan,
  BuildPlanUpdate,
} from "@evjs/shared/manifest";
import type { PluginHooks, ResolvedConfig } from "./config.js";

export interface BundlerBuildContext<
  TBundlerCfg = import("@utoo/pack").ConfigComplete,
> {
  cwd: string;
  config: ResolvedConfig<TBundlerCfg>;
  graph: AppGraph;
  plan: BuildPlan;
  hooks: PluginHooks<TBundlerCfg>[];
  callbacks: {
    /**
     * Called by the bundler adapter after framework output is linked and
     * before manifest/HTML emission. The output object may be mutated by
     * plugin hooks.
     */
    onBuildOutput: (output: BuildOutput) => void | Promise<void>;
  };
}

export interface BundlerDevContext<
  TBundlerCfg = import("@utoo/pack").ConfigComplete,
> extends BundlerBuildContext<TBundlerCfg> {
  callbacks: {
    /**
     * Called by the bundler adapter after framework output is linked and
     * before manifest/HTML emission. The output object may be mutated by
     * plugin hooks.
     */
    onBuildOutput: (output: BuildOutput) => void | Promise<void>;
    onServerBundleReady: () => void | Promise<void>;
  };
}

export interface BundlerDevController {
  close?(): void | Promise<void>;
  updatePlan(update: BuildPlanUpdate, graph?: AppGraph): void | Promise<void>;
}

/**
 * Interface that all bundler adapters must implement.
 */
export interface BundlerAdapter<
  TBundlerCfg = import("@utoo/pack").ConfigComplete,
> {
  /** Human-readable bundler name (used by plugin helpers for type-narrowing). */
  readonly name: string;

  /**
   * Run a production build.
   */
  build(ctx: BundlerBuildContext<TBundlerCfg>): Promise<void>;

  /**
   * Start a development server.
   *
   * @param callbacks.onServerBundleReady - Called when the server bundle is compiled.
   * The CLI uses this to launch the API server runtime.
   * @returns A dev controller when the adapter can expose explicit lifecycle
   * or dynamic plan update hooks.
   */
  dev(
    ctx: BundlerDevContext<TBundlerCfg>,
  ): Promise<BundlerDevController | undefined>;
}
