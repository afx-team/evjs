import fs from "node:fs";
import path from "node:path";
import type {
  AppGraph,
  AssetGroup,
  BuildOutput,
  BuildOutputServerModule,
  BuildPlan,
} from "@evjs/ev";
import { linkBuildOutput } from "@evjs/ev";
import { getLogger } from "@logtape/logtape";
import {
  getOutputPaths,
  type UtoopackOutputPaths,
} from "./adapter/output-paths.js";

const logger = getLogger(["evjs", "bundler-utoopack", "manifest"]);

const EMPTY_ASSETS: AssetGroup = { js: [], css: [] };

interface UtoopackStatsModule {
  name?: string;
  id?: string | number;
  chunks?: Array<string | number>;
}

function normalizeAssetName(name: string | undefined): string | undefined {
  return name?.replace(/^\.\//, "");
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

function readEntrypointAssets(stats: {
  entrypoints?: Record<string, { assets?: Array<{ name?: string }> }>;
}): {
  byName: Record<string, AssetGroup>;
  first: AssetGroup;
} {
  const byName: Record<string, AssetGroup> = {};
  let first: AssetGroup = EMPTY_ASSETS;

  for (const [name, entry] of Object.entries(stats.entrypoints ?? {})) {
    const assets = emptyAssets();
    for (const asset of entry.assets ?? []) {
      const assetName = normalizeAssetName(asset.name);
      if (assetName?.endsWith(".js")) {
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
  private serverEnabled: boolean;
  private outputPaths: UtoopackOutputPaths;
  private graph: AppGraph;
  private plan: BuildPlan;
  private clientEntryAssets: Record<string, AssetGroup> = {};
  private serverEntryAssets: Record<string, AssetGroup> = {};
  private firstClientEntryAssets: AssetGroup = EMPTY_ASSETS;
  private serverEntry: string | undefined;
  private serverAssets: AssetGroup = EMPTY_ASSETS;
  private serverModules: BuildOutputServerModule[] = [];

  constructor(
    cwd: string,
    serverEnabled: boolean,
    graph: AppGraph,
    plan: BuildPlan,
  ) {
    this.serverEnabled = serverEnabled;
    this.outputPaths = getOutputPaths(cwd, serverEnabled);
    this.graph = graph;
    this.plan = plan;
  }

  async loadClientStats() {
    const statsPath = path.join(this.outputPaths.clientDir, "stats.json");
    if (!fs.existsSync(statsPath)) {
      this.clientEntryAssets = {};
      this.firstClientEntryAssets = EMPTY_ASSETS;
      return;
    }

    try {
      const statsStr = await fs.promises.readFile(statsPath, "utf-8");
      const stats = JSON.parse(statsStr);
      const { byName, first } = readEntrypointAssets(stats);
      this.clientEntryAssets = byName;
      this.firstClientEntryAssets = first;
    } catch (err) {
      logger.warn`Failed to parse client stats.json: ${err}`;
      this.clientEntryAssets = {};
      this.firstClientEntryAssets = EMPTY_ASSETS;
    }
  }

  async loadServerStats() {
    if (!this.serverEnabled) return;
    this.serverEntry = undefined;
    this.serverEntryAssets = {};
    this.serverAssets = EMPTY_ASSETS;
    this.serverModules = [];

    const statsPath = path.join(this.outputPaths.serverDir, "stats.json");
    if (fs.existsSync(statsPath)) {
      try {
        const statsStr = await fs.promises.readFile(statsPath, "utf-8");
        const stats = JSON.parse(statsStr);
        const { byName, first } = readEntrypointAssets(stats);
        this.serverEntryAssets = byName;
        const serverEntryName =
          this.plan.entries.find((entry) => entry.kind === "server-runtime")
            ?.name ?? "server";
        const entryAssets = byName[serverEntryName] ?? first;
        this.serverAssets = entryAssets;
        this.serverEntry = entryAssets.js[0];
        this.serverModules = collectServerModules(
          stats.modules,
          this.serverAssets,
        );
        return;
      } catch (err) {
        logger.warn`Failed to parse server stats.json: ${err}`;
      }
    }

    const serverDir = this.outputPaths.serverDir;
    if (fs.existsSync(serverDir)) {
      const files = await fs.promises.readdir(serverDir);
      const jsEntry = files.find((file) => file.endsWith(".js"));
      if (jsEntry) {
        this.serverEntry = jsEntry;
        this.serverAssets = { js: [jsEntry], css: [] };
      }
    }
  }

  async emit(output: BuildOutput) {
    const outPath = path.join(this.outputPaths.rootDir, "manifest.json");
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, JSON.stringify(output, null, 2));
  }

  async link(): Promise<BuildOutput> {
    await this.loadClientStats();
    await this.loadServerStats();
    return linkBuildOutput({
      graph: this.graph,
      plan: this.plan,
      serverEnabled: this.serverEnabled,
      clientEntryAssets: this.clientEntryAssets,
      firstClientEntryAssets: this.firstClientEntryAssets,
      serverEntryAssets: this.serverEntryAssets,
      serverEntry: this.serverEntry,
      serverAssets: this.serverAssets,
      serverModules: this.serverModules,
    });
  }

  async build(): Promise<BuildOutput> {
    const output = await this.link();
    await this.emit(output);
    return output;
  }

  async watch(onUpdate?: (output: BuildOutput) => void | Promise<void>) {
    const output = await this.build();
    await onUpdate?.(output);
  }

  async close() {}
}
