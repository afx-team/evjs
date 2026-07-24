import type {
  AssetGroup,
  BuildOutputServerModule,
  BuildPlan,
  BuildPlanUpdate,
} from "@evjs/shared/manifest";
import type {
  DefaultBundlerConfig,
  ResolvedConfig,
} from "../../config/index.js";
import type { PluginHooks } from "../../plugin/index.js";

export interface BundlerBuildFacts {
  clientEntryAssets?: Record<string, AssetGroup>;
  firstClientEntryAssets?: AssetGroup;
  serverEntryAssets?: Record<string, AssetGroup>;
  serverEntry?: string;
  serverAssets?: AssetGroup;
  serverModules?: BuildOutputServerModule[];
  loadServerModule?: (asset: string) => Promise<unknown>;
  rscManifests?: {
    clientReferenceManifest?: Record<string, unknown>;
  };
}

export interface BundlerBuildContext<TBundlerCfg = DefaultBundlerConfig> {
  cwd: string;
  config: ResolvedConfig<TBundlerCfg>;
  plan: BuildPlan;
  hooks: PluginHooks<TBundlerCfg>[];
}

export interface BundlerDevContext<TBundlerCfg = DefaultBundlerConfig>
  extends BundlerBuildContext<TBundlerCfg> {
  callbacks: {
    /**
     * Called after the client development server is listening and framework
     * dev artifacts have been emitted.
     */
    onDevServerReady?: (context: { origin: string }) => void | Promise<void>;
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
  updatePlan(update: BuildPlanUpdate): void | Promise<void>;
}

export interface BundlerCapabilities {
  build: {
    /** Build conventional server-rendered Page entries. */
    server: boolean;
    /** Build React Server Component Page entries and manifests. */
    rsc: boolean;
    /** Build partial-prerender shell and region entries. */
    ppr: boolean;
  };
  dev: {
    /** Relink generated framework artifacts and HTML without restarting. */
    html: boolean;
    /** Add, remove, or replace bundler entries without restarting. */
    entries: boolean;
    /** Apply client/server route-plan changes without restarting. */
    routes: boolean;
    /** Reconfigure server output without restarting. */
    server: boolean;
    /** Reconfigure aliases or externals without restarting. */
    resolution: boolean;
  };
}

export type BundlerBuildCapability = keyof BundlerCapabilities["build"];
export type BundlerDevCapability = keyof BundlerCapabilities["dev"];
export type BundlerCapability =
  | `build.${BundlerBuildCapability}`
  | `dev.${BundlerDevCapability}`;

export interface BundlerCapabilityGap {
  capability: BundlerCapability;
  reason: string;
}

/**
 * Interface that all bundler adapters must implement.
 */
export interface BundlerAdapter<TBundlerCfg = DefaultBundlerConfig> {
  /** Human-readable bundler name (used by plugin helpers for type-narrowing). */
  readonly name: string;
  /** Stable framework capabilities used for plan preflight. */
  readonly capabilities: BundlerCapabilities;

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

export function getBundlerBuildCapabilityGaps(
  bundler: Pick<BundlerAdapter, "capabilities">,
  plan: BuildPlan,
): BundlerCapabilityGap[] {
  const requiredEntries: Partial<
    Record<BundlerBuildCapability, BuildPlan["entries"]>
  > = {
    // `build.server` means server-rendered Page support. A bundler may still
    // support the single framework server-runtime entry used by server
    // functions and file routes without supporting page render entries.
    server: plan.entries.filter((entry) => entry.kind === "page-server"),
    rsc: plan.entries.filter((entry) => entry.kind === "rsc-page"),
    ppr: plan.entries.filter(
      (entry) => entry.kind === "ppr-shell" || entry.kind === "ppr-region",
    ),
  };

  return (Object.keys(requiredEntries) as BundlerBuildCapability[]).flatMap(
    (capability) => {
      const entries = requiredEntries[capability] ?? [];
      if (entries.length === 0 || bundler.capabilities.build[capability]) {
        return [];
      }
      return [
        {
          capability: `build.${capability}` as const,
          reason: `required by ${formatBuildEntryList(entries)}`,
        },
      ];
    },
  );
}

export function getBundlerDevCapabilityGaps(
  bundler: Pick<BundlerAdapter, "capabilities">,
  update: BuildPlanUpdate,
): BundlerCapabilityGap[] {
  const requirements: Array<{
    capability: BundlerDevCapability;
    required: boolean;
    reason: string;
  }> = [
    {
      capability: "html",
      required:
        update.generatedChanged ||
        update.html.added.length > 0 ||
        update.html.removed.length > 0 ||
        update.html.changed.length > 0,
      reason: "generated framework artifacts or HTML changed",
    },
    {
      capability: "entries",
      required:
        update.entries.added.length > 0 ||
        update.entries.removed.length > 0 ||
        update.entries.changed.length > 0 ||
        update.previous.output.clientDir !== update.next.output.clientDir,
      reason: "bundler entries or client output changed",
    },
    {
      capability: "routes",
      required: !sameJson(update.previous.dev, update.next.dev),
      reason: "client or server route plans changed",
    },
    {
      capability: "server",
      required:
        update.serverChanged ||
        update.previous.output.serverDir !== update.next.output.serverDir ||
        !sameJson(update.previous.server, update.next.server) ||
        !sameJson(update.previous.rsc, update.next.rsc) ||
        [
          ...update.entries.added,
          ...update.entries.removed,
          ...update.entries.changed,
        ].some((entry) => entry.environment === "server"),
      reason: "server entries, renderers, output, or RSC inputs changed",
    },
    {
      capability: "resolution",
      required: update.resolveChanged,
      reason: "module aliases or externals changed",
    },
  ];

  return requirements.flatMap(({ capability, required, reason }) =>
    required && !bundler.capabilities.dev[capability]
      ? [{ capability: `dev.${capability}` as const, reason }]
      : [],
  );
}

export function preflightBundlerBuild(
  bundler: Pick<BundlerAdapter, "name" | "capabilities">,
  plan: BuildPlan,
): void {
  assertNoBundlerCapabilityGaps(
    bundler.name,
    getBundlerBuildCapabilityGaps(bundler, plan),
  );
}

export function preflightBundlerDevUpdate(
  bundler: Pick<BundlerAdapter, "name" | "capabilities">,
  update: BuildPlanUpdate,
): void {
  assertNoBundlerCapabilityGaps(
    bundler.name,
    getBundlerDevCapabilityGaps(bundler, update),
  );
}

function assertNoBundlerCapabilityGaps(
  name: string,
  gaps: BundlerCapabilityGap[],
): void {
  if (gaps.length === 0) return;
  throw new Error(
    `[evjs] Bundler "${name}" does not support the capabilities required by this framework plan: ${gaps
      .map((gap) => `${gap.capability} (${gap.reason})`)
      .join("; ")}.`,
  );
}

function formatBuildEntryList(entries: BuildPlan["entries"]): string {
  return entries
    .map((entry) => {
      const owners = [
        entry.owner?.appId ? `app "${entry.owner.appId}"` : undefined,
        entry.owner?.pageId ? `page "${entry.owner.pageId}"` : undefined,
        entry.owner?.routeId ? `route "${entry.owner.routeId}"` : undefined,
        entry.owner?.regionId ? `region "${entry.owner.regionId}"` : undefined,
      ].filter((owner): owner is string => Boolean(owner));
      return `"${entry.name}" (${entry.kind}${owners.length > 0 ? `, ${owners.join(", ")}` : ""})`;
    })
    .join(", ");
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
