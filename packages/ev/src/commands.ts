import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ClientManifest, ServerManifest } from "@evjs/manifest";
import { getLogger } from "@logtape/logtape";
import { execa } from "execa";
import type { BundlerAdapter } from "./bundler.js";
import {
  CONFIG_DEFAULTS,
  type EvConfig,
  type ResolvedEvConfig,
  resolveConfig,
} from "./config.js";
import type {
  EvBuildResult,
  EvPlugin,
  EvPluginContext,
  EvPluginHooks,
} from "./plugin.js";

const logger = getLogger(["evjs", "ev"]);

type ApiProcess = ReturnType<typeof execa>;

export interface DevOptions<TBundlerCfg = import("@utoo/pack").ConfigComplete> {
  cwd?: string;
  bundler?: BundlerAdapter<TBundlerCfg>;
}

export interface BuildOptions<
  TBundlerCfg = import("@utoo/pack").ConfigComplete,
> {
  cwd?: string;
  bundler?: BundlerAdapter<TBundlerCfg>;
}

function resolveBundler<TBundlerCfg>(
  configBundler: BundlerAdapter<TBundlerCfg> | undefined,
  optionBundler: BundlerAdapter<TBundlerCfg> | undefined,
): BundlerAdapter<TBundlerCfg> {
  const bundler = optionBundler ?? configBundler;
  if (!bundler) {
    throw new Error(
      "[evjs] No bundler configured. Pass a bundler adapter in ev.config.ts or through dev/build options.",
    );
  }
  return bundler;
}

function withActiveBundler<TBundlerCfg>(
  config: ResolvedEvConfig<TBundlerCfg>,
  bundler: BundlerAdapter<TBundlerCfg>,
): ResolvedEvConfig<TBundlerCfg> {
  if (config.bundler === bundler) {
    return config;
  }

  return {
    ...config,
    bundler,
  };
}

async function collectPluginHooks<TBundlerCfg>(
  plugins: EvPlugin<TBundlerCfg>[],
  ctx: EvPluginContext<TBundlerCfg>,
): Promise<EvPluginHooks<TBundlerCfg>[]> {
  const allHooks: EvPluginHooks<TBundlerCfg>[] = [];
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

async function runBuildStartHooks<TBundlerCfg>(
  hooks: EvPluginHooks<TBundlerCfg>[],
): Promise<void> {
  for (const h of hooks) {
    if (h.buildStart) {
      await h.buildStart();
    }
  }
}

async function runBuildEndHooks<TBundlerCfg>(
  hooks: EvPluginHooks<TBundlerCfg>[],
  result: EvBuildResult,
): Promise<void> {
  for (const h of hooks) {
    if (h.buildEnd) {
      await h.buildEnd(result);
    }
  }
}

function validateHtmlTemplates<TBundlerCfg>(
  cwd: string,
  config: ResolvedEvConfig<TBundlerCfg>,
): void {
  if (config.pages) {
    for (const [name, page] of Object.entries(config.pages)) {
      if (!fs.existsSync(path.resolve(cwd, page.html))) {
        throw new Error(
          `[evjs] MPA page "${name}" html template not found: ${page.html}`,
        );
      }
    }
    return;
  }

  if (!fs.existsSync(path.resolve(cwd, config.html))) {
    throw new Error(`[evjs] HTML template not found: ${config.html}`);
  }
}

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

async function stopApiProcess(
  processToStop: ApiProcess,
  timeoutMs = 3000,
): Promise<void> {
  processToStop.kill();
  const exited = await Promise.race([
    processToStop.then(() => true).catch(() => true),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), timeoutMs),
    ),
  ]);

  if (!exited) {
    processToStop.kill("SIGKILL");
    await processToStop.catch(() => {});
  }
}

export async function dev<TBundlerCfg = import("@utoo/pack").ConfigComplete>(
  userConfig?: EvConfig<TBundlerCfg>,
  options?: DevOptions<TBundlerCfg>,
): Promise<void> {
  const resolvedConfig = resolveConfig(userConfig);
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "development";

  const bundler = resolveBundler(resolvedConfig.bundler, options?.bundler);
  const config = withActiveBundler(resolvedConfig, bundler);

  const pluginCtx: EvPluginContext<TBundlerCfg> = {
    mode: "development",
    cwd,
    config,
  };
  const hooks = await collectPluginHooks(config.plugins, pluginCtx);

  await runBuildStartHooks(hooks);
  validateHtmlTemplates(cwd, config);

  let apiProcess: ApiProcess | null = null;
  let isFirstBuild = true;
  let restartQueue: Promise<void> = Promise.resolve();

  const restartApiServer = async () => {
    if (!config.serverEnabled) return;

    const manifestPath = path.resolve(cwd, "dist/server/manifest.json");
    if (!fs.existsSync(manifestPath)) return;

    let manifest: ServerManifest;
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

    if (apiProcess) {
      logger.info`Restarting API server...`;
      const oldProcess = apiProcess;
      try {
        await stopApiProcess(oldProcess);
      } catch {}
      if (apiProcess === oldProcess) {
        apiProcess = null;
      }
    }

    const serverPort = config.server?.dev?.port ?? CONFIG_DEFAULTS.serverPort;
    logger.info`Server bundle detected, starting API...`;

    const bootstrapPath = path.resolve(cwd, "dist/server/_dev_start.cjs");
    try {
      const serverBundlePath = path.resolve(cwd, "dist/server", manifest.entry);

      if (!fs.existsSync(path.dirname(bootstrapPath))) {
        fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
      }
      fs.writeFileSync(
        bootstrapPath,
        [
          `(async () => {`,
          `const serverModule = await import(${JSON.stringify(pathToFileURL(serverBundlePath).href)});`,
          `const handler = serverModule.default?.default ?? serverModule.default ?? serverModule;`,
          `const { serve } = require("@evjs/server/node");`,
          `serve({ fetch: handler.fetch }, { port: ${serverPort}, https: ${JSON.stringify(config.server?.dev?.https ?? false)} });`,
          `})().catch((err) => { console.error(err); process.exit(1); });`,
        ].join("\n"),
      );

      const child = execa("node", [bootstrapPath], {
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "development" },
      });
      apiProcess = child;

      child.catch(() => {
        if (apiProcess === child) {
          apiProcess = null;
        }
      });
    } catch (err) {
      logger.error`Server runtime failed: ${err}`;
      apiProcess = null;
    }
  };

  const handleServerBundleReady = async () => {
    restartQueue = restartQueue.catch(() => {}).then(restartApiServer);
    await restartQueue;
  };

  await bundler.dev(
    config,
    cwd,
    { onServerBundleReady: handleServerBundleReady },
    hooks,
  );
}

export async function build<TBundlerCfg = import("@utoo/pack").ConfigComplete>(
  userConfig?: EvConfig<TBundlerCfg>,
  options?: BuildOptions<TBundlerCfg>,
): Promise<void> {
  const resolvedConfig = resolveConfig(userConfig);
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "production";

  const bundler = resolveBundler(resolvedConfig.bundler, options?.bundler);
  const config = withActiveBundler(resolvedConfig, bundler);

  const pluginCtx: EvPluginContext<TBundlerCfg> = {
    mode: "production",
    cwd,
    config,
  };
  const hooks = await collectPluginHooks(config.plugins, pluginCtx);

  await runBuildStartHooks(hooks);
  validateHtmlTemplates(cwd, config);

  await bundler.build(config, cwd, hooks);

  const buildResult = readBuildResult(cwd, config.serverEnabled, false);
  if (buildResult) {
    await runBuildEndHooks(hooks, buildResult);
  }
}
