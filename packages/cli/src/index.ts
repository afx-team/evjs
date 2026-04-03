import fs from "node:fs";
import path from "node:path";
import { webpackAdapter } from "@evjs/bundler-webpack";
import {
  type BundlerAdapter,
  CONFIG_DEFAULTS,
  defineConfig,
  type EvBundlerCtx,
  type EvConfig,
  type EvConfigCtx,
  type EvPlugin,
  type ResolvedEvConfig,
  resolveConfig,
} from "@evjs/shared";
import { getLogger } from "@logtape/logtape";
import { execa } from "execa";

export {
  CONFIG_DEFAULTS,
  type EvConfig,
  type EvBundlerCtx,
  type EvConfigCtx,
  type EvPlugin,
  type ResolvedEvConfig,
  resolveConfig,
  defineConfig,
};

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

    const manifestPath = path.resolve(cwd, "dist/server/manifest.json");
    if (!fs.existsSync(manifestPath)) return;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (!manifest.entry) return;

    apiStarted = true;
    const serverPort = config?.server?.dev?.port ?? CONFIG_DEFAULTS.serverPort;
    const runtimeConfig = config?.server?.runtime ?? "node";
    const [runtime, ...runtimeExtraArgs] = runtimeConfig.split(/\s+/);
    logger.info`Server bundle detected, starting ${runtime} API...`;

    const bootstrapPath = path.resolve(cwd, "dist/server/_dev_start.cjs");
    try {
      const serverBundlePath = path.resolve(cwd, "dist/server", manifest.entry);

      if (!fs.existsSync(path.dirname(bootstrapPath))) {
        fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
      }
      fs.writeFileSync(
        bootstrapPath,
        [
          `const bundle = require(${JSON.stringify(serverBundlePath)});`,
          `const app = bundle.app || bundle.createApp({ endpoint: ${JSON.stringify(config.server.endpoint)} });`,
          `const { serve } = require("@evjs/server/node");`,
          `serve(app, { port: ${serverPort}, https: ${JSON.stringify(config.server.dev.https)} });`,
        ].join("\n"),
      );

      // node gets --watch flags; other runtimes use their own args as-is
      const runtimeArgs =
        runtime === "node"
          ? [
              "--watch",
              "--watch-preserve-output",
              ...runtimeExtraArgs,
              bootstrapPath,
            ]
          : [...runtimeExtraArgs, bootstrapPath];

      // Don't await execa here since it's a long-running watch process
      execa(runtime, runtimeArgs, {
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "development" },
      }).catch(() => {
        apiStarted = false;
      });
    } catch (err) {
      logger.error`Server runtime failed: ${err}`;
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
