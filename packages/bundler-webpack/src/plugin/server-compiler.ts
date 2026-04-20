import fs from "node:fs";
import { builtinModules } from "node:module";
import {
  detectUseServer,
  extractRoutes,
  generateServerEntry,
  type ServerEntryConfig,
} from "@evjs/build-tools";
import type { ManifestCollector } from "@evjs/manifest";
import type { Compiler } from "webpack";

export interface ServerCompilerOptions {
  /** Server entry configuration. */
  server?: ServerEntryConfig;
  /** Whether server features are enabled. */
  serverEnabled: boolean;
}

/**
 * Scan client modules for "use server" directives and route metadata,
 * then spawn a Node child compiler for the server bundle.
 *
 * This is the `compiler.hooks.make` / `compilation.hooks.finishModules`
 * logic extracted from EvWebpackPlugin for readability.
 */
export function applyServerCompiler(
  compiler: Compiler,
  collector: ManifestCollector,
  options: ServerCompilerOptions,
): void {
  compiler.hooks.make.tapAsync(
    "EvWebpackPlugin",
    async (compilation, callback) => {
      compilation.hooks.finishModules.tapAsync(
        "EvWebpackPlugin",
        async (modules, finishCallback) => {
          const serverModulePaths: string[] = [];

          // Clear stale routes from previous compilations (HMR rebuilds)
          collector.routes = [];

          // Collect candidate file paths
          const candidates: string[] = [];
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
            candidates.push(resource);
          }

          // Read all files in parallel
          const fileContents = await Promise.all(
            candidates.map(async (resource) => {
              try {
                const content = await fs.promises.readFile(resource, "utf-8");
                return { resource, content };
              } catch {
                // Ignore read errors for dynamically generated Webpack modules
                return null;
              }
            }),
          );

          for (const result of fileContents) {
            if (!result) continue;
            const { resource, content } = result;

            if (detectUseServer(content)) {
              serverModulePaths.push(resource);
            }

            // Extract route metadata from createRoute() calls
            const routes = extractRoutes(content);
            if (routes.length > 0) {
              collector.addRoutes(routes);
            }
          }

          const explicitServerEntry = options.server?.entry;

          // When server is disabled, error if any "use server" files exist
          if (!options.serverEnabled) {
            if (serverModulePaths.length > 0 || explicitServerEntry) {
              return finishCallback(
                new Error(
                  `[evjs] server is disabled (server: false) but ${serverModulePaths.length} "use server" module(s) were found:\n${serverModulePaths.map((p) => `  - ${p}`).join("\n")}\nRemove "use server" directives or enable the server.`,
                ),
              );
            }
            return finishCallback();
          }

          if (serverModulePaths.length === 0 && !explicitServerEntry) {
            return finishCallback();
          }

          // Generate server entry using build-tools (bundler-agnostic)
          const serverEntryContent = generateServerEntry(
            options.server,
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
                  // Only externalize Node builtins — everything else
                  // (including third-party node_modules) is bundled
                  // into the single server output file.
                  if (
                    request.startsWith("node:") ||
                    builtinModules.includes(request)
                  ) {
                    return cb(null, request);
                  }
                  cb();
                },
              ]),
              new compiler.webpack.EntryPlugin(
                compiler.context,
                serverEntryPath,
                { name: "main" },
              ),
            ],
          );

          (
            childCompiler as Compiler & {
              _ev_manifest_collector?: ManifestCollector;
            }
          )._ev_manifest_collector = collector;

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
