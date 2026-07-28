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
} from "@evjs/ev/_internal/build";
import type {
  AssetGroup,
  BuildOutputServerModule,
  BuildPlan,
} from "@evjs/shared/manifest";
import { assertBuildOutputLinkInputClientAssets } from "@evjs/shared/manifest";

const EMPTY_ASSETS: AssetGroup = { js: [], css: [] };

export interface WebpackStatsAsset {
  name?: string;
}

export interface WebpackStatsEntrypoint {
  assets?: Array<string | WebpackStatsAsset>;
}

export interface WebpackStatsModule {
  name?: string;
  identifier?: string;
  id?: string | number;
  chunks?: Array<string | number>;
}

export interface WebpackStatsChunk {
  id?: string | number;
  names?: string[];
  files?: string[];
}

export interface WebpackStatsLike {
  assets?: Array<string | WebpackStatsAsset>;
  /** Assets emitted only by the isolated build-phase server compiler. */
  buildOnlyAssets?: Array<string | WebpackStatsAsset>;
  entrypoints?: Record<string, WebpackStatsEntrypoint>;
  chunks?: WebpackStatsChunk[];
  modules?: WebpackStatsModule[];
}

export class WebpackManifestGenerator {
  private clientEntryAssets: Record<string, AssetGroup> = {};
  private serverEntryAssets: Record<string, AssetGroup> = {};
  private serverEntry: string | undefined;
  private serverAssets: AssetGroup = EMPTY_ASSETS;
  private serverModules: BuildOutputServerModule[] = [];

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
    const clientEntrypoints = readEntrypointAssets(this.clientStats);
    this.clientEntryAssets = resolveBundlerClientEntryAssets(
      this.plan,
      clientEntrypoints,
      "Webpack client stats",
    );

    const serverEntrypoints = readEntrypointAssets(this.serverStats);
    this.serverEntryAssets = serverEntrypoints;
    const serverRuntimeEntry = this.plan.entries.find(
      (entry) =>
        entry.environment === "server" && entry.kind === "server-runtime",
    );
    if (serverRuntimeEntry) {
      const selectedEntrypoint = selectServerEntrypoint(
        serverEntrypoints,
        serverRuntimeEntry.name,
      );
      this.serverAssets = selectedEntrypoint.assets;
      this.serverEntry = selectServerJavaScriptAsset(
        selectedEntrypoint.name,
        serverRuntimeEntry.name,
        selectedEntrypoint.assets,
      );
    }
    this.serverModules = collectServerModules(
      this.serverStats,
      this.serverAssets,
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
      clientEntryAssets: this.clientEntryAssets,
      serverEntryAssets: this.serverEntryAssets,
      serverEntry: this.serverEntry,
      serverAssets: this.serverAssets,
      serverModules: this.serverModules,
      rscManifests: readRscManifests(outputPaths.clientDir),
    };
    assertBundlerEmittedFiles(facts.emittedFiles);
    assertBuildOutputLinkInputClientAssets({
      plan: this.plan,
      clientEntryAssets: facts.clientEntryAssets,
    });
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
): Record<string, AssetGroup> {
  const byName: Record<string, AssetGroup> = {};

  for (const [name, entry] of Object.entries(stats?.entrypoints ?? {})) {
    const assets = emptyAssets();
    for (const asset of entry.assets ?? []) {
      const assetName =
        typeof asset === "string"
          ? normalizeAssetName(asset)
          : normalizeAssetName(asset.name);
      if (assetName && isJavaScriptAsset(assetName)) {
        assets.js.push(assetName);
      } else if (assetName?.endsWith(".css")) {
        assets.css.push(assetName);
      }
    }

    byName[name] = dedupeAssets(assets);
  }

  return byName;
}

function selectServerEntrypoint(
  byName: Record<string, AssetGroup>,
  expectedName: string,
): { name: string; assets: AssetGroup } {
  const exact = byName[expectedName];
  if (exact) return { name: expectedName, assets: exact };

  const entries = Object.entries(byName);
  if (entries.length === 1) {
    const entry = entries[0];
    if (entry) return { name: entry[0], assets: entry[1] };
  }
  throw new Error(
    `[evjs] Webpack server stats do not identify BuildPlan entrypoint "${expectedName}" uniquely; found entrypoints ${entries.length > 0 ? entries.map(([name]) => JSON.stringify(name)).join(", ") : "<none>"}.`,
  );
}

function selectServerJavaScriptAsset(
  statsEntryName: string,
  _expectedName: string,
  assets: AssetGroup,
): string {
  if (assets.js.length === 1) return assets.js[0] as string;
  throw new Error(
    `[evjs] Webpack server entrypoint "${statsEntryName}" must emit exactly one self-contained JavaScript entry asset; found ${assets.js.length}.`,
  );
}

function collectServerModules(
  stats: WebpackStatsLike | undefined,
  fallbackAssets: AssetGroup,
): BuildOutputServerModule[] {
  const chunkFiles = new Map<string | number, string[]>();
  for (const chunk of stats?.chunks ?? []) {
    if (chunk.id !== undefined) chunkFiles.set(chunk.id, chunk.files ?? []);
    for (const name of chunk.names ?? []) {
      chunkFiles.set(name, chunk.files ?? []);
    }
  }

  const result: BuildOutputServerModule[] = [];
  for (const mod of stats?.modules ?? []) {
    const moduleId =
      normalizeModuleId(mod.identifier) ??
      normalizeModuleId(mod.name) ??
      normalizeModuleId(mod.id);
    if (!moduleId) continue;

    result.push({
      moduleId,
      assets: assetsFromChunks(mod.chunks, chunkFiles, fallbackAssets),
    });
  }
  return result;
}

function assetsFromChunks(
  chunks: Array<string | number> | undefined,
  chunkFiles: Map<string | number, string[]>,
  fallback: AssetGroup,
): AssetGroup {
  const assets = emptyAssets();
  for (const chunk of chunks ?? []) {
    for (const file of chunkFiles.get(chunk) ?? []) {
      const name = normalizeAssetName(file);
      if (name && isJavaScriptAsset(name)) {
        assets.js.push(name);
      } else if (name?.endsWith(".css")) {
        assets.css.push(name);
      }
    }
  }

  const deduped = dedupeAssets(assets);
  if (deduped.js.length > 0 || deduped.css.length > 0) return deduped;
  return fallback;
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

function normalizeAssetName(name: string | undefined): string | undefined {
  return name?.replace(/^\.\//, "");
}

function isJavaScriptAsset(name: string): boolean {
  return /\.(?:cjs|mjs|js)$/.test(name);
}

function normalizeModuleId(
  value: string | number | undefined,
): string | undefined {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/^webpack:\/\/[^/]+\//, "")
    .replace(/^\.\//, "")
    .replace(/\?.+$/, "");
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
