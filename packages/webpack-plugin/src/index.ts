import fs from "node:fs";
import path from "node:path";
import type { EvManifest, ServerFnEntry } from "@evjs/manifest";
import { glob } from "glob";
import type { Compiler } from "webpack";

class ManifestCollector {
  serverFns: Record<string, ServerFnEntry> = {};

  addServerFn(id: string, meta: ServerFnEntry) {
    this.serverFns[id] = meta;
  }

  getManifest(): EvManifest {
    return {
      version: 1,
      serverFns: this.serverFns,
    };
  }
}

/**
 * Webpack plugin for the ev framework.
 *
 * Automatically discovers files with the "use server" directive in src/
 * and manages the server-side build via a child compiler.
 */
export class EvWebpackPlugin {
  apply(compiler: Compiler) {
    const collector = new ManifestCollector();

    // Attach collector to compiler so the loader can access it
    // biome-ignore lint/suspicious/noExplicitAny: custom compiler extension
    (compiler as any)._ev_manifest_collector = collector;

    // Check if the current compiler is already the Node Child Compiler
    const isServer =
      compiler.options.name === "evServer" ||
      compiler.options.target === "node";

    if (!isServer) {
      // We are in the Client compiler.
      compiler.hooks.make.tapAsync(
        "EvWebpackPlugin",
        async (compilation, callback) => {
          // 1. Add src/ to context dependencies so webpack watches for new/deleted files
          const srcDir = path.resolve(compiler.context, "src");
          compilation.contextDependencies.add(srcDir);

          // 2. Discover server functions
          let hasServer = false;
          const imports: string[] = [];
          imports.push(`import { createServer } from "@evjs/runtime/server";`);

          try {
            const files = await glob("src/**/*.{ts,tsx}", {
              cwd: compiler.context,
            });
            let id = 0;
            for (const file of files) {
              const fullPath = path.resolve(compiler.context, file);
              const content = fs.readFileSync(fullPath, "utf-8");
              const firstLine = content.trimStart().split("\n")[0];
              const isServerFile = /^["']use server["'];?\s*$/.test(
                firstLine.trim(),
              );

              if (isServerFile) {
                hasServer = true;
                imports.push(
                  `import * as _fns_${id++} from "./${file.replace(/\\/g, "/")}";`,
                );
              }
            }

            if (hasServer) {
              imports.push(`createServer();`);
              const serverEntryContent = imports.join("\n");

              // Use a Data URI as a virtual entry point
              const serverEntryPath = `data:text/javascript,${encodeURIComponent(
                serverEntryContent,
              )}`;

              // 3. Spawn the Node Server compiler.
              const outputOptions = {
                filename: "../server/index.js",
                library: { type: "commonjs", name: "evServer" },
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
                  new compiler.webpack.ExternalsPlugin("commonjs", [
                    // biome-ignore lint/suspicious/noExplicitAny: webpack externals callback
                    ({ request }: any, cb: any) => {
                      if (
                        request &&
                        typeof request === "string" &&
                        (request.startsWith("node:") ||
                          [
                            "http",
                            "https",
                            "http2",
                            "fs",
                            "path",
                            "crypto",
                            "stream",
                            "os",
                            "assert",
                            "util",
                            "events",
                            "url",
                            "buffer",
                            "zlib",
                            "child_process",
                            "net",
                            "tls",
                            "querystring",
                            "worker_threads",
                          ].includes(request))
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

              // biome-ignore lint/suspicious/noExplicitAny: custom compiler extension
              (childCompiler as any)._ev_manifest_collector = collector;

              childCompiler.runAsChild((err, _entries, childCompilation) => {
                if (err) return callback(err);
                if (
                  childCompilation?.errors &&
                  childCompilation.errors.length > 0
                ) {
                  return callback(childCompilation.errors[0]);
                }
                callback();
              });
            } else {
              callback();
            }
            // biome-ignore lint/suspicious/noExplicitAny: webpack error
          } catch (err: any) {
            callback(err);
          }
        },
      );
    }

    // Emit manifest using modern processAssets hook to avoid deprecation warnings
    compiler.hooks.thisCompilation.tap("EvWebpackPlugin", (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: "EvWebpackPlugin",
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
        },
        () => {
          const manifest = collector.getManifest();
          if (Object.keys(manifest.serverFns).length === 0) {
            return;
          }
          const content = JSON.stringify(manifest, null, 2);

          // We place the manifest in the server folder (relative to parent output dist/client)
          compilation.emitAsset(
            "../server/manifest.json",
            new compiler.webpack.sources.RawSource(content),
          );
        },
      );
    });
  }
}
