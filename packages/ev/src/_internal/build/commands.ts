import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BuildPlan,
  BuildPlanUpdate,
  CoreGraph,
} from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import { execa } from "execa";
import {
  CONFIG_DEFAULTS,
  type Config,
  type DefaultBundlerConfig,
  type ResolvedConfig,
  type ResolvedFrameworkConfig,
  resolveBundlerConfig,
  resolveConfig,
} from "../../config/index.js";
import { createDefinedPluginApplicationSettingSnapshot } from "../../plugin/defined.js";
import type {
  CliFlags,
  PluginContext,
  PluginHooks,
} from "../../plugin/index.js";
import { analyzeAndMaterializeFrameworkIR } from "./analyze-and-materialize.js";
import { createBuildResult } from "./build-result.js";
import {
  type BundlerAdapter,
  type BundlerDevController,
  isEmptyBuildPlanUpdate,
  preflightBundlerBuild,
  preflightBundlerDevUpdate,
} from "./bundler.js";
import { resolveBundler, withActiveBundler } from "./bundler-config.js";
import {
  withPageRoutingDefaults,
  withServerConventionDefaults,
  withServerRouteDiscovery,
} from "./convention-config.js";
import { DevApiProcessController } from "./dev-api-process.js";
import {
  API_READY_MARKER,
  type ApiProcess,
  acquireDevSessionLock,
  acquireProjectOperationLock,
  assertNoActiveDevDistLock,
  assertNoActiveDevSessionLock,
  type DevPortReservation,
  type DevRuntimeRelease,
  findDevServerBundlePath,
  forwardApiOutput,
  type ProjectOperation,
  reserveDevPorts,
  stopApiProcess,
  waitForApiReady,
  writeDevDistLock,
} from "./dev-runtime.js";
import {
  collectServerRouteWatchState,
  listConfigDependencyFiles,
  type ServerRouteWatchState,
  watchFiles,
} from "./dev-watch.js";
import {
  linkAndEmitBuildOutput,
  validateHtmlTemplates,
} from "./framework-output.js";
import type { createFrameworkRuntime } from "./framework-runtime.js";
import { GENERATED_IR_DIR } from "./generated-contributions.js";
import type { createCoreGraph } from "./graph/index.js";
import {
  removeOwnedOutputFile,
  writeOwnedOutputFile,
} from "./owned-file-output.js";
import {
  collectGeneratedPageRouteTypeFiles,
  getPageRouteTypesPath,
  isGeneratedPageRouteTypesFile,
} from "./page-route-types.js";
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
import {
  collectPluginSettingsRegistry,
  resolvePluginSettingsState,
} from "./plugin-settings.js";
import {
  collectGeneratedPluginTypeFiles,
  getPluginTypesPath,
  isGeneratedPluginTypesFile,
} from "./plugin-types.js";
import { isInsideCwd } from "./utils.js";

type MutablePluginContext<TBundlerCfg> = Omit<
  PluginContext<TBundlerCfg>,
  "config"
> & {
  config: ResolvedFrameworkConfig<TBundlerCfg>;
};

const logger = getLogger(["evjs", "ev"]);

const DEV_PAGE_RENDER_PROXY_HEADER = "x-evjs-dev-page-render";
const DEV_DIST_DIR = "dist";
const runtimeExitCleanups = new Set<() => void>();

function runRuntimeExitCleanups(): void {
  for (const cleanup of [...runtimeExitCleanups].reverse()) cleanup();
}

function registerRuntimeExitCleanup(cleanup: () => void): () => void {
  if (runtimeExitCleanups.size === 0) {
    process.once("exit", runRuntimeExitCleanups);
  }
  runtimeExitCleanups.add(cleanup);

  return () => {
    runtimeExitCleanups.delete(cleanup);
    if (runtimeExitCleanups.size === 0) {
      process.off("exit", runRuntimeExitCleanups);
    }
  };
}

async function releaseRegisteredRuntimeLock(
  release: DevRuntimeRelease,
  unregisterExitCleanup: () => void,
): Promise<void> {
  try {
    await release();
  } finally {
    unregisterExitCleanup();
  }
}

async function withRegisteredRuntimeLock<T>(options: {
  release: DevRuntimeRelease;
  unregisterExitCleanup: () => void;
  run: () => Promise<T>;
  cleanupErrorMessage: string;
}): Promise<T> {
  let result: T;
  try {
    result = await options.run();
  } catch (error) {
    return rethrowAfterCleanup(
      error,
      () =>
        releaseRegisteredRuntimeLock(
          options.release,
          options.unregisterExitCleanup,
        ),
      options.cleanupErrorMessage,
    );
  }
  await releaseRegisteredRuntimeLock(
    options.release,
    options.unregisterExitCleanup,
  );
  return result;
}

async function withProjectOperationLock<T>(
  cwd: string,
  operation: ProjectOperation,
  run: () => Promise<T>,
): Promise<T> {
  const release = await acquireProjectOperationLock(cwd, operation);
  const unregisterExitCleanup = registerRuntimeExitCleanup(() =>
    release.sync(),
  );
  return withRegisteredRuntimeLock({
    release,
    unregisterExitCleanup,
    run,
    cleanupErrorMessage: `[evjs] ${operation} failed and its project operation lock cleanup also failed.`,
  });
}

export interface DevOptions<TBundlerCfg = DefaultBundlerConfig> {
  cwd?: string;
  bundler?: BundlerAdapter<TBundlerCfg>;
  flags?: CliFlags;
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
  flags?: CliFlags;
}

export interface PrepareFrameworkBuildOptions<
  TBundlerCfg = DefaultBundlerConfig,
> {
  cwd?: string;
  flags?: CliFlags;
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
  config: ResolvedFrameworkConfig<TBundlerCfg>;
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
  type InspectPageRoute,
  type InspectRouteFile,
  inspectFrameworkBuild,
} from "./inspect.js";

interface InternalPrepareFrameworkBuildOptions<
  TBundlerCfg = DefaultBundlerConfig,
> extends PrepareFrameworkBuildOptions<TBundlerCfg> {
  plan?: CreateBuildPlanOptions;
}

interface InternalPreparedFrameworkBuild<TBundlerCfg = DefaultBundlerConfig>
  extends PreparedFrameworkBuild<TBundlerCfg> {
  graph: CoreGraph;
  plan: BuildPlan;
  hooks: PluginHooks<TBundlerCfg>[];
  pluginContext: PluginContext<TBundlerCfg>;
}

interface GeneratedDevStateSnapshot {
  commit(): Promise<void>;
  restore(): Promise<void>;
}

interface DevApiRuntimeState<TBundlerCfg> {
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  frameworkRuntime: ReturnType<typeof createFrameworkRuntime> | undefined;
  plan: BuildPlan;
  serverEntry: string | undefined;
}

async function createGeneratedDevStateSnapshot(
  cwd: string,
): Promise<GeneratedDevStateSnapshot> {
  const snapshotRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "evjs-dev-state-"),
  );
  const generatedIrPath = path.resolve(cwd, GENERATED_IR_DIR);
  const generatedIrSnapshot = path.join(snapshotRoot, "generated-ir");
  const generatedTypeFiles = new Map<string, Buffer | undefined>();

  try {
    const hadGeneratedIr = await pathExists(generatedIrPath);
    if (hadGeneratedIr) {
      await fs.promises.cp(generatedIrPath, generatedIrSnapshot, {
        recursive: true,
      });
    }

    await captureGeneratedTypeFile(
      generatedTypeFiles,
      getPageRouteTypesPath(cwd).file,
      await collectGeneratedPageRouteTypeFiles(cwd),
    );
    await captureGeneratedTypeFile(
      generatedTypeFiles,
      getPluginTypesPath(cwd).file,
      await collectGeneratedPluginTypeFiles(cwd),
    );

    let settled = false;
    return {
      async commit() {
        if (settled) return;
        settled = true;
        await removeDevStateSnapshot(snapshotRoot);
      },
      async restore() {
        if (settled) return;
        settled = true;
        try {
          await runCleanupTasks([
            () =>
              restoreGeneratedIr(
                cwd,
                generatedIrPath,
                generatedIrSnapshot,
                hadGeneratedIr,
              ),
            () => restoreGeneratedTypes(cwd, generatedTypeFiles),
          ]);
        } finally {
          await removeDevStateSnapshot(snapshotRoot);
        }
      },
    };
  } catch (error) {
    return rethrowAfterCleanup(
      error,
      () => fs.promises.rm(snapshotRoot, { force: true, recursive: true }),
      "[evjs] Failed to capture generated dev state and remove its incomplete snapshot.",
    );
  }
}

async function captureGeneratedTypeFile(
  snapshot: Map<string, Buffer | undefined>,
  canonicalFile: string,
  generatedFiles: readonly string[],
): Promise<void> {
  if (!(await pathExists(canonicalFile))) {
    snapshot.set(canonicalFile, undefined);
    return;
  }
  const absoluteCanonicalFile = path.resolve(canonicalFile);
  if (
    generatedFiles.some(
      (generatedFile) => path.resolve(generatedFile) === absoluteCanonicalFile,
    )
  ) {
    snapshot.set(canonicalFile, await fs.promises.readFile(canonicalFile));
  }
}

async function restoreGeneratedIr(
  cwd: string,
  generatedIrPath: string,
  generatedIrSnapshot: string,
  hadGeneratedIr: boolean,
): Promise<void> {
  if (!hadGeneratedIr) {
    await fs.promises.rm(generatedIrPath, { force: true, recursive: true });
    return;
  }

  const restoreRoot = await fs.promises.mkdtemp(
    path.join(cwd, `${GENERATED_IR_DIR}-restore-`),
  );
  const restoredIrPath = path.join(restoreRoot, "generated-ir");
  try {
    await fs.promises.cp(generatedIrSnapshot, restoredIrPath, {
      recursive: true,
    });
    await fs.promises.rm(generatedIrPath, { force: true, recursive: true });
    await fs.promises.rename(restoredIrPath, generatedIrPath);
  } finally {
    await fs.promises.rm(restoreRoot, { force: true, recursive: true });
  }
}

async function restoreGeneratedTypes(
  cwd: string,
  generatedTypeFiles: ReadonlyMap<string, Buffer | undefined>,
): Promise<void> {
  const currentGeneratedFiles = await collectGeneratedPageRouteTypeFiles(cwd);
  currentGeneratedFiles.push(...(await collectGeneratedPluginTypeFiles(cwd)));
  const filesToRestore = new Set([
    ...currentGeneratedFiles,
    ...generatedTypeFiles.keys(),
  ]);
  await runCleanupTasks(
    [...filesToRestore].map(
      (file) => () =>
        restoreGeneratedTypeFile(cwd, file, generatedTypeFiles.get(file)),
    ),
  );
}

async function restoreGeneratedTypeFile(
  cwd: string,
  file: string,
  source: Buffer | undefined,
): Promise<void> {
  if (await pathExists(file)) {
    if (!(await isGeneratedFrameworkTypeFile(cwd, file))) {
      logger.warn`Generated types rollback preserved a user-owned or symbolic-link file at ${file}; the previous framework declaration was not restored.`;
      return;
    }
    await removeOwnedOutputFile(cwd, file, "Generated types rollback");
  }

  if (source === undefined) return;
  if (await pathExists(file)) {
    logger.warn`Generated types rollback preserved a file created concurrently at ${file}; the previous framework declaration was not restored.`;
    return;
  }
  await writeOwnedOutputFile(cwd, file, source, "Generated types rollback");
}

async function isGeneratedFrameworkTypeFile(
  cwd: string,
  file: string,
): Promise<boolean> {
  const absoluteFile = path.resolve(file);
  if (absoluteFile === path.resolve(getPageRouteTypesPath(cwd).file)) {
    return isGeneratedPageRouteTypesFile(file);
  }
  if (absoluteFile === path.resolve(getPluginTypesPath(cwd).file)) {
    return isGeneratedPluginTypesFile(file);
  }
  return false;
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.promises.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function removeDevStateSnapshot(snapshotRoot: string): Promise<void> {
  try {
    await fs.promises.rm(snapshotRoot, { force: true, recursive: true });
  } catch (error) {
    logger.warn`Unable to remove generated dev state snapshot ${snapshotRoot}: ${error}`;
  }
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
      ["[evjs] CoreGraph analysis failed.", ...errors].join("\n"),
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
  const flags = options.flags;
  const configuredConfig = await runConfigHooks(userConfig, {
    mode,
    command,
    cwd,
    flags,
  });
  const pageResolvedConfig = await withPageRoutingDefaults(
    resolveConfig(configuredConfig),
    configuredConfig,
    cwd,
  );
  const rawResolvedConfig = await withServerRouteDiscovery(
    pageResolvedConfig,
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
  const baseConfig = bundler
    ? withActiveBundler(resolvedConfig, bundler)
    : resolvedConfig;
  const {
    registry: pluginSettings,
    applicationSettings: applicationPluginSettings,
  } = resolvePluginSettingsState(baseConfig, undefined, {
    reusePreparedApplicationSettings: true,
  });
  const config = baseConfig;
  const pluginWatchFiles = new Set<string>();
  const pluginContext: MutablePluginContext<TBundlerCfg> = {
    mode,
    command,
    cwd,
    config,
    flags,
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
      pluginSettings,
      applicationPluginSettings,
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
  const cwd = options.cwd ?? process.cwd();
  return withProjectOperationLock(cwd, "prepare", async () => {
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
  });
}

function formatDevServerReady(
  context: { origin: string },
  config: Pick<ResolvedConfig, "routing">,
  plan: Pick<BuildPlan, "html">,
): string {
  const pageUrls = formatDevPageUrls(context.origin, config, plan);
  const lines = [
    "App listening at:",
    ...formatDevServerAddresses(context.origin),
  ];
  if (pageUrls) {
    lines.push(
      "  Pages:",
      ...pageUrls.map((page) => `    ${page.pageId}: ${page.url}`),
    );
  }
  return lines.join("\n");
}

function formatDevServerAddresses(origin: string): string[] {
  const addresses = [`  Local: ${origin}`];
  try {
    const networkUrl = new URL(origin);
    if (networkUrl.hostname !== "localhost") return addresses;
    const networkAddress = Object.values(os.networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .find((entry) => entry.family === "IPv4" && !entry.internal);
    if (!networkAddress) return addresses;
    networkUrl.hostname = networkAddress.address;
    addresses.push(`  Network: ${networkUrl.origin}`);
  } catch {
    // Custom bundler adapters may provide a non-standard origin string.
  }
  return addresses;
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

function withReservedDevPorts<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  ports: DevPortReservation,
): ResolvedConfig<TBundlerCfg> {
  return {
    ...config,
    dev: {
      ...config.dev,
      port: ports.client.port,
    },
    server: {
      ...config.server,
      dev: {
        ...config.server.dev,
        port: ports.server.port,
      },
    },
  };
}

function logDevPortSelection(ports: DevPortReservation): void {
  const changes = [
    ports.client.port === ports.client.requestedPort
      ? undefined
      : `client ${ports.client.requestedPort} -> ${ports.client.port}`,
    ports.server.port === ports.server.requestedPort
      ? undefined
      : `server ${ports.server.requestedPort} -> ${ports.server.port}`,
  ].filter((change): change is string => Boolean(change));

  if (changes.length > 0) {
    logger.warn`Configured dev ports are unavailable; reserved ${changes.join(", ")} for this session.`;
  }
}

export async function dev<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options?: DevOptions<TBundlerCfg>,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const releaseDevSessionLock = await acquireDevSessionLock(cwd);
  const unregisterDevSessionExitCleanup = registerRuntimeExitCleanup(() =>
    releaseDevSessionLock.sync(),
  );
  return withRegisteredRuntimeLock({
    release: releaseDevSessionLock,
    unregisterExitCleanup: unregisterDevSessionExitCleanup,
    run: () =>
      withProjectOperationLock(cwd, "dev", () => runDev(userConfig, options)),
    cleanupErrorMessage:
      "[evjs] Dev failed and its session lock cleanup also failed.",
  });
}

async function runDev<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options?: DevOptions<TBundlerCfg>,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const flags = options?.flags;
  process.env.NODE_ENV ??= "development";
  const configuredConfig = await runConfigHooks(userConfig, {
    mode: "development",
    command: "dev",
    cwd,
    flags,
  });
  const baseResolvedConfig = resolveConfig(configuredConfig);
  const pageResolvedConfig = await withPageRoutingDefaults(
    baseResolvedConfig,
    configuredConfig,
    cwd,
  );
  const rawResolvedConfig = await withServerRouteDiscovery(
    pageResolvedConfig,
    cwd,
  );
  const conventionResolvedConfig = await withServerConventionDefaults(
    rawResolvedConfig,
    cwd,
  );
  const serverRouteWatchState = await collectServerRouteWatchState(
    cwd,
    baseResolvedConfig,
  );
  const requestedConfig = {
    ...conventionResolvedConfig,
    plugins: orderPluginsByDependencies(conventionResolvedConfig.plugins),
  };
  const devPorts = await reserveDevPorts(
    cwd,
    requestedConfig.dev.port,
    requestedConfig.server.dev.port,
  );
  const resolvedConfig = withReservedDevPorts(requestedConfig, devPorts);
  const unregisterDevPortsExitCleanup = registerRuntimeExitCleanup(() =>
    devPorts.releaseSync(),
  );

  try {
    await runDevSession(
      userConfig,
      configuredConfig,
      options,
      cwd,
      flags,
      resolvedConfig,
      devPorts,
      serverRouteWatchState,
    );
  } finally {
    try {
      await devPorts.release();
    } finally {
      unregisterDevPortsExitCleanup();
    }
  }
}

async function runDevSession<TBundlerCfg = DefaultBundlerConfig>(
  userConfig: Config<TBundlerCfg> | undefined,
  configuredConfig: Config<TBundlerCfg> | undefined,
  options: DevOptions<TBundlerCfg> | undefined,
  cwd: string,
  flags: CliFlags | undefined,
  resolvedConfig: ResolvedConfig<TBundlerCfg>,
  devPorts: DevPortReservation,
  initialServerRouteWatchState: ServerRouteWatchState,
): Promise<void> {
  logDevPortSelection(devPorts);

  const bundler = resolveBundler(resolvedConfig.bundler, options?.bundler);
  const baseActiveConfig = withActiveBundler(resolvedConfig, bundler);
  const initialPluginSettingsState = resolvePluginSettingsState(
    baseActiveConfig,
    undefined,
    { reusePreparedApplicationSettings: true },
  );
  let activePluginSettings = initialPluginSettingsState.registry;
  let activeApplicationPluginSettings =
    initialPluginSettingsState.applicationSettings;
  let activeConfiguredConfig = configuredConfig;
  let activeConfig = baseActiveConfig;
  let activeServerRouteWatchState = initialServerRouteWatchState;

  const pluginWatchFiles = new Set<string>();
  const bundlerConfigWatchFiles = new Set<string>();
  const addWatchFile = (file: string) => {
    pluginWatchFiles.add(path.resolve(cwd, file));
  };
  const addBundlerConfigWatchFile = (file: string) => {
    bundlerConfigWatchFiles.add(path.resolve(cwd, file));
  };
  const pluginCtx: MutablePluginContext<TBundlerCfg> = {
    mode: "development",
    command: "dev",
    cwd,
    config: activeConfig,
    flags,
    logger,
    addWatchFile,
  };
  const hooks = await collectPluginHooks(activeConfig.plugins, pluginCtx);
  let activeAnalysis: Awaited<ReturnType<typeof createCoreGraph>>;
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
      pluginSettings: activePluginSettings,
      applicationPluginSettings: activeApplicationPluginSettings,
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
  let restartQueue: Promise<void> = Promise.resolve();
  let devUpdateQueue: Promise<void> = Promise.resolve();
  let devController: BundlerDevController<TBundlerCfg> | undefined;
  let releaseDevDistLock: DevRuntimeRelease | undefined;
  let unregisterDevDistExitCleanup = () => {};
  let stopWatchingDevDependencies = () => {};
  let stopWatchingFailedConfigDependencies = () => {};
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingDevChanges = new Set<string>();
  let pendingForcedConfigReload = false;
  let activeFrameworkRuntime:
    | ReturnType<typeof createFrameworkRuntime>
    | undefined;
  let activeServerEntry: string | undefined;
  const expectedApiExits = new WeakSet<ApiProcess>();
  const apiProcessController = new DevApiProcessController<ApiProcess>({
    expectExit(process) {
      expectedApiExits.add(process);
    },
    requestStop(process) {
      process.kill();
    },
    stop: stopApiProcess,
  });
  let resolveShutdown: (() => void) | undefined;
  const waitForShutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });

  const stopApiOnParentShutdown = () => {
    apiProcessController.requestStop();
    resolveShutdown?.();
  };

  process.once("SIGINT", stopApiOnParentShutdown);
  process.once("SIGTERM", stopApiOnParentShutdown);

  const captureApiRuntimeState = (): DevApiRuntimeState<TBundlerCfg> => ({
    config: activeConfig,
    frameworkRuntime: activeFrameworkRuntime,
    plan: activePlan,
    serverEntry: activeServerEntry,
  });

  const restartApiServer = async (
    state: DevApiRuntimeState<TBundlerCfg>,
  ): Promise<boolean> => {
    const serverBundlePath = await findDevServerBundlePath(
      cwd,
      state.plan.output.serverDir,
      state.serverEntry,
    );
    if (!serverBundlePath) return false;

    const serverPort =
      state.config.server?.dev?.port ?? CONFIG_DEFAULTS.serverPort;

    const devRootDir = path.resolve(cwd, state.plan.distDir);
    const bootstrapPath = path.join(devRootDir, "_dev_start.cjs");
    try {
      await writeOwnedOutputFile(
        cwd,
        bootstrapPath,
        [
          `(async () => {`,
          `const path = require("node:path");`,
          `const { pathToFileURL } = require("node:url");`,
          `globalThis.__EVJS_FRAMEWORK_RUNTIME__ = ${JSON.stringify(state.frameworkRuntime, null, 2)};`,
          `globalThis.__EVJS_DEV_PAGE_RENDER_PROXY_HEADER__ = ${JSON.stringify(DEV_PAGE_RENDER_PROXY_HEADER)};`,
          `const serverDir = path.dirname(${JSON.stringify(serverBundlePath)});`,
          `globalThis.__EVJS_SERVER_MODULE_LOADER__ = async (asset) => { const mod = await import(pathToFileURL(path.resolve(serverDir, asset)).href); const nested = mod && typeof mod.default === "object" ? mod.default : undefined; return nested && ("default" in nested || "render" in nested) ? nested : mod; };`,
          `const serverModule = await import(${JSON.stringify(pathToFileURL(serverBundlePath).href)});`,
          `const handler = serverModule.default?.default ?? serverModule.default ?? serverModule;`,
          `const { serve } = require("@evjs/ev/_internal/server/node");`,
          `const server = serve({ fetch: handler.fetch }, { port: ${serverPort}, host: "0.0.0.0", https: ${JSON.stringify(state.config.server?.dev?.https ?? false)} });`,
          `const ready = () => console.log(${JSON.stringify(API_READY_MARKER)});`,
          `if (server.listening) ready(); else server.once("listening", ready);`,
          `server.once("error", (err) => { console.error(err); process.exit(1); });`,
          `})().catch((err) => { console.error(err); process.exit(1); });`,
        ].join("\n"),
        "Dev server bootstrap output",
      );

      if (apiProcessController.process) {
        logger.info`Restarting API server...`;
      }
      logger.info`Server bundle detected, starting API...`;
      await apiProcessController.replace(() => {
        const child = execa("node", [bootstrapPath], {
          stdio: ["inherit", "pipe", "pipe"],
          env: { ...process.env, NODE_ENV: "development" },
        });
        forwardApiOutput(child);
        child.catch((err) => {
          if (expectedApiExits.has(child)) return;
          if (apiProcessController.clearUnexpectedExit(child)) {
            logger.error`API server process exited unexpectedly: ${err}`;
          }
        });
        return child;
      }, waitForApiReady);
      const serverProtocol = state.config.server.dev.https ? "https" : "http";
      const serverOrigin = `${serverProtocol}://localhost:${serverPort}`;
      logger.info`${["API server listening at:", ...formatDevServerAddresses(serverOrigin)].join("\n")}`;
      return true;
    } catch (err) {
      logger.error`Server runtime failed: ${err}`;
      throw err;
    }
  };

  const handleServerBundleReady = async () => {
    const state = captureApiRuntimeState();
    restartQueue = restartQueue
      .catch(() => {})
      .then(() => restartApiServer(state))
      .then(() => {});
    await restartQueue;
  };

  const loadCurrentConfig = async (
    reloadConfiguredConfig: boolean,
    onServerRouteWatchState?: (state: ServerRouteWatchState) => void,
  ) => {
    const nextConfiguredConfig = reloadConfiguredConfig
      ? await runConfigHooks(
          options?.loadConfig ? await options.loadConfig(cwd) : userConfig,
          {
            mode: "development",
            command: "dev",
            cwd,
            flags,
          },
        )
      : activeConfiguredConfig;
    const nextBaseResolvedConfig = resolveConfig(nextConfiguredConfig);
    const serverRouteWatchState = await collectServerRouteWatchState(
      cwd,
      nextBaseResolvedConfig,
    );
    onServerRouteWatchState?.(serverRouteWatchState);
    const nextPageResolvedConfig = await withPageRoutingDefaults(
      nextBaseResolvedConfig,
      nextConfiguredConfig,
      cwd,
    );
    const nextRawResolvedConfig = await withServerRouteDiscovery(
      nextPageResolvedConfig,
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

    if (
      nextResolvedConfig.dev.port !== devPorts.client.requestedPort ||
      nextResolvedConfig.server.dev.port !== devPorts.server.requestedPort
    ) {
      throw new Error(
        "[evjs] dev.port or server.dev.port changed while ev dev is running. Restart ev dev to apply the new ports.",
      );
    }

    return {
      configuredConfig: nextConfiguredConfig,
      config: withActiveBundler(
        withReservedDevPorts(nextResolvedConfig, devPorts),
        bundler,
      ),
      serverRouteWatchState,
    };
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
    try {
      await runBuildStartHooks(nextHooks, nextPluginCtx);
    } catch (error) {
      return rethrowAfterCleanup(
        error,
        () => runDisposeHooks(nextHooks, nextPluginCtx),
        "[evjs] Plugin reload buildStart failed and rollback also failed.",
      );
    }

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
    const unsafeBoundary = activeServerRouteWatchState.unsafeBoundary;
    const serverRouteWatchDependencies =
      activeServerRouteWatchState.dependencies;
    const analysisFileDependencies = unsafeBoundary
      ? activeAnalysis.fileDependencies.filter(
          (file) => !isInsideCwd(unsafeBoundary, file),
        )
      : activeAnalysis.fileDependencies;
    stopWatchingDevDependencies = watchFiles(
      [
        ...listConfigDependencyFiles(cwd),
        ...analysisFileDependencies,
        ...serverRouteWatchDependencies,
        ...pluginWatchFiles,
        ...bundlerConfigWatchFiles,
      ],
      scheduleDevUpdate,
      new Set(serverRouteWatchDependencies),
    );
  };

  const clearFailedConfigDependencyWatchers = () => {
    stopWatchingFailedConfigDependencies();
    stopWatchingFailedConfigDependencies = () => {};
  };

  const watchFailedConfigDependencies = (
    state: ServerRouteWatchState | undefined,
  ) => {
    clearFailedConfigDependencyWatchers();
    if (!state || state.dependencies.length === 0) return;

    stopWatchingFailedConfigDependencies = watchFiles(
      state.dependencies,
      (file) => scheduleDevUpdate(file, true),
      new Set(state.dependencies),
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

  const handleDevDependencyChange = async (
    changedFiles: readonly string[],
    forceConfigReload = false,
  ) => {
    const configDependencyFiles = new Set(listConfigDependencyFiles(cwd));
    const isFrameworkConfigChange = changedFiles.some((file) =>
      configDependencyFiles.has(file),
    );
    const isBundlerConfigChange = changedFiles.some((file) =>
      bundlerConfigWatchFiles.has(file),
    );
    const requiresBundlerConfigReload =
      forceConfigReload || isFrameworkConfigChange || isBundlerConfigChange;
    if (requiresBundlerConfigReload) {
      clearFailedConfigDependencyWatchers();
    }
    const reason: BuildPlanUpdate["reason"] = requiresBundlerConfigReload
      ? "config"
      : "route-declaration";
    const applicationSettingSnapshot = requiresBundlerConfigReload
      ? createDefinedPluginApplicationSettingSnapshot(activeConfig.plugins)
      : undefined;
    let stagedPluginHooks:
      | Awaited<ReturnType<typeof stagePluginHooks>>
      | undefined;
    let generatedStateSnapshot: GeneratedDevStateSnapshot | undefined;
    let candidateServerRouteWatchState: ServerRouteWatchState | undefined;
    const rollbackCandidateState = () =>
      runCleanupTasks([
        () => stagedPluginHooks?.rollback(),
        () => generatedStateSnapshot?.restore(),
        () => applicationSettingSnapshot?.restore(),
      ]);

    try {
      const {
        configuredConfig: nextConfiguredConfig,
        config: baseNextConfig,
        serverRouteWatchState: nextServerRouteWatchState,
      } = await loadCurrentConfig(
        requiresBundlerConfigReload,
        requiresBundlerConfigReload
          ? (state) => {
              candidateServerRouteWatchState = state;
            }
          : (state) => {
              activeServerRouteWatchState = state;
              refreshDevDependencyWatchers();
            },
      );
      if (
        !hasSamePluginIdentity(activeConfig.plugins, baseNextConfig.plugins)
      ) {
        await rollbackCandidateState();
        logger.warn`Plugin configuration changed. Please restart ev dev to apply plugin additions, removals, or reordering.`;
        return;
      }

      const nextPluginSettings = requiresBundlerConfigReload
        ? collectPluginSettingsRegistry(baseNextConfig.plugins)
        : activePluginSettings;
      let nextApplicationPluginSettings = activeApplicationPluginSettings;
      const nextConfig: ResolvedFrameworkConfig<TBundlerCfg> = baseNextConfig;
      if (requiresBundlerConfigReload) {
        const nextPluginSettingsState = resolvePluginSettingsState(
          baseNextConfig,
          nextPluginSettings,
          { reusePreparedApplicationSettings: true },
        );
        nextApplicationPluginSettings =
          nextPluginSettingsState.applicationSettings;
      }

      validateHtmlTemplates(cwd, nextConfig);
      if (requiresBundlerConfigReload) {
        stagedPluginHooks = await stagePluginHooks(nextConfig);
      }
      generatedStateSnapshot = await createGeneratedDevStateSnapshot(cwd);
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
          pluginSettings: nextPluginSettings,
          applicationPluginSettings: nextApplicationPluginSettings,
          plan: { distDir: DEV_DIST_DIR },
          onAnalysis: reportGraphDiagnostics,
        });
      const update = diffBuildPlan(activePlan, nextPlan, reason);
      if (isEmptyBuildPlanUpdate(update) && !requiresBundlerConfigReload) {
        activeConfiguredConfig = nextConfiguredConfig;
        activeConfig = nextConfig;
        activePluginSettings = nextPluginSettings;
        activeApplicationPluginSettings = nextApplicationPluginSettings;
        activeAnalysis = nextAnalysis;
        activePlan = nextPlan;
        activeServerRouteWatchState = nextServerRouteWatchState;
        pluginCtx.config = nextConfig;
        await commitStagedPluginHooks(stagedPluginHooks);
        await generatedStateSnapshot.commit();
        applicationSettingSnapshot?.commit();
        return;
      }

      if (!devController) {
        await rollbackCandidateState();
        logger.warn`The selected bundler does not expose a dev controller. Please restart ev dev to apply framework plan changes.`;
        return;
      }

      const previousConfig = activeConfig;
      const previousConfiguredConfig = activeConfiguredConfig;
      const previousPluginSettings = activePluginSettings;
      const previousApplicationPluginSettings = activeApplicationPluginSettings;
      const previousAnalysis = activeAnalysis;
      const previousPlan = activePlan;
      const previousFrameworkRuntime = activeFrameworkRuntime;
      const previousServerEntry = activeServerEntry;
      const previousApiRuntimeState: DevApiRuntimeState<TBundlerCfg> = {
        config: previousConfig,
        frameworkRuntime: previousFrameworkRuntime,
        plan: previousPlan,
        serverEntry: previousServerEntry,
      };
      const previousApiProcess = apiProcessController.checkpoint();

      preflightBundlerBuild(bundler, nextPlan);
      preflightBundlerDevUpdate(bundler, update);

      activeConfiguredConfig = nextConfiguredConfig;
      activeConfig = nextConfig;
      activePluginSettings = nextPluginSettings;
      activeApplicationPluginSettings = nextApplicationPluginSettings;
      activeAnalysis = nextAnalysis;
      activePlan = nextPlan;
      pluginCtx.config = nextConfig;

      try {
        await devController.updatePlan(update, {
          config: nextConfig,
          configChanged: requiresBundlerConfigReload,
        });
      } catch (err) {
        activeConfiguredConfig = previousConfiguredConfig;
        activeConfig = previousConfig;
        activePluginSettings = previousPluginSettings;
        activeApplicationPluginSettings = previousApplicationPluginSettings;
        activeAnalysis = previousAnalysis;
        activePlan = previousPlan;
        activeFrameworkRuntime = previousFrameworkRuntime;
        activeServerEntry = previousServerEntry;
        pluginCtx.config = previousConfig;
        try {
          await runCleanupTasks([
            rollbackCandidateState,
            () =>
              apiProcessController.rollback(previousApiProcess, async () => {
                const restarted = await restartApiServer(
                  previousApiRuntimeState,
                );
                if (!restarted) {
                  throw new Error(
                    "[evjs] Unable to restore the previous API server because its development bundle is no longer available.",
                  );
                }
              }),
          ]);
        } catch (rollbackError) {
          if (requiresBundlerConfigReload) {
            watchFailedConfigDependencies(candidateServerRouteWatchState);
          }
          throw new AggregateError(
            [err, rollbackError],
            "[evjs] Framework plan update failed and dev state rollback also failed.",
            { cause: err },
          );
        }
        if (requiresBundlerConfigReload) {
          watchFailedConfigDependencies(candidateServerRouteWatchState);
        }
        logger.warn`Unable to apply framework plan update without restart: ${err}`;
        return;
      }
      activeServerRouteWatchState = nextServerRouteWatchState;
      await commitStagedPluginHooks(stagedPluginHooks);
      await generatedStateSnapshot.commit();
      applicationSettingSnapshot?.commit();
    } catch (err) {
      return rethrowAfterCleanup(
        err,
        async () => {
          try {
            await rollbackCandidateState();
          } finally {
            if (requiresBundlerConfigReload) {
              watchFailedConfigDependencies(candidateServerRouteWatchState);
            }
          }
        },
        "[evjs] Framework dev state update failed and rollback also failed.",
      );
    }
  };

  function scheduleDevUpdate(changedFile: string, forceConfigReload = false) {
    pendingDevChanges.add(changedFile);
    pendingForcedConfigReload ||= forceConfigReload;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      const changedFiles = [...pendingDevChanges];
      const shouldForceConfigReload = pendingForcedConfigReload;
      pendingDevChanges.clear();
      pendingForcedConfigReload = false;
      devUpdateQueue = devUpdateQueue
        .catch(() => {})
        .then(() =>
          handleDevDependencyChange(changedFiles, shouldForceConfigReload),
        )
        .catch((err) => {
          logger.warn`Failed to update framework dev state: ${err}`;
        });
    }, 50);
  }

  const cleanupDev = async () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    pendingDevChanges.clear();
    pendingForcedConfigReload = false;
    await runCleanupTasks([
      () => stopWatchingDevDependencies(),
      () => clearFailedConfigDependencyWatchers(),
      () => devUpdateQueue.catch(() => {}),
      () => clearFailedConfigDependencyWatchers(),
      () => restartQueue.catch(() => {}),
      () => apiProcessController.stop(),
      () => devController?.close?.(),
      async () => {
        try {
          await releaseDevDistLock?.();
        } finally {
          unregisterDevDistExitCleanup();
        }
      },
      () => {
        process.off("SIGINT", stopApiOnParentShutdown);
        process.off("SIGTERM", stopApiOnParentShutdown);
      },
      () => runDisposeHooks(hooks, pluginCtx),
    ]);
  };

  try {
    preflightBundlerBuild(bundler, activePlan);
    devController =
      (await bundler.dev({
        config: activeConfig,
        cwd,
        hooks,
        plan: activePlan,
        addWatchFile: addBundlerConfigWatchFile,
        callbacks: {
          onDevServerReady(context) {
            logger.info`${formatDevServerReady(
              context,
              activeConfig,
              activePlan,
            )}`;
          },
          async onBuildFacts(bundlerFacts, options) {
            const isRebuild = options?.isRebuild ?? false;
            const { output, frameworkRuntime } = await linkAndEmitBuildOutput({
              bundlerFacts,
              graph: activeAnalysis.graph,
              plan: activePlan,
              config: activeConfig,
              cwd,
              hooks,
              pluginCtx,
              isRebuild,
            });
            await runBuildEndHooks(
              hooks,
              createBuildResult(output, isRebuild, { frameworkRuntime }),
              { cwd, emittedFiles: bundlerFacts.emittedFiles },
            );
            activeFrameworkRuntime = frameworkRuntime;
            activeServerEntry = output.server.entry;
          },
          onServerBundleReady: handleServerBundleReady,
        },
      })) ?? undefined;
    releaseDevDistLock = await writeDevDistLock(cwd, activePlan.distDir);
    unregisterDevDistExitCleanup = registerRuntimeExitCleanup(() =>
      releaseDevDistLock?.sync(),
    );
    refreshDevDependencyWatchers();
    await (devController?.done
      ? Promise.race([waitForShutdown, devController.done])
      : waitForShutdown);
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
  await assertNoActiveDevSessionLock(cwd);
  return withProjectOperationLock(cwd, "build", () =>
    runBuild(userConfig, options, cwd),
  );
}

async function runBuild<TBundlerCfg = DefaultBundlerConfig>(
  userConfig: Config<TBundlerCfg> | undefined,
  options: BuildOptions<TBundlerCfg> | undefined,
  cwd: string,
): Promise<void> {
  process.env.NODE_ENV ??= "production";
  const prepared = await prepareInternalFrameworkBuild(userConfig, {
    cwd,
    mode: "production",
    command: "build",
    bundler: options?.bundler,
    flags: options?.flags,
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
    preflightBundlerBuild(bundler, prepared.plan);
    const bundlerFacts = await bundler.build({
      config: prepared.config,
      cwd,
      hooks: prepared.hooks,
      plan: prepared.plan,
      addWatchFile: prepared.pluginContext.addWatchFile,
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
      { cwd, emittedFiles: bundlerFacts.emittedFiles },
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
