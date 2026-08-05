import type {
  AssetGroup,
  BuildPlan,
  BuildPlanUpdate,
} from "@evjs/shared/manifest";
import {
  assertPortableRelativeBrowserArtifactPath,
  assertServerRelativeArtifactPath,
} from "@evjs/shared/manifest";
import type { ResolvedFrameworkConfig } from "../../config/index.js";
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
  /** Assets keyed by the exact server BuildPlan entry name. */
  serverEntryAssets?: Record<string, AssetGroup>;
  loadServerModule?: (asset: string) => Promise<unknown>;
  rscManifests?: {
    clientReferenceManifest?: Record<string, unknown>;
  };
}

const REMOVED_SERVER_FACT_FIELDS = [
  "serverEntry",
  "serverAssets",
  "serverModules",
] as const;

/** Reject removed server-fact aliases before Core silently drops them. */
export function assertBundlerBuildFactsContract(
  facts: BundlerBuildFacts,
): void {
  for (const field of REMOVED_SERVER_FACT_FIELDS) {
    if (!Object.hasOwn(facts, field)) continue;
    throw new Error(
      `[evjs] Bundler build facts.${field} is no longer supported. Return every server entry through serverEntryAssets keyed by its exact BuildPlan name.`,
    );
  }
}

/** Whether Core committed a development facts snapshot to canonical output. */
export type BundlerBuildFactsDisposition = "published" | "discarded";

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
    const assets = getOwn(available, entry.name) ?? soleFallback?.[1];
    if (!assets) {
      const names = rawEntries.map(([name]) => JSON.stringify(name)).join(", ");
      throw new Error(
        `[evjs] ${source} do not identify client BuildPlan entrypoint "${entry.name}" uniquely; found entrypoints ${names || "<none>"}.`,
      );
    }
    defineRecordValue(resolved, entry.name, {
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
    });
  }
  return resolved;
}

/**
 * Resolve server entrypoint facts by exact BuildPlan identity. Unlike client
 * entrypoints, server entries never use an adapter-native sole-entry fallback.
 */
export function resolveBundlerServerEntryAssets(
  plan: BuildPlan,
  available: Record<string, AssetGroup>,
  source: string,
): Record<string, AssetGroup> {
  const planned = plan.entries.filter(
    (entry) => entry.environment === "server",
  );
  const plannedNames = new Set(planned.map((entry) => entry.name));
  const resolved: Record<string, AssetGroup> = {};

  for (const entry of planned) {
    const assets = getOwn(available, entry.name);
    if (!assets) {
      const names = Object.keys(available)
        .map((name) => JSON.stringify(name))
        .join(", ");
      throw new Error(
        `[evjs] ${source} do not identify server BuildPlan entrypoint "${entry.name}" exactly; found entrypoints ${names || "<none>"}.`,
      );
    }
    if (
      typeof assets !== "object" ||
      !Array.isArray(assets.js) ||
      !Array.isArray(assets.css)
    ) {
      throw new Error(
        `[evjs] ${source} entrypoint "${entry.name}" must provide an AssetGroup with JavaScript and CSS arrays.`,
      );
    }
    if (assets.js.length !== 1) {
      throw new Error(
        `[evjs] ${source} entrypoint "${entry.name}" must emit exactly one self-contained JavaScript asset; found ${assets.js.length}.`,
      );
    }
    defineRecordValue(resolved, entry.name, {
      js: assets.js.map((asset, index) =>
        assertServerRelativeArtifactPath(
          asset,
          `${source} entrypoint "${entry.name}" JavaScript asset[${index}]`,
        ),
      ),
      css: assets.css.map((asset, index) =>
        assertServerRelativeArtifactPath(
          asset,
          `${source} entrypoint "${entry.name}" CSS asset[${index}]`,
        ),
      ),
    });
  }

  const unexpected = Object.keys(available).filter(
    (name) => !plannedNames.has(name),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `[evjs] ${source} contain unplanned server entrypoints: ${unexpected
        .map((name) => JSON.stringify(name))
        .join(", ")}.`,
    );
  }

  return resolved;
}

function getOwn<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function defineRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

export interface BundlerBuildContext<TBundlerCfg = unknown> {
  cwd: string;
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  plan: BuildPlan;
  hooks: PluginHooks<TBundlerCfg>[];
  /** Register a plugin-owned dependency with the framework dev watcher. */
  addWatchFile?(file: string): void;
}

/**
 * Opaque identity for one adapter-visible development build generation.
 *
 * Adapters receive these identities from the framework and must return the
 * identity captured by the compile that produced each facts snapshot. This
 * keeps late compile results bound to the config and plan that started them.
 */
declare const bundlerDevGenerationBrand: unique symbol;

export interface BundlerDevGeneration {
  readonly [bundlerDevGenerationBrand]: true;
}

export interface BundlerDevContext<TBundlerCfg = unknown>
  extends BundlerBuildContext<TBundlerCfg> {
  /** Generation owned by the initial dev plan. */
  generation: BundlerDevGeneration;
  callbacks: {
    /**
     * Called after the client development server is listening and framework
     * dev artifacts have been emitted.
     */
    onDevServerReady?: (context: { origin: string }) => void | Promise<void>;
    /**
     * Called by the bundler adapter after a dev compile has fresh build facts,
     * or with previously published facts that remain valid across a proven
     * topology-preserving artifact update.
     * The ev orchestrator owns beforeBuild, framework output linking,
     * transformOutput, manifest emission, and HTML emission. Adapters may
     * acknowledge facts or notify server readiness only after `published`;
     * `discarded` facts were not consumed and must be retried from fresh
     * compiler state.
     */
    onBuildFacts: (
      generation: BundlerDevGeneration,
      facts: BundlerBuildFacts,
      options: { readonly isRebuild: boolean },
    ) => BundlerBuildFactsDisposition | Promise<BundlerBuildFactsDisposition>;
    /** Notify the framework that this generation's server bundle is ready. */
    onServerBundleReady: (
      generation: BundlerDevGeneration,
    ) => void | Promise<void>;
  };
}

export interface BundlerDevUpdateOptions<TBundlerCfg = unknown> {
  /** The resolved config that produced the next plan. */
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  /**
   * True when framework config or a `configureBundler()` dependency changed and
   * the adapter must refresh its effective bundler configuration.
   */
  configChanged: boolean;
  /** The exact transition reserved before Core wrote candidate input. */
  transition: BundlerDevUpdateTransition;
  /** Generation owned by `update.next`. */
  generation: BundlerDevGeneration;
  /**
   * Activate `generation` exactly once at the adapter's serialized plan
   * boundary: after every prior-generation facts callback has completed and
   * before adopting `update.next` or publishing its facts.
   */
  activate(): void;
}

/**
 * Adapter-owned boundary reserved before Core materializes candidate `.ev`
 * inputs. Core explicitly accepts the final input or rolls back only after it
 * has restored the previous generated state. Adapters must drop any compile
 * that could have observed input while this boundary was active, then obtain
 * fresh facts for the selected state. A topology-preserving artifact update
 * may instead relink with the last published facts while the compiler handles
 * its generated-input rebuild independently.
 */
export interface BundlerDevUpdateTransition {
  /** Select the final generated input while keeping the current generation. */
  accept(): void | Promise<void>;
  /** Select the previous generation after Core restored its generated input. */
  rollback(): void | Promise<void>;
  /** Release deferred compiler work after Core opens the selected consumer. */
  resume(): void | Promise<void>;
  /**
   * Complete any fallible settlement work while the adapter boundary remains
   * reserved. A rejection must leave the resumed outcome selectable for
   * rollback.
   */
  prepareFinalize(): void | Promise<void>;
  /**
   * Release the adapter boundary after Core commits the selected output.
   * This operation must be synchronous and must not throw.
   */
  finalize(): void;
}

export interface BundlerDevController<TBundlerCfg = unknown> {
  /** Settles if the adapter-owned dev service terminates independently. */
  done?: Promise<void>;
  close?(): void | Promise<void>;
  /**
   * Establish a fail-closed boundary before candidate generated inputs are
   * written. The returned promise may wait for compiles that started before
   * the boundary to finish; compiles that start after it must not publish
   * facts until the adapter has observed the final accepted input state.
   */
  beginUpdate():
    | BundlerDevUpdateTransition
    | Promise<BundlerDevUpdateTransition>;
  updatePlan(
    update: BuildPlanUpdate,
    options: BundlerDevUpdateOptions<TBundlerCfg>,
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
export interface BundlerAdapter<TBundlerCfg = unknown> {
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
