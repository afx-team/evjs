import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  BundlerBuildFacts,
  BundlerDevController,
  BundlerDevGeneration,
} from "@evjs/ev/_internal/build";
import {
  buildHtml,
  createBuildPlan,
  createCoreGraph,
  diffBuildPlan,
  generateHtml,
  materializeFrameworkIR,
} from "@evjs/ev/_internal/build";
import {
  type Config,
  type ResolvedConfig,
  resolveConfig,
} from "@evjs/ev/config";
import type { PluginHooks } from "@evjs/ev/plugin";
import type { BuildOutput, BuildPlan, CoreGraph } from "@evjs/shared/manifest";
import {
  assertFrameworkManifestShape,
  createDeploymentMetadata,
  linkBuildOutput,
} from "@evjs/shared/manifest";
import type { ConfigComplete } from "@utoo/pack";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPageRoutingDefaults } from "../../ev/esm/_internal/build/convention-config.js";
import { createClientRuntime } from "../../ev/src/_internal/build/framework-runtime.js";
import {
  utoopackAdapter,
  __testing as utoopackAdapterTesting,
} from "../src/adapter/index.js";

const utoopackMock = vi.hoisted(() => ({
  clientStatsDelayMs: 0,
  initialClientStats: undefined as string | undefined,
  clientStats: undefined as string | undefined,
  omitClientStats: false,
  workerClose: vi.fn(async () => {}),
  startUtoopackDevWorker: vi.fn(
    ({ config, server }: { config: ConfigComplete; server: unknown }) => {
      let resolveReady!: (context: {
        port: number;
        hostname: string;
        clientPaths: string[];
        spaHistoryFallbackUpdated: boolean;
      }) => void;
      let rejectReady!: (error: unknown) => void;
      const ready = new Promise<{
        port: number;
        hostname: string;
        clientPaths: string[];
        spaHistoryFallbackUpdated: boolean;
      }>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const runtime = utoopackMock.requireUtoopack();
      void runtime
        .serve({ config }, undefined, undefined, {
          ...(server as object),
          onReady(context: {
            port: number;
            hostname: string;
            clientPaths?: string[];
          }) {
            const fallbackRule = config.devServer?.proxy?.find(
              (candidate) =>
                typeof candidate.pathRewrite === "object" &&
                candidate.pathRewrite?.["^/.*$"] === "/",
            );
            if (fallbackRule) {
              fallbackRule.target = `http://localhost:${context.port}`;
            }
            resolveReady({
              clientPaths: [],
              ...context,
              spaHistoryFallbackUpdated: Boolean(fallbackRule),
            });
          },
        })
        .catch(rejectReady);
      return {
        ready,
        done: new Promise<void>(() => {}),
        failure: new Promise<never>(() => {}),
        throwIfFailed() {},
        close: utoopackMock.workerClose,
      };
    },
  ),
  requireUtoopack: vi.fn(() => ({
    serve: vi.fn(async ({ config }, _projectPath, _rootPath, serverOptions) => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const clientOutDir = config.output.path;

      await fs.promises.mkdir(clientOutDir, { recursive: true });
      await fs.promises.writeFile(path.join(clientOutDir, "main.js"), "");
      await fs.promises.writeFile(path.join(clientOutDir, "main.css"), "");
      const writeClientStats = () =>
        fs.promises.writeFile(
          path.join(clientOutDir, "stats.json"),
          utoopackMock.clientStats ??
            JSON.stringify({
              entrypoints: {
                main: {
                  assets: [{ name: "main.js" }, { name: "main.css" }],
                },
              },
            }),
        );
      if (utoopackMock.initialClientStats !== undefined) {
        await fs.promises.writeFile(
          path.join(clientOutDir, "stats.json"),
          utoopackMock.initialClientStats,
        );
      }
      if (!utoopackMock.omitClientStats) {
        if (utoopackMock.clientStatsDelayMs > 0) {
          setTimeout(() => {
            void writeClientStats();
          }, utoopackMock.clientStatsDelayMs);
        } else {
          await writeClientStats();
        }
      }

      if (config.server) {
        const serverOutDir = config.server.output.path;
        await fs.promises.mkdir(serverOutDir, { recursive: true });
        const serverEntryNames: string[] = Array.isArray(config.server.entry)
          ? config.server.entry.map((entry: { name: string }) => entry.name)
          : ["server"];
        await Promise.all(
          serverEntryNames.map((name) =>
            fs.promises.writeFile(path.join(serverOutDir, `${name}.js`), ""),
          ),
        );
        await fs.promises.writeFile(
          path.join(serverOutDir, "stats.json"),
          JSON.stringify({
            assets: serverEntryNames.map((name) => ({
              name: `${name}.js`,
            })),
            entrypoints: Object.fromEntries(
              serverEntryNames.map((name) => [
                name,
                { assets: [{ name: `${name}.js` }] },
              ]),
            ),
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

vi.mock("../src/adapter/dev-worker-client.js", () => ({
  startUtoopackDevWorker: utoopackMock.startUtoopackDevWorker,
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

function createDevGeneration(): BundlerDevGeneration {
  return Object.freeze({}) as BundlerDevGeneration;
}

async function createDevUpdateOptions(
  controller: BundlerDevController<ConfigComplete>,
  config: ResolvedConfig<ConfigComplete>,
  configChanged = false,
) {
  const activate = vi.fn();
  const transition = await controller.beginUpdate();
  return {
    activate,
    options: {
      config,
      configChanged,
      generation: createDevGeneration(),
      activate,
      transition,
    },
  };
}

async function settleDevUpdate(
  planUpdate: Awaited<ReturnType<typeof createDevUpdateOptions>>,
  outcome: "accept" | "rollback",
): Promise<void> {
  if (outcome === "accept") await planUpdate.options.transition.accept();
  else await planUpdate.options.transition.rollback();
  await planUpdate.options.transition.resume();
  await planUpdate.options.transition.prepareFinalize();
  planUpdate.options.transition.finalize();
}

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
  utoopackMock.clientStatsDelayMs = 0;
  utoopackMock.initialClientStats = undefined;
  utoopackMock.clientStats = undefined;
  utoopackMock.omitClientStats = false;
  utoopackMock.workerClose.mockClear();
  utoopackMock.startUtoopackDevWorker.mockClear();
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
  onServerBundleReady?: (
    generation: BundlerDevGeneration,
  ) => void | Promise<void>;
}) {
  let graph = options.graph;
  let plan = options.plan;
  const hooks = options.hooks ?? [];
  return {
    update(nextGraph: CoreGraph, nextPlan: BuildPlan) {
      graph = nextGraph;
      plan = nextPlan;
    },
    async onBuildFacts(
      _generation: BundlerDevGeneration,
      facts: BundlerBuildFacts,
    ) {
      const output = linkBuildOutput({
        graph,
        plan,
        clientEntryAssets: facts.clientEntryAssets,
        serverEntryAssets: facts.serverEntryAssets,
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
      return "published" as const;
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

describe("utoopackAdapter output safety", () => {
  it("preserves external files when the server output traverses a symlink", async () => {
    const cwd = await makeProject();
    const outside = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-output-outside-"),
    );
    tempDirs.push(outside);
    const externalServerDir = path.join(outside, "server");
    const sentinel = path.join(externalServerDir, "sentinel.txt");
    await fs.promises.mkdir(externalServerDir, { recursive: true });
    await fs.promises.writeFile(sentinel, "keep", "utf-8");
    await fs.promises.mkdir(path.join(cwd, "dist"), { recursive: true });
    await fs.promises.symlink(
      outside,
      path.join(cwd, "dist/linked-output"),
      "dir",
    );
    const config = await resolveProjectConfig(cwd, {
      output: {
        client: "dist/client",
        server: "dist/linked-output/server",
      },
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);

    await expect(
      utoopackAdapter.build({
        config,
        cwd,
        plan: buildContext.plan,
        hooks: [],
      }),
    ).rejects.toThrow(
      '[evjs] output.server output directory "dist/linked-output/server" must not traverse symbolic link "dist/linked-output".',
    );
    await expect(fs.promises.readFile(sentinel, "utf-8")).resolves.toBe("keep");
  });
});

describe("utoopackAdapter dev", () => {
  it("fails explicitly when initial development stats never appear", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);

    await expect(
      utoopackAdapterTesting.waitForReadableDevStats(
        cwd,
        buildContext.plan,
        75,
      ),
    ).rejects.toThrow(
      "Timed out waiting for readable Utoopack development stats",
    );
  });

  it("fails explicitly when initial development stats stay malformed", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const clientDir = path.resolve(cwd, buildContext.plan.output.clientDir);
    await fs.promises.mkdir(clientDir, { recursive: true });
    await fs.promises.writeFile(path.join(clientDir, "stats.json"), "null");

    await expect(
      utoopackAdapterTesting.waitForReadableDevStats(
        cwd,
        buildContext.plan,
        75,
      ),
    ).rejects.toThrow(
      "Timed out waiting for readable Utoopack development stats",
    );
  });

  it("closes promptly while a server rebuild is waiting for readable stats", async () => {
    const cwd = await makeProject("home");
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist/client", server: "dist/server" },
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
    const generation = createDevGeneration();
    const controller = await utoopackAdapterTesting.startUtoopackDev(
      {
        config,
        cwd,
        generation,
        plan,
        callbacks: createFrameworkCallbacks({
          config,
          cwd,
          graph: baseContext.graph,
          plan,
        }),
        hooks: [],
      },
      10_000,
    );

    const statsPath = path.join(cwd, plan.output.serverDir, "stats.json");
    await fs.promises.writeFile(statsPath, "null", "utf-8");
    const pending = controller.processServerStatsChange(
      "malformed-server-stats",
      10_000,
    );
    void pending.catch(() => {});
    await Promise.resolve();

    let closeTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        Promise.race([
          controller.close(),
          new Promise<never>((_, reject) => {
            closeTimeout = setTimeout(
              () => reject(new Error("Utoopack close did not cancel stats")),
              750,
            );
          }),
        ]),
      ).resolves.toBeUndefined();
      await expect(pending).rejects.toThrow(
        "closed while waiting for build stats",
      );
    } finally {
      if (closeTimeout) clearTimeout(closeTimeout);
      await controller.close();
    }
  });

  it("relinks CSR updates from published facts while the compiler watches independently", async () => {
    const cwd = await makeProject();
    utoopackMock.initialClientStats = "{}";
    utoopackMock.clientStatsDelayMs = 75;
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "spa" },
    });

    const onBuildOutput = vi.fn((output: BuildOutput) => {
      output.assets.devHook = { js: ["dev-hook.js"], css: [] };
    });
    const onDevServerReady = vi.fn();
    const initialBuildContext = await createBuildContext(config, cwd);
    const buildContext = {
      graph: initialBuildContext.graph,
      plan: await materializeFrameworkIR({
        cwd,
        mode: "development",
        config,
        graph: initialBuildContext.graph,
        plan: initialBuildContext.plan,
        plugins: [],
        pluginContext: {
          mode: "development",
          cwd,
          config,
          logger: console as never,
          addWatchFile() {},
        },
      }),
    };
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

    const framework = createFrameworkCallbacks({
      config,
      cwd,
      ...buildContext,
      hooks,
      onBuildOutput,
      onDevServerReady,
    });
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      generation: createDevGeneration(),
      plan: buildContext.plan,
      callbacks: framework,
      hooks,
    });

    const output = onBuildOutput.mock.calls[0]?.[0];
    if (!output) throw new Error("Expected linked BuildOutput.");
    assertFrameworkManifestShape(output, "Utoopack dev BuildOutput");
    const html = await fs.promises.readFile(
      path.join(cwd, "dist/client/index.html"),
      "utf-8",
    );

    expect(output.assets).toMatchObject({
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
    expect(output.apps.default).toMatchObject({
      assets: { js: ["main.js"], css: ["main.css"] },
      document: { fileName: "index.html" },
    });
    expect(output.routes).toEqual([
      { id: "index", path: "/", appId: "default" },
    ]);
    expect(html).toContain('<link rel="stylesheet" href="/main.css">');
    expect(html).toContain('src="/main.js"');
    expect(html).toContain('data-evjs-kind="app"');
    expect(html).toContain('data-evjs-id="default"');
    expect(html).toContain('<meta name="mode" content="dev">');
    expect(fs.existsSync(path.join(cwd, "dist/client"))).toBe(true);
    expect(controller).toBeDefined();
    if (!controller) throw new Error("Expected Utoopack dev controller");
    const statsPath = path.join(cwd, "dist/client/stats.json");
    const staleStats = JSON.stringify({
      entrypoints: {
        main: { assets: [{ name: "stale-main.js" }] },
      },
    });
    await fs.promises.writeFile(
      path.join(cwd, "dist/client/stale-main.js"),
      "",
      "utf-8",
    );
    await fs.promises.writeFile(statsPath, staleStats, "utf-8");
    const rejectedUpdate = await createDevUpdateOptions(
      controller,
      config,
      true,
    );
    await expect(
      controller.updatePlan(
        diffBuildPlan(buildContext.plan, buildContext.plan, "config"),
        rejectedUpdate.options,
      ),
    ).rejects.toThrow("Restart ev dev to apply the updated config");
    expect(rejectedUpdate.activate).not.toHaveBeenCalled();
    await settleDevUpdate(rejectedUpdate, "rollback");
    expect(onBuildOutput).toHaveBeenCalledTimes(2);

    const nextPlan = structuredClone(buildContext.plan);
    if (!nextPlan.generated) {
      throw new Error("Expected generated framework plan.");
    }
    nextPlan.generated.coreGraphHash = "updated-core-graph";
    const update = diffBuildPlan(
      buildContext.plan,
      nextPlan,
      "route-declaration",
    );
    const appliedUpdate = await createDevUpdateOptions(controller, config);
    framework.update(buildContext.graph, nextPlan);
    await expect(
      controller.updatePlan(update, appliedUpdate.options),
    ).resolves.toBeUndefined();
    expect(update.generatedChanged).toBe(true);
    expect(appliedUpdate.activate).toHaveBeenCalledOnce();
    await settleDevUpdate(appliedUpdate, "accept");
    expect(onBuildOutput).toHaveBeenCalledTimes(3);
    expect(onBuildOutput.mock.calls.at(-1)?.[0].assets.main).toEqual({
      js: ["main.js"],
      css: ["main.css"],
    });
    await expect(fs.promises.readFile(statsPath, "utf-8")).resolves.toBe(
      staleStats,
    );
    await controller.close?.();
  });

  it("emits dev artifacts under the configured client output directory", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      output: {
        client: "custom-dist/client",
        server: "custom-dist/server",
      },
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd, {
      distDir: "custom-dist",
    });

    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      generation: createDevGeneration(),
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
      }),
      hooks: [],
    });

    const metadataPath = path.join(cwd, "custom-dist/deployment-metadata.json");
    const htmlPath = path.join(cwd, "custom-dist/client/index.html");

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
      output: { client: "dist/client", server: "dist/server" },
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
      generation: createDevGeneration(),
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
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa", html: "./next.html" },
      });
      const nextAnalysis = await createCoreGraph(nextConfig, cwd);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
      });
      const update = diffBuildPlan(buildContext.plan, nextPlan, "config");

      const planUpdate = await createDevUpdateOptions(controller, nextConfig);
      framework.update(nextAnalysis.graph, nextPlan);
      await controller.updatePlan(update, planUpdate.options);
      await settleDevUpdate(planUpdate, "accept");

      const html = await fs.promises.readFile(
        path.join(cwd, "dist/client/home/index.html"),
        "utf-8",
      );
      const output = onBuildOutput.mock.calls.at(-1)?.[0];
      if (!output) throw new Error("Expected linked BuildOutput.");
      assertFrameworkManifestShape(output, "updated Utoopack BuildOutput");

      expect(update.entries.added).toHaveLength(0);
      expect(update.entries.changed).toHaveLength(0);
      expect(update.html.changed.map((item) => item.id)).toEqual(["home"]);
      expect(html).toContain("next-shell");
      expect(html).toContain('data-evjs-kind="page"');
      expect(html).toContain('data-evjs-id="home"');
      expect(output.pages.home.document).toEqual({
        fileName: "home/index.html",
      });
      expect(onBuildOutput).toHaveBeenCalledTimes(2);
      expect(planUpdate.activate).toHaveBeenCalledOnce();
    } finally {
      await controller.close?.();
    }
  });

  it("revalidates output symlinks before applying a dev plan update", async () => {
    const cwd = await makeProject();
    const outside = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-output-outside-"),
    );
    tempDirs.push(outside);
    const sentinel = path.join(outside, "client", "sentinel.txt");
    await fs.promises.mkdir(path.dirname(sentinel), { recursive: true });
    await fs.promises.writeFile(sentinel, "keep", "utf-8");
    const config = await resolveProjectConfig(cwd, {
      output: {
        client: "dist/client-output/client",
        server: "dist/server-output",
      },
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      generation: createDevGeneration(),
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
      await fs.promises.rm(path.join(cwd, "dist/client-output"), {
        recursive: true,
        force: true,
      });
      await fs.promises.symlink(
        outside,
        path.join(cwd, "dist/client-output"),
        "dir",
      );

      const planUpdate = await createDevUpdateOptions(controller, config);
      await expect(
        controller.updatePlan(
          diffBuildPlan(
            buildContext.plan,
            buildContext.plan,
            "route-declaration",
          ),
          planUpdate.options,
        ),
      ).rejects.toThrow(
        '[evjs] output.client output directory "dist/client-output/client" must not traverse symbolic link "dist/client-output".',
      );
      expect(planUpdate.activate).not.toHaveBeenCalled();
      await expect(fs.promises.readFile(sentinel, "utf-8")).resolves.toBe(
        "keep",
      );
    } finally {
      await controller.close?.();
    }
  });

  it("refreshes the server runtime after page metadata-only plan updates", async () => {
    const cwd = await makeProject("home");
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist/client", server: "dist/server" },
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
      generation: createDevGeneration(),
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

      const planUpdate = await createDevUpdateOptions(controller, config);
      framework.update(nextGraph, nextPlan);
      await controller.updatePlan(update, planUpdate.options);
      const serverStatsPath = path.join(cwd, "dist/server/stats.json");
      await fs.promises.writeFile(
        serverStatsPath,
        JSON.stringify({
          revision: 2,
          assets: [{ name: "server.js" }],
          entrypoints: {
            server: { assets: [{ name: "server.js" }] },
          },
        }),
        "utf-8",
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(onServerBundleReady).not.toHaveBeenCalled();
      await settleDevUpdate(planUpdate, "accept");

      expect(update.entries.added).toHaveLength(0);
      expect(update.entries.removed).toHaveLength(0);
      expect(update.entries.changed).toHaveLength(0);
      expect(update.html.changed.map((item) => item.id)).toEqual(["home"]);
      expect(update.serverCompilationChanged).toBe(false);
      expect(update.serverDocumentsChanged).toBe(false);
      expect(update.devRoutingChanged).toBe(false);
      expect(onBuildOutput).toHaveBeenCalledTimes(2);
      expect(onServerBundleReady).not.toHaveBeenCalled();
      await vi.waitFor(
        () => expect(onServerBundleReady).toHaveBeenCalledTimes(1),
        { timeout: 2_000 },
      );
      expect(onBuildOutput).toHaveBeenCalledTimes(3);
      expect(onServerBundleReady).toHaveBeenCalledWith(
        planUpdate.options.generation,
      );
      expect(planUpdate.activate).toHaveBeenCalledOnce();
      expect(onBuildOutput.mock.calls.at(-1)?.[0].pages.home.metadata).toEqual({
        title: "Updated home",
        meta: { description: "Updated description" },
      });
    } finally {
      await controller.close?.();
    }
  });

  it("drops server stats observed during a rolled-back plan transition", async () => {
    const cwd = await makeProject("home");
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist/client", server: "dist/server" },
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
    const generation = createDevGeneration();
    const onBuildOutput = vi.fn();
    const onServerBundleReady = vi.fn();
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      generation,
      plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        graph: baseContext.graph,
        plan,
        onBuildOutput,
        onServerBundleReady,
      }),
      hooks: [],
    });
    if (!controller) throw new Error("Expected Utoopack dev controller");

    try {
      onServerBundleReady.mockClear();
      const planUpdate = await createDevUpdateOptions(controller, config);
      await controller.updatePlan(
        diffBuildPlan(plan, plan, "route-declaration"),
        planUpdate.options,
      );
      const statsPath = path.join(cwd, "dist/server/stats.json");
      const writeServerStats = (revision: number) =>
        fs.promises.writeFile(
          statsPath,
          JSON.stringify({
            revision,
            assets: [{ name: "server.js" }],
            entrypoints: {
              server: { assets: [{ name: "server.js" }] },
            },
          }),
          "utf-8",
        );

      await writeServerStats(2);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(onServerBundleReady).not.toHaveBeenCalled();
      await settleDevUpdate(planUpdate, "rollback");
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(onServerBundleReady).not.toHaveBeenCalled();

      await writeServerStats(3);
      await vi.waitFor(
        () => expect(onServerBundleReady).toHaveBeenCalledTimes(1),
        { timeout: 2_000 },
      );
      expect(onServerBundleReady).toHaveBeenCalledWith(generation);
      expect(onBuildOutput).toHaveBeenCalledTimes(3);
    } finally {
      await controller.close?.();
    }
  });

  it("keeps all configured page-server entries after a server stats rebuild", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "spa" },
    });
    const baseContext = await createBuildContext(config, cwd);
    const graph = structuredClone(baseContext.graph);
    const page = graph.pages.index;
    if (!page) throw new Error("Expected index Page.");
    page.render = "ssr";
    const plan = createBuildPlan(config, graph, { mode: "development" });
    const onServerBundleReady = vi.fn();
    const onBuildOutput = vi.fn();
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      generation: createDevGeneration(),
      plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        graph,
        plan,
        onBuildOutput,
        onServerBundleReady,
      }),
      hooks: [],
    });
    if (!controller) throw new Error("Expected Utoopack dev controller");

    try {
      expect(onBuildOutput.mock.calls[0]?.[0].server.renderers).toMatchObject({
        "page-server-index": {
          kind: "page-server",
          assets: { js: ["page-server-index.js"], css: [] },
        },
      });
      await fs.promises.writeFile(
        path.join(cwd, "dist/server/stats.json"),
        JSON.stringify({
          assets: [
            { name: "server.js" },
            { name: "page-server-index.updated.js" },
            { name: "server-shared.updated.js" },
          ],
          entrypoints: {
            server: {
              assets: [
                { name: "server.js" },
                { name: "server-shared.updated.js" },
              ],
            },
            "page-server-index": {
              assets: [
                { name: "page-server-index.updated.js" },
                { name: "server-shared.updated.js" },
              ],
            },
          },
        }),
      );

      await vi.waitFor(() => {
        expect(onBuildOutput).toHaveBeenCalledTimes(2);
        expect(onServerBundleReady).toHaveBeenCalledTimes(2);
      });
      expect(onBuildOutput.mock.calls[1]?.[0].server.renderers).toMatchObject({
        "page-server-index": {
          kind: "page-server",
          assets: { js: ["page-server-index.updated.js"], css: [] },
        },
      });
    } finally {
      await controller.close?.();
    }
  });

  it("fails clearly for entry-changing dev plan updates", async () => {
    const cwd = await makeProject("home");
    const config = await resolveProjectConfig(cwd, {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "mpa", html: "./index.html" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      generation: createDevGeneration(),
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
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa", html: "./index.html" },
      });
      const nextAnalysis = await createCoreGraph(nextConfig, cwd);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
      });
      const update = diffBuildPlan(buildContext.plan, nextPlan, "config");

      const planUpdate = await createDevUpdateOptions(controller, nextConfig);
      const message = await expectRejectedMessage(() =>
        controller.updatePlan(update, planUpdate.options),
      );
      expect(planUpdate.activate).not.toHaveBeenCalled();
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
      output: { client: "dist/client", server: "dist/custom-server" },
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      generation: createDevGeneration(),
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

      const planUpdate = await createDevUpdateOptions(controller, nextConfig);
      const message = await expectRejectedMessage(() =>
        controller.updatePlan(update, planUpdate.options),
      );
      expect(planUpdate.activate).not.toHaveBeenCalled();
      expect(message).toContain(
        "Utoopack dev cannot apply framework plan changes",
      );
      expect(message).toContain("server compilation topology changed");
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
      generation: createDevGeneration(),
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
    assertFrameworkManifestShape(output, "Utoopack BuildOutput");
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
    expect(output.routes).toContainEqual({
      id: "index",
      path: "/",
      appId: "default",
    });
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
