import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BundlerBuildFacts } from "@evjs/ev/_internal/build";
import {
  buildHtml,
  createBuildPlan,
  createCoreGraph,
  diffBuildPlan,
  generateHtml,
} from "@evjs/ev/_internal/build";
import {
  type Config,
  type ResolvedConfig,
  resolveConfig,
} from "@evjs/ev/config";
import type { PluginHooks } from "@evjs/ev/plugin";
import type { BuildOutput, BuildPlan, CoreGraph } from "@evjs/shared/manifest";
import {
  createDeploymentMetadata,
  createPublicManifest,
  linkBuildOutput,
} from "@evjs/shared/manifest";
import type { ConfigComplete } from "@utoo/pack";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPageRoutingDefaults } from "../../ev/esm/_internal/build/convention-config.js";
import { createClientRuntime } from "../../ev/src/_internal/build/framework-runtime.js";
import { utoopackAdapter } from "../src/adapter/index.js";

const utoopackMock = vi.hoisted(() => ({
  requireUtoopack: vi.fn(() => ({
    serve: vi.fn(async ({ config }, _projectPath, _rootPath, serverOptions) => {
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
      await serverOptions?.onReady?.({
        port: 3210,
        hostname: "0.0.0.0",
      });
    }),
    build: vi.fn(),
  })),
}));

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire(filename: string | URL) {
      const actualRequire = actual.createRequire(filename);
      const mockRequire = ((specifier: string) =>
        specifier === "@utoo/pack"
          ? utoopackMock.requireUtoopack()
          : actualRequire(specifier)) as ReturnType<
        typeof actual.createRequire
      >;
      return Object.assign(mockRequire, actualRequire);
    },
  };
});

const CLIENT_RUNTIME_SCRIPT_ID = "__EVJS_CLIENT_RUNTIME__";
const tempDirs: string[] = [];

async function makeProject(pageId = "index") {
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
  const pageDir =
    pageId === "index"
      ? path.join(cwd, "src/pages")
      : path.join(cwd, "src/pages", pageId);
  await fs.promises.mkdir(pageDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(pageDir, "page.tsx"),
    "export default function Page() { return null; }",
    "utf-8",
  );
  return cwd;
}

async function resolveProjectConfig(
  cwd: string,
  config: Config<ConfigComplete>,
): Promise<ResolvedConfig<ConfigComplete>> {
  return withPageRoutingDefaults(resolveConfig(config), config, cwd);
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
  graph: CoreGraph;
  plan: BuildPlan;
  hooks?: PluginHooks<ConfigComplete>[];
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
      await fs.promises.writeFile(
        path.join(rootDir, "deployment-metadata.json"),
        JSON.stringify(createDeploymentMetadata(output), null, 2),
        "utf-8",
      );
      await fs.promises.mkdir(clientDir, { recursive: true });

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
        embedClientRuntime(doc, output);

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
          html: {
            documentId: html.id,
            applicationId: appId ?? "default",
            owner: pageId ? { kind: "page", pageId } : { kind: "application" },
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
    onDevServerReady: options.onDevServerReady,
    onServerBundleReady: options.onServerBundleReady ?? vi.fn(),
  };
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
  it("emits flat CSR deployment metadata and index.html in flat output mode", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist" },
      routing: { mode: "spa" },
    });

    const onBuildOutput = vi.fn((output: BuildOutput) => {
      output.assets.devHook = { js: ["dev-hook.js"], css: [] };
    });
    const onDevServerReady = vi.fn();
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
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
        hooks,
        onBuildOutput,
        onDevServerReady,
      }),
      hooks,
    });

    const output = onBuildOutput.mock.calls[0]?.[0];
    if (!output) throw new Error("Expected linked BuildOutput.");
    const manifest = createPublicManifest(output);
    if (
      !("routing" in manifest) ||
      manifest.routing.kind !== "spa" ||
      !("assets" in manifest)
    ) {
      throw new Error("Expected a public SPA manifest.");
    }
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
    expect(onDevServerReady).toHaveBeenCalledWith({
      origin: "http://localhost:3210",
    });
    const serve = utoopackMock.requireUtoopack.mock.results.at(-1)?.value.serve;
    expect(serve.mock.calls.at(-1)?.[3]).toMatchObject({
      port: 3000,
      https: false,
      hostname: "0.0.0.0",
      logServerInfo: false,
    });
    expect(serve.mock.calls.at(-1)?.[0].config.devServer.proxy).toContainEqual(
      expect.objectContaining({
        target: "http://localhost:3210",
        pathRewrite: { "^/.*$": "/" },
      }),
    );
    expect(onBuildOutput.mock.calls[0]?.[0].assets.devHook).toEqual({
      js: ["dev-hook.js"],
      css: [],
    });
    expect("app" in manifest).toBe(false);
    expect(manifest.routing).toEqual({
      kind: "spa",
      routes: [{ id: "index", path: "/" }],
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
        { config, configChanged: true },
      ),
    ).rejects.toThrow("Restart ev dev to apply the updated config");
    await expect(
      controller.updatePlan(
        diffBuildPlan(buildContext.plan, buildContext.plan, "config"),
      ),
    ).resolves.toBeUndefined();
    await controller.close?.();
  });

  it("emits dev artifacts under the configured client output directory", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      output: { client: "custom-dist", server: "custom-dist/server" },
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd, {
      distDir: "custom-dist",
    });

    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
      }),
      hooks: [],
    });

    const metadataPath = path.join(cwd, "custom-dist/deployment-metadata.json");
    const htmlPath = path.join(cwd, "custom-dist/index.html");

    expect(fs.existsSync(metadataPath)).toBe(true);
    expect(fs.existsSync(htmlPath)).toBe(true);
    expect(fs.existsSync(path.join(cwd, "dist/manifest.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "custom-dist/manifest.json"))).toBe(
      false,
    );
    expect(controller).toBeDefined();
    await controller?.close?.();
  });

  it("applies html-only plan updates without restarting Utoopack dev", async () => {
    const cwd = await makeProject("home");
    await fs.promises.writeFile(
      path.join(cwd, "next.html"),
      '<!doctype html><html><head></head><body><main id="app">next-shell</main></body></html>',
      "utf-8",
    );
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist" },
      routing: { mode: "mpa", html: "./index.html" },
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
      plan: buildContext.plan,
      callbacks: framework,
      hooks: [],
    });
    if (!controller) throw new Error("Expected Utoopack dev controller");

    try {
      await fs.promises.writeFile(
        path.join(cwd, "src/about.tsx"),
        "console.log('about');",
        "utf-8",
      );
      const nextConfig = await resolveProjectConfig(cwd, {
        output: { client: "dist" },
        routing: { mode: "mpa", html: "./next.html" },
      });
      const nextAnalysis = await createCoreGraph(nextConfig, cwd);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
      });
      const update = diffBuildPlan(buildContext.plan, nextPlan, "config");

      framework.update(nextAnalysis.graph, nextPlan);
      await controller.updatePlan(update);

      const html = await fs.promises.readFile(
        path.join(cwd, "dist/home/index.html"),
        "utf-8",
      );
      const output = onBuildOutput.mock.calls.at(-1)?.[0];
      if (!output) throw new Error("Expected linked BuildOutput.");
      const manifest = createPublicManifest(output);

      expect(update.entries.added).toHaveLength(0);
      expect(update.entries.changed).toHaveLength(0);
      expect(update.html.changed.map((item) => item.id)).toEqual(["home"]);
      expect(html).toContain("next-shell");
      expect(html).toContain('data-evjs-kind="page"');
      expect(html).toContain('data-evjs-id="home"');
      expect(manifest).not.toHaveProperty("assets");
      if (!("routing" in manifest) || manifest.routing.kind !== "mpa") {
        throw new Error("Expected MPA public manifest.");
      }
      expect(manifest.routing.pages.home.document).toEqual({
        fileName: "home/index.html",
      });
      expect(onBuildOutput).toHaveBeenCalledTimes(2);
    } finally {
      await controller.close?.();
    }
  });

  it("refreshes the server runtime after page metadata-only plan updates", async () => {
    const cwd = await makeProject("home");
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist" },
      routing: { mode: "mpa", html: "./index.html" },
    });
    const baseContext = await createBuildContext(config, cwd);
    const serverRuntimeEntry = {
      name: "server",
      import: "@evjs/ev/_internal/server/fetch",
      environment: "server" as const,
      runtime: "node" as const,
      kind: "server-runtime" as const,
    };
    const plan: BuildPlan = {
      ...baseContext.plan,
      entries: [...baseContext.plan.entries, serverRuntimeEntry],
      server: { entry: serverRuntimeEntry.import },
    };
    const buildContext = { graph: baseContext.graph, plan };
    const onServerBundleReady = vi.fn();
    const onBuildOutput = vi.fn();
    const framework = createFrameworkCallbacks({
      config,
      cwd,
      ...buildContext,
      onBuildOutput,
      onServerBundleReady,
    });
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      plan: buildContext.plan,
      callbacks: framework,
      hooks: [],
    });
    if (!controller) throw new Error("Expected Utoopack dev controller");

    try {
      onServerBundleReady.mockClear();
      const nextGraph = structuredClone(buildContext.graph);
      const page = nextGraph.pages.home;
      if (!page) throw new Error("Expected home Page.");
      page.metadata = {
        title: "Updated home",
        meta: { description: "Updated description" },
      };
      const nextBasePlan = createBuildPlan(config, nextGraph, {
        mode: "development",
      });
      const nextPlan: BuildPlan = {
        ...nextBasePlan,
        entries: [...nextBasePlan.entries, serverRuntimeEntry],
        server: { entry: serverRuntimeEntry.import },
      };
      const update = diffBuildPlan(buildContext.plan, nextPlan, "config");

      framework.update(nextGraph, nextPlan);
      await controller.updatePlan(update);

      expect(update.entries.added).toHaveLength(0);
      expect(update.entries.removed).toHaveLength(0);
      expect(update.entries.changed).toHaveLength(0);
      expect(update.html.changed.map((item) => item.id)).toEqual(["home"]);
      expect(onBuildOutput).toHaveBeenCalledTimes(2);
      expect(onServerBundleReady).toHaveBeenCalledTimes(1);
      expect(onBuildOutput.mock.calls.at(-1)?.[0].pages.home.metadata).toEqual({
        title: "Updated home",
        meta: { description: "Updated description" },
      });
    } finally {
      await controller.close?.();
    }
  });

  it("fails clearly for entry-changing dev plan updates", async () => {
    const cwd = await makeProject("home");
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist" },
      routing: { mode: "mpa", html: "./index.html" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
      }),
      hooks: [],
    });
    if (!controller) throw new Error("Expected Utoopack dev controller");

    try {
      await fs.promises.mkdir(path.join(cwd, "src/pages/about"), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(cwd, "src/pages/about/page.tsx"),
        "export default function About() { return null; }",
        "utf-8",
      );
      const nextConfig = await resolveProjectConfig(cwd, {
        output: { client: "dist" },
        routing: { mode: "mpa", html: "./index.html" },
      });
      const nextAnalysis = await createCoreGraph(nextConfig, cwd);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
      });
      const update = diffBuildPlan(buildContext.plan, nextPlan, "config");

      const message = await expectRejectedMessage(() =>
        controller.updatePlan(update),
      );
      expect(message).toContain(
        "Utoopack dev cannot apply framework plan changes",
      );
      expect(message).toContain(
        "entry additions: page-client-about (page-client)",
      );
      expect(message).toContain("HTML additions: about -> about/index.html");
    } finally {
      await controller.close?.();
    }
  });

  it("reports server-changing dev plan updates", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist", server: "custom-server" },
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
      }),
      hooks: [],
    });
    if (!controller) throw new Error("Expected Utoopack dev controller");

    try {
      const nextConfig = await resolveProjectConfig(cwd, {
        routing: { mode: "spa" },
      });
      const nextAnalysis = await createCoreGraph(nextConfig, cwd);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
      });
      const update = diffBuildPlan(buildContext.plan, nextPlan, "config");

      const message = await expectRejectedMessage(() =>
        controller.updatePlan(update),
      );
      expect(message).toContain(
        "Utoopack dev cannot apply framework plan changes",
      );
      expect(message).toContain("server output changed");
    } finally {
      await controller.close?.();
    }
  });

  it("emits canonical deployment metadata plus index.html in client-only mode", async () => {
    const cwd = await makeProject();
    const onServerBundleReady = vi.fn();
    const onBuildOutput = vi.fn();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const hooks: PluginHooks<ConfigComplete>[] = [
      {
        transformHtml(doc, ctx) {
          const meta = doc.createElement("meta");
          expect(ctx.owner).toEqual({ kind: "application" });
          expect(ctx.documentId).toBe("index");
          expect(ctx.applicationId).toBe("default");
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
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
        hooks,
        onBuildOutput,
        onServerBundleReady,
      }),
      hooks,
    });

    const deploymentMetadata = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/deployment-metadata.json"),
        "utf-8",
      ),
    );
    const output = onBuildOutput.mock.calls[0]?.[0];
    if (!output) throw new Error("Expected linked BuildOutput.");
    const publicManifest = createPublicManifest(output);
    if (
      !("routing" in publicManifest) ||
      publicManifest.routing.kind !== "spa"
    ) {
      throw new Error("Expected a public SPA manifest.");
    }
    const html = await fs.promises.readFile(
      path.join(cwd, "dist/client/index.html"),
      "utf-8",
    );

    expect("apps" in deploymentMetadata).toBe(false);
    expect(deploymentMetadata.documents).toEqual([
      {
        kind: "app",
        id: "default",
        fileName: "index.html",
        fallback: "/",
        assets: {
          js: ["main.js"],
          css: ["main.css"],
        },
      },
    ]);
    expect(fs.existsSync(path.join(cwd, "dist/server/manifest.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(cwd, "dist/client/manifest.json"))).toBe(
      false,
    );
    expect("app" in publicManifest).toBe(false);
    expect(publicManifest.routing.kind).toBe("spa");
    expect(fs.existsSync(path.join(cwd, "dist/manifest.json"))).toBe(false);
    expect(html).toContain('<link rel="stylesheet" href="/main.css">');
    expect(html).toContain('src="/main.js"');
    expect(html).toContain('data-evjs-kind="app"');
    expect(html).toContain('data-evjs-id="default"');
    expect(html).toContain('<meta name="server">');
    expect(onServerBundleReady).not.toHaveBeenCalled();
  });
});

async function createBuildContext(
  config: ResolvedConfig<ConfigComplete>,
  cwd: string,
  options: { distDir?: string } = {},
) {
  const analysis = await createCoreGraph(config, cwd);
  return {
    graph: analysis.graph,
    plan: createBuildPlan(config, analysis.graph, {
      mode: "development",
      distDir: options.distDir,
    }),
  };
}
