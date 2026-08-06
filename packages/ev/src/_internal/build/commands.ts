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
  type ResolvedConfig,
  type ResolvedFrameworkConfig,
  resolveBundlerConfig,
  resolveConfig,
} from "../../config/index.js";
import type {
  CliFlags,
  PluginDevSession,
  PluginHooks,
  PluginSetupContext,
} from "../../plugin/index.js";
import { analyzeAndMaterializeFrameworkIR } from "./analyze-and-materialize.js";
import { createBuildResult } from "./build-result.js";
import {
  type BundlerAdapter,
  type BundlerBuildFacts,
  type BundlerDevController,
  type BundlerDevGeneration,
  type BundlerDevUpdateTransition,
  preflightBundlerBuild,
  preflightBundlerDevUpdate,
} from "./bundler.js";
import { resolveBundler, withActiveBundler } from "./bundler-config.js";
import { bindCLIShortcuts, type UnbindCLIShortcuts } from "./cli-shortcuts.js";
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
  collectRouteDirectoryWatchState,
  collectServerRouteWatchState,
  collectWatchFilesChangedSince,
  createWatchFilesPlan,
  listConfigDependencyFiles,
  type PreparedWatchFilesPlan,
  prepareWatchFilesPlan,
  type RouteDirectoryWatchState,
  resolveInitialDevWatchMode,
  type WatchFilesPlan,
  watchFiles,
} from "./dev-watch.js";
import {
  createFrameworkOutputSnapshot,
  type FrameworkOutputSnapshot,
  linkAndEmitBuildOutput,
  validateHtmlTemplates,
} from "./framework-output.js";
import {
  type createFrameworkRuntime,
  serializeFrameworkRuntimeExpression,
} from "./framework-runtime.js";
import { GENERATED_IR_DIR } from "./generated-contributions.js";
import type { createCoreGraph } from "./graph/index.js";
import {
  removeOwnedOutputFile,
  writeOwnedOutputFile,
} from "./owned-file-output.js";
import { CANONICAL_PAGE_ROUTE_ROOT } from "./page-route-conventions.js";
import {
  collectGeneratedPageRouteTypeFiles,
  getPageRouteTypesPath,
  isGeneratedPageRouteTypesFile,
} from "./page-route-types.js";
import { type CreateBuildPlanOptions, diffBuildPlan } from "./plan/index.js";
import {
  collectConfigureShortcutsHooks,
  collectPluginHooks,
  hasSamePluginIdentity,
  orderPluginsByDependencies,
  rethrowAfterCleanup,
  runAfterBuildHooks,
  runCleanupTasks,
  runConfigureHooks,
  runDisposeHooks,
  snapshotPluginFlags,
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
import { createProductionOutputTransaction } from "./production-output-transaction.js";
import { CANONICAL_SERVER_ROUTE_ROOT } from "./server-route-conventions.js";
import { isInsideCwd } from "./utils.js";

const DEV_CLI_SHORTCUT_ACTION_DRAIN_TIMEOUT_MS = 1_000;

type MutablePluginSetupContext<TBundlerCfg> = Omit<
  PluginSetupContext<TBundlerCfg>,
  "config"
> & {
  config: ResolvedFrameworkConfig<TBundlerCfg>;
};

interface DevCycleTracker {
  beginCycle(): () => void;
  waitForIdle(): Promise<void>;
}

interface DevPluginExecutionSnapshot<TBundlerCfg> extends DevCycleTracker {
  readonly hooks: PluginHooks<TBundlerCfg>[];
  readonly context: MutablePluginSetupContext<TBundlerCfg>;
}

interface ScheduledDevChangeSnapshot {
  forceConfigReload: boolean;
  snapshot: string;
}

/** Record one observed dependency state and report whether it needs an update. */
export function recordDevChangeSnapshot(
  previousChanges: Map<string, ScheduledDevChangeSnapshot>,
  file: string,
  snapshot: string | undefined,
  forceConfigReload: boolean,
): boolean {
  if (snapshot === undefined) {
    previousChanges.delete(file);
    return true;
  }
  const previous = previousChanges.get(file);
  // A candidate watcher may upgrade the same file state from a route
  // invalidation to a required config reload; that stronger retry stays.
  if (
    previous?.snapshot === snapshot &&
    (previous.forceConfigReload || !forceConfigReload)
  ) {
    return false;
  }
  previousChanges.set(file, { forceConfigReload, snapshot });
  return true;
}

interface DevFrameworkOutputTransaction {
  beginCycle(): (() => void) | undefined;
  capture(): Promise<void>;
  deferAfterBuild(run: () => Promise<void>): void;
  prepareCommit(): Promise<void>;
  commit(): void;
  runAfterBuild(): Promise<void>;
  restore(): Promise<void>;
}

function createDevCycleTracker(): DevCycleTracker {
  let inFlightCycles = 0;
  let resolveIdle: (() => void) | undefined;
  let idle: Promise<void> | undefined;

  return {
    beginCycle() {
      inFlightCycles += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlightCycles -= 1;
        if (inFlightCycles !== 0) return;
        resolveIdle?.();
        resolveIdle = undefined;
        idle = undefined;
      };
    },
    waitForIdle() {
      if (inFlightCycles === 0) return Promise.resolve();
      idle ??= new Promise<void>((resolve) => {
        resolveIdle = resolve;
      });
      return idle;
    },
  };
}

function createDevFrameworkOutputTransaction(
  cwd: string,
  plans: readonly BuildPlan[],
): DevFrameworkOutputTransaction {
  const cycles = createDevCycleTracker();
  let snapshot: Promise<FrameworkOutputSnapshot> | undefined;
  let capturedSnapshot: FrameworkOutputSnapshot | undefined;
  let phase: "open" | "settling" | "settled" = "open";
  let committed = false;
  let deferredAfterBuild: (() => Promise<void>) | undefined;

  function seal(): void {
    if (phase === "open") phase = "settling";
  }

  return {
    beginCycle() {
      if (phase !== "open") return undefined;
      return cycles.beginCycle();
    },
    async capture() {
      // A registered cycle may reach the FIFO after settlement starts. The
      // transaction waits its lease, so that cycle must still capture the
      // pre-publication state before it writes canonical output.
      snapshot ??= createFrameworkOutputSnapshot(cwd, plans);
      capturedSnapshot = await snapshot;
    },
    deferAfterBuild(run) {
      if (phase === "settled") {
        throw new Error(
          "[evjs] Cannot defer afterBuild after the framework output transaction settles.",
        );
      }
      // Only the last output written inside the transaction becomes canonical.
      deferredAfterBuild = run;
    },
    async prepareCommit() {
      if (phase === "settled") return;
      seal();
      await cycles.waitForIdle();
      capturedSnapshot = await snapshot;
    },
    commit() {
      if (phase === "settled") return;
      if (phase !== "settling") {
        throw new Error(
          "[evjs] Cannot commit framework output before preparing the transaction.",
        );
      }
      capturedSnapshot?.commit();
      committed = true;
      phase = "settled";
    },
    async runAfterBuild() {
      if (phase !== "settled" || !committed) {
        throw new Error(
          "[evjs] Cannot run deferred afterBuild before committing framework output.",
        );
      }
      const run = deferredAfterBuild;
      deferredAfterBuild = undefined;
      await run?.();
    },
    async restore() {
      if (phase === "settled") return;
      seal();
      await cycles.waitForIdle();
      try {
        capturedSnapshot = await snapshot;
      } catch {
        // Capture is read-only. Its rejection is already the update failure,
        // so there is no framework output to restore here.
        deferredAfterBuild = undefined;
        phase = "settled";
        return;
      }
      deferredAfterBuild = undefined;
      await capturedSnapshot?.restore();
      phase = "settled";
    },
  };
}

function createDevPluginExecutionSnapshot<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  context: MutablePluginSetupContext<TBundlerCfg>,
): DevPluginExecutionSnapshot<TBundlerCfg> {
  return {
    hooks: [...hooks],
    context,
    ...createDevCycleTracker(),
  };
}

const logger = getLogger(["evjs", "ev"]);

const DEV_PAGE_RENDER_PROXY_HEADER = "x-evjs-dev-page-render";
const DEV_DIST_DIR = "dist";

interface InitialDevWatchPlans {
  config: PreparedWatchFilesPlan;
  configDependencies: ReadonlyMap<string, PreparedWatchFilesPlan>;
  pageRoutes?: PreparedWatchFilesPlan;
  serverRoutes?: PreparedWatchFilesPlan;
}

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

export interface DevOptions<TBundlerCfg = unknown> {
  cwd?: string;
  bundler?: BundlerAdapter<TBundlerCfg>;
  /** Adapter used only when neither config nor options selects a bundler. */
  fallbackBundler?: BundlerAdapter<TBundlerCfg>;
  flags?: CliFlags;
  /** Reload the initial config through loadConfig inside the watcher handshake. */
  reloadInitialConfig?: boolean;
  /**
   * Disable the interactive CLI shortcuts engine regardless of
   * `ev.config.ts` (mirrors `ev dev --no-shortcuts`). Only `false` is
   * meaningful; undefined defers to the resolved `dev.cliShortcuts` value
   * (default on).
   */
  cliShortcuts?: false;
  loadConfig?: (
    cwd: string,
    context?: {
      onDependency(file: string): void;
    },
  ) =>
    | Config<TBundlerCfg>
    | undefined
    | Promise<Config<TBundlerCfg> | undefined>;
}

export interface BuildOptions<TBundlerCfg = unknown> {
  cwd?: string;
  bundler?: BundlerAdapter<TBundlerCfg>;
  flags?: CliFlags;
}

export interface PrepareFrameworkBuildOptions<TBundlerCfg = unknown> {
  cwd?: string;
  flags?: CliFlags;
  mode?: "development" | "production";
  bundler?: BundlerAdapter<TBundlerCfg>;
  requireBundler?: boolean;
}

export interface PreparedFrameworkBuild<TBundlerCfg = unknown> {
  cwd: string;
  mode: "development" | "production";
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

interface InternalPrepareFrameworkBuildOptions<TBundlerCfg = unknown>
  extends PrepareFrameworkBuildOptions<TBundlerCfg> {
  plan?: CreateBuildPlanOptions;
}

interface InternalPreparedFrameworkBuild<TBundlerCfg = unknown>
  extends PreparedFrameworkBuild<TBundlerCfg> {
  graph: CoreGraph;
  plan: BuildPlan;
  hooks: PluginHooks<TBundlerCfg>[];
  pluginContext: PluginSetupContext<TBundlerCfg>;
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

/**
 * Apply the programmatic `cliShortcuts` override (e.g. `ev dev --no-shortcuts`)
 * to the configure-hook output before resolution. `false` forces the engine
 * off; undefined defers to the user's `ev.config.ts` → `dev.cliShortcuts`.
 * Returns the input untouched when there is nothing to do.
 */
function withCliShortcutsOverride<TBundlerCfg>(
  config: Config<TBundlerCfg> | undefined,
  override: false | undefined,
): Config<TBundlerCfg> | undefined {
  if (override !== false) return config;
  return {
    ...(config ?? {}),
    dev: {
      ...(config?.dev ?? {}),
      cliShortcuts: false,
    },
  };
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

async function prepareInternalFrameworkBuild<TBundlerCfg = unknown>(
  userConfig?: Config<TBundlerCfg>,
  options: InternalPrepareFrameworkBuildOptions<TBundlerCfg> = {},
): Promise<InternalPreparedFrameworkBuild<TBundlerCfg>> {
  const cwd = options.cwd ?? process.cwd();
  const mode = options.mode ?? "production";
  const flags = snapshotPluginFlags(options.flags);
  const configuredConfig = await runConfigureHooks(userConfig, {
    mode,
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
  } = resolvePluginSettingsState(baseConfig);
  const config = baseConfig;
  const pluginWatchFiles = new Set<string>();
  const pluginContext: MutablePluginSetupContext<TBundlerCfg> = {
    mode,
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
    validateHtmlTemplates(cwd, config);
    const { analysis, plan } = await analyzeAndMaterializeFrameworkIR({
      cwd,
      mode,
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

export async function prepareFrameworkBuild<TBundlerCfg = unknown>(
  userConfig?: Config<TBundlerCfg>,
  options: PrepareFrameworkBuildOptions<TBundlerCfg> = {},
): Promise<PreparedFrameworkBuild<TBundlerCfg>> {
  const cwd = options.cwd ?? process.cwd();
  return withProjectOperationLock(cwd, "prepare", async () => {
    const prepared = await prepareInternalFrameworkBuild(userConfig, options);
    return {
      cwd: prepared.cwd,
      mode: prepared.mode,
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

function prepareDevWatchPlan(
  dependencies: readonly string[],
): PreparedWatchFilesPlan {
  return prepareWatchFilesPlan(
    createWatchFilesPlan(dependencies, new Set(dependencies)),
  );
}

function listConfiguredAnalysisWatchDependencies<TBundlerCfg>(
  cwd: string,
  config: ResolvedConfig<TBundlerCfg>,
): string[] {
  return (config.routing?.dependencies ?? []).map((dependency) =>
    path.resolve(cwd, dependency),
  );
}

function listInitialRouteWatchDependencies(
  root: string,
  state: RouteDirectoryWatchState,
): string[] {
  if (state.unsafeBoundary !== root) return state.dependencies;
  try {
    if (fs.lstatSync(root).isSymbolicLink()) return state.dependencies;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [root];
    throw error;
  }
  return state.dependencies;
}

export async function dev<TBundlerCfg = unknown>(
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

async function runDev<TBundlerCfg = unknown>(
  userConfig?: Config<TBundlerCfg>,
  options?: DevOptions<TBundlerCfg>,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const flags = snapshotPluginFlags(options?.flags);
  process.env.NODE_ENV ??= "development";
  const initialConfigWatchPlan = prepareDevWatchPlan(
    listConfigDependencyFiles(cwd),
  );
  const initialConfigDependencyBaselines = new Map<
    string,
    PreparedWatchFilesPlan
  >();
  const configLoader = options?.loadConfig;
  const shouldLoadInitialConfig =
    configLoader !== undefined &&
    (options?.reloadInitialConfig === true || userConfig === undefined);
  const initialUserConfig =
    shouldLoadInitialConfig && configLoader
      ? await configLoader(cwd, {
          onDependency(file) {
            const absolute = path.resolve(file);
            if (initialConfigDependencyBaselines.has(absolute)) return;
            initialConfigDependencyBaselines.set(
              absolute,
              prepareDevWatchPlan([absolute]),
            );
          },
        })
      : userConfig;
  const configuredConfig = withCliShortcutsOverride(
    await runConfigureHooks(initialUserConfig, {
      mode: "development",
      cwd,
      flags,
    }),
    options?.cliShortcuts,
  );
  const baseResolvedConfig = resolveConfig(configuredConfig);
  const pageRoot = baseResolvedConfig.application
    ? path.resolve(cwd, baseResolvedConfig.application.pageRoot)
    : path.resolve(cwd, CANONICAL_PAGE_ROUTE_ROOT);
  const serverRoot = path.resolve(cwd, CANONICAL_SERVER_ROUTE_ROOT);
  const [initialPageRouteWatchState, initialServerRouteWatchState] =
    await Promise.all([
      baseResolvedConfig.application ||
      (baseResolvedConfig.conventions !== false &&
        configuredConfig?.routing !== undefined)
        ? collectRouteDirectoryWatchState(cwd, pageRoot)
        : undefined,
      baseResolvedConfig.conventions !== false
        ? collectRouteDirectoryWatchState(cwd, serverRoot)
        : undefined,
    ]);
  const initialDevWatchPlans: InitialDevWatchPlans = {
    config: initialConfigWatchPlan,
    configDependencies: initialConfigDependencyBaselines,
    ...(initialPageRouteWatchState
      ? {
          pageRoutes: prepareDevWatchPlan(
            listInitialRouteWatchDependencies(
              pageRoot,
              initialPageRouteWatchState,
            ),
          ),
        }
      : {}),
    ...(initialServerRouteWatchState
      ? {
          serverRoutes: prepareDevWatchPlan(
            listInitialRouteWatchDependencies(
              serverRoot,
              initialServerRouteWatchState,
            ),
          ),
        }
      : {}),
  };
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
      initialUserConfig,
      configuredConfig,
      options,
      cwd,
      flags,
      resolvedConfig,
      devPorts,
      initialPageRouteWatchState ?? { dependencies: [] },
      serverRouteWatchState,
      initialDevWatchPlans,
    );
  } finally {
    try {
      await devPorts.release();
    } finally {
      unregisterDevPortsExitCleanup();
    }
  }
}

async function runDevSession<TBundlerCfg = unknown>(
  userConfig: Config<TBundlerCfg> | undefined,
  configuredConfig: Config<TBundlerCfg> | undefined,
  options: DevOptions<TBundlerCfg> | undefined,
  cwd: string,
  flags: PluginSetupContext<TBundlerCfg>["flags"],
  resolvedConfig: ResolvedConfig<TBundlerCfg>,
  devPorts: DevPortReservation,
  initialPageRouteWatchState: RouteDirectoryWatchState,
  initialServerRouteWatchState: RouteDirectoryWatchState,
  initialDevWatchPlans: InitialDevWatchPlans,
): Promise<void> {
  type WatchGeneration = {
    readonly key: string;
    readonly stop: () => void;
  };
  type CandidateWatchGeneration = WatchGeneration & {
    readonly dependencies: ReadonlySet<string>;
    readonly requiresConfigReload: boolean;
  };

  logDevPortSelection(devPorts);

  const bundler = resolveBundler(
    resolvedConfig.bundler ?? options?.fallbackBundler,
    options?.bundler,
  );
  const baseActiveConfig = withActiveBundler(resolvedConfig, bundler);
  const initialPluginSettingsState =
    resolvePluginSettingsState(baseActiveConfig);
  let activePluginSettings = initialPluginSettingsState.registry;
  let activeApplicationPluginSettings =
    initialPluginSettingsState.applicationSettings;
  let activeConfiguredConfig = configuredConfig;
  let activeConfig = baseActiveConfig;
  let activePageRouteWatchState = initialPageRouteWatchState;
  let activeServerRouteWatchState = initialServerRouteWatchState;
  const activeConfigWatchFiles = new Set(
    initialDevWatchPlans.configDependencies.keys(),
  );

  const pluginWatchFiles = new Set<string>();
  const bundlerConfigWatchFiles = new Set<string>();
  let reportWatchRegistrationFailure: ((failure: unknown) => void) | undefined;
  const captureWatchBaseline = (file: string) => {
    try {
      return prepareWatchFilesPlan(
        createWatchFilesPlan([file], new Set([file])),
      );
    } catch (error) {
      reportWatchRegistrationFailure?.(error);
      throw error;
    }
  };
  const pendingPluginWatchBaselines = new Map<string, PreparedWatchFilesPlan>();
  const pendingBundlerWatchBaselines = new Map<
    string,
    PreparedWatchFilesPlan
  >();
  let onPluginWatchFileAdded:
    | ((baseline: PreparedWatchFilesPlan) => void)
    | undefined;
  let onBundlerConfigWatchFileAdded:
    | ((baseline: PreparedWatchFilesPlan) => void)
    | undefined;
  const addWatchFile = (file: string) => {
    const absolute = path.resolve(cwd, file);
    if (pluginWatchFiles.has(absolute)) return;
    const baseline = captureWatchBaseline(absolute);
    pluginWatchFiles.add(absolute);
    if (onPluginWatchFileAdded) {
      onPluginWatchFileAdded(baseline);
    } else {
      pendingPluginWatchBaselines.set(absolute, baseline);
    }
  };
  const addBundlerConfigWatchFile = (file: string) => {
    const absolute = path.resolve(cwd, file);
    if (bundlerConfigWatchFiles.has(absolute)) return;
    const baseline = captureWatchBaseline(absolute);
    bundlerConfigWatchFiles.add(absolute);
    if (onBundlerConfigWatchFileAdded) {
      onBundlerConfigWatchFileAdded(baseline);
    } else {
      pendingBundlerWatchBaselines.set(absolute, baseline);
    }
  };
  let pluginContextRetired = false;
  let retirePluginContext = () => {
    pluginContextRetired = true;
  };
  let pluginCtx: MutablePluginSetupContext<TBundlerCfg> = {
    mode: "development",
    cwd,
    config: activeConfig,
    flags,
    logger,
    addWatchFile(file) {
      if (pluginContextRetired) return;
      addWatchFile(file);
    },
  };
  let hooks: PluginHooks<TBundlerCfg>[];
  try {
    hooks = await collectPluginHooks(
      activeConfig.plugins,
      pluginCtx,
      retirePluginContext,
    );
  } catch (error) {
    retirePluginContext();
    throw error;
  }
  let activePluginExecution = createDevPluginExecutionSnapshot(
    hooks,
    pluginCtx,
  );
  const activeObservedSourceDependencies = new Set<string>();
  const initialAnalysisWatchBaselines: PreparedWatchFilesPlan[] = [];
  const initialSourceBaselines = new Map<string, PreparedWatchFilesPlan>();
  const captureInitialSourceRead = (file: string) => {
    const absolute = path.resolve(file);
    if (initialSourceBaselines.has(absolute)) return;
    initialSourceBaselines.set(absolute, captureWatchBaseline(absolute));
  };
  const captureInitialObservedSourceDependency = (file: string) => {
    const absolute = path.resolve(file);
    activeObservedSourceDependencies.add(absolute);
    captureInitialSourceRead(absolute);
  };
  let activeAnalysis: Awaited<ReturnType<typeof createCoreGraph>>;
  let activePlan: BuildPlan;
  try {
    validateHtmlTemplates(cwd, activeConfig);
    const configuredAnalysisDependencies =
      listConfiguredAnalysisWatchDependencies(cwd, activeConfig);
    if (configuredAnalysisDependencies.length > 0) {
      initialAnalysisWatchBaselines.push(
        prepareDevWatchPlan(configuredAnalysisDependencies),
      );
    }
    const materialized = await analyzeAndMaterializeFrameworkIR({
      cwd,
      mode: "development",
      config: activeConfig,
      pluginContext: pluginCtx,
      pluginSettings: activePluginSettings,
      applicationPluginSettings: activeApplicationPluginSettings,
      plan: { distDir: DEV_DIST_DIR },
      beforeSourceRead: captureInitialSourceRead,
      onSourceDependency: captureInitialObservedSourceDependency,
      onAnalysis(analysis) {
        reportGraphDiagnostics(analysis);
        const dependencies = analysis.fileDependencies;
        initialAnalysisWatchBaselines.push(prepareDevWatchPlan(dependencies));
      },
    });
    activeAnalysis = materialized.analysis;
    activePlan = materialized.plan;
    await assertNoActiveDevDistLock(cwd, activePlan.distDir);
  } catch (error) {
    return rethrowAfterCleanup(
      error,
      async () => {
        const execution = activePluginExecution;
        retirePluginContext();
        await execution.waitForIdle();
        await runDisposeHooks(execution.hooks, execution.context);
      },
      "[evjs] Dev initialization failed and plugin cleanup also failed.",
    );
  }
  let restartQueue: Promise<void> = Promise.resolve();
  let devUpdateQueue: Promise<void> = Promise.resolve();
  let outputCycleQueue: Promise<void> = Promise.resolve();
  type DevBundlerGenerationState = {
    analysis: Awaited<ReturnType<typeof createCoreGraph>>;
    config: ResolvedFrameworkConfig<TBundlerCfg>;
    frameworkOutputTransaction: DevFrameworkOutputTransaction | undefined;
    plan: BuildPlan;
    pluginExecution: DevPluginExecutionSnapshot<TBundlerCfg>;
    frameworkRuntime: ReturnType<typeof createFrameworkRuntime> | undefined;
    serverEntry: string | undefined;
  };
  type DevBundlerGenerationRecord = {
    status: "active" | "blocked" | "retired" | "staged";
    state?: DevBundlerGenerationState;
  };
  const bundlerGenerations = new WeakMap<
    BundlerDevGeneration,
    DevBundlerGenerationRecord
  >();
  const createBundlerGeneration = (): BundlerDevGeneration => {
    const generation = Object.freeze({}) as BundlerDevGeneration;
    bundlerGenerations.set(generation, { status: "staged" });
    return generation;
  };
  const activateBundlerGeneration = (
    generation: BundlerDevGeneration,
    state: DevBundlerGenerationState,
    blocked = false,
  ) => {
    const record = bundlerGenerations.get(generation);
    if (!record) {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" used an unknown development generation.`,
      );
    }
    if (record.status !== "staged") {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" violated the development generation contract by activating a ${record.status} generation. Each update generation must be activated exactly once.`,
      );
    }
    record.status = blocked ? "blocked" : "active";
    record.state = state;
  };
  const blockBundlerGeneration = (generation: BundlerDevGeneration) => {
    const record = bundlerGenerations.get(generation);
    if (!record || record.status !== "active") {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" cannot block a development generation that is not active.`,
      );
    }
    record.status = "blocked";
  };
  const unblockBundlerGeneration = (generation: BundlerDevGeneration) => {
    const record = bundlerGenerations.get(generation);
    if (!record || record.status !== "blocked") {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" cannot resume a development generation that is not blocked.`,
      );
    }
    record.status = "active";
  };
  const retireBundlerGeneration = (generation: BundlerDevGeneration) => {
    const record = bundlerGenerations.get(generation);
    if (!record || record.status === "retired") return;
    record.status = "retired";
    record.state = undefined;
  };
  const getBundlerGenerationState = (
    generation: BundlerDevGeneration,
    allowBlocked = false,
  ): DevBundlerGenerationState => {
    const record = bundlerGenerations.get(generation);
    if (!record) {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" published development output for an unknown generation.`,
      );
    }
    if (record.status === "staged") {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" violated the development generation contract by publishing output before activating its staged generation.`,
      );
    }
    if (record.status === "blocked" && !allowBlocked) {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" violated the development generation contract by publishing output while generated inputs were in transition.`,
      );
    }
    if (record.status === "retired") {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" violated the development generation contract by publishing output for a retired generation.`,
      );
    }
    if (!record.state) {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" has an active development generation without a framework snapshot.`,
      );
    }
    return record.state;
  };
  const getBundlerGenerationStateForFacts = (
    generation: BundlerDevGeneration,
  ): DevBundlerGenerationState | undefined => {
    const record = bundlerGenerations.get(generation);
    if (!record) {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" published development output for an unknown generation.`,
      );
    }
    if (record.status === "staged") {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" violated the development generation contract by publishing output before activating its staged generation.`,
      );
    }
    // A compile that was valid when reserved may finish after its generation
    // was blocked or retired. This is an expected producer race, not a new
    // canonical output cycle.
    if (record.status === "blocked" || record.status === "retired") {
      return undefined;
    }
    if (!record.state) {
      throw new Error(
        `[evjs] Bundler "${bundler.name}" has an active development generation without a framework snapshot.`,
      );
    }
    return record.state;
  };
  const initialBundlerGeneration = createBundlerGeneration();
  let activeBundlerGeneration = initialBundlerGeneration;
  activateBundlerGeneration(initialBundlerGeneration, {
    analysis: activeAnalysis,
    config: activeConfig,
    frameworkOutputTransaction: undefined,
    plan: activePlan,
    pluginExecution: activePluginExecution,
    frameworkRuntime: undefined,
    serverEntry: undefined,
  });
  const enqueueOutputCycle = <T>(run: () => Promise<T>): Promise<T> => {
    const cycle = outputCycleQueue.then(run, run);
    outputCycleQueue = cycle.then(
      () => {},
      () => {},
    );
    return cycle;
  };
  let devController: BundlerDevController<TBundlerCfg> | undefined;
  let releaseDevDistLock: DevRuntimeRelease | undefined;
  let unregisterDevDistExitCleanup = () => {};
  let devDependencyWatcher: WatchGeneration | undefined;
  let candidateDependencyWatcher: CandidateWatchGeneration | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingDevChanges = new Set<string>();
  const lastScheduledDevChanges = new Map<string, ScheduledDevChangeSnapshot>();
  let pendingForcedConfigReload = false;
  let devSessionEnding = false;
  let devServerOrigin: string | undefined;
  let pendingDevServerOrigin: string | undefined;
  let devShortcutPublicationSuspended = false;
  let restoreDevCliShortcutsAfterUpdate = false;
  let cliShortcutsBinding:
    | {
        pluginExecution: DevPluginExecutionSnapshot<TBundlerCfg>;
        unbind: UnbindCLIShortcuts;
      }
    | undefined;
  const pendingShortcutActionsByPluginExecution = new Map<
    DevPluginExecutionSnapshot<TBundlerCfg>,
    Set<Promise<void>>
  >();
  const deferredPluginExecutionDisposals = new Map<
    DevPluginExecutionSnapshot<TBundlerCfg>,
    () => Promise<void>
  >();
  const cliShortcutContributionsByPluginExecution = new WeakMap<
    DevPluginExecutionSnapshot<TBundlerCfg>,
    ReturnType<typeof collectConfigureShortcutsHooks<TBundlerCfg>>
  >();
  let cliShortcutsRestoreScheduled = false;
  let cliShortcutsRefreshQueue = Promise.resolve();
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
  let resolveDevWatchFailure: ((error: Error) => void) | undefined;
  const waitForDevWatchFailure = new Promise<Error>((resolve) => {
    resolveDevWatchFailure = resolve;
  });
  let devWatchFailed = false;
  let devWatchMode = resolveInitialDevWatchMode();
  const reportDevWatchFailure = (failure: unknown) => {
    if (devWatchFailed) return;
    devWatchFailed = true;
    const error =
      failure instanceof Error ? failure : new Error(String(failure));
    resolveDevWatchFailure?.(error);
  };
  reportWatchRegistrationFailure = reportDevWatchFailure;
  const reportDevWatchFallback = (error: Error) => {
    if (devWatchMode === "polling") return;
    devWatchMode = "polling";
    logger.warn`Development dependency event watchers are unavailable; falling back to polling: ${error}`;
  };
  const stopWatcherGroup = (stop: () => void) => {
    try {
      stop();
    } catch (error) {
      reportDevWatchFailure(error);
      throw error;
    }
  };

  const stopApiOnParentShutdown = () => {
    apiProcessController.requestStop();
    resolveShutdown?.();
  };

  process.once("SIGINT", stopApiOnParentShutdown);
  process.once("SIGTERM", stopApiOnParentShutdown);

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
          `globalThis.__EVJS_FRAMEWORK_RUNTIME__ = ${serializeFrameworkRuntimeExpression(state.frameworkRuntime)};`,
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

  const handleServerBundleReady = async (generation: BundlerDevGeneration) => {
    if (devSessionEnding) return;
    const generationState = getBundlerGenerationState(generation);
    const state: DevApiRuntimeState<TBundlerCfg> = {
      config: generationState.config,
      frameworkRuntime: generationState.frameworkRuntime,
      plan: generationState.plan,
      serverEntry: generationState.serverEntry,
    };
    restartQueue = restartQueue
      .catch(() => {})
      .then(() => {
        if (devSessionEnding) return;
        return restartApiServer(state);
      })
      .then(() => {});
    await restartQueue;
  };

  const trackPendingShortcutAction = (
    pluginExecution: DevPluginExecutionSnapshot<TBundlerCfg>,
    idle: Promise<void>,
  ): void => {
    let pending = pendingShortcutActionsByPluginExecution.get(pluginExecution);
    if (!pending) {
      pending = new Set();
      pendingShortcutActionsByPluginExecution.set(pluginExecution, pending);
    }
    pending.add(idle);
    void idle.then(() => {
      pending?.delete(idle);
      if (pending?.size === 0) {
        pendingShortcutActionsByPluginExecution.delete(pluginExecution);
      }
    });
  };

  const listPendingShortcutActions = (): Promise<void>[] =>
    [...pendingShortcutActionsByPluginExecution.values()].flatMap((pending) => [
      ...pending,
    ]);

  const scheduleDevCliShortcutsRestore = (
    pendingShortcutActions: readonly Promise<void>[],
  ): void => {
    if (cliShortcutsRestoreScheduled) return;
    cliShortcutsRestoreScheduled = true;
    void Promise.all(pendingShortcutActions).then(() => {
      cliShortcutsRestoreScheduled = false;
      if (devSessionEnding) return;
      if (devShortcutPublicationSuspended) {
        restoreDevCliShortcutsAfterUpdate = true;
        return;
      }
      void refreshDevCliShortcuts().catch((error) => {
        logger.warn`Plugin CLI shortcuts could not be restored after an action finished: ${error}`;
      });
    });
  };

  const disposeDevPluginExecution = async (
    pluginExecution: DevPluginExecutionSnapshot<TBundlerCfg>,
    deferForShortcutActions: boolean,
  ): Promise<void> => {
    const existingDeferredDispose =
      deferredPluginExecutionDisposals.get(pluginExecution);
    if (existingDeferredDispose) {
      if (!deferForShortcutActions) await existingDeferredDispose();
      return;
    }
    const pendingShortcutActions = [
      ...(pendingShortcutActionsByPluginExecution.get(pluginExecution) ?? []),
    ];
    const dispose = async () => {
      await pluginExecution.waitForIdle();
      await runDisposeHooks(pluginExecution.hooks, pluginExecution.context);
    };
    if (deferForShortcutActions && pendingShortcutActions.length > 0) {
      let disposePromise: Promise<void> | undefined;
      const disposeOnce = () => {
        disposePromise ??= dispose().finally(() => {
          if (
            deferredPluginExecutionDisposals.get(pluginExecution) ===
            disposeOnce
          ) {
            deferredPluginExecutionDisposals.delete(pluginExecution);
          }
        });
        return disposePromise;
      };
      deferredPluginExecutionDisposals.set(pluginExecution, disposeOnce);
      void Promise.allSettled(pendingShortcutActions)
        .then(disposeOnce)
        .catch((error) => {
          logger.warn`Deferred plugin cleanup after a CLI shortcut action failed: ${error}`;
        });
      return;
    }
    await dispose();
  };

  const clearDevCliShortcuts = async (
    actionDrainTimeoutMs = DEV_CLI_SHORTCUT_ACTION_DRAIN_TIMEOUT_MS,
  ): Promise<{ drained: boolean; idle?: Promise<void> }> => {
    const binding = cliShortcutsBinding;
    cliShortcutsBinding = undefined;
    if (!binding) return { drained: true };
    const result = await binding.unbind({ actionDrainTimeoutMs });
    if (!result.drained) {
      trackPendingShortcutAction(binding.pluginExecution, result.idle);
    }
    return result;
  };

  const refreshDevCliShortcutsNow = async (
    origin: string | undefined,
    cliShortcutsEnabled: boolean,
    pluginExecution: DevPluginExecutionSnapshot<TBundlerCfg>,
  ): Promise<void> => {
    if (origin !== undefined) devServerOrigin = origin;
    if (!devServerOrigin) return;

    if (!cliShortcutsEnabled) {
      await clearDevCliShortcuts();
      return;
    }

    // Plugins contribute every key; core ships none. The session exposes only
    // the dev origin and a shutdown trigger — any richer action (restart,
    // open browser, …) is implemented by plugins from these primitives.
    const session: PluginDevSession = {
      origin: devServerOrigin,
      close() {
        if (devSessionEnding) return Promise.resolve();
        resolveShutdown?.();
        return Promise.resolve();
      },
    };

    let customShortcutsPromise =
      cliShortcutContributionsByPluginExecution.get(pluginExecution);
    if (!customShortcutsPromise) {
      customShortcutsPromise = collectConfigureShortcutsHooks(
        pluginExecution.hooks,
        {
          onError(error) {
            logger.warn`A plugin CLI shortcut contribution was ignored: ${error}`;
          },
        },
      );
      cliShortcutContributionsByPluginExecution.set(
        pluginExecution,
        customShortcutsPromise,
      );
    }
    const customShortcuts = await customShortcutsPromise;
    if (devSessionEnding) return;

    // Drain the previous snapshot before its plugin hooks are disposed, then
    // publish the replacement binding for the active snapshot.
    const previousBinding = await clearDevCliShortcuts();
    if (devSessionEnding) return;
    const pendingShortcutActions = listPendingShortcutActions();
    if (pendingShortcutActions.length > 0) {
      if (!previousBinding.drained) {
        logger.warn`Plugin CLI shortcuts were detached, but the running action did not finish within ${DEV_CLI_SHORTCUT_ACTION_DRAIN_TIMEOUT_MS}ms. New shortcuts will be restored after it finishes.`;
      }
      scheduleDevCliShortcutsRestore(pendingShortcutActions);
      return;
    }
    cliShortcutsBinding = {
      pluginExecution,
      unbind: bindCLIShortcuts(session, { customShortcuts }),
    };
  };

  const refreshDevCliShortcuts = (
    origin: string | undefined = devServerOrigin,
  ): Promise<void> => {
    const cliShortcutsEnabled = activeConfig.dev.cliShortcuts !== false;
    const pluginExecution = activePluginExecution;
    const refresh = cliShortcutsRefreshQueue.then(
      () =>
        refreshDevCliShortcutsNow(origin, cliShortcutsEnabled, pluginExecution),
      () =>
        refreshDevCliShortcutsNow(origin, cliShortcutsEnabled, pluginExecution),
    );
    cliShortcutsRefreshQueue = refresh.catch(() => {});
    return refresh;
  };

  const loadCurrentConfig = async (
    reloadConfiguredConfig: boolean,
    onRouteWatchState?: (state: {
      page: RouteDirectoryWatchState;
      server: RouteDirectoryWatchState;
    }) => void,
    onConfigDependency?: (file: string) => void,
  ) => {
    const nextConfiguredConfig = withCliShortcutsOverride(
      reloadConfiguredConfig
        ? await runConfigureHooks(
            options?.loadConfig
              ? await options.loadConfig(cwd, {
                  onDependency(file) {
                    onConfigDependency?.(file);
                  },
                })
              : userConfig,
            {
              mode: "development",
              cwd,
              flags,
            },
          )
        : activeConfiguredConfig,
      options?.cliShortcuts,
    );
    const nextBaseResolvedConfig = resolveConfig(nextConfiguredConfig);
    const nextPageRoot = nextBaseResolvedConfig.application
      ? path.resolve(cwd, nextBaseResolvedConfig.application.pageRoot)
      : path.resolve(cwd, CANONICAL_PAGE_ROUTE_ROOT);
    const shouldWatchPageRoutes =
      Boolean(nextBaseResolvedConfig.application) ||
      (nextBaseResolvedConfig.conventions !== false &&
        nextConfiguredConfig?.routing !== undefined);
    const [pageRouteWatchState, serverRouteWatchState] = await Promise.all([
      shouldWatchPageRoutes
        ? collectRouteDirectoryWatchState(cwd, nextPageRoot)
        : { dependencies: [] },
      collectServerRouteWatchState(cwd, nextBaseResolvedConfig),
    ]);
    onRouteWatchState?.({
      page: pageRouteWatchState,
      server: serverRouteWatchState,
    });
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

  const stagePluginHooks = async (
    nextConfig: typeof activeConfig,
    onWatchFileAdded?: (file: string, baseline: PreparedWatchFilesPlan) => void,
  ) => {
    const previousHooks = [...hooks];
    const previousPluginWatchFiles = [...pluginWatchFiles];
    const previousPluginCtx = pluginCtx;
    const retirePreviousPluginContext = retirePluginContext;
    const previousPluginExecution = activePluginExecution;
    const nextPluginWatchFiles = new Set<string>();
    const nextPluginWatchBaselines = new Map<string, PreparedWatchFilesPlan>();
    let activated = false;
    let nextPluginContextRetired = false;
    const retireNextPluginContext = () => {
      nextPluginContextRetired = true;
    };
    let settlement: "committed" | "pending" | "rolled-back" = "pending";
    const nextPluginCtx: MutablePluginSetupContext<TBundlerCfg> = {
      ...pluginCtx,
      config: nextConfig,
      addWatchFile(file) {
        if (nextPluginContextRetired) return;
        const absolute = path.resolve(cwd, file);
        if (settlement === "committed") {
          addWatchFile(absolute);
          return;
        }
        if (settlement === "rolled-back") return;
        if (nextPluginWatchFiles.has(absolute)) return;
        const baseline = captureWatchBaseline(absolute);
        nextPluginWatchBaselines.set(absolute, baseline);
        nextPluginWatchFiles.add(absolute);
        if (activated) pluginWatchFiles.add(absolute);
        onWatchFileAdded?.(absolute, baseline);
      },
    };
    let nextHooks: PluginHooks<TBundlerCfg>[];
    try {
      nextHooks = await collectPluginHooks(
        nextConfig.plugins,
        nextPluginCtx,
        retireNextPluginContext,
      );
    } catch (error) {
      settlement = "rolled-back";
      retireNextPluginContext();
      throw error;
    }
    const nextPluginExecution = createDevPluginExecutionSnapshot(
      nextHooks,
      nextPluginCtx,
    );

    return {
      pluginContext: nextPluginCtx,
      watchBaselines: nextPluginWatchBaselines,
      activate() {
        if (activated || settlement !== "pending") return;
        hooks.splice(0, hooks.length, ...nextHooks);
        pluginWatchFiles.clear();
        for (const file of nextPluginWatchFiles) {
          pluginWatchFiles.add(file);
        }
        pluginCtx = nextPluginCtx;
        retirePluginContext = retireNextPluginContext;
        activePluginExecution = nextPluginExecution;
        activated = true;
      },
      async commit() {
        if (settlement !== "pending") return;
        if (!activated) {
          throw new Error(
            "[evjs] Cannot commit plugin hooks before activating the staged snapshot.",
          );
        }
        settlement = "committed";
        retirePreviousPluginContext();
        await disposeDevPluginExecution(previousPluginExecution, true);
      },
      async rollback() {
        if (settlement !== "pending") return;
        settlement = "rolled-back";
        retireNextPluginContext();
        if (activated) {
          hooks.splice(0, hooks.length, ...previousHooks);
          pluginWatchFiles.clear();
          for (const file of previousPluginWatchFiles) {
            pluginWatchFiles.add(file);
          }
          pluginCtx = previousPluginCtx;
          retirePluginContext = retirePreviousPluginContext;
          activePluginExecution = previousPluginExecution;
        }
        await nextPluginExecution.waitForIdle();
        await runDisposeHooks(nextHooks, nextPluginCtx);
      },
    };
  };

  const listUnsafeRouteWatchBoundaries = (
    ...states: Array<RouteDirectoryWatchState | undefined>
  ) =>
    states.flatMap((state) =>
      state?.unsafeBoundary ? [state.unsafeBoundary] : [],
    );
  const filterUnsafeRouteWatchDependencies = (
    dependencies: Iterable<string>,
    unsafeBoundaries: readonly string[],
  ) =>
    [...dependencies].filter((file) =>
      unsafeBoundaries.every(
        (unsafeBoundary) => !isInsideCwd(unsafeBoundary, file),
      ),
    );
  const listDevDependencyWatchFiles = () => {
    const unsafeBoundaries = listUnsafeRouteWatchBoundaries(
      activePageRouteWatchState,
      activeServerRouteWatchState,
    );
    return filterUnsafeRouteWatchDependencies(
      [
        ...listConfigDependencyFiles(cwd),
        ...activeConfigWatchFiles,
        ...activeAnalysis.fileDependencies,
        ...activeObservedSourceDependencies,
        ...activePageRouteWatchState.dependencies,
        ...activeServerRouteWatchState.dependencies,
        ...pluginWatchFiles,
        ...bundlerConfigWatchFiles,
      ].map((file) => path.resolve(file)),
      unsafeBoundaries,
    );
  };

  const createDevDependencyWatchTopology = () => {
    const dependencies = listDevDependencyWatchFiles();
    const recoverableMissingTargets = new Set(dependencies);
    return createWatchFilesPlan(dependencies, recoverableMissingTargets);
  };

  const refreshDevDependencyWatchers = (
    reconcileFrom?: PreparedWatchFilesPlan,
  ): PreparedWatchFilesPlan | undefined => {
    if (devSessionEnding || devWatchFailed) return undefined;
    let nextWatchTopology: WatchFilesPlan;
    try {
      nextWatchTopology = createDevDependencyWatchTopology();
    } catch (error) {
      reportDevWatchFailure(error);
      return undefined;
    }
    const topologyChanged = nextWatchTopology.key !== devDependencyWatcher?.key;
    if (!topologyChanged && !reconcileFrom) return undefined;

    let nextWatchPlan: PreparedWatchFilesPlan;
    try {
      nextWatchPlan = prepareWatchFilesPlan(nextWatchTopology);
    } catch (error) {
      reportDevWatchFailure(error);
      return undefined;
    }

    if (topologyChanged) {
      const previous = devDependencyWatcher;
      let nextStop: () => void;
      try {
        nextStop = watchFiles(nextWatchPlan, scheduleDevUpdate, {
          mode: devWatchMode,
          onError: reportDevWatchFailure,
          onFallback: reportDevWatchFallback,
        });
      } catch {
        return undefined;
      }
      devDependencyWatcher = {
        key: nextWatchPlan.key,
        stop: nextStop,
      };
      if (previous) {
        try {
          stopWatcherGroup(previous.stop);
        } catch {
          return nextWatchPlan;
        }
      }
    }

    if (reconcileFrom) {
      for (const file of collectWatchFilesChangedSince(
        reconcileFrom,
        nextWatchPlan,
      )) {
        scheduleDevUpdate(file);
      }
    }
    return nextWatchPlan;
  };

  const reconcileRegisteredWatchBaselines = (
    baselines: Iterable<PreparedWatchFilesPlan>,
  ) => {
    const previousPlans = [...baselines];
    if (previousPlans.length === 0) return;
    const dependencies = [
      ...new Set(previousPlans.flatMap((plan) => [...plan.logicalTargets])),
    ];
    let currentPlan: PreparedWatchFilesPlan;
    try {
      currentPlan = prepareDevWatchPlan(dependencies);
    } catch (error) {
      reportDevWatchFailure(error);
      return;
    }
    for (const previous of previousPlans) {
      for (const file of collectWatchFilesChangedSince(previous, currentPlan)) {
        scheduleDevUpdate(file);
      }
    }
  };

  const clearDevDependencyWatcher = () => {
    const current = devDependencyWatcher;
    devDependencyWatcher = undefined;
    if (current) stopWatcherGroup(current.stop);
  };

  const clearCandidateDependencyWatcher = () => {
    const current = candidateDependencyWatcher;
    candidateDependencyWatcher = undefined;
    if (current) stopWatcherGroup(current.stop);
  };
  const retireCandidateDependencyWatcher = () => {
    try {
      clearCandidateDependencyWatcher();
    } catch {
      // stopWatcherGroup already promoted the close failure to the session.
    }
  };

  const watchCandidateDependencies = (
    candidateDependencies: readonly string[] | undefined,
    reconcileFrom: Iterable<PreparedWatchFilesPlan> = [],
    requiresConfigReload = false,
  ) => {
    const reconciliationPlans = [...reconcileFrom];
    // A failure before candidate dependency discovery produced no replacement
    // state. Keep the previous candidate watcher alive until a later attempt
    // either resolves a new state or commits successfully.
    const resolvedDependencies =
      candidateDependencies ??
      (reconciliationPlans.length > 0 && candidateDependencyWatcher
        ? [...candidateDependencyWatcher.dependencies]
        : undefined);
    if (!resolvedDependencies) return;
    if (resolvedDependencies.length === 0) {
      clearCandidateDependencyWatcher();
      return;
    }

    const dependencies = [
      ...new Set(resolvedDependencies.map((file) => path.resolve(file))),
    ];
    const candidateRequiresConfigReload =
      requiresConfigReload ||
      candidateDependencyWatcher?.requiresConfigReload === true;
    let currentMainWatchDependencies: ReadonlySet<string> = new Set();
    try {
      const currentMainTopology = createDevDependencyWatchTopology();
      if (currentMainTopology.key === devDependencyWatcher?.key) {
        currentMainWatchDependencies = new Set(
          currentMainTopology.logicalTargets,
        );
      }
    } catch (error) {
      reportDevWatchFailure(error);
      return;
    }
    const watchDependencies = dependencies.filter(
      (file) => !currentMainWatchDependencies.has(file),
    );
    const recoverableMissingTargets = new Set(watchDependencies);
    let nextWatchTopology: WatchFilesPlan;
    try {
      nextWatchTopology = createWatchFilesPlan(
        watchDependencies,
        recoverableMissingTargets,
      );
    } catch (error) {
      reportDevWatchFailure(error);
      return;
    }
    const nextWatchKey = JSON.stringify([
      [...dependencies].sort(),
      candidateRequiresConfigReload,
      nextWatchTopology.key,
    ]);
    const topologyChanged = nextWatchKey !== candidateDependencyWatcher?.key;
    if (!topologyChanged && reconciliationPlans.length === 0) return;

    let nextWatchPlan: PreparedWatchFilesPlan;
    try {
      nextWatchPlan = prepareWatchFilesPlan(nextWatchTopology);
    } catch (error) {
      reportDevWatchFailure(error);
      return;
    }

    if (devSessionEnding || devWatchFailed) return;
    if (topologyChanged) {
      const previous = candidateDependencyWatcher;
      let stop: () => void;
      try {
        stop = watchFiles(
          nextWatchPlan,
          (file) => scheduleDevUpdate(file, candidateRequiresConfigReload),
          {
            mode: devWatchMode,
            onError: reportDevWatchFailure,
            onFallback: reportDevWatchFallback,
          },
        );
      } catch {
        return;
      }
      candidateDependencyWatcher = {
        dependencies: new Set(dependencies),
        key: nextWatchKey,
        requiresConfigReload: candidateRequiresConfigReload,
        stop,
      };
      if (previous) {
        try {
          stopWatcherGroup(previous.stop);
        } catch {
          return;
        }
      }
    }
    if (reconciliationPlans.length > 0) {
      let currentReconcilePlan: PreparedWatchFilesPlan;
      try {
        currentReconcilePlan = prepareDevWatchPlan(dependencies);
      } catch (error) {
        reportDevWatchFailure(error);
        return;
      }
      for (const previous of reconciliationPlans) {
        for (const file of collectWatchFilesChangedSince(
          previous,
          currentReconcilePlan,
        )) {
          scheduleDevUpdate(file, candidateRequiresConfigReload);
        }
      }
    }
  };

  const captureDevDependencyWatchPlan = () => {
    try {
      return prepareWatchFilesPlan(createDevDependencyWatchTopology());
    } catch (error) {
      reportDevWatchFailure(error);
      return undefined;
    }
  };

  const captureCandidateDependencyWatchPlan = () => {
    if (!candidateDependencyWatcher) return undefined;
    try {
      const dependencies = [...candidateDependencyWatcher.dependencies];
      return prepareDevWatchPlan(dependencies);
    } catch (error) {
      reportDevWatchFailure(error);
      return undefined;
    }
  };

  const commitStagedPluginHooks = async (
    stagedPluginHooks: Awaited<ReturnType<typeof stagePluginHooks>> | undefined,
    nextDevServerOrigin: string | undefined,
    reconcileFrom?: PreparedWatchFilesPlan,
    additionalBaselines: Iterable<PreparedWatchFilesPlan> = [],
  ) => {
    const reconciliationBaselines = [
      ...(stagedPluginHooks?.watchBaselines.values() ?? []),
      ...additionalBaselines,
    ];
    if (stagedPluginHooks || nextDevServerOrigin !== undefined) {
      try {
        await refreshDevCliShortcuts(nextDevServerOrigin);
      } catch (error) {
        logger.warn`Plugin CLI shortcuts could not be refreshed: ${error}`;
        try {
          await clearDevCliShortcuts();
        } catch (cleanupError) {
          logger.warn`Plugin CLI shortcuts could not be cleared after a refresh failure: ${cleanupError}`;
        }
      }
    }
    try {
      await stagedPluginHooks?.commit();
    } catch (error) {
      logger.warn`Framework plan update was applied, but previous plugin cleanup failed: ${error}`;
    } finally {
      refreshDevDependencyWatchers(reconcileFrom);
      reconcileRegisteredWatchBaselines(reconciliationBaselines);
    }
  };

  const applyDevDependencyChange = async (
    changedFiles: readonly string[],
    forceConfigReload = false,
    devWatchReconcileFrom?: PreparedWatchFilesPlan,
    candidateWatchReconcileFrom?: PreparedWatchFilesPlan,
  ) => {
    let currentDevWatchReconcileFrom = devWatchReconcileFrom;
    const configDependencyFiles = new Set([
      ...listConfigDependencyFiles(cwd),
      ...activeConfigWatchFiles,
    ]);
    const isFrameworkConfigChange = changedFiles.some((file) =>
      configDependencyFiles.has(file),
    );
    const isBundlerConfigChange = changedFiles.some((file) =>
      bundlerConfigWatchFiles.has(file),
    );
    const requiresBundlerConfigReload =
      forceConfigReload || isFrameworkConfigChange || isBundlerConfigChange;
    const reason: BuildPlanUpdate["reason"] = requiresBundlerConfigReload
      ? "config"
      : "route-declaration";
    let stagedPluginHooks:
      | Awaited<ReturnType<typeof stagePluginHooks>>
      | undefined;
    let generatedStateSnapshot: GeneratedDevStateSnapshot | undefined;
    let bundlerUpdateTransition: BundlerDevUpdateTransition | undefined;
    let frameworkOutputTransaction: DevFrameworkOutputTransaction | undefined;
    let previousBundlerGeneration: BundlerDevGeneration | undefined;
    let candidateBundlerGeneration: BundlerDevGeneration | undefined;
    let candidateGenerationActivated = false;
    let candidateGenerationCommitted = false;
    let postCommitFailure: { error: unknown } | undefined;
    function recordPostCommitFailure(error: unknown): void {
      postCommitFailure = postCommitFailure
        ? {
            error: new AggregateError(
              [postCommitFailure.error, error],
              "[evjs] Multiple post-commit development tasks failed.",
            ),
          }
        : { error };
    }
    let candidateRestoreFailed = false;
    let candidatePageRouteWatchState: RouteDirectoryWatchState | undefined;
    let candidateServerRouteWatchState: RouteDirectoryWatchState | undefined;
    let candidateAnalysisWatchDependencies: readonly string[] | undefined;
    const candidatePluginWatchDependencies = new Set<string>();
    const candidatePluginWatchBaselines = new Map<
      string,
      PreparedWatchFilesPlan
    >();
    const candidateConfigDependencies = new Set<string>();
    const candidateConfigBaselines = new Map<string, PreparedWatchFilesPlan>();
    const candidateTransientSourceDependencies = new Set<string>();
    const candidateObservedSourceDependencies = new Set<string>();
    const candidateSourceBaselines = new Map<string, PreparedWatchFilesPlan>();
    const candidateRouteWatchBaselines: PreparedWatchFilesPlan[] = [];
    let candidateWatchCoverageComplete = false;
    let candidateWatcherReady = false;
    let candidateConfigRegistrationsReconciled = true;
    let candidatePluginRegistrationsReconciled = true;
    let candidateSourcesReconciled = true;
    let currentCandidateWatchReconcileFrom = candidateWatchReconcileFrom;
    const collectCandidateWatchDependencies = () => {
      const unsafeBoundaries = listUnsafeRouteWatchBoundaries(
        candidatePageRouteWatchState,
        candidateServerRouteWatchState,
      );
      if (!requiresBundlerConfigReload) {
        return filterUnsafeRouteWatchDependencies(
          [
            ...(candidatePageRouteWatchState?.dependencies ?? []),
            ...(candidateServerRouteWatchState?.dependencies ?? []),
            ...(candidateDependencyWatcher?.dependencies ?? []),
            ...candidateTransientSourceDependencies,
            ...candidateObservedSourceDependencies,
          ],
          unsafeBoundaries,
        );
      }
      if (!candidatePageRouteWatchState || !candidateServerRouteWatchState) {
        return candidateConfigDependencies.size > 0
          ? [
              ...(candidateDependencyWatcher?.dependencies ?? []),
              ...candidateConfigDependencies,
            ]
          : undefined;
      }
      return filterUnsafeRouteWatchDependencies(
        [
          ...candidatePageRouteWatchState.dependencies,
          ...candidateServerRouteWatchState.dependencies,
          ...(candidateWatchCoverageComplete
            ? []
            : (candidateDependencyWatcher?.dependencies ?? [])),
          ...candidateConfigDependencies,
          ...candidatePluginWatchDependencies,
          ...candidateTransientSourceDependencies,
          ...candidateObservedSourceDependencies,
          ...(candidateAnalysisWatchDependencies ?? []),
        ],
        unsafeBoundaries,
      );
    };
    const listPendingCandidateWatchBaselines = () => [
      ...candidateConfigBaselines.values(),
      ...candidatePluginWatchBaselines.values(),
      ...candidateSourceBaselines.values(),
      ...candidateRouteWatchBaselines,
    ];
    const clearPendingCandidateWatchBaselines = () => {
      candidateConfigBaselines.clear();
      candidatePluginWatchBaselines.clear();
      candidateSourceBaselines.clear();
      candidateRouteWatchBaselines.length = 0;
    };
    const synchronizeCandidateWatcher = (
      registrationBaselines: Iterable<PreparedWatchFilesPlan> = [],
    ) => {
      candidateWatcherReady = true;
      const dependencies = collectCandidateWatchDependencies();
      const reconciliationPlans = [
        ...(currentCandidateWatchReconcileFrom
          ? [currentCandidateWatchReconcileFrom]
          : []),
        ...registrationBaselines,
      ];
      watchCandidateDependencies(
        dependencies,
        reconciliationPlans,
        requiresBundlerConfigReload,
      );
      currentCandidateWatchReconcileFrom = undefined;
      candidateConfigRegistrationsReconciled = true;
      candidatePluginRegistrationsReconciled = true;
      candidateSourcesReconciled = true;
    };
    const ensureCandidateWatcher = () => {
      if (
        !candidateWatcherReady ||
        !candidateConfigRegistrationsReconciled ||
        !candidatePluginRegistrationsReconciled ||
        !candidateSourcesReconciled
      ) {
        synchronizeCandidateWatcher(listPendingCandidateWatchBaselines());
        clearPendingCandidateWatchBaselines();
      }
    };
    const synchronizeCandidateAnalysisDependencies = (
      analysis: Awaited<ReturnType<typeof createCoreGraph>>,
      coverageComplete = false,
    ) => {
      const unsafeBoundaries = [
        candidatePageRouteWatchState?.unsafeBoundary,
        candidateServerRouteWatchState?.unsafeBoundary,
      ].filter((boundary): boundary is string => Boolean(boundary));
      candidateAnalysisWatchDependencies = analysis.fileDependencies.filter(
        (file) =>
          unsafeBoundaries.every(
            (unsafeBoundary) => !isInsideCwd(unsafeBoundary, file),
          ),
      );
      candidateWatchCoverageComplete = coverageComplete;
      synchronizeCandidateWatcher(listPendingCandidateWatchBaselines());
      clearPendingCandidateWatchBaselines();
    };
    const captureCandidateSourceRead = (file: string) => {
      const absolute = path.resolve(file);
      candidateTransientSourceDependencies.add(absolute);
      candidateSourcesReconciled = false;
      if (candidateSourceBaselines.has(absolute)) return;
      candidateSourceBaselines.set(absolute, captureWatchBaseline(absolute));
    };
    const captureCandidateObservedSourceDependency = (file: string) => {
      const absolute = path.resolve(file);
      candidateObservedSourceDependencies.add(absolute);
      captureCandidateSourceRead(absolute);
    };
    const captureCandidateConfigDependency = (file: string) => {
      const absolute = path.resolve(file);
      candidateConfigDependencies.add(absolute);
      candidateConfigRegistrationsReconciled = false;
      if (candidateConfigBaselines.has(absolute)) return;
      candidateConfigBaselines.set(absolute, captureWatchBaseline(absolute));
    };
    const commitCandidateConfigDependencies = () => {
      if (!requiresBundlerConfigReload) return;
      activeConfigWatchFiles.clear();
      for (const file of candidateConfigDependencies) {
        activeConfigWatchFiles.add(file);
      }
    };
    const commitCandidateObservedSourceDependencies = () => {
      activeObservedSourceDependencies.clear();
      for (const file of candidateObservedSourceDependencies) {
        activeObservedSourceDependencies.add(file);
      }
    };
    const rollbackCandidatePluginGeneration = () => {
      if (!candidateGenerationCommitted && candidateBundlerGeneration) {
        retireBundlerGeneration(candidateBundlerGeneration);
        if (previousBundlerGeneration) {
          activeBundlerGeneration = previousBundlerGeneration;
        }
      }
      return stagedPluginHooks?.rollback();
    };
    const selectAndResumeBundlerUpdateTransition = async (
      outcome: "accept" | "rollback",
    ) => {
      const transition = bundlerUpdateTransition;
      if (!transition) return;
      try {
        if (outcome === "accept") await transition.accept();
        else await transition.rollback();
      } catch (error) {
        if (outcome === "rollback") reportDevWatchFailure(error);
        throw error;
      }
      unblockBundlerGeneration(activeBundlerGeneration);
      try {
        await transition.resume();
      } catch (error) {
        blockBundlerGeneration(activeBundlerGeneration);
        if (outcome === "rollback") reportDevWatchFailure(error);
        throw error;
      }
    };
    const prepareBundlerUpdateTransitionFinalization = async () => {
      const transition = bundlerUpdateTransition;
      if (!transition) return;
      await transition.prepareFinalize();
    };
    const finalizeBundlerUpdateTransition = () => {
      const transition = bundlerUpdateTransition;
      if (!transition) return;
      try {
        const result: unknown = transition.finalize();
        if (
          result !== null &&
          (typeof result === "object" || typeof result === "function") &&
          typeof (result as { then?: unknown }).then === "function"
        ) {
          // Absorb a later rejection after reporting the synchronous contract
          // violation. Waiting here could deadlock a fully committed update.
          void Promise.resolve(result).catch(() => {});
          throw new Error(
            `[evjs] Bundler "${bundler.name}" returned a Promise from development transition finalize(). finalize() must synchronously release the committed update boundary.`,
          );
        }
      } finally {
        bundlerUpdateTransition = undefined;
      }
    };
    const rollbackCandidateState = () =>
      runCleanupTasks([
        rollbackCandidatePluginGeneration,
        async () => {
          if (candidateRestoreFailed) {
            throw new Error(
              "[evjs] The previous generated development state did not restore completely; the bundler update boundary remains closed.",
            );
          }
          const restoreErrors: unknown[] = [];
          try {
            await frameworkOutputTransaction?.restore();
          } catch (error) {
            restoreErrors.push(error);
          }
          try {
            await generatedStateSnapshot?.restore();
          } catch (error) {
            restoreErrors.push(error);
          }
          if (restoreErrors.length > 0) {
            candidateRestoreFailed = true;
            const error = new AggregateError(
              restoreErrors,
              "[evjs] Unable to restore the previous generated development state; the bundler update boundary remains closed.",
            );
            reportDevWatchFailure(error);
            throw error;
          }
          getBundlerGenerationState(
            activeBundlerGeneration,
            true,
          ).frameworkOutputTransaction = undefined;
          await selectAndResumeBundlerUpdateTransition("rollback");
          await prepareBundlerUpdateTransitionFinalization();
          finalizeBundlerUpdateTransition();
        },
      ]);
    const retireResolvedCandidateWatcher = () => {
      if (
        requiresBundlerConfigReload ||
        candidateDependencyWatcher?.requiresConfigReload !== true
      ) {
        retireCandidateDependencyWatcher();
      }
    };

    try {
      const {
        configuredConfig: nextConfiguredConfig,
        config: baseNextConfig,
        serverRouteWatchState: nextServerRouteWatchState,
      } = await loadCurrentConfig(
        requiresBundlerConfigReload,
        requiresBundlerConfigReload
          ? ({ page, server }) => {
              candidatePageRouteWatchState = page;
              candidateServerRouteWatchState = server;
              synchronizeCandidateWatcher();
            }
          : ({ page, server }) => {
              candidatePageRouteWatchState = page;
              candidateServerRouteWatchState = server;
              const routeDependencies = [
                ...page.dependencies,
                ...server.dependencies,
              ];
              if (routeDependencies.length > 0) {
                candidateRouteWatchBaselines.push(
                  prepareDevWatchPlan(routeDependencies),
                );
              }
              activePageRouteWatchState = page;
              activeServerRouteWatchState = server;
              currentDevWatchReconcileFrom =
                refreshDevDependencyWatchers(currentDevWatchReconcileFrom) ??
                currentDevWatchReconcileFrom;
            },
        requiresBundlerConfigReload
          ? captureCandidateConfigDependency
          : undefined,
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
        );
        nextApplicationPluginSettings =
          nextPluginSettingsState.applicationSettings;
      }

      validateHtmlTemplates(cwd, nextConfig);
      if (requiresBundlerConfigReload) {
        stagedPluginHooks = await stagePluginHooks(
          nextConfig,
          (file, baseline) => {
            candidatePluginWatchDependencies.add(file);
            candidatePluginWatchBaselines.set(file, baseline);
            candidatePluginRegistrationsReconciled = false;
          },
        );
        synchronizeCandidateWatcher(listPendingCandidateWatchBaselines());
        clearPendingCandidateWatchBaselines();
        const configuredAnalysisDependencies =
          listConfiguredAnalysisWatchDependencies(cwd, nextConfig);
        if (configuredAnalysisDependencies.length > 0) {
          candidateAnalysisWatchDependencies = configuredAnalysisDependencies;
          synchronizeCandidateWatcher([
            prepareDevWatchPlan(configuredAnalysisDependencies),
          ]);
        }
      }
      const updateController = devController;
      if (!updateController) {
        await rollbackCandidateState();
        ensureCandidateWatcher();
        logger.warn`The selected bundler does not expose a dev controller. Please restart ev dev to apply framework plan changes.`;
        return;
      }
      generatedStateSnapshot = await createGeneratedDevStateSnapshot(cwd);
      // Reserve the adapter boundary before analysis writes any live `.ev`
      // input. Built-in adapters suppress transition-time build results until
      // updatePlan either adopts the final candidate or Core restores the
      // previous generated snapshot and cancels the transition.
      bundlerUpdateTransition = await updateController.beginUpdate();
      blockBundlerGeneration(activeBundlerGeneration);
      const { analysis: nextAnalysis, plan: nextPlan } =
        await analyzeAndMaterializeFrameworkIR({
          cwd,
          mode: "development",
          config: nextConfig,
          pluginContext:
            stagedPluginHooks?.pluginContext ??
            ({
              ...pluginCtx,
              config: nextConfig,
            } satisfies PluginSetupContext<TBundlerCfg>),
          pluginSettings: nextPluginSettings,
          applicationPluginSettings: nextApplicationPluginSettings,
          plan: { distDir: DEV_DIST_DIR },
          beforeSourceRead: captureCandidateSourceRead,
          onSourceDependency: captureCandidateObservedSourceDependency,
          onAnalysis(analysis) {
            if (requiresBundlerConfigReload) {
              synchronizeCandidateAnalysisDependencies(analysis);
            }
            reportGraphDiagnostics(analysis);
          },
        });
      if (requiresBundlerConfigReload) {
        synchronizeCandidateAnalysisDependencies(nextAnalysis, true);
      }
      const update = diffBuildPlan(activePlan, nextPlan, reason);
      const updateTransition = bundlerUpdateTransition;
      if (!updateTransition) {
        throw new Error(
          `[evjs] Bundler "${bundler.name}" did not establish a development update boundary before candidate framework input was materialized.`,
        );
      }

      const previousConfig = activeConfig;
      const previousConfiguredConfig = activeConfiguredConfig;
      const previousPluginSettings = activePluginSettings;
      const previousApplicationPluginSettings = activeApplicationPluginSettings;
      const previousAnalysis = activeAnalysis;
      const previousPlan = activePlan;
      const priorBundlerGeneration = activeBundlerGeneration;
      previousBundlerGeneration = priorBundlerGeneration;
      const previousBundlerGenerationState = getBundlerGenerationState(
        priorBundlerGeneration,
        true,
      );
      const nextBundlerGeneration = createBundlerGeneration();
      candidateBundlerGeneration = nextBundlerGeneration;

      preflightBundlerBuild(bundler, nextPlan);
      preflightBundlerDevUpdate(bundler, update);
      frameworkOutputTransaction = createDevFrameworkOutputTransaction(cwd, [
        previousPlan,
        nextPlan,
      ]);

      let activationAttempted = false;
      const activateCandidateGeneration = () => {
        if (activationAttempted) {
          throw new Error(
            `[evjs] Bundler "${bundler.name}" violated the development generation contract by calling updatePlan().activate() more than once.`,
          );
        }
        activationAttempted = true;
        if (activeBundlerGeneration !== priorBundlerGeneration) {
          throw new Error(
            `[evjs] Bundler "${bundler.name}" tried to activate a development generation after its previous generation was replaced.`,
          );
        }

        stagedPluginHooks?.activate();
        activeConfiguredConfig = nextConfiguredConfig;
        activeConfig = nextConfig;
        activePluginSettings = nextPluginSettings;
        activeApplicationPluginSettings = nextApplicationPluginSettings;
        activeAnalysis = nextAnalysis;
        activePlan = nextPlan;
        pluginCtx.config = nextConfig;
        previousBundlerGenerationState.frameworkOutputTransaction =
          frameworkOutputTransaction;
        activateBundlerGeneration(
          nextBundlerGeneration,
          {
            analysis: nextAnalysis,
            config: nextConfig,
            frameworkOutputTransaction,
            plan: nextPlan,
            pluginExecution: activePluginExecution,
            frameworkRuntime: undefined,
            serverEntry: undefined,
          },
          true,
        );
        activeBundlerGeneration = nextBundlerGeneration;
        candidateGenerationActivated = true;
      };

      try {
        await updateController.updatePlan(update, {
          config: nextConfig,
          configChanged: requiresBundlerConfigReload,
          transition: updateTransition,
          generation: nextBundlerGeneration,
          activate: activateCandidateGeneration,
        });
        if (!candidateGenerationActivated) {
          throw new Error(
            `[evjs] Bundler "${bundler.name}" violated the development generation contract by completing updatePlan() without calling activate().`,
          );
        }
        await selectAndResumeBundlerUpdateTransition("accept");
        await frameworkOutputTransaction.prepareCommit();
        await prepareBundlerUpdateTransitionFinalization();
        frameworkOutputTransaction.commit();
        previousBundlerGenerationState.frameworkOutputTransaction = undefined;
        getBundlerGenerationState(
          nextBundlerGeneration,
          true,
        ).frameworkOutputTransaction = undefined;
        candidateGenerationCommitted = true;
        retireBundlerGeneration(priorBundlerGeneration);
        try {
          await frameworkOutputTransaction.runAfterBuild();
        } catch (error) {
          recordPostCommitFailure(error);
        }
        try {
          finalizeBundlerUpdateTransition();
        } catch (error) {
          // Canonical output and generation ownership are already committed.
          // Finish committing the candidate snapshot, then fail the dev
          // session instead of attempting an impossible mixed-state rollback.
          recordPostCommitFailure(error);
        }
      } catch (err) {
        activeConfiguredConfig = previousConfiguredConfig;
        activeConfig = previousConfig;
        activePluginSettings = previousPluginSettings;
        activeApplicationPluginSettings = previousApplicationPluginSettings;
        activeAnalysis = previousAnalysis;
        activePlan = previousPlan;
        if (!stagedPluginHooks) {
          pluginCtx.config = previousConfig;
        }
        try {
          await rollbackCandidateState();
        } catch (rollbackError) {
          ensureCandidateWatcher();
          throw new AggregateError(
            [err, rollbackError],
            "[evjs] Framework plan update failed and dev state rollback also failed.",
            { cause: err },
          );
        }
        ensureCandidateWatcher();
        logger.warn`Unable to apply framework plan update without restart: ${err}`;
        return;
      }
      activePageRouteWatchState =
        candidatePageRouteWatchState ?? activePageRouteWatchState;
      activeServerRouteWatchState = nextServerRouteWatchState;
      commitCandidateConfigDependencies();
      commitCandidateObservedSourceDependencies();
      const committedDevServerOrigin = pendingDevServerOrigin;
      pendingDevServerOrigin = undefined;
      await commitStagedPluginHooks(
        stagedPluginHooks,
        committedDevServerOrigin,
        currentDevWatchReconcileFrom,
        [...candidateRouteWatchBaselines, ...candidateSourceBaselines.values()],
      );
      await generatedStateSnapshot.commit();
      retireResolvedCandidateWatcher();
      if (postCommitFailure) {
        reportDevWatchFailure(postCommitFailure.error);
      }
    } catch (err) {
      return rethrowAfterCleanup(
        err,
        async () => {
          try {
            await rollbackCandidateState();
          } finally {
            ensureCandidateWatcher();
          }
        },
        "[evjs] Framework dev state update failed and rollback also failed.",
      );
    }
  };

  const handleDevDependencyChange = (
    changedFiles: readonly string[],
    forceConfigReload = false,
    devWatchReconcileFrom?: PreparedWatchFilesPlan,
    candidateWatchReconcileFrom?: PreparedWatchFilesPlan,
  ): Promise<void> => {
    if (devSessionEnding || devWatchFailed) return Promise.resolve();
    devShortcutPublicationSuspended = true;
    restoreDevCliShortcutsAfterUpdate = false;
    pendingDevServerOrigin = undefined;
    return applyDevDependencyChange(
      changedFiles,
      forceConfigReload,
      devWatchReconcileFrom,
      candidateWatchReconcileFrom,
    ).finally(() => {
      const restoreShortcuts = restoreDevCliShortcutsAfterUpdate;
      restoreDevCliShortcutsAfterUpdate = false;
      pendingDevServerOrigin = undefined;
      devShortcutPublicationSuspended = false;
      if (restoreShortcuts && !devSessionEnding) {
        void refreshDevCliShortcuts().catch((error) => {
          logger.warn`Plugin CLI shortcuts could not be restored after a framework update: ${error}`;
        });
      }
    });
  };

  function overlapsCandidateWatchDependency(changedFile: string): boolean {
    if (!candidateDependencyWatcher?.requiresConfigReload) return false;
    for (const dependency of candidateDependencyWatcher.dependencies) {
      if (
        isInsideCwd(dependency, changedFile) ||
        isInsideCwd(changedFile, dependency)
      ) {
        return true;
      }
    }
    return false;
  }

  function scheduleDevUpdate(changedFile: string, forceConfigReload = false) {
    if (devSessionEnding || devWatchFailed) return;
    pendingDevChanges.add(changedFile);
    pendingForcedConfigReload ||=
      forceConfigReload || overlapsCandidateWatchDependency(changedFile);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      const changedFiles = [...pendingDevChanges];
      const shouldForceConfigReload = pendingForcedConfigReload;
      pendingDevChanges.clear();
      pendingForcedConfigReload = false;
      const devWatchReconcileFrom = captureDevDependencyWatchPlan();
      const candidateWatchReconcileFrom = captureCandidateDependencyWatchPlan();
      if (devWatchFailed) return;
      const changedSnapshotPlans = [
        devWatchReconcileFrom,
        candidateWatchReconcileFrom,
      ].filter((plan): plan is PreparedWatchFilesPlan => Boolean(plan));
      const changedFilesWithNewSnapshots = changedFiles.filter((file) => {
        const snapshot = changedSnapshotPlans
          .find((plan) => plan.baselineSnapshots.has(file))
          ?.baselineSnapshots.get(file);
        return recordDevChangeSnapshot(
          lastScheduledDevChanges,
          file,
          snapshot,
          shouldForceConfigReload,
        );
      });
      if (changedFilesWithNewSnapshots.length === 0) return;
      devUpdateQueue = devUpdateQueue
        .catch(() => {})
        .then(() =>
          handleDevDependencyChange(
            changedFilesWithNewSnapshots,
            shouldForceConfigReload,
            devWatchReconcileFrom,
            candidateWatchReconcileFrom,
          ),
        )
        .catch((err) => {
          logger.warn`Failed to update framework dev state: ${err}`;
        });
    }, 50);
  }

  const cleanupDev = async () => {
    devSessionEnding = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    pendingDevChanges.clear();
    lastScheduledDevChanges.clear();
    pendingForcedConfigReload = false;
    onPluginWatchFileAdded = undefined;
    onBundlerConfigWatchFileAdded = undefined;
    reportWatchRegistrationFailure = undefined;
    pendingPluginWatchBaselines.clear();
    pendingBundlerWatchBaselines.clear();
    await runCleanupTasks([
      () => clearDevDependencyWatcher(),
      () => clearCandidateDependencyWatcher(),
      async () => {
        await cliShortcutsRefreshQueue;
        await clearDevCliShortcuts(0);
      },
      () => devController?.close?.(),
      () => devUpdateQueue.catch(() => {}),
      () => outputCycleQueue,
      () => restartQueue.catch(() => {}),
      () => apiProcessController.stop(),
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
      async () => {
        const execution = activePluginExecution;
        retireBundlerGeneration(activeBundlerGeneration);
        retirePluginContext();
        await runCleanupTasks([
          ...[...deferredPluginExecutionDisposals.values()].map(
            (dispose) => dispose,
          ),
          () => disposeDevPluginExecution(execution, false),
        ]);
      },
    ]);
  };

  try {
    const startupWatchPlan = prepareWatchFilesPlan(
      createDevDependencyWatchTopology(),
    );
    preflightBundlerBuild(bundler, activePlan);
    devController =
      (await bundler.dev({
        config: activeConfig,
        cwd,
        generation: initialBundlerGeneration,
        hooks,
        plan: activePlan,
        addWatchFile: addBundlerConfigWatchFile,
        callbacks: {
          async onDevServerReady(context) {
            logger.info`${formatDevServerReady(
              context,
              activeConfig,
              activePlan,
            )}`;
            if (devShortcutPublicationSuspended) {
              pendingDevServerOrigin = context.origin;
              return;
            }
            await refreshDevCliShortcuts(context.origin);
          },
          async onBuildFacts(generation, bundlerFacts, options) {
            const { isRebuild } = options;
            const generationState =
              getBundlerGenerationStateForFacts(generation);
            if (!generationState) return "discarded";
            const cycleConfig = generationState.config;
            const cycleAnalysis = generationState.analysis;
            const cyclePlan = generationState.plan;
            const cyclePluginExecution = generationState.pluginExecution;
            const cycleFrameworkOutputTransaction =
              generationState.frameworkOutputTransaction;
            const releaseFrameworkOutputTransactionCycle =
              cycleFrameworkOutputTransaction?.beginCycle();
            if (
              cycleFrameworkOutputTransaction &&
              !releaseFrameworkOutputTransactionCycle
            ) {
              return "discarded";
            }
            const cycleHooks = [...cyclePluginExecution.hooks];
            const cyclePluginContext: PluginSetupContext<TBundlerCfg> = {
              ...cyclePluginExecution.context,
              config: cycleConfig,
            };
            const releaseCycle = cyclePluginExecution.beginCycle();
            return enqueueOutputCycle(async () => {
              try {
                await cycleFrameworkOutputTransaction?.capture();
                const outputSnapshot = await createFrameworkOutputSnapshot(
                  cwd,
                  [cyclePlan],
                );
                let linkedOutput: Awaited<
                  ReturnType<typeof linkAndEmitBuildOutput<TBundlerCfg>>
                >;
                try {
                  linkedOutput = await linkAndEmitBuildOutput({
                    bundlerFacts,
                    graph: cycleAnalysis.graph,
                    plan: cyclePlan,
                    config: cycleConfig,
                    cwd,
                    hooks: cycleHooks,
                    pluginCtx: cyclePluginContext,
                    isRebuild,
                  });
                } catch (error) {
                  return rethrowAfterCleanup(
                    error,
                    () => outputSnapshot.restore(),
                    "[evjs] Framework output cycle failed and canonical output rollback also failed.",
                  );
                }
                outputSnapshot.commit();
                generationState.frameworkRuntime =
                  linkedOutput.frameworkRuntime;
                generationState.serverEntry = linkedOutput.output.server.entry;
                async function notifyAfterBuild(): Promise<void> {
                  await runAfterBuildHooks(
                    cycleHooks,
                    createBuildResult(linkedOutput.output, isRebuild, {
                      frameworkRuntime: linkedOutput.frameworkRuntime,
                    }),
                    { cwd, emittedFiles: bundlerFacts.emittedFiles },
                  );
                }
                if (cycleFrameworkOutputTransaction) {
                  cycleFrameworkOutputTransaction.deferAfterBuild(
                    notifyAfterBuild,
                  );
                } else {
                  await notifyAfterBuild();
                }
                return "published" as const;
              } finally {
                releaseFrameworkOutputTransactionCycle?.();
                releaseCycle();
              }
            });
          },
          onServerBundleReady: handleServerBundleReady,
        },
      })) ?? undefined;
    releaseDevDistLock = await writeDevDistLock(cwd, activePlan.distDir);
    unregisterDevDistExitCleanup = registerRuntimeExitCleanup(() =>
      releaseDevDistLock?.sync(),
    );
    refreshDevDependencyWatchers(startupWatchPlan);
    reconcileRegisteredWatchBaselines([
      initialDevWatchPlans.config,
      ...initialDevWatchPlans.configDependencies.values(),
      ...(initialDevWatchPlans.pageRoutes
        ? [initialDevWatchPlans.pageRoutes]
        : []),
      ...(initialDevWatchPlans.serverRoutes
        ? [initialDevWatchPlans.serverRoutes]
        : []),
      ...initialAnalysisWatchBaselines,
      ...initialSourceBaselines.values(),
    ]);
    reconcileRegisteredWatchBaselines([
      ...pendingPluginWatchBaselines.values(),
      ...pendingBundlerWatchBaselines.values(),
    ]);
    pendingPluginWatchBaselines.clear();
    pendingBundlerWatchBaselines.clear();
    onPluginWatchFileAdded = (baseline) => {
      refreshDevDependencyWatchers(baseline);
    };
    onBundlerConfigWatchFileAdded = (baseline) => {
      refreshDevDependencyWatchers(baseline);
    };
    const waitForSessionEnd = devController?.done
      ? Promise.race([waitForShutdown, devController.done])
      : waitForShutdown;
    await Promise.race([
      waitForSessionEnd,
      waitForDevWatchFailure.then((error) => {
        throw error;
      }),
    ]);
  } catch (error) {
    return rethrowAfterCleanup(
      error,
      cleanupDev,
      "[evjs] Dev failed and cleanup also failed.",
    );
  }
  await cleanupDev();
}

export async function build<TBundlerCfg = unknown>(
  userConfig?: Config<TBundlerCfg>,
  options?: BuildOptions<TBundlerCfg>,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  await assertNoActiveDevSessionLock(cwd);
  return withProjectOperationLock(cwd, "build", () =>
    runBuild(userConfig, options, cwd),
  );
}

async function runBuild<TBundlerCfg = unknown>(
  userConfig: Config<TBundlerCfg> | undefined,
  options: BuildOptions<TBundlerCfg> | undefined,
  cwd: string,
): Promise<void> {
  process.env.NODE_ENV ??= "production";
  const prepared = await prepareInternalFrameworkBuild(userConfig, {
    cwd,
    mode: "production",
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
    // Reject symbolic-link leaves at framework-owned canonical paths before
    // staging. The snapshot is validation-only in production; whole-tree
    // rollback is owned by the transaction below.
    const canonicalOutputValidation = await createFrameworkOutputSnapshot(cwd, [
      prepared.plan,
    ]);
    canonicalOutputValidation.commit();
    // Compile and link the complete production tree in staging. Canonical
    // output is replaced only after every pre-afterBuild phase succeeds, so a
    // failed clean/compile/link/write cannot mix generations.
    const outputTransaction = await createProductionOutputTransaction(
      cwd,
      prepared.plan,
    );
    let bundlerFacts: BundlerBuildFacts | undefined;
    let linkedOutput:
      | Awaited<ReturnType<typeof linkAndEmitBuildOutput<TBundlerCfg>>>
      | undefined;
    try {
      bundlerFacts = await bundler.build({
        config: prepared.config,
        cwd,
        hooks: prepared.hooks,
        plan: outputTransaction.buildPlan,
        addWatchFile: prepared.pluginContext.addWatchFile,
      });
      linkedOutput = await linkAndEmitBuildOutput({
        bundlerFacts,
        graph: prepared.graph,
        plan: prepared.plan,
        config: prepared.config,
        cwd,
        hooks: prepared.hooks,
        pluginCtx: prepared.pluginContext,
        isRebuild: false,
        emissionPaths: outputTransaction.outputPaths,
      });
      await outputTransaction.publish();
    } catch (error) {
      await rethrowAfterCleanup(
        error,
        () => outputTransaction.rollback(),
        "[evjs] Production output failed and staging rollback also failed.",
      );
    }
    if (!bundlerFacts || !linkedOutput) {
      throw new Error("[evjs] Production framework output was not linked.");
    }
    await runAfterBuildHooks(
      prepared.hooks,
      createBuildResult(linkedOutput.output, false, {
        frameworkRuntime: linkedOutput.frameworkRuntime,
      }),
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
