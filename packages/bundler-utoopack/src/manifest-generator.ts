import fs from "node:fs";
import path from "node:path";
import {
  analyzeRoutes,
  extractServerFunctionExports,
  hashServerFunction,
  resolveRoutes,
} from "@evjs/build-tools";
import {
  type ClientManifest,
  type ExtractedRoute,
  type ManifestAssets,
  ManifestCollector,
  type RouteEntry,
  type ServerFnEntry,
  type ServerManifest,
  type ServerRouteEntry,
} from "@evjs/manifest";
import { getLogger } from "@logtape/logtape";
import chokidar from "chokidar";
import fastGlob from "fast-glob";

const logger = getLogger(["evjs", "bundler-utoopack", "manifest"]);

const EMPTY_ASSETS: ManifestAssets = { js: [], css: [] };

interface UtoopackStatsModule {
  name?: string;
  id?: string | number;
  chunks?: Array<string | number>;
}

interface ServerModuleMetadata {
  moduleId: string;
  assets: ManifestAssets;
}

function normalizeAssetName(name: string | undefined): string | undefined {
  return name?.replace(/^\.\//, "");
}

/**
 * Parse a Utoopack stats.json file and extract asset filenames.
 *
 * @returns lists of JS and CSS asset filenames from the main entrypoint (SPA mode).
 */
function parseClientStats(stats: {
  entrypoints?: Record<string, { assets?: Array<{ name?: string }> }>;
}): { js: string[]; css: string[] } {
  const jsFiles: string[] = [];
  const cssFiles: string[] = [];

  // Use first entrypoint — utoopack may name it by the output file rather than "main"
  const entrypoints = stats.entrypoints;
  const firstEntry = entrypoints ? Object.values(entrypoints)[0] : undefined;

  if (firstEntry && Array.isArray(firstEntry.assets)) {
    for (const asset of firstEntry.assets) {
      const name = normalizeAssetName(asset.name);
      if (name?.endsWith(".js")) {
        jsFiles.push(name);
      } else if (name?.endsWith(".css")) {
        cssFiles.push(name);
      }
    }
  }
  return { js: jsFiles, css: cssFiles };
}

/**
 * Parse a Utoopack stats.json file and extract per-entrypoint asset filenames.
 *
 * @returns a map of entrypoint name → { js, css } asset lists (MPA mode).
 */
function parseClientStatsPerEntrypoint(stats: {
  entrypoints?: Record<string, { assets?: Array<{ name?: string }> }>;
}): Record<string, { js: string[]; css: string[] }> {
  const result: Record<string, { js: string[]; css: string[] }> = {};
  const entrypoints = stats.entrypoints;
  if (!entrypoints) return result;

  for (const [name, entry] of Object.entries(entrypoints)) {
    const js: string[] = [];
    const css: string[] = [];
    if (Array.isArray(entry.assets)) {
      for (const asset of entry.assets) {
        const assetName = normalizeAssetName(asset.name);
        if (assetName?.endsWith(".js")) {
          js.push(assetName);
        } else if (assetName?.endsWith(".css")) {
          css.push(assetName);
        }
      }
    }
    result[name] = { js, css };
  }
  return result;
}

/**
 * Parse a Utoopack server stats.json and extract emitted assets.
 */
function parseServerStats(stats: {
  entrypoints?: Record<string, { assets?: Array<{ name?: string }> }>;
}): {
  entry: string | undefined;
  assets: ManifestAssets;
} {
  let entry: string | undefined;
  const assets: ManifestAssets = { js: [], css: [] };

  // Use first entrypoint — utoopack may name it by the output file rather than "main"
  const entrypoints = stats.entrypoints;
  const firstEntry = entrypoints ? Object.values(entrypoints)[0] : undefined;

  if (firstEntry && Array.isArray(firstEntry.assets)) {
    const jsAsset = firstEntry.assets.find((a) => a.name?.endsWith(".js"));
    entry = normalizeAssetName(jsAsset?.name);
    for (const asset of firstEntry.assets) {
      const name = normalizeAssetName(asset.name);
      if (name?.endsWith(".js")) {
        assets.js.push(name);
      } else if (name?.endsWith(".css")) {
        assets.css.push(name);
      }
    }
  }

  return {
    entry,
    assets,
  };
}

function dedupeAssets(assets: ManifestAssets): ManifestAssets {
  return {
    js: [...new Set(assets.js)],
    css: [...new Set(assets.css)],
  };
}

function mergeAssets(a: ManifestAssets, b: ManifestAssets): ManifestAssets {
  return dedupeAssets({
    js: [...a.js, ...b.js],
    css: [...a.css, ...b.css],
  });
}

function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, "/").replaceAll("\\", "/");
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

function moduleIdMatchesSource(moduleId: string, sourceRel: string): boolean {
  return moduleId === sourceRel || moduleId.endsWith(`/${sourceRel}`);
}

function assetsFromChunks(
  chunks: Array<string | number> | undefined,
  fallback: ManifestAssets,
): ManifestAssets {
  const assets: ManifestAssets = { js: [], css: [] };

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

function collectServerModules(
  modules: UtoopackStatsModule[] | undefined,
  fallbackAssets: ManifestAssets,
): ServerModuleMetadata[] {
  const result: ServerModuleMetadata[] = [];

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
  private collector = new ManifestCollector();
  private cwd: string;
  private serverEnabled: boolean;
  private watcher: chokidar.FSWatcher | null = null;
  private clientJsAssets: string[] = [];
  private currentRoutes: RouteEntry[] = [];
  private serverAssets: ManifestAssets = EMPTY_ASSETS;
  private serverFns: Record<string, ServerFnEntry> = {};
  private currentServerRoutes: ServerRouteEntry[] = [];
  private serverModules: ServerModuleMetadata[] = [];

  constructor(cwd: string, serverEnabled: boolean) {
    this.cwd = cwd;
    this.serverEnabled = serverEnabled;
  }

  /**
   * Load client assets from the client `stats.json` emitted by Utoopack.
   * In development, this file may not exist, which is expected since
   * Utoopack handles HTML client injection natively.
   *
   * In MPA mode (multiple entrypoints), assets are collected per-page
   * via `setPageAssets()`. In SPA mode, a single `setAssets()` call is used.
   */
  async loadClientStats() {
    const statsPath = path.resolve(
      this.cwd,
      this.serverEnabled ? "dist/client/stats.json" : "dist/stats.json",
    );
    if (!fs.existsSync(statsPath)) {
      this.collector.setAssets([], []);
      this.clientJsAssets = [];
      return;
    }
    try {
      const statsStr = await fs.promises.readFile(statsPath, "utf-8");
      const stats = JSON.parse(statsStr);

      // Detect MPA: multiple entrypoints in stats.json
      const entrypoints = stats.entrypoints;
      const entrypointCount = entrypoints ? Object.keys(entrypoints).length : 0;

      if (entrypointCount > 1) {
        // MPA mode: per-page assets
        const perPage = parseClientStatsPerEntrypoint(stats);
        this.clientJsAssets = [];
        for (const [name, { js, css }] of Object.entries(perPage)) {
          this.clientJsAssets.push(...js);
          this.collector.setPageAssets(name, js, css);
        }
      } else {
        // SPA mode: single entrypoint
        const { js, css } = parseClientStats(stats);
        this.clientJsAssets = js;
        this.collector.setAssets(js, css);
      }
    } catch (err) {
      logger.warn`Failed to parse client stats.json: ${err}`;
      this.collector.setAssets([], []);
      this.clientJsAssets = [];
    }
  }

  /**
   * Load server entry and function registrations from the server `stats.json`.
   *
   * When Utoopack doesn't emit a server stats.json (e.g. older versions),
   * falls back to scanning dist/server/ for a JS entry and creating a
   * synthetic manifest.
   */
  async loadServerStats() {
    if (!this.serverEnabled) return;
    this.serverAssets = EMPTY_ASSETS;
    this.serverFns = {};

    const statsPath = path.resolve(this.cwd, "dist/server/stats.json");
    if (fs.existsSync(statsPath)) {
      try {
        const statsStr = await fs.promises.readFile(statsPath, "utf-8");
        const stats = JSON.parse(statsStr);
        const { entry, assets } = parseServerStats(stats);
        this.collector.entry = entry;
        this.serverAssets = dedupeAssets(assets);
        this.serverModules = collectServerModules(
          stats.modules,
          this.serverAssets,
        );
        return;
      } catch (err) {
        logger.warn`Failed to parse server stats.json: ${err}`;
      }
    }

    // Fallback: scan for JS entry in dist/server/
    const serverDir = path.resolve(this.cwd, "dist/server");
    if (fs.existsSync(serverDir)) {
      const files = await fs.promises.readdir(serverDir);
      const jsEntry = files.find((f) => f.endsWith(".js"));
      if (jsEntry) {
        this.collector.entry = jsEntry;
        this.serverAssets = { js: [jsEntry], css: [] };
        this.serverModules = [];
      }
    }
  }

  private findServerModuleForSource(sourceRel: string) {
    return this.serverModules.find((mod) =>
      moduleIdMatchesSource(mod.moduleId, sourceRel),
    );
  }

  async loadSourceMetadata() {
    const files = await fastGlob("src/**/*.{ts,tsx,js,jsx}", {
      cwd: this.cwd,
      absolute: true,
    });

    const clientRoutes: ExtractedRoute[] = [];
    const serverRouteMap = new Map<string, ServerRouteEntry>();
    const fns: Record<string, ServerFnEntry> = {};

    for (const file of files) {
      const source = await fs.promises.readFile(file, "utf-8");
      const sourceRel = toPosixPath(path.relative(this.cwd, file));
      const analysis = analyzeRoutes(source);
      clientRoutes.push(...analysis.clientRoutes);

      if (!this.serverEnabled) continue;

      const serverModule = this.findServerModuleForSource(sourceRel);
      const sourceAssets = serverModule?.assets ?? this.serverAssets;

      for (const route of analysis.serverRoutes) {
        const key = `${route.path}\0${route.methods.join(",")}`;
        const existing = serverRouteMap.get(key);
        serverRouteMap.set(key, {
          path: route.path,
          methods: route.methods,
          assets: existing
            ? mergeAssets(existing.assets, sourceAssets)
            : sourceAssets,
        });
      }

      const exportNames = extractServerFunctionExports(source);
      if (exportNames.length === 0) continue;

      for (const exportName of exportNames) {
        const id = hashServerFunction(sourceRel, exportName);
        fns[id] = {
          assets: fns[id]
            ? mergeAssets(fns[id].assets, sourceAssets)
            : sourceAssets,
        };
      }
    }

    this.currentRoutes = resolveRoutes(clientRoutes);
    this.serverFns = fns;
    this.currentServerRoutes = [...serverRouteMap.values()];
  }

  private rebuildRoutes() {
    this.collector.routes = [];
    this.collector.addRoutes(this.currentRoutes);
  }

  private rebuildServerMetadata() {
    this.collector.fns = {};
    this.collector.setServerAssets(this.serverAssets.js, this.serverAssets.css);

    for (const [id, fn] of Object.entries(this.serverFns)) {
      this.collector.addServerFn(id, fn);
    }

    this.collector.serverRoutes = [];
    this.collector.addServerRoutes(this.currentServerRoutes);
  }

  /**
   * Emit the client manifest (and server manifest if server is enabled).
   */
  async emit() {
    this.rebuildRoutes();
    if (this.serverEnabled) {
      this.rebuildServerMetadata();
    }

    // Client manifest — matches ClientManifest from @evjs/manifest
    const clientManifest: ClientManifest = this.collector.getClientManifest();
    const clientOutPath = path.resolve(
      this.cwd,
      this.serverEnabled ? "dist/client/manifest.json" : "dist/manifest.json",
    );

    const clientOutDir = path.dirname(clientOutPath);
    if (!fs.existsSync(clientOutDir)) {
      await fs.promises.mkdir(clientOutDir, { recursive: true });
    }
    await fs.promises.writeFile(
      clientOutPath,
      JSON.stringify(clientManifest, null, 2),
    );

    // Server manifest
    if (this.serverEnabled) {
      // Server manifest — matches ServerManifest from @evjs/manifest
      const serverManifest: ServerManifest = this.collector.getServerManifest();
      const serverOutDir = path.resolve(this.cwd, "dist/server");
      if (!fs.existsSync(serverOutDir)) {
        await fs.promises.mkdir(serverOutDir, { recursive: true });
      }
      await fs.promises.writeFile(
        path.join(serverOutDir, "manifest.json"),
        JSON.stringify(serverManifest, null, 2),
      );
    }
  }

  /**
   * Run a full post-build manifest generation pass.
   */
  async build() {
    await this.loadClientStats();
    await this.loadServerStats();
    await this.loadSourceMetadata();
    await this.emit();
  }

  /**
   * Run manifest generation continually by watching the filesystem in development.
   */
  async watch(onUpdate?: () => void | Promise<void>) {
    await this.loadClientStats();
    await this.loadServerStats();
    await this.loadSourceMetadata();
    await this.emit();
    await onUpdate?.();

    this.watcher = chokidar.watch("src/**/*.{ts,tsx,js,jsx}", {
      cwd: this.cwd,
      ignoreInitial: true,
    });

    const handleChange = async (filepath: string) => {
      logger.debug`Route source changed: ${filepath}`;
      await this.loadSourceMetadata();
      await this.emit();
      await onUpdate?.();
    };

    const handleUnlink = async (filepath: string) => {
      logger.debug`Route source removed: ${filepath}`;
      await this.loadSourceMetadata();
      await this.emit();
      await onUpdate?.();
    };

    this.watcher.on("add", handleChange);
    this.watcher.on("change", handleChange);
    this.watcher.on("unlink", handleUnlink);
  }

  async close() {
    if (this.watcher) {
      await this.watcher.close();
    }
  }
}
