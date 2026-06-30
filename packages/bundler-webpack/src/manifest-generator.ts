import fs from "node:fs";
import path from "node:path";
import type {
  AssetGroup,
  BuildOutputServerModule,
  BuildPlan,
  BundlerBuildFacts,
} from "@evjs/ev";
import { getOutputPaths } from "./adapter/output-paths.js";

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
  entrypoints?: Record<string, WebpackStatsEntrypoint>;
  chunks?: WebpackStatsChunk[];
  modules?: WebpackStatsModule[];
}

export class WebpackManifestGenerator {
  private clientEntryAssets: Record<string, AssetGroup> = {};
  private serverEntryAssets: Record<string, AssetGroup> = {};
  private firstClientEntryAssets: AssetGroup = EMPTY_ASSETS;
  private serverEntry: string | undefined;
  private serverAssets: AssetGroup = EMPTY_ASSETS;
  private serverModules: BuildOutputServerModule[] = [];

  constructor(
    private cwd: string,
    private plan: BuildPlan,
    private clientStats?: WebpackStatsLike,
    private serverStats?: WebpackStatsLike,
  ) {}

  collectBuildFacts(): BundlerBuildFacts {
    const outputPaths = getOutputPaths(
      this.cwd,
      {
        client: this.plan.output.clientDir,
        server: this.plan.output.serverDir,
      },
      this.plan.distDir,
    );
    const clientEntrypoints = readEntrypointAssets(this.clientStats);
    this.clientEntryAssets = clientEntrypoints.byName;
    this.firstClientEntryAssets = clientEntrypoints.first;

    const serverEntrypoints = readEntrypointAssets(this.serverStats);
    this.serverEntryAssets = serverEntrypoints.byName;
    const serverRuntimeEntry = this.plan.entries.find(
      (entry) => entry.kind === "server-runtime",
    );
    if (serverRuntimeEntry) {
      this.serverAssets =
        this.serverEntryAssets[serverRuntimeEntry.name] ??
        serverEntrypoints.first;
      this.serverEntry = this.serverAssets.js[0];
    }
    this.serverModules = collectServerModules(
      this.serverStats,
      this.serverAssets,
    );

    return {
      clientEntryAssets: this.clientEntryAssets,
      firstClientEntryAssets: this.firstClientEntryAssets,
      serverEntryAssets: this.serverEntryAssets,
      serverEntry: this.serverEntry,
      serverAssets: this.serverAssets,
      serverModules: this.serverModules,
      rscManifests: readRscManifests(outputPaths.clientDir),
    };
  }
}

function readEntrypointAssets(stats: WebpackStatsLike | undefined): {
  byName: Record<string, AssetGroup>;
  first: AssetGroup;
} {
  const byName: Record<string, AssetGroup> = {};
  let first: AssetGroup = EMPTY_ASSETS;

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
    if (first === EMPTY_ASSETS) {
      first = byName[name];
    }
  }

  return { byName, first };
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
