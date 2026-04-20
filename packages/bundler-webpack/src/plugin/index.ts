import type { ServerEntryConfig } from "@evjs/build-tools";
import { generateHtml } from "@evjs/build-tools";
import { buildHtml, type EvDocument, type EvPluginHooks } from "@evjs/ev";
import { ManifestCollector } from "@evjs/manifest";
import type { Compiler } from "webpack";
import { applyServerCompiler } from "./server-compiler.js";

export type { ServerEntryConfig };

export interface EvWebpackPluginOptions {
  server?: ServerEntryConfig;
  /** Whether server features are enabled. Default: true. */
  serverEnabled?: boolean;
  /** Absolute path to the user's HTML template file. */
  html: string;
  /** Plugin hooks for transformHtml. */
  hooks?: EvPluginHooks<import("webpack").Configuration>[];
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
    (
      compiler as Compiler & { _ev_manifest_collector?: ManifestCollector }
    )._ev_manifest_collector = collector;

    // Check if the current compiler is already the Node Child Compiler
    const isServer =
      compiler.options.name === "evServer" ||
      compiler.options.target === "node";

    // Server compiler: scan for "use server" modules and spawn child compiler
    if (!isServer) {
      applyServerCompiler(compiler, collector, {
        server: this.options.server,
        serverEnabled: this.serverEnabled,
      });
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

          // Emit dist/client/manifest.json
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

          // Parse HTML template and inject asset tags (bundler-agnostic)
          const doc = generateHtml({
            template: this.options.html,
            js: jsFiles,
            css: cssFiles,
            assetPrefix: this.options.assetPrefix,
          });

          // Apply framework-level transforms (assetPrefix, plugin hooks)
          const html = await buildHtml({
            doc: doc as unknown as EvDocument,
            assetPrefix: this.options.assetPrefix,
            hooks: this.options.hooks ?? [],
            clientManifest,
            serverManifest: this.serverEnabled ? serverManifest : undefined,
          });

          compilation.emitAsset(
            "index.html",
            new compiler.webpack.sources.RawSource(html),
          );
        },
      );
    });
  }
}
