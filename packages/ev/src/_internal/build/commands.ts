import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AppGraph,
  BuildPlan,
  BuildPlanUpdate,
} from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import { execa } from "execa";
import {
  CONFIG_DEFAULTS,
  type Config,
  type DefaultBundlerConfig,
  type ResolvedConfig,
  resolveBundlerConfig,
  resolveConfig,
} from "../../config/index.js";
import {
  createBuildResult,
  type PluginContext,
  type PluginHooks,
} from "../../plugin/index.js";
import { analyzeAndMaterializeFrameworkIR } from "./analyze-and-materialize.js";
import type { BundlerAdapter, BundlerDevController } from "./bundler.js";
import { resolveBundler, withActiveBundler } from "./bundler-config.js";
import {
  withPageRoutingDefaults,
  withServerConventionDefaults,
  withServerRoutingDefaults,
} from "./convention-config.js";
import {
  API_READY_MARKER,
  type ApiProcess,
  assertNoActiveDevDistLock,
  findDevServerEntry,
  forwardApiOutput,
  stopApiProcess,
  waitForApiReady,
  writeDevDistLock,
} from "./dev-runtime.js";
import {
  linkAndEmitBuildOutput,
  validateHtmlTemplates,
} from "./framework-output.js";
import type { createFrameworkRuntime } from "./framework-runtime.js";
import type { createAppGraph } from "./graph/index.js";
import { type CreateBuildPlanOptions, diffBuildPlan } from "./plan/index.js";
import {
  collectPluginHooks,
  hasSamePluginIdentity,
  orderPluginsByDependencies,
  rethrowAfterCleanup,
  runBuildEndHooks,
  runBuildStartHooks,
  runCleanupTasks,
  runConfigHooks,
  runDisposeHooks,
} from "./plugin-lifecycle.js";

const logger = getLogger(["evjs", "ev"]);

const DEV_PAGE_RENDER_PROXY_HEADER = "x-evjs-dev-page-render";
const DEV_DIST_DIR = "dist";

export interface DevOptions<TBundlerCfg = DefaultBundlerConfig> {
  cwd?: string;
  bundler?: BundlerAdapter<TBundlerCfg>;
  loadConfig?: (
    cwd: string,
  ) =>
    | Config<TBundlerCfg>
    | undefined
    | Promise<Config<TBundlerCfg> | undefined>;
}

export interface BuildOptions<TBundlerCfg = DefaultBundlerConfig> {
  cwd?: string;
  bundler?: BundlerAdapter<TBundlerCfg>;
}

export interface PrepareFrameworkBuildOptions<
  TBundlerCfg = DefaultBundlerConfig,
> {
  cwd?: string;
  mode?: "development" | "production";
  command?: "dev" | "build";
  bundler?: BundlerAdapter<TBundlerCfg>;
  requireBundler?: boolean;
  runLifecycleHooks?: boolean;
}

export interface PreparedFrameworkBuild<TBundlerCfg = DefaultBundlerConfig> {
  cwd: string;
  mode: "development" | "production";
  command: "dev" | "build";
  config: ResolvedConfig<TBundlerCfg>;
  fileDependencies: string[];
  pluginWatchFiles: string[];
  dispose(): Promise<void>;
}

export {
  type InspectBuildEntry,
  type InspectDiagnostic,
  type InspectFrameworkBuildOptions,
  type InspectFrameworkBuildResult,
  type InspectHtmlDocument,
  type InspectPageOutput,
  type InspectPageRoute,
  type InspectRouteFile,
  type InspectServerFunction,
  type InspectServerRoute,
  inspectFrameworkBuild,
} from "./inspect.js";

interface InternalPrepareFrameworkBuildOptions<
  TBundlerCfg = DefaultBundlerConfig,
> extends PrepareFrameworkBuildOptions<TBundlerCfg> {
  plan?: CreateBuildPlanOptions;
}

interface InternalPreparedFrameworkBuild<TBundlerCfg = DefaultBundlerConfig>
  extends PreparedFrameworkBuild<TBundlerCfg> {
  graph: AppGraph;
  plan: BuildPlan;
  hooks: PluginHooks<TBundlerCfg>[];
  pluginContext: PluginContext<TBundlerCfg>;
}

function isEmptyPlanUpdate(update: BuildPlanUpdate): boolean {
  return (
    update.entries.added.length === 0 &&
    update.entries.removed.length === 0 &&
    update.entries.changed.length === 0 &&
    update.html.added.length === 0 &&
    update.html.removed.length === 0 &&
    update.html.changed.length === 0 &&
    !update.serverChanged
  );
}

function reportGraphDiagnostics(analysis: {
  diagnostics: Array<{
    level: "warning" | "error";
    message: string;
    file?: string;
    line?: number;
    column?: number;
  }>;
}): void {
  const errors: string[] = [];

  for (const diagnostic of analysis.diagnostics) {
    const message = formatGraphDiagnostic(diagnostic);
    if (diagnostic.level === "error") {
      errors.push(message);
    } else {
      logger.warn`${message}`;
    }
  }

  if (errors.length > 0) {
    throw new Error(
      ["[evjs] App graph analysis failed.", ...errors].join("\n"),
    );
  }
}

function formatGraphDiagnostic(diagnostic: {
  message: string;
  file?: string;
  line?: number;
  column?: number;
}): string {
  const location = [
    diagnostic.file,
    diagnostic.line === undefined
      ? undefined
      : diagnostic.column === undefined
        ? String(diagnostic.line)
        : `${diagnostic.line}:${diagnostic.column}`,
  ]
    .filter(Boolean)
    .join(":");

  return location ? `${location} - ${diagnostic.message}` : diagnostic.message;
}

function listConfigDependencyFiles(cwd: string): string[] {
  return ["ev.config.ts", "ev.config.js", "ev.config.mjs"]
    .map((file) => path.resolve(cwd, file))
    .filter((file) => fs.existsSync(file));
}

function watchFiles(
  files: string[],
  onChange: (file: string) => void,
): () => void {
  const watchers: fs.FSWatcher[] = [];

  for (const file of [...new Set(files)]) {
    try {
      watchers.push(
        fs.watch(file, () => {
          onChange(file);
        }),
      );
    } catch {
      // The file may have been removed between graph analysis and watcher
      // setup. The next config or graph change will rebuild the watch list.
    }
  }

  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}

async function prepareInternalFrameworkBuild<
  TBundlerCfg = DefaultBundlerConfig,
>(
  userConfig?: Config<TBundlerCfg>,
  options: InternalPrepareFrameworkBuildOptions<TBundlerCfg> = {},
): Promise<InternalPreparedFrameworkBuild<TBundlerCfg>> {
  const cwd = options.cwd ?? process.cwd();
  const command =
    options.command ??
    (options.mode === "development" ? "dev" : ("build" as const));
  const expectedMode = command === "dev" ? "development" : "production";
  if (options.mode && options.mode !== expectedMode) {
    throw new Error(
      `[evjs] prepareFrameworkBuild command "${command}" must use mode "${expectedMode}".`,
    );
  }
  const mode = options.mode ?? expectedMode;
  const configuredConfig = await runConfigHooks(userConfig, {
    mode,
    command,
    cwd,
  });
  const pageResolvedConfig = await withPageRoutingDefaults(
    resolveConfig(configuredConfig),
    configuredConfig,
    cwd,
  );
  const rawResolvedConfig = await withServerRoutingDefaults(
    pageResolvedConfig,
    configuredConfig,
    cwd,
  );
  const conventionResolvedConfig = await withServerConventionDefaults(
    rawResolvedConfig,
    cwd,
  );
  const resolvedConfig = {
    ...conventionResolvedConfig,
    plugins: orderPluginsByDependencies(conventionResolvedConfig.plugins),
  };

  const optionBundler = resolveBundlerConfig<TBundlerCfg>(
    options.bundler,
    "options.bundler",
  );
  const bundler = optionBundler ?? resolvedConfig.bundler ?? undefined;
  if (options.requireBundler && !bundler) {
    throw new Error(
      "[evjs] No bundler configured. Pass a bundler adapter in ev.config.ts or through dev/build options.",
    );
  }
  const config = bundler
    ? withActiveBundler(resolvedConfig, bundler)
    : resolvedConfig;
  const pluginWatchFiles = new Set<string>();
  const pluginContext: PluginContext<TBundlerCfg> = {
    mode,
    command,
    cwd,
    config,
    logger,
    addWatchFile(file) {
      pluginWatchFiles.add(path.resolve(cwd, file));
    },
  };
  const hooks = await collectPluginHooks(config.plugins, pluginContext);
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await runDisposeHooks(hooks, pluginContext);
  };

  try {
    if (options.runLifecycleHooks ?? true) {
      await runBuildStartHooks(hooks, pluginContext);
    }
    validateHtmlTemplates(cwd, config);
    const { analysis, plan } = await analyzeAndMaterializeFrameworkIR({
      cwd,
      mode,
      command,
      config,
      pluginContext,
      plan: options.plan,
      onAnalysis: reportGraphDiagnostics,
    });

    return {
      cwd,
      mode,
      command,
      config,
      graph: analysis.graph,
      plan,
      hooks,
      pluginContext,
      fileDependencies: analysis.fileDependencies,
      pluginWatchFiles: [...pluginWatchFiles].sort(),
      dispose,
    };
  } catch (err) {
    return rethrowAfterCleanup(
      err,
      dispose,
      "[evjs] Framework preparation failed and plugin cleanup also failed.",
    );
  }
}

export async function prepareFrameworkBuild<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options: PrepareFrameworkBuildOptions<TBundlerCfg> = {},
): Promise<PreparedFrameworkBuild<TBundlerCfg>> {
  const prepared = await prepareInternalFrameworkBuild(userConfig, options);
  return {
    cwd: prepared.cwd,
    mode: prepared.mode,
    command: prepared.command,
    config: prepared.config,
    fileDependencies: prepared.fileDependencies,
    pluginWatchFiles: prepared.pluginWatchFiles,
    dispose: prepared.dispose,
  };
}

function formatDevServerReady(
  context: { origin: string },
  config: Pick<ResolvedConfig, "routing">,
  plan: Pick<BuildPlan, "html">,
): string {
  const pageUrls = formatDevPageUrls(context.origin, config, plan);
  if (!pageUrls) {
    return `Dev server ready: ${context.origin}`;
  }

  return [
    "Dev server ready:",
    `  Local: ${context.origin}`,
    "  Pages:",
    ...pageUrls.map((page) => `    ${page.pageId}: ${page.url}`),
  ].join("\n");
}

function formatDevPageUrls(
  origin: string,
  config: Pick<ResolvedConfig, "routing">,
  plan: Pick<BuildPlan, "html">,
): { pageId: string; url: string }[] | undefined {
  if (config.routing?.mode !== "mpa") return undefined;

  const htmlPageIds = new Set<string>();
  const pageUrls = plan.html.flatMap((document) => {
    const pageId = document.owner.pageId;
    if (!pageId) return [];
    htmlPageIds.add(pageId);
    return [
      {
        pageId,
        url: formatDevUrl(origin, `/${document.fileName}`),
      },
    ];
  });

  for (const route of config.routing.routes) {
    if (route.kind === "layout" || htmlPageIds.has(route.id)) continue;
    pageUrls.push({
      pageId: route.id,
      url: formatDevUrl(origin, route.path),
    });
  }

  return pageUrls.length > 0 ? pageUrls : undefined;
}

function formatDevUrl(origin: string, pathname: string): string {
  const pathWithLeadingSlash = pathname.startsWith("/")
    ? pathname
    : `/${pathname}`;
  return `${origin}${encodeURI(pathWithLeadingSlash)}`;
}

export async function dev<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options?: DevOptions<TBundlerCfg>,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "development";
  const configuredConfig = await runConfigHooks(userConfig, {
    mode: "development",
    command: "dev",
    cwd,
  });
  const pageResolvedConfig = await withPageRoutingDefaults(
    resolveConfig(configuredConfig),
    configuredConfig,
    cwd,
  );
  const rawResolvedConfig = await withServerRoutingDefaults(
    pageResolvedConfig,
    configuredConfig,
    cwd,
  );
  const conventionResolvedConfig = await withServerConventionDefaults(
    rawResolvedConfig,
    cwd,
  );
  const resolvedConfig = {
    ...conventionResolvedConfig,
    plugins: orderPluginsByDependencies(conventionResolvedConfig.plugins),
  };

  const bundler = resolveBundler(resolvedConfig.bundler, options?.bundler);
  let activeConfig = withActiveBundler(resolvedConfig, bundler);

  const pluginWatchFiles = new Set<string>();
  const addWatchFile = (file: string) => {
    pluginWatchFiles.add(path.resolve(cwd, file));
  };
  const pluginCtx: PluginContext<TBundlerCfg> = {
    mode: "development",
    command: "dev",
    cwd,
    config: activeConfig,
    logger,
    addWatchFile,
  };
  const hooks = await collectPluginHooks(activeConfig.plugins, pluginCtx);
  let activeAnalysis: Awaited<ReturnType<typeof createAppGraph>>;
  let activePlan: BuildPlan;
  try {
    await runBuildStartHooks(hooks, pluginCtx);
    validateHtmlTemplates(cwd, activeConfig);
    const materialized = await analyzeAndMaterializeFrameworkIR({
      cwd,
      mode: "development",
      command: "dev",
      config: activeConfig,
      pluginContext: pluginCtx,
      plan: { distDir: DEV_DIST_DIR },
      onAnalysis: reportGraphDiagnostics,
    });
    activeAnalysis = materialized.analysis;
    activePlan = materialized.plan;
    await assertNoActiveDevDistLock(cwd, activePlan.distDir);
  } catch (error) {
    return rethrowAfterCleanup(
      error,
      () => runDisposeHooks(hooks, pluginCtx),
      "[evjs] Dev initialization failed and plugin cleanup also failed.",
    );
  }
  let apiProcess: ApiProcess | null = null;
  let restartQueue: Promise<void> = Promise.resolve();
  let devUpdateQueue: Promise<void> = Promise.resolve();
  let devController: BundlerDevController | undefined;
  let releaseDevDistLock: (() => Promise<void>) | undefined;
  let stopWatchingDevDependencies = () => {};
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingDevChanges = new Set<string>();
  let activeFrameworkRuntime:
    | ReturnType<typeof createFrameworkRuntime>
    | undefined;
  const expectedApiExits = new WeakSet<ApiProcess>();
  let resolveShutdown: (() => void) | undefined;
  const waitForShutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });

  const stopApiOnParentShutdown = () => {
    if (apiProcess) {
      expectedApiExits.add(apiProcess);
      apiProcess.kill();
      apiProcess = null;
    }
    resolveShutdown?.();
  };

  process.once("SIGINT", stopApiOnParentShutdown);
  process.once("SIGTERM", stopApiOnParentShutdown);

  const restartApiServer = async () => {
    const serverEntry = await findDevServerEntry(cwd, activePlan.distDir);
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

    const serverPort =
      activeConfig.server?.dev?.port ?? CONFIG_DEFAULTS.serverPort;
    logger.info`Server bundle detected, starting API...`;

    const devRootDir = path.resolve(cwd, activePlan.distDir);
    const bootstrapPath = path.join(devRootDir, "_dev_start.cjs");
    try {
      const serverBundlePath = path.join(devRootDir, "server", serverEntry);

      if (!fs.existsSync(path.dirname(bootstrapPath))) {
        fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
      }
      fs.writeFileSync(
        bootstrapPath,
        [
          `(async () => {`,
          `const path = require("node:path");`,
          `const { pathToFileURL } = require("node:url");`,
          `globalThis.__EVJS_FRAMEWORK_RUNTIME__ = ${JSON.stringify(activeFrameworkRuntime, null, 2)};`,
          `globalThis.__EVJS_DEV_PAGE_RENDER_PROXY_HEADER__ = ${JSON.stringify(DEV_PAGE_RENDER_PROXY_HEADER)};`,
          `const serverDir = path.dirname(${JSON.stringify(serverBundlePath)});`,
          `globalThis.__EVJS_SERVER_MODULE_LOADER__ = async (asset) => { const mod = await import(pathToFileURL(path.resolve(serverDir, asset)).href); const nested = mod && typeof mod.default === "object" ? mod.default : undefined; return nested && ("default" in nested || "render" in nested) ? nested : mod; };`,
          `const serverModule = await import(${JSON.stringify(pathToFileURL(serverBundlePath).href)});`,
          `const handler = serverModule.default?.default ?? serverModule.default ?? serverModule;`,
          `const { serve } = require("@evjs/ev/_internal/server/node");`,
          `const server = serve({ fetch: handler.fetch }, { port: ${serverPort}, https: ${JSON.stringify(activeConfig.server?.dev?.https ?? false)} });`,
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

  const loadCurrentConfig = async () => {
    const nextUserConfig = options?.loadConfig
      ? await options.loadConfig(cwd)
      : userConfig;
    const nextConfiguredConfig = await runConfigHooks(nextUserConfig, {
      mode: "development",
      command: "dev",
      cwd,
    });
    const nextPageResolvedConfig = await withPageRoutingDefaults(
      resolveConfig(nextConfiguredConfig),
      nextConfiguredConfig,
      cwd,
    );
    const nextRawResolvedConfig = await withServerRoutingDefaults(
      nextPageResolvedConfig,
      nextConfiguredConfig,
      cwd,
    );
    const nextConventionResolvedConfig = await withServerConventionDefaults(
      nextRawResolvedConfig,
      cwd,
    );
    const nextResolvedConfig = {
      ...nextConventionResolvedConfig,
      plugins: orderPluginsByDependencies(nextConventionResolvedConfig.plugins),
    };

    return withActiveBundler(nextResolvedConfig, bundler);
  };

  const stagePluginHooks = async (nextConfig: typeof activeConfig) => {
    const previousConfig = activeConfig;
    const previousHooks = [...hooks];
    const previousPluginWatchFiles = [...pluginWatchFiles];
    const nextPluginWatchFiles = new Set<string>();
    const nextPluginCtx: PluginContext<TBundlerCfg> = {
      ...pluginCtx,
      config: nextConfig,
      addWatchFile(file) {
        nextPluginWatchFiles.add(path.resolve(cwd, file));
      },
    };
    const nextHooks = await collectPluginHooks(
      nextConfig.plugins,
      nextPluginCtx,
    );

    hooks.splice(0, hooks.length, ...nextHooks);
    pluginWatchFiles.clear();
    for (const file of nextPluginWatchFiles) {
      pluginWatchFiles.add(file);
    }
    pluginCtx.config = nextConfig;
    let settled = false;

    return {
      async commit() {
        if (settled) return;
        settled = true;
        await runDisposeHooks(previousHooks, {
          ...pluginCtx,
          config: previousConfig,
        });
      },
      async rollback() {
        if (settled) return;
        settled = true;
        try {
          await runDisposeHooks(nextHooks, {
            ...pluginCtx,
            config: nextConfig,
          });
        } finally {
          hooks.splice(0, hooks.length, ...previousHooks);
          pluginWatchFiles.clear();
          for (const file of previousPluginWatchFiles) {
            pluginWatchFiles.add(file);
          }
          pluginCtx.config = previousConfig;
        }
      },
    };
  };

  const refreshDevDependencyWatchers = () => {
    stopWatchingDevDependencies();
    stopWatchingDevDependencies = watchFiles(
      [
        ...listConfigDependencyFiles(cwd),
        ...activeAnalysis.fileDependencies,
        ...pluginWatchFiles,
      ],
      scheduleDevUpdate,
    );
  };

  const commitStagedPluginHooks = async (
    stagedPluginHooks: Awaited<ReturnType<typeof stagePluginHooks>> | undefined,
  ) => {
    try {
      await stagedPluginHooks?.commit();
    } catch (error) {
      logger.warn`Framework plan update was applied, but previous plugin cleanup failed: ${error}`;
    } finally {
      refreshDevDependencyWatchers();
    }
  };

  const handleDevDependencyChange = async (changedFiles: readonly string[]) => {
    const configDependencyFiles = new Set(listConfigDependencyFiles(cwd));
    const isConfigChange = changedFiles.some((file) =>
      configDependencyFiles.has(file),
    );
    const reason: BuildPlanUpdate["reason"] = isConfigChange
      ? "config"
      : "route-declaration";

    const nextConfig = await loadCurrentConfig();
    if (!hasSamePluginIdentity(activeConfig.plugins, nextConfig.plugins)) {
      logger.warn`Plugin configuration changed. Please restart ev dev to apply plugin additions, removals, or reordering.`;
      return;
    }

    validateHtmlTemplates(cwd, nextConfig);
    let stagedPluginHooks:
      | Awaited<ReturnType<typeof stagePluginHooks>>
      | undefined;
    if (isConfigChange) {
      stagedPluginHooks = await stagePluginHooks(nextConfig);
    }

    try {
      const { analysis: nextAnalysis, plan: nextPlan } =
        await analyzeAndMaterializeFrameworkIR({
          cwd,
          mode: "development",
          command: "dev",
          config: nextConfig,
          pluginContext: {
            ...pluginCtx,
            config: nextConfig,
          },
          plan: { distDir: DEV_DIST_DIR },
          onAnalysis: reportGraphDiagnostics,
        });
      const update = diffBuildPlan(activePlan, nextPlan, reason);
      if (isEmptyPlanUpdate(update)) {
        activeConfig = nextConfig;
        activeAnalysis = nextAnalysis;
        activePlan = nextPlan;
        pluginCtx.config = nextConfig;
        await commitStagedPluginHooks(stagedPluginHooks);
        return;
      }

      if (!devController) {
        await stagedPluginHooks?.rollback();
        logger.warn`The selected bundler does not expose a dev controller. Please restart ev dev to apply framework plan changes.`;
        return;
      }

      const previousConfig = activeConfig;
      const previousAnalysis = activeAnalysis;
      const previousPlan = activePlan;

      activeConfig = nextConfig;
      activeAnalysis = nextAnalysis;
      activePlan = nextPlan;

      try {
        await devController.updatePlan(update, nextAnalysis.graph);
      } catch (err) {
        activeConfig = previousConfig;
        activeAnalysis = previousAnalysis;
        activePlan = previousPlan;
        pluginCtx.config = previousConfig;
        await stagedPluginHooks?.rollback();
        logger.warn`Unable to apply framework plan update without restart: ${err}`;
        return;
      }
      pluginCtx.config = nextConfig;
      await commitStagedPluginHooks(stagedPluginHooks);
    } catch (err) {
      await stagedPluginHooks?.rollback();
      throw err;
    }
  };

  function scheduleDevUpdate(changedFile: string) {
    pendingDevChanges.add(changedFile);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      const changedFiles = [...pendingDevChanges];
      pendingDevChanges.clear();
      devUpdateQueue = devUpdateQueue
        .catch(() => {})
        .then(() => handleDevDependencyChange(changedFiles))
        .catch((err) => {
          logger.warn`Failed to update framework dev state: ${err}`;
        });
    }, 50);
  }

  const cleanupDev = async () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    pendingDevChanges.clear();
    await runCleanupTasks([
      () => stopWatchingDevDependencies(),
      () => devController?.close?.(),
      () => releaseDevDistLock?.(),
      () => {
        process.off("SIGINT", stopApiOnParentShutdown);
        process.off("SIGTERM", stopApiOnParentShutdown);
      },
      () => runDisposeHooks(hooks, pluginCtx),
    ]);
  };

  try {
    devController =
      (await bundler.dev({
        config: activeConfig,
        cwd,
        hooks,
        graph: activeAnalysis.graph,
        plan: activePlan,
        callbacks: {
          onDevServerReady(context) {
            logger.info`${formatDevServerReady(
              context,
              activeConfig,
              activePlan,
            )}`;
          },
          async onBuildFacts(bundlerFacts, options) {
            const { frameworkRuntime } = await linkAndEmitBuildOutput({
              bundlerFacts,
              graph: activeAnalysis.graph,
              plan: activePlan,
              config: activeConfig,
              cwd,
              hooks,
              pluginCtx,
              isRebuild: options?.isRebuild ?? false,
            });
            activeFrameworkRuntime = frameworkRuntime;
          },
          onServerBundleReady: handleServerBundleReady,
        },
      })) ?? undefined;
    releaseDevDistLock = await writeDevDistLock(cwd, activePlan.distDir);
    refreshDevDependencyWatchers();
    await waitForShutdown;
  } catch (error) {
    return rethrowAfterCleanup(
      error,
      cleanupDev,
      "[evjs] Dev failed and cleanup also failed.",
    );
  }
  await cleanupDev();
}

export async function build<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options?: BuildOptions<TBundlerCfg>,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "production";
  const prepared = await prepareInternalFrameworkBuild(userConfig, {
    cwd,
    mode: "production",
    command: "build",
    bundler: options?.bundler,
    requireBundler: true,
  });
  const bundler = prepared.config.bundler;
  if (!bundler) {
    await prepared.dispose();
    throw new Error(
      "[evjs] No bundler configured. Pass a bundler adapter in ev.config.ts or through dev/build options.",
    );
  }
  try {
    await assertNoActiveDevDistLock(cwd, prepared.plan.distDir);
    const bundlerFacts = await bundler.build({
      config: prepared.config,
      cwd,
      hooks: prepared.hooks,
      graph: prepared.graph,
      plan: prepared.plan,
    });
    const { output, frameworkRuntime } = await linkAndEmitBuildOutput({
      bundlerFacts,
      graph: prepared.graph,
      plan: prepared.plan,
      config: prepared.config,
      cwd,
      hooks: prepared.hooks,
      pluginCtx: prepared.pluginContext,
      isRebuild: false,
    });

    await runBuildEndHooks(
      prepared.hooks,
      createBuildResult(output, false, { frameworkRuntime }),
    );
  } catch (error) {
    return rethrowAfterCleanup(
      error,
      prepared.dispose,
      "[evjs] Build failed and plugin cleanup also failed.",
    );
  }
  await prepared.dispose();
}
