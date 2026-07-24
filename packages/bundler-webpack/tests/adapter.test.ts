import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BundlerBuildFacts } from "@evjs/ev/_internal/build";
import {
  buildHtml,
  createBuildPlan,
  createCoreGraph,
  diffBuildPlan,
  generateHtml,
  materializeFrameworkIR,
} from "@evjs/ev/_internal/build";
import type { Config, ResolvedConfig } from "@evjs/ev/config";
import { resolveConfig } from "@evjs/ev/config";
import type { PluginHooks } from "@evjs/ev/plugin";
import type { BuildOutput, BuildPlan, CoreGraph } from "@evjs/shared/manifest";
import {
  createDeploymentMetadata,
  createPublicManifest,
  linkBuildOutput,
} from "@evjs/shared/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPageRoutingDefaults } from "../../ev/esm/_internal/build/convention-config.js";
import {
  createClientRuntime,
  createFrameworkRuntime,
  type FrameworkRuntimeOutput,
} from "../../ev/src/_internal/build/framework-runtime.js";
import type { WebpackConfig } from "../src/adapter/create-config.js";
import { __testing as webpackAdapterTesting } from "../src/adapter/index.js";
import { webpackAdapter } from "../src/index.js";
import type { WebpackStatsLike } from "../src/manifest-generator.js";

const tempDirs: string[] = [];
const WEBPACK_BUILD_TEST_TIMEOUT = 20_000;
const WEBPACK_DEV_TEST_TIMEOUT = 20_000;
const WEBPACK_DEV_PORT_BASE = 31_000 + (process.pid % 1_000) * 10;
const WEBPACK_DEV_TEST_NAMES = {
  starts: "starts webpack dev and emits framework manifest/html",
  apiRewrite: "does not rewrite API-like requests to application HTML",
  htmlOnlyUpdate:
    "applies html-only plan updates without rebuilding webpack configs",
  rollback: "rolls back internal dev state when a plan update fails",
  pageAddition:
    "applies page additions through updatePlan without restarting ev dev",
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
  config: Config<WebpackConfig>,
): Promise<ResolvedConfig<WebpackConfig>> {
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

async function buildWithFrameworkArtifacts(options: {
  config: ResolvedConfig<WebpackConfig>;
  cwd: string;
  graph: CoreGraph;
  plan: BuildPlan;
  hooks?: PluginHooks<WebpackConfig>[];
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
  config: ResolvedConfig<WebpackConfig>;
  cwd: string;
  graph: CoreGraph;
  plan: BuildPlan;
}): Promise<BuildPlan> {
  return materializeFrameworkIR({
    cwd: options.cwd,
    mode: options.plan.mode,
    command: options.plan.mode === "production" ? "build" : "dev",
    config: options.config,
    graph: options.graph,
    plan: options.plan,
    plugins: [],
    pluginContext: {
      mode: options.plan.mode,
      command: options.plan.mode === "production" ? "build" : "dev",
      cwd: options.cwd,
      config: options.config,
      logger: console as never,
      addWatchFile() {},
    },
  });
}

function createFrameworkCallbacks(options: {
  config: ResolvedConfig<WebpackConfig>;
  cwd: string;
  graph: CoreGraph;
  plan: BuildPlan;
  hooks?: PluginHooks<WebpackConfig>[];
  onBuildOutput?: (output: BuildOutput) => void | Promise<void>;
  onDevServerReady?: (context: { origin: string }) => void | Promise<void>;
  onServerBundleReady?: () => void | Promise<void>;
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
        callbackOptions?: { isRebuild?: boolean },
      ) {
        await emitFrameworkArtifacts({
          config: options.config,
          cwd: options.cwd,
          graph,
          plan,
          hooks,
          facts,
          onBuildOutput: options.onBuildOutput,
          isRebuild: callbackOptions?.isRebuild,
        });
      },
      onDevServerReady: options.onDevServerReady,
      onServerBundleReady:
        options.onServerBundleReady ??
        (() => {
          // no-op
        }),
    },
  };
}

async function emitFrameworkArtifacts(options: {
  config: ResolvedConfig<WebpackConfig>;
  cwd: string;
  graph: CoreGraph;
  plan: BuildPlan;
  hooks: PluginHooks<WebpackConfig>[];
  facts: BundlerBuildFacts;
  onBuildOutput?: (output: BuildOutput) => void | Promise<void>;
  isRebuild?: boolean;
}): Promise<BuildOutput> {
  const output = linkBuildOutput({
    graph: options.graph,
    plan: options.plan,
    clientEntryAssets: options.facts.clientEntryAssets,
    firstClientEntryAssets: options.facts.firstClientEntryAssets,
    serverEntryAssets: options.facts.serverEntryAssets,
    serverEntry: options.facts.serverEntry,
    serverAssets: options.facts.serverAssets,
    serverModules: options.facts.serverModules,
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
        command: options.plan.mode === "production" ? "build" : "dev",
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

describe("webpack stats ownership", () => {
  it("bypasses resolved framework runtime paths from SPA dev fallback", () => {
    const config = resolveConfig<WebpackConfig>({
      server: {
        basePath: "/_ev",
        rsc: {
          endpoint: "/flight",
        },
      },
    });
    const rewrites =
      webpackAdapterTesting.createHtmlFallbackBypassRewrites(config);
    const findBypass = (pathname: string) =>
      rewrites
        .find((rewrite) => rewrite.from.test(pathname))
        ?.to({ parsedUrl: { pathname } });

    expect(findBypass("/api/users")).toBe("/api/users");
    expect(findBypass("/_ev/fn")).toBe("/_ev/fn");
    expect(findBypass("/_ev/ppr/campaign/offer")).toBe(
      "/_ev/ppr/campaign/offer",
    );
    expect(findBypass("/flight")).toBe("/flight");
    expect(findBypass("/flight/page")).toBe("/flight/page");
    expect(findBypass("/dashboard")).toBeUndefined();
    expect(webpackAdapterTesting.isApiLikeRequestPath("/flight", config)).toBe(
      true,
    );
    expect(
      webpackAdapterTesting.isApiLikeRequestPath("/dashboard", config),
    ).toBe(false);
  });

  it("proxies a server-rendered root route without catching every asset", () => {
    const config = resolveConfig<WebpackConfig>();
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
        serverRoutePaths: ["/"],
        hasPpr: false,
      },
    };

    const rules = webpackAdapterTesting.createDevProxyRules(config, plan);
    const rootRule = rules.find((rule) => rule.contextFilter);

    expect(rootRule?.frameworkPageRender).toBe(true);
    expect(rootRule?.contextFilter?.("/")).toBe(true);
    expect(rootRule?.contextFilter?.("/favicon.ico")).toBe(false);
  });

  it("namespaces server-rsc chunks and de-dupes modules while merging server stats", () => {
    const serverStats: WebpackStatsLike = {
      entrypoints: {
        server: {
          assets: ["server.cjs"],
        },
      },
      chunks: [
        {
          id: 1,
          names: ["server"],
          files: ["server.cjs"],
        },
      ],
      modules: [
        {
          identifier: "/project/src/shared.ts",
          chunks: [1],
        },
      ],
    };
    const rscStats: WebpackStatsLike = {
      entrypoints: {
        "insights-rsc": {
          assets: ["insights-rsc.cjs"],
        },
      },
      chunks: [
        {
          id: 1,
          names: ["insights-rsc"],
          files: ["insights-rsc.cjs"],
        },
      ],
      modules: [
        {
          identifier: "/project/src/shared.ts",
          chunks: [1],
        },
        {
          identifier: "/project/src/Insights.tsx",
          chunks: [1],
        },
      ],
    };

    const merged = webpackAdapterTesting.mergeWebpackStats(
      serverStats,
      rscStats,
      "server-rsc",
    );

    expect(merged.chunks).toEqual([
      {
        id: 1,
        names: ["server"],
        files: ["server.cjs"],
      },
      {
        id: "server-rsc:1",
        names: ["server-rsc:insights-rsc"],
        files: ["insights-rsc.cjs"],
      },
    ]);
    expect(merged.modules).toEqual([
      {
        identifier: "/project/src/shared.ts",
        chunks: [1],
      },
      {
        identifier: "/project/src/Insights.tsx",
        chunks: ["server-rsc:1"],
      },
    ]);
  });
});

describe("webpackAdapter build", () => {
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
        output: { client: "dist" },
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

      const manifest = createPublicManifest(output);
      const html = await fs.readFile(
        path.join(cwd, "dist/home/index.html"),
        "utf-8",
      );
      const bundle = await fs.readFile(path.join(cwd, "dist/home.js"), "utf-8");

      expect(plan.entries[0]?.import).toBe("./src/pages/home/page.tsx");
      expect(plan.entries[0]?.metadata).toMatchObject({
        type: "react-component-page",
        component: "./src/pages/home/page.tsx",
        mount: "#root",
      });
      expect(manifest).not.toHaveProperty("assets");
      if (!("routing" in manifest) || manifest.routing.kind !== "mpa") {
        throw new Error("Expected MPA public manifest.");
      }
      expect(manifest.routing.pages.home).toMatchObject({
        assets: { js: ["home.js"], css: [] },
        render: "csr",
      });
      expect("module" in manifest.routing.pages.home).toBe(false);
      expect(output.pages.home).toMatchObject({
        render: "csr",
        module: {
          type: "react-component",
          href: "home.js",
        },
      });
      expect(html).toContain('data-evjs-kind="page"');
      expect(html).toContain('data-evjs-id="home"');
      expect(html).toContain('src="/home.js"');
      expect(readEmbeddedClientRuntime(html)).toMatchObject({
        routing: {
          kind: "mpa",
          pages: {
            home: {
              module: { type: "react-component", href: "home.js" },
              mount: "#root",
            },
          },
        },
      });
      expect(bundle).toContain("registerShellModule");
      expect(bundle).toContain("data-evjs-shell-load");
      await expect(
        fs.access(path.join(cwd, ".ev/entries/home.ts")),
      ).resolves.toBeUndefined();
      await expect(fs.access(path.join(cwd, ".evjs"))).rejects.toThrow();
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
      const publicManifest = createPublicManifest(output);
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
      expect(output.assets["dashboard-server"]).toEqual({
        js: ["dashboard-server.cjs"],
        css: [],
      });
      expect(deploymentMetadata.server?.entry).toBe("server.cjs");
      expect(output.assets.plugin).toEqual({ js: ["plugin.js"], css: [] });
      expect("apps" in deploymentMetadata).toBe(false);
      expect("pages" in deploymentMetadata).toBe(false);
      expect("app" in publicManifest).toBe(false);
      if (
        !("routing" in publicManifest) ||
        publicManifest.routing.kind !== "spa"
      ) {
        throw new Error("Expected SPA public manifest.");
      }
      expect("assets" in publicManifest).toBe(true);
      if (!("assets" in publicManifest)) {
        throw new Error("Expected SPA public manifest assets.");
      }
      expect(publicManifest.assets).toEqual({
        main: {
          js: ["main.js"],
          css: [],
        },
      });
      expect(publicManifest.routing.routes).toContainEqual({
        id: "dashboard",
        path: "/dashboard",
        pageId: "dashboard",
        render: "ssr",
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
          "insights_section-server",
          "insights_section-rsc",
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
          renderer: "insights_section-rsc",
        }),
      );
      expect(
        output.server?.renderers?.["insights_section-server"],
      ).toMatchObject({
        kind: "page-server",
        assets: {
          js: ["insights_section-server.cjs"],
          css: ["insights_section-server.css"],
        },
      });
      expect(output.server?.renderers?.["insights_section-rsc"]).toMatchObject({
        kind: "rsc-page",
        assets: {
          js: ["insights_section-rsc.cjs"],
          css: ["insights_section-rsc.css"],
        },
      });
      expect(output.pages.insights_section.assets).toEqual({
        js: ["evjs-rsc-client.js"],
        css: expect.arrayContaining([
          "insights_section-server.css",
          "insights_section-rsc.css",
        ]),
      });
      await expect(
        fs.readFile(
          path.join(cwd, "dist/client/insights_section-rsc.css"),
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
        '<link rel="stylesheet" href="/insights_section-rsc.css">',
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
      const campaignRegionRenderer = `campaign-${campaignRegionId}-ppr-region`;
      const campaignRegionAsset = `${campaignRegionRenderer}.cjs`;

      expect(output.pages.campaign.ppr).toMatchObject({
        delivery: "merge",
        shell: { js: ["campaign-ppr-shell.cjs"], css: [] },
        regions: {
          [campaignRegionId]: {
            id: campaignRegionId,
            assets: { js: [campaignRegionAsset], css: [] },
            cache: "no-store",
          },
        },
      });
      expect(output.server?.renderers?.["campaign-ppr-shell"]).toMatchObject({
        kind: "ppr-shell",
        owner: { pageId: "campaign" },
        assets: { js: ["campaign-ppr-shell.cjs"], css: [] },
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
      output: { client: "dist" },
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
    const onDevServerReady = vi.fn();
    const framework = createFrameworkCallbacks({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      onBuildOutput,
      onDevServerReady,
    });

    const controller = await webpackAdapter.dev({
      config,
      cwd,
      plan,
      hooks: [],
      callbacks: framework.callbacks,
    });
    try {
      const output = onBuildOutput.mock.calls.at(-1)?.[0];
      if (!output) throw new Error("Expected linked BuildOutput.");
      const manifest = createPublicManifest(output);
      const html = await fetchDevText(
        `http://127.0.0.1:${port}/home/index.html`,
      );
      const legacyManifest = await fetchDevResponse(
        `http://127.0.0.1:${port}/manifest.json`,
      );

      expect(onBuildOutput).toHaveBeenCalled();
      expect(onDevServerReady).toHaveBeenCalledWith({
        origin: `http://localhost:${port}`,
      });
      expect("distDir" in manifest).toBe(false);
      expect(manifest).not.toHaveProperty("assets");
      if (!("routing" in manifest) || manifest.routing.kind !== "mpa") {
        throw new Error("Expected MPA public manifest.");
      }
      expect(manifest.routing.pages.home.assets.js).toEqual(["home.js"]);
      expect(html).toContain('data-evjs-kind="page"');
      expect(html).toContain('data-evjs-id="home"');
      expect(html).toContain('src="/home.js"');
      expect(legacyManifest.status).toBe(404);
      expect(legacyManifest.text).not.toContain("manifest not ready");
      await expect(
        fs.access(path.join(cwd, "dist/runtime.json")),
      ).rejects.toThrow();
    } finally {
      await controller?.close?.();
    }
  });

  devIt(WEBPACK_DEV_TEST_NAMES.apiRewrite, async () => {
    const port = await getAvailablePort();
    const cwd = await createFixture({
      "index.html":
        '<!doctype html><html><head></head><body><div id="app">app shell</div></body></html>',
      "src/pages/page.tsx": "export default function Home() { return null; }",
    });
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist" },
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
      plan,
      hooks: [],
      callbacks: framework.callbacks,
    });
    try {
      const page = await fetchDevResponse(`http://127.0.0.1:${port}/dashboard`);
      const api = await fetchDevResponse(
        `http://127.0.0.1:${port}/api/unknown`,
        {
          headers: { Accept: "text/html" },
        },
      );
      const frameworkApi = await fetchDevResponse(
        `http://127.0.0.1:${port}/__evjs/unknown`,
        {
          headers: { Accept: "text/html" },
        },
      );

      expect(page.status).toBe(200);
      expect(page.text).toContain("app shell");
      expect(api.status).toBe(404);
      expect(api.headers.get("Content-Type")).toContain("application/json");
      expect(JSON.parse(api.text)).toEqual({
        error: {
          code: "EVJS_API_NOT_FOUND",
          message: "No API route matched /api/unknown.",
        },
      });
      expect(frameworkApi.status).toBe(404);
      expect(frameworkApi.headers.get("Content-Type")).toContain("text/plain");
      expect(frameworkApi.text).toContain(
        "No framework route matched /__evjs/unknown.",
      );
    } finally {
      await controller?.close?.();
    }
  });

  devIt(WEBPACK_DEV_TEST_NAMES.htmlOnlyUpdate, async () => {
    const port = await getAvailablePort();
    const cwd = await createFixture({
      "index.html":
        '<!doctype html><html><head></head><body><div id="root">initial</div></body></html>',
      "next.html":
        '<!doctype html><html><head></head><body><div id="root">next-shell</div></body></html>',
      "src/pages/home/page.tsx": `
        import { createElement } from "react";

        export default function Home() {
          return createElement("h1", null, "Home");
        }
      `,
    });
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist" },
      dev: { port },
      routing: { mode: "mpa", html: "./index.html", mount: "#root" },
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
    let failBundlerConfig = false;
    const hooks: PluginHooks<WebpackConfig>[] = [
      {
        bundlerConfig() {
          if (failBundlerConfig) {
            throw new Error("html-only update should not rebuild webpack");
          }
        },
      },
    ];
    const framework = createFrameworkCallbacks({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      hooks,
    });

    const controller = await webpackAdapter.dev({
      config,
      cwd,
      plan,
      hooks,
      callbacks: framework.callbacks,
    });
    try {
      const nextConfig = await resolveProjectConfig(cwd, {
        output: { client: "dist" },
        dev: { port },
        routing: { mode: "mpa", html: "./next.html", mount: "#root" },
      });
      const nextAnalysis = await createCoreGraph(nextConfig, cwd);
      const nextPlan = await materializeTestPlan({
        config: nextConfig,
        cwd,
        graph: nextAnalysis.graph,
        plan: createBuildPlan(nextConfig, nextAnalysis.graph, {
          mode: "development",
        }),
      });
      const update = diffBuildPlan(plan, nextPlan, "config");

      failBundlerConfig = true;
      framework.update(nextAnalysis.graph, nextPlan);
      await controller?.updatePlan(update);

      const html = await fetchDevText(
        `http://127.0.0.1:${port}/home/index.html`,
      );

      expect(update.entries.added).toHaveLength(0);
      expect(update.entries.changed).toHaveLength(0);
      expect(update.html.changed.map((item) => item.id)).toEqual(["home"]);
      expect(html).toContain("next-shell");
      expect(html).toContain('src="/home.js"');
    } finally {
      await controller?.close?.();
    }
  });

  devIt(
    "refreshes the server runtime after page metadata-only plan updates",
    async () => {
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
        "src/pages/home/page.config.ts": 'export default { render: "ssr" };',
      });
      const config = await resolveProjectConfig(cwd, {
        output: { client: "dist" },
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
      const onServerBundleReady = vi.fn();
      const framework = createFrameworkCallbacks({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        onServerBundleReady,
      });

      const controller = await webpackAdapter.dev({
        config,
        cwd,
        plan,
        hooks: [],
        callbacks: framework.callbacks,
      });
      try {
        onServerBundleReady.mockClear();
        const nextGraph = structuredClone(analysis.graph);
        const page = nextGraph.pages.home;
        if (!page) throw new Error("Expected home Page.");
        page.metadata = {
          title: "Updated home",
          meta: { description: "Updated description" },
        };
        const nextPlan = await materializeTestPlan({
          config,
          cwd,
          graph: nextGraph,
          plan: createBuildPlan(config, nextGraph, {
            mode: "development",
          }),
        });
        const update = diffBuildPlan(plan, nextPlan, "config");

        framework.update(nextGraph, nextPlan);
        await controller?.updatePlan(update);

        expect(update.entries.added).toHaveLength(0);
        expect(update.entries.removed).toHaveLength(0);
        expect(update.entries.changed).toHaveLength(0);
        expect(update.html.changed).toHaveLength(0);
        expect(update.generatedChanged).toBe(true);
        expect(onServerBundleReady).toHaveBeenCalled();
      } finally {
        await controller?.close?.();
      }
    },
  );

  devIt(WEBPACK_DEV_TEST_NAMES.rollback, async () => {
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
      output: { client: "dist" },
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
    let failBundlerConfig = false;
    const hooks: PluginHooks<WebpackConfig>[] = [
      {
        bundlerConfig() {
          if (failBundlerConfig) {
            throw new Error("forced update failure");
          }
        },
      },
    ];
    const framework = createFrameworkCallbacks({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      hooks,
    });

    const controller = await webpackAdapter.dev({
      config,
      cwd,
      plan,
      hooks,
      callbacks: framework.callbacks,
    });
    try {
      await fs.mkdir(path.join(cwd, "src/pages/about"), { recursive: true });
      await fs.writeFile(
        path.join(cwd, "src/pages/about/page.tsx"),
        `
          import { createElement } from "react";

          export default function About() {
            return createElement("h1", null, "About");
          }
        `,
        "utf-8",
      );
      const nextConfig = await resolveProjectConfig(cwd, {
        output: { client: "dist" },
        dev: { port },
        routing: { mode: "mpa", mount: "#root" },
      });
      const nextAnalysis = await createCoreGraph(nextConfig, cwd);
      const nextPlan = await materializeTestPlan({
        config: nextConfig,
        cwd,
        graph: nextAnalysis.graph,
        plan: createBuildPlan(nextConfig, nextAnalysis.graph, {
          mode: "development",
        }),
      });
      const update = diffBuildPlan(plan, nextPlan, "config");

      failBundlerConfig = true;
      await expect(controller?.updatePlan(update)).rejects.toThrow(
        "forced update failure",
      );

      const session = controller as unknown as {
        plan: { entries: Array<{ name: string }> };
      };
      expect(session.plan.entries.map((entry) => entry.name)).toEqual(["home"]);
    } finally {
      await controller?.close?.();
    }
  });

  devIt(WEBPACK_DEV_TEST_NAMES.pageAddition, async () => {
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
      output: { client: "dist" },
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
      plan,
      hooks: [],
      callbacks: framework.callbacks,
    });
    const stopSpy = vi.spyOn(
      controller as unknown as { stop(): Promise<void> },
      "stop",
    );

    try {
      await fs.mkdir(path.join(cwd, "src/pages/about"), { recursive: true });
      await fs.writeFile(
        path.join(cwd, "src/pages/about/page.tsx"),
        `
          import { createElement } from "react";

          export default function About() {
            return createElement("h1", null, "About");
          }
        `,
        "utf-8",
      );

      const nextConfig = await resolveProjectConfig(cwd, {
        output: { client: "dist" },
        dev: { port },
        routing: { mode: "mpa", mount: "#root" },
      });
      const nextAnalysis = await createCoreGraph(nextConfig, cwd);
      const nextPlan = await materializeTestPlan({
        config: nextConfig,
        cwd,
        graph: nextAnalysis.graph,
        plan: createBuildPlan(nextConfig, nextAnalysis.graph, {
          mode: "development",
        }),
      });
      const update = diffBuildPlan(plan, nextPlan, "config");
      const buildOutputCallsBeforeUpdate = onBuildOutput.mock.calls.length;

      framework.update(nextAnalysis.graph, nextPlan);
      await controller?.updatePlan(update);

      const output = onBuildOutput.mock.calls.at(-1)?.[0];
      if (!output) throw new Error("Expected linked BuildOutput.");
      const manifest = createPublicManifest(output);
      const html = await fetchDevText(
        `http://127.0.0.1:${port}/about/index.html`,
      );

      expect(update.entries.added.map((entry) => entry.name)).toEqual([
        "about",
      ]);
      expect(manifest).not.toHaveProperty("assets");
      if (!("routing" in manifest) || manifest.routing.kind !== "mpa") {
        throw new Error("Expected MPA public manifest.");
      }
      expect(manifest.routing.pages.about.assets.js).toEqual(["about.js"]);
      expect(html).toContain('data-evjs-kind="page"');
      expect(html).toContain('data-evjs-id="about"');
      expect(html).toContain('src="/about.js"');
      expect(onBuildOutput.mock.calls.length).toBeGreaterThan(
        buildOutputCallsBeforeUpdate,
      );
      expect(stopSpy).not.toHaveBeenCalled();
    } finally {
      await controller?.close?.();
    }
  });
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
