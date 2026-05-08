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
  EvPluginConfigContext,
  EvPluginContext,
  EvPluginHooks,
} from "./plugin.js";

const logger = getLogger(["evjs", "ev"]);

type ApiProcess = ReturnType<typeof execa>;
const API_READY_MARKER = "__EVJS_API_READY__";

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

async function runConfigHooks<TBundlerCfg>(
  userConfig: EvConfig<TBundlerCfg> | undefined,
  ctx: EvPluginConfigContext,
): Promise<EvConfig<TBundlerCfg> | undefined> {
  let config = userConfig;

  for (const plugin of userConfig?.plugins ?? []) {
    if (!plugin.config) continue;

    const nextConfig = await plugin.config(config ?? {}, ctx);
    if (nextConfig) {
      config = nextConfig;
    }
  }

  return config;
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

function normalizeAssetName(name: string | undefined): string | undefined {
  return name?.replace(/^\.\//, "");
}

function readServerEntryFromStats(cwd: string): string | undefined {
  const statsPath = path.resolve(cwd, "dist/server/stats.json");
  if (!fs.existsSync(statsPath)) return undefined;

  try {
    const stats = JSON.parse(fs.readFileSync(statsPath, "utf-8")) as {
      entrypoints?: Record<string, { assets?: Array<{ name?: string }> }>;
    };
    const firstEntry = stats.entrypoints
      ? Object.values(stats.entrypoints)[0]
      : undefined;
    const jsAsset = firstEntry?.assets?.find((asset) =>
      asset.name?.endsWith(".js"),
    );
    return normalizeAssetName(jsAsset?.name);
  } catch (err) {
    logger.warn`Failed to parse server stats.json: ${err}`;
    return undefined;
  }
}

async function findDevServerEntry(cwd: string): Promise<string | undefined> {
  const entryFromStats = readServerEntryFromStats(cwd);
  if (entryFromStats) return entryFromStats;

  const serverDir = path.resolve(cwd, "dist/server");
  const files = await fs.promises.readdir(serverDir).catch(() => []);
  return files.find((file) => file.endsWith(".js"));
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

function forwardApiOutput(child: ApiProcess): void {
  child.stdout?.on("data", (data) => {
    const text = data.toString().replaceAll(API_READY_MARKER, "");
    if (text.length > 0) {
      process.stdout.write(text);
    }
  });
  child.stderr?.on("data", (data) => {
    process.stderr.write(data);
  });
}

function waitForApiReady(child: ApiProcess, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
      fn();
    };

    const onStdout = (data: Buffer) => {
      if (data.toString().includes(API_READY_MARKER)) {
        settle(resolve);
      }
    };
    const onStderr = (data: Buffer) => {
      if (data.toString().includes("EADDRINUSE")) {
        settle(() =>
          reject(new Error("API server port is already in use (EADDRINUSE)")),
        );
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      settle(() =>
        reject(
          new Error(
            `API server exited before it was ready (code ${code ?? "null"}, signal ${signal ?? "null"})`,
          ),
        ),
      );
    };
    const timeout = setTimeout(() => {
      settle(() =>
        reject(
          new Error(`API server did not report ready within ${timeoutMs}ms`),
        ),
      );
    }, timeoutMs);

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
  });
}

export async function dev<TBundlerCfg = import("@utoo/pack").ConfigComplete>(
  userConfig?: EvConfig<TBundlerCfg>,
  options?: DevOptions<TBundlerCfg>,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "development";
  const configuredConfig = await runConfigHooks(userConfig, {
    mode: "development",
    cwd,
  });
  const resolvedConfig = resolveConfig(configuredConfig);

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
  let restartQueue: Promise<void> = Promise.resolve();
  const expectedApiExits = new WeakSet<ApiProcess>();

  const stopApiOnParentShutdown = () => {
    if (!apiProcess) return;
    expectedApiExits.add(apiProcess);
    apiProcess.kill();
    apiProcess = null;
  };

  process.once("SIGINT", stopApiOnParentShutdown);
  process.once("SIGTERM", stopApiOnParentShutdown);

  const restartApiServer = async () => {
    if (!config.serverEnabled) return;

    const serverEntry = await findDevServerEntry(cwd);
    if (!serverEntry) return;

    if (apiProcess) {
      logger.info`Restarting API server...`;
      const oldProcess = apiProcess;
      expectedApiExits.add(oldProcess);
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
      const serverBundlePath = path.resolve(cwd, "dist/server", serverEntry);

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
          `const server = serve({ fetch: handler.fetch }, { port: ${serverPort}, https: ${JSON.stringify(config.server?.dev?.https ?? false)} });`,
          `const ready = () => console.log(${JSON.stringify(API_READY_MARKER)});`,
          `if (server.listening) ready(); else server.once("listening", ready);`,
          `server.once("error", (err) => { console.error(err); process.exit(1); });`,
          `})().catch((err) => { console.error(err); process.exit(1); });`,
        ].join("\n"),
      );

      const child = execa("node", [bootstrapPath], {
        stdio: ["inherit", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "development" },
      });
      apiProcess = child;
      forwardApiOutput(child);

      child.catch((err) => {
        if (expectedApiExits.has(child)) return;
        if (apiProcess === child) {
          apiProcess = null;
          logger.error`API server process exited unexpectedly: ${err}`;
        }
      });
      await waitForApiReady(child);
      logger.info`API server ready`;
    } catch (err) {
      logger.error`Server runtime failed: ${err}`;
      apiProcess = null;
      throw err;
    }
  };

  const handleServerBundleReady = async () => {
    restartQueue = restartQueue.catch(() => {}).then(restartApiServer);
    await restartQueue;
  };

  try {
    await bundler.dev(
      config,
      cwd,
      { onServerBundleReady: handleServerBundleReady },
      hooks,
    );
  } finally {
    process.off("SIGINT", stopApiOnParentShutdown);
    process.off("SIGTERM", stopApiOnParentShutdown);
  }
}

export async function build<TBundlerCfg = import("@utoo/pack").ConfigComplete>(
  userConfig?: EvConfig<TBundlerCfg>,
  options?: BuildOptions<TBundlerCfg>,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "production";
  const configuredConfig = await runConfigHooks(userConfig, {
    mode: "production",
    cwd,
  });
  const resolvedConfig = resolveConfig(configuredConfig);

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
