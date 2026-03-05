import fs from "node:fs";
import path from "node:path";
import { glob } from "node:fs";
import type { Compiler } from "webpack";
import type { EvManifest, ServerFnEntry } from "@evjs/manifest";

class ManifestCollector {
  serverFunctions: Record<string, ServerFnEntry> = {};

  addServerFn(id: string, meta: ServerFnEntry) {
    this.serverFunctions[id] = meta;
  }

  getManifest(): EvManifest {
    return {
      version: 1,
      serverFunctions: this.serverFunctions,
    };
  }
}

/**
 * Check if a file starts with the "use server" directive.
 */
function hasUseServerDirective(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const firstLine = content.trimStart().split("\n")[0];
    return /^["']use server["'];?\s*$/.test(firstLine.trim());
  } catch {
    return false;
  }
}

/**
 * Webpack plugin for the ev framework.
 *
 * On server builds (target: "node"), automatically discovers files with
 * the "use server" directive and adds them as entries.
 * On all builds, emits the `manifest.json` mapping function IDs to assets.
 */
export class EvWebpackPlugin {
  apply(compiler: Compiler) {
    const collector = new ManifestCollector();

    // Attach collector to compiler so the loader can access it
    (compiler as any)._ev_manifest_collector = collector;

    // Auto-discover server function files on server builds
    const isServer =
      compiler.options.target === "node" ||
      (Array.isArray(compiler.options.target) &&
        compiler.options.target.includes("node"));

    if (isServer) {
      const context = compiler.context;

      compiler.hooks.make.tapAsync("EvWebpackPlugin", (compilation, callback) => {
        // Scan all .ts/.tsx files under src/ for "use server" directive
        glob("./src/**/*.{ts,tsx}", { cwd: context }, (err, files) => {
          if (err) {
            callback(err);
            return;
          }

          const serverFiles = files.filter((f) =>
            hasUseServerDirective(path.resolve(context, f)),
          );

          if (serverFiles.length === 0) {
            callback();
            return;
          }

          const webpack = compiler.webpack;
          let pending = serverFiles.length;

          for (const file of serverFiles) {
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
      if (Object.keys(manifest.serverFunctions).length === 0) {
        return;
      }
      const content = JSON.stringify(manifest, null, 2);

      compilation.assets["manifest.json"] = {
        source: () => content,
        size: () => content.length,
      } as any;
    });
  }
}
