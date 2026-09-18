import path from "node:path";
import type { BuildPlan, CoreGraph } from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import {
  type Config,
  type ResolvedFrameworkConfig,
  resolveBundlerConfig,
  resolveConfig,
} from "../../../config/index.js";
import type {
  CliFlags,
  PluginHooks,
  PluginSetupContext,
} from "../../../plugin/index.js";
import { withActiveBundler } from "../bundler/config.js";
import type {
  BundlerAdapter,
  BundlerBuildFacts,
} from "../bundler/contracts.js";
import { preflightBundlerBuild } from "../bundler/contracts.js";
import {
  acquireDevSessionLock,
  acquireProjectOperationLock,
  assertNoActiveDevDistLock,
  assertNoActiveDevSessionLock,
  type DevRuntimeRelease,
  type ProjectOperation,
} from "../dev/runtime.js";
import { runDevSupervisor } from "../dev/supervisor.js";
import {
  withPageRoutingDefaults,
  withServerConventionDefaults,
  withServerRouteDiscovery,
} from "../discovery/convention-config.js";
import { createBuildResult } from "../output/build-result.js";
import {
  createFrameworkOutputSnapshot,
  linkAndEmitBuildOutput,
  validateHtmlTemplates,
} from "../output/framework-output.js";
import { createProductionOutputTransaction } from "../output/production-output-transaction.js";
import type { CreateBuildPlanOptions } from "../plan/types.js";
import {
  collectPluginHooks,
  orderPluginsByDependencies,
  rethrowAfterCleanup,
  runAfterBuildHooks,
  runConfigureHooks,
  runDisposeHooks,
  snapshotPluginFlags,
} from "../plugins/lifecycle.js";
import { resolvePluginSettingsState } from "../plugins/settings.js";
import {
  analyzeAndMaterializeFrameworkIR,
  publishFrameworkRevision,
} from "./analyze-and-materialize.js";

const logger = getLogger(["evjs", "ev"]);

type MutablePluginSetupContext<TBundlerCfg> = Omit<
  PluginSetupContext<TBundlerCfg>,
  "config"
> & {
  config: ResolvedFrameworkConfig<TBundlerCfg>;
};

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
  /** Reload initial config through loadConfig inside the watcher handshake. */
  reloadInitialConfig?: boolean;
  /**
   * Disable interactive CLI shortcuts regardless of `dev.cliShortcuts`.
   * Undefined defers to the resolved application configuration.
   */
  cliShortcuts?: false;
  loadConfig?: (
    cwd: string,
    context?: { onDependency(file: string): void },
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
    const message = location
      ? `${location} - ${diagnostic.message}`
      : diagnostic.message;
    if (diagnostic.level === "error") errors.push(message);
    else logger.warn`${message}`;
  }
  if (errors.length > 0) {
    throw new Error(
      ["[evjs] CoreGraph analysis failed.", ...errors].join("\n"),
    );
  }
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
  const config = bundler
    ? withActiveBundler(resolvedConfig, bundler)
    : resolvedConfig;
  const {
    registry: pluginSettings,
    applicationSettings: applicationPluginSettings,
  } = resolvePluginSettingsState(config);
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
  let hooks: PluginHooks<TBundlerCfg>[] = [];
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await runDisposeHooks(hooks, pluginContext);
  };

  try {
    validateHtmlTemplates(cwd, config);
    const { analysis, generatedIR, plan } =
      await analyzeAndMaterializeFrameworkIR({
        cwd,
        mode,
        config,
        pluginContext,
        pluginSettings,
        applicationPluginSettings,
        plan: options.plan,
        onAnalysis: reportGraphDiagnostics,
      });
    await publishFrameworkRevision({
      cwd,
      generatedIR,
      graph: analysis.graph,
      syncRouteTypes: config.routing !== undefined,
    });
    hooks = await collectPluginHooks(config.plugins, pluginContext);
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
  } catch (error) {
    return rethrowAfterCleanup(
      error,
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

export async function dev<TBundlerCfg = unknown>(
  userConfig?: Config<TBundlerCfg>,
  options?: DevOptions<TBundlerCfg>,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const releaseDevSessionLock = await acquireDevSessionLock(cwd);
  const unregisterDevSessionExitCleanup = registerRuntimeExitCleanup(() =>
    releaseDevSessionLock.sync(),
  );
  process.env.NODE_ENV ??= "development";
  return withRegisteredRuntimeLock({
    release: releaseDevSessionLock,
    unregisterExitCleanup: unregisterDevSessionExitCleanup,
    run: () =>
      withProjectOperationLock(cwd, "dev", () =>
        runDevSupervisor({
          bundler: options?.bundler,
          cwd,
          fallbackBundler: options?.fallbackBundler,
          flags: snapshotPluginFlags(options?.flags),
          cliShortcuts: options?.cliShortcuts,
          loadConfig: options?.loadConfig,
          reloadInitialConfig: options?.reloadInitialConfig,
          registerExitCleanup: registerRuntimeExitCleanup,
          userConfig,
        }),
      ),
    cleanupErrorMessage:
      "[evjs] Dev failed and its session lock cleanup also failed.",
  });
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
    const canonicalOutputValidation = await createFrameworkOutputSnapshot(cwd, [
      prepared.plan,
    ]);
    canonicalOutputValidation.commit();
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
