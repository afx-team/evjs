import fs from "node:fs";
import type { ClientRequest } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
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
} from "@evjs/ev/_internal/build";
import {
  assertPortableRelativeArtifactPath,
  assertSafeBuildOutputPaths,
  isArtifactOnlyBuildPlanUpdate,
  isEmptyBuildPlanUpdate,
  portableArtifactPathsConflict,
  resolveBuildOutputPaths,
  writeOwnedOutputFile,
} from "@evjs/ev/_internal/build";
import type { DevProxyRule, ResolvedConfig } from "@evjs/ev/config";
import { pageRoutePathToRegExp } from "@evjs/shared";
import type { BuildPlan, BuildPlanUpdate } from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import { createFsFromVolume, Volume } from "memfs";
import type {
  Compiler,
  Configuration,
  MultiCompiler,
  MultiStats,
  Stats,
} from "webpack";
import webpack from "webpack";
import WebpackDevServer from "webpack-dev-server";
import {
  assertWebpackAdapterStatsPathAvailable,
  readWebpackEmittedFiles,
  WebpackManifestGenerator,
  type WebpackStatsLike,
} from "../manifest-generator.js";
import { createWebpackConfigs, type WebpackConfig } from "./create-config.js";
import { copyServerPublicAssetsToClient } from "./server-public-assets.js";

const logger = getLogger(["evjs", "bundler-webpack"]);
const DEV_PAGE_RENDER_PROXY_HEADER = "x-evjs-dev-page-render";
const BUILD_ONLY_SERVER_CONFIG_NAME = "server-build";

interface WebpackDevServerInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
  invalidate(): void;
}

interface WebpackWatching {
  close(callback: (error: Error | null) => void): void;
  invalidate(): void;
}

interface WebpackDevStatsSnapshot {
  clientStats?: WebpackStatsLike;
  serverStats?: WebpackStatsLike;
  memoryFiles?: Map<string, Buffer>;
  error?: string;
}

interface WebpackDevStatsReservation {
  /** Undefined when the compile started while generated input was staging. */
  readonly buildState: WebpackDevBuildState | undefined;
  readonly recoverable: boolean;
  readonly sessionGeneration: number;
  /** Child compilers that have started in this terminal-stats cycle. */
  readonly startedCompilers: WeakSet<Compiler>;
  snapshot?: WebpackDevStatsSnapshot;
  complete(snapshot: WebpackDevStatsSnapshot | undefined): void;
}

interface WebpackDevBuildState {
  readonly generation: BundlerDevGeneration;
  readonly plan: BuildPlan;
  latestClientStats: WebpackStatsLike | undefined;
  latestServerStats: WebpackStatsLike | undefined;
  latestServerMemoryFiles: Map<string, Buffer>;
  latestServerPublicFiles: string[];
  serverPublicAssetOwnership: Map<string, Buffer>;
  serverReadyPending: boolean;
}

type WebpackDevArtifactResult =
  | BundlerBuildFactsDisposition
  | "waiting-for-facts";

interface WebpackDevPlanTransition extends BundlerDevUpdateTransition {
  stage(rollback: () => void): void;
  abort(): void;
}

interface WebpackDevPublication {
  readonly buildState: WebpackDevBuildState;
  readonly primaryKinds: Set<"client" | "server">;
  readonly promise: Promise<void>;
  reject(error: unknown): void;
  resolve(): void;
}

interface WebpackDevSessionDone {
  readonly promise: Promise<void>;
  reject(error: unknown): void;
  resolve(): void;
}

type WebpackDevProxyRule = DevProxyRule & {
  pathRewrite?: Record<string, string> | ((path: string) => string);
  contextFilter?: (pathname: string) => boolean;
  frameworkPageRender?: boolean;
};

interface DevFallbackRequest {
  url?: string;
}

interface DevFallbackResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

type FrameworkRequestKind =
  | "server-request-route"
  | "server-rendered-page"
  | "runtime";

export const webpackAdapter: BundlerAdapter<WebpackConfig> = {
  name: "webpack",
  capabilities: {
    build: {
      server: true,
      rsc: true,
      ppr: true,
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
    ctx: BundlerBuildContext<WebpackConfig>,
  ): Promise<BundlerBuildFacts> {
    const { addWatchFile, config, cwd, hooks, plan } = ctx;
    const outputPaths = resolveBuildOutputPaths(cwd, plan);

    logger.info`Building for production with webpack...`;

    await assertSafeBuildOutputPaths(cwd, outputPaths);
    await fs.promises.rm(outputPaths.rootDir, {
      recursive: true,
      force: true,
    });

    const configs = await createWebpackConfigs(config, plan, cwd, hooks, {
      addWatchFile,
    });
    const stats = await runWebpack(configs);
    const hasRuntimeServerEntries = plan.entries.some(
      (entry) => entry.environment === "server" && entry.phase !== "build",
    );

    await emitStats(cwd, outputPaths.clientDir, stats.clientStats);
    if (hasRuntimeServerEntries) {
      await emitStats(cwd, outputPaths.serverDir, stats.serverStats);
    }
    const serverPublicAssets = await copyServerPublicAssetsToClient(
      cwd,
      outputPaths.serverDir,
      outputPaths.clientDir,
      stats.serverStats,
      stats.memoryFiles,
      new Map(),
      new Set(readWebpackEmittedFiles(stats.clientStats) ?? []),
      plan.runtime.publicPath,
    );

    logger.info`Collecting webpack build facts...`;
    const generator = new WebpackManifestGenerator(
      cwd,
      plan,
      stats.clientStats,
      stats.serverStats,
      serverPublicAssets,
    );

    logger.info`Build complete!`;
    return {
      ...generator.collectBuildFacts(),
      ...(stats.memoryFiles.size > 0
        ? {
            loadServerModule: createMemoryServerModuleLoader(
              cwd,
              stats.memoryFiles,
            ),
          }
        : {}),
    };
  },

  async dev(
    ctx: BundlerDevContext<WebpackConfig>,
  ): Promise<BundlerDevController<WebpackConfig>> {
    const session = new WebpackDevSession(ctx);
    try {
      await session.start();
      return session;
    } catch (error) {
      try {
        await session.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "[evjs] Webpack development startup failed and cleanup also failed.",
          { cause: error },
        );
      }
      throw error;
    }
  },
};

class WebpackDevSession implements BundlerDevController<WebpackConfig> {
  readonly done: Promise<void>;
  private config: ResolvedConfig<WebpackConfig>;
  private plan: BuildPlan;
  private buildGeneration: BundlerDevGeneration;
  private buildState: WebpackDevBuildState;
  private pendingPlanTransition: WebpackDevPlanTransition | undefined;
  private devWorkQueue: Promise<void> = Promise.resolve();
  private clientServer: WebpackDevServerInstance | undefined;
  private serverWatching: WebpackWatching | undefined;
  private startGeneration = 0;
  private fatalError: Error | undefined;
  private closing = false;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private readonly sessionDone = createWebpackDevSessionDone();
  private statsReservations = new Map<
    "client" | "server",
    WebpackDevStatsReservation
  >();
  private taintedTerminalKinds = new Set<"client" | "server">();
  private transitionBuildState: WebpackDevBuildState | undefined;
  private transitionNeedsRefresh = false;
  private pendingPublication: WebpackDevPublication | undefined;
  private hasEmittedDevArtifacts = false;
  private initialDone:
    | {
        required: Set<"client" | "server">;
        resolve: () => void;
        reject: (error: unknown) => void;
        promise: Promise<void>;
      }
    | undefined;

  constructor(private ctx: BundlerDevContext<WebpackConfig>) {
    this.done = this.sessionDone.promise;
    void this.done.catch(() => {});
    this.config = ctx.config;
    this.plan = ctx.plan;
    this.buildGeneration = ctx.generation;
    this.buildState = createWebpackDevBuildState(ctx.plan, ctx.generation);
  }

  async start(): Promise<void> {
    const generation = ++this.startGeneration;
    const outputPaths = resolveBuildOutputPaths(this.ctx.cwd, this.plan);

    logger.info`Starting development server with webpack...`;

    await assertSafeBuildOutputPaths(this.ctx.cwd, outputPaths);
    await fs.promises.rm(outputPaths.rootDir, {
      recursive: true,
      force: true,
    });

    this.buildState = createWebpackDevBuildState(
      this.plan,
      this.buildGeneration,
    );

    const configs = await createWebpackConfigs(
      this.config,
      this.plan,
      this.ctx.cwd,
      this.ctx.hooks,
      { clean: false, addWatchFile: this.ctx.addWatchFile },
    );
    const clientConfigs = configs.filter((config) => config.name === "client");
    const serverConfigs = configs.filter(
      (config) =>
        config.name === "server" ||
        config.name === "server-rsc" ||
        config.name === BUILD_ONLY_SERVER_CONFIG_NAME,
    );
    const needsClient = clientConfigs.length > 0;
    const needsServer = serverConfigs.length > 0;
    this.initialDone = createInitialBuildBarrier({ needsClient, needsServer });

    if (needsClient) {
      const compiler = createWebpackCompiler(clientConfigs);
      this.trackCompileStart("client", generation, compiler);
      compiler.hooks.done.tap("EvjsWebpackDevClientSnapshot", (stats) => {
        this.captureStatsReservation("client", generation, stats);
      });
      this.trackCompileCompletion("client", generation, compiler);
      const clientServer = new WebpackDevServer(
        createDevServerOptions(this.config, this.plan, outputPaths.clientDir),
        compiler,
      );
      this.clientServer = clientServer;
      await clientServer.start();
    }

    if (needsServer) {
      const compiler = createWebpackCompiler(serverConfigs);
      const memoryOutput = configureBuildOnlyMemoryOutputs(compiler);
      this.trackCompileStart("server", generation, compiler);
      compiler.hooks.done.tap("EvjsWebpackDevServerSnapshot", (stats) => {
        this.captureStatsReservation(
          "server",
          generation,
          stats,
          collectMemoryFiles(memoryOutput.volume, memoryOutput.outputPaths),
        );
      });
      this.trackCompileCompletion("server", generation, compiler);
      this.serverWatching = compiler.watch({}, (error) => {
        if (error) {
          this.failStatsReservation("server", generation, error);
        }
      });
    }

    if (!needsClient) {
      const compiler = createStaticDevHostCompiler(
        this.ctx.cwd,
        outputPaths.clientDir,
      );
      const clientServer = new WebpackDevServer(
        createDevServerOptions(this.config, this.plan, outputPaths.clientDir),
        compiler,
      );
      this.clientServer = clientServer;
      await clientServer.start();
    }

    const initialDone = this.initialDone;
    if (!needsClient && !needsServer) {
      initialDone.resolve();
    }

    await initialDone.promise;
    if (this.clientServer) {
      const protocol = this.config.dev.https ? "https" : "http";
      await this.ctx.callbacks.onDevServerReady?.({
        origin: `${protocol}://localhost:${this.config.dev.port}`,
      });
    }
  }

  async close(): Promise<void> {
    this.closePromise ??= (async () => {
      this.closing = true;
      this.pendingPlanTransition?.abort();
      this.pendingPublication?.reject(
        new Error("[evjs] Webpack development session closed during update."),
      );
      try {
        await this.stop();
        this.closed = true;
        this.sessionDone.resolve();
      } catch (error) {
        this.closed = true;
        this.failDevSession(error);
        throw error;
      }
    })();
    return this.closePromise;
  }

  async beginUpdate(): Promise<BundlerDevUpdateTransition> {
    this.throwIfUnavailable();
    if (this.pendingPlanTransition) {
      throw new Error(
        "[evjs] Webpack dev received overlapping framework plan updates. Wait for the active update boundary to settle before starting another update.",
      );
    }
    this.transitionNeedsRefresh = false;
    const transition = createWebpackDevPlanTransition({
      onOpenSelect: () => {
        this.buildState = createWebpackDevBuildState(
          this.plan,
          this.buildGeneration,
        );
      },
      onResume: () => this.publishFreshBuildState(),
      onSettled: (completed) => {
        const refresh = completed && this.transitionNeedsRefresh;
        this.transitionNeedsRefresh = false;
        this.transitionBuildState = undefined;
        if (this.pendingPlanTransition === transition) {
          this.pendingPlanTransition = undefined;
        }
        // Stats that completed after the selected publication were consumed
        // only to close their compiler hooks. Rebuild once outside the
        // transaction so the latest source state is published normally.
        if (refresh && this.plan.entries.length > 0) {
          this.invalidateFinalBuildInputs();
        }
      },
    });
    // Mark the boundary before yielding. Compiles that start from this point
    // are tainted; work already reserved remains bound to the old generation.
    this.pendingPlanTransition = transition;
    const precedingWork = this.devWorkQueue;
    await precedingWork;
    this.throwIfUnavailable();
    if (this.pendingPlanTransition !== transition) {
      throw new Error(
        "[evjs] Webpack development update boundary settled before it became ready.",
      );
    }
    return transition;
  }

  updatePlan(
    update: BuildPlanUpdate,
    options: BundlerDevUpdateOptions<WebpackConfig>,
  ): Promise<void> {
    return this.preparePlanUpdate(update, options);
  }

  private async preparePlanUpdate(
    update: BuildPlanUpdate,
    options: BundlerDevUpdateOptions<WebpackConfig>,
  ): Promise<void> {
    this.throwIfUnavailable();
    const transition = this.pendingPlanTransition;
    if (!transition || options.transition !== transition) {
      throw new Error(
        "[evjs] Webpack dev updatePlan() must receive the active transition returned by beginUpdate().",
      );
    }
    if (options.configChanged) {
      throw new Error(
        "[evjs] Webpack dev cannot safely replace framework, proxy, or plugin bundler configuration in place. Restart ev dev to apply the updated config.",
      );
    }
    if (
      !isEmptyBuildPlanUpdate(update) &&
      !isArtifactOnlyBuildPlanUpdate(update)
    ) {
      throw new Error(
        "[evjs] Webpack dev cannot safely replace persistent compiler entries, routes, server topology, or module resolution in place. Restart ev dev to apply this framework plan change.",
      );
    }
    if (!isEmptyBuildPlanUpdate(update)) {
      await assertSafeBuildOutputPaths(
        this.ctx.cwd,
        resolveBuildOutputPaths(this.ctx.cwd, update.next),
      );
    }
    this.throwIfUnavailable();
    return this.enqueueDevWork(() =>
      this.applyPlanUpdate(update, options, transition),
    );
  }

  private async applyPlanUpdate(
    update: BuildPlanUpdate,
    options: BundlerDevUpdateOptions<WebpackConfig>,
    transition: WebpackDevPlanTransition,
  ): Promise<void> {
    const previousPlan = this.plan;
    const previousGeneration = this.buildGeneration;
    const previousBuildState = this.buildState;
    let activated = false;

    try {
      this.throwIfUnavailable();
      if (this.pendingPlanTransition !== transition) {
        throw new Error(
          "[evjs] Webpack development update boundary settled before updatePlan() applied it.",
        );
      }
      options.activate();
      activated = true;
      this.plan = update.next;
      this.buildGeneration = options.generation;
      // Cached stats and memory modules belong to the previous compiler
      // inputs. Candidate output remains blocked until accept() invalidates
      // both compilers and a complete fresh facts set is available.
      this.buildState = createWebpackDevBuildState(
        update.next,
        options.generation,
      );
      transition.stage(() => {
        this.plan = previousPlan;
        this.buildGeneration = previousGeneration;
        this.buildState = createWebpackDevBuildState(
          previousPlan,
          previousGeneration,
        );
      });
    } catch (error) {
      if (activated) {
        this.plan = previousPlan;
        this.buildGeneration = previousGeneration;
        this.buildState = previousBuildState;
      }
      throw error;
    }
  }

  private async stop(): Promise<void> {
    this.startGeneration++;
    this.cancelStatsReservations();
    const errors: unknown[] = [];

    if (this.serverWatching) {
      const watching = this.serverWatching;
      this.serverWatching = undefined;
      await new Promise<void>((resolve) => {
        watching.close((error) => {
          if (error) errors.push(error);
          resolve();
        });
      });
    }

    if (this.clientServer) {
      const server = this.clientServer;
      this.clientServer = undefined;
      try {
        await server.stop();
      } catch (error) {
        errors.push(error);
      }
    }

    await this.devWorkQueue;

    if (errors.length > 0) {
      throw errors[0];
    }
  }

  private trackCompileStart(
    kind: "client" | "server",
    sessionGeneration: number,
    compiler: Compiler | MultiCompiler,
  ): void {
    const reserve = (startedCompiler: Compiler) => {
      if (sessionGeneration !== this.startGeneration) return;
      const existing = this.statsReservations.get(kind);
      if (existing) {
        if (!existing.startedCompilers.has(startedCompiler)) {
          existing.startedCompilers.add(startedCompiler);
          return;
        }
        // Webpack skips done/afterDone when an in-flight watch compile is
        // invalidated, then starts the same child compiler again. Retire that
        // unterminated reservation so the replacement compile can carry the
        // selected generation instead of inheriting staging ownership. A
        // MultiCompiler aggregate waits for this replacement child result, so
        // the abandoned pass cannot later finalize the new reservation.
        this.supersedeStatsReservation(kind, existing);
      }
      let buildState = this.pendingPlanTransition
        ? this.transitionBuildState
        : this.buildState;
      const publication = this.pendingPublication;
      if (this.pendingPlanTransition && buildState) {
        if (
          !publication ||
          publication.buildState !== buildState ||
          publication.primaryKinds.has(kind)
        ) {
          // A selected generation publishes exactly one fresh compile per
          // environment inside the Core transaction. A later compile may
          // have observed newer source while API readiness was still pending;
          // consume its terminal hooks without publishing stale transaction
          // output, then rebuild after finalize().
          this.transitionNeedsRefresh = true;
          buildState = undefined;
        } else {
          publication.primaryKinds.add(kind);
        }
      }
      const reservation = this.reserveStatsWork(
        kind,
        sessionGeneration,
        buildState,
        Boolean(this.pendingPlanTransition && buildState),
      );
      reservation.startedCompilers.add(startedCompiler);
    };
    compiler.hooks.run.tap("EvjsWebpackDevGeneration", reserve);
    compiler.hooks.watchRun.tap("EvjsWebpackDevGeneration", reserve);
    const compilers = "compilers" in compiler ? compiler.compilers : [compiler];
    for (const childCompiler of compilers) {
      childCompiler.hooks.failed.tap("EvjsWebpackDevGeneration", (error) => {
        this.failStatsReservation(kind, sessionGeneration, error);
      });
    }
  }

  private trackCompileCompletion(
    kind: "client" | "server",
    sessionGeneration: number,
    compiler: Compiler | MultiCompiler,
  ): void {
    if (!("compilers" in compiler)) {
      compiler.hooks.afterDone.tap("EvjsWebpackDevGeneration", () => {
        this.finalizeStatsReservation(kind, sessionGeneration);
      });
      return;
    }

    const completedStats = new WeakSet<Stats>();
    let expectedStats: readonly Stats[] | undefined;
    const completeAggregate = () => {
      if (!expectedStats?.every((stats) => completedStats.has(stats))) return;
      expectedStats = undefined;
      this.finalizeStatsReservation(kind, sessionGeneration);
    };
    compiler.hooks.done.tap(
      {
        name: "EvjsWebpackDevGenerationComplete",
        stage: Number.POSITIVE_INFINITY,
      },
      (stats) => {
        expectedStats = stats.stats;
        completeAggregate();
      },
    );
    for (const childCompiler of compiler.compilers) {
      childCompiler.hooks.afterDone.tap(
        "EvjsWebpackDevGenerationComplete",
        (stats) => {
          completedStats.add(stats);
          completeAggregate();
        },
      );
    }
  }

  private reserveStatsWork(
    kind: "client" | "server",
    sessionGeneration: number,
    buildState: WebpackDevBuildState | undefined,
    recoverable: boolean,
  ): WebpackDevStatsReservation {
    const existing = this.statsReservations.get(kind);
    if (existing) return existing;
    this.taintedTerminalKinds.delete(kind);

    let complete!: (snapshot: WebpackDevStatsSnapshot | undefined) => void;
    const snapshot = new Promise<WebpackDevStatsSnapshot | undefined>(
      (resolve) => {
        complete = resolve;
      },
    );
    const reservation: WebpackDevStatsReservation = {
      buildState,
      recoverable,
      sessionGeneration,
      startedCompilers: new WeakSet(),
      complete,
    };
    this.statsReservations.set(kind, reservation);
    // A compile that started after beginUpdate() may have read intermediate
    // generated files. Pair its hooks, but never enqueue or reclassify facts.
    if (!buildState) return reservation;
    void this.enqueueDevWork(async () => {
      const ready = await snapshot;
      if (!ready) return;
      await this.handleStats(
        kind,
        reservation.sessionGeneration,
        buildState,
        ready,
      );
    }).catch((error) => {
      this.failInitialBuild(error);
      if (recoverable) this.rejectPendingPublication(buildState, error);
      logger.error`Failed to process webpack ${kind} dev build: ${error}`;
    });
    return reservation;
  }

  private supersedeStatsReservation(
    kind: "client" | "server",
    reservation: WebpackDevStatsReservation,
  ): void {
    if (this.statsReservations.get(kind) !== reservation) return;
    this.statsReservations.delete(kind);
    reservation.complete(undefined);
    const publication = this.pendingPublication;
    if (publication && publication.buildState === reservation.buildState) {
      publication.primaryKinds.delete(kind);
    }
  }

  private captureStatsReservation(
    kind: "client" | "server",
    sessionGeneration: number,
    stats: Stats | MultiStats,
    memoryFiles?: Map<string, Buffer>,
  ): void {
    if (sessionGeneration !== this.startGeneration) return;
    const reservation = this.statsReservations.get(kind);
    if (!reservation) {
      if (this.taintedTerminalKinds.has(kind)) return;
      const error = new Error(
        `[evjs] Webpack ${kind} compilation completed without a generation reservation.`,
      );
      this.failInitialBuild(error);
      this.failDevSession(error);
      logger.error`${error.message}`;
      return;
    }

    try {
      reservation.snapshot = createWebpackDevStatsSnapshot(stats, memoryFiles);
    } catch (error) {
      this.statsReservations.delete(kind);
      reservation.complete(undefined);
      if (!reservation.buildState) {
        this.taintedTerminalKinds.add(kind);
        return;
      }
      if (reservation.recoverable) {
        this.taintedTerminalKinds.add(kind);
        this.rejectPendingPublication(reservation.buildState, error);
        return;
      }
      this.failInitialBuild(error);
      this.failDevSession(error);
      logger.error`Failed to snapshot webpack ${kind} dev build: ${error}`;
      return;
    }
  }

  private finalizeStatsReservation(
    kind: "client" | "server",
    sessionGeneration: number,
  ): void {
    if (sessionGeneration !== this.startGeneration) return;
    const reservation = this.statsReservations.get(kind);
    if (!reservation) {
      if (this.taintedTerminalKinds.has(kind)) return;
      if (this.fatalError) return;
      const error = new Error(
        `[evjs] Webpack ${kind} compilation completed without a captured generation snapshot.`,
      );
      this.failInitialBuild(error);
      this.failDevSession(error);
      logger.error`${error.message}`;
      return;
    }
    this.statsReservations.delete(kind);
    if (!reservation.buildState) {
      this.taintedTerminalKinds.add(kind);
    }
    if (!reservation.snapshot) {
      if (!reservation.buildState) {
        reservation.complete(undefined);
        return;
      }
      const error = new Error(
        `[evjs] Webpack ${kind} compilation completed without readable stats.`,
      );
      reservation.complete(undefined);
      if (reservation.recoverable) {
        this.taintedTerminalKinds.add(kind);
        this.rejectPendingPublication(reservation.buildState, error);
        return;
      }
      this.failInitialBuild(error);
      this.failDevSession(error);
      logger.error`${error.message}`;
      return;
    }
    reservation.complete(reservation.snapshot);
  }

  private failStatsReservation(
    kind: "client" | "server",
    sessionGeneration: number,
    error: unknown,
  ): void {
    if (sessionGeneration !== this.startGeneration) return;
    const reservation = this.statsReservations.get(kind);
    if (reservation) {
      this.statsReservations.delete(kind);
      reservation.complete(undefined);
      if (!reservation.buildState) {
        this.taintedTerminalKinds.add(kind);
        return;
      }
      if (reservation.recoverable) {
        this.taintedTerminalKinds.add(kind);
        this.rejectPendingPublication(reservation.buildState, error);
        return;
      }
    } else if (this.taintedTerminalKinds.has(kind)) {
      return;
    }
    this.failInitialBuild(error);
    if (!this.fatalError) {
      logger.error`Webpack ${kind} compilation failed: ${error}`;
    }
    this.failDevSession(error);
  }

  private cancelStatsReservations(): void {
    for (const reservation of this.statsReservations.values()) {
      reservation.complete(undefined);
    }
    this.statsReservations.clear();
    this.taintedTerminalKinds.clear();
  }

  private enqueueDevWork<T>(work: () => Promise<T>): Promise<T> {
    const result = this.devWorkQueue.then(work);
    this.devWorkQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async handleStats(
    kind: "client" | "server",
    sessionGeneration: number,
    buildState: WebpackDevBuildState,
    snapshot: WebpackDevStatsSnapshot,
  ): Promise<void> {
    if (sessionGeneration !== this.startGeneration) return;
    if (buildState !== this.buildState) return;
    if (
      this.pendingPlanTransition &&
      buildState !== this.transitionBuildState
    ) {
      return;
    }

    if (snapshot.error) {
      const error = new Error(snapshot.error);
      this.failInitialBuild(error);
      this.rejectPendingPublication(buildState, error);
      logger.error`${error.message}`;
      return;
    }

    const { plan } = buildState;
    const outputPaths = resolveBuildOutputPaths(this.ctx.cwd, plan);

    if (kind === "client") {
      buildState.latestClientStats = snapshot.clientStats;
      await emitStats(
        this.ctx.cwd,
        outputPaths.clientDir,
        buildState.latestClientStats,
      );
    } else {
      buildState.latestServerStats = snapshot.serverStats;
      buildState.latestServerMemoryFiles = snapshot.memoryFiles ?? new Map();
      await emitStats(
        this.ctx.cwd,
        outputPaths.serverDir,
        buildState.latestServerStats,
      );
      buildState.latestServerPublicFiles = await copyServerPublicAssetsToClient(
        this.ctx.cwd,
        outputPaths.serverDir,
        outputPaths.clientDir,
        buildState.latestServerStats,
        buildState.latestServerMemoryFiles,
        buildState.serverPublicAssetOwnership,
        this.readClientOwnedFiles(buildState),
        plan.runtime.publicPath,
      );
      buildState.serverReadyPending = true;
    }

    const result = await this.generateDevArtifacts(buildState);
    if (result === "discarded") {
      if (this.pendingPlanTransition) this.transitionNeedsRefresh = true;
      this.rejectPendingPublication(
        buildState,
        new Error(
          "[evjs] Core discarded the selected Webpack facts snapshot before publication completed.",
        ),
      );
      return;
    }
    const published = result === "published";
    if (published) {
      this.completeInitialBuild();
    }
    if (published && buildState.serverReadyPending) {
      buildState.serverReadyPending = false;
      await this.ctx.callbacks.onServerBundleReady(buildState.generation);
    }
    if (published) this.resolvePendingPublication(buildState);
  }

  private async generateDevArtifacts(
    buildState: WebpackDevBuildState,
  ): Promise<WebpackDevArtifactResult> {
    const { plan } = buildState;
    const hasClientEntries = plan.entries.some(
      (entry) => entry.environment === "client",
    );
    const hasServerEntries = plan.entries.some(
      (entry) => entry.environment === "server",
    );

    if (hasClientEntries && !buildState.latestClientStats) {
      return "waiting-for-facts";
    }
    if (hasServerEntries && !buildState.latestServerStats) {
      return "waiting-for-facts";
    }

    if (buildState.latestServerStats) {
      const outputPaths = resolveBuildOutputPaths(this.ctx.cwd, plan);
      buildState.latestServerPublicFiles = await copyServerPublicAssetsToClient(
        this.ctx.cwd,
        outputPaths.serverDir,
        outputPaths.clientDir,
        buildState.latestServerStats,
        buildState.latestServerMemoryFiles,
        buildState.serverPublicAssetOwnership,
        this.readClientOwnedFiles(buildState),
        plan.runtime.publicPath,
      );
    }

    logger.info`Generating development manifest and HTML...`;
    const generator = new WebpackManifestGenerator(
      this.ctx.cwd,
      plan,
      buildState.latestClientStats,
      buildState.latestServerStats,
      buildState.latestServerPublicFiles,
    );
    const isRebuild = this.hasEmittedDevArtifacts;
    const facts = generator.collectBuildFacts();
    if (buildState.latestServerMemoryFiles.size > 0) {
      facts.loadServerModule = createMemoryServerModuleLoader(
        this.ctx.cwd,
        buildState.latestServerMemoryFiles,
      );
    }
    const disposition = await this.ctx.callbacks.onBuildFacts(
      buildState.generation,
      facts,
      { isRebuild },
    );
    if (disposition === "discarded") return disposition;
    this.hasEmittedDevArtifacts = true;
    return disposition;
  }

  private readClientOwnedFiles(
    buildState: WebpackDevBuildState,
  ): ReadonlySet<string> {
    return new Set(readWebpackEmittedFiles(buildState.latestClientStats) ?? []);
  }

  private completeInitialBuild(): void {
    if (!this.initialDone) return;
    this.initialDone.required.clear();
    this.initialDone.resolve();
  }

  private failInitialBuild(error: unknown): void {
    this.initialDone?.reject(error);
  }

  private failDevSession(error: unknown): void {
    if (this.fatalError) return;
    this.fatalError = error instanceof Error ? error : new Error(String(error));
    this.sessionDone.reject(this.fatalError);
  }

  private async publishFreshBuildState(): Promise<void> {
    this.throwIfUnavailable();
    const buildState = this.buildState;
    this.transitionBuildState = buildState;
    const publication = createWebpackDevPublication(buildState);
    this.pendingPublication = publication;
    let published = false;

    try {
      if (buildState.plan.entries.length === 0) {
        const result = await this.generateDevArtifacts(buildState);
        if (result === "published") {
          this.resolvePendingPublication(buildState);
        } else if (result === "discarded") {
          throw new Error(
            "[evjs] Core discarded the selected Webpack facts snapshot before publication completed.",
          );
        }
      } else {
        this.invalidateFinalBuildInputs();
      }
      await publication.promise;
      published = true;
    } catch (error) {
      this.rejectPendingPublication(buildState, error);
      throw error;
    } finally {
      if (this.pendingPublication === publication) {
        this.pendingPublication = undefined;
      }
      // A failed resume re-closes the producer until Core selects rollback.
      // On success, retain the selected state through Core commit/finalize so
      // rebuilds that start in that gap remain bound to this generation.
      if (!published && this.pendingPlanTransition) {
        this.transitionBuildState = undefined;
      }
    }
  }

  private resolvePendingPublication(buildState: WebpackDevBuildState): void {
    if (this.pendingPublication?.buildState !== buildState) return;
    this.pendingPublication.resolve();
  }

  private rejectPendingPublication(
    buildState: WebpackDevBuildState,
    error: unknown,
  ): void {
    if (this.pendingPublication?.buildState !== buildState) return;
    this.pendingPublication.reject(error);
  }

  private invalidateFinalBuildInputs(): void {
    if (this.closing || this.closed || this.fatalError) return;
    try {
      this.clientServer?.invalidate();
      this.serverWatching?.invalidate();
    } catch (error) {
      if (this.pendingPublication) {
        this.pendingPublication.reject(error);
        return;
      }
      this.failDevSession(error);
    }
  }

  private throwIfUnavailable(): void {
    if (this.fatalError) throw this.fatalError;
    if (this.closing || this.closed) {
      throw new Error(
        "[evjs] Webpack dev cannot update its framework plan during or after close().",
      );
    }
  }
}

function createWebpackDevBuildState(
  plan: BuildPlan,
  generation: BundlerDevGeneration,
): WebpackDevBuildState {
  return {
    generation,
    plan,
    latestClientStats: undefined,
    latestServerStats: undefined,
    latestServerMemoryFiles: new Map(),
    latestServerPublicFiles: [],
    serverPublicAssetOwnership: new Map(),
    serverReadyPending: false,
  };
}

function createWebpackDevPlanTransition(options: {
  onOpenSelect(): void;
  onResume(): void | Promise<void>;
  onSettled(completed: boolean): void;
}): WebpackDevPlanTransition {
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
  let aborted = false;
  let rollbackStagedState: (() => void) | undefined;
  const assertOutcomeSelectable = (operation: string) => {
    if (
      state === "selected" ||
      state === "resuming" ||
      state === "finalization-prepared" ||
      state === "settled"
    ) {
      throw new Error(
        `[evjs] Webpack development update transition cannot ${operation} in state ${state}.`,
      );
    }
  };
  return {
    abort() {
      if (aborted || state === "settled") return;
      aborted = true;
      options.onSettled(false);
    },
    stage(rollback) {
      assertOutcomeSelectable("stage a candidate");
      if (state !== "open") {
        throw new Error(
          "[evjs] Webpack development update transition staged more than one candidate.",
        );
      }
      rollbackStagedState = rollback;
      state = "staged";
    },
    accept() {
      assertOutcomeSelectable("accept");
      if (state !== "open" && state !== "staged") {
        throw new Error(
          "[evjs] Webpack development update transition cannot accept after a failed or completed resume.",
        );
      }
      if (state === "open") options.onOpenSelect();
      outcome = "accept";
      state = "selected";
    },
    rollback() {
      assertOutcomeSelectable("roll back");
      if (outcome === "rollback") {
        throw new Error(
          "[evjs] Webpack development update transition selected rollback more than once.",
        );
      }
      if (rollbackStagedState) rollbackStagedState();
      else options.onOpenSelect();
      outcome = "rollback";
      state = "selected";
    },
    async resume() {
      if (state !== "selected") {
        throw new Error(
          "[evjs] Webpack development update transition resumed before selecting an outcome.",
        );
      }
      state = "resuming";
      if (aborted) {
        state = "resumed";
        return;
      }
      try {
        await options.onResume();
        state = "resumed";
      } catch (error) {
        state = "resume-failed";
        throw error;
      }
    },
    prepareFinalize() {
      if (state !== "resumed") {
        throw new Error(
          "[evjs] Webpack development update transition prepared finalization before resume succeeded.",
        );
      }
      state = "finalization-prepared";
    },
    finalize() {
      if (state !== "finalization-prepared") {
        throw new Error(
          "[evjs] Webpack development update transition finalized before preparation succeeded.",
        );
      }
      state = "settled";
      if (!aborted) options.onSettled(true);
    },
  };
}

function createWebpackDevSessionDone(): WebpackDevSessionDone {
  let settled = false;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  return {
    promise,
    reject(error) {
      if (settled) return;
      settled = true;
      rejectDone(error);
    },
    resolve() {
      if (settled) return;
      settled = true;
      resolveDone();
    },
  };
}

function createWebpackDevPublication(
  buildState: WebpackDevBuildState,
): WebpackDevPublication {
  let settled = false;
  let resolvePublication!: () => void;
  let rejectPublication!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePublication = resolve;
    rejectPublication = reject;
  });
  return {
    buildState,
    primaryKinds: new Set(),
    promise,
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPublication(error);
    },
    resolve() {
      if (settled) return;
      settled = true;
      resolvePublication();
    },
  };
}

function createInitialBuildBarrier(options: {
  needsClient: boolean;
  needsServer: boolean;
}): {
  required: Set<"client" | "server">;
  resolve: () => void;
  reject: (error: unknown) => void;
  promise: Promise<void>;
} {
  const required = new Set<"client" | "server">();
  if (options.needsClient) required.add("client");
  if (options.needsServer) required.add("server");

  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { required, resolve, reject, promise };
}

function createWebpackCompiler(
  configs: Configuration[],
): Compiler | MultiCompiler {
  if (configs.length === 1) {
    return webpack(configs[0]);
  }
  return webpack(configs);
}

function createStaticDevHostCompiler(cwd: string, clientDir: string): Compiler {
  return webpack({
    name: "evjs-static-dev-host",
    mode: "development",
    context: cwd,
    entry: {},
    output: {
      path: clientDir,
      filename: "[name].js",
    },
    infrastructureLogging: { level: "none" },
    stats: "none",
  });
}

function configureBuildOnlyMemoryOutputs(compiler: Compiler | MultiCompiler): {
  volume: Volume;
  outputPaths: Set<string>;
} {
  const volume = new Volume();
  const memoryFs = createFsFromVolume(volume);
  const outputPaths = new Set<string>();
  const childCompilers =
    "compilers" in compiler
      ? (compiler.compilers as Compiler[])
      : ([compiler] as Compiler[]);
  for (const child of childCompilers) {
    if (child.options.name !== BUILD_ONLY_SERVER_CONFIG_NAME) continue;
    child.outputFileSystem =
      memoryFs as unknown as Compiler["outputFileSystem"];
    const outputPath = child.options.output.path;
    if (outputPath) outputPaths.add(outputPath);
  }
  return { volume, outputPaths };
}

function createDevServerOptions(
  config: ResolvedConfig<WebpackConfig>,
  plan: BuildPlan,
  clientDir: string,
): ConstructorParameters<typeof WebpackDevServer>[0] {
  const classifyRequestPath = createFrameworkRequestPathClassifier(plan);

  return {
    host: "0.0.0.0",
    port: config.dev.port,
    hot: true,
    liveReload: true,
    allowedHosts: "all",
    headers: {
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
    },
    server: createDevServerTransport(config.dev.https),
    static: {
      directory: clientDir,
      publicPath: "/",
      watch: true,
    },
    devMiddleware: {
      writeToDisk: true,
      stats: "errors-warnings",
    },
    setupMiddlewares(middlewares) {
      middlewares.push({
        name: "evjs-framework-route-fallback",
        middleware(
          request: DevFallbackRequest,
          response: DevFallbackResponse,
          next: () => void,
        ) {
          const pathname = getRequestPathname(request.url);
          const requestKind = pathname
            ? classifyRequestPath(pathname)
            : undefined;
          if (!pathname || !requestKind) {
            next();
            return;
          }

          response.statusCode = 404;
          const fallback = createFrameworkNotFoundResponse(
            pathname,
            requestKind,
          );
          response.setHeader("Content-Type", fallback.contentType);
          response.end(fallback.body);
        },
      });
      return middlewares;
    },
    historyApiFallback: createHistoryFallback(plan),
    proxy: createDevProxyRules(config, plan).map(toWebpackDevProxy),
    client: {
      overlay: {
        errors: true,
        warnings: false,
      },
    },
  };
}

function createDevProxyRules(
  config: ResolvedConfig<WebpackConfig>,
  plan: BuildPlan,
): WebpackDevProxyRule[] {
  const serverTarget = `${config.server.dev.https ? "https" : "http"}://localhost:${config.server.dev.port}`;
  const rules: WebpackDevProxyRule[] = [...config.dev.proxy];

  const runtimeMatchers = createFrameworkRuntimePathMatchers(plan);
  if (runtimeMatchers.length > 0) {
    rules.push({
      context: [],
      contextFilter: createPathMatcher(runtimeMatchers),
      target: serverTarget,
      changeOrigin: true,
      secure: false,
    });
  }

  const requestRouteMatchers = createRoutePathMatchers(
    plan.dev.serverRequestRoutePaths,
  );
  if (requestRouteMatchers.length > 0) {
    rules.push({
      context: [],
      contextFilter: createPathMatcher(requestRouteMatchers),
      target: serverTarget,
      changeOrigin: true,
      secure: false,
    });
  }

  const renderedPageMatchers = createRoutePathMatchers(
    plan.dev.serverRenderedPagePaths,
  );
  if (renderedPageMatchers.length > 0) {
    rules.push({
      context: [],
      contextFilter: createPathMatcher(renderedPageMatchers),
      target: serverTarget,
      changeOrigin: true,
      secure: false,
      frameworkPageRender: true,
    });
  }

  return rules;
}

function createPathMatcher(matchers: RegExp[]): (pathname: string) => boolean {
  return (pathname) => matchers.some((matcher) => matcher.test(pathname));
}

function createRoutePathMatchers(routePaths: string[]): RegExp[] {
  return [...new Set(routePaths)].map(routePathToRegExp);
}

function createFrameworkRuntimePathMatchers(plan: BuildPlan): RegExp[] {
  const runtime = plan.runtime.server;
  return [
    createExactPathMatcher(runtime.fn),
    ...(runtime.ppr ? [createSubtreePathMatcher(runtime.ppr)] : []),
    ...(runtime.rsc ? [createExactPathMatcher(runtime.rsc)] : []),
  ];
}

function createDevServerTransport(
  https: ResolvedConfig<WebpackConfig>["dev"]["https"],
): ConstructorParameters<typeof WebpackDevServer>[0]["server"] {
  if (!https) return "http";
  if (https === true) return "https";

  return {
    type: "https",
    options: {
      key: readHttpsValue(https.key),
      cert: readHttpsValue(https.cert),
    },
  };
}

function readHttpsValue(value: string): string | Buffer {
  return fs.existsSync(value) ? fs.readFileSync(value) : value;
}

function createHistoryFallback(
  plan: BuildPlan,
): ConstructorParameters<typeof WebpackDevServer>[0]["historyApiFallback"] {
  const appHtmlByAppId = new Map(
    plan.html
      .filter((html) => html.owner.appId)
      .map((html) => [html.owner.appId as string, html.fileName]),
  );
  const appHtml = appHtmlByAppId.values().next().value;
  if (!appHtml) return false;

  return {
    index: `/${appHtml}`,
    // Keep the default dot rule so stale HMR chunks and asset URLs 404
    // instead of being rewritten to application HTML.
    rewrites: [
      ...createHtmlFallbackBypassRewrites(plan),
      ...plan.html.map((html) => ({
        from: new RegExp(`^/${escapeRegExp(html.fileName)}$`),
        to: `/${html.fileName}`,
      })),
      ...createClientRouteRewrites(plan, appHtmlByAppId),
    ],
  };
}

function createClientRouteRewrites(
  plan: BuildPlan,
  appHtmlByAppId: Map<string, string>,
): Array<{ from: RegExp; to: string }> {
  const htmlByPageId = new Map(
    plan.html
      .filter((html) => html.owner.pageId)
      .map((html) => [html.owner.pageId as string, html.fileName]),
  );

  return plan.dev.clientRoutes.flatMap(({ path, target }) => {
    const fileName = getClientRouteHtmlFileName(
      target,
      htmlByPageId,
      appHtmlByAppId,
    );
    return fileName
      ? [{ from: routePathToRegExp(path), to: `/${fileName}` }]
      : [];
  });
}

function getClientRouteHtmlFileName(
  target: BuildPlan["dev"]["clientRoutes"][number]["target"],
  htmlByPageId: Map<string, string>,
  appHtmlByAppId: Map<string, string>,
): string | undefined {
  if (target.kind === "page") {
    return htmlByPageId.get(target.pageId);
  }

  return appHtmlByAppId.get(target.appId);
}

function createHtmlFallbackBypassRewrites(plan: BuildPlan): Array<{
  from: RegExp;
  to: (ctx: { parsedUrl: { pathname?: string | null } }) => string;
}> {
  return [
    ...createRoutePathMatchers(plan.dev.serverRequestRoutePaths),
    ...createRoutePathMatchers(plan.dev.serverRenderedPagePaths),
    ...createFrameworkRuntimePathMatchers(plan),
  ].map((from) => ({
    from,
    to(ctx) {
      return ctx.parsedUrl.pathname || "/";
    },
  }));
}

function classifyFrameworkRequestPath(
  pathname: string,
  plan: BuildPlan,
): FrameworkRequestKind | undefined {
  return createFrameworkRequestPathClassifier(plan)(pathname);
}

function createFrameworkNotFoundResponse(
  pathname: string,
  requestKind: FrameworkRequestKind,
): { contentType: string; body: string } {
  if (requestKind === "server-request-route") {
    return {
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        error: {
          code: "EVJS_API_NOT_FOUND",
          message: `No API route matched ${pathname}.`,
        },
      }),
    };
  }

  return {
    contentType: "text/plain; charset=utf-8",
    body: `[evjs] No framework route matched ${pathname}.`,
  };
}

function createFrameworkRequestPathClassifier(
  plan: BuildPlan,
): (pathname: string) => FrameworkRequestKind | undefined {
  const isServerRequestRoute = createPathMatcher(
    createRoutePathMatchers(plan.dev.serverRequestRoutePaths),
  );
  const isServerRenderedPage = createPathMatcher(
    createRoutePathMatchers(plan.dev.serverRenderedPagePaths),
  );
  const isFrameworkRuntime = createPathMatcher(
    createFrameworkRuntimePathMatchers(plan),
  );

  return (pathname) => {
    if (isServerRequestRoute(pathname)) return "server-request-route";
    if (isServerRenderedPage(pathname)) return "server-rendered-page";
    if (isFrameworkRuntime(pathname)) return "runtime";
    return undefined;
  };
}

function isServerRequestRoutePath(pathname: string, plan: BuildPlan): boolean {
  return createRoutePathMatchers(plan.dev.serverRequestRoutePaths).some(
    (matcher) => matcher.test(pathname),
  );
}

function isServerRenderedPagePath(pathname: string, plan: BuildPlan): boolean {
  return createRoutePathMatchers(plan.dev.serverRenderedPagePaths).some(
    (matcher) => matcher.test(pathname),
  );
}

function isFrameworkRuntimeRequestPath(
  pathname: string,
  plan: BuildPlan,
): boolean {
  return createFrameworkRuntimePathMatchers(plan).some((matcher) =>
    matcher.test(pathname),
  );
}

function createExactPathMatcher(pathname: string): RegExp {
  return pageRoutePathToRegExp(normalizeRoutePath(pathname));
}

function createSubtreePathMatcher(pathname: string): RegExp {
  const root = normalizeRoutePath(pathname);
  return pageRoutePathToRegExp(root === "/" ? "/$" : `${root}/$`);
}

function getRequestPathname(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, "http://evjs.local").pathname;
  } catch {
    return url.split("?")[0] || undefined;
  }
}

function routePathToRegExp(routePath: string): RegExp {
  return pageRoutePathToRegExp(normalizeRoutePath(routePath));
}

function normalizeRoutePath(routePath: string): string {
  if (!routePath.startsWith("/")) return normalizeRoutePath(`/${routePath}`);
  if (routePath.length === 1) return routePath;
  return routePath.replace(/\/+$/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toWebpackDevProxy(rule: WebpackDevProxyRule) {
  return {
    context: rule.contextFilter ?? rule.context,
    target: rule.target,
    pathRewrite: rule.pathRewrite,
    changeOrigin: rule.changeOrigin,
    secure: rule.secure,
    onProxyReq(proxyReq: ClientRequest) {
      if (rule.frameworkPageRender) {
        proxyReq.setHeader(DEV_PAGE_RENDER_PROXY_HEADER, "1");
      }
    },
  };
}

async function runWebpack(configs: Configuration[]): Promise<{
  clientStats?: WebpackStatsLike;
  serverStats?: WebpackStatsLike;
  memoryFiles: Map<string, Buffer>;
}> {
  const compiler = webpack(configs);
  const memoryOutput = configureBuildOnlyMemoryOutputs(compiler);

  const stats = await new Promise<Stats | MultiStats>((resolve, reject) => {
    compiler.run((error, result) => {
      compiler.close((closeError) => {
        if (error) {
          reject(error);
          return;
        }
        if (closeError) {
          reject(closeError);
          return;
        }
        if (!result) {
          reject(new Error("[evjs] Webpack did not return build stats."));
          return;
        }
        resolve(result);
      });
    });
  });

  if (stats.hasErrors()) {
    throw new Error(formatWebpackErrors(stats));
  }

  return {
    ...splitStatsByName(stats),
    memoryFiles: collectMemoryFiles(
      memoryOutput.volume,
      memoryOutput.outputPaths,
    ),
  };
}

function splitStatsByName(stats: Stats | MultiStats): {
  clientStats?: WebpackStatsLike;
  serverStats?: WebpackStatsLike;
} {
  return splitStatsJsonByName(readWebpackStatsJson(stats));
}

function createWebpackDevStatsSnapshot(
  stats: Stats | MultiStats,
  memoryFiles?: Map<string, Buffer>,
): WebpackDevStatsSnapshot {
  const hasErrors = stats.hasErrors();
  const json = readWebpackStatsJson(stats);
  return {
    ...splitStatsJsonByName(json),
    ...(memoryFiles ? { memoryFiles } : {}),
    ...(hasErrors ? { error: formatWebpackJsonErrors(json) } : {}),
  };
}

function readWebpackStatsJson(
  stats: Stats | MultiStats,
): WebpackMultiStatsJson | WebpackStatsJson {
  return stats.toJson({
    all: false,
    assets: true,
    cachedAssets: true,
    entrypoints: true,
    errors: true,
    warnings: true,
  }) as WebpackMultiStatsJson | WebpackStatsJson;
}

function splitStatsJsonByName(json: WebpackMultiStatsJson | WebpackStatsJson): {
  clientStats?: WebpackStatsLike;
  serverStats?: WebpackStatsLike;
} {
  const children = getStatsChildren(json);
  let clientStats: WebpackStatsLike | undefined;
  let serverStats: WebpackStatsLike | undefined;

  for (const child of children) {
    if (
      child.name === "server" ||
      child.name === "server-rsc" ||
      child.name === BUILD_ONLY_SERVER_CONFIG_NAME
    ) {
      serverStats = mergeWebpackStats(serverStats, child, child.name);
    } else if (child.name === "client") {
      clientStats = child;
    }
  }

  return { clientStats, serverStats };
}

function collectMemoryFiles(
  volume: Volume,
  outputPaths: Set<string>,
): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const outputPath of outputPaths) {
    collectMemoryDirectory(volume, outputPath, outputPath, files);
  }
  return files;
}

function collectMemoryDirectory(
  volume: Volume,
  rootPath: string,
  directory: string,
  files: Map<string, Buffer>,
): void {
  const names = volume.readdirSync(directory, { encoding: "utf8" }) as string[];
  for (const name of names) {
    const filePath = path.join(directory, name);
    const stats = volume.statSync(filePath);
    if (stats.isDirectory()) {
      collectMemoryDirectory(volume, rootPath, filePath, files);
      continue;
    }
    if (!stats.isFile()) continue;

    const relativePath = path
      .relative(rootPath, filePath)
      .split(path.sep)
      .join("/");
    assertPortableRelativeArtifactPath(
      relativePath,
      `Webpack build-only memory artifact "${relativePath}"`,
    );
    const conflict = [...files.keys()].find((existing) =>
      portableArtifactPathsConflict(existing, relativePath),
    );
    if (conflict) {
      throw new Error(
        `[evjs] Webpack build-only memory artifact "${relativePath}" conflicts with "${conflict}" from another output root on portable file systems.`,
      );
    }
    files.set(relativePath, Buffer.from(volume.readFileSync(filePath)));
  }
}

function createMemoryServerModuleLoader(
  cwd: string,
  files: ReadonlyMap<string, string | Uint8Array>,
): (asset: string) => Promise<unknown> {
  const cache = new Map<string, { exports: unknown }>();
  return async (asset) => {
    const moduleId = normalizeMemoryRootAsset(asset);
    if (!files.has(moduleId)) {
      throw new Error(
        `[evjs] Webpack build-only server module "${asset}" was not emitted in memory.`,
      );
    }
    return loadMemoryCommonJsModule(cwd, files, cache, moduleId);
  };
}

function loadMemoryCommonJsModule(
  cwd: string,
  files: ReadonlyMap<string, string | Uint8Array>,
  cache: Map<string, { exports: unknown }>,
  moduleId: string,
): unknown {
  const cached = cache.get(moduleId);
  if (cached) return cached.exports;

  const rawSource = files.get(moduleId);
  if (rawSource === undefined) {
    throw new Error(
      `[evjs] Webpack build-only server dependency "${moduleId}" was not emitted in memory.`,
    );
  }
  const source =
    typeof rawSource === "string"
      ? rawSource
      : Buffer.from(rawSource).toString("utf-8");

  const module = { exports: {} as unknown };
  cache.set(moduleId, module);
  try {
    if (moduleId.endsWith(".json")) {
      module.exports = JSON.parse(source);
      return module.exports;
    }

    const filename = memoryModuleFilename(cwd, moduleId);
    const dirname = path.dirname(filename);
    const nativeRequire = createRequire(filename);
    const memoryRequire = ((request: string) => {
      if (!request.startsWith(".")) return nativeRequire(request);
      const dependencyId = resolveMemoryDependency(files, moduleId, request);
      return loadMemoryCommonJsModule(cwd, files, cache, dependencyId);
    }) as NodeJS.Require;
    Object.assign(memoryRequire, nativeRequire);

    const factory = vm.runInThisContext(
      `(function(exports, require, module, __filename, __dirname) {\n${source}\n})`,
      { filename },
    ) as (
      exports: unknown,
      require: NodeJS.Require,
      module: { exports: unknown },
      __filename: string,
      __dirname: string,
    ) => void;
    factory(module.exports, memoryRequire, module, filename, dirname);
    return module.exports;
  } catch (error) {
    cache.delete(moduleId);
    throw error;
  }
}

function normalizeMemoryRootAsset(asset: string): string {
  const relativePath = asset.startsWith("./") ? asset.slice(2) : asset;
  return assertPortableRelativeArtifactPath(
    relativePath,
    `Webpack build-only server module "${asset}"`,
  );
}

function resolveMemoryDependency(
  files: ReadonlyMap<string, string | Uint8Array>,
  parentId: string,
  request: string,
): string {
  if (request.includes("\\") || request.includes("\0")) {
    throw new Error(
      `[evjs] Webpack build-only server dependency "${request}" from "${parentId}" must stay inside the in-memory output root.`,
    );
  }

  const candidate = path.posix.normalize(
    path.posix.join(path.posix.dirname(parentId), request),
  );
  if (
    path.posix.isAbsolute(candidate) ||
    candidate === ".." ||
    candidate.startsWith("../")
  ) {
    throw new Error(
      `[evjs] Webpack build-only server dependency "${request}" from "${parentId}" must stay inside the in-memory output root.`,
    );
  }
  assertPortableRelativeArtifactPath(
    candidate,
    `Webpack build-only server dependency "${request}" from "${parentId}"`,
  );

  const candidates = path.posix.extname(candidate)
    ? [candidate]
    : [
        candidate,
        `${candidate}.js`,
        `${candidate}.cjs`,
        `${candidate}.mjs`,
        `${candidate}.json`,
        `${candidate}/index.js`,
        `${candidate}/index.cjs`,
        `${candidate}/index.mjs`,
        `${candidate}/index.json`,
      ];
  const resolved = candidates.find((item) => files.has(item));
  if (resolved) return resolved;

  throw new Error(
    `[evjs] Webpack build-only server dependency "${request}" from "${parentId}" was not emitted in memory.`,
  );
}

function memoryModuleFilename(cwd: string, moduleId: string): string {
  return path.resolve(cwd, ...moduleId.split("/"));
}

function mergeWebpackStats(
  left: WebpackStatsLike | undefined,
  right: WebpackStatsLike,
  childName?: string,
): WebpackStatsLike {
  const normalizedRight = normalizeWebpackStats(right, childName);
  if (!left) return normalizedRight;

  return {
    ...(left.assets || normalizedRight.assets
      ? {
          assets: [...(left.assets ?? []), ...(normalizedRight.assets ?? [])],
        }
      : {}),
    entrypoints: {
      ...(left.entrypoints ?? {}),
      ...(normalizedRight.entrypoints ?? {}),
    },
    ...(left.buildOnlyAssets || normalizedRight.buildOnlyAssets
      ? {
          buildOnlyAssets: [
            ...(left.buildOnlyAssets ?? []),
            ...(normalizedRight.buildOnlyAssets ?? []),
          ],
        }
      : {}),
  };
}

function normalizeWebpackStats(
  stats: WebpackStatsLike,
  childName?: string,
): WebpackStatsLike {
  if (childName !== BUILD_ONLY_SERVER_CONFIG_NAME) return stats;

  return {
    ...stats,
    assets: undefined,
    buildOnlyAssets: [
      ...(stats.buildOnlyAssets ?? []),
      ...(stats.assets ?? []),
    ],
  };
}

export const __testing = {
  classifyFrameworkRequestPath,
  collectMemoryFiles,
  copyServerPublicAssetsToClient,
  createMemoryServerModuleLoader,
  createDevProxyRules,
  createFrameworkNotFoundResponse,
  createHtmlFallbackBypassRewrites,
  isFrameworkRuntimeRequestPath,
  isServerRenderedPagePath,
  isServerRequestRoutePath,
  mergeWebpackStats,
  emitStats,
};

function formatWebpackErrors(stats: Stats | MultiStats): string {
  const json = stats.toJson({ all: false, errors: true }) as
    | WebpackMultiStatsJson
    | WebpackStatsJson;
  return formatWebpackJsonErrors(json);
}

function formatWebpackJsonErrors(
  json: WebpackMultiStatsJson | WebpackStatsJson,
): string {
  const children = getStatsChildren(json);
  const errors = children.flatMap((child) => child.errors ?? []);
  return [
    "[evjs] Webpack build failed.",
    ...errors.map((error) =>
      typeof error === "string"
        ? error
        : (error.message ?? JSON.stringify(error)),
    ),
  ].join("\n");
}

function getStatsChildren(
  json: WebpackMultiStatsJson | WebpackStatsJson,
): WebpackStatsJson[] {
  return "children" in json && Array.isArray(json.children)
    ? json.children
    : [json as WebpackStatsJson];
}

async function emitStats(
  cwd: string,
  outDir: string,
  stats: WebpackStatsLike | undefined,
): Promise<void> {
  if (!stats) return;
  assertWebpackAdapterStatsPathAvailable(readWebpackEmittedFiles(stats) ?? []);
  await writeOwnedOutputFile(
    cwd,
    path.join(outDir, "stats.json"),
    JSON.stringify(stats, null, 2),
    "Webpack stats output",
  );
}

type WebpackStatsJson = WebpackStatsLike & {
  name?: string;
  errors?: Array<string | { message?: string }>;
};

interface WebpackMultiStatsJson {
  children?: WebpackStatsJson[];
}
