import type { AssetGroup, BuildPlan } from "@evjs/shared/manifest";
import {
  assertPortableRelativeBrowserArtifactPath,
  assertServerRelativeArtifactPath,
} from "@evjs/shared/manifest";
import type { ResolvedFrameworkConfig } from "../../config/index.js";
import type { ClientDevMiddleware, PluginHooks } from "../../plugin/index.js";

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

export interface BundlerDevContext<TBundlerCfg = unknown>
  extends BundlerBuildContext<TBundlerCfg> {
  /** Aborted when the immutable framework development session is closing. */
  signal: AbortSignal;
  /** Plugin middleware, already flattened in stable plugin order. */
  clientMiddlewares?: readonly ClientDevMiddleware[];
  callbacks: {
    /**
     * Called by the bundler adapter after a dev compile has fresh build facts,
     * with `isRebuild: false` for the first successfully published compile in
     * this immutable session and `true` for later successful compiles.
     * The ev orchestrator owns beforeBuild, framework output linking,
     * transformOutput, manifest emission, and HTML emission. `discarded`
     * means that the owning session closed before the snapshot was consumed.
     */
    onBuildFacts: (
      facts: BundlerBuildFacts,
      options: { readonly isRebuild: boolean },
    ) => Promise<BundlerBuildFactsDisposition>;
    /** Notify the framework that this session's server bundle is ready. */
    onServerBundleReady: () => Promise<void>;
  };
}

export interface BundlerDevController {
  /** The actual client development origin. */
  readonly origin: string;
  /** Resolves after an intentional close and rejects on unexpected shutdown. */
  readonly done: Promise<void>;
  /** Stop all adapter-owned development resources. Must be idempotent. */
  close(): Promise<void>;
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
  dev?: {
    /** Mount Node middleware before the adapter's client HTML fallback. */
    clientMiddleware: boolean;
  };
}

export type BundlerBuildCapability = keyof BundlerCapabilities["build"];
export type BundlerCapability =
  | `build.${BundlerBuildCapability}`
  | "dev.clientMiddleware";

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
   * Resolves after compiler watches are installed and the development server
   * is listening. It does not wait for the first successful application
   * compile or framework build facts.
   */
  dev(ctx: BundlerDevContext<TBundlerCfg>): Promise<BundlerDevController>;
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

export function preflightBundlerBuild(
  bundler: Pick<BundlerAdapter, "name" | "capabilities">,
  plan: BuildPlan,
): void {
  assertNoBundlerCapabilityGaps(
    bundler.name,
    getBundlerBuildCapabilityGaps(bundler, plan),
  );
}

export function preflightBundlerDev(
  bundler: Pick<BundlerAdapter, "name" | "capabilities">,
  options: { clientMiddleware: boolean },
): void {
  if (!options.clientMiddleware || bundler.capabilities.dev?.clientMiddleware) {
    return;
  }
  assertNoBundlerCapabilityGaps(bundler.name, [
    {
      capability: "dev.clientMiddleware",
      reason: "required by one or more plugin clientDevMiddleware hooks",
    },
  ]);
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
