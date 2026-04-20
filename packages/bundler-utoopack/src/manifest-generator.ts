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
 * @returns lists of JS and CSS asset filenames from the main entrypoint.
 */
function parseClientStats(stats: {
  entrypoints?: Record<string, { assets?: Array<{ name?: string }> }>;
}): { js: string[]; css: string[] } {
  const jsFiles: string[] = [];
  const cssFiles: string[] = [];
  const mainEntry = stats.entrypoints?.main;

  if (mainEntry && Array.isArray(mainEntry.assets)) {
    for (const asset of mainEntry.assets) {
      if (asset.name?.endsWith(".js")) {
        jsFiles.push(asset.name);
      } else if (asset.name?.endsWith(".css")) {
        cssFiles.push(asset.name);
      }
    }
  }
  return { js: jsFiles, css: cssFiles };
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
  const mainEntry = stats.entrypoints?.main;

  if (mainEntry && Array.isArray(mainEntry.assets)) {
    const jsAsset = mainEntry.assets.find((a) => a.name?.endsWith(".js"));
    entry = jsAsset?.name;
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
      const { js, css } = parseClientStats(stats);
      this.collector.setAssets(js, css);
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
  async watch(onUpdate?: () => void) {
    await this.loadClientStats();
    await this.loadServerStats();
    const files = await fastGlob("src/**/*.{ts,tsx,js,jsx}", {
      cwd: this.cwd,
      absolute: true,
    });
    await Promise.all(files.map((f) => this.processFile(f)));
    await this.emit();
    onUpdate?.();

    this.watcher = chokidar.watch("src/**/*.{ts,tsx,js,jsx}", {
      cwd: this.cwd,
      ignoreInitial: true,
    });

    const handleChange = async (filepath: string) => {
      const fullPath = path.resolve(this.cwd, filepath);
      await this.processFile(fullPath);
      await this.emit();
      onUpdate?.();
    };

    const handleUnlink = async (filepath: string) => {
      const fullPath = path.resolve(this.cwd, filepath);
      this.currentRoutes.delete(fullPath);
      await this.emit();
      onUpdate?.();
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
