import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AppGraph,
  BuildOutput,
  BuildPlan,
  BundlerBuildFacts,
  PluginHooks,
} from "@evjs/ev";
import {
  buildHtml,
  createPublicManifest,
  createServerManifest,
  linkBuildOutput,
  type ResolvedConfig,
  resolveConfig,
} from "@evjs/ev";
import {
  createAppGraph,
  createBuildPlan,
  diffBuildPlan,
  generateHtml,
} from "@evjs/ev/build-tools";
import type { ConfigComplete } from "@utoo/pack";
import { afterEach, describe, expect, it, vi } from "vitest";
import { utoopackAdapter } from "../src/adapter/index.js";

vi.mock("@utoo/pack", () => ({
  serve: vi.fn(async ({ config }) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const clientOutDir = config.output.path;

    await fs.promises.mkdir(clientOutDir, { recursive: true });
    await fs.promises.writeFile(path.join(clientOutDir, "main.js"), "");
    await fs.promises.writeFile(path.join(clientOutDir, "main.css"), "");
    await fs.promises.writeFile(
      path.join(clientOutDir, "stats.json"),
      JSON.stringify({
        entrypoints: {
          main: {
            assets: [{ name: "main.js" }, { name: "main.css" }],
          },
        },
      }),
    );

    if (config.server) {
      const serverOutDir = config.server.output.path;
      await fs.promises.mkdir(serverOutDir, { recursive: true });
      await fs.promises.writeFile(path.join(serverOutDir, "index.js"), "");
      await fs.promises.writeFile(
        path.join(serverOutDir, "stats.json"),
        JSON.stringify({
          entrypoints: {
            main: {
              assets: [{ name: "index.js" }],
            },
          },
        }),
      );
    }
  }),
  build: vi.fn(),
}));

const tempDirs: string[] = [];

async function makeProject() {
  const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "evjs-dev-"));
  tempDirs.push(cwd);
  await fs.promises.mkdir(path.join(cwd, "src"), { recursive: true });
  await fs.promises.writeFile(
    path.join(cwd, "index.html"),
    '<!doctype html><html><head></head><body><div id="app"></div></body></html>',
    "utf-8",
  );
  await fs.promises.writeFile(
    path.join(cwd, "src/main.tsx"),
    "console.log('client');",
    "utf-8",
  );
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.promises.rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function createFrameworkCallbacks(options: {
  config: ResolvedConfig<ConfigComplete>;
  cwd: string;
  graph: AppGraph;
  plan: BuildPlan;
  hooks?: PluginHooks<ConfigComplete>[];
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
    async onBuildFacts(facts: BundlerBuildFacts) {
      const output = linkBuildOutput({
        graph,
        plan,
        clientEntryAssets: facts.clientEntryAssets,
        firstClientEntryAssets: facts.firstClientEntryAssets,
        serverEntryAssets: facts.serverEntryAssets,
        serverEntry: facts.serverEntry,
        serverAssets: facts.serverAssets,
        serverModules: facts.serverModules,
      });
      await options.onBuildOutput?.(output);

      const rootDir = path.join(options.cwd, plan.distDir);
      const clientDir = path.resolve(options.cwd, plan.output.clientDir);
      await fs.promises.mkdir(rootDir, { recursive: true });
      const serverDir = path.join(rootDir, "server");
      await fs.promises.mkdir(serverDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(serverDir, "manifest.json"),
        JSON.stringify(createServerManifest(output), null, 2),
        "utf-8",
      );
      await fs.promises.writeFile(
        path.join(rootDir, "build-output.json"),
        JSON.stringify(output, null, 2),
        "utf-8",
      );
      await fs.promises.mkdir(clientDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(clientDir, "manifest.json"),
        JSON.stringify(createPublicManifest(output), null, 2),
        "utf-8",
      );

      for (const html of plan.html) {
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
          hooks,
          pluginContext: {
            mode: plan.mode,
            command: "dev",
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
        });
        const outPath = path.join(clientDir, html.fileName);
        await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
        await fs.promises.writeFile(outPath, finalHtml, "utf-8");
      }
    },
    onServerBundleReady: options.onServerBundleReady ?? vi.fn(),
  };
}

async function expectRejectedMessage(action: () => void | Promise<void>) {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  return (thrown as Error).message;
}

describe("utoopackAdapter dev", () => {
  it("emits flat CSR manifest and index.html in flat output mode", async () => {
    const cwd = await makeProject();
    const config = resolveConfig<ConfigComplete>({
      output: { client: "dist" },
      entry: "./src/main.tsx",
      html: "./index.html",
    });

    const onBuildOutput = vi.fn((output: BuildOutput) => {
      output.assets.devHook = { js: ["dev-hook.js"], css: [] };
    });
    const buildContext = await createBuildContext(config, cwd);
    const hooks: PluginHooks<ConfigComplete>[] = [
      {
        transformHtml(doc) {
          const meta = doc.createElement("meta");
          meta.setAttribute("name", "mode");
          meta.setAttribute("content", "dev");
          doc.head?.appendChild(meta);
        },
      },
    ];

    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      ...buildContext,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
        hooks,
        onBuildOutput,
      }),
      hooks,
    });

    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
    );
    const html = await fs.promises.readFile(
      path.join(cwd, "dist/index.html"),
      "utf-8",
    );

    expect(manifest.assets).toEqual({
      main: {
        js: ["main.js"],
        css: ["main.css"],
      },
    });
    expect(onBuildOutput).toHaveBeenCalledTimes(1);
    expect(onBuildOutput.mock.calls[0]?.[0].assets.devHook).toEqual({
      js: ["dev-hook.js"],
      css: [],
    });
    expect(manifest.apps.default).toEqual({
      assets: {
        js: ["main.js"],
        css: ["main.css"],
      },
      document: { fileName: "index.html" },
      module: {
        type: "entry",
        href: "main.js",
      },
    });
    expect(html).toContain('<link rel="stylesheet" href="/main.css">');
    expect(html).toContain('src="/main.js"');
    expect(html).toContain('data-evjs-kind="app"');
    expect(html).toContain('data-evjs-id="default"');
    expect(html).toContain('<meta name="mode" content="dev">');
    expect(fs.existsSync(path.join(cwd, "dist/client"))).toBe(false);
    expect(controller).toBeDefined();
    if (!controller) throw new Error("Expected Utoopack dev controller");
    await expect(
      controller.updatePlan(
        diffBuildPlan(buildContext.plan, buildContext.plan, "config"),
      ),
    ).resolves.toBeUndefined();
    await controller.close?.();
  });

  it("emits dev artifacts under the configured client output directory", async () => {
    const cwd = await makeProject();
    const config = resolveConfig<ConfigComplete>({
      output: { client: "custom-dist", server: "custom-dist/server" },
      entry: "./src/main.tsx",
      html: "./index.html",
    });
    const buildContext = await createBuildContext(config, cwd, {
      distDir: "custom-dist",
    });

    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      ...buildContext,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
      }),
      hooks: [],
    });

    const manifestPath = path.join(cwd, "custom-dist/manifest.json");
    const htmlPath = path.join(cwd, "custom-dist/index.html");

    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(htmlPath)).toBe(true);
    expect(fs.existsSync(path.join(cwd, "dist/manifest.json"))).toBe(false);
    expect(controller).toBeDefined();
    await controller?.close?.();
  });

  it("applies html-only plan updates without restarting Utoopack dev", async () => {
    const cwd = await makeProject();
    await fs.promises.writeFile(
      path.join(cwd, "next.html"),
      '<!doctype html><html><head></head><body><main id="app">next-shell</main></body></html>',
      "utf-8",
    );
    const config = resolveConfig<ConfigComplete>({
      output: { client: "dist" },
      pages: {
        home: {
          component: "./src/main.tsx",
          html: "./index.html",
          mount: "#app",
        },
      },
    });
    const buildContext = await createBuildContext(config, cwd);
    const onBuildOutput = vi.fn();
    const framework = createFrameworkCallbacks({
      config,
      cwd,
      ...buildContext,
      onBuildOutput,
    });

    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      ...buildContext,
      callbacks: framework,
      hooks: [],
    });
    if (!controller) throw new Error("Expected Utoopack dev controller");

    try {
      const nextConfig = resolveConfig<ConfigComplete>({
        output: { client: "dist" },
        pages: {
          home: {
            component: "./src/main.tsx",
            html: "./next.html",
            mount: "#app",
          },
        },
      });
      const nextAnalysis = await createAppGraph(nextConfig, cwd);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
      });
      const update = diffBuildPlan(buildContext.plan, nextPlan, "config");

      framework.update(nextAnalysis.graph, nextPlan);
      await controller.updatePlan(update, nextAnalysis.graph);

      const html = await fs.promises.readFile(
        path.join(cwd, "dist/home.html"),
        "utf-8",
      );
      const manifest = JSON.parse(
        await fs.promises.readFile(
          path.join(cwd, "dist/manifest.json"),
          "utf-8",
        ),
      ) as BuildOutput;

      expect(update.entries.added).toHaveLength(0);
      expect(update.entries.changed).toHaveLength(0);
      expect(update.html.changed.map((item) => item.id)).toEqual(["home"]);
      expect(html).toContain("next-shell");
      expect(html).toContain('data-evjs-kind="page"');
      expect(html).toContain('data-evjs-id="home"');
      expect(manifest.pages.home.document).toEqual({ fileName: "home.html" });
      expect(onBuildOutput).toHaveBeenCalledTimes(2);
    } finally {
      await controller.close?.();
    }
  });

  it("fails clearly for entry-changing dev plan updates", async () => {
    const cwd = await makeProject();
    const config = resolveConfig<ConfigComplete>({
      output: { client: "dist" },
      pages: {
        home: {
          component: "./src/main.tsx",
          html: "./index.html",
          mount: "#app",
        },
      },
    });
    const buildContext = await createBuildContext(config, cwd);
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      ...buildContext,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
      }),
      hooks: [],
    });
    if (!controller) throw new Error("Expected Utoopack dev controller");

    try {
      const nextConfig = resolveConfig<ConfigComplete>({
        output: { client: "dist" },
        pages: {
          home: {
            component: "./src/main.tsx",
            html: "./index.html",
            mount: "#app",
          },
          about: {
            component: "./src/main.tsx",
            html: "./index.html",
            mount: "#app",
          },
        },
      });
      const nextAnalysis = await createAppGraph(nextConfig, cwd);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
      });
      const update = diffBuildPlan(buildContext.plan, nextPlan, "config");

      const message = await expectRejectedMessage(() =>
        controller.updatePlan(update, nextAnalysis.graph),
      );
      expect(message).toContain(
        "Utoopack dev cannot apply framework plan changes",
      );
      expect(message).toContain("entry additions: about (page-client)");
      expect(message).toContain("HTML additions: about -> about.html");
    } finally {
      await controller.close?.();
    }
  });

  it("reports server-changing dev plan updates", async () => {
    const cwd = await makeProject();
    const config = resolveConfig<ConfigComplete>({
      output: { client: "dist" },
      entry: "./src/main.tsx",
      html: "./index.html",
    });
    const buildContext = await createBuildContext(config, cwd);
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      ...buildContext,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
      }),
      hooks: [],
    });
    if (!controller) throw new Error("Expected Utoopack dev controller");

    try {
      const nextConfig = resolveConfig<ConfigComplete>({
        entry: "./src/main.tsx",
        html: "./index.html",
      });
      const nextAnalysis = await createAppGraph(nextConfig, cwd);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
      });
      const update = diffBuildPlan(buildContext.plan, nextPlan, "config");

      const message = await expectRejectedMessage(() =>
        controller.updatePlan(update, nextAnalysis.graph),
      );
      expect(message).toContain(
        "Utoopack dev cannot apply framework plan changes",
      );
      expect(message).toContain("server output changed");
    } finally {
      await controller.close?.();
    }
  });

  it("emits split build manifests plus index.html in fullstack mode", async () => {
    const cwd = await makeProject();
    const onServerBundleReady = vi.fn();
    const config = resolveConfig<ConfigComplete>({
      entry: "./src/main.tsx",
      html: "./index.html",
    });
    const buildContext = await createBuildContext(config, cwd);
    const hooks: PluginHooks<ConfigComplete>[] = [
      {
        transformHtml(doc, ctx) {
          const meta = doc.createElement("meta");
          expect(ctx.kind).toBe("app");
          expect(ctx.htmlId).toBe("index");
          expect(ctx.fileName).toBe("index.html");
          expect(ctx.mode).toBe("development");
          expect(ctx.buildId).toBe(ctx.output.buildId);
          expect(ctx.publicPath).toBe(ctx.output.publicPath);
          meta.setAttribute("name", "server");
          doc.head?.appendChild(meta);
        },
      },
    ];

    await utoopackAdapter.dev({
      config,
      cwd,
      ...buildContext,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
        hooks,
        onServerBundleReady,
      }),
      hooks,
    });

    const buildOutput = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/build-output.json"),
        "utf-8",
      ),
    );
    const serverManifest = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/server/manifest.json"),
        "utf-8",
      ),
    );
    const publicManifest = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/client/manifest.json"),
        "utf-8",
      ),
    );
    const html = await fs.promises.readFile(
      path.join(cwd, "dist/client/index.html"),
      "utf-8",
    );

    expect(buildOutput.apps.default).toEqual({
      assets: {
        js: ["main.js"],
        css: ["main.css"],
      },
      document: { fileName: "index.html" },
      entry: "./src/main.tsx",
      module: {
        type: "entry",
        href: "main.js",
        source: "./src/main.tsx",
      },
    });
    expect(serverManifest.entry).toBe("index.js");
    expect(publicManifest.apps.default.entry).toBeUndefined();
    expect(publicManifest.apps.default.module).toEqual({
      type: "entry",
      href: "main.js",
    });
    expect(fs.existsSync(path.join(cwd, "dist/manifest.json"))).toBe(false);
    expect(html).toContain('<link rel="stylesheet" href="/main.css">');
    expect(html).toContain('src="/main.js"');
    expect(html).toContain('data-evjs-kind="app"');
    expect(html).toContain('data-evjs-id="default"');
    expect(html).toContain('<meta name="server">');
    expect(onServerBundleReady).toHaveBeenCalledTimes(1);
  });
});

async function createBuildContext(
  config: ResolvedConfig<ConfigComplete>,
  cwd: string,
  options: { distDir?: string } = {},
) {
  const analysis = await createAppGraph(config, cwd);
  return {
    graph: analysis.graph,
    plan: createBuildPlan(config, analysis.graph, {
      mode: "development",
      distDir: options.distDir,
    }),
  };
}
