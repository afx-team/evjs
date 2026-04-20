import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { BundlerAdapter, EvPluginHooks, ResolvedEvConfig } from "@evjs/ev";
import { getLogger } from "@logtape/logtape";

const esmRequire = createRequire(import.meta.url);
const logger = getLogger(["evjs", "bundler-webpack"]);

export const webpackAdapter: BundlerAdapter<import("webpack").Configuration> = {
  name: "webpack",
  async build(
    config: ResolvedEvConfig<import("webpack").Configuration>,
    cwd: string,
    hooks: EvPluginHooks<import("webpack").Configuration>[],
  ): Promise<void> {
    const { createWebpackConfig } = await import("./create-config.js");
    const webpackConfig = await createWebpackConfig(config, cwd, hooks);

    logger.info`Building for production...`;
    const webpack = esmRequire("webpack");
    const compiler = webpack(webpackConfig);

    await new Promise<void>((resolve, reject) => {
      compiler.run(
        (
          err: Error | null,
          stats: {
            hasErrors: () => boolean;
            toString: (opts: object) => string;
          },
        ) => {
          if (err) {
            reject(err);
            return;
          }
          const output = stats.toString({
            colors: false,
            modules: false,
            children: true,
          });
          logger.info`Build stats:\n${output}`;
          if (stats.hasErrors()) {
            reject(new Error("Webpack build failed with errors"));
            return;
          }
          compiler.close(() => resolve());
        },
      );
    });
    logger.info`Build complete!`;
  },

  async dev(
    config: ResolvedEvConfig<import("webpack").Configuration>,
    cwd: string,
    callbacks: { onServerBundleReady: () => void },
    hooks: EvPluginHooks<import("webpack").Configuration>[],
  ): Promise<void> {
    const { createWebpackConfig } = await import("./create-config.js");
    const webpackConfig = await createWebpackConfig(config, cwd, hooks);

    logger.info`Starting development server...`;
    const webpack = esmRequire("webpack");
    const WebpackDevServer = esmRequire("webpack-dev-server");

    const compiler = webpack(webpackConfig);
    const devServerOptions =
      (webpackConfig as { devServer?: object }).devServer ?? {};
    const server = new WebpackDevServer(devServerOptions, compiler);
    await server.start();

    let ready = false;
    compiler.hooks.done.tap("EvDevServer", () => {
      if (!config.serverEnabled || ready) return;
      const manifestPath = path.resolve(cwd, "dist/server/manifest.json");

      if (fs.existsSync(manifestPath)) {
        let manifest: { version?: number; entry?: string };
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        } catch {
          return; // Manifest partially written, wait for next rebuild
        }
        if (manifest.version !== 1 || !manifest.entry) return;

        ready = true;
        // Let the CLI framework know it's time to start the API runtime.
        callbacks.onServerBundleReady();
      }
    });
  },
};
