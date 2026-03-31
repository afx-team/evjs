import "node:module";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { getLogger } from "@logtape/logtape";
import type { BundlerAdapter } from "../types.js";
import type { ResolvedEvConfig } from "../../config.js";

const esmRequire = createRequire(import.meta.url);
const logger = getLogger(["evjs", "cli"]);

export const webpackAdapter: BundlerAdapter = {
  async build(config: ResolvedEvConfig, cwd: string): Promise<void> {
    const { createWebpackConfig } = await import("./create-config.js");
    const webpackConfig = createWebpackConfig(config, cwd);

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
          console.log(
            stats.toString({
              colors: true,
              modules: false,
              children: true,
            }),
          );
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
    config: ResolvedEvConfig,
    cwd: string,
    callbacks: { onServerBundleReady: () => void },
  ): Promise<void> {
    const { createWebpackConfig } = await import("./create-config.js");
    const webpackConfig = createWebpackConfig(config, cwd);

    logger.info`Starting development server...`;
    const webpack = esmRequire("webpack");
    const WebpackDevServer = esmRequire("webpack-dev-server");

    const compiler = webpack(webpackConfig);
    const devServerOptions =
      (webpackConfig as { devServer?: object }).devServer ?? {};
    const server = new WebpackDevServer(devServerOptions, compiler);
    await server.start();

    let apiReadyCalled = false;
    compiler.hooks.done.tap("EvDevServer", async () => {
      if (apiReadyCalled) return;
      const manifestPath = path.resolve(cwd, "dist/manifest.json");

      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        if (!manifest.server?.entry) return;
        
        // Let the CLI framework know it's time to start the API backend
        apiReadyCalled = true;
        callbacks.onServerBundleReady();
      }
    });
  },
};
