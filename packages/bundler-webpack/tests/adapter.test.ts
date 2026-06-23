import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AppGraph,
  BuildOutput,
  BuildPlan,
  BundlerBuildFacts,
  PluginHooks,
  ResolvedConfig,
} from "@evjs/ev";
import { buildHtml, linkBuildOutput, resolveConfig } from "@evjs/ev";
import {
  createAppGraph,
  createBuildPlan,
  diffBuildPlan,
  generateHtml,
} from "@evjs/ev/build-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
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
const allocatedDevPorts = new Set<number>();

type ServerRuntimeGlobals = typeof globalThis & {
  __EVJS_MANIFEST__?: BuildOutput;
  __EVJS_SERVER_MODULE_LOADER__?: (
    asset: string,
  ) => Promise<Record<string, unknown>>;
};

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

function requireRouting(
  routing: ResolvedConfig<WebpackConfig>["routing"],
): NonNullable<ResolvedConfig<WebpackConfig>["routing"]> {
  if (!routing) {
    throw new Error("Expected routing to be resolved for this test.");
  }
  return routing;
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
  graph: AppGraph;
  plan: BuildPlan;
  hooks?: PluginHooks<WebpackConfig>[];
  onBuildOutput?: (output: BuildOutput) => void | Promise<void>;
}) {
  const hooks = options.hooks ?? [];
  const buildFacts = await webpackAdapter.build({
    config: options.config,
    cwd: options.cwd,
    graph: options.graph,
    plan: options.plan,
    hooks,
  });
  return emitFrameworkArtifacts({
    ...options,
    hooks,
    facts: buildFacts,
  });
}

function createFrameworkCallbacks(options: {
  config: ResolvedConfig<WebpackConfig>;
  cwd: string;
  graph: AppGraph;
  plan: BuildPlan;
  hooks?: PluginHooks<WebpackConfig>[];
  onBuildOutput?: (output: BuildOutput) => void | Promise<void>;
  onServerBundleReady?: () => void | Promise<void>;
}) {
  let graph = options.graph;
  let plan = options.plan;
  const hooks = options.hooks ?? [];

  return {
    update(nextGraph: AppGraph, nextPlan: BuildPlan) {
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
  graph: AppGraph;
  plan: BuildPlan;
  hooks: PluginHooks<WebpackConfig>[];
  facts: BundlerBuildFacts;
  onBuildOutput?: (output: BuildOutput) => void | Promise<void>;
  isRebuild?: boolean;
}): Promise<BuildOutput> {
  const output = linkBuildOutput({
    graph: options.graph,
    plan: options.plan,
    serverEnabled: options.config.serverEnabled,
    clientEntryAssets: options.facts.clientEntryAssets,
    firstClientEntryAssets: options.facts.firstClientEntryAssets,
    serverEntryAssets: options.facts.serverEntryAssets,
    serverEntry: options.facts.serverEntry,
    serverAssets: options.facts.serverAssets,
    serverModules: options.facts.serverModules,
    rscManifests: options.facts.rscManifests,
  });
  await options.onBuildOutput?.(output);

  const rootDir = path.join(options.cwd, options.plan.distDir);
  const clientDir = options.config.serverEnabled
    ? path.join(rootDir, "client")
    : rootDir;
  await fs.mkdir(rootDir, { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "manifest.json"),
    JSON.stringify(output, null, 2),
    "utf-8",
  );

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
      html: pageId
        ? {
            kind: "page",
            htmlId: html.id,
            pageId,
            template: html.template,
            fileName: html.fileName,
            assets,
          }
        : {
            kind: "app",
            htmlId: html.id,
            appId: appId ?? "default",
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
    const graph: AppGraph = {
      version: 1,
      rootDir: process.cwd(),
      apps: {},
      pages: {
        home: {
          id: "home",
          path: "/",
          component: "./src/pages/Home.tsx",
          html: "./index.html",
          render: "ssr",
        },
      },
      routes: [
        {
          id: "home",
          path: "/",
          pageId: "home",
        },
      ],
      serverFunctions: [],
      serverRoutes: [],
    };

    const rules = webpackAdapterTesting.createDevProxyRules(config, graph);
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
        "src/pages/Home ! page 中文.tsx": `
        import { createElement } from "react";

        export default function Home() {
          return createElement("h1", null, "Home");
        }
      `,
      });
      const config = resolveConfig<WebpackConfig>({
        server: false,
        pages: {
          home: {
            component: "./src/pages/Home ! page 中文.tsx",
            html: "./index.html",
            mount: "#root",
          },
        },
      });
      const analysis = await createAppGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });

      await buildWithFrameworkArtifacts({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        hooks: [],
      });

      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
      ) as BuildOutput;
      const html = await fs.readFile(path.join(cwd, "dist/home.html"), "utf-8");
      const bundle = await fs.readFile(path.join(cwd, "dist/home.js"), "utf-8");

      expect(plan.entries[0]?.import).toBe("./src/pages/Home ! page 中文.tsx");
      expect(plan.entries[0]?.metadata).toMatchObject({
        type: "react-component-page",
        component: "./src/pages/Home ! page 中文.tsx",
        mount: "#root",
      });
      expect(manifest.pages.home).toMatchObject({
        assets: { js: ["home.js"], css: [] },
        component: "./src/pages/Home ! page 中文.tsx",
        mount: "#root",
        render: "csr",
        module: {
          type: "react-component",
          href: "home.js",
          source: "./src/pages/Home ! page 中文.tsx",
        },
      });
      expect(html).toContain('data-evjs-kind="page"');
      expect(html).toContain('data-evjs-id="home"');
      expect(html).toContain('src="/home.js"');
      expect(bundle).toContain("registerShellModule");
      expect(bundle).toContain("data-evjs-shell-load");
      await expect(fs.access(path.join(cwd, ".evjs"))).rejects.toThrow();
    },
  );

  buildIt(
    "builds app client, server runtime, and route-derived SSR page entries",
    async () => {
      const cwd = await createFixture({
        "index.html":
          '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
        "src/main.ts": "console.log('client app');",
        "src/server.ts": `
        import { createApp } from "@evjs/server";
        import { createReactFrameworkServer } from "@evjs/server/react";

        const app = createApp({
          framework: createReactFrameworkServer(),
        });

        export default { fetch: app.fetch };
      `,
        "src/pages/Dashboard !page 中文.ts": `
        export const render = "ssr";
        export const hydrate = "load";

        export default function Dashboard() {
          return "dashboard";
        }
      `,
      });
      const baseConfig = resolveConfig<WebpackConfig>({
        entry: "./src/main.ts",
        routing: true,
        server: {
          entry: "./src/server.ts",
        },
      });
      const routing = requireRouting(baseConfig.routing);
      const config = {
        ...baseConfig,
        routing: {
          ...routing,
          entry: "./src/main.ts",
          routes: [
            {
              id: "dashboard",
              path: "/dashboard",
              module: "./src/pages/Dashboard !page 中文.ts",
            },
          ],
        },
      };
      const analysis = await createAppGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });
      const onBuildOutput = vi.fn((output: BuildOutput) => {
        output.assets.plugin = { js: ["plugin.js"], css: [] };
      });

      await buildWithFrameworkArtifacts({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        hooks: [
          {
            transformHtml(doc, ctx) {
              const meta = doc.createElement("meta");
              meta.setAttribute("name", "html-kind");
              meta.setAttribute("content", ctx.kind);
              doc.head?.appendChild(meta);
            },
          },
        ],
        onBuildOutput,
      });

      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
      ) as BuildOutput;
      const html = await fs.readFile(
        path.join(cwd, "dist/client/index.html"),
        "utf-8",
      );

      expect(onBuildOutput).toHaveBeenCalledTimes(1);
      expect(manifest.apps.default).toEqual({
        assets: {
          js: ["main.js"],
          css: [],
        },
        entry: "./src/main.ts",
        mount: "#app",
        document: {
          fileName: "index.html",
        },
        module: {
          type: "entry",
          href: "main.js",
          source: "./src/main.ts",
        },
      });
      expect(manifest.pages.dashboard).toMatchObject({
        assets: {
          js: [],
          css: [],
        },
        component: "./src/pages/Dashboard !page 中文.ts",
        hydrate: "load",
        render: "ssr",
        routeId: "dashboard",
      });
      expect(manifest.routes).toContainEqual({
        id: "dashboard",
        path: "/dashboard",
        appId: "default",
        pageId: "dashboard",
        module: "./src/pages/Dashboard !page 中文.ts",
        render: "ssr",
        hydrate: "load",
      });
      expect(manifest.assets["dashboard-server"]).toEqual({
        js: ["dashboard-server.cjs"],
        css: [],
      });
      expect(manifest.server?.entry).toBe("server.cjs");
      expect(manifest.assets.plugin).toEqual({ js: ["plugin.js"], css: [] });
      expect(html).toContain('src="/main.js"');
      expect(html).toContain('data-evjs-kind="app"');
      expect(html).toContain('data-evjs-id="default"');
      expect(html).toContain('<meta name="html-kind" content="app">');
      const response = await requestServerEntry(cwd, manifest, "/dashboard");
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<div id="app">dashboard</div>');
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
        "src/main.ts": "console.log('client app');",
        "src/pages/Dashboard.ts": `
        import { createElement } from "react";

        export const render = "ssr";
        export const hydrate = "load";

        export default function Dashboard({ pageId }: { pageId?: string }) {
          return createElement("h1", null, "SSR ", pageId);
        }
      `,
      });
      const baseConfig = resolveConfig<WebpackConfig>({
        entry: "./src/main.ts",
        routing: true,
      });
      const routing = requireRouting(baseConfig.routing);
      const config = {
        ...baseConfig,
        routing: {
          ...routing,
          entry: "./src/main.ts",
          routes: [
            {
              id: "dashboard",
              path: "/dashboard",
              module: "./src/pages/Dashboard.ts",
            },
          ],
        },
      };
      const analysis = await createAppGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });

      await buildWithFrameworkArtifacts({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        hooks: [],
      });

      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
      ) as BuildOutput;
      const response = await requestServerEntry(cwd, manifest, "/dashboard");

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(
        '<div id="app"><h1>SSR <!-- -->dashboard</h1></div>',
      );
    },
  );

  buildIt(
    "builds RSC pages with React Flight manifests and endpoint renderer",
    async () => {
      const cwd = await createFixture({
        "index.html":
          '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
        "src/pages/Insights !page.tsx": `
        import { createElement } from "react";
        import { usePageParams, usePageSearch } from "@evjs/client";
        import "./insights.css";
        import Badge from "./InsightsBadge";

        export const render = "ssr";
        export const rsc = true;

        export default function Insights() {
          const params = usePageParams<{ section: string }>();
          const search = usePageSearch<{ tab?: string }>();
          return createElement("main", null,
            createElement("h1", null, "RSC ", params.section, " ", search.tab),
            createElement(Badge, null),
          );
        }
      `,
        "src/pages/insights.css": `
        .insights-page {
          color: #123456;
        }
      `,
        "src/pages/InsightsBadge.tsx": `
        "use client";

        import { createElement } from "react";

        export default function InsightsBadge() {
          return createElement("span", null, "Client Badge");
        }
      `,
      });
      const config = resolveConfig<WebpackConfig>({
        pages: {
          insights: {
            path: "/insights/$section",
            component: "./src/pages/Insights !page.tsx",
            html: "./index.html",
          },
        },
      });
      const analysis = await createAppGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });

      await buildWithFrameworkArtifacts({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        hooks: [],
      });

      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
      ) as BuildOutput;
      const clientReferenceManifest = JSON.parse(
        await fs.readFile(
          path.join(cwd, "dist/client/react-client-manifest.json"),
          "utf-8",
        ),
      );
      const serverConsumerManifest = JSON.parse(
        await fs.readFile(
          path.join(cwd, "dist/client/react-ssr-manifest.json"),
          "utf-8",
        ),
      );
      const badgeFileUrl = pathToFileURL(
        await fs.realpath(path.join(cwd, "src/pages/InsightsBadge.tsx")),
      ).href;

      expect(plan.entries.map((entry) => entry.name)).toEqual(
        expect.arrayContaining([
          "evjs-rsc-client",
          "insights-server",
          "insights-rsc",
        ]),
      );
      expect(manifest.rsc?.clientReferenceManifest).toEqual(
        clientReferenceManifest,
      );
      expect(manifest.rsc?.serverConsumerManifest).toEqual(
        serverConsumerManifest,
      );
      expect(Object.keys(clientReferenceManifest)).toEqual(
        expect.arrayContaining([badgeFileUrl]),
      );
      expect(manifest.rsc?.pages?.insights).toEqual(
        expect.objectContaining({
          renderer: "insights-rsc",
          component: "./src/pages/Insights !page.tsx",
        }),
      );
      expect(manifest.server?.renderers?.["insights-server"]).toMatchObject({
        kind: "page-server",
        assets: { js: ["insights-server.cjs"], css: ["insights-server.css"] },
      });
      expect(manifest.server?.renderers?.["insights-rsc"]).toMatchObject({
        kind: "rsc-page",
        assets: { js: ["insights-rsc.cjs"], css: ["insights-rsc.css"] },
      });
      expect(manifest.pages.insights.assets).toEqual({
        js: ["evjs-rsc-client.js"],
        css: expect.arrayContaining([
          "insights-server.css",
          "insights-rsc.css",
        ]),
      });
      await expect(
        fs.readFile(path.join(cwd, "dist/client/insights-rsc.css"), "utf-8"),
      ).resolves.toContain(".insights-page");

      const htmlResponse = await requestServerEntry(
        cwd,
        manifest,
        "/insights/weekly?tab=overview&tag=a&tag=b",
      );
      expect(htmlResponse.status).toBe(200);
      const html = await htmlResponse.text();
      expect(html).toContain("RSC");
      expect(html).toContain("weekly");
      expect(html).toContain("overview");
      expect(html).toContain(
        '<link rel="stylesheet" href="/insights-rsc.css">',
      );

      const flightResponse = await requestServerEntry(
        cwd,
        manifest,
        "/__evjs/rsc?page=insights&url=%2Finsights%2Fweekly%3Ftab%3Doverview%26tag%3Da%26tag%3Db",
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
        "src/pages/Campaign.tsx": `
        import { lazy, Suspense } from "react";

        const OfferRegion = lazy(() => import("./Offer.tsx"));

        export const render = "ssr";
        export const prerender = { partial: true };

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
        "src/pages/Offer.tsx": `
        import { createElement } from "react";

        export const cache = "no-store";

        export default function Offer() {
          return createElement("section", null, "Offer region");
        }
      `,
      });
      const config = resolveConfig<WebpackConfig>({
        pages: {
          campaign: {
            component: "./src/pages/Campaign.tsx",
            html: "./index.html",
          },
        },
      });
      const analysis = await createAppGraph(config, cwd);
      const plan = createBuildPlan(config, analysis.graph, {
        mode: "development",
      });

      await buildWithFrameworkArtifacts({
        config,
        cwd,
        graph: analysis.graph,
        plan,
        hooks: [],
      });

      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
      ) as BuildOutput;
      const campaignRegionId = getSinglePprRegionId(
        manifest.pages.campaign.ppr?.regions,
      );
      const campaignRegionRenderer = `campaign-${campaignRegionId}-ppr-region`;
      const campaignRegionAsset = `${campaignRegionRenderer}.cjs`;

      expect(manifest.pages.campaign.ppr).toMatchObject({
        delivery: "merge",
        shell: { js: ["campaign-ppr-shell.cjs"], css: [] },
        regions: {
          [campaignRegionId]: {
            id: campaignRegionId,
            assets: { js: [campaignRegionAsset], css: [] },
            component: "./src/pages/Offer.tsx",
            cache: "no-store",
          },
        },
      });
      expect(manifest.server?.renderers?.["campaign-ppr-shell"]).toMatchObject({
        kind: "ppr-shell",
        owner: { pageId: "campaign" },
        module: "./src/pages/Campaign.tsx",
        assets: { js: ["campaign-ppr-shell.cjs"], css: [] },
      });
      expect(
        manifest.server?.renderers?.[campaignRegionRenderer],
      ).toMatchObject({
        kind: "ppr-region",
        owner: { pageId: "campaign", regionId: campaignRegionId },
        module: "./src/pages/Offer.tsx",
        assets: { js: [campaignRegionAsset], css: [] },
      });

      const shellResponse = await requestServerEntry(
        cwd,
        manifest,
        "/campaign",
      );
      expect(shellResponse.status).toBe(200);
      expect(await shellResponse.text()).toContain(
        "<main>Campaign <!-- -->campaign<section>Offer region</section></main>",
      );

      const regionResponse = await requestServerEntry(
        cwd,
        manifest,
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
      "src/pages/Home.tsx": `
        import { createElement } from "react";

        export default function Home() {
          return createElement("h1", null, "Home");
        }
      `,
    });
    const config = resolveConfig<WebpackConfig>({
      server: false,
      dev: { port },
      pages: {
        home: {
          component: "./src/pages/Home.tsx",
          html: "./index.html",
          mount: "#root",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
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
      graph: analysis.graph,
      plan,
      hooks: [],
      callbacks: framework.callbacks,
    });
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
      ) as BuildOutput;
      const html = await fetchDevText(`http://127.0.0.1:${port}/home.html`);

      expect(onBuildOutput).toHaveBeenCalledTimes(1);
      expect(manifest.distDir).toBe("dist");
      expect(manifest.pages.home.assets.js).toEqual(["home.js"]);
      expect(html).toContain('data-evjs-kind="page"');
      expect(html).toContain('data-evjs-id="home"');
      expect(html).toContain('src="/home.js"');
    } finally {
      await controller?.close?.();
    }
  });

  devIt(WEBPACK_DEV_TEST_NAMES.apiRewrite, async () => {
    const port = await getAvailablePort();
    const cwd = await createFixture({
      "index.html":
        '<!doctype html><html><head></head><body><div id="app">app shell</div></body></html>',
      "src/main.tsx": `console.log("spa");`,
    });
    const config = resolveConfig<WebpackConfig>({
      server: false,
      dev: { port },
      entry: "./src/main.tsx",
      html: "./index.html",
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
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
      graph: analysis.graph,
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
      "src/pages/Home.tsx": `
        import { createElement } from "react";

        export default function Home() {
          return createElement("h1", null, "Home");
        }
      `,
    });
    const config = resolveConfig<WebpackConfig>({
      server: false,
      dev: { port },
      pages: {
        home: {
          component: "./src/pages/Home.tsx",
          html: "./index.html",
          mount: "#root",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
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
      graph: analysis.graph,
      plan,
      hooks,
      callbacks: framework.callbacks,
    });
    try {
      const nextConfig = resolveConfig<WebpackConfig>({
        server: false,
        dev: { port },
        pages: {
          home: {
            component: "./src/pages/Home.tsx",
            html: "./next.html",
            mount: "#root",
          },
        },
      });
      const nextAnalysis = await createAppGraph(nextConfig, cwd);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
      });
      const update = diffBuildPlan(plan, nextPlan, "config");

      failBundlerConfig = true;
      framework.update(nextAnalysis.graph, nextPlan);
      await controller?.updatePlan(update, nextAnalysis.graph);

      const html = await fetchDevText(`http://127.0.0.1:${port}/home.html`);

      expect(update.entries.added).toHaveLength(0);
      expect(update.entries.changed).toHaveLength(0);
      expect(update.html.changed.map((item) => item.id)).toEqual(["home"]);
      expect(html).toContain("next-shell");
      expect(html).toContain('src="/home.js"');
    } finally {
      await controller?.close?.();
    }
  });

  devIt(WEBPACK_DEV_TEST_NAMES.rollback, async () => {
    const port = await getAvailablePort();
    const cwd = await createFixture({
      "index.html":
        '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
      "src/pages/Home.tsx": `
        import { createElement } from "react";

        export default function Home() {
          return createElement("h1", null, "Home");
        }
      `,
      "src/pages/About.tsx": `
        import { createElement } from "react";

        export default function About() {
          return createElement("h1", null, "About");
        }
      `,
    });
    const config = resolveConfig<WebpackConfig>({
      server: false,
      dev: { port },
      pages: {
        home: {
          component: "./src/pages/Home.tsx",
          html: "./index.html",
          mount: "#root",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
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
      graph: analysis.graph,
      plan,
      hooks,
      callbacks: framework.callbacks,
    });
    try {
      const nextConfig = resolveConfig<WebpackConfig>({
        server: false,
        dev: { port },
        pages: {
          home: {
            component: "./src/pages/Home.tsx",
            html: "./index.html",
            mount: "#root",
          },
          about: {
            component: "./src/pages/About.tsx",
            html: "./index.html",
            mount: "#root",
          },
        },
      });
      const nextAnalysis = await createAppGraph(nextConfig, cwd);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
      });
      const update = diffBuildPlan(plan, nextPlan, "config");

      failBundlerConfig = true;
      await expect(
        controller?.updatePlan(update, nextAnalysis.graph),
      ).rejects.toThrow("forced update failure");

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
      "src/pages/Home.tsx": `
        import { createElement } from "react";

        export default function Home() {
          return createElement("h1", null, "Home");
        }
      `,
    });
    const config = resolveConfig<WebpackConfig>({
      server: false,
      dev: { port },
      pages: {
        home: {
          component: "./src/pages/Home.tsx",
          html: "./index.html",
          mount: "#root",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
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
      graph: analysis.graph,
      plan,
      hooks: [],
      callbacks: framework.callbacks,
    });
    const stopSpy = vi.spyOn(
      controller as unknown as { stop(): Promise<void> },
      "stop",
    );

    try {
      await fs.writeFile(
        path.join(cwd, "src/pages/About.tsx"),
        `
          import { createElement } from "react";

          export default function About() {
            return createElement("h1", null, "About");
          }
        `,
        "utf-8",
      );

      const nextConfig = resolveConfig<WebpackConfig>({
        server: false,
        dev: { port },
        pages: {
          home: {
            component: "./src/pages/Home.tsx",
            html: "./index.html",
            mount: "#root",
          },
          about: {
            component: "./src/pages/About.tsx",
            html: "./index.html",
            mount: "#root",
          },
        },
      });
      const nextAnalysis = await createAppGraph(nextConfig, cwd);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
      });
      const update = diffBuildPlan(plan, nextPlan, "config");
      const buildOutputCallsBeforeUpdate = onBuildOutput.mock.calls.length;

      framework.update(nextAnalysis.graph, nextPlan);
      await controller?.updatePlan(update, nextAnalysis.graph);

      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
      ) as BuildOutput;
      const html = await fetchDevText(`http://127.0.0.1:${port}/about.html`);

      expect(update.entries.added.map((entry) => entry.name)).toEqual([
        "about",
      ]);
      expect(manifest.pages.about.assets.js).toEqual(["about.js"]);
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
  const runtimeGlobals = globalThis as ServerRuntimeGlobals;
  runtimeGlobals.__EVJS_MANIFEST__ = manifest;
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
    delete runtimeGlobals.__EVJS_MANIFEST__;
    delete runtimeGlobals.__EVJS_SERVER_MODULE_LOADER__;
  }
}
