/**
 * Utoopack bundler adapter.
 *
 * Implements the BundlerAdapter interface using @utoo/pack's
 * programmatic `build()` and `dev()` APIs. Utoopack handles
 * "use server" directives natively — no custom loader or child
 * compiler is needed.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  BundlerAdapter,
  BundlerBuildContext,
  BundlerBuildFacts,
  BundlerBuildFactsDisposition,
  BundlerDevContext,
  BundlerDevController,
  ResolvedBuildOutputPaths,
} from "@evjs/ev/_internal/build";
import {
  assertSafeBuildOutputPaths,
  resolveBuildOutputPaths,
} from "@evjs/ev/_internal/build";
import type { ResolvedConfig } from "@evjs/ev/config";
import type { BuildPlan } from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import type { ConfigComplete } from "@utoo/pack";
import { UtoopackManifestGenerator } from "../manifest-generator.js";
import {
  startUtoopackDevWorker,
  type UtoopackDevWorkerHandle,
} from "./dev-worker-client.js";
import {
  ensureUtoopackProcessWorkerScheduler,
  markUtoopackProcessForBuild,
  type UtoopackProcessWorkerScheduler,
} from "./dev-worker-scheduler.js";
import { assertSafeUtoopackCleanOutput } from "./output-paths.js";
import { runUtoopackBuild } from "./runtime.js";
import {
  readStatsVersion,
  startUtoopackStatsWatcher,
  type UtoopackStatsWatcher,
} from "./stats-watcher.js";

const logger = getLogger(["evjs", "bundler-utoopack"]);
const require = createRequire(import.meta.url);
const { version: utoopackVersion } = require("@utoo/pack/package.json") as {
  version: string;
};
type UtoopackRuntime = Pick<typeof import("@utoo/pack"), "build">;
const DEV_STATS_POLL_INTERVAL_MS = 25;

interface UtoopackDevBuildSnapshot {
  facts: BundlerBuildFacts;
  statsVersion: string | undefined;
}

interface ProcessedUtoopackDevBuild extends UtoopackDevBuildSnapshot {
  disposition: BundlerBuildFactsDisposition;
}

async function cleanServerOutput(
  cwd: string,
  outputPaths: ResolvedBuildOutputPaths,
) {
  await assertSafeBuildOutputPaths(cwd, outputPaths);
  await fs.promises.rm(outputPaths.serverDir, {
    recursive: true,
    force: true,
  });
}

async function generateDevArtifacts(
  cwd: string,
  plan: BuildPlan,
  onBuildFacts: (
    facts: BundlerBuildFacts,
    options: { isRebuild: boolean },
  ) => Promise<BundlerBuildFactsDisposition>,
  options: { isRebuild: boolean },
  facts?: BundlerBuildFacts,
): Promise<BundlerBuildFactsDisposition> {
  logger.info`Generating development manifest and HTML...`;
  const buildFacts =
    facts ??
    (await new UtoopackManifestGenerator(cwd, plan).collectBuildFacts());
  return onBuildFacts(buildFacts, options);
}

async function waitForReadableDevStats(
  cwd: string,
  plan: BuildPlan,
  signal: AbortSignal,
): Promise<UtoopackDevBuildSnapshot> {
  const outputPaths = resolveBuildOutputPaths(cwd, plan);
  const requiredStats = resolveRequiredDevStatsPaths(outputPaths, plan);
  if (requiredStats.length === 0) {
    return {
      facts: await new UtoopackManifestGenerator(cwd, plan).collectBuildFacts(),
      statsVersion: undefined,
    };
  }

  while (true) {
    throwIfPollingAborted(
      signal,
      "[evjs] Utoopack development session closed while waiting for build stats.",
    );
    try {
      const versionBefore = await readStatsVersion(requiredStats);
      const facts = await new UtoopackManifestGenerator(
        cwd,
        plan,
      ).collectBuildFacts();
      const versionAfter = await readStatsVersion(requiredStats);
      if (versionBefore && versionBefore === versionAfter) {
        return { facts, statsVersion: versionAfter };
      }
    } catch {}
    await waitForPollingDelay(
      signal,
      "[evjs] Utoopack development session closed while waiting for build stats.",
    );
  }
}

function resolveRequiredDevStatsPaths(
  outputPaths: ResolvedBuildOutputPaths,
  plan: BuildPlan,
): string[] {
  return [
    ...(plan.entries.some((entry) => entry.environment === "client")
      ? [path.join(outputPaths.clientDir, "stats.json")]
      : []),
    ...(hasServerEntries(plan)
      ? [path.join(outputPaths.serverDir, "stats.json")]
      : []),
  ];
}

function throwIfPollingAborted(signal: AbortSignal, message: string): void {
  if (signal.aborted) throw new Error(message);
}

function waitForPollingDelay(
  signal: AbortSignal,
  abortMessage: string,
): Promise<void> {
  throwIfPollingAborted(signal, abortMessage);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, DEV_STATS_POLL_INTERVAL_MS);
    timer.unref();
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error(abortMessage));
    };
    function finish() {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(
      new Error("[evjs] Utoopack development startup was aborted."),
    );
  }
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () =>
        reject(new Error("[evjs] Utoopack development startup was aborted.")),
      { once: true },
    );
  });
}

function requireUtoopack(): UtoopackRuntime {
  // @utoo/pack's import condition targets ESM .js files; Node 18 parses them as CJS.
  return require("@utoo/pack") as UtoopackRuntime;
}

export const utoopackAdapter: BundlerAdapter<ConfigComplete> = {
  name: "utoopack",
  capabilities: {
    build: {
      server: true,
      rsc: false,
      ppr: false,
    },
  },
  async build(
    ctx: BundlerBuildContext<ConfigComplete>,
  ): Promise<BundlerBuildFacts> {
    markUtoopackProcessForBuild();
    const { addWatchFile, config, cwd, hooks, plan } = ctx;
    const { createUtoopackConfig } = await import("./create-config.js");
    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      cwd,
      hooks,
      addWatchFile,
    );

    logger.info`Using @utoo/pack@${utoopackVersion}.`;
    logger.info`Building for production with utoopack...`;

    const outputPaths = resolveBuildOutputPaths(cwd, plan);
    await cleanServerOutput(cwd, outputPaths);

    await assertSafeUtoopackCleanOutput(cwd, utoopackConfig, outputPaths);

    await runUtoopackBuild(requireUtoopack(), utoopackConfig, cwd);

    logger.info`Collecting utoopack build facts...`;
    const generator = new UtoopackManifestGenerator(cwd, plan);

    logger.info`Build complete!`;
    return generator.collectBuildFacts();
  },

  async dev(
    ctx: BundlerDevContext<ConfigComplete>,
  ): Promise<BundlerDevController> {
    return startUtoopackDev(ctx);
  },
};

async function startUtoopackDev(
  ctx: BundlerDevContext<ConfigComplete>,
): Promise<UtoopackDevController> {
  const { addWatchFile, callbacks, config, cwd, hooks, plan, signal } = ctx;
  throwIfUtoopackDevAborted(signal);
  const { createUtoopackConfig, getSpaHistoryFallbackRuleIndex } = await import(
    "./create-config.js"
  );
  throwIfUtoopackDevAborted(signal);
  const utoopackConfig = await createUtoopackConfig(
    config,
    plan,
    cwd,
    hooks,
    addWatchFile,
  );
  throwIfUtoopackDevAborted(signal);
  const outputPaths = resolveBuildOutputPaths(cwd, plan);

  logger.info`Using @utoo/pack@${utoopackVersion}.`;
  logger.info`Starting development server with utoopack...`;
  await assertSafeUtoopackCleanOutput(cwd, utoopackConfig, outputPaths);
  throwIfUtoopackDevAborted(signal);
  const workerScheduler = await ensureUtoopackProcessWorkerScheduler();
  throwIfUtoopackDevAborted(signal);

  const worker = startUtoopackDevWorker({
    cwd,
    config: utoopackConfig,
    workerSchedulerBindingPath: workerScheduler.bindingPath,
    spaHistoryFallbackRuleIndex: getSpaHistoryFallbackRuleIndex(utoopackConfig),
    server: {
      port: config.dev.port,
      https: config.dev.https !== false,
      hostname: "0.0.0.0",
      logServerInfo: false,
    },
  });
  const controller = new UtoopackDevController({
    cwd,
    plan,
    worker,
    workerScheduler,
    onBuildFacts: callbacks.onBuildFacts,
    onServerBundleReady: callbacks.onServerBundleReady,
  });
  if (signal.aborted) {
    void controller
      .close()
      .catch(
        (error) =>
          logger.error`Failed to close aborted Utoopack dev session: ${error}`,
      );
  } else {
    signal.addEventListener(
      "abort",
      () => {
        void controller
          .close()
          .catch(
            (error) =>
              logger.error`Failed to close aborted Utoopack dev session: ${error}`,
          );
      },
      { once: true },
    );
  }

  try {
    const ready = await Promise.race([
      worker.ready,
      worker.failure,
      workerScheduler.failure,
      waitForAbort(signal),
    ]);
    controller.setOrigin(
      formatDevServerOrigin(config, ready.port, ready.hostname),
    );
    const fallbackUpdated = ready.spaHistoryFallbackUpdated;
    if (ready.port !== config.dev.port) {
      const fallbackStatus = fallbackUpdated
        ? " The SPA fallback now targets the actual dev server."
        : "";
      logger.warn`Reserved client port ${config.dev.port} became unavailable during startup; Utoopack is listening on ${ready.port}.${fallbackStatus}`;
    }

    const statsPaths = resolveRequiredDevStatsPaths(outputPaths, plan);
    // Establish the watcher baseline before reading facts. The controller
    // advances it to the exact stable stats version committed by each callback,
    // while the watcher revision guard preserves any newer observation.
    const initialStatsVersion = await readStatsVersion(statsPaths);
    if (statsPaths.length > 0) {
      const watcher = startUtoopackStatsWatcher({
        statsPaths,
        initialVersion: initialStatsVersion,
        async onChange(version) {
          return controller.processStatsChange(version);
        },
        onError(error) {
          logger.error`Failed to process Utoopack rebuild: ${error}`;
        },
      });
      controller.attachStatsWatcher(watcher);
    }
    controller.startInitialFacts();
    worker.throwIfFailed();
    workerScheduler.throwIfFailed();
    return controller;
  } catch (error) {
    try {
      await controller.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "[evjs] Utoopack development startup failed and cleanup also failed.",
        { cause: error },
      );
    }
    throw error;
  }
}

function throwIfUtoopackDevAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new Error("[evjs] Utoopack development startup was aborted.");
}

function hasRuntimeServerEntry(plan: BuildPlan): boolean {
  return plan.entries.some(
    (entry) =>
      entry.environment === "server" && entry.kind === "server-runtime",
  );
}

function hasServerEntries(plan: BuildPlan): boolean {
  return plan.entries.some((entry) => entry.environment === "server");
}

function formatDevServerOrigin(
  config: ResolvedConfig<ConfigComplete>,
  port: number,
  hostname = "localhost",
): string {
  const protocol = config.dev.https ? "https" : "http";
  const host = hostname === "0.0.0.0" ? "localhost" : hostname;
  return `${protocol}://${host}:${port}`;
}

class UtoopackDevController implements BundlerDevController {
  origin = "";
  readonly done: Promise<void>;
  private statsWatcher: UtoopackStatsWatcher | undefined;
  private devWorkQueue: Promise<void> = Promise.resolve();
  private hasEmittedDevArtifacts = false;
  private publishedStatsVersion: string | undefined;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private readonly closingController = new AbortController();

  constructor(
    private readonly options: {
      cwd: string;
      plan: BuildPlan;
      worker: UtoopackDevWorkerHandle;
      workerScheduler: UtoopackProcessWorkerScheduler;
      onBuildFacts: BundlerDevContext<ConfigComplete>["callbacks"]["onBuildFacts"];
      onServerBundleReady: BundlerDevContext<ConfigComplete>["callbacks"]["onServerBundleReady"];
    },
  ) {
    this.done = Promise.race([
      options.worker.done,
      options.workerScheduler.failure,
    ]);
    void this.done.catch(() => {});
  }

  setOrigin(origin: string): void {
    this.origin = origin;
  }

  attachStatsWatcher(watcher: UtoopackStatsWatcher): void {
    if (this.statsWatcher) {
      throw new Error(
        "[evjs] Utoopack stats watcher was attached more than once.",
      );
    }
    this.statsWatcher = watcher;
  }

  startInitialFacts(): void {
    void this.enqueueDevWork(async () => {
      const result = await this.processBuildFacts(false);
      if (result.disposition === "published") {
        this.statsWatcher?.advance(result.statsVersion);
      }
    }).catch((error) => {
      if (!this.closed) {
        logger.error`Failed to process initial Utoopack dev build: ${error}`;
      }
    });
  }

  async close(): Promise<void> {
    this.closePromise ??= (async () => {
      this.closed = true;
      this.closingController.abort();
      const errors: unknown[] = [];
      try {
        await this.statsWatcher?.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await this.options.worker.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        this.options.workerScheduler.throwIfFailed();
      } catch (error) {
        errors.push(error);
      }
      try {
        await this.devWorkQueue;
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "[evjs] Failed to stop Utoopack dev.");
      }
    })();
    return this.closePromise;
  }

  processStatsChange(_version: string): Promise<boolean> {
    if (this.closed) return Promise.resolve(true);
    return this.enqueueDevWork(async () => {
      const currentVersion = await this.readCurrentStatsVersion();
      if (currentVersion && currentVersion === this.publishedStatsVersion) {
        this.statsWatcher?.advance(currentVersion);
        return true;
      }
      const result = await this.processBuildFacts(true);
      if (result.disposition === "published") {
        this.statsWatcher?.advance(result.statsVersion);
      }
      return result.disposition !== "discarded";
    });
  }

  waitForReadableStats(plan: BuildPlan): Promise<UtoopackDevBuildSnapshot> {
    return Promise.race([
      waitForReadableDevStats(
        this.options.cwd,
        plan,
        this.closingController.signal,
      ),
      this.options.worker.failure,
      this.options.workerScheduler.failure,
    ]);
  }

  private readCurrentStatsVersion(): Promise<string | undefined> {
    const outputPaths = resolveBuildOutputPaths(
      this.options.cwd,
      this.options.plan,
    );
    return readStatsVersion(
      resolveRequiredDevStatsPaths(outputPaths, this.options.plan),
    );
  }

  private async processBuildFacts(
    isRebuild: boolean,
  ): Promise<ProcessedUtoopackDevBuild> {
    if (this.closed) {
      return { disposition: "discarded", facts: {}, statsVersion: undefined };
    }
    const snapshot = await this.waitForReadableStats(this.options.plan);
    if (this.closed) return { disposition: "discarded", ...snapshot };
    const disposition = await generateDevArtifacts(
      this.options.cwd,
      this.options.plan,
      this.options.onBuildFacts,
      { isRebuild: isRebuild || this.hasEmittedDevArtifacts },
      snapshot.facts,
    );
    if (disposition === "published") {
      this.hasEmittedDevArtifacts = true;
      this.publishedStatsVersion = snapshot.statsVersion;
      if (hasRuntimeServerEntry(this.options.plan) && !this.closed) {
        await this.options.onServerBundleReady();
      }
    }
    return { disposition, ...snapshot };
  }

  private enqueueDevWork<T>(work: () => Promise<T>): Promise<T> {
    const result = this.devWorkQueue.then(work);
    this.devWorkQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export const __testing = {
  startUtoopackDev,
  waitForReadableDevStats,
};
