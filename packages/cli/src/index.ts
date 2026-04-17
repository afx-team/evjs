import fs from "node:fs";
import path from "node:path";
import {
  type BundlerAdapter,
  CONFIG_DEFAULTS,
  defineConfig,
  type EvBuildResult,
  type EvBundlerCtx,
  type EvConfig,
  type EvPlugin,
  type EvPluginContext,
  type EvPluginHooks,
  type ResolvedEvConfig,
  resolveConfig,
} from "@evjs/ev";
import type { ClientManifest, ServerManifest } from "@evjs/manifest";
import { getLogger } from "@logtape/logtape";
import { execa } from "execa";

export {
  CONFIG_DEFAULTS,
  type EvConfig,
  type EvBuildResult,
  type EvBundlerCtx,
  type EvPlugin,
  type EvPluginContext,
  type EvPluginHooks,
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
  const bundlerName = config?.bundler?.name ?? "utoopack";
  if (bundlerName === "utoopack") {
    const { utoopackAdapter } = await import("@evjs/bundler-utoopack");
    return utoopackAdapter;
  }
  if (bundlerName === "webpack") {
    const { webpackAdapter } = await import("@evjs/bundler-webpack");
    return webpackAdapter;
  }
  throw new Error(`Bundler '${bundlerName}' is not supported yet.`);
}

/**
 * Run plugin setup() hooks and collect lifecycle hooks.
 */
async function collectPluginHooks(
  plugins: EvPlugin[],
  ctx: EvPluginContext,
): Promise<EvPluginHooks[]> {
  const allHooks: EvPluginHooks[] = [];
  for (const plugin of plugins) {
    if (plugin.setup) {
      const hooks = await plugin.setup(ctx);
      if (hooks) {
        allHooks.push(hooks);
      }
    }
  }
  return allHooks;
}

/**
 * Run all buildStart hooks sequentially.
 */
async function runBuildStartHooks(hooks: EvPluginHooks[]): Promise<void> {
  for (const h of hooks) {
    if (h.buildStart) {
      await h.buildStart();
    }
  }
}

/**
 * Run all buildEnd hooks sequentially.
 */
async function runBuildEndHooks(
  hooks: EvPluginHooks[],
  result: EvBuildResult,
): Promise<void> {
  for (const h of hooks) {
    if (h.buildEnd) {
      await h.buildEnd(result);
    }
  }
}

/**
 * Read build manifests from disk.
 */
function readBuildResult(
  cwd: string,
  serverEnabled: boolean,
  isRebuild: boolean,
): EvBuildResult | null {
  const clientManifestPath = serverEnabled
    ? path.resolve(cwd, "dist/client/manifest.json")
    : path.resolve(cwd, "dist/manifest.json");

  if (!fs.existsSync(clientManifestPath)) return null;

  let clientManifest: ClientManifest;
  try {
    clientManifest = JSON.parse(fs.readFileSync(clientManifestPath, "utf-8"));
  } catch (err) {
    logger.warn`Failed to parse client manifest: ${err}`;
    return null;
  }

  let serverManifest: ServerManifest | undefined;
  if (serverEnabled) {
    const serverManifestPath = path.resolve(cwd, "dist/server/manifest.json");
    if (fs.existsSync(serverManifestPath)) {
      try {
        serverManifest = JSON.parse(
          fs.readFileSync(serverManifestPath, "utf-8"),
        );
      } catch (err) {
        logger.warn`Failed to parse server manifest: ${err}`;
      }
    }
  }

  return { clientManifest, serverManifest, isRebuild };
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

  // Collect plugin hooks
  const pluginCtx: EvPluginContext = { mode: "development", config };
  const hooks = await collectPluginHooks(config.plugins, pluginCtx);

  // Run buildStart hooks
  await runBuildStartHooks(hooks);

  const bundler = await getBundlerAdapter(config);

  // Track the running API server process for lifecycle management.
  let apiProcess: ReturnType<typeof execa> | null = null;
  let isFirstBuild = true;

  const handleServerBundleReady = () => {
    if (!config.serverEnabled) return;

    const manifestPath = path.resolve(cwd, "dist/server/manifest.json");
    if (!fs.existsSync(manifestPath)) return;

    let manifest: { version?: number; entry?: string };
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch (err) {
      logger.warn`Failed to parse server manifest: ${err}`;
      return;
    }
    if (manifest.version !== 1) {
      logger.warn`Unexpected server manifest version: ${manifest.version}. Expected 1.`;
      return;
    }
    if (!manifest.entry) return;

    // Run buildEnd hooks with manifests
    const buildResult = readBuildResult(
      cwd,
      config.serverEnabled,
      !isFirstBuild,
    );
    if (buildResult) {
      runBuildEndHooks(hooks, buildResult).catch((err) => {
        logger.error`Plugin buildEnd hook failed: ${err}`;
      });
    }
    isFirstBuild = false;

    // Kill previous process before restarting (handles both first start and restarts)
    if (apiProcess) {
      logger.info`Restarting API server...`;
      apiProcess.kill();
      apiProcess = null;
    }

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
      const child = execa(runtime, runtimeArgs, {
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "development" },
      });
      apiProcess = child;

      child.catch(() => {
        // Clear reference so the next compilation can restart
        if (apiProcess === child) {
          apiProcess = null;
        }
      });
    } catch (err) {
      logger.error`Server runtime failed: ${err}`;
      apiProcess = null;
    }
  };

  await bundler.dev(
    config,
    cwd,
    { onServerBundleReady: handleServerBundleReady },
    hooks,
  );
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

  // Collect plugin hooks
  const pluginCtx: EvPluginContext = { mode: "production", config };
  const hooks = await collectPluginHooks(config.plugins, pluginCtx);

  // Run buildStart hooks
  await runBuildStartHooks(hooks);

  const bundler = await getBundlerAdapter(config);
  await bundler.build(config, cwd, hooks);

  // Run buildEnd hooks with manifests
  const buildResult = readBuildResult(cwd, config.serverEnabled, false);
  if (buildResult) {
    await runBuildEndHooks(hooks, buildResult);
  }
}
