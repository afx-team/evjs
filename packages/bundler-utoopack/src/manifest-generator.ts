import fs from "node:fs";
import path from "node:path";
import {
  assertBundlerEmittedFiles,
  assertPortableRelativeArtifactPath,
  type BundlerBuildFacts,
  type ResolvedBuildOutputPaths,
  resolveBuildOutputPaths,
  resolveBundlerClientEntryAssets,
} from "@evjs/ev/_internal/build";
import type {
  AssetGroup,
  BuildOutputServerModule,
  BuildPlan,
} from "@evjs/shared/manifest";
import { assertBuildOutputLinkInputClientAssets } from "@evjs/shared/manifest";

const EMPTY_ASSETS: AssetGroup = { js: [], css: [] };

interface UtoopackStatsModule {
  name?: string;
  id?: string | number;
  chunks?: Array<string | number>;
}

type UtoopackStatsAsset = string | { name?: string };

interface UtoopackStatsLike {
  assets?: UtoopackStatsAsset[];
  entrypoints?: Record<string, { assets?: UtoopackStatsAsset[] }>;
  modules?: UtoopackStatsModule[];
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

function normalizeModuleId(
  value: string | number | undefined,
): string | undefined {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/^\[project\]\//, "")
    .replace(/^\.\//, "")
    .replace(/\s+\[(?:server|client)\]\s+\(.+\)$/, "");
}

function assetsFromChunks(
  chunks: Array<string | number> | undefined,
  fallback: AssetGroup,
): AssetGroup {
  const assets = emptyAssets();

  for (const chunk of chunks ?? []) {
    if (typeof chunk !== "string") continue;
    const name = normalizeAssetName(chunk);
    if (name?.endsWith(".js")) {
      assets.js.push(name);
    } else if (name?.endsWith(".css")) {
      assets.css.push(name);
    }
  }

  const deduped = dedupeAssets(assets);
  if (deduped.js.length > 0 || deduped.css.length > 0) {
    return deduped;
  }
  return fallback;
}

function readEntrypointAssets(
  stats: UtoopackStatsLike,
): Record<string, AssetGroup> {
  const byName: Record<string, AssetGroup> = {};

  for (const [name, entry] of Object.entries(stats.entrypoints ?? {})) {
    const assets = emptyAssets();
    for (const asset of entry.assets ?? []) {
      const assetName = normalizeAssetName(readStatsAssetName(asset));
      if (assetName?.endsWith(".js")) {
        assets.js.push(assetName);
      } else if (assetName?.endsWith(".css")) {
        assets.css.push(assetName);
      }
    }

    byName[name] = dedupeAssets(assets);
  }

  return byName;
}

function collectServerModules(
  modules: UtoopackStatsModule[] | undefined,
  fallbackAssets: AssetGroup,
): BuildOutputServerModule[] {
  const result: BuildOutputServerModule[] = [];

  for (const mod of modules ?? []) {
    const moduleId = normalizeModuleId(mod.id) ?? normalizeModuleId(mod.name);
    if (!moduleId) continue;

    result.push({
      moduleId,
      assets: assetsFromChunks(mod.chunks, fallbackAssets),
    });
  }

  return result;
}

export class UtoopackManifestGenerator {
  private outputPaths: ResolvedBuildOutputPaths;
  private plan: BuildPlan;
  private clientEntryAssets: Record<string, AssetGroup> = {};
  private serverEntryAssets: Record<string, AssetGroup> = {};
  private clientEmittedFiles: string[] | undefined;
  private serverEntry: string | undefined;
  private serverAssets: AssetGroup = EMPTY_ASSETS;
  private serverEmittedFiles: string[] | undefined;
  private serverModules: BuildOutputServerModule[] = [];

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
    this.serverEntry = undefined;
    this.serverEntryAssets = {};
    this.serverAssets = EMPTY_ASSETS;
    this.serverEmittedFiles = undefined;
    this.serverModules = [];

    const serverRuntimeEntry = this.plan.entries.find(
      (entry) => entry.kind === "server-runtime",
    );
    if (!serverRuntimeEntry) return;

    const statsPath = path.join(this.outputPaths.serverDir, "stats.json");
    if (!fs.existsSync(statsPath)) {
      throw new Error(
        `[evjs] Utoopack did not emit server stats for BuildPlan entry "${serverRuntimeEntry.name}" at "${formatStatsPath(this.outputPaths.rootDir, statsPath)}". The server entry cannot be inferred safely from arbitrary JavaScript files.`,
      );
    }

    let value: unknown;
    try {
      const statsStr = await fs.promises.readFile(statsPath, "utf-8");
      value = JSON.parse(statsStr);
    } catch (error) {
      throw new Error(
        `[evjs] Failed to read Utoopack server stats for BuildPlan entry "${serverRuntimeEntry.name}" at "${formatStatsPath(this.outputPaths.rootDir, statsPath)}".`,
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
    this.serverEntryAssets = byName;
    const selectedEntrypoint = selectServerEntrypoint(
      byName,
      serverRuntimeEntry.name,
    );
    const entryAssets = selectedEntrypoint.assets;
    const serverEntry = selectServerJavaScriptAsset(
      selectedEntrypoint.name,
      serverRuntimeEntry.name,
      entryAssets,
    );

    this.serverAssets = entryAssets;
    this.serverEntry = serverEntry;
    this.serverEmittedFiles = readEmittedFiles(stats);
    this.serverModules = collectServerModules(stats.modules, this.serverAssets);
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
      clientEntryAssets: this.clientEntryAssets,
      serverEntryAssets: this.serverEntryAssets,
      serverEntry: this.serverEntry,
      serverAssets: this.serverAssets,
      serverModules: this.serverModules,
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
  if (value.modules !== undefined && !Array.isArray(value.modules)) {
    throw new Error(`[evjs] ${source}.modules must be an array.`);
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

function selectServerEntrypoint(
  byName: Record<string, AssetGroup>,
  expectedName: string,
): { name: string; assets: AssetGroup } {
  const exact = byName[expectedName];
  if (exact) return { name: expectedName, assets: exact };

  const entries = Object.entries(byName);
  if (entries.length === 1) {
    const [entry] = entries;
    if (entry) return { name: entry[0], assets: entry[1] };
  }
  throw new Error(
    `[evjs] Utoopack server stats do not identify BuildPlan entrypoint "${expectedName}" uniquely; found entrypoints ${entries.length > 0 ? entries.map(([name]) => JSON.stringify(name)).join(", ") : "<none>"}.`,
  );
}

function selectServerJavaScriptAsset(
  statsEntryName: string,
  _expectedName: string,
  assets: AssetGroup,
): string {
  if (assets.js.length === 1) return assets.js[0] as string;
  throw new Error(
    `[evjs] Utoopack server entrypoint "${statsEntryName}" must emit exactly one self-contained JavaScript entry asset; found ${assets.js.length}.`,
  );
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
  return files.includes("stats.json") ? files : [...files, "stats.json"];
}
