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
  ClientRouteTarget,
  DevProxyRule,
  ResolvedConfig,
} from "@evjs/ev";
import { getClientRouteMatches, getServerRenderedPaths } from "@evjs/ev";
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
      await copyServerCssAssetsToClient(
        outputPaths.serverDir,
        outputPaths.clientDir,
        stats.serverStats,
      );
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
        await copyServerCssAssetsToClient(
          outputPaths.serverDir,
          outputPaths.clientDir,
          this.latestServerStats,
        );
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
      await copyServerCssAssetsToClient(
        outputPaths.serverDir,
        outputPaths.clientDir,
        this.latestServerStats,
      );
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

    if (this.config.serverEnabled && this.latestServerStats) {
      const outputPaths = getOutputPaths(
        this.ctx.cwd,
        this.config.serverEnabled,
        this.plan.distDir,
      );
      await copyServerCssAssetsToClient(
        outputPaths.serverDir,
        outputPaths.clientDir,
        this.latestServerStats,
      );
    }

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
      middlewares.push({
        name: "evjs-api-fallback",
        middleware(
          request: DevFallbackRequest,
          response: DevFallbackResponse,
          next: () => void,
        ) {
          const pathname = getRequestPathname(request.url);
          if (!pathname || !isApiLikeRequestPath(pathname, config)) {
            next();
            return;
          }

          response.statusCode = 404;
          if (pathname === "/api" || pathname.startsWith("/api/")) {
            response.setHeader(
              "Content-Type",
              "application/json; charset=utf-8",
            );
            response.end(
              JSON.stringify({
                error: {
                  code: "EVJS_API_NOT_FOUND",
                  message: `No API route matched ${pathname}.`,
                },
              }),
            );
            return;
          }

          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end(`[evjs] No framework route matched ${pathname}.`);
        },
      });
      return middlewares;
    },
    historyApiFallback: createHistoryFallback(config, plan, graph),
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

  const serverRoutePaths = [
    ...graph.serverRoutes.map((route) => route.path),
    ...getServerRenderedPaths(graph),
  ];
  const explicitServerRouteContexts =
    toUniqueDevProxyContexts(serverRoutePaths);
  const contexts = explicitServerRouteContexts.filter(
    (context) => !configuredContexts.has(context),
  );
  const pageRenderRules: WebpackDevProxyRule[] = [];

  if (contexts.length > 0) {
    pageRenderRules.push({
      context: contexts,
      target: serverTarget,
      changeOrigin: true,
      secure: false,
      frameworkPageRender: true,
    });
  }

  if (
    serverRoutePaths.some(
      (routePath) => normalizeRoutePath(routePath) === "/",
    ) &&
    !configuredContexts.has("/")
  ) {
    pageRenderRules.push({
      context: [],
      contextFilter: (pathname) => pathname === "/",
      target: serverTarget,
      changeOrigin: true,
      secure: false,
      frameworkPageRender: true,
    });
  }

  return pageRenderRules.length === 0 ? rules : [...rules, ...pageRenderRules];
}

function createFrameworkRuntimeProxyContexts(
  config: ResolvedConfig<WebpackConfig>,
  graph: AppGraph,
): string[] {
  const contexts: string[] = [];

  if (
    Object.values(graph.pages).some(
      (page) =>
        (typeof page.prerender === "object" &&
          page.prerender.partial === true) ||
        page.ppr,
    )
  ) {
    contexts.push(config.server.runtime.ppr);
  }

  return toUniqueDevProxyContexts(contexts);
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

function toUniqueDevProxyContexts(routePaths: string[]): string[] {
  const contexts = new Set<string>();
  for (const routePath of routePaths) {
    const context = toDevProxyContext(routePath);
    if (context) contexts.add(context);
  }
  return [...contexts];
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
  config: ResolvedConfig<WebpackConfig>,
  plan: BuildPlan,
  graph: AppGraph,
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
      ...createHtmlFallbackBypassRewrites(config),
      ...plan.html.map((html) => ({
        from: new RegExp(`^/${escapeRegExp(html.fileName)}$`),
        to: `/${html.fileName}`,
      })),
      ...createClientRouteRewrites(plan, graph, appHtmlByAppId),
    ],
  };
}

function createClientRouteRewrites(
  plan: BuildPlan,
  graph: AppGraph,
  appHtmlByAppId: Map<string, string>,
): Array<{ from: RegExp; to: string }> {
  const htmlByPageId = new Map(
    plan.html
      .filter((html) => html.owner.pageId)
      .map((html) => [html.owner.pageId as string, html.fileName]),
  );

  return getClientRouteMatches(graph).flatMap(({ path, target }) => {
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
  target: ClientRouteTarget,
  htmlByPageId: Map<string, string>,
  appHtmlByAppId: Map<string, string>,
): string | undefined {
  if (target.kind === "page") {
    return htmlByPageId.get(target.pageId);
  }

  return appHtmlByAppId.get(target.appId);
}

function createHtmlFallbackBypassRewrites(
  config: ResolvedConfig<WebpackConfig>,
): Array<{
  from: RegExp;
  to: (ctx: { parsedUrl: { pathname?: string | null } }) => string;
}> {
  return [
    /^\/api(?:\/|$)/,
    ...getFrameworkRuntimePaths(config).map(
      (runtimePath) => new RegExp(`^${escapeRegExp(runtimePath)}(?:/|$)`),
    ),
  ].map((from) => ({
    from,
    to(ctx) {
      return ctx.parsedUrl.pathname || "/";
    },
  }));
}

function isApiLikeRequestPath(
  pathname: string,
  config: ResolvedConfig<WebpackConfig>,
): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;

  return getFrameworkRuntimePaths(config).some(
    (runtimePath) =>
      pathname === runtimePath || pathname.startsWith(`${runtimePath}/`),
  );
}

function getFrameworkRuntimePaths(
  config: ResolvedConfig<WebpackConfig>,
): string[] {
  const runtime = config.server.runtime;
  const paths = [
    runtime.basePath,
    runtime.fn,
    runtime.ppr,
    ...(runtime.rsc ? [runtime.rsc] : []),
  ];
  return [...new Set(paths.map(normalizeRoutePath))];
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
    context: rule.contextFilter ?? rule.context,
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
      serverStats = mergeWebpackStats(serverStats, child, child.name);
    } else if (child.name === "client") {
      clientStats = child;
    }
  }

  return { clientStats, serverStats };
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
    entrypoints: {
      ...(left.entrypoints ?? {}),
      ...(namespacedRight.entrypoints ?? {}),
    },
    chunks: [...(left.chunks ?? []), ...(namespacedRight.chunks ?? [])],
    modules,
  };
}

function namespaceWebpackStats(
  stats: WebpackStatsLike,
  childName?: string,
): WebpackStatsLike {
  if (childName !== "server-rsc") return stats;
  const prefixChunk = (value: string | number) => `${childName}:${value}`;

  return {
    ...stats,
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

export const __testing = {
  createDevProxyRules,
  createHtmlFallbackBypassRewrites,
  isApiLikeRequestPath,
  mergeWebpackStats,
};

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

async function copyServerCssAssetsToClient(
  serverDir: string,
  clientDir: string,
  stats: WebpackStatsLike | undefined,
): Promise<void> {
  const cssAssets = new Set<string>();
  for (const entry of Object.values(stats?.entrypoints ?? {})) {
    for (const asset of entry.assets ?? []) {
      const name = typeof asset === "string" ? asset : asset.name;
      if (name?.endsWith(".css")) cssAssets.add(name.replace(/^\.\//, ""));
    }
  }

  for (const asset of cssAssets) {
    const source = path.join(serverDir, asset);
    if (!(await waitForFile(source))) continue;
    const target = path.join(clientDir, asset);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(source, target);
  }
}

async function waitForFile(file: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (fs.existsSync(file)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return fs.existsSync(file);
}

type WebpackStatsJson = WebpackStatsLike & {
  name?: string;
  errors?: Array<string | { message?: string }>;
};

interface WebpackMultiStatsJson {
  children?: WebpackStatsJson[];
}
