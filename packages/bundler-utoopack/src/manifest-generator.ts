import fs from "node:fs";
import path from "node:path";
import {
  analyzeRoutes,
  type ExtractedRoute,
  type RouteAnalysis,
  transformServerFile,
} from "@evjs/build-tools";
import {
  type ClientManifest,
  type ManifestAssets,
  ManifestCollector,
  type ServerManifest,
  type ServerRouteEntry,
} from "@evjs/manifest";
import { getLogger } from "@logtape/logtape";
import chokidar from "chokidar";
import fastGlob from "fast-glob";

const logger = getLogger(["evjs", "bundler-utoopack", "manifest"]);

const EMPTY_ASSETS: ManifestAssets = { js: [], css: [] };

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
  modules?: Array<{
    name?: string;
    id?: string;
    chunks?: string[];
  }>;
}): {
  entry: string | undefined;
  assets: ManifestAssets;
  moduleAssets: Map<string, ManifestAssets>;
} {
  let entry: string | undefined;
  const assets: ManifestAssets = { js: [], css: [] };
  const moduleAssets = new Map<string, ManifestAssets>();

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

  for (const mod of stats.modules ?? []) {
    const moduleName = mod.name ?? mod.id;
    if (!moduleName) continue;

    const moduleAssetList: ManifestAssets = { js: [], css: [] };
    for (const chunk of mod.chunks ?? []) {
      const name = normalizeAssetName(chunk);
      if (name?.endsWith(".js")) {
        moduleAssetList.js.push(name);
      } else if (name?.endsWith(".css")) {
        moduleAssetList.css.push(name);
      }
    }

    moduleAssets.set(moduleName.replaceAll("\\", "/"), moduleAssetList);
  }

  return {
    entry,
    assets,
    moduleAssets,
  };
}

function dedupeAssets(assets: ManifestAssets): ManifestAssets {
  return {
    js: [...new Set(assets.js)],
    css: [...new Set(assets.css)],
  };
}

export class UtoopackManifestGenerator {
  private collector = new ManifestCollector();
  private cwd: string;
  private serverEnabled: boolean;
  private watcher: chokidar.FSWatcher | null = null;
  private currentRoutes = new Map<string, ExtractedRoute[]>();
  private serverAssets: ManifestAssets = EMPTY_ASSETS;
  private serverModuleAssets = new Map<string, ManifestAssets>();
  private currentServerFnIds = new Map<string, string[]>();
  private currentServerRoutes = new Map<
    string,
    Array<Omit<ServerRouteEntry, "assets">>
  >();

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
        for (const [name, { js, css }] of Object.entries(perPage)) {
          this.collector.setPageAssets(name, js, css);
        }
      } else {
        // SPA mode: single entrypoint
        const { js, css } = parseClientStats(stats);
        this.collector.setAssets(js, css);
      }
    } catch (err) {
      logger.warn`Failed to parse client stats.json: ${err}`;
      this.collector.setAssets([], []);
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
    this.serverModuleAssets = new Map();

    const statsPath = path.resolve(this.cwd, "dist/server/stats.json");
    if (fs.existsSync(statsPath)) {
      try {
        const statsStr = await fs.promises.readFile(statsPath, "utf-8");
        const stats = JSON.parse(statsStr);
        const { entry, assets, moduleAssets } = parseServerStats(stats);
        this.collector.entry = entry;
        this.serverAssets = dedupeAssets(assets);
        this.serverModuleAssets = moduleAssets;
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
      }
    }
  }

  async processFile(filepath: string) {
    try {
      const content = await fs.promises.readFile(filepath, "utf-8");
      const analysis = analyzeRoutes(content);
      const routes = analysis.clientRoutes;
      if (routes.length > 0) {
        this.currentRoutes.set(filepath, routes);
      } else {
        this.currentRoutes.delete(filepath);
      }

      if (this.serverEnabled) {
        await this.processServerFile(filepath, content, analysis.serverRoutes);
      }
    } catch (_err) {
      this.currentRoutes.delete(filepath);
      this.currentServerFnIds.delete(filepath);
      this.currentServerRoutes.delete(filepath);
    }
  }

  private async processServerFile(
    filepath: string,
    content: string,
    extractedServerRoutes: RouteAnalysis["serverRoutes"],
  ) {
    const fnIds: string[] = [];
    await transformServerFile(content, {
      resourcePath: filepath,
      rootContext: this.cwd,
      isServer: true,
      onServerFn(id) {
        fnIds.push(id);
      },
    });

    if (fnIds.length > 0) {
      this.currentServerFnIds.set(filepath, fnIds);
    } else {
      this.currentServerFnIds.delete(filepath);
    }

    const serverRoutes = extractedServerRoutes.map(
      (route): Omit<ServerRouteEntry, "assets"> => ({
        path: route.path,
        methods: route.methods,
      }),
    );

    if (serverRoutes.length > 0) {
      this.currentServerRoutes.set(filepath, serverRoutes);
    } else {
      this.currentServerRoutes.delete(filepath);
    }
  }

  private rebuildRoutes() {
    this.collector.routes = [];
    for (const routes of this.currentRoutes.values()) {
      this.collector.addRoutes(routes);
    }
  }

  private rebuildServerMetadata() {
    this.collector.fns = {};
    this.collector.setServerAssets(this.serverAssets.js, this.serverAssets.css);

    for (const [filepath, fnIds] of this.currentServerFnIds.entries()) {
      const assets = this.getServerAssetsForFile(filepath);
      for (const id of fnIds) {
        this.collector.addServerFn(id, { assets });
      }
    }

    this.collector.serverRoutes = [];
    for (const [filepath, routes] of this.currentServerRoutes.entries()) {
      const assets = this.getServerAssetsForFile(filepath);
      this.collector.addServerRoutes(
        routes.map((route) => ({ ...route, assets })),
      );
    }
  }

  private getServerAssetsForFile(filepath: string): ManifestAssets {
    const relativePath = path
      .relative(this.cwd, filepath)
      .replaceAll("\\", "/");
    const exact = this.serverModuleAssets.get(relativePath);
    if (exact) return dedupeAssets(exact);

    for (const [moduleName, assets] of this.serverModuleAssets.entries()) {
      if (
        moduleName === relativePath ||
        moduleName.endsWith(`/${relativePath}`)
      ) {
        return dedupeAssets(assets);
      }
    }

    return this.serverAssets;
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
    const files = await fastGlob("src/**/*.{ts,tsx,js,jsx}", {
      cwd: this.cwd,
      absolute: true,
    });
    await Promise.all(files.map((f) => this.processFile(f)));
    await this.emit();
  }

  /**
   * Run manifest generation continually by watching the filesystem in development.
   */
  async watch(onUpdate?: () => void | Promise<void>) {
    await this.loadClientStats();
    await this.loadServerStats();
    const files = await fastGlob("src/**/*.{ts,tsx,js,jsx}", {
      cwd: this.cwd,
      absolute: true,
    });
    await Promise.all(files.map((f) => this.processFile(f)));
    await this.emit();
    await onUpdate?.();

    this.watcher = chokidar.watch("src/**/*.{ts,tsx,js,jsx}", {
      cwd: this.cwd,
      ignoreInitial: true,
    });

    const handleChange = async (filepath: string) => {
      const fullPath = path.resolve(this.cwd, filepath);
      await this.processFile(fullPath);
      await this.emit();
      await onUpdate?.();
    };

    const handleUnlink = async (filepath: string) => {
      const fullPath = path.resolve(this.cwd, filepath);
      this.currentRoutes.delete(fullPath);
      this.currentServerFnIds.delete(fullPath);
      this.currentServerRoutes.delete(fullPath);
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
