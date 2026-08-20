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
  ClientDevMiddlewareServerHandle,
  ClientDevMiddlewareTlsCredentials,
  ResolvedBuildOutputPaths,
} from "@evjs/ev/_internal/build";
import {
  assertSafeBuildOutputPaths,
  reserveClientDevMiddlewareUpstreamPort,
  resolveBuildOutputPaths,
  resolveClientDevMiddlewareTlsCredentials,
  startClientDevMiddlewareServer,
} from "@evjs/ev/_internal/build";
import type { ResolvedConfig } from "@evjs/ev/config";
import type { BuildPlan } from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import type { ConfigComplete } from "@utoo/pack";
import {
  startUtoopackDevWorker,
  type UtoopackDevWorkerHandle,
} from "./development/dev-worker-client.js";
import {
  ensureUtoopackProcessWorkerScheduler,
  markUtoopackProcessForBuild,
  type UtoopackProcessWorkerScheduler,
} from "./development/dev-worker-scheduler.js";
import {
  readServerStatsVersion,
  startUtoopackServerStatsMonitor,
  type UtoopackServerStatsMonitor,
} from "./development/server-stats-monitor.js";
import { runUtoopackBuild } from "./execution/utoopack.js";
import { UtoopackManifestGenerator } from "./output/manifest-generator.js";
import { assertSafeUtoopackCleanOutput } from "./output/output-paths.js";

const logger = getLogger(["evjs", "bundler-utoopack"]);
const require = createRequire(import.meta.url);
const { version: utoopackVersion } = require("@utoo/pack/package.json") as {
  version: string;
};
type UtoopackRuntime = Pick<typeof import("@utoo/pack"), "build">;
const DEV_STATS_POLL_INTERVAL_MS = 25;

async function createUtoopackSelfSignedCertificate(): Promise<
  ClientDevMiddlewareTlsCredentials | undefined
> {
  const { createSelfSignedCertificate } =
    require("@utoo/pack/cjs/utils/mkcert.js") as {
      createSelfSignedCertificate(
        host?: string,
      ): Promise<{ key: string; cert: string } | undefined>;
    };
  const certificate = await createSelfSignedCertificate("localhost");
  if (!certificate) return undefined;
  return {
    key: await fs.promises.readFile(certificate.key),
    cert: await fs.promises.readFile(certificate.cert),
  };
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

  while (true) {
    throwIfPollingAborted(
      signal,
      "[evjs] Utoopack development session closed while waiting for build stats.",
    );
    try {
      return await new UtoopackManifestGenerator(cwd, plan).collectBuildFacts();
    } catch {}
    await waitForPollingDelay(
      signal,
      "[evjs] Utoopack development session closed while waiting for build stats.",
    );
  }
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
    dev: {
      clientMiddleware: true,
    },
  },
  async build(
    ctx: BundlerBuildContext<ConfigComplete>,
  ): Promise<BundlerBuildFacts> {
    markUtoopackProcessForBuild();
    const { addWatchFile, config, cwd, hooks, plan } = ctx;
    const { createUtoopackConfig } = await import("./config/create-config.js");
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
    "./config/create-config.js"
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
  const clientMiddlewares = ctx.clientMiddlewares ?? [];
  const middlewareEnabled = clientMiddlewares.length > 0;
  const internalPort = middlewareEnabled
    ? await reserveClientDevMiddlewareUpstreamPort()
    : config.dev.port;

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
      port: internalPort,
      https: middlewareEnabled ? false : config.dev.https !== false,
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
    if (middlewareEnabled) {
      const tls = await resolveClientDevMiddlewareTlsCredentials(
        cwd,
        config.dev.https,
        createUtoopackSelfSignedCertificate,
      );
      const middlewareServer = await startClientDevMiddlewareServer({
        tls,
        port: config.dev.port,
        signal,
        middlewares: clientMiddlewares,
        upstream: {
          hostname: ready.hostname === "0.0.0.0" ? "127.0.0.1" : ready.hostname,
          port: ready.port,
        },
      });
      await controller.attachClientMiddlewareServer(middlewareServer);
      controller.setOrigin(middlewareServer.origin);
    } else {
      controller.setOrigin(
        formatDevServerOrigin(config, ready.port, ready.hostname),
      );
    }
    const fallbackUpdated = ready.spaHistoryFallbackUpdated;
    if (ready.port !== internalPort) {
      const fallbackStatus = fallbackUpdated
        ? " The SPA fallback now targets the actual dev server."
        : "";
      logger.warn`Reserved client port ${internalPort} became unavailable during startup; Utoopack is listening on ${ready.port}.${fallbackStatus}`;
    }

    const serverStatsPath = path.join(outputPaths.serverDir, "stats.json");
    // Establish the monitor baseline before reading facts. If stats changes
    // while facts are being collected, the monitor may conservatively emit a
    // duplicate cycle, but it cannot mistake an unseen newer version for the
    // version represented by the initial callback.
    const initialServerStatsVersion = hasServerEntries(plan)
      ? await readServerStatsVersion(serverStatsPath)
      : undefined;
    if (hasServerEntries(plan)) {
      const monitor = startUtoopackServerStatsMonitor({
        statsPath: serverStatsPath,
        initialVersion: initialServerStatsVersion,
        async onChange(version) {
          return controller.processServerStatsChange(version);
        },
        onError(error) {
          logger.error`Failed to process Utoopack server rebuild: ${error}`;
        },
      });
      controller.attachServerStatsMonitor(monitor);
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
  private serverStatsMonitor: UtoopackServerStatsMonitor | undefined;
  private clientMiddlewareServer: ClientDevMiddlewareServerHandle | undefined;
  private devWorkQueue: Promise<void> = Promise.resolve();
  private hasEmittedDevArtifacts = false;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private readonly closingController = new AbortController();
  private rejectClientMiddlewareFailure!: (error: unknown) => void;

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
    const clientMiddlewareFailure = new Promise<never>((_resolve, reject) => {
      this.rejectClientMiddlewareFailure = reject;
    });
    void clientMiddlewareFailure.catch(() => {});
    this.done = Promise.race([
      options.worker.done,
      options.workerScheduler.failure,
      clientMiddlewareFailure,
    ]);
    void this.done.catch(() => {});
  }

  setOrigin(origin: string): void {
    this.origin = origin;
  }

  async attachClientMiddlewareServer(
    server: ClientDevMiddlewareServerHandle,
  ): Promise<void> {
    if (this.clientMiddlewareServer) {
      await server.close();
      throw new Error(
        "[evjs] Utoopack client middleware server was attached more than once.",
      );
    }
    if (this.closePromise || this.closed) {
      await server.close();
      throw new Error(
        "[evjs] Utoopack client middleware server started after the development session began closing.",
      );
    }
    this.clientMiddlewareServer = server;
    void server.failure.catch(this.rejectClientMiddlewareFailure);
  }

  attachServerStatsMonitor(monitor: UtoopackServerStatsMonitor): void {
    if (this.serverStatsMonitor) {
      throw new Error(
        "[evjs] Utoopack server stats monitor was attached more than once.",
      );
    }
    this.serverStatsMonitor = monitor;
  }

  startInitialFacts(): void {
    void this.enqueueDevWork(async () => {
      const disposition = await this.processBuildFacts(false);
      if (disposition === "published") {
        this.hasEmittedDevArtifacts = true;
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
        await this.clientMiddlewareServer?.close();
      } catch (error) {
        errors.push(error);
      }
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

  processServerStatsChange(_version: string): Promise<boolean> {
    if (this.closed) return Promise.resolve(true);
    return this.enqueueDevWork(async () => {
      const disposition = await this.processBuildFacts(true);
      return disposition !== "discarded";
    });
  }

  waitForReadableStats(plan: BuildPlan): Promise<BundlerBuildFacts> {
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

  private async processBuildFacts(
    isRebuild: boolean,
  ): Promise<BundlerBuildFactsDisposition> {
    if (this.closed) return "discarded";
    const facts = await this.waitForReadableStats(this.options.plan);
    if (this.closed) return "discarded";
    const disposition = await generateDevArtifacts(
      this.options.cwd,
      this.options.plan,
      this.options.onBuildFacts,
      { isRebuild: isRebuild || this.hasEmittedDevArtifacts },
      facts,
    );
    if (disposition === "published") {
      this.hasEmittedDevArtifacts = true;
      if (hasRuntimeServerEntry(this.options.plan) && !this.closed) {
        await this.options.onServerBundleReady();
      }
    }
    return disposition;
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
