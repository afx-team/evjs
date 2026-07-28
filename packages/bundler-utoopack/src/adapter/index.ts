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
  BundlerDevContext,
  BundlerDevController,
  BundlerDevUpdateOptions,
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
  onBuildFacts: (
    facts: BundlerBuildFacts,
    options?: { isRebuild?: boolean },
  ) => void | Promise<void>,
  options: { isRebuild?: boolean } = {},
  facts?: BundlerBuildFacts,
): Promise<void> {
  logger.info`Generating development manifest and HTML...`;
  const buildFacts =
    facts ??
    (await new UtoopackManifestGenerator(cwd, plan).collectBuildFacts());
  await onBuildFacts(buildFacts, options);
}

async function waitForReadableDevStats(
  cwd: string,
  plan: BuildPlan,
  timeoutMs = INITIAL_DEV_STATS_TIMEOUT_MS,
): Promise<BundlerBuildFacts> {
  const outputPaths = resolveBuildOutputPaths(cwd, plan);
  const requiredStats = [
    ...(plan.entries.some((entry) => entry.environment === "client")
      ? [path.join(outputPaths.clientDir, "stats.json")]
      : []),
    ...(hasRuntimeServerEntry(plan)
      ? [path.join(outputPaths.serverDir, "stats.json")]
      : []),
  ];
  if (requiredStats.length === 0) {
    return new UtoopackManifestGenerator(cwd, plan).collectBuildFacts();
  }

  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (true) {
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
    await new Promise<void>((resolve) =>
      setTimeout(resolve, DEV_STATS_POLL_INTERVAL_MS),
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
  const { addWatchFile, config, cwd, callbacks, hooks, plan } = ctx;
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

    const initialFacts = await Promise.race([
      waitForReadableDevStats(cwd, plan, statsTimeoutMs),
      worker.failure,
    ]);
    const serverStatsPath = path.join(outputPaths.serverDir, "stats.json");
    const initialServerStatsVersion = hasRuntimeServerEntry(plan)
      ? await readServerStatsVersion(serverStatsPath)
      : undefined;
    await generateDevArtifacts(
      cwd,
      plan,
      callbacks.onBuildFacts,
      { isRebuild: false },
      initialFacts,
    );
    worker.throwIfFailed();

    if (hasRuntimeServerEntry(plan)) {
      await callbacks.onServerBundleReady();
      worker.throwIfFailed();
      const monitor = startUtoopackServerStatsMonitor({
        statsPath: serverStatsPath,
        initialVersion: initialServerStatsVersion,
        async onChange() {
          const activePlan = controller.getPlan();
          const facts = await waitForReadableDevStats(
            cwd,
            activePlan,
            statsTimeoutMs,
          );
          await generateDevArtifacts(
            cwd,
            activePlan,
            callbacks.onBuildFacts,
            { isRebuild: true },
            facts,
          );
          await callbacks.onServerBundleReady();
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

function formatDevServerOrigin(
  config: ResolvedConfig<ConfigComplete>,
  port: number,
  hostname = "localhost",
): string {
  const protocol = config.dev.https ? "https" : "http";
  const host = hostname === "0.0.0.0" ? "localhost" : hostname;
  return `${protocol}://${host}:${port}`;
}

class UtoopackDevController implements BundlerDevController<ConfigComplete> {
  private serverStatsMonitor: UtoopackServerStatsMonitor | undefined;
  private closed = false;
  readonly done: Promise<void>;

  constructor(
    private options: {
      cwd: string;
      plan: BuildPlan;
      worker: UtoopackDevWorkerHandle;
      onBuildFacts: BundlerDevContext<ConfigComplete>["callbacks"]["onBuildFacts"];
      onServerBundleReady: BundlerDevContext<ConfigComplete>["callbacks"]["onServerBundleReady"];
    },
  ) {
    this.done = options.worker.done;
  }

  getPlan(): BuildPlan {
    return this.options.plan;
  }

  attachServerStatsMonitor(monitor: UtoopackServerStatsMonitor): void {
    if (this.serverStatsMonitor) {
      throw new Error(
        "[evjs] Utoopack server stats monitor was attached more than once.",
      );
    }
    this.serverStatsMonitor = monitor;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
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
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "[evjs] Failed to stop Utoopack dev.");
    }
  }

  async updatePlan(
    update: BuildPlanUpdate,
    options?: BundlerDevUpdateOptions<ConfigComplete>,
  ): Promise<void> {
    if (options?.configChanged) {
      throw new Error(
        "[evjs] Utoopack dev cannot safely replace framework, proxy, or plugin bundler configuration in place. Restart ev dev to apply the updated config.",
      );
    }
    await assertSafeBuildOutputPaths(
      this.options.cwd,
      resolveBuildOutputPaths(this.options.cwd, update.next),
    );
    if (isEmptyBuildPlanUpdate(update)) return;

    if (!isArtifactOnlyBuildPlanUpdate(update)) {
      throw new Error(
        `[evjs] Utoopack dev cannot apply framework plan changes without restarting ev dev (${formatUnsupportedPlanUpdate(update)}). HTML/generated-only framework plan updates are supported; entry additions, removals, resolution changes, server changes, and route metadata changes still require a lower-layer Utoopack update API.`,
      );
    }

    const previousPlan = this.options.plan;
    this.options.plan = update.next;
    try {
      await generateDevArtifacts(
        this.options.cwd,
        update.next,
        this.options.onBuildFacts,
        { isRebuild: true },
      );
      if (hasRuntimeServerEntry(update.next)) {
        await this.options.onServerBundleReady();
      }
    } catch (error) {
      this.options.plan = previousPlan;
      throw error;
    }
  }
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
