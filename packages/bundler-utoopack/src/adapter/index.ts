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
  BundlerDevGeneration,
  BundlerDevUpdateOptions,
  BundlerDevUpdateTransition,
  ResolvedBuildOutputPaths,
} from "@evjs/ev/_internal/build";
import {
  assertSafeBuildOutputPaths,
  isArtifactOnlyBuildPlanUpdate,
  isEmptyBuildPlanUpdate,
  resolveBuildOutputPaths,
} from "@evjs/ev/_internal/build";
import type { ResolvedConfig } from "@evjs/ev/config";
import type { BuildPlan, BuildPlanUpdate } from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import type { ConfigComplete } from "@utoo/pack";
import { UtoopackManifestGenerator } from "../manifest-generator.js";
import {
  startUtoopackDevWorker,
  type UtoopackDevWorkerHandle,
} from "./dev-worker-client.js";
import { assertSafeUtoopackCleanOutput } from "./output-paths.js";
import { runUtoopackBuild } from "./runtime.js";
import {
  readServerStatsVersion,
  startUtoopackServerStatsMonitor,
  type UtoopackServerStatsMonitor,
} from "./server-stats-monitor.js";

const logger = getLogger(["evjs", "bundler-utoopack"]);
const require = createRequire(import.meta.url);
const { version: utoopackVersion } = require("@utoo/pack/package.json") as {
  version: string;
};
type UtoopackRuntime = Pick<typeof import("@utoo/pack"), "build">;
const INITIAL_DEV_STATS_TIMEOUT_MS = 10_000;
const DEV_STATS_POLL_INTERVAL_MS = 25;

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
  generation: BundlerDevGeneration,
  onBuildFacts: (
    generation: BundlerDevGeneration,
    facts: BundlerBuildFacts,
    options: { isRebuild: boolean },
  ) => BundlerBuildFactsDisposition | Promise<BundlerBuildFactsDisposition>,
  options: { isRebuild: boolean },
  facts?: BundlerBuildFacts,
): Promise<BundlerBuildFactsDisposition> {
  logger.info`Generating development manifest and HTML...`;
  const buildFacts =
    facts ??
    (await new UtoopackManifestGenerator(cwd, plan).collectBuildFacts());
  return onBuildFacts(generation, buildFacts, options);
}

async function waitForReadableDevStats(
  cwd: string,
  plan: BuildPlan,
  timeoutMs = INITIAL_DEV_STATS_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<BundlerBuildFacts> {
  const outputPaths = resolveBuildOutputPaths(cwd, plan);
  const requiredStats = [
    ...(plan.entries.some((entry) => entry.environment === "client")
      ? [path.join(outputPaths.clientDir, "stats.json")]
      : []),
    ...(hasServerEntries(plan)
      ? [path.join(outputPaths.serverDir, "stats.json")]
      : []),
  ];
  if (requiredStats.length === 0) {
    return new UtoopackManifestGenerator(cwd, plan).collectBuildFacts();
  }

  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (true) {
    throwIfPollingAborted(
      signal,
      "[evjs] Utoopack development session closed while waiting for build stats.",
    );
    try {
      return await new UtoopackManifestGenerator(cwd, plan).collectBuildFacts();
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      const paths = requiredStats
        .map((statsPath) =>
          JSON.stringify(
            path
              .relative(outputPaths.rootDir, statsPath)
              .split(path.sep)
              .join("/"),
          ),
        )
        .join(", ");
      throw new Error(
        `[evjs] Timed out waiting for readable Utoopack development stats at ${paths}.`,
        { cause: lastError },
      );
    }
    await waitForPollingDelay(
      signal,
      "[evjs] Utoopack development session closed while waiting for build stats.",
    );
  }
}

function throwIfPollingAborted(
  signal: AbortSignal | undefined,
  message: string,
): void {
  if (signal?.aborted) throw new Error(message);
}

function waitForPollingDelay(
  signal: AbortSignal | undefined,
  abortMessage: string,
): Promise<void> {
  throwIfPollingAborted(signal, abortMessage);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, DEV_STATS_POLL_INTERVAL_MS);
    timer.unref();
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(abortMessage));
    };
    function finish() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function collectGeneratedEntryInvalidation(
  cwd: string,
  plan: BuildPlan,
): {
  files: string[];
  statsPaths: string[];
} {
  const generatedRoot = path.resolve(cwd, ".ev");
  const environments = new Set<"client" | "server">();
  const files = new Set<string>();
  for (const entry of plan.entries) {
    if (!entry.import.startsWith(".") && !path.isAbsolute(entry.import)) {
      continue;
    }
    const absolute = path.resolve(cwd, entry.import);
    const relative = path.relative(generatedRoot, absolute);
    if (
      relative === "" ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      continue;
    }
    files.add(absolute);
    environments.add(entry.environment);
  }

  const outputPaths = resolveBuildOutputPaths(cwd, plan);
  return {
    files: [...files],
    statsPaths: [
      ...(environments.has("client")
        ? [path.join(outputPaths.clientDir, "stats.json")]
        : []),
      ...(environments.has("server")
        ? [path.join(outputPaths.serverDir, "stats.json")]
        : []),
    ],
  };
}

async function readStatsVersions(
  statsPaths: readonly string[],
): Promise<Map<string, string | undefined>> {
  return new Map(
    await Promise.all(
      statsPaths.map(
        async (statsPath) =>
          [statsPath, await readServerStatsVersion(statsPath)] as const,
      ),
    ),
  );
}

async function waitForStatsVersionsToAdvance(
  statsPaths: readonly string[],
  previous: ReadonlyMap<string, string | undefined>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    throwIfPollingAborted(
      signal,
      "[evjs] Utoopack development session closed during update.",
    );
    const current = await readStatsVersions(statsPaths);
    if (
      statsPaths.every((statsPath) => {
        const version = current.get(statsPath);
        return version !== undefined && version !== previous.get(statsPath);
      })
    ) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `[evjs] Timed out waiting for Utoopack to compile final generated input (${statsPaths
          .map((statsPath) => JSON.stringify(statsPath))
          .join(", ")}). Restart ev dev to recover safely.`,
      );
    }
    await waitForPollingDelay(
      signal,
      "[evjs] Utoopack development session closed during update.",
    );
  }
}

function requireUtoopack(): UtoopackRuntime {
  // @utoo/pack's import condition targets ESM .js files; Node 18 parses them as CJS.
  return require("@utoo/pack") as UtoopackRuntime;
}

export const utoopackAdapter: BundlerAdapter<ConfigComplete> = {
  name: "utoopack",
  capabilities: {
    build: {
      server: false,
      rsc: false,
      ppr: false,
    },
    dev: {
      html: true,
      entries: false,
      routes: false,
      server: false,
      resolution: false,
    },
  },
  async build(
    ctx: BundlerBuildContext<ConfigComplete>,
  ): Promise<BundlerBuildFacts> {
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
  ): Promise<BundlerDevController<ConfigComplete>> {
    return startUtoopackDev(ctx);
  },
};

async function startUtoopackDev(
  ctx: BundlerDevContext<ConfigComplete>,
  statsTimeoutMs = INITIAL_DEV_STATS_TIMEOUT_MS,
): Promise<UtoopackDevController> {
  const { addWatchFile, callbacks, config, cwd, generation, hooks, plan } = ctx;
  const { createUtoopackConfig, getSpaHistoryFallbackRuleIndex } = await import(
    "./create-config.js"
  );
  const utoopackConfig = await createUtoopackConfig(
    config,
    plan,
    cwd,
    hooks,
    addWatchFile,
  );
  const outputPaths = resolveBuildOutputPaths(cwd, plan);

  logger.info`Using @utoo/pack@${utoopackVersion}.`;
  logger.info`Starting development server with utoopack...`;
  await assertSafeUtoopackCleanOutput(cwd, utoopackConfig, outputPaths);

  const worker = startUtoopackDevWorker({
    cwd,
    config: utoopackConfig,
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
    generation,
    plan,
    worker,
    onBuildFacts: callbacks.onBuildFacts,
    onServerBundleReady: callbacks.onServerBundleReady,
  });

  try {
    const ready = await Promise.race([worker.ready, worker.failure]);
    const devServerOrigin = formatDevServerOrigin(
      config,
      ready.port,
      ready.hostname,
    );
    const fallbackUpdated = ready.spaHistoryFallbackUpdated;
    if (ready.port !== config.dev.port) {
      const fallbackStatus = fallbackUpdated
        ? " The SPA fallback now targets the actual dev server."
        : "";
      logger.warn`Reserved client port ${config.dev.port} became unavailable during startup; Utoopack is listening on ${ready.port}.${fallbackStatus}`;
    }

    const serverStatsPath = path.join(outputPaths.serverDir, "stats.json");
    // Establish the monitor baseline before reading facts. If stats changes
    // while facts are being collected, the monitor may conservatively emit a
    // duplicate cycle, but it cannot mistake an unseen newer version for the
    // version represented by the initial callback.
    const initialServerStatsVersion = hasServerEntries(plan)
      ? await readServerStatsVersion(serverStatsPath)
      : undefined;
    const initialFacts = await controller.waitForReadableStats(
      plan,
      statsTimeoutMs,
    );
    const initialDisposition = await generateDevArtifacts(
      cwd,
      plan,
      generation,
      callbacks.onBuildFacts,
      { isRebuild: false },
      initialFacts,
    );
    if (initialDisposition !== "published") {
      throw new Error(
        "[evjs] Core discarded the initial Utoopack facts snapshot.",
      );
    }
    worker.throwIfFailed();

    if (hasRuntimeServerEntry(plan)) {
      await callbacks.onServerBundleReady(generation);
      worker.throwIfFailed();
    }
    if (hasServerEntries(plan)) {
      controller.markServerStatsPublished(initialServerStatsVersion);
      const monitor = startUtoopackServerStatsMonitor({
        statsPath: serverStatsPath,
        initialVersion: initialServerStatsVersion,
        async onChange(version) {
          return controller.processServerStatsChange(version, statsTimeoutMs);
        },
        onError(error) {
          logger.error`Failed to process Utoopack server rebuild: ${error}`;
        },
      });
      controller.attachServerStatsMonitor(monitor);
    }

    await callbacks.onDevServerReady?.({ origin: devServerOrigin });
    worker.throwIfFailed();
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

interface UtoopackDevBuildState {
  readonly generation: BundlerDevGeneration;
  readonly plan: BuildPlan;
}

interface UtoopackDevPlanTransition extends BundlerDevUpdateTransition {
  stage(options: {
    publish(): void | Promise<void>;
    rollback():
      | (() => void | Promise<void>)
      | Promise<() => void | Promise<void>>;
  }): void;
  defer(): Promise<boolean>;
  abort(): void;
}

class UtoopackDevController implements BundlerDevController<ConfigComplete> {
  private serverStatsMonitor: UtoopackServerStatsMonitor | undefined;
  private devWorkQueue: Promise<void> = Promise.resolve();
  private pendingPlanTransition: UtoopackDevPlanTransition | undefined;
  private publishedServerStatsVersion: string | undefined;
  private closing = false;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private readonly closingController = new AbortController();
  readonly done: Promise<void>;

  constructor(
    private options: {
      cwd: string;
      generation: BundlerDevGeneration;
      plan: BuildPlan;
      worker: UtoopackDevWorkerHandle;
      onBuildFacts: BundlerDevContext<ConfigComplete>["callbacks"]["onBuildFacts"];
      onServerBundleReady: BundlerDevContext<ConfigComplete>["callbacks"]["onServerBundleReady"];
    },
  ) {
    this.done = options.worker.done;
  }

  attachServerStatsMonitor(monitor: UtoopackServerStatsMonitor): void {
    if (this.serverStatsMonitor) {
      throw new Error(
        "[evjs] Utoopack server stats monitor was attached more than once.",
      );
    }
    this.serverStatsMonitor = monitor;
  }

  markServerStatsPublished(version: string | undefined): void {
    this.publishedServerStatsVersion = version;
  }

  async close(): Promise<void> {
    this.closePromise ??= (async () => {
      this.closing = true;
      this.closed = true;
      this.closingController.abort();
      this.pendingPlanTransition?.abort();
      const errors: unknown[] = [];
      try {
        await this.serverStatsMonitor?.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await this.options.worker.close();
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

  async beginUpdate(): Promise<BundlerDevUpdateTransition> {
    this.throwIfUnavailable();
    if (this.pendingPlanTransition) {
      throw new Error(
        "[evjs] Utoopack dev received overlapping framework plan updates. Wait for the active update boundary to settle before starting another update.",
      );
    }
    const initialPlan = this.options.plan;
    const initialGeneration = this.options.generation;
    const transition = createUtoopackDevPlanTransition({
      onOpenAccept: () => async () => {
        const publish = await this.prepareBuildPublication(
          initialPlan,
          initialGeneration,
        );
        await publish();
      },
      onOpenRollback: () => async () => {
        const publish = await this.prepareBuildPublication(
          initialPlan,
          initialGeneration,
        );
        await publish();
      },
      onSettled: () => {
        if (this.pendingPlanTransition === transition) {
          this.pendingPlanTransition = undefined;
        }
      },
    });
    this.pendingPlanTransition = transition;
    const precedingWork = this.devWorkQueue;
    await precedingWork;
    this.throwIfUnavailable();
    if (this.pendingPlanTransition !== transition) {
      throw new Error(
        "[evjs] Utoopack development update boundary settled before it became ready.",
      );
    }
    return transition;
  }

  async updatePlan(
    update: BuildPlanUpdate,
    options: BundlerDevUpdateOptions<ConfigComplete>,
  ): Promise<void> {
    this.throwIfUnavailable();
    const transition = this.pendingPlanTransition;
    if (!transition || options.transition !== transition) {
      throw new Error(
        "[evjs] Utoopack dev updatePlan() must receive the active transition returned by beginUpdate().",
      );
    }
    if (options.configChanged) {
      throw new Error(
        "[evjs] Utoopack dev cannot safely replace framework, proxy, or plugin bundler configuration in place. Restart ev dev to apply the updated config.",
      );
    }
    await assertSafeBuildOutputPaths(
      this.options.cwd,
      resolveBuildOutputPaths(this.options.cwd, update.next),
    );
    if (
      !isEmptyBuildPlanUpdate(update) &&
      !isArtifactOnlyBuildPlanUpdate(update)
    ) {
      throw new Error(
        `[evjs] Utoopack dev cannot apply framework plan changes without restarting ev dev (${formatUnsupportedPlanUpdate(update)}). HTML/generated-only framework plan updates are supported; entry additions, removals, resolution changes, server changes, and route metadata changes still require a lower-layer Utoopack update API.`,
      );
    }
    return this.enqueueDevWork(() =>
      this.applyPlanUpdate(update, options, transition),
    );
  }

  processServerStatsChange(
    version: string,
    statsTimeoutMs: number,
  ): Promise<boolean> {
    if (this.closed) return Promise.resolve(true);
    if (version === this.publishedServerStatsVersion) {
      return Promise.resolve(true);
    }
    const transition = this.pendingPlanTransition;
    if (!transition) {
      const buildState: UtoopackDevBuildState = {
        generation: this.options.generation,
        plan: this.options.plan,
      };
      return this.enqueueDevWork(async () => {
        const disposition = await this.processServerStatsForState(
          buildState,
          statsTimeoutMs,
        );
        if (disposition === "published") {
          this.publishedServerStatsVersion = version;
          return true;
        }
        return false;
      });
    }
    // The observed stats may come from any intermediate `.ev` snapshot. Drop
    // and acknowledge it only after Core selects and opens the final state.
    return transition.defer();
  }

  private async processServerStatsForState(
    buildState: UtoopackDevBuildState,
    statsTimeoutMs: number,
  ): Promise<BundlerBuildFactsDisposition> {
    if (this.closed) return "discarded";
    const { generation, plan } = buildState;
    const facts = await this.waitForReadableStats(plan, statsTimeoutMs);
    const disposition = await generateDevArtifacts(
      this.options.cwd,
      plan,
      generation,
      this.options.onBuildFacts,
      { isRebuild: true },
      facts,
    );
    if (
      disposition === "published" &&
      hasRuntimeServerEntry(plan) &&
      !this.closed
    ) {
      await this.options.onServerBundleReady(generation);
    }
    return disposition;
  }

  private async applyPlanUpdate(
    update: BuildPlanUpdate,
    options: BundlerDevUpdateOptions<ConfigComplete>,
    transition: UtoopackDevPlanTransition,
  ): Promise<void> {
    const previousPlan = this.options.plan;
    const previousGeneration = this.options.generation;
    let activated = false;
    try {
      this.throwIfUnavailable();
      if (this.pendingPlanTransition !== transition) {
        throw new Error(
          "[evjs] Utoopack development update boundary settled before updatePlan() applied it.",
        );
      }
      options.activate();
      activated = true;
      this.options.plan = update.next;
      this.options.generation = options.generation;
      transition.stage({
        publish: async () => {
          const publish = await this.prepareBuildPublication(
            update.next,
            options.generation,
          );
          await publish();
        },
        rollback: async () => {
          this.options.plan = previousPlan;
          this.options.generation = previousGeneration;
          if (this.closed) return async () => {};
          return async () => {
            const publish = await this.prepareBuildPublication(
              previousPlan,
              previousGeneration,
            );
            await publish();
          };
        },
      });
    } catch (error) {
      if (activated) {
        this.options.plan = previousPlan;
        this.options.generation = previousGeneration;
      }
      throw error;
    }
  }

  private async collectFinalBuildFacts(plan: BuildPlan): Promise<{
    facts: BundlerBuildFacts;
    serverStatsVersion: string | undefined;
  }> {
    await this.waitForFinalCompilerState(plan);
    // A later stats version must never be acknowledged for an earlier facts
    // snapshot. Reading the version first is deliberately conservative: a
    // concurrent rebuild may cause one duplicate cycle, but cannot be lost.
    const serverStatsVersion = hasServerEntries(plan)
      ? await readServerStatsVersion(
          path.join(
            resolveBuildOutputPaths(this.options.cwd, plan).serverDir,
            "stats.json",
          ),
        )
      : undefined;
    const facts = await this.waitForReadableStats(
      plan,
      INITIAL_DEV_STATS_TIMEOUT_MS,
    );
    return { facts, serverStatsVersion };
  }

  waitForReadableStats(
    plan: BuildPlan,
    timeoutMs: number,
  ): Promise<BundlerBuildFacts> {
    return Promise.race([
      waitForReadableDevStats(
        this.options.cwd,
        plan,
        timeoutMs,
        this.closingController.signal,
      ),
      this.options.worker.failure,
    ]);
  }

  private async prepareBuildPublication(
    plan: BuildPlan,
    generation: BundlerDevGeneration,
  ): Promise<() => Promise<void>> {
    const { facts, serverStatsVersion } =
      await this.collectFinalBuildFacts(plan);
    return async () => {
      if (this.closed) return;
      const disposition = await generateDevArtifacts(
        this.options.cwd,
        plan,
        generation,
        this.options.onBuildFacts,
        { isRebuild: true },
        facts,
      );
      if (disposition !== "published") {
        throw new Error(
          "[evjs] Core discarded the selected Utoopack facts snapshot before publication completed.",
        );
      }
      if (hasRuntimeServerEntry(plan) && !this.closed) {
        await this.options.onServerBundleReady(generation);
      }
      if (hasServerEntries(plan) && !this.closed) {
        this.publishedServerStatsVersion = serverStatsVersion;
        this.serverStatsMonitor?.advance(serverStatsVersion);
      }
    };
  }

  private async waitForFinalCompilerState(plan: BuildPlan): Promise<void> {
    const invalidation = collectGeneratedEntryInvalidation(
      this.options.cwd,
      plan,
    );
    if (invalidation.files.length === 0) return;
    for (let pass = 0; pass < 2; pass += 1) {
      this.options.worker.throwIfFailed();
      const versions = await readStatsVersions(invalidation.statsPaths);
      await this.options.worker.invalidate(invalidation.files);
      await Promise.race([
        waitForStatsVersionsToAdvance(
          invalidation.statsPaths,
          versions,
          INITIAL_DEV_STATS_TIMEOUT_MS,
          this.closingController.signal,
        ),
        this.options.worker.failure,
      ]);
    }
    this.options.worker.throwIfFailed();
  }

  private enqueueDevWork<T>(work: () => Promise<T>): Promise<T> {
    const result = this.devWorkQueue.then(work);
    this.devWorkQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private throwIfUnavailable(): void {
    this.options.worker.throwIfFailed();
    if (this.closing || this.closed) {
      throw new Error(
        "[evjs] Utoopack dev cannot update its framework plan during or after close().",
      );
    }
  }
}

function createUtoopackDevPlanTransition(options: {
  onOpenAccept():
    | (() => void | Promise<void>)
    | Promise<() => void | Promise<void>>;
  onOpenRollback():
    | (() => void | Promise<void>)
    | Promise<() => void | Promise<void>>;
  onSettled(): void;
}): UtoopackDevPlanTransition {
  let state:
    | "open"
    | "staged"
    | "selected"
    | "resuming"
    | "resume-failed"
    | "resumed"
    | "finalization-prepared"
    | "settled" = "open";
  let outcome: "accept" | "rollback" | undefined;
  let staged:
    | {
        publish(): void | Promise<void>;
        rollback():
          | (() => void | Promise<void>)
          | Promise<() => void | Promise<void>>;
      }
    | undefined;
  let selectedPublish: (() => void | Promise<void>) | undefined;
  let aborted = false;
  const deferred: Array<(consumed: boolean) => void> = [];
  const releaseDeferred = () => {
    for (const resolve of deferred.splice(0)) resolve(true);
  };
  const assertSelectable = (operation: string) => {
    if (
      state === "selected" ||
      state === "resuming" ||
      state === "finalization-prepared" ||
      state === "settled"
    ) {
      throw new Error(
        `[evjs] Utoopack development update transition cannot ${operation} after selecting an outcome.`,
      );
    }
  };
  const select = async (nextOutcome: "accept" | "rollback") => {
    assertSelectable(nextOutcome);
    if (nextOutcome === "accept") {
      if (state !== "open" && state !== "staged") {
        throw new Error(
          "[evjs] Utoopack development update transition cannot accept after a failed or completed resume.",
        );
      }
      if (aborted) {
        selectedPublish = async () => {};
      } else if (state === "open") {
        selectedPublish = await options.onOpenAccept();
      } else {
        selectedPublish = staged?.publish;
      }
    } else {
      if (outcome === "rollback") {
        throw new Error(
          "[evjs] Utoopack development update transition selected rollback more than once.",
        );
      }
      if (staged) {
        selectedPublish = await staged.rollback();
      } else {
        selectedPublish = aborted
          ? async () => {}
          : await options.onOpenRollback();
      }
    }
    outcome = nextOutcome;
    state = "selected";
  };
  return {
    abort() {
      if (aborted || state === "settled") return;
      aborted = true;
      options.onSettled();
      releaseDeferred();
    },
    stage(next) {
      assertSelectable("stage a candidate");
      if (state !== "open") {
        throw new Error(
          "[evjs] Utoopack development update transition staged more than one candidate.",
        );
      }
      staged = next;
      state = "staged";
    },
    defer() {
      if (aborted || state === "settled") return Promise.resolve(true);
      return new Promise<boolean>((resolve) => deferred.push(resolve));
    },
    accept() {
      return select("accept");
    },
    rollback() {
      return select("rollback");
    },
    async resume() {
      if (state !== "selected") {
        throw new Error(
          "[evjs] Utoopack development update transition resumed before selecting an outcome.",
        );
      }
      state = "resuming";
      try {
        if (!aborted) await selectedPublish?.();
        state = "resumed";
      } catch (error) {
        state = "resume-failed";
        throw error;
      }
    },
    prepareFinalize() {
      if (state !== "resumed") {
        throw new Error(
          "[evjs] Utoopack development update transition prepared finalization before resume succeeded.",
        );
      }
      state = "finalization-prepared";
    },
    finalize() {
      if (state !== "finalization-prepared") {
        throw new Error(
          "[evjs] Utoopack development update transition finalized before preparation succeeded.",
        );
      }
      state = "settled";
      if (!aborted) options.onSettled();
      releaseDeferred();
    },
  };
}

function formatUnsupportedPlanUpdate(update: BuildPlanUpdate): string {
  const changes = [
    formatPlanItems("entry additions", update.entries.added, formatBuildEntry),
    formatPlanItems("entry removals", update.entries.removed, formatBuildEntry),
    formatPlanItems("entry changes", update.entries.changed, formatBuildEntry),
    formatPlanItems("HTML additions", update.html.added, formatHtmlPlan),
    formatPlanItems("HTML removals", update.html.removed, formatHtmlPlan),
    formatPlanItems("HTML changes", update.html.changed, formatHtmlPlan),
    update.generatedChanged ? "generated framework IR changed" : undefined,
    update.resolveChanged ? "module resolution changed" : undefined,
    update.runtimeChanged ? "framework runtime changed" : undefined,
    update.deliveryChanged ? "framework artifact delivery changed" : undefined,
    update.previous.distDir !== update.next.distDir
      ? "framework output root changed"
      : undefined,
    update.previous.output.clientDir !== update.next.output.clientDir
      ? "client output changed"
      : undefined,
    update.serverCompilationChanged
      ? "server compilation topology changed"
      : undefined,
    update.serverDocumentsChanged ? "server documents changed" : undefined,
    update.devRoutingChanged ? "development routing changed" : undefined,
  ].filter((change): change is string => Boolean(change));

  return changes.length > 0 ? changes.join("; ") : "unknown plan change";
}

function formatPlanItems<T>(
  label: string,
  items: T[],
  formatItem: (item: T) => string,
): string | undefined {
  if (items.length === 0) return undefined;
  return `${label}: ${items.map(formatItem).join(", ")}`;
}

function formatBuildEntry(entry: BuildPlan["entries"][number]): string {
  return `${entry.name} (${entry.kind})`;
}

function formatHtmlPlan(html: BuildPlan["html"][number]): string {
  return `${html.id} -> ${html.fileName}`;
}

export const __testing = {
  startUtoopackDev,
  waitForReadableDevStats,
};
