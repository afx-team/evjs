import fs from "node:fs";
import path from "node:path";
import {
  assertBundlerEmittedFiles,
  assertPortableRelativeArtifactPath,
  assertPortableRelativeBrowserArtifactPath,
  type BundlerBuildFacts,
  portableArtifactPathsConflict,
  resolveBuildOutputPaths,
  resolveBundlerClientEntryAssets,
  resolveBundlerServerEntryAssets,
} from "@evjs/ev/_internal/build";
import type { AssetGroup, BuildPlan } from "@evjs/shared/manifest";
import {
  assertBuildOutputLinkInputClientAssets,
  assertServerRelativeArtifactPath,
} from "@evjs/shared/manifest";

export interface WebpackStatsAsset {
  info?: {
    hotModuleReplacement?: boolean;
  };
  name?: string;
}

export interface WebpackStatsEntrypoint {
  assets?: Array<string | WebpackStatsAsset>;
}

export interface WebpackStatsLike {
  assets?: Array<string | WebpackStatsAsset>;
  /** Assets emitted only by the isolated build-phase server compiler. */
  buildOnlyAssets?: Array<string | WebpackStatsAsset>;
  entrypoints?: Record<string, WebpackStatsEntrypoint>;
}

export class WebpackManifestGenerator {
  private clientEntryAssets: Record<string, AssetGroup> = {};
  private serverEntryAssets: Record<string, AssetGroup> = {};

  constructor(
    private cwd: string,
    private plan: BuildPlan,
    private clientStats?: WebpackStatsLike,
    private serverStats?: WebpackStatsLike,
    private copiedServerPublicFiles: readonly string[] = readServerPublicAssetFiles(
      serverStats,
    ),
  ) {}

  collectBuildFacts(): BundlerBuildFacts {
    const outputPaths = resolveBuildOutputPaths(this.cwd, this.plan);
    const excludedClientAssets =
      this.plan.mode === "development"
        ? readWebpackHotUpdateAssetNames(this.clientStats)
        : undefined;
    const clientEntrypoints = readEntrypointAssets(this.clientStats, {
      excludedJavaScriptAssets: excludedClientAssets,
    });
    this.clientEntryAssets = resolveBundlerClientEntryAssets(
      this.plan,
      clientEntrypoints,
      "Webpack client stats",
    );
    assertBuildOutputLinkInputClientAssets({
      plan: this.plan,
      clientEntryAssets: this.clientEntryAssets,
    });

    this.serverEntryAssets = resolveBundlerServerEntryAssets(
      this.plan,
      readEntrypointAssets(this.serverStats),
      "Webpack server stats",
    );
    assertSelfContainedWebpackServerEntries(
      this.plan,
      this.serverEntryAssets,
      this.serverStats,
    );
    const hasPhysicalServerOutput = this.plan.entries.some(
      (entry) => entry.environment === "server" && entry.phase !== "build",
    );
    const clientBundlerFiles = readWebpackEmittedFiles(this.clientStats);
    const copiedServerPublicFiles = [...this.copiedServerPublicFiles];
    const clientEmittedFiles =
      clientBundlerFiles || copiedServerPublicFiles.length > 0
        ? mergePortableFiles(clientBundlerFiles ?? [], copiedServerPublicFiles)
        : undefined;
    const serverEmittedFiles = hasPhysicalServerOutput
      ? readWebpackEmittedFiles(this.serverStats)
      : undefined;
    const emittedFiles = {
      ...(clientEmittedFiles
        ? {
            client: clientBundlerFiles
              ? includeAdapterStatsFile(clientEmittedFiles)
              : clientEmittedFiles,
          }
        : {}),
      ...(serverEmittedFiles
        ? { server: includeAdapterStatsFile(serverEmittedFiles) }
        : {}),
    };

    const facts: BundlerBuildFacts = {
      ...(Object.keys(emittedFiles).length > 0 ? { emittedFiles } : {}),
      clientEntryAssets: cloneEntryAssets(this.clientEntryAssets),
      serverEntryAssets: cloneEntryAssets(this.serverEntryAssets),
      rscManifests: readRscManifests(outputPaths.clientDir),
    };
    assertBundlerEmittedFiles(facts.emittedFiles);
    return facts;
  }
}

export function readWebpackEmittedFiles(
  stats: WebpackStatsLike | undefined,
): string[] | undefined {
  if (!stats?.assets) return undefined;

  const files: string[] = [];
  const seen = new Set<string>();
  for (const asset of stats.assets) {
    const rawName = typeof asset === "string" ? asset : asset.name;
    if (rawName === undefined) continue;
    const name = assertPortableRelativeArtifactPath(
      normalizeAssetName(rawName),
      `Webpack emitted asset ${JSON.stringify(rawName)}`,
    );
    if (seen.has(name)) continue;
    seen.add(name);
    files.push(name);
  }
  return files;
}

export function readServerPublicAssetFiles(
  stats: WebpackStatsLike | undefined,
): string[] {
  return readServerNonExecutableAssetFiles(stats).filter((name) =>
    name.endsWith(".css"),
  );
}

export function readServerNonExecutableAssetFiles(
  stats: WebpackStatsLike | undefined,
): string[] {
  const files: string[] = [];
  for (const entrypoint of Object.values(stats?.entrypoints ?? {})) {
    for (const asset of entrypoint.assets ?? []) {
      const rawName = typeof asset === "string" ? asset : asset.name;
      const name = normalizeAssetName(rawName);
      if (!name?.endsWith(".css")) continue;
      files.push(
        assertPortableRelativeBrowserArtifactPath(
          name,
          `Webpack emitted server CSS asset ${JSON.stringify(rawName)}`,
        ),
      );
    }
  }
  for (const asset of [
    ...(stats?.assets ?? []),
    ...(stats?.buildOnlyAssets ?? []),
  ]) {
    const rawName = typeof asset === "string" ? asset : asset.name;
    const name = normalizeAssetName(rawName);
    if (!name || isServerExecutableArtifact(name)) continue;
    files.push(
      assertPortableRelativeBrowserArtifactPath(
        name,
        `Webpack emitted build-only public asset ${JSON.stringify(rawName)}`,
      ),
    );
  }
  return [...new Set(files)];
}

function isServerExecutableArtifact(name: string): boolean {
  return isJavaScriptAsset(name) || /\.(?:[cm]?js)\.map$/iu.test(name);
}

function mergePortableFiles(...groups: string[][]): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  for (const file of groups.flat()) {
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
  }
  return files;
}

export function assertWebpackAdapterStatsPathAvailable(
  files: readonly string[],
): void {
  const collision = files.find((file) =>
    portableArtifactPathsConflict(file, "stats.json"),
  );
  if (collision) {
    throw new Error(
      `[evjs] Webpack emitted asset "${collision}" conflicts with adapter-owned "stats.json" on portable file systems. Rename the Webpack asset.`,
    );
  }
}

function includeAdapterStatsFile(files: string[]): string[] {
  assertWebpackAdapterStatsPathAvailable(files);
  return [...files, "stats.json"];
}

function readEntrypointAssets(
  stats: WebpackStatsLike | undefined,
  options: { excludedJavaScriptAssets?: ReadonlySet<string> } = {},
): Record<string, AssetGroup> {
  const byName: Record<string, AssetGroup> = {};

  for (const [name, entry] of Object.entries(stats?.entrypoints ?? {})) {
    const assets = emptyAssets();
    for (const asset of entry.assets ?? []) {
      const assetName =
        typeof asset === "string"
          ? normalizeAssetName(asset)
          : normalizeAssetName(asset.name);
      if (
        assetName &&
        isJavaScriptAsset(assetName) &&
        !options.excludedJavaScriptAssets?.has(assetName)
      ) {
        assets.js.push(assetName);
      } else if (assetName?.endsWith(".css")) {
        assets.css.push(assetName);
      }
    }

    defineRecordValue(byName, name, dedupeAssets(assets));
  }

  return byName;
}

function readWebpackHotUpdateAssetNames(
  stats: WebpackStatsLike | undefined,
): Set<string> {
  const names = new Set<string>();
  for (const asset of stats?.assets ?? []) {
    if (typeof asset === "string" || !asset.info?.hotModuleReplacement) {
      continue;
    }
    const name = normalizeAssetName(asset.name);
    if (name) names.add(name);
  }
  return names;
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

function assertSelfContainedWebpackServerEntries(
  plan: BuildPlan,
  entryAssets: Record<string, AssetGroup>,
  stats: WebpackStatsLike | undefined,
): void {
  const runtimeEntries = plan.entries.filter(
    (entry) => entry.environment === "server" && entry.phase !== "build",
  );
  const buildEntries = plan.entries.filter(
    (entry) => entry.environment === "server" && entry.phase === "build",
  );
  assertExactServerJavaScriptInventory(
    "Webpack runtime server stats",
    stats?.assets,
    runtimeEntries.flatMap(
      (entry) => getOwn(entryAssets, entry.name)?.js ?? [],
    ),
  );
  assertExactServerJavaScriptInventory(
    "Webpack build-only server stats",
    stats?.buildOnlyAssets,
    buildEntries.flatMap((entry) => getOwn(entryAssets, entry.name)?.js ?? []),
  );
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

function assertExactServerJavaScriptInventory(
  source: string,
  assets: Array<string | WebpackStatsAsset> | undefined,
  ownedJavaScript: readonly string[],
): void {
  if (assets === undefined) {
    if (ownedJavaScript.length === 0) return;
    throw new Error(
      `[evjs] ${source} must provide a complete emitted asset inventory for ${ownedJavaScript.length} server entry asset(s).`,
    );
  }
  const emittedJavaScript = new Set<string>();
  for (const asset of assets) {
    const rawName = typeof asset === "string" ? asset : asset.name;
    const name = normalizeAssetName(rawName);
    if (!name || !isJavaScriptAsset(name)) continue;
    emittedJavaScript.add(
      assertServerRelativeArtifactPath(
        name,
        `${source} JavaScript asset ${JSON.stringify(rawName)}`,
      ),
    );
  }
  const owned = new Set(ownedJavaScript);
  for (const asset of owned) {
    if (emittedJavaScript.has(asset)) continue;
    throw new Error(
      `[evjs] ${source} are missing exact server entry JavaScript asset "${asset}" from the complete emitted inventory.`,
    );
  }
  for (const asset of emittedJavaScript) {
    if (owned.has(asset)) continue;
    throw new Error(
      `[evjs] ${source} emitted unowned JavaScript asset "${asset}". Every server entry must be self-contained in its exact entry asset.`,
    );
  }
}

function normalizeAssetName(name: string | undefined): string | undefined {
  return name?.replace(/^\.\//, "");
}

function isJavaScriptAsset(name: string): boolean {
  return /\.(?:cjs|mjs|js)$/.test(name);
}

function readRscManifests(clientDir: string):
  | {
      clientReferenceManifest?: Record<string, unknown>;
    }
  | undefined {
  const clientReferenceManifest = readJsonObject(
    path.join(clientDir, "react-client-manifest.json"),
  );
  if (!clientReferenceManifest) return undefined;
  return {
    clientReferenceManifest,
  };
}

function readJsonObject(file: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
