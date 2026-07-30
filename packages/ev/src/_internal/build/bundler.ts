import type {
  AssetGroup,
  BuildOutputServerModule,
  BuildPlan,
  BuildPlanUpdate,
} from "@evjs/shared/manifest";
import { assertPortableRelativeBrowserArtifactPath } from "@evjs/shared/manifest";
import type {
  DefaultBundlerConfig,
  ResolvedFrameworkConfig,
} from "../../config/index.js";
import type { PluginHooks } from "../../plugin/index.js";

export interface BundlerEmittedFiles {
  client?: readonly string[];
  server?: readonly string[];
}

export interface BundlerBuildFacts {
  /**
   * Complete portable paths emitted under each physical output root when the
   * bundler exposes a reliable inventory. An absent side means unknown, not an
   * empty output.
   */
  emittedFiles?: BundlerEmittedFiles;
  clientEntryAssets?: Record<string, AssetGroup>;
  serverEntryAssets?: Record<string, AssetGroup>;
  serverEntry?: string;
  serverAssets?: AssetGroup;
  serverModules?: BuildOutputServerModule[];
  loadServerModule?: (asset: string) => Promise<unknown>;
  rscManifests?: {
    clientReferenceManifest?: Record<string, unknown>;
  };
}

/**
 * Normalize adapter-native client entrypoint names into the exact BuildPlan
 * names consumed by the linker. A sole raw entrypoint may stand in for a sole
 * planned entry while adapter-native identity remains outside build facts.
 */
export function resolveBundlerClientEntryAssets(
  plan: BuildPlan,
  available: Record<string, AssetGroup>,
  source: string,
): Record<string, AssetGroup> {
  const planned = plan.entries.filter(
    (entry) => entry.environment === "client",
  );
  const rawEntries = Object.entries(available);
  const soleFallback =
    planned.length === 1 && rawEntries.length === 1 ? rawEntries[0] : undefined;
  const resolved: Record<string, AssetGroup> = {};

  for (const entry of planned) {
    const assets = available[entry.name] ?? soleFallback?.[1];
    if (!assets) {
      const names = rawEntries.map(([name]) => JSON.stringify(name)).join(", ");
      throw new Error(
        `[evjs] ${source} do not identify client BuildPlan entrypoint "${entry.name}" uniquely; found entrypoints ${names || "<none>"}.`,
      );
    }
    resolved[entry.name] = {
      js: assets.js.map((asset, index) =>
        assertPortableRelativeBrowserArtifactPath(
          asset,
          `${source} entrypoint "${entry.name}" JavaScript asset[${index}]`,
        ),
      ),
      css: assets.css.map((asset, index) =>
        assertPortableRelativeBrowserArtifactPath(
          asset,
          `${source} entrypoint "${entry.name}" CSS asset[${index}]`,
        ),
      ),
    };
  }
  return resolved;
}

export interface BundlerBuildContext<TBundlerCfg = DefaultBundlerConfig> {
  cwd: string;
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  plan: BuildPlan;
  hooks: PluginHooks<TBundlerCfg>[];
  /** Register a plugin-owned dependency with the framework dev watcher. */
  addWatchFile?(file: string): void;
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
     * manifest emission, and HTML emission. Resolution is the publish commit
     * boundary: adapters must retain that plan if later server activation fails.
     * A false result temporarily rejects facts produced while framework IR is
     * being replaced. No hooks or output ran, so adapters must retain and retry
     * their latest facts after admission resumes; they must not activate a
     * server or mark the rejected cycle emitted.
     */
    onBuildFacts: (
      facts: BundlerBuildFacts,
      options: { isRebuild: boolean },
    ) => false | void | Promise<false> | Promise<void>;
    onServerBundleReady: () => void | Promise<void>;
  };
}

export interface BundlerDevUpdateOptions<TBundlerCfg = DefaultBundlerConfig> {
  /** The resolved config that produced the next plan. */
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  /**
   * True when framework config or a `configureBundler()` dependency changed and
   * the adapter must refresh its effective bundler configuration.
   */
  configChanged: boolean;
}

export interface BundlerDevController<TBundlerCfg = DefaultBundlerConfig> {
  /** Settles if the adapter-owned dev service terminates independently. */
  done?: Promise<void>;
  close?(): void | Promise<void>;
  /**
   * Apply a preflighted plan after its generated IR has been published.
   * Reject updates the adapter cannot coordinate safely. Before rejecting an
   * unpublished update, the adapter must restore its own compiler state; evjs
   * restores only the previous generated IR and framework snapshot.
   */
  updatePlan(
    update: BuildPlanUpdate,
    options?: BundlerDevUpdateOptions<TBundlerCfg>,
  ): void | Promise<void>;
}

/** Whether a plan update carries no observable build or delivery change. */
export function isEmptyBuildPlanUpdate(update: BuildPlanUpdate): boolean {
  return (
    update.entries.added.length === 0 &&
    update.entries.removed.length === 0 &&
    update.entries.changed.length === 0 &&
    update.html.added.length === 0 &&
    update.html.removed.length === 0 &&
    update.html.changed.length === 0 &&
    !update.generatedChanged &&
    !update.resolveChanged &&
    !update.runtimeChanged &&
    !update.deliveryChanged &&
    !update.serverCompilationChanged &&
    !update.serverDocumentsChanged &&
    !update.devRoutingChanged
  );
}

/**
 * Whether persistent compiler and routing topology can stay in place while
 * framework-owned HTML, manifests, or server document shells are refreshed.
 */
export function isArtifactOnlyBuildPlanUpdate(
  update: BuildPlanUpdate,
): boolean {
  return (
    !update.serverCompilationChanged &&
    !update.devRoutingChanged &&
    !update.runtimeChanged &&
    !update.resolveChanged &&
    update.previous.distDir === update.next.distDir &&
    update.previous.output.clientDir === update.next.output.clientDir &&
    update.entries.added.length === 0 &&
    update.entries.removed.length === 0 &&
    update.entries.changed.length === 0 &&
    (update.deliveryChanged ||
      update.generatedChanged ||
      update.serverDocumentsChanged ||
      update.html.added.length > 0 ||
      update.html.removed.length > 0 ||
      update.html.changed.length > 0)
  );
}

/**
 * Whether generated modules or entry facades consumed by a persistent compiler
 * changed. Other generated-plan fields can still change framework-owned
 * manifests or HTML while safely reusing the latest bundler facts.
 */
export function hasGeneratedCompilerInputChanges(
  update: BuildPlanUpdate,
): boolean {
  if (!update.generatedChanged) return false;
  const previous = generatedCompilerInputs(update.previous);
  const next = generatedCompilerInputs(update.next);
  if (!previous || !next) return true;
  return JSON.stringify(previous) !== JSON.stringify(next);
}

function generatedCompilerInputs(plan: BuildPlan):
  | {
      modules: NonNullable<BuildPlan["generated"]>["modules"];
      entries: NonNullable<BuildPlan["generated"]>["entries"];
    }
  | undefined {
  const generated = plan.generated;
  if (!generated) return undefined;
  if (generated.entries.some((entry) => !entry.sourceHash)) return undefined;
  return {
    modules: generated.modules,
    entries: generated.entries,
  };
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
    /** Replace the effective framework and bundler configuration in place. */
    configuration: boolean;
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
  ): Promise<BundlerDevController<TBundlerCfg> | undefined>;
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
  options: { configChanged?: boolean } = {},
): BundlerCapabilityGap[] {
  const requirements: Array<{
    capability: BundlerDevCapability;
    required: boolean;
    reason: string;
  }> = [
    {
      capability: "configuration",
      required: options.configChanged === true,
      reason: "framework or plugin bundler configuration changed",
    },
    {
      capability: "html",
      required:
        update.deliveryChanged ||
        update.generatedChanged ||
        update.serverDocumentsChanged ||
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
      required: update.devRoutingChanged,
      reason: "client or server route plans changed",
    },
    {
      capability: "server",
      required:
        update.serverCompilationChanged ||
        update.runtimeChanged ||
        [
          ...update.entries.added,
          ...update.entries.removed,
          ...update.entries.changed,
        ].some((entry) => entry.environment === "server"),
      reason:
        "server compilation inputs, server output, or framework runtime changed",
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
  options?: { configChanged?: boolean },
): void {
  assertNoBundlerCapabilityGaps(
    bundler.name,
    getBundlerDevCapabilityGaps(bundler, update, options),
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
