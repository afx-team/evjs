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
  /** Generation owned by the initial framework plan. */
  planGeneration: number;
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
      options?: { isRebuild?: boolean; planGeneration?: number },
    ) => void | Promise<void>;
    onServerBundleReady: (options?: {
      planGeneration?: number;
    }) => void | Promise<void>;
  };
}

export interface BundlerDevUpdateOptions<TBundlerCfg = DefaultBundlerConfig> {
  /** The resolved config that produced the next plan. */
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  /**
   * True when framework config or a `bundlerConfig()` dependency changed and
   * the adapter must refresh its effective bundler configuration.
   */
  configChanged: boolean;
  /** Generation assigned to the candidate framework plan. */
  planGeneration: number;
  /**
   * Publish staged framework-owned sources after the old compiler/watch has
   * been quarantined and immediately before compiling the candidate plan.
   *
   * This callback is strictly idempotent. A successful updatePlan call must
   * have consumed it; the framework verifies that contract.
   */
  commitFrameworkState(): Promise<void>;
  /**
   * Restore the previous framework-owned sources before recompiling the
   * previous plan after a failed candidate update.
   *
   * This callback is strictly idempotent. If candidate state was committed,
   * an adapter must await this callback and then report fresh previous-plan
   * build facts/server readiness before rejecting updatePlan.
   */
  rollbackFrameworkState(): Promise<void>;
}

export interface BundlerDevController<TBundlerCfg = DefaultBundlerConfig> {
  /** Settles if the adapter-owned dev service terminates independently. */
  done?: Promise<void>;
  close?(): void | Promise<void>;
  updatePlan(
    update: BuildPlanUpdate,
    options?: BundlerDevUpdateOptions<TBundlerCfg>,
  ): void | Promise<void>;
}

const SHA256_HEX = /^[0-9a-f]{64}$/u;

/**
 * Whether server-scoped generated runtime bytes differ between two plans.
 *
 * Generated declaration companions are intentionally excluded: changing only
 * editor-facing types must not restart the API process. Invalid or duplicate
 * runtime metadata fails closed and requires a fresh server compilation.
 */
export function hasServerGeneratedRuntimeChange(
  previous: BuildPlan,
  next: BuildPlan,
): boolean {
  const previousModules = indexServerGeneratedModules(previous);
  const nextModules = indexServerGeneratedModules(next);
  if (!previousModules || !nextModules) return true;
  if (previousModules.size !== nextModules.size) return true;

  for (const [key, fingerprint] of nextModules) {
    const previousFingerprint = previousModules.get(key);
    if (
      !previousFingerprint ||
      previousFingerprint.sourceHash !== fingerprint.sourceHash ||
      previousFingerprint.file !== fingerprint.file ||
      previousFingerprint.specifier !== fingerprint.specifier ||
      previousFingerprint.extension !== fingerprint.extension
    ) {
      return true;
    }
  }
  return false;
}

interface ServerGeneratedRuntimeFingerprint {
  sourceHash: string;
  file: string;
  specifier: string;
  extension: string;
}

function indexServerGeneratedModules(
  plan: BuildPlan,
): Map<string, ServerGeneratedRuntimeFingerprint> | undefined {
  const modules = new Map<string, ServerGeneratedRuntimeFingerprint>();
  for (const generatedModule of plan.generated?.modules ?? []) {
    if (generatedModule.scope.kind !== "server") continue;
    if (
      typeof generatedModule.key !== "string" ||
      generatedModule.key.length === 0 ||
      typeof generatedModule.sourceHash !== "string" ||
      !SHA256_HEX.test(generatedModule.sourceHash) ||
      typeof generatedModule.file !== "string" ||
      generatedModule.file.length === 0 ||
      typeof generatedModule.specifier !== "string" ||
      generatedModule.specifier.length === 0 ||
      typeof generatedModule.extension !== "string" ||
      generatedModule.extension.length === 0 ||
      modules.has(generatedModule.key)
    ) {
      return undefined;
    }
    modules.set(generatedModule.key, {
      sourceHash: generatedModule.sourceHash,
      file: generatedModule.file,
      specifier: generatedModule.specifier,
      extension: generatedModule.extension,
    });
  }
  return modules;
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
    !hasServerGeneratedRuntimeChange(update.previous, update.next) &&
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
): BundlerCapabilityGap[] {
  const requirements: Array<{
    capability: BundlerDevCapability;
    required: boolean;
    reason: string;
  }> = [
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
        hasServerGeneratedRuntimeChange(update.previous, update.next) ||
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
