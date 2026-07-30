import fs from "node:fs";
import type { ClientRequest } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import type {
  BundlerAdapter,
  BundlerBuildContext,
  BundlerBuildFacts,
  BundlerDevContext,
  BundlerDevController,
  BundlerDevUpdateOptions,
} from "@evjs/ev/_internal/build";
import {
  assertPortableRelativeArtifactPath,
  assertSafeBuildOutputPaths,
  hasServerGeneratedRuntimeChange,
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
}

interface WebpackWatching {
  close(callback: (error: Error | null) => void): void;
}

interface PromiseBarrier<T = void> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface ServerWatchState {
  active: boolean;
  readonly generation: number;
  readonly sessionGeneration: number;
  readonly firstBuild?: PromiseBarrier<WebpackDevStatsSnapshot>;
  readonly pendingTasks: Set<Promise<void>>;
  readonly bufferedSnapshots: WebpackDevStatsSnapshot[];
  firstBuildCaptured: boolean;
  committed: boolean;
  lastPublishedHash?: string;
  pendingHash?: string;
  taskQueue: Promise<void>;
  watching?: WebpackWatching;
}

interface WebpackDevStatsSnapshot {
  clientStats?: WebpackStatsLike;
  serverStats?: WebpackStatsLike;
  memoryFiles?: Map<string, Buffer>;
  hash?: string;
  error?: string;
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
      server: true,
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
    const clientCompilationExpected = configs.some(
      (webpackConfig) => webpackConfig.name === "client",
    );
    const stats = await runWebpack(configs);
    const hasRuntimeServerEntries = plan.entries.some(
      (entry) => entry.environment === "server" && entry.phase !== "build",
    );

    assertServerGeneratedModulesStayOutOfClient(
      cwd,
      plan,
      stats.clientStats,
      clientCompilationExpected,
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
  private config: ResolvedConfig<WebpackConfig>;
  private plan: BuildPlan;
  private planGeneration: number;
  private devWorkQueue: Promise<void> = Promise.resolve();
  private planUpdateQueue: Promise<void> = Promise.resolve();
  private clientServer: WebpackDevServerInstance | undefined;
  private serverWatchState: ServerWatchState | undefined;
  private latestClientStats: WebpackStatsLike | undefined;
  private latestServerStats: WebpackStatsLike | undefined;
  private latestServerMemoryFiles = new Map<string, Buffer>();
  private latestServerPublicFiles: string[] = [];
  private serverPublicAssetOwnership = new Map<string, Buffer>();
  private pendingServerReadyState: ServerWatchState | undefined;
  private artifactPublicationBlocked = false;
  private artifactPublicationEpoch = 0;
  private artifactPublicationQueue: Promise<void> = Promise.resolve();
  private startGeneration = 0;
  private serverWatchGeneration = 0;
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
    this.config = ctx.config;
    this.plan = ctx.plan;
    this.planGeneration = ctx.planGeneration;
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

    this.latestClientStats = undefined;
    this.latestServerStats = undefined;
    this.latestServerMemoryFiles = new Map();
    this.latestServerPublicFiles = [];
    this.serverPublicAssetOwnership = new Map();
    this.pendingServerReadyState = undefined;
    this.artifactPublicationBlocked = false;

    const configs = await createWebpackConfigs(
      this.config,
      this.plan,
      this.ctx.cwd,
      this.ctx.hooks,
      { clean: false, addWatchFile: this.ctx.addWatchFile },
    );
    const clientConfigs = configs.filter((config) => config.name === "client");
    const serverConfigs = configs.filter(isServerWebpackConfig);
    const needsClient = clientConfigs.length > 0;
    const needsServer = serverConfigs.length > 0;
    this.initialDone = createInitialBuildBarrier({ needsClient, needsServer });

    if (needsClient) {
      const compiler = createWebpackCompiler(clientConfigs);
      compiler.hooks.done.tap("EvjsWebpackDevClient", (stats) => {
        this.enqueueStats("client", generation, stats);
      });
      this.clientServer = new WebpackDevServer(
        createDevServerOptions(this.config, this.plan, outputPaths.clientDir),
        compiler,
      );
      await this.clientServer.start();
    }

    if (needsServer) {
      this.startServerWatching(
        serverConfigs,
        generation,
        ++this.serverWatchGeneration,
      );
    }

    if (!needsClient) {
      const compiler = createStaticDevHostCompiler(
        this.ctx.cwd,
        outputPaths.clientDir,
      );
      this.clientServer = new WebpackDevServer(
        createDevServerOptions(this.config, this.plan, outputPaths.clientDir),
        compiler,
      );
      await this.clientServer.start();
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
    await this.stop();
  }

  updatePlan(
    update: BuildPlanUpdate,
    options?: BundlerDevUpdateOptions<WebpackConfig>,
  ): Promise<void> {
    return this.enqueuePlanUpdate(async () => {
      const updateOptions = this.requirePlanUpdateOptions(options);
      this.assertPlanUpdateConfigSupported(updateOptions);

      if (
        hasServerGeneratedRuntimeChange(update.previous, update.next) &&
        isFreshServerCompilerUpdate(update)
      ) {
        await this.updatePlanWithFreshServerCompiler(update, updateOptions);
        return;
      }

      await this.enqueueDevWork(() =>
        this.applyPlanUpdate(update, updateOptions),
      );
    });
  }

  private requirePlanUpdateOptions(
    options?: BundlerDevUpdateOptions<WebpackConfig>,
  ): BundlerDevUpdateOptions<WebpackConfig> {
    if (!options) {
      throw new Error(
        "[evjs] Webpack dev plan updates require lifecycle options with a plan generation and staged framework state callbacks.",
      );
    }
    return options;
  }

  private assertPlanUpdateConfigSupported(
    options: BundlerDevUpdateOptions<WebpackConfig>,
  ): void {
    if (options.configChanged) {
      throw new Error(
        "[evjs] Webpack dev cannot safely replace framework, proxy, or plugin bundler configuration in place. Restart ev dev to apply the updated config.",
      );
    }
  }

  private async applyPlanUpdate(
    update: BuildPlanUpdate,
    options: BundlerDevUpdateOptions<WebpackConfig>,
  ): Promise<void> {
    if (
      !isEmptyBuildPlanUpdate(update) &&
      !isArtifactOnlyBuildPlanUpdate(update)
    ) {
      throw new Error(
        "[evjs] Webpack dev cannot safely replace persistent compiler entries, routes, server topology, or module resolution in place. Restart ev dev to apply this framework plan change.",
      );
    }

    const previousPlan = this.plan;
    const previousConfig = this.config;
    const previousPlanGeneration = this.planGeneration;
    let frameworkStateCommitted = false;
    this.blockArtifactPublication();

    try {
      await this.drainArtifactPublication();
      await options.commitFrameworkState();
      frameworkStateCommitted = true;
      this.config = options.config;
      this.plan = update.next;
      this.planGeneration = options.planGeneration;
      await assertSafeBuildOutputPaths(
        this.ctx.cwd,
        resolveBuildOutputPaths(this.ctx.cwd, this.plan),
      );
      this.allowArtifactPublication();
      const emitted = await this.generateDevArtifacts();
      if (emitted && hasRuntimeServerEntry(this.plan)) {
        await this.ctx.callbacks.onServerBundleReady({
          planGeneration: this.planGeneration,
        });
      }
    } catch (error) {
      this.blockArtifactPublication();
      await this.drainArtifactPublication();
      let recoveryError: unknown;
      try {
        if (frameworkStateCommitted) {
          await options.rollbackFrameworkState();
        }
        this.config = previousConfig;
        this.plan = previousPlan;
        this.planGeneration = previousPlanGeneration;
        this.allowArtifactPublication();
        const recovered = await this.generateDevArtifacts();
        if (recovered && hasRuntimeServerEntry(this.plan)) {
          await this.ctx.callbacks.onServerBundleReady({
            planGeneration: this.planGeneration,
          });
        }
      } catch (recoveryFailure) {
        recoveryError = recoveryFailure;
      }
      if (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          "[evjs] Webpack artifact refresh failed and the previous framework state could not be fully republished.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async updatePlanWithFreshServerCompiler(
    update: BuildPlanUpdate,
    options: BundlerDevUpdateOptions<WebpackConfig>,
  ): Promise<void> {
    const previousPlan = this.plan;
    const previousConfig = this.config;
    const previousPlanGeneration = this.planGeneration;
    const previousServerPublicAssetOwnership = new Map(
      this.serverPublicAssetOwnership,
    );
    this.blockArtifactPublication();

    let frameworkStateCommitted = false;
    let cleanupError: unknown;
    try {
      const previousState = this.invalidateCurrentServerWatch();
      if (previousState) {
        await this.quarantineServerWatch(previousState);
      }
      await this.drainArtifactPublication();

      await assertSafeBuildOutputPaths(
        this.ctx.cwd,
        resolveBuildOutputPaths(this.ctx.cwd, update.next),
      );
      await options.commitFrameworkState();
      frameworkStateCommitted = true;
      const configs = await createWebpackConfigs(
        options.config,
        update.next,
        this.ctx.cwd,
        this.ctx.hooks,
        { clean: false, addWatchFile: this.ctx.addWatchFile },
      );
      const serverConfigs = configs.filter(isServerWebpackConfig);

      if (serverConfigs.length === 0) {
        this.config = options.config;
        this.plan = update.next;
        this.planGeneration = options.planGeneration;
        this.latestServerStats = undefined;
        this.latestServerMemoryFiles = new Map();
        this.latestServerPublicFiles = [];
        this.allowArtifactPublication();
        const emitted = await this.generateDevArtifacts();
        if (!emitted) {
          throw new Error(
            "[evjs] Webpack could not publish framework artifacts after removing the active server compiler.",
          );
        }
        if (hasRuntimeServerEntry(this.plan)) {
          await this.ctx.callbacks.onServerBundleReady({
            planGeneration: this.planGeneration,
          });
        }
        return;
      }

      const firstBuild = createPromiseBarrier<WebpackDevStatsSnapshot>();
      const candidateState = this.startServerWatching(
        serverConfigs,
        this.startGeneration,
        this.serverWatchGeneration,
        firstBuild,
      );
      const firstSnapshot = await firstBuild.promise;

      this.config = options.config;
      this.plan = update.next;
      this.planGeneration = options.planGeneration;
      this.latestServerStats = undefined;
      this.latestServerMemoryFiles = new Map();
      this.latestServerPublicFiles = [];
      this.allowArtifactPublication();
      await this.handleServerStats(candidateState, firstSnapshot);
      await this.flushBufferedServerSnapshots(candidateState);
    } catch (error) {
      this.blockArtifactPublication();
      const failedState = this.invalidateCurrentServerWatch();
      if (failedState) {
        try {
          await this.quarantineServerWatch(failedState);
        } catch (quarantineError) {
          cleanupError = quarantineError;
        }
      }
      await this.drainArtifactPublication();

      this.pendingServerReadyState = undefined;
      this.serverPublicAssetOwnership = previousServerPublicAssetOwnership;
      let recoveryError: unknown;
      try {
        if (frameworkStateCommitted) {
          await options.rollbackFrameworkState();
        }
        await this.recoverPreviousServerCompiler({
          config: previousConfig,
          plan: previousPlan,
          planGeneration: previousPlanGeneration,
        });
      } catch (recoveryFailure) {
        recoveryError = recoveryFailure;
      }

      if (cleanupError || recoveryError) {
        throw new AggregateError(
          [error, cleanupError, recoveryError].filter(
            (failure) => failure !== undefined,
          ),
          "[evjs] Webpack server compiler refresh failed and the previous compiler could not be fully recovered.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async recoverPreviousServerCompiler(options: {
    config: ResolvedConfig<WebpackConfig>;
    plan: BuildPlan;
    planGeneration: number;
  }): Promise<void> {
    this.config = options.config;
    this.plan = options.plan;
    this.planGeneration = options.planGeneration;
    this.latestServerStats = undefined;
    this.latestServerMemoryFiles = new Map();
    this.latestServerPublicFiles = [];
    this.pendingServerReadyState = undefined;

    await assertSafeBuildOutputPaths(
      this.ctx.cwd,
      resolveBuildOutputPaths(this.ctx.cwd, this.plan),
    );
    const configs = await createWebpackConfigs(
      this.config,
      this.plan,
      this.ctx.cwd,
      this.ctx.hooks,
      { clean: false, addWatchFile: this.ctx.addWatchFile },
    );
    const serverConfigs = configs.filter(isServerWebpackConfig);
    if (serverConfigs.length === 0) {
      this.allowArtifactPublication();
      const emitted = await this.generateDevArtifacts();
      if (!emitted) {
        throw new Error(
          "[evjs] Webpack could not republish the previous framework artifacts after server compiler recovery.",
        );
      }
      if (hasRuntimeServerEntry(this.plan)) {
        await this.ctx.callbacks.onServerBundleReady({
          planGeneration: this.planGeneration,
        });
      }
      return;
    }

    const firstBuild = createPromiseBarrier<WebpackDevStatsSnapshot>();
    const recoveredState = this.startServerWatching(
      serverConfigs,
      this.startGeneration,
      this.serverWatchGeneration,
      firstBuild,
    );
    const firstSnapshot = await firstBuild.promise;
    this.allowArtifactPublication();
    await this.handleServerStats(recoveredState, firstSnapshot);
    await this.flushBufferedServerSnapshots(recoveredState);
  }

  private async stop(): Promise<void> {
    this.blockArtifactPublication();
    this.startGeneration++;
    const serverState = this.invalidateCurrentServerWatch();
    const errors: unknown[] = [];

    if (serverState) {
      try {
        await this.quarantineServerWatch(serverState);
      } catch (error) {
        errors.push(error);
      }
    }
    await this.drainArtifactPublication();

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

  private enqueuePlanUpdate<T>(work: () => Promise<T>): Promise<T> {
    const result = this.planUpdateQueue.then(work);
    this.planUpdateQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private enqueueStats(
    kind: "client",
    generation: number,
    stats: Stats | MultiStats,
  ): void {
    if (generation !== this.startGeneration) return;

    let snapshot: WebpackDevStatsSnapshot;
    try {
      snapshot = createWebpackDevStatsSnapshot(stats);
    } catch (error) {
      this.failInitialBuild(error);
      logger.error`Failed to snapshot webpack ${kind} dev build: ${error}`;
      return;
    }

    void this.enqueueDevWork(() =>
      this.handleClientStats(generation, snapshot),
    ).catch((error) => {
      this.failInitialBuild(error);
      logger.error`Failed to process webpack ${kind} dev build: ${error}`;
    });
  }

  private enqueueDevWork<T>(work: () => Promise<T>): Promise<T> {
    const result = this.devWorkQueue.then(work);
    this.devWorkQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private startServerWatching(
    configs: Configuration[],
    sessionGeneration: number,
    serverWatchGeneration: number,
    firstBuild?: PromiseBarrier<WebpackDevStatsSnapshot>,
  ): ServerWatchState {
    const compiler = createWebpackCompiler(
      configs.map((config) => ({
        ...config,
        optimization: {
          ...config.optimization,
          // A failed replacement must leave the last known-good server
          // bundle available for orchestrator rollback and the next refresh.
          emitOnErrors: false,
        },
      })),
    );
    const memoryOutput = configureBuildOnlyMemoryOutputs(compiler);
    const state: ServerWatchState = {
      active: true,
      generation: serverWatchGeneration,
      sessionGeneration,
      firstBuild,
      pendingTasks: new Set(),
      bufferedSnapshots: [],
      firstBuildCaptured: false,
      committed: firstBuild === undefined,
      taskQueue: Promise.resolve(),
    };
    const handleError = (error: unknown) => {
      if (!this.isActiveServerWatch(state)) return;
      this.failInitialBuild(error);
      state.firstBuild?.reject(error);
      logger.error`${error}`;
    };
    compiler.hooks.done.tap("EvjsWebpackDevServer", (stats) => {
      if (!this.isActiveServerWatch(state)) return;

      let snapshot: WebpackDevStatsSnapshot;
      try {
        snapshot = createWebpackDevStatsSnapshot(
          stats,
          collectMemoryFiles(memoryOutput.volume, memoryOutput.outputPaths),
        );
      } catch (error) {
        handleError(error);
        return;
      }

      if (state.firstBuild && !state.firstBuildCaptured) {
        state.firstBuildCaptured = true;
        if (snapshot.error) {
          state.firstBuild.reject(new Error(snapshot.error));
        } else {
          state.firstBuild.resolve(snapshot);
        }
        return;
      }
      if (!state.committed) {
        state.bufferedSnapshots.push(snapshot);
        return;
      }
      void this.enqueueServerStats(state, snapshot).catch(handleError);
    });
    this.serverWatchState = state;
    try {
      state.watching = compiler.watch({}, (error) => {
        if (error) handleError(error);
      });
    } catch (error) {
      state.active = false;
      if (this.serverWatchState === state) {
        this.serverWatchState = undefined;
      }
      throw error;
    }
    return state;
  }

  private invalidateCurrentServerWatch(): ServerWatchState | undefined {
    const state = this.serverWatchState;
    this.serverWatchGeneration++;
    if (state) {
      state.active = false;
      if (state.firstBuild && !state.firstBuildCaptured) {
        state.firstBuild.reject(
          new Error(
            "[evjs] Webpack candidate server compiler was stopped before its first build completed.",
          ),
        );
      }
    }
    this.serverWatchState = undefined;
    if (this.pendingServerReadyState === state) {
      this.pendingServerReadyState = undefined;
    }
    return state;
  }

  private async quarantineServerWatch(state: ServerWatchState): Promise<void> {
    state.active = false;
    let closeError: unknown;
    if (state.watching) {
      try {
        await closeWebpackWatching(state.watching);
      } catch (error) {
        closeError = error;
      }
    }
    while (state.pendingTasks.size > 0) {
      await Promise.allSettled([...state.pendingTasks]);
    }
    state.bufferedSnapshots.length = 0;
    if (closeError) throw closeError;
  }

  private isActiveServerWatch(state: ServerWatchState): boolean {
    return (
      state.active &&
      state.sessionGeneration === this.startGeneration &&
      state.generation === this.serverWatchGeneration &&
      this.serverWatchState === state
    );
  }

  private enqueueServerStats(
    state: ServerWatchState,
    snapshot: WebpackDevStatsSnapshot,
  ): Promise<void> {
    const task = state.taskQueue
      .catch(() => {})
      .then(() => this.handleServerStats(state, snapshot));
    state.taskQueue = task;
    state.pendingTasks.add(task);
    void task.then(
      () => state.pendingTasks.delete(task),
      () => state.pendingTasks.delete(task),
    );
    return task;
  }

  private async flushBufferedServerSnapshots(
    state: ServerWatchState,
  ): Promise<void> {
    while (state.bufferedSnapshots.length > 0) {
      const snapshots = state.bufferedSnapshots.splice(0);
      for (const snapshot of snapshots) {
        await this.enqueueServerStats(state, snapshot);
      }
    }
    state.committed = true;
  }

  private async handleClientStats(
    generation: number,
    snapshot: WebpackDevStatsSnapshot,
  ): Promise<void> {
    if (generation !== this.startGeneration) return;

    if (snapshot.error) {
      const error = new Error(snapshot.error);
      this.failInitialBuild(error);
      logger.error`${error.message}`;
      return;
    }

    const outputPaths = resolveBuildOutputPaths(this.ctx.cwd, this.plan);
    assertServerGeneratedModulesStayOutOfClient(
      this.ctx.cwd,
      this.plan,
      snapshot.clientStats,
      true,
    );
    this.latestClientStats = snapshot.clientStats;
    await emitStats(
      this.ctx.cwd,
      outputPaths.clientDir,
      this.latestClientStats,
    );

    const emitted = await this.generateDevArtifacts();
    if (emitted) {
      this.completeInitialBuild();
    }
    const pendingState = this.pendingServerReadyState;
    if (emitted && pendingState && this.isActiveServerWatch(pendingState)) {
      this.pendingServerReadyState = undefined;
      await this.publishServerReady(pendingState, pendingState.pendingHash);
    }
  }

  private async generateDevArtifacts(): Promise<boolean> {
    if (this.artifactPublicationBlocked) return false;
    const epoch = this.artifactPublicationEpoch;
    const publication = this.artifactPublicationQueue.then(async () => {
      if (
        this.artifactPublicationBlocked ||
        epoch !== this.artifactPublicationEpoch
      ) {
        return false;
      }
      return this.publishDevArtifacts();
    });
    this.artifactPublicationQueue = publication.then(
      () => undefined,
      () => undefined,
    );
    return publication;
  }

  private async handleServerStats(
    state: ServerWatchState,
    snapshot: WebpackDevStatsSnapshot,
  ): Promise<void> {
    if (!this.isActiveServerWatch(state)) return;
    if (snapshot.error) {
      throw new Error(snapshot.error);
    }
    if (snapshot.hash && snapshot.hash === state.lastPublishedHash) {
      return;
    }

    const outputPaths = resolveBuildOutputPaths(this.ctx.cwd, this.plan);
    const nextServerStats = snapshot.serverStats;
    const nextMemoryFiles = snapshot.memoryFiles ?? new Map();
    await emitStats(this.ctx.cwd, outputPaths.serverDir, nextServerStats);
    const nextPublicFiles = await copyServerPublicAssetsToClient(
      this.ctx.cwd,
      outputPaths.serverDir,
      outputPaths.clientDir,
      nextServerStats,
      nextMemoryFiles,
      this.serverPublicAssetOwnership,
      this.readClientOwnedFiles(),
      this.plan.runtime.publicPath,
    );
    if (!this.isActiveServerWatch(state)) return;

    this.latestServerStats = nextServerStats;
    this.latestServerMemoryFiles = nextMemoryFiles;
    this.latestServerPublicFiles = nextPublicFiles;
    const emitted = await this.generateDevArtifacts();
    if (!this.isActiveServerWatch(state)) return;
    if (!emitted) {
      state.pendingHash = snapshot.hash;
      this.pendingServerReadyState = state;
      return;
    }

    this.completeInitialBuild();
    if (this.pendingServerReadyState === state) {
      this.pendingServerReadyState = undefined;
    }
    await this.publishServerReady(state, snapshot.hash);
  }

  private async publishServerReady(
    state: ServerWatchState,
    compilationHash: string | undefined,
  ): Promise<void> {
    if (!this.isActiveServerWatch(state)) return;
    await this.ctx.callbacks.onServerBundleReady({
      planGeneration: this.planGeneration,
    });
    if (!this.isActiveServerWatch(state)) return;
    state.lastPublishedHash = compilationHash;
    state.pendingHash = undefined;
  }

  private async publishDevArtifacts(): Promise<boolean> {
    const hasClientEntries = this.plan.entries.some(
      (entry) => entry.environment === "client",
    );
    const hasServerEntries = this.plan.entries.some(
      (entry) => entry.environment === "server",
    );

    if (hasClientEntries && !this.latestClientStats) return false;
    if (hasServerEntries && !this.latestServerStats) return false;

    if (this.latestServerStats) {
      const outputPaths = resolveBuildOutputPaths(this.ctx.cwd, this.plan);
      this.latestServerPublicFiles = await copyServerPublicAssetsToClient(
        this.ctx.cwd,
        outputPaths.serverDir,
        outputPaths.clientDir,
        this.latestServerStats,
        this.latestServerMemoryFiles,
        this.serverPublicAssetOwnership,
        this.readClientOwnedFiles(),
        this.plan.runtime.publicPath,
      );
    }

    logger.info`Generating development manifest and HTML...`;
    const generator = new WebpackManifestGenerator(
      this.ctx.cwd,
      this.plan,
      this.latestClientStats,
      this.latestServerStats,
      this.latestServerPublicFiles,
    );
    const isRebuild = this.hasEmittedDevArtifacts;
    const facts = generator.collectBuildFacts();
    if (this.latestServerMemoryFiles.size > 0) {
      facts.loadServerModule = createMemoryServerModuleLoader(
        this.ctx.cwd,
        this.latestServerMemoryFiles,
      );
    }
    await this.ctx.callbacks.onBuildFacts(facts, {
      isRebuild,
      planGeneration: this.planGeneration,
    });
    this.hasEmittedDevArtifacts = true;
    return true;
  }

  private blockArtifactPublication(): void {
    this.artifactPublicationBlocked = true;
    this.artifactPublicationEpoch++;
  }

  private allowArtifactPublication(): void {
    this.artifactPublicationBlocked = false;
  }

  private async drainArtifactPublication(): Promise<void> {
    await this.artifactPublicationQueue;
  }

  private readClientOwnedFiles(): ReadonlySet<string> {
    return new Set(readWebpackEmittedFiles(this.latestClientStats) ?? []);
  }

  private completeInitialBuild(): void {
    if (!this.initialDone) return;
    this.initialDone.required.clear();
    this.initialDone.resolve();
  }

  private failInitialBuild(error: unknown): void {
    this.initialDone?.reject(error);
  }
}

function hasRuntimeServerEntry(plan: BuildPlan): boolean {
  return plan.entries.some(
    (entry) =>
      entry.environment === "server" && entry.kind === "server-runtime",
  );
}

function isFreshServerCompilerUpdate(update: BuildPlanUpdate): boolean {
  return (
    !update.serverCompilationChanged &&
    !update.devRoutingChanged &&
    !update.runtimeChanged &&
    !update.resolveChanged &&
    update.previous.distDir === update.next.distDir &&
    update.previous.output.clientDir === update.next.output.clientDir &&
    update.previous.output.serverDir === update.next.output.serverDir &&
    update.entries.added.length === 0 &&
    update.entries.removed.length === 0 &&
    update.entries.changed.length === 0
  );
}

function isServerWebpackConfig(config: Configuration): boolean {
  return (
    config.name === "server" ||
    config.name === "server-rsc" ||
    config.name === BUILD_ONLY_SERVER_CONFIG_NAME
  );
}

function closeWebpackWatching(watching: WebpackWatching): Promise<void> {
  return new Promise((resolve, reject) => {
    watching.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
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

function createPromiseBarrier<T>(): PromiseBarrier<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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
    ...(stats.hash ? { hash: stats.hash } : {}),
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
    cachedModules: true,
    chunks: true,
    dependentModules: true,
    entrypoints: true,
    errors: true,
    groupModulesByAttributes: false,
    groupModulesByCacheStatus: false,
    groupModulesByExtension: false,
    groupModulesByLayer: false,
    groupModulesByPath: false,
    groupModulesByType: false,
    modules: true,
    modulesSpace: Number.POSITIVE_INFINITY,
    nestedModules: true,
    nestedModulesSpace: Number.POSITIVE_INFINITY,
    orphanModules: true,
    runtimeModules: true,
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
  const namespacedRight = namespaceWebpackStats(right, childName);
  if (!left) return namespacedRight;

  const modules = [...(left.modules ?? [])];
  const seenModules = new Set(modules.map(moduleIdentity).filter(Boolean));
  for (const mod of namespacedRight.modules ?? []) {
    const identity = moduleIdentity(mod);
    if (identity && seenModules.has(identity)) continue;
    if (identity) seenModules.add(identity);
    modules.push(mod);
  }

  return {
    ...(left.assets || namespacedRight.assets
      ? {
          assets: [...(left.assets ?? []), ...(namespacedRight.assets ?? [])],
        }
      : {}),
    entrypoints: {
      ...(left.entrypoints ?? {}),
      ...(namespacedRight.entrypoints ?? {}),
    },
    ...(left.buildOnlyAssets || namespacedRight.buildOnlyAssets
      ? {
          buildOnlyAssets: [
            ...(left.buildOnlyAssets ?? []),
            ...(namespacedRight.buildOnlyAssets ?? []),
          ],
        }
      : {}),
    chunks: [...(left.chunks ?? []), ...(namespacedRight.chunks ?? [])],
    modules,
  };
}

function namespaceWebpackStats(
  stats: WebpackStatsLike,
  childName?: string,
): WebpackStatsLike {
  if (
    childName !== BUILD_ONLY_SERVER_CONFIG_NAME &&
    childName !== "server-rsc"
  ) {
    return stats;
  }
  const prefixChunk = (value: string | number) => `${childName}:${value}`;

  return {
    ...stats,
    ...(childName === BUILD_ONLY_SERVER_CONFIG_NAME
      ? {
          assets: undefined,
          buildOnlyAssets: [
            ...(stats.buildOnlyAssets ?? []),
            ...(stats.assets ?? []),
          ],
        }
      : {}),
    chunks: stats.chunks?.map((chunk) => ({
      ...chunk,
      id: chunk.id === undefined ? undefined : prefixChunk(chunk.id),
      names: chunk.names?.map(prefixChunk),
    })),
    modules: stats.modules?.map((mod) => ({
      ...mod,
      chunks: mod.chunks?.map(prefixChunk),
    })),
  };
}

function moduleIdentity(mod: NonNullable<WebpackStatsLike["modules"]>[number]) {
  if (mod.identifier !== undefined) return `identifier:${mod.identifier}`;
  if (mod.name !== undefined) return `name:${mod.name}`;
  if (mod.id !== undefined) return `id:${mod.id}`;
  return undefined;
}

function assertServerGeneratedModulesStayOutOfClient(
  cwd: string,
  plan: BuildPlan,
  clientStats: WebpackStatsLike | undefined,
  clientCompilationExpected: boolean,
): void {
  const serverModules =
    plan.generated?.modules.filter(
      (generatedModule) => generatedModule.scope.kind === "server",
    ) ?? [];
  if (serverModules.length === 0) return;
  if (!clientStats) {
    if (!clientCompilationExpected) return;
    throw new Error(
      "[evjs] Cannot verify server-scoped generated module isolation because Webpack client stats are missing.",
    );
  }
  if (!Array.isArray(clientStats.modules)) {
    throw new Error(
      "[evjs] Cannot verify server-scoped generated module isolation because Webpack client stats.modules must be an array.",
    );
  }
  assertWebpackStatsAreComplete(
    clientStats.filteredModules,
    "Webpack client stats",
  );

  const projectRoots = createProjectRoots(cwd);
  const generatedModules = new Map<string, (typeof serverModules)[number]>();
  for (const generatedModule of serverModules) {
    const generatedPath = toGeneratedProjectRelativePath(
      projectRoots,
      generatedModule.file,
    );
    if (!generatedPath) {
      throw new Error(
        `[evjs] Server-scoped generated module "${generatedModule.key}" has a path outside the project: ${generatedModule.file}.`,
      );
    }
    const existingModule = generatedModules.get(generatedPath);
    if (existingModule) {
      throw new Error(
        `[evjs] Cannot verify server-scoped generated module isolation because "${existingModule.key}" and "${generatedModule.key}" resolve to the same project path: ${generatedPath}.`,
      );
    }
    generatedModules.set(generatedPath, generatedModule);
  }

  const leakedModuleKeys = new Set<string>();
  collectLeakedWebpackModules(
    clientStats.modules,
    projectRoots,
    generatedModules,
    leakedModuleKeys,
  );
  if (leakedModuleKeys.size === 0) return;

  const leakedModules = serverModules.filter((generatedModule) =>
    leakedModuleKeys.has(generatedModule.key),
  );
  throw new Error(
    `[evjs] Server-scoped generated modules reached the client bundle: ${leakedModules
      .map(
        (generatedModule) => `${generatedModule.key} (${generatedModule.file})`,
      )
      .join(
        ", ",
      )}. Import these modules only from server routes, server functions, or other server-only entry graphs.`,
  );
}

function collectLeakedWebpackModules(
  modules: unknown,
  projectRoots: readonly string[],
  generatedModules: ReadonlyMap<
    string,
    NonNullable<BuildPlan["generated"]>["modules"][number]
  >,
  leakedModuleKeys: Set<string>,
): void {
  if (!Array.isArray(modules)) {
    throw new Error(
      "[evjs] Cannot verify server-scoped generated module isolation because a nested Webpack stats modules value is not an array.",
    );
  }

  for (const module of modules) {
    if (!module || typeof module !== "object" || Array.isArray(module)) {
      throw new Error(
        "[evjs] Cannot verify server-scoped generated module isolation because Webpack client stats.modules contains a non-object entry.",
      );
    }
    const record = module as Record<string, unknown>;
    assertWebpackStatsAreComplete(
      record.filteredModules,
      "a Webpack client stats module",
    );
    assertWebpackStatsAreComplete(
      record.filteredChildren,
      "a Webpack client stats module group",
    );

    const modulePath = record.nameForCondition;
    if (modulePath !== undefined && modulePath !== null) {
      if (typeof modulePath !== "string" || modulePath.length === 0) {
        throw new Error(
          "[evjs] Cannot verify server-scoped generated module isolation because Webpack client stats.modules[].nameForCondition must be a non-empty string.",
        );
      }
      const projectRelativePath = toWebpackProjectRelativePath(
        projectRoots,
        modulePath,
      );
      const generatedModule = projectRelativePath
        ? generatedModules.get(projectRelativePath)
        : undefined;
      if (generatedModule) leakedModuleKeys.add(generatedModule.key);
    }

    for (const field of ["modules", "children"] as const) {
      if (record[field] !== undefined) {
        collectLeakedWebpackModules(
          record[field],
          projectRoots,
          generatedModules,
          leakedModuleKeys,
        );
      }
    }
  }
}

function assertWebpackStatsAreComplete(
  filteredCount: unknown,
  source: string,
): void {
  if (filteredCount === undefined || filteredCount === 0) return;
  if (
    typeof filteredCount !== "number" ||
    !Number.isSafeInteger(filteredCount) ||
    filteredCount < 0
  ) {
    throw new Error(
      `[evjs] Cannot verify server-scoped generated module isolation because ${source} reported an invalid filtered module count.`,
    );
  }
  throw new Error(
    `[evjs] Cannot verify server-scoped generated module isolation because ${source} omitted ${filteredCount} module${filteredCount === 1 ? "" : "s"}.`,
  );
}

function createProjectRoots(cwd: string): readonly string[] {
  const absoluteCwd = path.resolve(cwd);
  const realCwd = fs.realpathSync.native(absoluteCwd);
  return realCwd === absoluteCwd ? [absoluteCwd] : [absoluteCwd, realCwd];
}

function toGeneratedProjectRelativePath(
  projectRoots: readonly string[],
  modulePath: string,
): string | undefined {
  const projectRoot = projectRoots[0];
  if (!projectRoot) return undefined;
  return toProjectRelativePath(
    projectRoots,
    path.resolve(projectRoot, modulePath),
  );
}

function toWebpackProjectRelativePath(
  projectRoots: readonly string[],
  modulePath: string,
): string | undefined {
  const projectRoot = projectRoots[0];
  if (!projectRoot) return undefined;
  return toProjectRelativePath(
    projectRoots,
    path.isAbsolute(modulePath)
      ? path.normalize(modulePath)
      : path.resolve(projectRoot, modulePath),
  );
}

function toProjectRelativePath(
  projectRoots: readonly string[],
  absolutePath: string,
): string | undefined {
  for (const projectRoot of projectRoots) {
    const relativePath = path
      .relative(projectRoot, absolutePath)
      .replaceAll("\\", "/");
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith("../") ||
      path.isAbsolute(relativePath)
    ) {
      continue;
    }
    return relativePath;
  }
  return undefined;
}

export const __testing = {
  assertServerGeneratedModulesStayOutOfClient,
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
