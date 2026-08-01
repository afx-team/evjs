import fs from "node:fs";
import path from "node:path";
import {
  assertBundlerEmittedFiles,
  assertPortableRelativeArtifactPath,
  type BundlerBuildFacts,
  type ResolvedBuildOutputPaths,
  resolveBuildOutputPaths,
  resolveBundlerClientEntryAssets,
  resolveBundlerServerEntryAssets,
} from "@evjs/ev/_internal/build";
import type { AssetGroup, BuildPlan } from "@evjs/shared/manifest";
import {
  assertBuildOutputLinkInputClientAssets,
  assertServerRelativeArtifactPath,
} from "@evjs/shared/manifest";

type UtoopackStatsAsset = string | { name?: string };

interface UtoopackStatsLike {
  assets?: UtoopackStatsAsset[];
  entrypoints?: Record<string, { assets?: UtoopackStatsAsset[] }>;
}

function normalizeAssetName(name: string | undefined): string | undefined {
  return name?.replace(/^\.\//, "");
}

function readStatsAssetName(asset: UtoopackStatsAsset): string | undefined {
  return typeof asset === "string" ? asset : asset.name;
}

function emptyAssets(): AssetGroup {
  return { js: [], css: [] };
}

function dedupeAssets(assets: AssetGroup): AssetGroup {
  return {
    js: [...new Set(assets.js)],
    css: [...new Set(assets.css)],
  };
}

function readEntrypointAssets(
  stats: UtoopackStatsLike,
): Record<string, AssetGroup> {
  const byName: Record<string, AssetGroup> = {};

  for (const [name, entry] of Object.entries(stats.entrypoints ?? {})) {
    const assets = emptyAssets();
    for (const asset of entry.assets ?? []) {
      const assetName = normalizeAssetName(readStatsAssetName(asset));
      if (assetName && isJavaScriptAsset(assetName)) {
        assets.js.push(assetName);
      } else if (assetName?.endsWith(".css")) {
        assets.css.push(assetName);
      }
    }

    defineRecordValue(byName, name, dedupeAssets(assets));
  }

  return byName;
}

export class UtoopackManifestGenerator {
  private outputPaths: ResolvedBuildOutputPaths;
  private plan: BuildPlan;
  private clientEntryAssets: Record<string, AssetGroup> = {};
  private serverEntryAssets: Record<string, AssetGroup> = {};
  private clientEmittedFiles: string[] | undefined;
  private serverEmittedFiles: string[] | undefined;

  constructor(cwd: string, plan: BuildPlan) {
    this.outputPaths = resolveBuildOutputPaths(cwd, plan);
    this.plan = plan;
  }

  async loadClientStats() {
    const statsPath = path.join(this.outputPaths.clientDir, "stats.json");
    if (!fs.existsSync(statsPath)) {
      this.clientEntryAssets = {};
      this.clientEmittedFiles = undefined;
      const clientEntries = this.plan.entries.filter(
        (entry) => entry.environment === "client",
      );
      if (clientEntries.length > 0) {
        throw new Error(
          `[evjs] Utoopack did not emit client stats for BuildPlan ${formatEntryList(clientEntries)} at "${formatStatsPath(this.outputPaths.rootDir, statsPath)}".`,
        );
      }
      return;
    }

    let value: unknown;
    try {
      const statsStr = await fs.promises.readFile(statsPath, "utf-8");
      value = JSON.parse(statsStr);
    } catch (error) {
      throw new Error(
        `[evjs] Failed to read Utoopack client stats at "${formatStatsPath(this.outputPaths.rootDir, statsPath)}".`,
        { cause: error },
      );
    }
    const stats = assertUtoopackStats(
      value,
      `Utoopack client stats at "${formatStatsPath(this.outputPaths.rootDir, statsPath)}"`,
    );
    const byName = readEntrypointAssets(stats);
    this.clientEntryAssets = resolveBundlerClientEntryAssets(
      this.plan,
      byName,
      "Utoopack client stats",
    );
    this.clientEmittedFiles = readEmittedFiles(stats);
  }

  async loadServerStats() {
    this.serverEntryAssets = {};
    this.serverEmittedFiles = undefined;

    const serverEntries = this.plan.entries.filter(
      (entry) => entry.environment === "server",
    );
    if (serverEntries.length === 0) return;

    const statsPath = path.join(this.outputPaths.serverDir, "stats.json");
    if (!fs.existsSync(statsPath)) {
      throw new Error(
        `[evjs] Utoopack did not emit server stats for BuildPlan ${formatEntryList(serverEntries)} at "${formatStatsPath(this.outputPaths.rootDir, statsPath)}". Server entries cannot be inferred safely from arbitrary JavaScript files.`,
      );
    }

    let value: unknown;
    try {
      const statsStr = await fs.promises.readFile(statsPath, "utf-8");
      value = JSON.parse(statsStr);
    } catch (error) {
      throw new Error(
        `[evjs] Failed to read Utoopack server stats for BuildPlan ${formatEntryList(serverEntries)} at "${formatStatsPath(this.outputPaths.rootDir, statsPath)}".`,
        { cause: error },
      );
    }
    const stats = assertUtoopackStats(
      value,
      `Utoopack server stats at "${formatStatsPath(this.outputPaths.rootDir, statsPath)}"`,
    );

    let byName: Record<string, AssetGroup>;
    try {
      byName = readEntrypointAssets(stats);
    } catch (error) {
      throw new Error(
        `[evjs] Utoopack server stats at "${formatStatsPath(this.outputPaths.rootDir, statsPath)}" do not contain readable entrypoint assets.`,
        { cause: error },
      );
    }
    this.serverEntryAssets = resolveBundlerServerEntryAssets(
      this.plan,
      byName,
      "Utoopack server stats",
    );
    assertExactServerJavaScriptInventory(
      stats.assets,
      Object.values(this.serverEntryAssets).flatMap((assets) => assets.js),
    );
    this.serverEmittedFiles = readEmittedFiles(stats);
  }

  async collectBuildFacts(): Promise<BundlerBuildFacts> {
    await this.loadClientStats();
    await this.loadServerStats();
    const emittedFiles = {
      ...(this.clientEmittedFiles
        ? { client: includeAdapterStatsFile(this.clientEmittedFiles) }
        : {}),
      ...(this.serverEmittedFiles
        ? { server: includeAdapterStatsFile(this.serverEmittedFiles) }
        : {}),
    };

    const facts: BundlerBuildFacts = {
      ...(Object.keys(emittedFiles).length > 0 ? { emittedFiles } : {}),
      clientEntryAssets: cloneEntryAssets(this.clientEntryAssets),
      serverEntryAssets: cloneEntryAssets(this.serverEntryAssets),
    };
    assertBundlerEmittedFiles(facts.emittedFiles);
    assertBuildOutputLinkInputClientAssets({
      plan: this.plan,
      clientEntryAssets: facts.clientEntryAssets,
    });
    return facts;
  }

  async build(): Promise<BundlerBuildFacts> {
    return this.collectBuildFacts();
  }

  async watch(onUpdate?: (result: BundlerBuildFacts) => void | Promise<void>) {
    const output = await this.build();
    await onUpdate?.(output);
  }

  async close() {}
}

function formatStatsPath(rootDir: string, statsPath: string): string {
  return path.relative(rootDir, statsPath).split(path.sep).join("/");
}

function formatEntryList(entries: BuildPlan["entries"]): string {
  if (entries.length === 1) return `entry "${entries[0]?.name}"`;
  return `entries ${entries.map((entry) => `"${entry.name}"`).join(", ")}`;
}

function assertUtoopackStats(
  value: unknown,
  source: string,
): UtoopackStatsLike {
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${source} must be an object.`);
  }
  assertStatsAssetList(value.assets, `${source}.assets`);
  if (value.entrypoints !== undefined && !isRecord(value.entrypoints)) {
    throw new Error(`[evjs] ${source}.entrypoints must be an object.`);
  }
  for (const [name, entrypoint] of Object.entries(value.entrypoints ?? {})) {
    if (!isRecord(entrypoint)) {
      throw new Error(
        `[evjs] ${source}.entrypoints.${name} must be an object.`,
      );
    }
    assertStatsAssetList(
      entrypoint.assets,
      `${source}.entrypoints.${name}.assets`,
    );
  }
  return value as UtoopackStatsLike;
}

function assertStatsAssetList(value: unknown, source: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.every(isStatsAsset)) {
    throw new Error(
      `[evjs] ${source} must be an array of asset names or asset records.`,
    );
  }
}

function isStatsAsset(value: unknown): value is UtoopackStatsAsset {
  return (
    typeof value === "string" ||
    (isRecord(value) &&
      (value.name === undefined || typeof value.name === "string"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readEmittedFiles(stats: {
  assets?: UtoopackStatsAsset[];
}): string[] | undefined {
  if (!stats.assets) return undefined;

  const files: string[] = [];
  const seen = new Set<string>();
  for (const asset of stats.assets) {
    const rawName = readStatsAssetName(asset);
    const name = assertPortableRelativeArtifactPath(
      normalizeAssetName(rawName),
      `Utoopack emitted asset ${JSON.stringify(rawName)}`,
    );
    if (seen.has(name)) continue;
    seen.add(name);
    files.push(name);
  }
  return files;
}

function includeAdapterStatsFile(files: string[]): string[] {
  return files.includes("stats.json") ? [...files] : [...files, "stats.json"];
}

function cloneEntryAssets(
  entries: Record<string, AssetGroup>,
): Record<string, AssetGroup> {
  return Object.fromEntries(
    Object.entries(entries).map(([name, assets]) => [
      name,
      { js: [...assets.js], css: [...assets.css] },
    ]),
  );
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

function assertExactServerJavaScriptInventory(
  assets: UtoopackStatsAsset[] | undefined,
  ownedJavaScript: readonly string[],
): void {
  if (assets === undefined) {
    if (ownedJavaScript.length === 0) return;
    throw new Error(
      `[evjs] Utoopack server stats must provide a complete emitted asset inventory for ${ownedJavaScript.length} server entry asset(s).`,
    );
  }
  const emittedJavaScript = new Set<string>();
  for (const asset of assets) {
    const rawName = readStatsAssetName(asset);
    const name = normalizeAssetName(rawName);
    if (!name || !isJavaScriptAsset(name)) continue;
    emittedJavaScript.add(
      assertServerRelativeArtifactPath(
        name,
        `Utoopack server stats JavaScript asset ${JSON.stringify(rawName)}`,
      ),
    );
  }
  const owned = new Set(ownedJavaScript);
  for (const asset of owned) {
    if (emittedJavaScript.has(asset)) continue;
    throw new Error(
      `[evjs] Utoopack server stats are missing exact server entry JavaScript asset "${asset}" from the complete emitted inventory.`,
    );
  }
  for (const asset of emittedJavaScript) {
    if (owned.has(asset)) continue;
    throw new Error(
      `[evjs] Utoopack server stats emitted unowned JavaScript asset "${asset}". Every server entry must be self-contained in its exact entry asset.`,
    );
  }
}

function isJavaScriptAsset(name: string): boolean {
  return /\.(?:cjs|mjs|js)$/.test(name);
}
