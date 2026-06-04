import fs from "node:fs";
import type { ClientRequest } from "node:http";
import path from "node:path";
import type {
  AppGraph,
  BuildPlan,
  BuildPlanUpdate,
  BundlerAdapter,
  BundlerBuildContext,
  BundlerBuildFacts,
  BundlerDevContext,
  BundlerDevController,
  DevProxyRule,
  ResolvedConfig,
} from "@evjs/ev";
import { getLogger } from "@logtape/logtape";
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
  WebpackManifestGenerator,
  type WebpackStatsLike,
} from "../manifest-generator.js";
import { createWebpackConfigs, type WebpackConfig } from "./create-config.js";
import { getOutputPaths } from "./output-paths.js";

const logger = getLogger(["evjs", "bundler-webpack"]);
const DEV_PAGE_RENDER_PROXY_HEADER = "x-evjs-dev-page-render";

interface WebpackDevServerInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface WebpackWatching {
  close(callback: (error: Error | null) => void): void;
}

type WebpackDevProxyRule = DevProxyRule & {
  frameworkPageRender?: boolean;
};

export const webpackAdapter: BundlerAdapter<WebpackConfig> = {
  name: "webpack",

  async build(
    ctx: BundlerBuildContext<WebpackConfig>,
  ): Promise<BundlerBuildFacts> {
    const { config, cwd, graph, hooks, plan } = ctx;
    const outputPaths = getOutputPaths(cwd, config.serverEnabled, plan.distDir);

    logger.info`Building for production with webpack...`;

    await fs.promises.rm(outputPaths.rootDir, {
      recursive: true,
      force: true,
    });

    const configs = await createWebpackConfigs(config, plan, graph, cwd, hooks);
    const stats = await runWebpack(configs);

    await emitStats(outputPaths.clientDir, stats.clientStats);
    if (config.serverEnabled) {
      await emitStats(outputPaths.serverDir, stats.serverStats);
    }

    logger.info`Collecting webpack build facts...`;
    const generator = new WebpackManifestGenerator(
      cwd,
      config.serverEnabled,
      plan,
      stats.clientStats,
      stats.serverStats,
    );

    logger.info`Build complete!`;
    return generator.collectBuildFacts();
  },

  async dev(
    ctx: BundlerDevContext<WebpackConfig>,
  ): Promise<BundlerDevController> {
    const session = new WebpackDevSession(ctx);
    await session.start();
    return session;
  },
};

class WebpackDevSession implements BundlerDevController {
  private config: ResolvedConfig<WebpackConfig>;
  private graph: AppGraph;
  private plan: BuildPlan;
  private clientServer: WebpackDevServerInstance | undefined;
  private serverWatching: WebpackWatching | undefined;
  private latestClientStats: WebpackStatsLike | undefined;
  private latestServerStats: WebpackStatsLike | undefined;
  private serverReadyPending = false;
  private startGeneration = 0;
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
    this.graph = ctx.graph;
    this.plan = ctx.plan;
  }

  async start(): Promise<void> {
    const generation = ++this.startGeneration;
    const outputPaths = getOutputPaths(
      this.ctx.cwd,
      this.config.serverEnabled,
      this.plan.distDir,
    );

    logger.info`Starting development server with webpack...`;

    await fs.promises.rm(outputPaths.rootDir, {
      recursive: true,
      force: true,
    });

    this.latestClientStats = undefined;
    this.latestServerStats = undefined;
    this.serverReadyPending = false;

    const configs = await createWebpackConfigs(
      this.config,
      this.plan,
      this.graph,
      this.ctx.cwd,
      this.ctx.hooks,
    );
    const clientConfigs = configs.filter((config) => config.name === "client");
    const serverConfigs = configs.filter(
      (config) => config.name === "server" || config.name === "server-rsc",
    );
    const needsClient = clientConfigs.length > 0;
    const needsServer = this.config.serverEnabled && serverConfigs.length > 0;
    this.initialDone = createInitialBuildBarrier({ needsClient, needsServer });

    if (needsClient) {
      const compiler = createWebpackCompiler(clientConfigs);
      compiler.hooks.done.tap("EvjsWebpackDevClient", (stats) => {
        void this.handleStats("client", generation, stats).catch((error) => {
          this.failInitialBuild(error);
        });
      });
      this.clientServer = new WebpackDevServer(
        createDevServerOptions(
          this.config,
          this.plan,
          this.graph,
          outputPaths.rootDir,
          outputPaths.clientDir,
        ),
        compiler,
      );
      await this.clientServer.start();
    }

    if (needsServer) {
      const compiler = createWebpackCompiler(serverConfigs);
      compiler.hooks.done.tap("EvjsWebpackDevServer", (stats) => {
        void this.handleStats("server", generation, stats).catch((error) => {
          this.failInitialBuild(error);
        });
      });
      this.serverWatching = compiler.watch({}, (error) => {
        if (error) this.failInitialBuild(error);
      });
    }

    const initialDone = this.initialDone;
    if (!needsClient && !needsServer) {
      initialDone.resolve();
    }

    await initialDone.promise;
  }

  async close(): Promise<void> {
    await this.stop();
  }

  async updatePlan(update: BuildPlanUpdate, graph?: AppGraph): Promise<void> {
    if (!graph) {
      throw new Error(
        "[evjs] webpack dev updates require the next AppGraph to relink manifest and HTML output.",
      );
    }

    const previousPlan = this.plan;
    const previousGraph = this.graph;
    const previousClientStats = this.latestClientStats;
    const previousServerStats = this.latestServerStats;

    this.plan = update.next;
    this.graph = graph;

    try {
      const outputPaths = getOutputPaths(
        this.ctx.cwd,
        this.config.serverEnabled,
        this.plan.distDir,
      );
      if (isHtmlOnlyUpdate(update)) {
        await this.generateDevArtifacts();
        return;
      }

      const incrementalClientEntries = getIncrementalClientEntries(update);
      if (incrementalClientEntries && this.latestClientStats) {
        const incrementalPlan = createIncrementalPlan(
          this.plan,
          incrementalClientEntries,
        );
        const configs = await createWebpackConfigs(
          this.config,
          incrementalPlan,
          this.graph,
          this.ctx.cwd,
          this.ctx.hooks,
          { clean: false },
        );
        const stats = await runWebpack(configs);
        if (stats.clientStats) {
          this.latestClientStats = mergeWebpackStats(
            this.latestClientStats,
            stats.clientStats,
          );
          await emitStats(outputPaths.clientDir, this.latestClientStats);
        }
        await this.generateDevArtifacts();
        return;
      }

      const configs = await createWebpackConfigs(
        this.config,
        this.plan,
        this.graph,
        this.ctx.cwd,
        this.ctx.hooks,
        { clean: false },
      );
      const stats = await runWebpack(configs);

      if (stats.clientStats) {
        this.latestClientStats = stats.clientStats;
        await emitStats(outputPaths.clientDir, this.latestClientStats);
      }
      if (stats.serverStats) {
        this.latestServerStats = stats.serverStats;
        await emitStats(outputPaths.serverDir, this.latestServerStats);
      }

      const emitted = await this.generateDevArtifacts();
      if (emitted && (update.serverChanged || stats.serverStats)) {
        await this.ctx.callbacks.onServerBundleReady();
      }
    } catch (error) {
      this.plan = previousPlan;
      this.graph = previousGraph;
      this.latestClientStats = previousClientStats;
      this.latestServerStats = previousServerStats;
      throw error;
    }
  }

  private async stop(): Promise<void> {
    this.startGeneration++;
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

    if (errors.length > 0) {
      throw errors[0];
    }
  }

  private async handleStats(
    kind: "client" | "server",
    generation: number,
    stats: Stats | MultiStats,
  ): Promise<void> {
    if (generation !== this.startGeneration) return;

    if (stats.hasErrors()) {
      const error = new Error(formatWebpackErrors(stats));
      this.failInitialBuild(error);
      logger.error`${error.message}`;
      return;
    }

    const split = splitStatsByName(stats);
    const outputPaths = getOutputPaths(
      this.ctx.cwd,
      this.config.serverEnabled,
      this.plan.distDir,
    );

    if (kind === "client") {
      this.latestClientStats = split.clientStats
        ? mergeWebpackStats(this.latestClientStats, split.clientStats)
        : this.latestClientStats;
      await emitStats(outputPaths.clientDir, this.latestClientStats);
    } else {
      this.latestServerStats = split.serverStats;
      await emitStats(outputPaths.serverDir, this.latestServerStats);
      this.serverReadyPending = true;
    }

    const emitted = await this.generateDevArtifacts();
    if (emitted) {
      this.completeInitialBuild();
    }
    if (emitted && this.serverReadyPending) {
      this.serverReadyPending = false;
      await this.ctx.callbacks.onServerBundleReady();
    }
  }

  private async generateDevArtifacts(): Promise<boolean> {
    const hasClientEntries = this.plan.entries.some(
      (entry) => entry.environment === "client",
    );
    const hasServerEntries =
      this.config.serverEnabled &&
      this.plan.entries.some((entry) => entry.environment === "server");

    if (hasClientEntries && !this.latestClientStats) return false;
    if (hasServerEntries && !this.latestServerStats) return false;

    logger.info`Generating development manifest and HTML...`;
    const generator = new WebpackManifestGenerator(
      this.ctx.cwd,
      this.config.serverEnabled,
      this.plan,
      this.latestClientStats,
      this.latestServerStats,
    );
    const isRebuild = this.hasEmittedDevArtifacts;
    await this.ctx.callbacks.onBuildFacts(generator.collectBuildFacts(), {
      isRebuild,
    });
    this.hasEmittedDevArtifacts = true;
    return true;
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

function isHtmlOnlyUpdate(update: BuildPlanUpdate): boolean {
  return (
    !update.serverChanged &&
    update.entries.added.length === 0 &&
    update.entries.removed.length === 0 &&
    update.entries.changed.length === 0 &&
    (update.html.added.length > 0 ||
      update.html.removed.length > 0 ||
      update.html.changed.length > 0)
  );
}

function getIncrementalClientEntries(
  update: BuildPlanUpdate,
): BuildPlan["entries"] | undefined {
  if (update.serverChanged || update.entries.removed.length > 0) {
    return undefined;
  }

  const entries = [...update.entries.added, ...update.entries.changed];
  if (entries.length === 0) return undefined;
  if (entries.some((entry) => entry.environment !== "client")) {
    return undefined;
  }

  return entries;
}

function createIncrementalPlan(
  plan: BuildPlan,
  entries: BuildPlan["entries"],
): BuildPlan {
  return {
    ...plan,
    entries,
    html: [],
    server: {
      ...plan.server,
      renderers: [],
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

function createDevServerOptions(
  config: ResolvedConfig<WebpackConfig>,
  plan: BuildPlan,
  graph: AppGraph,
  rootDir: string,
  clientDir: string,
): ConstructorParameters<typeof WebpackDevServer>[0] {
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
    setupMiddlewares(middlewares, devServer) {
      devServer.app?.use((request, response, next) => {
        if (request.url?.split("?")[0] !== "/manifest.json") {
          next();
          return;
        }

        const manifestPath = path.join(rootDir, "manifest.json");
        if (!fs.existsSync(manifestPath)) {
          response.statusCode = 404;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end("manifest not ready");
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(fs.readFileSync(manifestPath));
      });
      return middlewares;
    },
    historyApiFallback: createHistoryFallback(plan, graph),
    proxy: createDevProxyRules(config, graph).map(toWebpackDevProxy),
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
  graph: AppGraph,
): WebpackDevProxyRule[] {
  if (!config.serverEnabled) return config.dev.proxy;

  const serverTarget = `${config.server.dev.https ? "https" : "http"}://localhost:${config.server.dev.port}`;
  const rules = [...config.dev.proxy];
  const configuredContexts = new Set(rules.flatMap((rule) => rule.context));

  const runtimeContexts = createFrameworkRuntimeProxyContexts(
    config,
    graph,
  ).filter((context) => !configuredContexts.has(context));
  if (runtimeContexts.length > 0) {
    rules.push({
      context: runtimeContexts,
      target: serverTarget,
      changeOrigin: true,
      secure: false,
    });
    for (const context of runtimeContexts) {
      configuredContexts.add(context);
    }
  }

  const explicitServerRouteContexts = [
    ...graph.serverRoutes.map((route) => route.path),
    ...Object.values(graph.pages)
      .filter((page) => page.path && page.render !== "csr")
      .map((page) => page.path as string),
  ]
    .map(toDevProxyContext)
    .filter((route): route is string => Boolean(route));
  const contexts = explicitServerRouteContexts.filter(
    (context) => !configuredContexts.has(context),
  );
  if (contexts.length === 0) return rules;

  return [
    ...rules,
    {
      context: contexts,
      target: serverTarget,
      changeOrigin: true,
      secure: false,
      frameworkPageRender: true,
    },
  ];
}

function createFrameworkRuntimeProxyContexts(
  config: ResolvedConfig<WebpackConfig>,
  graph: AppGraph,
): string[] {
  const contexts: string[] = [];

  if (Object.values(graph.pages).some((page) => page.render === "ppr")) {
    contexts.push(joinUrlPath(config.server.basePath, "ppr"));
  }

  return contexts
    .map(toDevProxyContext)
    .filter((context): context is string => Boolean(context));
}

function joinUrlPath(...parts: string[]): string {
  return `/${parts
    .flatMap((part) => part.split("/"))
    .filter(Boolean)
    .join("/")}`;
}

function toDevProxyContext(routePath: string): string | undefined {
  const segments = routePath.split("/").filter(Boolean);
  const staticSegments: string[] = [];

  for (const segment of segments) {
    if (
      segment === "*" ||
      segment.startsWith(":") ||
      segment.startsWith("$") ||
      segment.includes("*")
    ) {
      break;
    }
    staticSegments.push(segment);
  }

  if (staticSegments.length === 0) return undefined;
  return `/${staticSegments.join("/")}`;
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
  graph: AppGraph,
): ConstructorParameters<typeof WebpackDevServer>[0]["historyApiFallback"] {
  const appHtml = plan.html.find((html) => html.owner.appId)?.fileName;
  if (!appHtml) return false;

  const htmlByPageId = new Map(
    plan.html
      .filter((html) => html.owner.pageId)
      .map((html) => [html.owner.pageId as string, html.fileName]),
  );
  const pagePathRewrites = Object.values(graph.pages)
    .filter((page) => page.render === "csr" && page.path)
    .flatMap((page) => {
      const fileName = htmlByPageId.get(page.id);
      return fileName
        ? [
            {
              from: routePathToRegExp(page.path as string),
              to: `/${fileName}`,
            },
          ]
        : [];
    });

  return {
    index: `/${appHtml}`,
    // Keep the default dot rule so stale HMR chunks and asset URLs 404
    // instead of being rewritten to application HTML.
    rewrites: [
      ...plan.html.map((html) => ({
        from: new RegExp(`^/${escapeRegExp(html.fileName)}$`),
        to: `/${html.fileName}`,
      })),
      ...pagePathRewrites,
    ],
  };
}

function routePathToRegExp(routePath: string): RegExp {
  const normalized = normalizeRoutePath(routePath);
  if (normalized === "/") return /^\/?$/;

  const expression = normalized
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (
        segment === "*" ||
        segment.startsWith(":") ||
        segment.startsWith("$")
      ) {
        return "[^/]+";
      }
      if (segment.endsWith("*")) {
        return `${escapeRegExp(segment.slice(0, -1))}.*`;
      }
      return escapeRegExp(segment);
    })
    .join("/");

  return new RegExp(`^/${expression}/?$`);
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
    context: rule.context,
    target: rule.target,
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
}> {
  const compiler = webpack(configs);

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

  return splitStatsByName(stats);
}

function splitStatsByName(stats: Stats | MultiStats): {
  clientStats?: WebpackStatsLike;
  serverStats?: WebpackStatsLike;
} {
  const json = stats.toJson({
    all: false,
    assets: true,
    chunks: true,
    entrypoints: true,
    errors: true,
    modules: true,
    warnings: true,
  }) as WebpackMultiStatsJson | WebpackStatsJson;

  const children = getStatsChildren(json);
  let clientStats: WebpackStatsLike | undefined;
  let serverStats: WebpackStatsLike | undefined;

  for (const child of children) {
    if (child.name === "server" || child.name === "server-rsc") {
      serverStats = mergeWebpackStats(serverStats, child);
    } else if (child.name === "client") {
      clientStats = child;
    }
  }

  return { clientStats, serverStats };
}

function mergeWebpackStats(
  left: WebpackStatsLike | undefined,
  right: WebpackStatsLike,
): WebpackStatsLike {
  if (!left) return right;
  return {
    entrypoints: {
      ...(left.entrypoints ?? {}),
      ...(right.entrypoints ?? {}),
    },
    chunks: [...(left.chunks ?? []), ...(right.chunks ?? [])],
    modules: [...(left.modules ?? []), ...(right.modules ?? [])],
  };
}

function formatWebpackErrors(stats: Stats | MultiStats): string {
  const json = stats.toJson({ all: false, errors: true }) as
    | WebpackMultiStatsJson
    | WebpackStatsJson;
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
  outDir: string,
  stats: WebpackStatsLike | undefined,
): Promise<void> {
  if (!stats) return;
  await fs.promises.mkdir(outDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(outDir, "stats.json"),
    JSON.stringify(stats, null, 2),
    "utf-8",
  );
}

type WebpackStatsJson = WebpackStatsLike & {
  name?: string;
  errors?: Array<string | { message?: string }>;
};

interface WebpackMultiStatsJson {
  children?: WebpackStatsJson[];
}
