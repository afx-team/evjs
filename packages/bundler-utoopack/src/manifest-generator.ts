import fs from "node:fs";
import path from "node:path";
import { type ExtractedRoute, extractRoutes } from "@evjs/build-tools";
import {
  type ClientManifest,
  ManifestCollector,
  type ServerFnEntry,
  type ServerManifest,
} from "@evjs/manifest";
import { getLogger } from "@logtape/logtape";
import chokidar from "chokidar";
import fastGlob from "fast-glob";

const logger = getLogger(["evjs", "bundler-utoopack", "manifest"]);

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
      const name = asset.name?.replace(/^\.\//, "");
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
        const assetName = asset.name?.replace(/^\.\//, "");
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
 * Parse a Utoopack server stats.json and extract entry filename and
 * server function registrations.
 *
 * The server stats.json shape (emitted by @utoo/pack when server
 * references are enabled):
 *
 * ```json
 * {
 *   "entrypoints": {
 *     "main": { "assets": [{ "name": "index.js" }] }
 *   },
 *   "serverFunctions": {
 *     "<fnId>": { "moduleId": "<hash>", "export": "functionName" }
 *   }
 * }
 * ```
 */
function parseServerStats(stats: {
  entrypoints?: Record<string, { assets?: Array<{ name?: string }> }>;
  serverFunctions?: Record<string, ServerFnEntry>;
}): {
  entry: string | undefined;
  fns: Record<string, ServerFnEntry>;
} {
  let entry: string | undefined;

  // Use first entrypoint — utoopack may name it by the output file rather than "main"
  const entrypoints = stats.entrypoints;
  const firstEntry = entrypoints ? Object.values(entrypoints)[0] : undefined;

  if (firstEntry && Array.isArray(firstEntry.assets)) {
    const jsAsset = firstEntry.assets.find((a) => a.name?.endsWith(".js"));
    entry = jsAsset?.name?.replace(/^\.\//, "");
  }

  return {
    entry,
    fns: stats.serverFunctions ?? {},
  };
}

export class UtoopackManifestGenerator {
  private collector = new ManifestCollector();
  private cwd: string;
  private assetPrefix?: string;
  private serverEnabled: boolean;
  private watcher: chokidar.FSWatcher | null = null;
  private currentRoutes = new Map<string, ExtractedRoute[]>();

  constructor(cwd: string, serverEnabled: boolean, assetPrefix?: string) {
    this.cwd = cwd;
    this.serverEnabled = serverEnabled;
    this.assetPrefix = assetPrefix;
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

    const statsPath = path.resolve(this.cwd, "dist/server/stats.json");
    if (fs.existsSync(statsPath)) {
      try {
        const statsStr = await fs.promises.readFile(statsPath, "utf-8");
        const stats = JSON.parse(statsStr);
        const { entry, fns } = parseServerStats(stats);
        this.collector.entry = entry;
        for (const [id, meta] of Object.entries(fns)) {
          this.collector.addServerFn(id, meta);
        }
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
      }
    }
  }

  async processFile(filepath: string) {
    try {
      const content = await fs.promises.readFile(filepath, "utf-8");
      const routes = extractRoutes(content);
      if (routes.length > 0) {
        this.currentRoutes.set(filepath, routes);
      } else {
        this.currentRoutes.delete(filepath);
      }
    } catch (_err) {
      this.currentRoutes.delete(filepath);
    }
  }

  private rebuildRoutes() {
    this.collector.routes = [];
    for (const routes of this.currentRoutes.values()) {
      this.collector.addRoutes(routes);
    }
  }

  /**
   * Emit the client manifest (and server manifest if server is enabled).
   */
  async emit() {
    this.rebuildRoutes();

    // Client manifest — matches ClientManifest from @evjs/manifest
    const clientManifest: ClientManifest = this.collector.getClientManifest(
      this.assetPrefix,
    );
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
