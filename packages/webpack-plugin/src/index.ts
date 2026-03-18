import fs from "node:fs";
import { builtinModules } from "node:module";
import {
  detectUseServer,
  generateServerEntry,
  type ServerEntryConfig,
} from "@evjs/build-tools";
import type { Manifest, ServerFnEntry } from "@evjs/manifest";
import type { Compiler } from "webpack";

class ManifestCollector {
  fns: Record<string, ServerFnEntry> = {};
  entry: string = "main.js";

  addServerFn(id: string, meta: ServerFnEntry) {
    this.fns[id] = meta;
  }

  getManifest(): Manifest {
    return {
      version: 1,
      server: {
        entry: this.entry,
        fns: this.fns,
      },
    };
  }
}

type EvCompiler = Compiler & { _ev_manifest_collector?: ManifestCollector };

export type { ServerEntryConfig };

export interface EvWebpackPluginOptions {
  server?: ServerEntryConfig;
}

/**
 * Webpack plugin for the ev framework.
 *
 * Automatically discovers files with the "use server" directive based on the client dependencies
 * and manages the server-side build via a child compiler.
 */
export class EvWebpackPlugin {
  private options: EvWebpackPluginOptions;

  constructor(options?: EvWebpackPluginOptions) {
    this.options = options ?? {};
  }
  apply(compiler: Compiler) {
    const collector = new ManifestCollector();

    // Attach collector to compiler so the loader can access it
    (compiler as EvCompiler)._ev_manifest_collector = collector;

    // Check if the current compiler is already the Node Child Compiler
    const isServer =
      compiler.options.name === "evServer" ||
      compiler.options.target === "node";

    if (!isServer) {
      // We are in the Client compiler.
      compiler.hooks.make.tapAsync(
        "EvWebpackPlugin",
        async (compilation, callback) => {
          compilation.hooks.finishModules.tapAsync(
            "EvWebpackPlugin",
            (modules, finishCallback) => {
              const serverModulePaths: string[] = [];

              for (const module of modules) {
                const resource =
                  "resource" in module ? (module.resource as string) : null;
                if (!resource || typeof resource !== "string") continue;

                if (
                  resource.includes("node_modules") ||
                  !/\.(ts|tsx|js|jsx)$/.test(resource)
                ) {
                  continue;
                }

                try {
                  const content = fs.readFileSync(resource, "utf-8");
                  if (detectUseServer(content)) {
                    serverModulePaths.push(resource);
                  }
                } catch (_err) {
                  // Ignore read errors for dynamically generated Webpack modules
                }
              }

              if (serverModulePaths.length === 0) {
                return finishCallback();
              }

              // Generate server entry using build-tools (bundler-agnostic)
              const serverEntryContent = generateServerEntry(
                this.options.server,
                serverModulePaths,
              );

              // Use a Data URI as a virtual entry point
              const serverEntryPath = `data:text/javascript,${encodeURIComponent(
                serverEntryContent,
              )}`;

              // Spawn the Node Server child compiler (webpack-specific)
              const isProduction = compiler.options.mode === "production";
              const outputOptions = {
                filename: isProduction
                  ? "../server/main.[contenthash:8].js"
                  : "../server/main.js",
                library: { type: "commonjs2" },
                chunkFormat: "commonjs",
              };

              const childCompiler = compilation.createChildCompiler(
                "evServer",
                outputOptions,
                [
                  new compiler.webpack.node.NodeTemplatePlugin({
                    asyncChunkLoading: false,
                  }),
                  new compiler.webpack.node.NodeTargetPlugin(),
                  new compiler.webpack.library.EnableLibraryPlugin("commonjs2"),
                  new compiler.webpack.ExternalsPlugin("commonjs", [
                    (
                      { request }: { request?: string },
                      cb: (err?: Error | null, result?: string) => void,
                    ) => {
                      if (!request || typeof request !== "string") {
                        return cb();
                      }
                      // Externalize Node builtins
                      if (
                        request.startsWith("node:") ||
                        builtinModules.includes(request)
                      ) {
                        return cb(null, request);
                      }
                      // Never externalize relative, absolute, data-uri,
                      // or @evjs/* imports (workspace ESM packages that
                      // must be bundled into the CJS server output).
                      if (
                        request.startsWith(".") ||
                        request.startsWith("/") ||
                        request.startsWith("data:") ||
                        request.startsWith("@evjs/")
                      ) {
                        return cb();
                      }
                      // Externalize all other bare-specifier imports
                      // (third-party node_modules). This is essential for
                      // native addons (e.g. better-sqlite3) whose .node
                      // binaries cannot be bundled by webpack.
                      cb(null, request);
                    },
                  ]),
                  new compiler.webpack.EntryPlugin(
                    compiler.context,
                    serverEntryPath,
                    { name: "main" },
                  ),
                ],
              );

              (childCompiler as EvCompiler)._ev_manifest_collector = collector;

              childCompiler.runAsChild((err, _entries, childCompilation) => {
                if (err) return finishCallback(err);
                if (
                  childCompilation?.errors &&
                  childCompilation.errors.length > 0
                ) {
                  return finishCallback(childCompilation.errors[0]);
                }

                // Store the hashed entry filename on the collector
                // so it gets merged into manifest.json by processAssets
                if (childCompilation) {
                  for (const [, entry] of childCompilation.entrypoints) {
                    const files = entry.getFiles();
                    if (files.length > 0) {
                      collector.entry = files[0].replace(/^\.\.\/server\//, "");
                    }
                  }
                }

                finishCallback();
              });
            },
          );
          callback();
        },
      );
    }

    // Emit manifest using modern processAssets hook
    compiler.hooks.thisCompilation.tap("EvWebpackPlugin", (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: "EvWebpackPlugin",
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
        },
        () => {
          const manifest = collector.getManifest();
          if (Object.keys(manifest.server.fns).length === 0) {
            return;
          }
          const content = JSON.stringify(manifest, null, 2);

          compilation.emitAsset(
            "../manifest.json",
            new compiler.webpack.sources.RawSource(content),
          );
        },
      );
    });
  }
}
