import { createRequire } from "node:module";
import path from "node:path";
import { getLogger } from "@logtape/logtape";
import { execa } from "execa";
import fs from "fs-extra";
import type { EvConfig } from "./config.js";
import { CONFIG_DEFAULTS } from "./config.js";

export type {
  ClientConfig,
  EvConfig,
  EvLoaderEntry,
  EvModuleRule,
  EvPlugin,
  ServerConfig,
} from "./config.js";
export { CONFIG_DEFAULTS, defineConfig } from "./config.js";

const esmRequire = createRequire(import.meta.url);
const logger = getLogger(["evjs", "cli"]);

/**
 * Create webpack configuration from an EvConfig object.
 */
async function resolveWebpackConfig(config: EvConfig | undefined, cwd: string) {
  const { createWebpackConfig } = await import("./create-webpack-config.js");
  return createWebpackConfig(config, cwd);
}

export interface DevOptions {
  cwd?: string;
}

/**
 * Start the development server programmatically.
 *
 * @param config - evjs configuration object (from `defineConfig`)
 * @param options - additional options like `cwd`
 */
export async function dev(
  config?: EvConfig,
  options?: DevOptions,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "development";

  const webpackConfig = await resolveWebpackConfig(config, cwd);
  const serverPort = config?.server?.dev?.port ?? CONFIG_DEFAULTS.serverPort;

  logger.info`Starting development server...`;
  const webpack = esmRequire("webpack");
  const WebpackDevServer = esmRequire("webpack-dev-server");

  const compiler = webpack(webpackConfig);
  const devServerOptions =
    (webpackConfig as { devServer?: object }).devServer ?? {};
  const server = new WebpackDevServer(devServerOptions, compiler);
  await server.start();

  // Background: start Node API when server bundle is ready
  let apiStarted = false;
  compiler.hooks.done.tap("EvDevServer", async () => {
    if (apiStarted) return;

    const manifestPath = path.resolve(cwd, "dist/manifest.json");
    const bootstrapPath = path.resolve(cwd, "dist/server/_dev_start.cjs");

    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      // Start API server if there's a server entry
      if (!manifest.server?.entry) return;
      apiStarted = true;
      const backendConfig = config?.server?.backend ?? "node";
      const [backend, ...backendExtraArgs] = backendConfig.split(/\s+/);
      logger.info`Server bundle detected, starting ${backend} API...`;

      try {
        const serverBundlePath = path.resolve(
          cwd,
          "dist/server",
          manifest.server.entry,
        );

        fs.ensureDirSync(path.dirname(bootstrapPath));
        fs.writeFileSync(
          bootstrapPath,
          [
            `const bundle = require(${JSON.stringify(serverBundlePath)});`,
            `const app = bundle.app || bundle.createApp({ endpoint: ${JSON.stringify(config?.server?.functions?.endpoint ?? CONFIG_DEFAULTS.endpoint)} });`,
            `const { serve } = require("@evjs/server/node");`,
            `serve(app, { port: ${serverPort}, https: ${Boolean(config?.server?.dev?.https)} });`,
          ].join("\n"),
        );

        // node gets --watch flags; other runtimes use their own args as-is
        const backendArgs =
          backend === "node"
            ? [
                "--watch",
                "--watch-preserve-output",
                ...backendExtraArgs,
                bootstrapPath,
              ]
            : [...backendExtraArgs, bootstrapPath];

        // Don't await execa here since it's a long-running watch process
        execa(backend, backendArgs, {
          stdio: "inherit",
          env: { ...process.env, NODE_ENV: "development" },
        }).catch(() => {
          apiStarted = false;
        });
      } catch (err) {
        logger.error`Server backend failed: ${err}`;
        apiStarted = false;
      }
    }
  });
}

export interface BuildOptions {
  cwd?: string;
}

/**
 * Run a production build programmatically.
 *
 * @param config - evjs configuration object (from `defineConfig`)
 * @param options - additional options like `cwd`
 */
export async function build(
  config?: EvConfig,
  options?: BuildOptions,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "production";

  const webpackConfig = await resolveWebpackConfig(config, cwd);

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
          process.exit(1);
        }
        compiler.close(() => resolve());
      },
    );
  });
  logger.info`Build complete!`;
}
