import path from "node:path";
import { glob } from "node:fs";
import type { Compiler } from "webpack";

interface ServerFnMetadata {
  file: string;
  name: string;
}

class ManifestCollector {
  serverFns: Record<string, ServerFnMetadata> = {};

  addServerFn(id: string, meta: ServerFnMetadata) {
    this.serverFns[id] = meta;
  }

  getManifest() {
    return {
      serverFns: this.serverFns,
    };
  }
}

/**
 * Options for the EvWebpackPlugin.
 */
export interface EvWebpackPluginOptions {
  /**
   * Glob pattern to auto-discover server function files.
   * When set, matching files are automatically added as Webpack entries
   * so they don't need to be manually imported in server.ts.
   *
   * Example: `"./src/**\/*.server.ts"`
   */
  serverFunctions?: string;
}

/**
 * Webpack plugin for the ev framework.
 *
 * Handles:
 * 1. Auto-discovery and injection of server function entry points.
 * 2. Manifest generation (`ev-manifest.json`) for production builds.
 */
export class EvWebpackPlugin {
  private options: EvWebpackPluginOptions;

  constructor(options?: EvWebpackPluginOptions) {
    this.options = options ?? {};
  }

  apply(compiler: Compiler) {
    const collector = new ManifestCollector();

    // Attach collector to compiler so the loader can access it
    (compiler as any)._ev_manifest_collector = collector;

    // Auto-discover and inject server function entries
    if (this.options.serverFunctions) {
      const pattern = this.options.serverFunctions;
      const context = compiler.context;

      compiler.hooks.make.tapAsync("EvWebpackPlugin", (compilation, callback) => {
        glob(pattern, { cwd: context }, (err, files) => {
          if (err) {
            callback(err);
            return;
          }

          if (files.length === 0) {
            callback();
            return;
          }

          const webpack = compiler.webpack;
          let pending = files.length;

          for (const file of files) {
            const absolutePath = path.resolve(context, file);
            const dep = webpack.EntryPlugin.createDependency(absolutePath, {
              name: undefined,
            });
            compilation.addEntry(context, dep, { name: undefined }, (addErr) => {
              if (addErr) {
                callback(addErr);
                return;
              }
              pending--;
              if (pending === 0) {
                callback();
              }
            });
          }
        });
      });
    }

    // Emit manifest
    compiler.hooks.emit.tap("EvWebpackPlugin", (compilation) => {
      const manifest = collector.getManifest();
      if (Object.keys(manifest.serverFns).length === 0) {
        return;
      }
      const content = JSON.stringify(manifest, null, 2);

      compilation.assets["ev-manifest.json"] = {
        source: () => content,
        size: () => content.length,
      } as any;
    });
  }
}
