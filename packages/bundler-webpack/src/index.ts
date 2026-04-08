import fs from "node:fs";
import { builtinModules } from "node:module";
import {
  detectUseServer,
  type ExtractedRoute,
  extractRoutes,
  generateHtml,
  generateServerEntry,
  resolveRoutes,
  type ServerEntryConfig,
} from "@evjs/build-tools";
import type { EvDocument, EvPluginHooks } from "@evjs/ev";
import type {
  ClientManifest,
  ServerFnEntry,
  ServerManifest,
} from "@evjs/manifest";
import type { Compiler } from "webpack";
import { webpackAdapter } from "./adapter/index.js";

export { webpackAdapter };
export { webpack } from "./plugin-helper.js";

class ManifestCollector {
  fns: Record<string, ServerFnEntry> = {};
  routes: ExtractedRoute[] = [];
  entry: string | undefined = undefined;
  private jsAssets: string[] = [];
  private cssAssets: string[] = [];

  addServerFn(id: string, meta: ServerFnEntry) {
    this.fns[id] = meta;
  }

  addRoutes(entries: ExtractedRoute[]) {
    this.routes.push(...entries);
  }

  setAssets(js: string[], css: string[]) {
    this.jsAssets = js;
    this.cssAssets = css;
  }

  getJsAssets(): string[] {
    return this.jsAssets;
  }

  getCssAssets(): string[] {
    return this.cssAssets;
  }

  getServerManifest(): ServerManifest {
    return {
      version: 1,
      entry: this.entry,
      fns: this.fns,
    };
  }

  getClientManifest(assetPrefix?: string): ClientManifest {
    return {
      version: 1,
      assetPrefix: assetPrefix && assetPrefix !== "/" ? assetPrefix : undefined,
      assets: { js: this.jsAssets, css: this.cssAssets },
      routes: resolveRoutes(this.routes),
    };
  }
}

type EvCompiler = Compiler & { _ev_manifest_collector?: ManifestCollector };

export type { ServerEntryConfig };

export interface EvWebpackPluginOptions {
  server?: ServerEntryConfig;
  /** Whether server features are enabled. Default: true. */
  serverEnabled?: boolean;
  /** Absolute path to the user's HTML template file. */
  html: string;
  /** Plugin hooks for transformHtml. */
  hooks?: EvPluginHooks[];
  /** Asset prefix for CDN deployment. Injected into HTML as window.assetPrefix. */
  assetPrefix?: string;
}

/**
 * Webpack plugin for the ev framework.
 *
 * Automatically discovers files with the "use server" directive based on the client dependencies
 * and manages the server-side build via a child compiler.
 * Generates the output HTML by parsing the user's template and injecting bundled assets.
 */
export class EvWebpackPlugin {
  private options: EvWebpackPluginOptions;
  private serverEnabled: boolean;

  constructor(options: EvWebpackPluginOptions) {
    this.options = options;
    this.serverEnabled = options?.serverEnabled ?? true;
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
            async (modules, finishCallback) => {
              const serverModulePaths: string[] = [];

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
                    const content = await fs.promises.readFile(
                      resource,
                      "utf-8",
                    );
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

              const explicitServerEntry = this.options.server?.entry;

              // When server is disabled, error if any "use server" files exist
              if (!this.serverEnabled) {
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

    // Emit manifests and generated HTML using modern processAssets hook
    compiler.hooks.thisCompilation.tap("EvWebpackPlugin", (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: "EvWebpackPlugin",
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
        },
        async () => {
          // Collect client assets from entrypoints
          const jsFiles: string[] = [];
          const cssFiles: string[] = [];
          for (const [name, entrypoint] of compilation.entrypoints) {
            if (name === "main" || !name.startsWith("HtmlWebpackPlugin")) {
              for (const file of entrypoint.getFiles()) {
                if (file.endsWith(".js")) jsFiles.push(file);
                else if (file.endsWith(".css")) cssFiles.push(file);
              }
            }
          }
          collector.setAssets(jsFiles, cssFiles);

          const serverManifest = collector.getServerManifest();
          const clientManifest = collector.getClientManifest(
            this.options.assetPrefix,
          );

          // Always emit client manifest — it contains asset paths
          // needed by deployment tools even when there are no routes.

          // Emit dist/client/manifest.json (relative to client output dir)
          // When server is disabled, output goes to dist/ so this becomes dist/manifest.json
          compilation.emitAsset(
            "manifest.json",
            new compiler.webpack.sources.RawSource(
              JSON.stringify(clientManifest, null, 2),
            ),
          );

          // Only emit server manifest when server is enabled
          if (this.serverEnabled) {
            compilation.emitAsset(
              "../server/manifest.json",
              new compiler.webpack.sources.RawSource(
                JSON.stringify(serverManifest, null, 2),
              ),
            );
          }

          // Generate HTML document from the user's template + collected assets
          const assetPrefix = this.options.assetPrefix;
          const doc = generateHtml({
            template: this.options.html,
            js: jsFiles,
            css: cssFiles,
            assetPrefix: assetPrefix,
          });

          // Inject <script>window.assetPrefix = "..."</script> into <head>
          // so the value is available at runtime for dynamic asset references.
          if (assetPrefix && assetPrefix !== "/") {
            const head = doc.querySelector("head");
            if (head) {
              head.insertAdjacentHTML(
                "afterbegin",
                `<script>window.assetPrefix=${JSON.stringify(assetPrefix)};</script>`,
              );
            }
          }

          // Run transformHtml plugin hooks in sequence (mutate doc in place)
          const hooks = this.options.hooks ?? [];
          const buildResult = {
            clientManifest,
            serverManifest: this.serverEnabled ? serverManifest : undefined,
            isRebuild: false,
          };
          for (const h of hooks) {
            if (h.transformHtml) {
              await h.transformHtml(doc as unknown as EvDocument, buildResult);
            }
          }

          // Serialize and emit index.html
          compilation.emitAsset(
            "index.html",
            new compiler.webpack.sources.RawSource(doc.toString()),
          );
        },
      );
    });
  }
}
