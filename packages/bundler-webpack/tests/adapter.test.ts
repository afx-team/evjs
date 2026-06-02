import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BuildOutput } from "@evjs/ev";
import { resolveConfig } from "@evjs/ev";
import {
  createAppGraph,
  createBuildPlan,
  diffBuildPlan,
} from "@evjs/ev/build-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebpackConfig } from "../src/adapter/create-config.js";
import { webpackAdapter } from "../src/index.js";

const tempDirs: string[] = [];
const require = createRequire(import.meta.url);

type ServerRuntimeGlobals = typeof globalThis & {
  __EVJS_MANIFEST__?: BuildOutput;
  __EVJS_SERVER_MODULE_LOADER__?: (
    asset: string,
  ) => Promise<Record<string, unknown>>;
};

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

describe("webpackAdapter build", () => {
  it("builds framework-managed component pages without materializing .evjs files", async () => {
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
      pages: {
        home: {
          component: "./src/pages/Home.tsx",
          html: "./index.html",
          render: "csr",
          mount: "#root",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    await webpackAdapter.build({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      hooks: [],
      callbacks: {
        onBuildOutput() {},
      },
    });

    const manifest = JSON.parse(
      await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
    ) as BuildOutput;
    const html = await fs.readFile(path.join(cwd, "dist/home.html"), "utf-8");
    const bundle = await fs.readFile(path.join(cwd, "dist/home.js"), "utf-8");

    expect(plan.entries[0]?.import).toBe("./src/pages/Home.tsx");
    expect(plan.entries[0]?.metadata).toMatchObject({
      type: "react-component-page",
      component: "./src/pages/Home.tsx",
      mount: "#root",
    });
    expect(manifest.pages.home).toMatchObject({
      assets: { js: ["home.js"], css: [] },
      component: "./src/pages/Home.tsx",
      mount: "#root",
      render: "csr",
      module: {
        type: "react-component",
        href: "home.js",
        source: "./src/pages/Home.tsx",
      },
    });
    expect(html).toContain('data-evjs-kind="page"');
    expect(html).toContain('data-evjs-id="home"');
    expect(html).toContain('data-evjs-page="home"');
    expect(html).toContain('src="/home.js"');
    expect(bundle).toContain("registerShellModule");
    expect(bundle).toContain("data-evjs-shell-load");
    await expect(fs.access(path.join(cwd, ".evjs"))).rejects.toThrow();
  });

  it("builds remote client entries and emits a remote manifest", async () => {
    const cwd = await createFixture({
      "src/remote.ts": `
        export function mount(mountPoint: Element) {
          mountPoint.innerHTML = "<h2>Remote</h2>";
        }

        export function unmount(mountPoint: Element) {
          mountPoint.innerHTML = "";
        }
      `,
    });
    const config = resolveConfig<WebpackConfig>({
      server: false,
      remote: {
        name: "crm",
        baseUrl: "https://assets.example.com/crm/",
        shared: {
          "remote-react": {
            shareKey: "react",
            requiredVersion: ">=19 <20",
            singleton: true,
            strictVersion: true,
            eager: true,
          },
        },
        entries: {
          customers: {
            app: "./src/remote.ts",
            activeWhen: ["/crm/*"],
            mount: "#remote-root",
          },
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    await webpackAdapter.build({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      hooks: [],
      callbacks: {
        onBuildOutput() {},
      },
    });

    const manifest = JSON.parse(
      await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
    ) as BuildOutput;
    const remoteManifest = JSON.parse(
      await fs.readFile(path.join(cwd, "dist/evjs-remote.json"), "utf-8"),
    );
    const remoteBundle = await fs.readFile(
      path.join(cwd, "dist/crm-customers.js"),
      "utf-8",
    );

    expect(plan.html).toEqual([]);
    expect(manifest.apps).toEqual({});
    expect(remoteManifest).toEqual({
      version: 1,
      name: "crm",
      baseUrl: "https://assets.example.com/crm/",
      shared: {
        "remote-react": {
          shareKey: "react",
          requiredVersion: ">=19 <20",
          singleton: true,
          strictVersion: true,
          eager: true,
        },
      },
      entries: {
        customers: {
          assets: {
            js: ["crm-customers.js"],
            css: [],
          },
          module: {
            type: "lifecycle",
            href: "crm-customers.js",
            source: "./src/remote.ts",
          },
          activeWhen: ["/crm/*"],
          mount: "#remote-root",
        },
      },
    });
    expect(remoteBundle).toContain("registerShellModule");
    await expect(
      fs.access(path.join(cwd, "dist/index.html")),
    ).rejects.toThrow();
  });

  it("builds app client, server runtime, and route-owned SSR page entries", async () => {
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
      "src/routes.tsx": `
        import { defineReactRoutes, page, route } from "@evjs/client";

        export default defineReactRoutes([
          route("/dashboard", {
            id: "dashboard",
            page: page("./pages/Dashboard.ts"),
            render: "ssr",
            hydrate: "load",
          }),
        ]);
      `,
      "src/pages/Dashboard.ts": `
        export default function Dashboard() {
          return "dashboard";
        }
      `,
    });
    const config = resolveConfig<WebpackConfig>({
      entry: "./src/main.ts",
      html: "./index.html",
      apps: {
        default: {
          entry: "./src/main.ts",
          html: "./index.html",
          routes: "./src/routes.tsx",
        },
      },
      server: {
        entry: "./src/server.ts",
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });
    const onBuildOutput = vi.fn((output: BuildOutput) => {
      output.assets.plugin = { js: ["plugin.js"], css: [] };
    });

    await webpackAdapter.build({
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
      callbacks: {
        onBuildOutput,
      },
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
      routes: "./src/routes.tsx",
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
      component: "./src/pages/Dashboard.ts",
      hydrate: "load",
      render: "ssr",
      routeId: "dashboard",
    });
    expect(manifest.routes).toContainEqual({
      id: "dashboard",
      path: "/dashboard",
      appId: "default",
      pageId: "dashboard",
      module: "./src/pages/Dashboard.ts",
      render: "ssr",
      hydrate: "load",
    });
    expect(manifest.assets["dashboard-server"]).toEqual({
      js: ["dashboard-server.js"],
      css: [],
    });
    expect(manifest.server?.entry).toBe("server.js");
    expect(manifest.assets.plugin).toEqual({ js: ["plugin.js"], css: [] });
    expect(html).toContain('src="/main.js"');
    expect(html).toContain('data-evjs-kind="app"');
    expect(html).toContain('data-evjs-id="default"');
    expect(html).toContain('data-evjs-app="default"');
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
  });

  it("serves SSR React component pages through the default server runtime", async () => {
    const cwd = await createFixture({
      "index.html":
        '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
      "src/main.ts": "console.log('client app');",
      "src/routes.tsx": `
        import { defineReactRoutes, page, route } from "@evjs/client";

        export default defineReactRoutes([
          route("/dashboard", {
            id: "dashboard",
            page: page("./pages/Dashboard.ts"),
            render: "ssr",
            hydrate: "load",
          }),
        ]);
      `,
      "src/pages/Dashboard.ts": `
        import { createElement } from "react";

        export default function Dashboard({ pageId }: { pageId?: string }) {
          return createElement("h1", null, "SSR ", pageId);
        }
      `,
    });
    const config = resolveConfig<WebpackConfig>({
      entry: "./src/main.ts",
      html: "./index.html",
      apps: {
        default: {
          entry: "./src/main.ts",
          html: "./index.html",
          routes: "./src/routes.tsx",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    await webpackAdapter.build({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      hooks: [],
      callbacks: {
        onBuildOutput() {},
      },
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
  });

  it("builds RSC pages with React Flight manifests and endpoint renderer", async () => {
    const cwd = await createFixture({
      "index.html":
        '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
      "src/pages/Insights.tsx": `
        import { createElement } from "react";
        import Badge from "./InsightsBadge";

        export default function Insights({ pageId }: { pageId?: string }) {
          return createElement("main", null,
            createElement("h1", null, "RSC ", pageId),
            createElement(Badge, null),
          );
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
          path: "/insights",
          component: "./src/pages/Insights.tsx",
          html: "./index.html",
          render: "rsc",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    await webpackAdapter.build({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      hooks: [],
      callbacks: {
        onBuildOutput() {},
      },
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
        component: "./src/pages/Insights.tsx",
      }),
    );
    expect(manifest.server?.renderers?.["insights-server"]).toMatchObject({
      kind: "page-server",
      assets: { js: ["insights-server.js"], css: [] },
    });
    expect(manifest.server?.renderers?.["insights-rsc"]).toMatchObject({
      kind: "rsc-page",
      assets: { js: ["insights-rsc.js"], css: [] },
    });

    const htmlResponse = await requestServerEntry(cwd, manifest, "/insights");
    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toContain(
      "<h1>RSC <!-- -->insights</h1>",
    );

    const flightResponse = await requestServerEntry(
      cwd,
      manifest,
      "/__evjs/rsc?page=insights",
    );
    expect(flightResponse.status).toBe(200);
    expect(flightResponse.headers.get("content-type")).toContain(
      "text/x-component",
    );
    await expect(flightResponse.text()).resolves.toContain("RSC");
  });

  it("builds and serves PPR shell and region renderers through the default server runtime", async () => {
    const cwd = await createFixture({
      "index.html":
        '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
      "src/pages/Campaign.ts": `
        import { createElement } from "react";

        export default function Campaign({ pageId }: { pageId?: string }) {
          return createElement("main", null, "Campaign ", pageId);
        }
      `,
      "src/pages/Offer.ts": `
        import { createElement } from "react";

        export default function Offer() {
          return createElement("section", null, "Offer region");
        }
      `,
    });
    const config = resolveConfig<WebpackConfig>({
      pages: {
        campaign: {
          component: "./src/pages/Campaign.ts",
          html: "./index.html",
          render: "ppr",
          ppr: {
            regions: {
              offer: {
                component: "./src/pages/Offer.ts",
                cache: "no-store",
              },
            },
          },
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });

    await webpackAdapter.build({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      hooks: [],
      callbacks: {
        onBuildOutput() {},
      },
    });

    const manifest = JSON.parse(
      await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
    ) as BuildOutput;

    expect(manifest.pages.campaign.ppr).toMatchObject({
      shell: { js: ["campaign-ppr-shell.js"], css: [] },
      regions: {
        offer: {
          id: "offer",
          assets: { js: ["campaign-offer-ppr-region.js"], css: [] },
          component: "./src/pages/Offer.ts",
          cache: "no-store",
        },
      },
    });
    expect(manifest.server?.renderers?.["campaign-ppr-shell"]).toMatchObject({
      kind: "ppr-shell",
      owner: { pageId: "campaign" },
      module: "./src/pages/Campaign.ts",
      assets: { js: ["campaign-ppr-shell.js"], css: [] },
    });
    expect(
      manifest.server?.renderers?.["campaign-offer-ppr-region"],
    ).toMatchObject({
      kind: "ppr-region",
      owner: { pageId: "campaign", regionId: "offer" },
      module: "./src/pages/Offer.ts",
      assets: { js: ["campaign-offer-ppr-region.js"], css: [] },
    });

    const shellResponse = await requestServerEntry(cwd, manifest, "/campaign");
    expect(shellResponse.status).toBe(200);
    expect(await shellResponse.text()).toContain(
      "<main>Campaign <!-- -->campaign</main>",
    );

    const regionResponse = await requestServerEntry(
      cwd,
      manifest,
      "/__evjs/ppr/campaign/offer",
    );
    expect(regionResponse.status).toBe(200);
    expect(await regionResponse.text()).toContain(
      "<section>Offer region</section>",
    );
  });
});

describe("webpackAdapter dev", () => {
  it("starts webpack dev and emits framework manifest/html", async () => {
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
          render: "csr",
          mount: "#root",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });
    const onBuildOutput = vi.fn();

    const controller = await webpackAdapter.dev({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      hooks: [],
      callbacks: {
        onBuildOutput,
        onServerBundleReady() {},
      },
    });
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
      ) as BuildOutput;
      const html = await fetch(`http://127.0.0.1:${port}/home.html`).then(
        (res) => res.text(),
      );

      expect(onBuildOutput).toHaveBeenCalledTimes(1);
      expect(manifest.pages.home.assets.js).toEqual(["home.js"]);
      expect(html).toContain('data-evjs-page="home"');
      expect(html).toContain('src="/home.js"');
    } finally {
      await controller?.close?.();
    }
  });

  it("applies html-only plan updates without rebuilding webpack configs", async () => {
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
          render: "csr",
          mount: "#root",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });
    let failBundlerConfig = false;

    const controller = await webpackAdapter.dev({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      hooks: [
        {
          bundlerConfig() {
            if (failBundlerConfig) {
              throw new Error("html-only update should not rebuild webpack");
            }
          },
        },
      ],
      callbacks: {
        onBuildOutput() {},
        onServerBundleReady() {},
      },
    });
    try {
      const nextConfig = resolveConfig<WebpackConfig>({
        server: false,
        dev: { port },
        pages: {
          home: {
            component: "./src/pages/Home.tsx",
            html: "./next.html",
            render: "csr",
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
      await controller?.updatePlan(update, nextAnalysis.graph);

      const html = await fetch(`http://127.0.0.1:${port}/home.html`).then(
        (res) => res.text(),
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

  it("rolls back internal dev state when a plan update fails", async () => {
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
          render: "csr",
          mount: "#root",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });
    let failBundlerConfig = false;

    const controller = await webpackAdapter.dev({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      hooks: [
        {
          bundlerConfig() {
            if (failBundlerConfig) {
              throw new Error("forced update failure");
            }
          },
        },
      ],
      callbacks: {
        onBuildOutput() {},
        onServerBundleReady() {},
      },
    });
    try {
      const nextConfig = resolveConfig<WebpackConfig>({
        server: false,
        dev: { port },
        pages: {
          home: {
            component: "./src/pages/Home.tsx",
            html: "./index.html",
            render: "csr",
            mount: "#root",
          },
          about: {
            component: "./src/pages/About.tsx",
            html: "./index.html",
            render: "csr",
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

  it("applies page additions through updatePlan without restarting ev dev", async () => {
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
          render: "csr",
          mount: "#root",
        },
      },
    });
    const analysis = await createAppGraph(config, cwd);
    const plan = createBuildPlan(config, analysis.graph, {
      mode: "development",
    });
    const onBuildOutput = vi.fn();

    const controller = await webpackAdapter.dev({
      config,
      cwd,
      graph: analysis.graph,
      plan,
      hooks: [],
      callbacks: {
        onBuildOutput,
        onServerBundleReady() {},
      },
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
            render: "csr",
            mount: "#root",
          },
          about: {
            component: "./src/pages/About.tsx",
            html: "./index.html",
            render: "csr",
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

      await controller?.updatePlan(update, nextAnalysis.graph);

      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
      ) as BuildOutput;
      const html = await fetch(`http://127.0.0.1:${port}/about.html`).then(
        (res) => res.text(),
      );

      expect(update.entries.added.map((entry) => entry.name)).toEqual([
        "about",
      ]);
      expect(manifest.pages.about.assets.js).toEqual(["about.js"]);
      expect(html).toContain('data-evjs-page="about"');
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
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a port.")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
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
    const serverModule = require(serverEntryPath);
    const handler =
      serverModule.default?.default ?? serverModule.default ?? serverModule;
    return await handler.fetch(new Request(`https://example.com${pathname}`));
  } finally {
    delete runtimeGlobals.__EVJS_MANIFEST__;
    delete runtimeGlobals.__EVJS_SERVER_MODULE_LOADER__;
  }
}
