import fs from "node:fs/promises";
import https from "node:https";
import net, { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BundlerBuildFacts } from "@evjs/ev/_internal/build";
import {
  buildHtml,
  createBuildPlan,
  createCoreGraph,
  generateHtml,
  materializeFrameworkIR,
} from "@evjs/ev/_internal/build";
import type { Config, ResolvedConfig } from "@evjs/ev/config";
import { resolveConfig } from "@evjs/ev/config";
import type { PluginHooks } from "@evjs/ev/plugin";
import type { BuildOutput, BuildPlan, CoreGraph } from "@evjs/shared/manifest";
import {
  assertFrameworkManifestShape,
  createDeploymentMetadata,
  linkBuildOutput,
} from "@evjs/shared/manifest";
import { Volume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Compiler } from "webpack";
import { withPageRoutingDefaults } from "../../ev/esm/_internal/build/convention-config.js";
import { linkAndEmitBuildOutput } from "../../ev/src/_internal/build/framework-output.js";
import {
  createClientRuntime,
  createFrameworkRuntime,
  type FrameworkRuntimeOutput,
} from "../../ev/src/_internal/build/framework-runtime.js";
import type { WebpackConfigs } from "../src/adapter/create-config.js";
import { __testing as webpackAdapterTesting } from "../src/adapter/index.js";
import { __testing as serverPublicAssetTesting } from "../src/adapter/server-public-assets.js";
import { webpackAdapter } from "../src/index.js";
import {
  WebpackManifestGenerator,
  type WebpackStatsLike,
} from "../src/manifest-generator.js";

const tempDirs: string[] = [];
const WEBPACK_BUILD_TEST_TIMEOUT = 20_000;
const WEBPACK_DEV_TEST_TIMEOUT = 20_000;
const WEBPACK_DEV_PORT_BASE = 31_000 + (process.pid % 1_000) * 10;
const WEBPACK_DEV_TEST_NAMES = {
  starts: "starts webpack dev and emits framework manifest/html",
  unclaimedApiFallback: "serves unclaimed paths through SPA fallback",
  concurrentDone:
    "serializes concurrent client and server dev completion callbacks",
} as const;
const CLIENT_RUNTIME_SCRIPT_ID = "__EVJS_CLIENT_RUNTIME__";
const allocatedDevPorts = new Set<number>();

type ServerRuntimeGlobals = typeof globalThis & {
  __EVJS_FRAMEWORK_RUNTIME__?: FrameworkRuntimeOutput;
  __EVJS_SERVER_MODULE_LOADER__?: (
    asset: string,
  ) => Promise<Record<string, unknown>>;
};

const frameworkRuntimeByOutput = new WeakMap<
  BuildOutput,
  FrameworkRuntimeOutput
>();

function devIt(name: string, run: () => void | Promise<void>) {
  it(name, run, WEBPACK_DEV_TEST_TIMEOUT);
}

async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function buildIt(name: string, run: () => void | Promise<void>) {
  it(name, run, WEBPACK_BUILD_TEST_TIMEOUT);
}

function getSinglePprRegionId(
  regions: Record<string, unknown> | undefined,
): string {
  const ids = Object.keys(regions ?? {});
  expect(ids).toHaveLength(1);
  const [id] = ids;
  expect(id).toMatch(/^region_[0-9a-f]{12}$/);
  return id as string;
}

async function resolveProjectConfig(
  cwd: string,
  config: Config<WebpackConfigs>,
): Promise<ResolvedConfig<WebpackConfigs>> {
  return withPageRoutingDefaults(resolveConfig(config), config, cwd);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      }),
    ),
  );
});

async function createFixture(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-webpack-"));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf-8");
  }

  await fs.symlink(
    path.resolve(import.meta.dirname, "../../..", "node_modules"),
    path.join(dir, "node_modules"),
    "dir",
  );

  return dir;
}

async function getAvailablePort(): Promise<number> {
  for (let offset = 0; offset < 1_000; offset++) {
    const port = WEBPACK_DEV_PORT_BASE + offset;
    if (allocatedDevPorts.has(port)) continue;
    if (await canListenOnPort(port)) {
      allocatedDevPorts.add(port);
      return port;
    }
  }

  throw new Error("Failed to allocate a webpack dev test port.");
}

async function canListenOnPort(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE" || code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen(port, "0.0.0.0", () => {
      server.close(() => resolve(true));
    });
  });
}

function openWebpackWebSocket(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let response = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out waiting for webpack WebSocket upgrade."));
    }, 5_000);
    timeout.unref();
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString();
      if (!response.includes("101 Switching Protocols")) return;
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("connect", () => {
      socket.write(
        [
          "GET /ws HTTP/1.1",
          `Host: 127.0.0.1:${port}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });
  });
}

function waitForSocketClose(socket: net.Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket shutdown.")),
      5_000,
    );
    timeout.unref();
    socket.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

interface DevResponse {
  status: number;
  headers: Headers;
  text: string;
}

async function fetchDevResponse(
  url: string,
  init?: RequestInit,
): Promise<DevResponse> {
  let lastError: unknown;

  const maxAttempts = 20;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init);
      const text = await response.text();
      if (!text) {
        throw new Error(
          `Empty webpack dev response from ${url} after attempt ${attempt}.`,
        );
      }
      return {
        status: response.status,
        headers: response.headers,
        text,
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw lastError;
}

async function fetchDevText(url: string): Promise<string> {
  const response = await fetchDevResponse(url);
  return response.text;
}

function fetchInsecureHttpsText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { rejectUnauthorized: false },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8")),
        );
        response.once("error", reject);
      },
    );
    request.once("error", reject);
  });
}

function readEmbeddedClientRuntime(html: string): unknown {
  const match = html.match(
    /<script\b(?=[^>]*\bid="__EVJS_CLIENT_RUNTIME__")(?=[^>]*\btype="application\/json")[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) {
    throw new Error("Expected embedded client runtime script.");
  }
  return JSON.parse(match[1]);
}

async function requestServerEntry(
  cwd: string,
  manifest: BuildOutput,
  pathname: string,
): Promise<Response> {
  const serverEntryPath = path.join(
    cwd,
    "dist/server",
    manifest.server?.entry ?? "",
  );
  const serverDir = path.dirname(serverEntryPath);
  const frameworkRuntime =
    frameworkRuntimeByOutput.get(manifest) ?? createFrameworkRuntime(manifest);
  const runtimeGlobals = globalThis as ServerRuntimeGlobals;
  runtimeGlobals.__EVJS_FRAMEWORK_RUNTIME__ = frameworkRuntime;
  runtimeGlobals.__EVJS_SERVER_MODULE_LOADER__ = async (asset: string) => {
    const mod = await import(
      pathToFileURL(path.resolve(serverDir, asset)).href
    );
    const nested =
      mod && typeof mod.default === "object" ? mod.default : undefined;
    return nested && ("default" in nested || "render" in nested) ? nested : mod;
  };

  try {
    const serverModule = await import(pathToFileURL(serverEntryPath).href);
    const handler =
      serverModule.default?.default ?? serverModule.default ?? serverModule;
    return await handler.fetch(new Request(`https://example.com${pathname}`));
  } finally {
    delete runtimeGlobals.__EVJS_FRAMEWORK_RUNTIME__;
    delete runtimeGlobals.__EVJS_SERVER_MODULE_LOADER__;
  }
}

async function buildWithFrameworkArtifacts(options: {
  config: ResolvedConfig<WebpackConfigs>;
  cwd: string;
  graph: CoreGraph;
  plan: BuildPlan;
  hooks?: PluginHooks<WebpackConfigs>[];
  onBuildOutput?: (output: BuildOutput) => void | Promise<void>;
}) {
  const hooks = options.hooks ?? [];
  const plan = await materializeTestPlan({
    config: options.config,
    cwd: options.cwd,
    graph: options.graph,
    plan: options.plan,
  });
  const buildFacts = await webpackAdapter.build({
    config: options.config,
    cwd: options.cwd,
    plan,
    hooks,
  });
  return emitFrameworkArtifacts({
    ...options,
    plan,
    hooks,
    facts: buildFacts,
  });
}

async function materializeTestPlan(options: {
  config: ResolvedConfig<WebpackConfigs>;
  cwd: string;
  graph: CoreGraph;
  plan: BuildPlan;
  write?: boolean;
}): Promise<BuildPlan> {
  return materializeFrameworkIR({
    cwd: options.cwd,
    mode: options.plan.mode,
    config: options.config,
    graph: options.graph,
    plan: options.plan,
    plugins: [],
    write: options.write,
    pluginContext: {
      mode: options.plan.mode,
      cwd: options.cwd,
      config: options.config,
      logger: console as never,
      addWatchFile() {},
    },
  });
}

function createFrameworkCallbacks(options: {
  config: ResolvedConfig<WebpackConfigs>;
  cwd: string;
  graph: CoreGraph;
  plan: BuildPlan;
  hooks?: PluginHooks<WebpackConfigs>[];
  onBuildOutput?: (output: BuildOutput) => void | Promise<void>;
  onServerBundleReady?: () => Promise<void>;
}) {
  let graph = options.graph;
  let plan = options.plan;
  const hooks = options.hooks ?? [];

  return {
    update(nextGraph: CoreGraph, nextPlan: BuildPlan) {
      graph = nextGraph;
      plan = nextPlan;
    },
    callbacks: {
      async onBuildFacts(
        facts: BundlerBuildFacts,
        callbackOptions: { isRebuild: boolean },
      ) {
        await emitFrameworkArtifacts({
          config: options.config,
          cwd: options.cwd,
          graph,
          plan,
          hooks,
          facts,
          onBuildOutput: options.onBuildOutput,
          isRebuild: callbackOptions.isRebuild,
        });
        return "published" as const;
      },
      onServerBundleReady:
        options.onServerBundleReady ??
        (async () => {
          // no-op
        }),
    },
  };
}

async function emitFrameworkArtifacts(options: {
  config: ResolvedConfig<WebpackConfigs>;
  cwd: string;
  graph: CoreGraph;
  plan: BuildPlan;
  hooks: PluginHooks<WebpackConfigs>[];
  facts: BundlerBuildFacts;
  onBuildOutput?: (output: BuildOutput) => void | Promise<void>;
  isRebuild?: boolean;
}): Promise<BuildOutput> {
  const output = linkBuildOutput({
    graph: options.graph,
    plan: options.plan,
    clientEntryAssets: options.facts.clientEntryAssets,
    serverEntryAssets: options.facts.serverEntryAssets,
  });
  const frameworkRuntime = createFrameworkRuntime(output, {
    rscManifests: options.facts.rscManifests,
  });
  frameworkRuntimeByOutput.set(output, frameworkRuntime);
  await options.onBuildOutput?.(output);

  const rootDir = path.join(options.cwd, options.plan.distDir);
  const clientDir = path.resolve(options.cwd, options.plan.output.clientDir);
  await fs.mkdir(rootDir, { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "deployment-metadata.json"),
    JSON.stringify(createDeploymentMetadata(output), null, 2),
    "utf-8",
  );
  await fs.mkdir(clientDir, { recursive: true });
  for (const html of options.plan.html) {
    const pageId = html.owner.pageId;
    const appId = html.owner.appId;
    const assets = pageId
      ? output.pages[pageId]?.assets
      : appId
        ? output.apps[appId]?.assets
        : undefined;
    if (!assets) continue;

    const doc = generateHtml({
      template: path.resolve(options.cwd, html.template),
      js: assets.js,
      css: assets.css,
    });
    doc.documentElement?.setAttribute("data-evjs-build", output.buildId);
    if (pageId) {
      doc.documentElement?.setAttribute("data-evjs-kind", "page");
      doc.documentElement?.setAttribute("data-evjs-id", pageId);
    } else if (appId) {
      doc.documentElement?.setAttribute("data-evjs-kind", "app");
      doc.documentElement?.setAttribute("data-evjs-id", appId);
    }
    embedClientRuntime(doc, output);

    const finalHtml = await buildHtml({
      doc,
      hooks: options.hooks,
      pluginContext: {
        mode: options.plan.mode,
        cwd: options.cwd,
        config: options.config,
        logger: console as never,
        addWatchFile() {},
      },
      html: {
        documentId: html.id,
        applicationId: appId ?? "default",
        owner: pageId ? { kind: "page", pageId } : { kind: "application" },
        template: html.template,
        fileName: html.fileName,
        assets,
      },
      output,
      isRebuild: options.isRebuild,
    });

    const outPath = path.join(clientDir, html.fileName);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, finalHtml, "utf-8");
  }

  return output;
}

function embedClientRuntime(
  doc: ReturnType<typeof generateHtml>,
  output: BuildOutput,
): void {
  const body = doc.body ?? doc.querySelector("body");
  if (!body) return;
  const json = JSON.stringify(createClientRuntime(output)).replace(
    /</g,
    "\\u003c",
  );
  const script = doc.createElement("script");
  script.id = CLIENT_RUNTIME_SCRIPT_ID;
  script.setAttribute("type", "application/json");
  script.textContent = json;
  const firstScript = body.querySelector("script[src]");
  if (firstScript) {
    body.insertBefore(script, firstScript);
    return;
  }
  body.appendChild(script);
}

function createPrototypeEntryPlan(
  entryName: string,
  environment: "client" | "server",
): BuildPlan {
  return {
    version: 1,
    buildId: `prototype-entry-${environment}`,
    mode: "production",
    distDir: "dist",
    output: {
      clientDir: "dist/client",
      serverDir: "dist/server",
    },
    entries: [
      environment === "client"
        ? {
            name: entryName,
            import: "./src/client.ts",
            environment,
            runtime: "browser",
            kind: "app-client",
          }
        : {
            name: entryName,
            import: "./src/server.ts",
            environment,
            runtime: "node",
            kind: "server-runtime",
          },
    ],
    html: [],
    server: environment === "server" ? { entry: "./src/server.ts" } : {},
    runtime: {
      publicPath: "/",
      server: { basePath: "/__evjs", fn: "__evjs/fn" },
    },
    dev: {
      clientRoutes: [],
      serverRequestRoutePaths: [],
      serverRenderedPagePaths: [],
      hasPpr: false,
    },
  };
}

describe("webpack stats ownership", () => {
  it.each([
    "__proto__",
    "constructor",
    "toString",
  ])("preserves the prototype-shaped stats entrypoint %s", (entryName) => {
    const clientAsset = `${entryName}.js`;
    const clientFacts = new WebpackManifestGenerator(
      process.cwd(),
      createPrototypeEntryPlan(entryName, "client"),
      {
        entrypoints: Object.fromEntries([
          [entryName, { assets: [clientAsset] }],
        ]),
      },
    ).collectBuildFacts();
    const serverAsset = `${entryName}.cjs`;
    const serverFacts = new WebpackManifestGenerator(
      process.cwd(),
      createPrototypeEntryPlan(entryName, "server"),
      undefined,
      {
        assets: [serverAsset],
        entrypoints: Object.fromEntries([
          [entryName, { assets: [serverAsset] }],
        ]),
      },
    ).collectBuildFacts();

    expect(Object.getPrototypeOf(clientFacts.clientEntryAssets)).toBe(
      Object.prototype,
    );
    expect(Object.hasOwn(clientFacts.clientEntryAssets ?? {}, entryName)).toBe(
      true,
    );
    expect(Reflect.get(clientFacts.clientEntryAssets ?? {}, entryName)).toEqual(
      { js: [clientAsset], css: [] },
    );
    expect(Object.getPrototypeOf(serverFacts.serverEntryAssets)).toBe(
      Object.prototype,
    );
    expect(Object.hasOwn(serverFacts.serverEntryAssets ?? {}, entryName)).toBe(
      true,
    );
    expect(Reflect.get(serverFacts.serverEntryAssets ?? {}, entryName)).toEqual(
      { js: [serverAsset], css: [] },
    );
  });

  it("bypasses only BuildPlan-owned routes and runtime endpoints", () => {
    const config = resolveConfig<WebpackConfigs>({
      server: {
        basePath: "/_ev",
        rsc: {
          endpoint: "/flight",
        },
      },
    });
    const plan: BuildPlan = {
      version: 1,
      buildId: "test",
      mode: "development",
      distDir: "dist",
      output: {
        clientDir: "dist/client",
        serverDir: "dist/server",
      },
      entries: [],
      html: [],
      server: {},
      runtime: {
        publicPath: "/",
        server: {
          basePath: config.server.basePath,
          fn: config.server.runtime.fn,
          ppr: "_ev/ppr",
          rsc: config.server.runtime.rsc,
        },
      },
      dev: {
        clientRoutes: [],
        serverRequestRoutePaths: ["/service/:id"],
        serverRenderedPagePaths: ["/reports/:reportId"],
        hasPpr: true,
      },
    };
    const rewrites =
      webpackAdapterTesting.createHtmlFallbackBypassRewrites(plan);
    const findBypass = (pathname: string) =>
      rewrites
        .find((rewrite) => rewrite.from.test(pathname))
        ?.to({ parsedUrl: { pathname } });

    expect(findBypass("/api/users")).toBeUndefined();
    expect(findBypass("/service/42")).toBe("/service/42");
    expect(findBypass("/service/42/details")).toBeUndefined();
    expect(findBypass("/reports/q2")).toBe("/reports/q2");
    expect(findBypass("/reports/q2/details")).toBeUndefined();
    expect(findBypass("/_ev/fn")).toBe("/_ev/fn");
    expect(findBypass("/%5F%65%76/%66%6E")).toBe("/%5F%65%76/%66%6E");
    expect(findBypass("/_ev/fn/child")).toBeUndefined();
    expect(findBypass("/_ev/ppr/campaign/offer")).toBe(
      "/_ev/ppr/campaign/offer",
    );
    expect(findBypass("/%5F%65%76/%70%70%72/campaign/offer")).toBe(
      "/%5F%65%76/%70%70%72/campaign/offer",
    );
    expect(findBypass("/flight")).toBe("/flight");
    expect(findBypass("/%66%6C%69%67%68%74")).toBe("/%66%6C%69%67%68%74");
    expect(findBypass("/flight/page")).toBeUndefined();
    expect(findBypass("/_ev/unclaimed")).toBeUndefined();
    expect(findBypass("/dashboard")).toBeUndefined();
    expect(
      webpackAdapterTesting.isFrameworkRuntimeRequestPath("/flight", plan),
    ).toBe(true);
    expect(
      webpackAdapterTesting.isFrameworkRuntimeRequestPath(
        "/%66%6C%69%67%68%74",
        plan,
      ),
    ).toBe(true);
    expect(
      webpackAdapterTesting.isFrameworkRuntimeRequestPath("/dashboard", plan),
    ).toBe(false);
    expect(
      webpackAdapterTesting.isServerRequestRoutePath("/service/42", plan),
    ).toBe(true);
    expect(
      webpackAdapterTesting.isServerRequestRoutePath("/api/users", plan),
    ).toBe(false);
    expect(
      webpackAdapterTesting.classifyFrameworkRequestPath("/service/42", plan),
    ).toBe("server-request-route");
    expect(
      webpackAdapterTesting.classifyFrameworkRequestPath("/reports/q2", plan),
    ).toBe("server-rendered-page");
    expect(
      webpackAdapterTesting.classifyFrameworkRequestPath("/flight", plan),
    ).toBe("runtime");
    expect(
      webpackAdapterTesting.classifyFrameworkRequestPath("/flight/child", plan),
    ).toBeUndefined();
    const runtimeProxy = webpackAdapterTesting
      .createDevProxyRules(config, plan)
      .find((rule) => rule.contextFilter?.("/%5F%65%76/%66%6E"));
    expect(runtimeProxy?.contextFilter?.("/%5F%65%76/%66%6E")).toBe(true);
    expect(
      runtimeProxy?.contextFilter?.("/%5F%65%76/%70%70%72/campaign/offer"),
    ).toBe(true);
    expect(runtimeProxy?.contextFilter?.("/%66%6C%69%67%68%74")).toBe(true);
    expect(runtimeProxy?.contextFilter?.("/%5F%65%76/%66%6E/child")).toBe(
      false,
    );
    expect(
      webpackAdapterTesting.createFrameworkNotFoundResponse(
        "/service/42",
        "server-request-route",
      ),
    ).toEqual({
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        error: {
          code: "EVJS_API_NOT_FOUND",
          message: "No API route matched /service/42.",
        },
      }),
    });
    expect(
      webpackAdapterTesting.createFrameworkNotFoundResponse(
        "/reports/q2",
        "server-rendered-page",
      ),
    ).toEqual({
      contentType: "text/plain; charset=utf-8",
      body: "[evjs] No framework route matched /reports/q2.",
    });
  });

  it("proxies a server-rendered root route without catching every asset", () => {
    const config = resolveConfig<WebpackConfigs>();
    const plan: BuildPlan = {
      version: 1,
      buildId: "test",
      mode: "development",
      distDir: "dist",
      output: {
        clientDir: "dist/client",
        serverDir: "dist/server",
      },
      entries: [],
      html: [],
      server: {},
      runtime: {
        publicPath: "/",
        server: {
          basePath: config.server.basePath,
          fn: config.server.runtime.fn,
        },
      },
      dev: {
        clientRoutes: [],
        serverRequestRoutePaths: [],
        serverRenderedPagePaths: ["/"],
        hasPpr: false,
      },
    };

    const rules = webpackAdapterTesting.createDevProxyRules(config, plan);
    const rootRule = rules.find((rule) => rule.frameworkPageRender);

    expect(rootRule?.frameworkPageRender).toBe(true);
    expect(rootRule?.contextFilter?.("/")).toBe(true);
    expect(rootRule?.contextFilter?.("/favicon.ico")).toBe(false);
  });

  it("proxies a dynamic root request route without swallowing deeper SPA paths", () => {
    const config = resolveConfig<WebpackConfigs>();
    const plan: BuildPlan = {
      version: 1,
      buildId: "test",
      mode: "development",
      distDir: "dist",
      output: {
        clientDir: "dist/client",
        serverDir: "dist/server",
      },
      entries: [],
      html: [],
      server: {},
      runtime: {
        publicPath: "/",
        server: {
          basePath: config.server.basePath,
          fn: config.server.runtime.fn,
        },
      },
      dev: {
        clientRoutes: [],
        serverRequestRoutePaths: ["/:tenantId"],
        serverRenderedPagePaths: [],
        hasPpr: false,
      },
    };

    const rules = webpackAdapterTesting.createDevProxyRules(config, plan);
    const requestRouteRule = rules.find(
      (rule) =>
        !rule.frameworkPageRender && rule.contextFilter?.("/acme") === true,
    );

    expect(requestRouteRule?.contextFilter?.("/acme")).toBe(true);
    expect(requestRouteRule?.contextFilter?.("/acme/settings")).toBe(false);
    expect(requestRouteRule?.frameworkPageRender).toBeUndefined();
  });

  it("merges server entrypoint facts without module-stat ownership", () => {
    const serverStats: WebpackStatsLike = {
      assets: ["server.cjs"],
      entrypoints: {
        server: {
          assets: ["server.cjs"],
        },
      },
    };
    const rscStats: WebpackStatsLike = {
      assets: ["insights-rsc.cjs"],
      entrypoints: {
        "insights-rsc": {
          assets: ["insights-rsc.cjs"],
        },
      },
    };

    const merged = webpackAdapterTesting.mergeWebpackStats(
      serverStats,
      rscStats,
      "server-rsc",
    );

    expect(merged.assets).toEqual(["server.cjs", "insights-rsc.cjs"]);
    expect(merged.entrypoints).toEqual({
      server: { assets: ["server.cjs"] },
      "insights-rsc": { assets: ["insights-rsc.cjs"] },
    });
  });

  it("reports complete portable asset inventories exposed by webpack stats", () => {
    const plan: BuildPlan = {
      version: 1,
      buildId: "inventory",
      mode: "development",
      distDir: "dist",
      output: {
        clientDir: "dist/client",
        serverDir: "dist/server",
      },
      entries: [
        {
          name: "main",
          import: "./src/main.ts",
          environment: "client",
          runtime: "browser",
          kind: "app-client",
        },
        {
          name: "server",
          import: "./src/server.ts",
          environment: "server",
          runtime: "node",
          kind: "server-runtime",
        },
      ],
      html: [],
      server: { entry: "./src/server.ts" },
      runtime: {
        publicPath: "/",
        server: { basePath: "/__evjs", fn: "__evjs/fn" },
      },
      dev: {
        clientRoutes: [],
        serverRequestRoutePaths: [],
        serverRenderedPagePaths: [],
        hasPpr: false,
      },
    };
    const facts = new WebpackManifestGenerator(
      process.cwd(),
      plan,
      {
        assets: [
          { name: "./main.js" },
          {
            name: "./main.refresh.js",
            info: { hotModuleReplacement: true },
          },
          { name: "chunks/lazy.js" },
          { name: "assets/logo.svg" },
        ],
        entrypoints: {
          main: { assets: ["main.js", "main.refresh.js"] },
        },
      },
      {
        assets: [{ name: "./server.cjs" }, { name: "server.css" }],
        entrypoints: {
          server: { assets: ["server.cjs", "server.css"] },
        },
      },
    ).collectBuildFacts();

    expect(facts.emittedFiles).toEqual({
      client: [
        "main.js",
        "main.refresh.js",
        "chunks/lazy.js",
        "assets/logo.svg",
        "server.css",
        "stats.json",
      ],
      server: ["server.cjs", "server.css", "stats.json"],
    });
    expect(facts.clientEntryAssets).toEqual({
      main: { js: ["main.js"], css: [] },
    });

    const unmarkedSuffixFacts = new WebpackManifestGenerator(
      process.cwd(),
      plan,
      {
        assets: [{ name: "main.hot-update.js" }],
        entrypoints: { main: { assets: ["main.hot-update.js"] } },
      },
      {
        assets: [{ name: "server.cjs" }],
        entrypoints: { server: { assets: ["server.cjs"] } },
      },
    ).collectBuildFacts();
    expect(unmarkedSuffixFacts.clientEntryAssets).toEqual({
      main: { js: ["main.hot-update.js"], css: [] },
    });

    expect(() =>
      new WebpackManifestGenerator(
        process.cwd(),
        plan,
        { assets: ["main.js"], entrypoints: { main: { assets: ["main.js"] } } },
        {
          assets: ["server.cjs", "chunks/lazy.cjs"],
          entrypoints: { server: { assets: ["server.cjs"] } },
        },
      ).collectBuildFacts(),
    ).toThrow(
      'Webpack runtime server stats emitted unowned JavaScript asset "chunks/lazy.cjs"',
    );

    expect(() =>
      new WebpackManifestGenerator(
        process.cwd(),
        plan,
        { assets: ["main.js"], entrypoints: { main: { assets: ["main.js"] } } },
        { entrypoints: { server: { assets: ["server.cjs"] } } },
      ).collectBuildFacts(),
    ).toThrow(
      "Webpack runtime server stats must provide a complete emitted asset inventory",
    );

    expect(() =>
      new WebpackManifestGenerator(process.cwd(), plan, undefined, {
        entrypoints: { server: { assets: ["server.cjs"] } },
      }).collectBuildFacts(),
    ).toThrow(
      'Webpack client stats do not identify client BuildPlan entrypoint "main" uniquely',
    );
    expect(() =>
      new WebpackManifestGenerator(process.cwd(), plan, {
        entrypoints: {
          renderer: { assets: ["renderer.js"] },
          vendor: { assets: ["vendor.js"] },
        },
      }).collectBuildFacts(),
    ).toThrow(
      'Webpack client stats do not identify client BuildPlan entrypoint "main" uniquely',
    );
    expect(() =>
      new WebpackManifestGenerator(
        process.cwd(),
        plan,
        { entrypoints: { main: { assets: ["main.js"] } } },
        {
          entrypoints: {
            renderer: { assets: ["renderer.cjs"] },
            plugin: { assets: ["plugin.cjs"] },
          },
        },
      ).collectBuildFacts(),
    ).toThrow(
      'Webpack server stats do not identify server BuildPlan entrypoint "server" exactly',
    );
    expect(() =>
      new WebpackManifestGenerator(
        process.cwd(),
        plan,
        {
          entrypoints: {
            main: { assets: ["runtime.js", "vendor.js"] },
          },
        },
        {
          assets: ["server.cjs"],
          entrypoints: { server: { assets: ["server.cjs"] } },
        },
      ).collectBuildFacts(),
    ).toThrow(
      'client BuildPlan entry "main" do not identify one JavaScript entry asset',
    );

    expect(() =>
      new WebpackManifestGenerator(
        process.cwd(),
        plan,
        {
          assets: ["assets", "assets-extra.js", "assets/main.js"],
          entrypoints: { main: { assets: ["assets/main.js"] } },
        },
        {
          assets: ["server.cjs"],
          entrypoints: { server: { assets: ["server.cjs"] } },
        },
      ).collectBuildFacts(),
    ).toThrow(
      'Bundler emittedFiles.client asset "assets/main.js" conflicts with "assets"',
    );
    expect(() =>
      new WebpackManifestGenerator(
        process.cwd(),
        plan,
        {
          assets: ["chunks/Foo.js", "chunks/foo.js"],
          entrypoints: { main: { assets: ["chunks/Foo.js"] } },
        },
        {
          assets: ["server.cjs"],
          entrypoints: { server: { assets: ["server.cjs"] } },
        },
      ).collectBuildFacts(),
    ).toThrow(
      'Bundler emittedFiles.client asset "chunks/foo.js" conflicts with "chunks/Foo.js"',
    );
    for (const statsAsset of ["stats.json", "STATS.json"]) {
      expect(() =>
        new WebpackManifestGenerator(
          process.cwd(),
          plan,
          {
            assets: ["main.js", statsAsset],
            entrypoints: { main: { assets: ["main.js"] } },
          },
          {
            assets: ["server.cjs"],
            entrypoints: { server: { assets: ["server.cjs"] } },
          },
        ).collectBuildFacts(),
      ).toThrow(
        `Webpack emitted asset "${statsAsset}" conflicts with adapter-owned "stats.json"`,
      );
    }
  });

  it("omits build-only memfs assets from the physical server inventory", () => {
    const merged = webpackAdapterTesting.mergeWebpackStats(
      {
        assets: ["server.cjs"],
        entrypoints: { server: { assets: ["server.cjs"] } },
      },
      {
        assets: ["page-server.cjs"],
        entrypoints: {
          "page-server": { assets: ["page-server.cjs"] },
        },
      },
      "server-build",
    );

    expect(merged.assets).toEqual(["server.cjs"]);
    expect(merged.entrypoints).toEqual({
      server: { assets: ["server.cjs"] },
      "page-server": { assets: ["page-server.cjs"] },
    });
    const plan: BuildPlan = {
      version: 1,
      buildId: "mixed-server-roots",
      mode: "production",
      distDir: "dist",
      output: { clientDir: "dist/client", serverDir: "dist/server" },
      entries: [
        {
          name: "server",
          import: "./src/server.ts",
          environment: "server",
          runtime: "node",
          kind: "server-runtime",
        },
        {
          name: "page-server",
          import: "./src/build-page.ts",
          environment: "server",
          runtime: "node",
          phase: "build",
          kind: "page-server",
        },
      ],
      html: [],
      server: { entry: "./src/server.ts" },
      runtime: {
        publicPath: "/",
        server: { basePath: "/__evjs", fn: "__evjs/fn" },
      },
      dev: {
        clientRoutes: [],
        serverRequestRoutePaths: [],
        serverRenderedPagePaths: [],
        hasPpr: false,
      },
    };
    const facts = new WebpackManifestGenerator(
      process.cwd(),
      plan,
      undefined,
      merged,
    ).collectBuildFacts();
    expect(facts.serverEntryAssets).toEqual({
      server: { js: ["server.cjs"], css: [] },
      "page-server": { js: ["page-server.cjs"], css: [] },
    });
    expect(facts.emittedFiles?.server).toEqual(["server.cjs", "stats.json"]);
    expect(facts).not.toHaveProperty("serverModules");

    const unownedBuildChunk = webpackAdapterTesting.mergeWebpackStats(
      {
        assets: ["server.cjs"],
        entrypoints: { server: { assets: ["server.cjs"] } },
      },
      {
        assets: ["page-server.cjs", "chunks/lazy.cjs"],
        entrypoints: {
          "page-server": { assets: ["page-server.cjs"] },
        },
      },
      "server-build",
    );
    expect(() =>
      new WebpackManifestGenerator(
        process.cwd(),
        plan,
        undefined,
        unownedBuildChunk,
      ).collectBuildFacts(),
    ).toThrow(
      'Webpack build-only server stats emitted unowned JavaScript asset "chunks/lazy.cjs"',
    );
  });

  it("does not overwrite a stats.json symbolic link", async () => {
    const cwd = await createFixture({});
    const clientDir = path.join(cwd, "dist/client");
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-webpack-stats-outside-"),
    );
    tempDirs.push(outside);
    const sentinel = path.join(outside, "sentinel.json");
    await fs.mkdir(clientDir, { recursive: true });
    await fs.writeFile(sentinel, "keep", "utf-8");
    await fs.symlink(sentinel, path.join(clientDir, "stats.json"));

    await expect(
      webpackAdapterTesting.emitStats(cwd, clientDir, { entrypoints: {} }),
    ).rejects.toThrow(
      "Webpack stats output must not overwrite a symbolic-link output file",
    );
    await expect(fs.readFile(sentinel, "utf-8")).resolves.toBe("keep");
  });

  it("rejects exact and portable aliases of adapter-owned stats.json", async () => {
    const cwd = await createFixture({});
    const clientDir = path.join(cwd, "dist/client");

    await expect(
      webpackAdapterTesting.emitStats(cwd, clientDir, {
        assets: ["stats.json"],
      }),
    ).rejects.toThrow(
      'Webpack emitted asset "stats.json" conflicts with adapter-owned "stats.json"',
    );
    await expect(
      webpackAdapterTesting.emitStats(cwd, clientDir, {
        assets: ["STATS.json"],
      }),
    ).rejects.toThrow(
      'Webpack emitted asset "STATS.json" conflicts with adapter-owned "stats.json"',
    );
    await expect(fs.access(clientDir)).rejects.toThrow();
  });

  it("rejects non-portable server public asset paths", async () => {
    const cwd = await createFixture({});
    const serverDir = path.join(cwd, "dist/server");
    const clientDir = path.join(cwd, "dist/client");

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        serverDir,
        clientDir,
        {
          entrypoints: {
            server: { assets: ["../escape.css"] },
          },
        },
      ),
    ).rejects.toThrow(
      'Webpack emitted server CSS asset "../escape.css" must be a non-empty portable browser artifact path',
    );
  });

  it("does not overwrite a client CSS symbolic link", async () => {
    const cwd = await createFixture({});
    const serverDir = path.join(cwd, "dist/server");
    const clientDir = path.join(cwd, "dist/client");
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-webpack-css-outside-"),
    );
    tempDirs.push(outside);
    const sentinel = path.join(outside, "sentinel.css");
    await fs.mkdir(serverDir, { recursive: true });
    await fs.mkdir(clientDir, { recursive: true });
    await fs.writeFile(path.join(serverDir, "app.css"), "body{}", "utf-8");
    await fs.writeFile(sentinel, "keep", "utf-8");
    await fs.symlink(sentinel, path.join(clientDir, "app.css"));

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        serverDir,
        clientDir,
        {
          entrypoints: {
            server: { assets: ["app.css"] },
          },
        },
      ),
    ).rejects.toThrow(
      'Webpack server public asset "app.css" must be a regular file inside the project client output directory',
    );
    await expect(fs.readFile(sentinel, "utf-8")).resolves.toBe("keep");
  });

  it("does not read server CSS through a symbolic link", async () => {
    const cwd = await createFixture({});
    const serverDir = path.join(cwd, "dist/server");
    const clientDir = path.join(cwd, "dist/client");
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-webpack-css-source-outside-"),
    );
    tempDirs.push(outside);
    const sentinel = path.join(outside, "sentinel.css");
    await fs.mkdir(serverDir, { recursive: true });
    await fs.writeFile(sentinel, "secret", "utf-8");
    await fs.symlink(sentinel, path.join(serverDir, "app.css"));

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        serverDir,
        clientDir,
        {
          entrypoints: {
            server: { assets: ["app.css"] },
          },
        },
      ),
    ).rejects.toThrow(
      'Webpack server public asset "app.css" must be a regular file inside the project server output directory',
    );
    await expect(fs.readFile(sentinel, "utf-8")).resolves.toBe("secret");
  });

  it("copies build-only CSS and binary auxiliary assets from memory", async () => {
    const cwd = await createFixture({});
    const serverDir = path.join(cwd, "dist/server");
    const clientDir = path.join(cwd, "dist/client");
    const logo = Buffer.from([0, 255, 1, 128, 42]);

    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      {
        buildOnlyAssets: ["page.cjs", "page.css", "assets/logo.png"],
      },
      new Map([
        ["page.cjs", Buffer.from("module.exports = {}")],
        ["page.css", Buffer.from(".page{background:url(assets/logo.png)}")],
        ["assets/logo.png", logo],
      ]),
    );

    await expect(
      fs.readFile(path.join(clientDir, "page.css")),
    ).resolves.toEqual(Buffer.from(".page{background:url(assets/logo.png)}"));
    await expect(
      fs.readFile(path.join(clientDir, "assets/logo.png")),
    ).resolves.toEqual(logo);
    await expect(fs.access(path.join(clientDir, "page.cjs"))).rejects.toThrow();
  });

  it("reads each build-only memory asset once", async () => {
    const cwd = await createFixture({});
    const memoryFiles = new Map<string, Buffer>([
      ["page.css", Buffer.from(".page{background:url(assets/logo.png)}")],
      ["assets/logo.png", Buffer.from("logo")],
    ]);
    const get = vi.spyOn(memoryFiles, "get");

    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      path.join(cwd, "dist/server"),
      path.join(cwd, "dist/client"),
      { buildOnlyAssets: ["page.css", "assets/logo.png"] },
      memoryFiles,
    );

    expect(get.mock.calls.map(([asset]) => asset)).toEqual([
      "page.css",
      "assets/logo.png",
    ]);
  });

  it("ignores CSS comments, strings, fragments, data URLs, and external URLs", async () => {
    const cwd = await createFixture({});
    const clientDir = path.join(cwd, "dist/client");
    const css = `
      /* url(assets/comment.png) */
      .label { content: "url(assets/string.png)"; }
      .external { background: url(https://other.example/assets/external.png); }
      .fragment { mask: url(#icon); }
      .inline { background: url(data:image/png;base64,AAAA); }
    `;
    const candidates = [
      "assets/comment.png",
      "assets/string.png",
      "assets/external.png",
    ];
    const memoryFiles = new Map<string, Buffer>([
      ["page.css", Buffer.from(css)],
      ...candidates.map(
        (asset) => [asset, Buffer.from(asset)] as [string, Buffer],
      ),
    ]);

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        path.join(cwd, "dist/server"),
        clientDir,
        { buildOnlyAssets: ["page.css", ...candidates] },
        memoryFiles,
      ),
    ).resolves.toEqual(["page.css"]);
    for (const candidate of candidates) {
      await expect(
        fs.access(path.join(clientDir, candidate)),
      ).rejects.toThrow();
    }
  });

  it("discovers string-form CSS imports and filters non-public references", async () => {
    const cwd = await createFixture({});
    const clientDir = path.join(cwd, "dist/client");
    const memoryFiles = new Map<string, Buffer>([
      ["page.css", Buffer.from('@import "assets/theme.resource";')],
      ["assets/theme.resource", Buffer.from("theme")],
    ]);

    expect(
      serverPublicAssetTesting.readCssUrlReferences(`
        @import "theme.css";
        @import "https://other.example/external.css";
        @import "data:text/css,body{}";
        @import "#fragment";
      `),
    ).toEqual(["theme.css", "https://other.example/external.css"]);
    expect(
      serverPublicAssetTesting.matchEmittedCssAsset(
        "page.css",
        "theme.css",
        ["theme.css"],
        "/",
      ),
    ).toBe("theme.css");
    expect(
      serverPublicAssetTesting.matchEmittedCssAsset(
        "page.css",
        "https://other.example/external.css",
        ["external.css"],
        "/",
      ),
    ).toBeUndefined();

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        path.join(cwd, "dist/server"),
        clientDir,
        { buildOnlyAssets: ["page.css", "assets/theme.resource"] },
        memoryFiles,
      ),
    ).resolves.toEqual(["page.css", "assets/theme.resource"]);
    await expect(
      fs.readFile(path.join(clientDir, "assets/theme.resource"), "utf-8"),
    ).resolves.toBe("theme");
  });

  it("matches absolute CSS URLs only under the configured CDN publicPath", async () => {
    const cwd = await createFixture({});
    const clientDir = path.join(cwd, "dist/client");
    const memoryFiles = new Map<string, Buffer>([
      [
        "styles/page.css",
        Buffer.from(
          ".page{background:url(https://cdn.example/static/assets/logo.png?v=1#icon)}",
        ),
      ],
      ["assets/logo.png", Buffer.from("logo")],
    ]);

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        path.join(cwd, "dist/server"),
        clientDir,
        { buildOnlyAssets: ["styles/page.css", "assets/logo.png"] },
        memoryFiles,
        new Map(),
        new Set(),
        "https://cdn.example/static/",
      ),
    ).resolves.toEqual(["styles/page.css", "assets/logo.png"]);
    await expect(
      fs.readFile(path.join(clientDir, "assets/logo.png"), "utf-8"),
    ).resolves.toBe("logo");
  });

  it("rejects public assets declared by stats but missing from both roots", async () => {
    const cwd = await createFixture({});

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        path.join(cwd, "dist/server"),
        path.join(cwd, "dist/client"),
        { buildOnlyAssets: ["page.css", "missing.svg"] },
        new Map([
          ["page.css", Buffer.from(".page{background:url(missing.svg)}")],
        ]),
      ),
    ).rejects.toThrow(
      'Webpack server public asset "missing.svg" was declared by stats but not emitted',
    );
  });

  it("preserves previous files and ownership when next-state resolution fails", async () => {
    const cwd = await createFixture({});
    const serverDir = path.join(cwd, "dist/server");
    const clientDir = path.join(cwd, "dist/client");
    const ownedFiles = new Map<string, Buffer>();
    await fs.mkdir(serverDir, { recursive: true });
    await fs.writeFile(
      path.join(serverDir, "old.css"),
      "body{color:red}",
      "utf-8",
    );
    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      { entrypoints: { server: { assets: ["old.css"] } } },
      new Map(),
      ownedFiles,
    );

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        serverDir,
        clientDir,
        { buildOnlyAssets: ["next.css", "missing.svg"] },
        new Map([
          ["next.css", Buffer.from(".next{background:url(missing.svg)}")],
        ]),
        ownedFiles,
      ),
    ).rejects.toThrow('Webpack server public asset "missing.svg"');
    await expect(
      fs.readFile(path.join(clientDir, "old.css"), "utf-8"),
    ).resolves.toBe("body{color:red}");
    expect(ownedFiles).toEqual(
      new Map([["old.css", Buffer.from("body{color:red}")]]),
    );
  });

  it("preflights target ancestor symlinks before removing stale ownership", async () => {
    const cwd = await createFixture({});
    const serverDir = path.join(cwd, "dist/server");
    const clientDir = path.join(cwd, "dist/client");
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-webpack-public-ancestor-"),
    );
    tempDirs.push(outside);
    const ownedFiles = new Map<string, Buffer>();
    await fs.mkdir(serverDir, { recursive: true });
    await fs.writeFile(
      path.join(serverDir, "old.css"),
      "body{color:red}",
      "utf-8",
    );
    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      { entrypoints: { server: { assets: ["old.css"] } } },
      new Map(),
      ownedFiles,
    );
    await fs.symlink(outside, path.join(clientDir, "assets"));

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        serverDir,
        clientDir,
        { buildOnlyAssets: ["page.css", "assets/logo.png"] },
        new Map([
          ["page.css", Buffer.from(".page{background:url(assets/logo.png)}")],
          ["assets/logo.png", Buffer.from("logo")],
        ]),
        ownedFiles,
      ),
    ).rejects.toThrow(
      'Webpack server public asset "assets/logo.png" must not traverse symbolic links',
    );
    await expect(
      fs.readFile(path.join(clientDir, "old.css"), "utf-8"),
    ).resolves.toBe("body{color:red}");
    expect(ownedFiles.get("old.css")).toEqual(Buffer.from("body{color:red}"));
    await expect(fs.readdir(outside)).resolves.toEqual([]);
  });

  it("does not publish unreferenced non-executable server assets", async () => {
    const cwd = await createFixture({});
    const clientDir = path.join(cwd, "dist/client");

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        path.join(cwd, "dist/server"),
        clientDir,
        { buildOnlyAssets: ["private.pem"] },
        new Map([["private.pem", Buffer.from("secret")]]),
      ),
    ).resolves.toEqual([]);
    await expect(
      fs.access(path.join(clientDir, "private.pem")),
    ).rejects.toThrow();
  });

  it("rejects different runtime and build-only bytes for one public path", async () => {
    const cwd = await createFixture({});
    const serverDir = path.join(cwd, "dist/server");
    await fs.mkdir(serverDir, { recursive: true });
    await fs.writeFile(path.join(serverDir, "app.css"), "runtime", "utf-8");

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        serverDir,
        path.join(cwd, "dist/client"),
        {
          entrypoints: { server: { assets: ["app.css"] } },
          buildOnlyAssets: ["app.css"],
        },
        new Map([["app.css", Buffer.from("build-only")]]),
      ),
    ).rejects.toThrow(
      'Webpack server public asset "app.css" was emitted with different contents from runtime and build-only output roots',
    );
  });

  it("reuses identical client assets but rejects different client bytes", async () => {
    const cwd = await createFixture({});
    const serverDir = path.join(cwd, "dist/server");
    const clientDir = path.join(cwd, "dist/client");
    await fs.mkdir(serverDir, { recursive: true });
    await fs.mkdir(clientDir, { recursive: true });
    await fs.writeFile(
      path.join(serverDir, "shared.css"),
      "body{color:red}",
      "utf-8",
    );
    await fs.writeFile(
      path.join(clientDir, "shared.css"),
      "body{color:red}",
      "utf-8",
    );
    const stats = { entrypoints: { server: { assets: ["shared.css"] } } };

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        serverDir,
        clientDir,
        stats,
        new Map(),
        new Map(),
        new Set(["shared.css"]),
      ),
    ).resolves.toEqual(["shared.css"]);

    await fs.writeFile(path.join(clientDir, "shared.css"), "client", "utf-8");
    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        serverDir,
        clientDir,
        stats,
        new Map(),
        new Map(),
        new Set(["shared.css"]),
      ),
    ).rejects.toThrow(
      'Webpack server public asset "shared.css" conflicts with a client bundler asset at the same path and has different contents',
    );
  });

  it("rejects portable aliases between server and client ownership", async () => {
    const cwd = await createFixture({});

    await expect(
      webpackAdapterTesting.copyServerPublicAssetsToClient(
        cwd,
        path.join(cwd, "dist/server"),
        path.join(cwd, "dist/client"),
        { buildOnlyAssets: ["app.css"] },
        new Map([["app.css", Buffer.from("body{}")]]),
        new Map(),
        new Set(["APP.css"]),
      ),
    ).rejects.toThrow(
      'Webpack server public asset "app.css" conflicts with client bundler asset "APP.css" on portable file systems',
    );
  });

  it("supports owned file-to-directory and directory-to-file transitions", async () => {
    const cwd = await createFixture({});
    const serverDir = path.join(cwd, "dist/server");
    const clientDir = path.join(cwd, "dist/client");
    const ownedFiles = new Map<string, Buffer>();

    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      { buildOnlyAssets: ["page.css", "assets"] },
      new Map([
        ["page.css", Buffer.from(".page{background:url(assets)}")],
        ["assets", Buffer.from("flat")],
      ]),
      ownedFiles,
    );
    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      { buildOnlyAssets: ["page.css", "assets/logo.png"] },
      new Map([
        ["page.css", Buffer.from(".page{background:url(assets/logo.png)}")],
        ["assets/logo.png", Buffer.from("nested")],
      ]),
      ownedFiles,
    );
    await expect(
      fs.readFile(path.join(clientDir, "assets/logo.png"), "utf-8"),
    ).resolves.toBe("nested");

    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      { buildOnlyAssets: ["page.css", "assets"] },
      new Map([
        ["page.css", Buffer.from(".page{background:url(assets)}")],
        ["assets", Buffer.from("flat-again")],
      ]),
      ownedFiles,
    );
    await expect(
      fs.readFile(path.join(clientDir, "assets"), "utf-8"),
    ).resolves.toBe("flat-again");
    expect(ownedFiles.get("assets")).toEqual(Buffer.from("flat-again"));
    expect(ownedFiles.has("assets/logo.png")).toBe(false);
  });

  it("updates and removes previously copied server-owned public assets", async () => {
    const cwd = await createFixture({});
    const serverDir = path.join(cwd, "dist/server");
    const clientDir = path.join(cwd, "dist/client");
    const ownedFiles = new Map<string, Buffer>();
    const stats = { entrypoints: { server: { assets: ["app.css"] } } };
    await fs.mkdir(serverDir, { recursive: true });
    await fs.writeFile(
      path.join(serverDir, "app.css"),
      "body{color:red}",
      "utf-8",
    );

    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      stats,
      new Map(),
      ownedFiles,
    );
    await fs.writeFile(
      path.join(serverDir, "app.css"),
      "body{color:blue}",
      "utf-8",
    );
    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      stats,
      new Map(),
      ownedFiles,
    );
    await expect(
      fs.readFile(path.join(clientDir, "app.css"), "utf-8"),
    ).resolves.toBe("body{color:blue}");

    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      { entrypoints: {} },
      new Map(),
      ownedFiles,
    );
    await expect(fs.access(path.join(clientDir, "app.css"))).rejects.toThrow();
  });

  it("transfers a copied server asset to the client without later deleting it", async () => {
    const cwd = await createFixture({});
    const serverDir = path.join(cwd, "dist/server");
    const clientDir = path.join(cwd, "dist/client");
    const ownedFiles = new Map<string, Buffer>();
    const serverStats = {
      entrypoints: { server: { assets: ["shared.css"] } },
    };
    await fs.mkdir(serverDir, { recursive: true });
    await fs.writeFile(
      path.join(serverDir, "shared.css"),
      "body{color:red}",
      "utf-8",
    );

    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      serverStats,
      new Map(),
      ownedFiles,
    );
    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      serverStats,
      new Map(),
      ownedFiles,
      new Set(["shared.css"]),
    );
    await webpackAdapterTesting.copyServerPublicAssetsToClient(
      cwd,
      serverDir,
      clientDir,
      { entrypoints: {} },
      new Map(),
      ownedFiles,
      new Set(["shared.css"]),
    );

    expect(ownedFiles.has("shared.css")).toBe(false);
    await expect(
      fs.readFile(path.join(clientDir, "shared.css"), "utf-8"),
    ).resolves.toBe("body{color:red}");
  });
});

describe("webpack build-only memory modules", () => {
  it("preserves output-relative paths and resolves colliding dynamic chunks", async () => {
    const volume = new Volume();
    volume.fromJSON({
      "/memory/entries/a.cjs":
        'module.exports = () => Promise.resolve().then(() => require("../chunks/a/lazy.cjs"));',
      "/memory/entries/b.cjs":
        'module.exports = () => Promise.resolve().then(() => require("../chunks/b/lazy.cjs"));',
      "/memory/chunks/a/lazy.cjs": 'module.exports = { source: "a" };',
      "/memory/chunks/b/lazy.cjs": 'module.exports = { source: "b" };',
    });

    const files = webpackAdapterTesting.collectMemoryFiles(
      volume,
      new Set(["/memory"]),
    );
    expect([...files.keys()].sort()).toEqual([
      "chunks/a/lazy.cjs",
      "chunks/b/lazy.cjs",
      "entries/a.cjs",
      "entries/b.cjs",
    ]);

    const load = webpackAdapterTesting.createMemoryServerModuleLoader(
      process.cwd(),
      files,
    );
    const loadA = (await load("entries/a.cjs")) as () => Promise<{
      source: string;
    }>;
    const loadB = (await load("entries/b.cjs")) as () => Promise<{
      source: string;
    }>;

    await expect(loadA()).resolves.toEqual({ source: "a" });
    await expect(loadB()).resolves.toEqual({ source: "b" });
  });

  buildIt(
    "inlines webpack dynamic imports into self-contained entries",
    async () => {
      const cwd = await createFixture({
        "src/a/entry.ts": `
        export async function load() {
          const value = await import(
            /* webpackChunkName: "chunks/a/lazy" */ "./lazy"
          );
          return value.default;
        }
      `,
        "src/a/lazy.ts": 'export default "a";',
        "src/b/entry.ts": `
        export async function load() {
          const value = await import(
            /* webpackChunkName: "chunks/b/lazy" */ "./lazy"
          );
          return value.default;
        }
      `,
        "src/b/lazy.ts": 'export default "b";',
      });
      const config = resolveConfig<WebpackConfigs>({});
      const plan: BuildPlan = {
        version: 1,
        buildId: "memory-chunks",
        mode: "development",
        distDir: "dist",
        output: {
          clientDir: "dist/client",
          serverDir: "dist/server",
        },
        entries: [
          {
            name: "renderer-a",
            import: "./src/a/entry.ts",
            environment: "server",
            runtime: "node",
            kind: "page-server",
            phase: "build",
            owner: { pageId: "a" },
          },
          {
            name: "renderer-b",
            import: "./src/b/entry.ts",
            environment: "server",
            runtime: "node",
            kind: "page-server",
            phase: "build",
            owner: { pageId: "b" },
          },
        ],
        html: [],
        server: {},
        runtime: {
          publicPath: "/",
          server: { basePath: "/__evjs", fn: "__evjs/fn" },
        },
        dev: {
          clientRoutes: [],
          serverRequestRoutePaths: [],
          serverRenderedPagePaths: [],
          hasPpr: false,
        },
      };

      const facts = await webpackAdapter.build({
        config,
        cwd,
        plan,
        hooks: [],
      });
      const loadModule = facts.loadServerModule;
      expect(loadModule).toBeTypeOf("function");
      const rendererA = (await loadModule?.("renderer-a.cjs")) as {
        load(): Promise<string>;
      };
      const rendererB = (await loadModule?.("renderer-b.cjs")) as {
        load(): Promise<string>;
      };

      await expect(rendererA.load()).resolves.toBe("a");
      await expect(rendererB.load()).resolves.toBe("b");
      expect(facts.serverEntryAssets).toEqual({
        "renderer-a": { js: ["renderer-a.cjs"], css: [] },
        "renderer-b": { js: ["renderer-b.cjs"], css: [] },
      });
      expect(facts.emittedFiles?.server).toBeUndefined();
    },
  );
});

describe("webpackAdapter build", () => {
  buildIt(
    "preserves external files when the build root traverses a symlink",
    async () => {
      const cwd = await createFixture({
        "index.html": '<main id="app"></main>',
        "src/pages/page.tsx": "export default function Home() { return null; }",
      });
      const outside = await fs.mkdtemp(
        path.join(os.tmpdir(), "evjs-output-outside-"),
      );
      tempDirs.push(outside);
      const externalRootDir = path.join(outside, "root");
      const sentinel = path.join(externalRootDir, "sentinel.txt");
      await fs.mkdir(externalRootDir, { recursive: true });
      await fs.writeFile(sentinel, "keep", "utf-8");
      await fs.symlink(outside, path.join(cwd, "linked-output"), "dir");
      const config = await resolveProjectConfig(cwd, {
        output: {
          client: "linked-output/root/client",
          server: "linked-output/root/server",
        },
        routing: { mode: "spa" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
        distDir: "linked-output/root",
      });

      await expect(
        webpackAdapter.build({ config, cwd, plan, hooks: [] }),
      ).rejects.toThrow(
        '[evjs] plan.distDir output directory "linked-output/root" must not traverse symbolic link "linked-output".',
      );
      await expect(fs.readFile(sentinel, "utf-8")).resolves.toBe("keep");
    },
  );

  buildIt(
    "preserves source files rejected as a plugin clean output",
    async () => {
      const cwd = await createFixture({
        "index.html": '<main id="app"></main>',
        "src/pages/page.tsx": "export default function Home() { return null; }",
        "src/sentinel.ts": "export {};",
      });
      const config = await resolveProjectConfig(cwd, {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });

      await expect(
        webpackAdapter.build({
          config,
          cwd,
          plan,
          hooks: [
            {
              configureBundler(configs) {
                const client = configs.find((item) => item.name === "client");
                if (client?.output) client.output.path = path.join(cwd, "src");
              },
            },
          ],
        }),
      ).rejects.toThrow(
        '[evjs] Webpack config "client" output.path "src" must remain the exact absolute BuildPlan output.client directory "dist/client".',
      );
      await expect(
        fs.readFile(path.join(cwd, "src/sentinel.ts"), "utf-8"),
      ).resolves.toBe("export {};");
    },
  );

  buildIt(
    "preserves project files rejected as an escaping output filename",
    async () => {
      const cwd = await createFixture({
        "escape.js": "keep",
        "index.html": '<main id="app"></main>',
        "src/pages/page.tsx": "export default function Home() { return null; }",
      });
      const sentinel = path.join(cwd, "escape.js");
      const config = await resolveProjectConfig(cwd, {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });

      await expect(
        webpackAdapter.build({
          config,
          cwd,
          plan,
          hooks: [
            {
              configureBundler(configs) {
                const client = configs.find((item) => item.name === "client");
                if (client?.output) {
                  client.output.filename = "../../escape.js";
                }
              },
            },
          ],
        }),
      ).rejects.toThrow(
        '[evjs] Webpack config "client" output.filename "../../escape.js" must remain the framework-owned template "[name].js".',
      );
      await expect(fs.readFile(sentinel, "utf-8")).resolves.toBe("keep");
    },
  );

  buildIt(
    "builds framework-managed component pages without materializing .evjs files",
    async () => {
      const cwd = await createFixture({
        "index.html":
          '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
        "src/pages/home/page.tsx": `
        import { createElement } from "react";

        export default function Home() {
          return createElement("h1", null, "Home");
        }
      `,
      });
      const config = await resolveProjectConfig(cwd, {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa", mount: "#root" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });

      const output = await buildWithFrameworkArtifacts({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        hooks: [],
      });

      assertFrameworkManifestShape(output, "Webpack MPA BuildOutput");
      const html = await fs.readFile(
        path.join(cwd, "dist/client/home.html"),
        "utf-8",
      );
      const bundle = await fs.readFile(
        path.join(cwd, "dist/client/page-client-home.js"),
        "utf-8",
      );

      expect(plan.entries[0]?.import).toBe("./src/pages/home/page.tsx");
      expect(plan.entries[0]?.metadata).toMatchObject({
        type: "react-component-page",
        component: "./src/pages/home/page.tsx",
        mount: "#root",
      });
      expect(output.pages.home).toMatchObject({
        assets: { js: ["page-client-home.js"], css: [] },
        render: "csr",
      });
      expect(output.pages.home).toMatchObject({
        render: "csr",
        module: {
          type: "react-component",
          href: "page-client-home.js",
        },
      });
      expect(html).toContain('data-evjs-kind="page"');
      expect(html).toContain('data-evjs-id="home"');
      expect(html).toContain('src="/page-client-home.js"');
      expect(readEmbeddedClientRuntime(html)).toMatchObject({
        routing: {
          kind: "mpa",
          pages: {
            home: {
              module: {
                type: "react-component",
                href: "page-client-home.js",
              },
              mount: "#root",
            },
          },
        },
      });
      expect(bundle).toContain("registerShellModule");
      expect(bundle).toContain("data-evjs-shell-load");
      await expect(
        fs.access(path.join(cwd, ".ev/entries/page-client-home.ts")),
      ).resolves.toBeUndefined();
      await expect(fs.access(path.join(cwd, ".evjs"))).rejects.toThrow();
    },
  );

  buildIt(
    "publishes build-only SSG styles and only their referenced assets",
    async () => {
      const logo =
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>';
      const cwd = await createFixture({
        "index.html":
          '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
        "src/pages/home/page.tsx": `
          import { createElement } from "react";
          import "./page.css";

          export default function Home() {
            return createElement("main", { className: "hero" }, "Home");
          }
        `,
        "src/pages/home/page.config.ts":
          'export default { render: "ssg", hydrate: "none" };',
        "src/pages/home/page.css":
          '.hero { background-image: url("./logo.svg"); }',
        "src/pages/home/logo.svg": logo,
        "src/pages/home/private.pem": "not-public",
      });
      const config = await resolveProjectConfig(cwd, {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa", mount: "#root" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "production",
      });

      const output = await buildWithFrameworkArtifacts({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        hooks: [],
      });
      const [cssAsset] = output.pages.home.assets.css;
      if (!cssAsset) throw new Error("Expected the SSG Page CSS asset.");
      const clientDir = path.join(cwd, "dist/client");
      const css = await fs.readFile(path.join(clientDir, cssAsset), "utf-8");
      const referencedUrl = /url\((?:["']?)([^"')]+)(?:["']?)\)/u.exec(
        css,
      )?.[1];
      if (!referencedUrl) throw new Error("Expected a CSS asset URL.");
      const referencedPath = new URL(
        referencedUrl,
        `https://evjs.invalid/${cssAsset}`,
      ).pathname.slice(1);
      const html = await fs.readFile(
        path.join(clientDir, "home.html"),
        "utf-8",
      );

      expect(html).toContain(`href="/${cssAsset}"`);
      await expect(
        fs.readFile(path.join(clientDir, referencedPath), "utf-8"),
      ).resolves.toBe(logo);
      await expect(
        fs.access(path.join(clientDir, "private.pem")),
      ).rejects.toThrow();
      await expect(
        fs.access(path.join(cwd, "dist/server/page-server-home.cjs")),
      ).rejects.toThrow();
    },
  );

  buildIt(
    "builds app client, server runtime, and route-derived SSR page entries",
    async () => {
      const cwd = await createFixture({
        "index.html":
          '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
        "src/pages/dashboard/page.ts": `
        export default function Dashboard() {
          return "dashboard";
        }
      `,
        "src/pages/dashboard/page.config.ts":
          'export default { render: "ssr", hydrate: "load" };',
      });
      const config = await resolveProjectConfig(cwd, {
        routing: { mode: "spa" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });
      const onBuildOutput = vi.fn((output: BuildOutput) => {
        output.assets.plugin = { js: ["plugin.js"], css: [] };
      });

      const output = await buildWithFrameworkArtifacts({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        hooks: [
          {
            transformHtml(doc, ctx) {
              const meta = doc.createElement("meta");
              meta.setAttribute("name", "html-kind");
              meta.setAttribute("content", ctx.owner.kind);
              doc.head?.appendChild(meta);
            },
          },
        ],
        onBuildOutput,
      });

      const deploymentMetadata = JSON.parse(
        await fs.readFile(
          path.join(cwd, "dist/deployment-metadata.json"),
          "utf-8",
        ),
      );
      assertFrameworkManifestShape(output, "Webpack BuildOutput");
      const html = await fs.readFile(
        path.join(cwd, "dist/client/index.html"),
        "utf-8",
      );

      expect(onBuildOutput).toHaveBeenCalled();
      expect(output.apps.default).toEqual({
        assets: {
          js: ["main.js"],
          css: [],
        },
        mount: "#app",
        document: {
          fileName: "index.html",
        },
        module: {
          type: "entry",
          href: "main.js",
        },
      });
      expect(output.pages.dashboard).toMatchObject({
        assets: {
          js: ["main.js"],
          css: [],
        },
        hydrate: "load",
        render: "ssr",
        routeId: "dashboard",
      });
      expect(deploymentMetadata.routes).toContainEqual({
        kind: "server-page",
        path: "/dashboard",
        pageId: "dashboard",
        render: "ssr",
        methods: ["GET", "HEAD"],
      });
      expect(output.assets["page-server-dashboard"]).toEqual({
        js: ["page-server-dashboard.cjs"],
        css: [],
      });
      expect(deploymentMetadata.server?.entry).toBe("server.cjs");
      expect(output.assets.plugin).toEqual({ js: ["plugin.js"], css: [] });
      expect("apps" in deploymentMetadata).toBe(false);
      expect("pages" in deploymentMetadata).toBe(false);
      expect(output.assets).toMatchObject({
        main: {
          js: ["main.js"],
          css: [],
        },
      });
      expect(output.routes).toContainEqual({
        id: "dashboard",
        path: "/dashboard",
        appId: "default",
        pageId: "dashboard",
      });
      await expect(
        fs.access(path.join(cwd, "dist/manifest.json")),
      ).rejects.toThrow();
      expect(html).toContain('src="/main.js"');
      expect(html).toContain('data-evjs-kind="app"');
      expect(html).toContain('data-evjs-id="default"');
      expect(html).toContain('<meta name="html-kind" content="application">');
      const response = await requestServerEntry(cwd, output, "/dashboard");
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(
        '<div id="app" data-evjs-hydrate="load">dashboard</div>',
      );
      await expect(
        fs.access(path.join(cwd, "dist/client/stats.json")),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(cwd, "dist/server/stats.json")),
      ).resolves.toBeUndefined();
    },
  );

  buildIt(
    "serves SSR React component pages through the default server runtime",
    async () => {
      const cwd = await createFixture({
        "index.html":
          '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
        "src/pages/dashboard/page.ts": `
        import { createElement } from "react";

        export default function Dashboard({ pageId }: { pageId?: string }) {
          return createElement("h1", null, "SSR ", pageId);
        }
      `,
        "src/pages/dashboard/page.config.ts":
          'export default { render: "ssr", hydrate: "load" };',
      });
      const config = await resolveProjectConfig(cwd, {
        routing: { mode: "spa" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });

      const output = await buildWithFrameworkArtifacts({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        hooks: [],
      });

      const response = await requestServerEntry(cwd, output, "/dashboard");

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(
        '<div id="app" data-evjs-hydrate="load"><h1>SSR <!-- -->dashboard</h1></div>',
      );
    },
  );

  buildIt(
    "builds RSC pages with React Flight manifests and endpoint renderer",
    async () => {
      const cwd = await createFixture({
        "index.html":
          '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
        "src/pages/insights/$section/page.tsx": `
        import { createElement } from "react";
        import { usePageParams, usePageSearch } from "@evjs/ev/route";
        import "./insights.css";
        import Badge from "./InsightsBadge";

        export default function Insights() {
          const params = usePageParams<{ section: string }>();
          const search = usePageSearch<{ tab?: string }>();
          return createElement("main", null,
            createElement("h1", null, "RSC ", params.section, " ", search.tab),
            createElement(Badge, null),
          );
        }
      `,
        "src/pages/insights/$section/insights.css": `
        .insights-page {
          color: #123456;
        }
      `,
        "src/pages/insights/$section/InsightsBadge.tsx": `
        "use client";

        import { createElement } from "react";

        export default function InsightsBadge() {
          return createElement("span", null, "Client Badge");
        }
      `,
        "src/pages/insights/$section/page.config.ts":
          'export default { render: "ssr", rsc: true };',
      });
      const config = await resolveProjectConfig(cwd, {
        routing: { mode: "spa" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });

      const output = await buildWithFrameworkArtifacts({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        hooks: [],
      });

      const deploymentMetadata = JSON.parse(
        await fs.readFile(
          path.join(cwd, "dist/deployment-metadata.json"),
          "utf-8",
        ),
      );
      const frameworkRuntime = frameworkRuntimeByOutput.get(output);
      expect(frameworkRuntime).toBeDefined();
      const clientReferenceManifest = JSON.parse(
        await fs.readFile(
          path.join(cwd, "dist/client/react-client-manifest.json"),
          "utf-8",
        ),
      );
      const badgeFileUrl = pathToFileURL(
        await fs.realpath(
          path.join(cwd, "src/pages/insights/$section/InsightsBadge.tsx"),
        ),
      ).href;

      expect(plan.entries.map((entry) => entry.name)).toEqual(
        expect.arrayContaining([
          "evjs-rsc-client",
          "page-server-insights__section",
          "rsc-page-insights__section",
        ]),
      );
      expect("rsc" in deploymentMetadata).toBe(false);
      expect(frameworkRuntime?.rsc?.clientReferenceManifest).toEqual(
        clientReferenceManifest,
      );
      expect(Object.keys(clientReferenceManifest)).toEqual(
        expect.arrayContaining([badgeFileUrl]),
      );
      expect(output.rsc?.pages?.insights_section).toEqual(
        expect.objectContaining({
          renderer: "rsc-page-insights__section",
        }),
      );
      expect(
        output.server?.renderers?.["page-server-insights__section"],
      ).toMatchObject({
        kind: "page-server",
        assets: {
          js: ["page-server-insights__section.cjs"],
          css: ["page-server-insights__section.css"],
        },
      });
      expect(
        output.server?.renderers?.["rsc-page-insights__section"],
      ).toMatchObject({
        kind: "rsc-page",
        assets: {
          js: ["rsc-page-insights__section.cjs"],
          css: ["rsc-page-insights__section.css"],
        },
      });
      expect(output.pages.insights_section.assets).toEqual({
        js: ["evjs-rsc-client.js"],
        css: expect.arrayContaining([
          "page-server-insights__section.css",
          "rsc-page-insights__section.css",
        ]),
      });
      await expect(
        fs.readFile(
          path.join(cwd, "dist/client/rsc-page-insights__section.css"),
          "utf-8",
        ),
      ).resolves.toContain(".insights-page");

      const htmlResponse = await requestServerEntry(
        cwd,
        output,
        "/insights/weekly?tab=overview&tag=a&tag=b",
      );
      expect(htmlResponse.status).toBe(200);
      const html = await htmlResponse.text();
      expect(html).toContain("RSC");
      expect(html).toContain("weekly");
      expect(html).toContain("overview");
      expect(html).toContain(
        '<link rel="stylesheet" href="/rsc-page-insights__section.css">',
      );

      const flightResponse = await requestServerEntry(
        cwd,
        output,
        "/__evjs/rsc?page=insights_section&url=%2Finsights%2Fweekly%3Ftab%3Doverview%26tag%3Da%26tag%3Db",
      );
      expect(flightResponse.status).toBe(200);
      expect(flightResponse.headers.get("content-type")).toContain(
        "text/x-component",
      );
      const flight = await flightResponse.text();
      expect(flight).toContain("RSC");
      expect(flight).toContain("weekly");
      expect(flight).toContain("overview");
    },
  );

  buildIt(
    "builds and serves PPR shell and region renderers through the default server runtime",
    async () => {
      const cwd = await createFixture({
        "index.html":
          '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
        "src/pages/campaign/page.tsx": `
        import { lazy, Suspense } from "react";

        const OfferRegion = lazy(() => import("./Offer.tsx"));

        export default function Campaign({ pageId }: { pageId?: string }) {
          return (
            <main>
              Campaign {pageId}
              <Suspense fallback={<p>Loading offer</p>}>
                <OfferRegion />
              </Suspense>
            </main>
          );
        }
      `,
        "src/pages/campaign/Offer.tsx": `
        import { createElement } from "react";

        export const cache = "no-store";

        export default function Offer() {
          return createElement("section", null, "Offer region");
        }
      `,
        "src/pages/campaign/page.config.ts":
          'export default { render: "ssr", prerender: { partial: true } };',
      });
      const config = await resolveProjectConfig(cwd, {
        routing: { mode: "spa" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });

      const output = await buildWithFrameworkArtifacts({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        hooks: [],
      });

      const campaignRegionId = getSinglePprRegionId(
        output.pages.campaign.ppr?.regions,
      );
      const campaignRegionRenderer = `ppr-region-campaign-${campaignRegionId.replaceAll("_", "__")}`;
      const campaignRegionAsset = `${campaignRegionRenderer}.cjs`;

      expect(output.pages.campaign.ppr).toMatchObject({
        delivery: "merge",
        shell: { js: ["ppr-shell-campaign.cjs"], css: [] },
        regions: {
          [campaignRegionId]: {
            id: campaignRegionId,
            assets: { js: [campaignRegionAsset], css: [] },
            cache: "no-store",
          },
        },
      });
      expect(output.server?.renderers?.["ppr-shell-campaign"]).toMatchObject({
        kind: "ppr-shell",
        owner: { pageId: "campaign" },
        assets: { js: ["ppr-shell-campaign.cjs"], css: [] },
      });
      expect(output.server?.renderers?.[campaignRegionRenderer]).toMatchObject({
        kind: "ppr-region",
        owner: { pageId: "campaign", regionId: campaignRegionId },
        assets: { js: [campaignRegionAsset], css: [] },
      });

      const shellResponse = await requestServerEntry(cwd, output, "/campaign");
      expect(shellResponse.status).toBe(200);
      expect(await shellResponse.text()).toContain(
        "<main>Campaign <!-- -->campaign<section>Offer region</section></main>",
      );

      const regionResponse = await requestServerEntry(
        cwd,
        output,
        `/__evjs/ppr/campaign/${campaignRegionId}`,
      );
      expect(regionResponse.status).toBe(200);
      expect(await regionResponse.text()).toContain(
        "<section>Offer region</section>",
      );
    },
  );
});

describe("webpackAdapter dev", () => {
  devIt("serves a no-client SSG plan through the static dev host", async () => {
    const port = await getAvailablePort();
    const cwd = await createFixture({
      "index.html":
        '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
      "src/pages/home/page.tsx": `
        import { createElement } from "react";
        export default function Home() {
          return createElement("h1", null, "Static home");
        }
      `,
      "src/pages/home/page.config.ts":
        'export default { render: "ssg", hydrate: "none" };',
    });
    const config = await resolveProjectConfig(cwd, {
      dev: { port },
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "mpa", mount: "#root" },
    });
    const analysis = await createCoreGraph(config, cwd);
    const plan = await materializeTestPlan({
      config,
      cwd,
      graph: analysis.graph,
      plan: createBuildPlan(config, analysis.graph, { mode: "development" }),
    });
    const frameworkConfig = {
      ...config,
      bundler: undefined,
      plugins: [],
    };

    const controller = await webpackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan,
      hooks: [],
      callbacks: {
        async onBuildFacts(facts, options) {
          await linkAndEmitBuildOutput({
            bundlerFacts: facts,
            graph: analysis.graph,
            plan,
            config: frameworkConfig,
            cwd,
            hooks: [],
            pluginCtx: {
              mode: "development",
              cwd,
              config: frameworkConfig,
              logger: console as never,
              addWatchFile() {},
            },
            isRebuild: options.isRebuild,
          });
          return "published" as const;
        },
        async onServerBundleReady() {},
      },
    });
    if (!controller) throw new Error("Expected webpack dev controller");
    try {
      await waitForCondition(
        () =>
          fs.access(path.join(cwd, "dist/client/home.html")).then(
            () => true,
            () => false,
          ),
        "Webpack did not emit the initial static page",
      );
      const response = await fetchDevResponse(`http://127.0.0.1:${port}/home`);
      expect(plan.entries.some((entry) => entry.environment === "client")).toBe(
        false,
      );
      expect(plan.dev.serverRenderedPagePaths).toEqual([]);
      expect(response.status).toBe(200);
      expect(response.text).toContain("Static home");
      expect(response.text).not.toContain("<script src=");
    } finally {
      await controller.close?.();
    }
  });

  devIt(WEBPACK_DEV_TEST_NAMES.starts, async () => {
    const port = await getAvailablePort();
    const cwd = await createFixture({
      "index.html":
        '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
      "src/pages/home/page.tsx": `
        import { createElement } from "react";

        export default function Home() {
          return createElement("h1", null, "Home");
        }
      `,
    });
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist/client", server: "dist/server" },
      dev: { port },
      routing: { mode: "mpa", mount: "#root" },
    });
    const analysis = await createCoreGraph(config, cwd);
    const plan = await materializeTestPlan({
      config,
      cwd,
      graph: analysis.graph,
      plan: createBuildPlan(config, analysis.graph, {
        mode: "development",
      }),
    });
    const onBuildOutput = vi.fn();
    const framework = createFrameworkCallbacks({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      onBuildOutput,
    });

    const controller = await webpackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan,
      hooks: [],
      callbacks: framework.callbacks,
    });
    if (!controller) throw new Error("Expected webpack dev controller");
    try {
      await waitForCondition(
        () => onBuildOutput.mock.calls.length > 0,
        "Webpack did not publish initial build facts",
      );
      const output = onBuildOutput.mock.calls.at(-1)?.[0];
      if (!output) throw new Error("Expected linked BuildOutput.");
      assertFrameworkManifestShape(output, "Webpack dev MPA BuildOutput");
      const html = await fetchDevText(`http://127.0.0.1:${port}/home.html`);
      const unsupportedManifestResponse = await fetchDevResponse(
        `http://127.0.0.1:${port}/manifest.json`,
      );

      expect(onBuildOutput).toHaveBeenCalled();
      expect(controller.origin).toBe(`http://localhost:${port}`);
      expect(output.pages.home.assets.js).toEqual(["page-client-home.js"]);
      expect(html).toContain('data-evjs-kind="page"');
      expect(html).toContain('data-evjs-id="home"');
      expect(html).toContain('src="/page-client-home.js"');
      expect(unsupportedManifestResponse.status).toBe(404);
      expect(unsupportedManifestResponse.text).not.toContain(
        "manifest not ready",
      );
      await expect(
        fs.access(path.join(cwd, "dist/runtime.json")),
      ).rejects.toThrow();
    } finally {
      await controller.close?.();
    }
  });

  devIt(
    "runs client middleware in front of webpack HTTP and WebSocket traffic",
    async () => {
      const port = await getAvailablePort();
      const cwd = await createFixture({
        "index.html":
          '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
        "src/pages/home/page.tsx": `
          import { createElement } from "react";

          export default function Home() {
            return createElement("h1", null, "Home behind middleware");
          }
        `,
      });
      const config = await resolveProjectConfig(cwd, {
        output: { client: "dist/client", server: "dist/server" },
        dev: { port },
        routing: { mode: "mpa", mount: "#root" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = await materializeTestPlan({
        config,
        cwd,
        graph: analysis.graph,
        plan: createBuildPlan(config, analysis.graph, {
          mode: "development",
        }),
      });
      const onBuildOutput = vi.fn();
      const framework = createFrameworkCallbacks({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        onBuildOutput,
      });
      const middlewareRequests: string[] = [];
      const middlewareOrigins: string[] = [];
      const controller = await webpackAdapter.dev({
        config,
        cwd,
        signal: new AbortController().signal,
        plan,
        hooks: [],
        clientMiddlewares: [
          async (request, response, next, context) => {
            middlewareRequests.push(request.url ?? "");
            middlewareOrigins.push(context.origin);
            if (request.url === "/__middleware") {
              response.end("handled by plugin middleware");
              return;
            }
            await next();
          },
        ],
        callbacks: framework.callbacks,
      });
      if (!controller) throw new Error("Expected webpack dev controller");
      let closed = false;
      try {
        await waitForCondition(
          () => onBuildOutput.mock.calls.length > 0,
          "Webpack did not publish initial build facts",
        );

        await expect(
          fetchDevText(`http://127.0.0.1:${port}/__middleware`),
        ).resolves.toBe("handled by plugin middleware");
        await expect(
          fetchDevText(`http://127.0.0.1:${port}/home.html`),
        ).resolves.toContain('data-evjs-id="home"');
        expect(controller.origin).toBe(`http://localhost:${port}`);
        expect(middlewareOrigins).toEqual([
          controller.origin,
          controller.origin,
        ]);

        const socket = await openWebpackWebSocket(port);
        const socketClosed = waitForSocketClose(socket);
        expect(middlewareRequests).not.toContain("/ws");

        await controller.close?.();
        closed = true;
        await socketClosed;
        expect(socket.destroyed).toBe(true);
        await expect(canListenOnPort(port)).resolves.toBe(true);
      } finally {
        if (!closed) await controller.close?.();
      }
    },
  );

  devIt(
    "serves the webpack client middleware gateway over generated HTTPS",
    async () => {
      const port = await getAvailablePort();
      const cwd = await createFixture({
        "index.html":
          '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
        "src/pages/page.tsx": "export default function Home() { return null; }",
      });
      const config = await resolveProjectConfig(cwd, {
        dev: { https: true, port },
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa", mount: "#root" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = await materializeTestPlan({
        config,
        cwd,
        graph: analysis.graph,
        plan: createBuildPlan(config, analysis.graph, {
          mode: "development",
        }),
      });
      const framework = createFrameworkCallbacks({
        config,
        cwd,
        graph: analysis.graph,
        plan,
      });
      const controller = await webpackAdapter.dev({
        config,
        cwd,
        signal: new AbortController().signal,
        plan,
        hooks: [],
        clientMiddlewares: [
          async (request, response, next) => {
            if (request.url === "/__secure-middleware") {
              response.end("secure middleware response");
              return;
            }
            await next();
          },
        ],
        callbacks: framework.callbacks,
      });
      if (!controller) throw new Error("Expected webpack dev controller");
      try {
        expect(controller.origin).toBe(`https://localhost:${port}`);
        await expect(
          fetchInsecureHttpsText(
            `https://127.0.0.1:${port}/__secure-middleware`,
          ),
        ).resolves.toBe("secure middleware response");
      } finally {
        await controller.close?.();
      }
    },
  );

  devIt(WEBPACK_DEV_TEST_NAMES.concurrentDone, async () => {
    const port = await getAvailablePort();
    const cwd = await createFixture({
      "index.html":
        '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
      "src/pages/dashboard/page.ts": `
        export default function Dashboard() {
          return "dashboard";
        }
      `,
      "src/pages/dashboard/page.config.ts":
        'export default { render: "ssr", hydrate: "load" };',
    });
    const config = await resolveProjectConfig(cwd, {
      dev: { port },
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "spa" },
    });
    const analysis = await createCoreGraph(config, cwd);
    const plan = await materializeTestPlan({
      config,
      cwd,
      graph: analysis.graph,
      plan: createBuildPlan(config, analysis.graph, {
        mode: "development",
      }),
    });
    expect(new Set(plan.entries.map((entry) => entry.environment))).toEqual(
      new Set(["client", "server"]),
    );

    let doneCount = 0;
    const completedCompilerNames = new Set<string>();
    let releaseDoneBarrier!: () => void;
    const doneBarrier = new Promise<void>((resolve) => {
      releaseDoneBarrier = resolve;
    });
    const synchronizeDonePlugin = {
      apply(compiler: Compiler) {
        const compilerName = compiler.options.name ?? "unknown";
        compiler.hooks.done.tapPromise(
          { name: "EvjsTestConcurrentDoneBarrier", stage: -1_000 },
          async () => {
            doneCount += 1;
            completedCompilerNames.add(compilerName);
            if (
              completedCompilerNames.has("client") &&
              completedCompilerNames.has("server")
            ) {
              releaseDoneBarrier();
            }
            await doneBarrier;
          },
        );
        compiler.hooks.done.tap(
          { name: "EvjsTestInvalidateLiveStats", stage: 1_000 },
          (stats) => {
            const originalToJson = stats.toJson;
            stats.toJson = () => {
              throw new Error("live webpack Stats escaped the done hook");
            };
            queueMicrotask(() => {
              stats.toJson = originalToJson;
            });
          },
        );
      },
    };
    const hooks: PluginHooks<WebpackConfigs>[] = [
      {
        configureBundler(configs) {
          for (const webpackConfig of configs) {
            webpackConfig.plugins = [
              ...(webpackConfig.plugins ?? []),
              synchronizeDonePlugin,
            ];
          }
        },
      },
    ];
    const onBuildOutput = vi.fn();
    const framework = createFrameworkCallbacks({
      config,
      cwd,
      graph: analysis.graph,
      hooks,
      onBuildOutput,
      plan,
    });
    const rebuildFlags: boolean[] = [];
    let activeBuildFacts = 0;
    let maxActiveBuildFacts = 0;
    const callbacks = {
      ...framework.callbacks,
      async onBuildFacts(
        facts: BundlerBuildFacts,
        options: { isRebuild: boolean },
      ) {
        activeBuildFacts += 1;
        maxActiveBuildFacts = Math.max(maxActiveBuildFacts, activeBuildFacts);
        rebuildFlags.push(options.isRebuild);
        try {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return await framework.callbacks.onBuildFacts(facts, options);
        } finally {
          activeBuildFacts -= 1;
        }
      },
    };

    const controller = await webpackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan,
      hooks,
      callbacks,
    });
    let closed = false;
    try {
      await waitForCondition(
        () => doneCount >= 2 && rebuildFlags.length > 0,
        "Webpack did not complete both initial compilers",
      );
      await controller?.close?.();
      closed = true;

      expect(doneCount).toBeGreaterThanOrEqual(2);
      expect(completedCompilerNames.has("client")).toBe(true);
      expect(completedCompilerNames.has("server")).toBe(true);
      expect(maxActiveBuildFacts).toBe(1);
      expect(rebuildFlags.filter((isRebuild) => !isRebuild)).toHaveLength(1);
      expect(rebuildFlags.slice(1).every(Boolean)).toBe(true);
      expect(onBuildOutput).toHaveBeenCalledTimes(rebuildFlags.length);
    } finally {
      if (!closed) await controller?.close?.();
    }
  });

  devIt(WEBPACK_DEV_TEST_NAMES.unclaimedApiFallback, async () => {
    const port = await getAvailablePort();
    const cwd = await createFixture({
      "index.html":
        '<!doctype html><html><head></head><body><div id="app">app shell</div></body></html>',
      "src/pages/page.tsx": "export default function Home() { return null; }",
    });
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist/client", server: "dist/server" },
      dev: { port },
      routing: { mode: "spa" },
    });
    const analysis = await createCoreGraph(config, cwd);
    const plan = await materializeTestPlan({
      config,
      cwd,
      graph: analysis.graph,
      plan: createBuildPlan(config, analysis.graph, {
        mode: "development",
      }),
    });
    const framework = createFrameworkCallbacks({
      config,
      cwd,
      graph: analysis.graph,
      plan,
    });

    const controller = await webpackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan,
      hooks: [],
      callbacks: framework.callbacks,
    });
    try {
      await waitForCondition(
        () =>
          fs.access(path.join(cwd, "dist/client/index.html")).then(
            () => true,
            () => false,
          ),
        "Webpack did not emit the SPA HTML",
      );
      const page = await fetchDevResponse(`http://127.0.0.1:${port}/dashboard`);
      const api = await fetchDevResponse(
        `http://127.0.0.1:${port}/api/unknown`,
        {
          headers: { Accept: "text/html" },
        },
      );
      const frameworkNamespacePage = await fetchDevResponse(
        `http://127.0.0.1:${port}/__evjs/unknown`,
        {
          headers: { Accept: "text/html" },
        },
      );
      const functionChildPage = await fetchDevResponse(
        `http://127.0.0.1:${port}/__evjs/fn/child`,
        {
          headers: { Accept: "text/html" },
        },
      );

      expect(page.status).toBe(200);
      expect(page.text).toContain("app shell");
      expect(api.status).toBe(200);
      expect(api.text).toContain("app shell");
      expect(frameworkNamespacePage.status).toBe(200);
      expect(frameworkNamespacePage.text).toContain("app shell");
      expect(functionChildPage.status).toBe(200);
      expect(functionChildPage.text).toContain("app shell");
    } finally {
      await controller?.close?.();
    }
  });

  devIt(
    "keeps the dev session alive after an initial compile error",
    async () => {
      const port = await getAvailablePort();
      const cwd = await createFixture({
        "index.html":
          '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
        "src/pages/home/page.tsx":
          "export default function Home() { return null; }",
      });
      const config = await resolveProjectConfig(cwd, {
        dev: { port },
        routing: { mode: "mpa", mount: "#root" },
      });
      const analysis = await createCoreGraph(config, cwd);
      const plan = await materializeTestPlan({
        config,
        cwd,
        graph: analysis.graph,
        plan: createBuildPlan(config, analysis.graph, { mode: "development" }),
      });
      const pageFile = path.join(cwd, "src/pages/home/page.tsx");
      await fs.writeFile(pageFile, "export default function Home( {", "utf-8");
      const framework = createFrameworkCallbacks({
        config,
        cwd,
        graph: analysis.graph,
        plan,
      });
      let clientCompiler: Compiler | undefined;
      const captureCompilerPlugin = {
        apply(compiler: Compiler) {
          clientCompiler = compiler;
        },
      };
      const hooks: PluginHooks<WebpackConfigs>[] = [
        {
          configureBundler(configs) {
            const clientConfig = configs.find(
              (candidate) => candidate.name === "client",
            );
            if (!clientConfig) throw new Error("Expected client config.");
            clientConfig.watchOptions = {
              ...clientConfig.watchOptions,
              ignored: /node_modules/,
              poll: 100,
            };
            clientConfig.plugins = [
              ...(clientConfig.plugins ?? []),
              captureCompilerPlugin,
            ];
          },
        },
      ];
      const rebuildFlags: boolean[] = [];
      const controller = await webpackAdapter.dev({
        config,
        cwd,
        signal: new AbortController().signal,
        plan,
        hooks,
        callbacks: {
          ...framework.callbacks,
          async onBuildFacts(facts, options) {
            rebuildFlags.push(options.isRebuild);
            return framework.callbacks.onBuildFacts(facts, options);
          },
        },
      });
      let doneSettled = false;
      void controller.done.finally(() => {
        doneSettled = true;
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(rebuildFlags).toEqual([]);
        expect(doneSettled).toBe(false);

        await fs.writeFile(
          pageFile,
          "export default function Home() { return null; }",
          "utf-8",
        );
        const activeClientCompiler = clientCompiler;
        const watching = activeClientCompiler?.watching;
        if (!activeClientCompiler || !watching) {
          throw new Error("Expected client compiler watching.");
        }
        const inputFileSystem = activeClientCompiler.inputFileSystem as {
          purge?(target?: string | string[]): void;
        };
        inputFileSystem.purge?.(pageFile);
        activeClientCompiler.modifiedFiles = new Set([pageFile]);
        watching.invalidate();
        await waitForCondition(
          () => rebuildFlags.length > 0,
          "Webpack did not recover after the source error was fixed",
        );
        expect(rebuildFlags[0]).toBe(false);
        expect(doneSettled).toBe(false);
      } finally {
        await controller.close();
      }
      await expect(controller.done).resolves.toBeUndefined();
    },
  );
});
