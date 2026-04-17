import fs from "node:fs";
import path from "node:path";
import { type ExtractedRoute, extractRoutes } from "@evjs/build-tools";
import { ManifestCollector } from "@evjs/manifest";
import { getLogger } from "@logtape/logtape";
import chokidar from "chokidar";
import fastGlob from "fast-glob";

const logger = getLogger(["evjs", "bundler-utoopack", "manifest"]);

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
   * Load assets from the `stats.json` file emitted by Utoopack.
   * In development, this file may not exist, which is expected since
   * Utoopack handles HTML client injection natively.
   */
  async loadAssetsFromStats() {
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
      this.collector.setAssets(jsFiles, cssFiles);
    } catch (err) {
      logger.warn`Failed to parse Utoopack stats.json: ${err}`;
      this.collector.setAssets([], []);
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

  async emit() {
    this.rebuildRoutes();
    const manifest = this.collector.getClientManifest(this.assetPrefix);
    const outPath = path.resolve(
      this.cwd,
      this.serverEnabled ? "dist/client/manifest.json" : "dist/manifest.json",
    );

    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) {
      await fs.promises.mkdir(outDir, { recursive: true });
    }

    await fs.promises.writeFile(outPath, JSON.stringify(manifest, null, 2));
  }

  /**
   * Run a completely synchronous post-build manifest generation process.
   */
  async build() {
    await this.loadAssetsFromStats();
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
    await this.loadAssetsFromStats();
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
