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
  ClientDevMiddlewareServerHandle,
  ClientDevMiddlewareTlsCredentials,
} from "@evjs/ev/_internal/build";
import {
  assertPortableRelativeArtifactPath,
  assertSafeBuildOutputPaths,
  portableArtifactPathsConflict,
  reserveClientDevMiddlewareUpstreamPort,
  resolveBuildOutputPaths,
  resolveClientDevMiddlewareTlsCredentials,
  startClientDevMiddlewareServer,
  writeOwnedOutputFile,
} from "@evjs/ev/_internal/build";
import type { DevProxyRule, ResolvedConfig } from "@evjs/ev/config";
import { pageRoutePathToRegExp } from "@evjs/shared";
import type { BuildPlan } from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import { createFsFromVolume, Volume } from "memfs";
import type { Compiler, MultiCompiler, MultiStats, Stats } from "webpack";
import webpack from "webpack";
import WebpackDevServer from "webpack-dev-server";
import {
  assertWebpackAdapterStatsPathAvailable,
  readWebpackEmittedFiles,
  WebpackManifestGenerator,
  type WebpackStatsLike,
} from "../manifest-generator.js";
import { createWebpackConfigs, type WebpackConfigs } from "./create-config.js";
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
  readonly buildState: WebpackDevBuildState;
  readonly sessionEpoch: number;
  /** Child compilers that have started in this terminal-stats cycle. */
  readonly startedCompilers: WeakSet<Compiler>;
  snapshot?: WebpackDevStatsSnapshot;
  complete(snapshot: WebpackDevStatsSnapshot | undefined): void;
}

interface WebpackDevBuildState {
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

export const webpackAdapter: BundlerAdapter<WebpackConfigs> = {
  name: "webpack",
  capabilities: {
    build: {
      server: true,
      rsc: true,
      ppr: true,
    },
    dev: {
      clientMiddleware: true,
    },
  },

  async build(
    ctx: BundlerBuildContext<WebpackConfigs>,
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
    ctx: BundlerDevContext<WebpackConfigs>,
  ): Promise<BundlerDevController> {
    throwIfWebpackDevAborted(ctx.signal);
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

class WebpackDevSession implements BundlerDevController {
  readonly origin: string;
  readonly done: Promise<void>;
  private readonly config: ResolvedConfig<WebpackConfigs>;
  private readonly plan: BuildPlan;
  private buildState: WebpackDevBuildState;
  private devWorkQueue: Promise<void> = Promise.resolve();
  private clientServer: WebpackDevServerInstance | undefined;
  private clientMiddlewareServer: ClientDevMiddlewareServerHandle | undefined;
  private serverWatching: WebpackWatching | undefined;
  private lifecycleEpoch = 0;
  private fatalError: Error | undefined;
  private closePromise: Promise<void> | undefined;
  private readonly sessionDone = createWebpackDevSessionDone();
  private statsReservations = new Map<
    "client" | "server",
    WebpackDevStatsReservation
  >();
  private hasEmittedDevArtifacts = false;

  constructor(private ctx: BundlerDevContext<WebpackConfigs>) {
    this.done = this.sessionDone.promise;
    void this.done.catch(() => {});
    this.config = ctx.config;
    this.plan = ctx.plan;
    this.buildState = createWebpackDevBuildState(ctx.plan);
    this.origin = `${ctx.config.dev.https ? "https" : "http"}://localhost:${ctx.config.dev.port}`;
    ctx.signal.addEventListener(
      "abort",
      () => {
        void this.close().catch(
          (error) =>
            logger.error`Failed to close aborted webpack dev session: ${error}`,
        );
      },
      { once: true },
    );
  }

  async start(): Promise<void> {
    throwIfWebpackDevAborted(this.ctx.signal);
    const sessionEpoch = ++this.lifecycleEpoch;
    const outputPaths = resolveBuildOutputPaths(this.ctx.cwd, this.plan);

    logger.info`Starting development server with webpack...`;

    await assertSafeBuildOutputPaths(this.ctx.cwd, outputPaths);
    throwIfWebpackDevAborted(this.ctx.signal);
    await fs.promises.rm(outputPaths.rootDir, {
      recursive: true,
      force: true,
    });
    throwIfWebpackDevAborted(this.ctx.signal);

    this.buildState = createWebpackDevBuildState(this.plan);

    const configs = await createWebpackConfigs(
      this.config,
      this.plan,
      this.ctx.cwd,
      this.ctx.hooks,
      { clean: false, addWatchFile: this.ctx.addWatchFile },
    );
    throwIfWebpackDevAborted(this.ctx.signal);
    const clientConfigs = configs.filter((config) => config.name === "client");
    const serverConfigs = configs.filter(
      (config) =>
        config.name === "server" ||
        config.name === "server-rsc" ||
        config.name === BUILD_ONLY_SERVER_CONFIG_NAME,
    );
    const needsClient = clientConfigs.length > 0;
    const needsServer = serverConfigs.length > 0;
    const clientMiddlewares = this.ctx.clientMiddlewares ?? [];
    const middlewareEnabled = clientMiddlewares.length > 0;
    const internalPort = middlewareEnabled
      ? await reserveClientDevMiddlewareUpstreamPort()
      : this.config.dev.port;
    const devServerBinding: WebpackDevServerBinding = {
      port: internalPort,
      https: middlewareEnabled ? false : this.config.dev.https,
      ...(middlewareEnabled
        ? {
            publicWebSocket: {
              https: Boolean(this.config.dev.https),
              port: this.config.dev.port,
            },
          }
        : {}),
    };

    if (needsClient) {
      const compiler = createWebpackCompiler(clientConfigs);
      this.trackCompileStart("client", sessionEpoch, compiler);
      compiler.hooks.done.tap("EvjsWebpackDevClientSnapshot", (stats) => {
        this.captureStatsReservation("client", sessionEpoch, stats);
      });
      this.trackCompileCompletion("client", sessionEpoch, compiler);
      const clientServer = new WebpackDevServer(
        createDevServerOptions(
          this.config,
          this.plan,
          outputPaths.clientDir,
          devServerBinding,
        ),
        compiler,
      );
      this.clientServer = clientServer;
      await clientServer.start();
      throwIfWebpackDevAborted(this.ctx.signal);
    }

    if (needsServer) {
      const compiler = createWebpackCompiler(serverConfigs);
      const memoryOutput = configureBuildOnlyMemoryOutputs(compiler);
      this.trackCompileStart("server", sessionEpoch, compiler);
      compiler.hooks.done.tap("EvjsWebpackDevServerSnapshot", (stats) => {
        this.captureStatsReservation(
          "server",
          sessionEpoch,
          stats,
          collectMemoryFiles(memoryOutput.volume, memoryOutput.outputPaths),
        );
      });
      this.trackCompileCompletion("server", sessionEpoch, compiler);
      this.serverWatching = compiler.watch({}, (error) => {
        if (error) {
          this.failStatsReservation("server", sessionEpoch, error);
        }
      });
    }

    if (!needsClient) {
      const compiler = createStaticDevHostCompiler(
        this.ctx.cwd,
        outputPaths.clientDir,
      );
      const clientServer = new WebpackDevServer(
        createDevServerOptions(
          this.config,
          this.plan,
          outputPaths.clientDir,
          devServerBinding,
        ),
        compiler,
      );
      this.clientServer = clientServer;
      await clientServer.start();
      throwIfWebpackDevAborted(this.ctx.signal);
    }

    if (middlewareEnabled) {
      const tls = await resolveClientDevMiddlewareTlsCredentials(
        this.ctx.cwd,
        this.config.dev.https,
        createWebpackSelfSignedCertificate,
      );
      throwIfWebpackDevAborted(this.ctx.signal);
      const middlewareServer = await startClientDevMiddlewareServer({
        port: this.config.dev.port,
        tls,
        signal: this.ctx.signal,
        middlewares: clientMiddlewares,
        upstream: { hostname: "127.0.0.1", port: internalPort },
      });
      await this.attachClientMiddlewareServer(middlewareServer);
    }

    throwIfWebpackDevAborted(this.ctx.signal);
  }

  async close(): Promise<void> {
    this.closePromise ??= (async () => {
      try {
        await this.stop();
        this.sessionDone.resolve();
      } catch (error) {
        this.failDevSession(error);
        throw error;
      }
    })();
    return this.closePromise;
  }

  private async stop(): Promise<void> {
    this.lifecycleEpoch++;
    this.cancelStatsReservations();
    const errors: unknown[] = [];

    if (this.clientMiddlewareServer) {
      const server = this.clientMiddlewareServer;
      this.clientMiddlewareServer = undefined;
      try {
        await server.close();
      } catch (error) {
        errors.push(error);
      }
    }

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
    sessionEpoch: number,
    compiler: Compiler | MultiCompiler,
  ): void {
    const reserve = (startedCompiler: Compiler) => {
      if (sessionEpoch !== this.lifecycleEpoch) return;
      const existing = this.statsReservations.get(kind);
      if (existing) {
        if (!existing.startedCompilers.has(startedCompiler)) {
          existing.startedCompilers.add(startedCompiler);
          return;
        }
        // Webpack may skip done/afterDone when an in-flight watch compile is
        // invalidated. Retire the unterminated reservation so the replacement
        // compile can publish a complete snapshot.
        this.supersedeStatsReservation(kind, existing);
      }
      const reservation = this.reserveStatsWork(
        kind,
        sessionEpoch,
        this.buildState,
      );
      reservation.startedCompilers.add(startedCompiler);
    };
    compiler.hooks.run.tap("EvjsWebpackDevSession", reserve);
    compiler.hooks.watchRun.tap("EvjsWebpackDevSession", reserve);
    const compilers = "compilers" in compiler ? compiler.compilers : [compiler];
    for (const childCompiler of compilers) {
      childCompiler.hooks.failed.tap("EvjsWebpackDevSession", (error) => {
        this.failStatsReservation(kind, sessionEpoch, error);
      });
    }
  }

  private trackCompileCompletion(
    kind: "client" | "server",
    sessionEpoch: number,
    compiler: Compiler | MultiCompiler,
  ): void {
    if (!("compilers" in compiler)) {
      compiler.hooks.afterDone.tap("EvjsWebpackDevSession", () => {
        this.finalizeStatsReservation(kind, sessionEpoch);
      });
      return;
    }

    const completedStats = new WeakSet<Stats>();
    let expectedStats: readonly Stats[] | undefined;
    const completeAggregate = () => {
      if (!expectedStats?.every((stats) => completedStats.has(stats))) return;
      expectedStats = undefined;
      this.finalizeStatsReservation(kind, sessionEpoch);
    };
    compiler.hooks.done.tap(
      {
        name: "EvjsWebpackDevSessionComplete",
        stage: Number.POSITIVE_INFINITY,
      },
      (stats) => {
        expectedStats = stats.stats;
        completeAggregate();
      },
    );
    for (const childCompiler of compiler.compilers) {
      childCompiler.hooks.afterDone.tap(
        "EvjsWebpackDevSessionComplete",
        (stats) => {
          completedStats.add(stats);
          completeAggregate();
        },
      );
    }
  }

  private reserveStatsWork(
    kind: "client" | "server",
    sessionEpoch: number,
    buildState: WebpackDevBuildState,
  ): WebpackDevStatsReservation {
    const existing = this.statsReservations.get(kind);
    if (existing) return existing;

    let complete!: (snapshot: WebpackDevStatsSnapshot | undefined) => void;
    const snapshot = new Promise<WebpackDevStatsSnapshot | undefined>(
      (resolve) => {
        complete = resolve;
      },
    );
    const reservation: WebpackDevStatsReservation = {
      buildState,
      sessionEpoch,
      startedCompilers: new WeakSet(),
      complete,
    };
    this.statsReservations.set(kind, reservation);
    void this.enqueueDevWork(async () => {
      const ready = await snapshot;
      if (!ready) return;
      await this.handleStats(kind, reservation.sessionEpoch, buildState, ready);
    }).catch((error) => {
      this.failDevSession(error);
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
  }

  private captureStatsReservation(
    kind: "client" | "server",
    sessionEpoch: number,
    stats: Stats | MultiStats,
    memoryFiles?: Map<string, Buffer>,
  ): void {
    if (sessionEpoch !== this.lifecycleEpoch) return;
    const reservation = this.statsReservations.get(kind);
    if (!reservation) {
      if (this.fatalError) return;
      const error = new Error(
        `[evjs] Webpack ${kind} compilation completed without a session reservation.`,
      );
      this.failDevSession(error);
      logger.error`${error.message}`;
      return;
    }

    try {
      reservation.snapshot = createWebpackDevStatsSnapshot(stats, memoryFiles);
    } catch (error) {
      this.statsReservations.delete(kind);
      reservation.complete(undefined);
      this.failDevSession(error);
      logger.error`Failed to snapshot webpack ${kind} dev build: ${error}`;
      return;
    }
  }

  private finalizeStatsReservation(
    kind: "client" | "server",
    sessionEpoch: number,
  ): void {
    if (sessionEpoch !== this.lifecycleEpoch) return;
    const reservation = this.statsReservations.get(kind);
    if (!reservation) {
      if (this.fatalError) return;
      const error = new Error(
        `[evjs] Webpack ${kind} compilation completed without a captured session snapshot.`,
      );
      this.failDevSession(error);
      logger.error`${error.message}`;
      return;
    }
    this.statsReservations.delete(kind);
    if (!reservation.snapshot) {
      const error = new Error(
        `[evjs] Webpack ${kind} compilation completed without readable stats.`,
      );
      reservation.complete(undefined);
      this.failDevSession(error);
      logger.error`${error.message}`;
      return;
    }
    reservation.complete(reservation.snapshot);
  }

  private failStatsReservation(
    kind: "client" | "server",
    sessionEpoch: number,
    error: unknown,
  ): void {
    if (sessionEpoch !== this.lifecycleEpoch) return;
    const reservation = this.statsReservations.get(kind);
    if (reservation) {
      this.statsReservations.delete(kind);
      reservation.complete(undefined);
    }
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
    sessionEpoch: number,
    buildState: WebpackDevBuildState,
    snapshot: WebpackDevStatsSnapshot,
  ): Promise<void> {
    if (sessionEpoch !== this.lifecycleEpoch) return;
    if (buildState !== this.buildState) return;

    if (snapshot.error) {
      logger.error`${snapshot.error}`;
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
      return;
    }
    const published = result === "published";
    if (published && buildState.serverReadyPending) {
      buildState.serverReadyPending = false;
      await this.ctx.callbacks.onServerBundleReady();
    }
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
    const disposition = await this.ctx.callbacks.onBuildFacts(facts, {
      isRebuild,
    });
    if (disposition === "discarded") return disposition;
    this.hasEmittedDevArtifacts = true;
    return disposition;
  }

  private readClientOwnedFiles(
    buildState: WebpackDevBuildState,
  ): ReadonlySet<string> {
    return new Set(readWebpackEmittedFiles(buildState.latestClientStats) ?? []);
  }

  private failDevSession(error: unknown): void {
    if (this.fatalError) return;
    this.fatalError = error instanceof Error ? error : new Error(String(error));
    this.sessionDone.reject(this.fatalError);
  }

  private async attachClientMiddlewareServer(
    server: ClientDevMiddlewareServerHandle,
  ): Promise<void> {
    if (this.clientMiddlewareServer) {
      await server.close();
      throw new Error(
        "[evjs] Webpack client middleware server was attached more than once.",
      );
    }
    if (this.closePromise) {
      await server.close();
      throw new Error(
        "[evjs] Webpack client middleware server started after the development session began closing.",
      );
    }
    this.clientMiddlewareServer = server;
    void server.failure.catch((error) => this.failDevSession(error));
  }
}

function throwIfWebpackDevAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new Error("[evjs] Webpack development startup was aborted.");
}

function createWebpackDevBuildState(plan: BuildPlan): WebpackDevBuildState {
  return {
    plan,
    latestClientStats: undefined,
    latestServerStats: undefined,
    latestServerMemoryFiles: new Map(),
    latestServerPublicFiles: [],
    serverPublicAssetOwnership: new Map(),
    serverReadyPending: false,
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

function createWebpackCompiler(
  configs: WebpackConfigs,
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

interface WebpackDevServerBinding {
  port: number;
  https: ResolvedConfig<WebpackConfigs>["dev"]["https"];
  publicWebSocket?: {
    https: boolean;
    port: number;
  };
}

function createDevServerOptions(
  config: ResolvedConfig<WebpackConfigs>,
  plan: BuildPlan,
  clientDir: string,
  binding: WebpackDevServerBinding,
): ConstructorParameters<typeof WebpackDevServer>[0] {
  const classifyRequestPath = createFrameworkRequestPathClassifier(plan);

  return {
    host: "0.0.0.0",
    port: binding.port,
    hot: true,
    liveReload: true,
    allowedHosts: "all",
    headers: {
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
    },
    server: createDevServerTransport(binding.https),
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
      ...(binding.publicWebSocket
        ? {
            webSocketURL: {
              hostname: "0.0.0.0",
              port: binding.publicWebSocket.port,
              protocol: binding.publicWebSocket.https ? "wss:" : "ws:",
            },
          }
        : {}),
    },
  };
}

let webpackSelfSignedCertificate:
  | Promise<ClientDevMiddlewareTlsCredentials>
  | undefined;

function createWebpackSelfSignedCertificate(): Promise<ClientDevMiddlewareTlsCredentials> {
  webpackSelfSignedCertificate ??= import("selfsigned").then(
    async ({ generate }) => {
      const certificate = await generate(
        [{ name: "commonName", value: "localhost" }],
        {
          algorithm: "sha256",
          keySize: 2048,
          notAfterDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
          extensions: [
            {
              name: "subjectAltName",
              altNames: [
                { type: 2, value: "localhost" },
                { type: 7, ip: "127.0.0.1" },
              ],
            },
          ],
        },
      );
      return { key: certificate.private, cert: certificate.cert };
    },
  );
  return webpackSelfSignedCertificate;
}

function createDevProxyRules(
  config: ResolvedConfig<WebpackConfigs>,
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
  https: ResolvedConfig<WebpackConfigs>["dev"]["https"],
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

async function runWebpack(configs: WebpackConfigs): Promise<{
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
