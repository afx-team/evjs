import type {
  AppGraph,
  AssetGroup,
  BuildOutputServerModule,
  BuildPlan,
  BuildPlanUpdate,
} from "@evjs/shared/manifest";
import type {
  DefaultBundlerConfig,
  PluginHooks,
  ResolvedConfig,
} from "./config.js";

export interface BundlerBuildFacts {
  clientEntryAssets?: Record<string, AssetGroup>;
  firstClientEntryAssets?: AssetGroup;
  serverEntryAssets?: Record<string, AssetGroup>;
  serverEntry?: string;
  serverAssets?: AssetGroup;
  serverModules?: BuildOutputServerModule[];
  rscManifests?: {
    clientReferenceManifest?: Record<string, unknown>;
    serverConsumerManifest?: Record<string, unknown>;
  };
}

export interface BundlerBuildContext<TBundlerCfg = DefaultBundlerConfig> {
  cwd: string;
  config: ResolvedConfig<TBundlerCfg>;
  graph: AppGraph;
  plan: BuildPlan;
  hooks: PluginHooks<TBundlerCfg>[];
}

export interface BundlerDevContext<TBundlerCfg = DefaultBundlerConfig>
  extends BundlerBuildContext<TBundlerCfg> {
  callbacks: {
    /**
     * Called by the bundler adapter after a dev compile has fresh build facts.
     * The ev orchestrator owns framework output linking, plugin output hooks,
     * manifest emission, and HTML emission.
     */
    onBuildFacts: (
      facts: BundlerBuildFacts,
      options?: { isRebuild?: boolean },
    ) => void | Promise<void>;
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
export interface BundlerAdapter<TBundlerCfg = DefaultBundlerConfig> {
  /** Human-readable bundler name (used by plugin helpers for type-narrowing). */
  readonly name: string;

  /**
   * Run a production build.
   */
  build(ctx: BundlerBuildContext<TBundlerCfg>): Promise<BundlerBuildFacts>;

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
