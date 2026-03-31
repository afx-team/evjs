import fs from "node:fs";
import path from "node:path";
import { getLogger } from "@logtape/logtape";
import { execa } from "execa";
import type { EvConfig } from "./config.js";
import { CONFIG_DEFAULTS, resolveConfig } from "./config.js";
import { webpackAdapter } from "./bundler/webpack/index.js";
import type { BundlerAdapter } from "./bundler/types.js";

export type { EvConfig, EvConfigCtx, EvBundlerCtx, EvPlugin, ResolvedEvConfig } from "./config.js";
export { CONFIG_DEFAULTS, defineConfig, resolveConfig } from "./config.js";

const logger = getLogger(["evjs", "cli"]);

export interface DevOptions {
  cwd?: string;
}

export interface BuildOptions {
  cwd?: string;
}

/**
 * Resolve the bundler adapter specified in the configuration.
 */
async function getBundlerAdapter(config?: EvConfig): Promise<BundlerAdapter> {
  const bundlerName = config?.bundler?.name ?? "webpack";
  if (bundlerName === "webpack") {
    return webpackAdapter;
  }
  throw new Error(`Bundler '${bundlerName}' is not supported yet.`);
}

/**
 * Start the development server programmatically.
 *
 * @param config - evjs configuration object (from `defineConfig`)
 * @param options - additional options like `cwd`
 */
export async function dev(
  userConfig?: EvConfig,
  options?: DevOptions,
): Promise<void> {
  const config = resolveConfig(userConfig);
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "development";

  const bundler = await getBundlerAdapter(config);

  // Background: start Node API when server bundle is ready
  let apiStarted = false;
  
  const handleServerBundleReady = () => {
    if (apiStarted) return;
    
    const manifestPath = path.resolve(cwd, "dist/manifest.json");
    if (!fs.existsSync(manifestPath)) return;
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (!manifest.server?.entry) return;

    apiStarted = true;
    const serverPort = config?.server?.dev?.port ?? CONFIG_DEFAULTS.serverPort;
    const backendConfig = config?.server?.backend ?? "node";
    const [backend, ...backendExtraArgs] = backendConfig.split(/\s+/);
    logger.info`Server bundle detected, starting ${backend} API...`;

    const bootstrapPath = path.resolve(cwd, "dist/server/_dev_start.cjs");
    try {
      const serverBundlePath = path.resolve(
        cwd,
        "dist/server",
        manifest.server.entry,
      );

      if (!fs.existsSync(path.dirname(bootstrapPath))) {
        fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
      }
      fs.writeFileSync(
        bootstrapPath,
        [
          `const bundle = require(${JSON.stringify(serverBundlePath)});`,
          `const app = bundle.app || bundle.createApp({ endpoint: ${JSON.stringify(config.server.endpoint)} });`,
          `const { serve } = require("@evjs/server/node");`,
          `serve(app, { port: ${serverPort}, https: ${Boolean(config.server.dev.https)} });`,
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
  };

  await bundler.dev(config, cwd, {
    onServerBundleReady: handleServerBundleReady,
  });
}

/**
 * Run a production build programmatically.
 *
 * @param config - evjs configuration object (from `defineConfig`)
 * @param options - additional options like `cwd`
 */
export async function build(
  userConfig?: EvConfig,
  options?: BuildOptions,
): Promise<void> {
  const config = resolveConfig(userConfig);
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "production";

  const bundler = await getBundlerAdapter(config);
  await bundler.build(config, cwd);
}
