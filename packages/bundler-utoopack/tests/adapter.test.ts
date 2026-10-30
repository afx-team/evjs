import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BundlerBuildFacts } from "@evjs/ev/_internal/build";
import {
  buildHtml,
  createBuildPlan,
  createCoreGraph,
  generateHtml,
  reserveClientDevMiddlewareUpstreamPort,
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
  linkBuildOutput,
} from "@evjs/shared/manifest";
import type { ConfigComplete } from "@utoo/pack";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withPageRoutingDefaults } from "../../ev/esm/_internal/build/discovery/convention-config.js";
import { createClientRuntime } from "../../ev/src/_internal/build/output/framework-runtime.js";
import { createUtoopackConfig } from "../src/adapter/config/create-config.js";
import {
  utoopackAdapter,
  __testing as utoopackAdapterTesting,
} from "../src/adapter/index.js";

const utoopackMock = vi.hoisted(() => ({
  clientStatsDelayMs: 0,
  initialClientStats: undefined as string | undefined,
  clientStats: undefined as string | undefined,
  omitClientStats: false,
  deferInitialServerBuild: false,
  markUtoopackProcessForBuild: vi.fn(),
  workerClose: vi.fn(async () => {}),
  startUtoopackDevWorker: vi.fn(
    ({
      config,
      server,
      onServerBuild,
      onServerError,
    }: {
      config: ConfigComplete;
      server: unknown;
      onServerBuild?: () => Promise<void>;
      onServerError?: (error: Error) => void;
    }) => {
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
        .then(async () => {
          if (config.server && !utoopackMock.deferInitialServerBuild) {
            await onServerBuild?.();
          }
        })
        .catch((error) => {
          onServerError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
          rejectReady(error);
        });
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
            void writeClientStats().catch(() => {});
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
        port: serverOptions.port === 3000 ? 3210 : (serverOptions.port ?? 3210),
        hostname: "0.0.0.0",
      });
    }),
    build: vi.fn(
      async ({ config }: { config: ConfigComplete }, projectPath: string) => {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const outputPath = config.output?.path;
        if (!outputPath) throw new Error("Mock build output path is required.");
        const clientOutDir = path.resolve(projectPath, outputPath);
        const entrypoints = Object.fromEntries(
          config.entry.map((entry) => [
            entry.name,
            { assets: [{ name: `${entry.name}.js` }] },
          ]),
        );
        await fs.promises.mkdir(clientOutDir, { recursive: true });
        await Promise.all(
          config.entry.map((entry) =>
            fs.promises.writeFile(
              path.join(clientOutDir, `${entry.name}.js`),
              "",
            ),
          ),
        );
        await fs.promises.writeFile(
          path.join(clientOutDir, "stats.json"),
          JSON.stringify({ entrypoints }),
        );
      },
    ),
  })),
}));

vi.mock("../src/adapter/development/dev-worker-client.js", () => ({
  startUtoopackDevWorker: utoopackMock.startUtoopackDevWorker,
}));

vi.mock("../src/adapter/development/dev-process-mode.js", () => ({
  markUtoopackProcessForBuild: utoopackMock.markUtoopackProcessForBuild,
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

async function waitForCondition(
  condition: () => boolean,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function clientStatsFor(assets: string[], includeInventory = true): string {
  return JSON.stringify({
    ...(includeInventory ? { assets: assets.map((name) => ({ name })) } : {}),
    entrypoints: {
      main: { assets: assets.map((name) => ({ name })) },
    },
  });
}

async function writeClientStats(
  cwd: string,
  assets: string[],
  includeInventory = true,
): Promise<void> {
  const clientDir = path.join(cwd, "dist/client");
  await fs.promises.mkdir(clientDir, { recursive: true });
  await Promise.all(
    assets.map((asset) =>
      fs.promises.writeFile(path.join(clientDir, asset), ""),
    ),
  );
  await fs.promises.writeFile(
    path.join(clientDir, "stats.json"),
    clientStatsFor(assets, includeInventory),
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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
  utoopackMock.deferInitialServerBuild = false;
  utoopackMock.workerClose.mockClear();
  utoopackMock.startUtoopackDevWorker.mockClear();
  utoopackMock.markUtoopackProcessForBuild.mockClear();
  utoopackMock.requireUtoopack.mockClear();
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
    async onBuildFacts(
      facts: BundlerBuildFacts,
      _options: { readonly isRebuild: boolean },
    ) {
      const output = linkBuildOutput({
        graph,
        plan,
        clientEntryAssets: facts.clientEntryAssets,
        serverEntryAssets: facts.serverEntryAssets,
      });

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
      await options.onBuildOutput?.(output);
      return "published" as const;
    },
    onServerBundleReady: options.onServerBundleReady ?? vi.fn(async () => {}),
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

describe("utoopackAdapter build", () => {
  it("checks the process mode before starting a Project", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
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
    ).resolves.toBeDefined();
    expect(utoopackMock.markUtoopackProcessForBuild).toHaveBeenCalledTimes(1);
    expect(
      utoopackMock.markUtoopackProcessForBuild.mock.invocationCallOrder[0],
    ).toBeLessThan(utoopackMock.requireUtoopack.mock.invocationCallOrder[0]);
  });
});

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

describe("utoopackAdapter browser log forwarding config", () => {
  it("maps the resolved level into development config only", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      logging: { browserToTerminal: "warn" },
    });
    const { plan } = await createBuildContext(config, cwd);

    const development = await createUtoopackConfig(config, plan, cwd, []);
    expect(Reflect.get(development.devServer ?? {}, "browserToTerminal")).toBe(
      "warn",
    );

    const productionPlan = structuredClone(plan);
    productionPlan.mode = "production";
    const production = await createUtoopackConfig(
      config,
      productionPlan,
      cwd,
      [],
    );
    expect(Object.hasOwn(production.devServer ?? {}, "browserToTerminal")).toBe(
      false,
    );
  });
});

describe("utoopackAdapter dev", () => {
  it("automatically republishes HTML and metadata when a client chunk changes", async () => {
    const cwd = await makeProject();
    const initialAssets = ["root-old.js", "main.js"];
    utoopackMock.clientStats = clientStatsFor(initialAssets);
    await writeClientStats(cwd, initialAssets);
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const outputs: BuildOutput[] = [];
    const rebuildFlags: boolean[] = [];
    const onServerBundleReady = vi.fn(async () => {});
    const callbacks = createFrameworkCallbacks({
      config,
      cwd,
      ...buildContext,
      onBuildOutput(output) {
        outputs.push(output);
      },
      onServerBundleReady,
    });
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: {
        ...callbacks,
        async onBuildFacts(facts, options) {
          rebuildFlags.push(options.isRebuild);
          return callbacks.onBuildFacts(facts, options);
        },
      },
      hooks: [],
    });

    try {
      await waitForCondition(
        () => outputs.length === 1,
        "Utoopack did not publish initial client artifacts",
      );
      const htmlPath = path.join(cwd, "dist/client/index.html");
      expect(await fs.promises.readFile(htmlPath, "utf-8")).toContain(
        'src="/root-old.js"',
      );

      await writeClientStats(cwd, ["root-new.js", "main.js", "new.css"]);
      await expect
        .poll(() => fs.promises.readFile(htmlPath, "utf-8"))
        .toContain('src="/root-new.js"');

      const html = await fs.promises.readFile(htmlPath, "utf-8");
      const metadata = JSON.parse(
        await fs.promises.readFile(
          path.join(cwd, "dist/deployment-metadata.json"),
          "utf-8",
        ),
      );
      expect(html).not.toContain('src="/root-old.js"');
      expect(html).toContain('href="/new.css"');
      expect(metadata.documents[0].assets).toEqual({
        js: ["root-new.js", "main.js"],
        css: ["new.css"],
      });
      expect(outputs).toHaveLength(2);
      expect(rebuildFlags).toEqual([false, true]);
      expect(onServerBundleReady).not.toHaveBeenCalled();
    } finally {
      await controller.close();
    }
  });

  it("keeps the last HTML through incomplete client rebuild stats and recovers automatically", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const onBuildOutput = vi.fn();
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
        onBuildOutput,
      }),
      hooks: [],
    });

    try {
      await waitForCondition(
        () => onBuildOutput.mock.calls.length === 1,
        "Utoopack did not publish initial client artifacts",
      );
      const htmlPath = path.join(cwd, "dist/client/index.html");
      const initialHtml = await fs.promises.readFile(htmlPath, "utf-8");
      for (const incompleteStats of [
        '{"entrypoints":',
        JSON.stringify({ entrypoints: {} }),
      ]) {
        await fs.promises.writeFile(
          path.join(cwd, "dist/client/stats.json"),
          incompleteStats,
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(await fs.promises.readFile(htmlPath, "utf-8")).toBe(initialHtml);
        expect(onBuildOutput).toHaveBeenCalledTimes(1);
      }

      await writeClientStats(cwd, ["root-recovered.js", "main.js"]);
      await expect
        .poll(() => fs.promises.readFile(htmlPath, "utf-8"))
        .toContain('src="/root-recovered.js"');
      expect(onBuildOutput).toHaveBeenCalledTimes(2);
    } finally {
      await controller.close();
    }
  });

  it("publishes a client rebuild without restarting an existing API runtime", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createServerBuildContext(config, cwd);
    const onBuildOutput = vi.fn();
    const onServerBundleReady = vi.fn(async () => {});
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
        onBuildOutput,
        onServerBundleReady,
      }),
      hooks: [],
    });

    try {
      await waitForCondition(
        () =>
          onBuildOutput.mock.calls.length === 1 &&
          onServerBundleReady.mock.calls.length === 1,
        "Utoopack did not publish the initial server batch",
      );
      await writeClientStats(cwd, ["root-client-only.js", "main.js"]);
      await expect
        .poll(() =>
          fs.promises.readFile(
            path.join(cwd, "dist/client/index.html"),
            "utf-8",
          ),
        )
        .toContain('src="/root-client-only.js"');
      expect(onBuildOutput).toHaveBeenCalledTimes(2);
      expect(onServerBundleReady).toHaveBeenCalledTimes(1);
    } finally {
      await controller.close();
    }
  });

  it("keeps accepted server facts when client stats change ahead of server publication", async () => {
    const cwd = await makeProject();
    utoopackMock.clientStats = clientStatsFor(["main.js", "main.css"]);
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createServerBuildContext(config, cwd);
    const outputs: BuildOutput[] = [];
    const factsSnapshots: BundlerBuildFacts[] = [];
    const onServerBundleReady = vi.fn(async () => {});
    const callbacks = createFrameworkCallbacks({
      config,
      cwd,
      ...buildContext,
      onBuildOutput(output) {
        outputs.push(output);
      },
      onServerBundleReady,
    });
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: {
        ...callbacks,
        async onBuildFacts(facts, options) {
          factsSnapshots.push(facts);
          return callbacks.onBuildFacts(facts, options);
        },
      },
      hooks: [],
    });

    try {
      await waitForCondition(
        () =>
          outputs.length === 1 && onServerBundleReady.mock.calls.length === 1,
        "Utoopack did not publish the initial server batch",
      );
      const initialOutput = outputs[0];
      if (!initialOutput) throw new Error("Expected initial build output.");
      const acceptedServer = structuredClone(initialOutput.server);
      expect(factsSnapshots[0]?.emittedFiles?.client).toContain("main.js");
      const pendingFiles = [
        "server-pending.js",
        "page-server-index-pending.js",
      ];
      await Promise.all(
        pendingFiles.map((file) =>
          fs.promises.writeFile(path.join(cwd, "dist/server", file), ""),
        ),
      );
      const pendingStats = JSON.stringify({
        assets: pendingFiles.map((name) => ({ name })),
        entrypoints: {
          server: { assets: [{ name: "server-pending.js" }] },
          "page-server-index": {
            assets: [{ name: "page-server-index-pending.js" }],
          },
        },
      });

      for (const [index, serverStats] of ["null", pendingStats].entries()) {
        await fs.promises.writeFile(
          path.join(cwd, "dist/server/stats.json"),
          serverStats,
        );
        const root = `root-before-server-${index}.js`;
        // Entrypoint-only stats must not inherit the previous client inventory.
        await writeClientStats(cwd, [root, "main.js"], index === 0);
        await expect
          .poll(() =>
            fs.promises.readFile(
              path.join(cwd, "dist/client/index.html"),
              "utf-8",
            ),
          )
          .toContain(`src="/${root}"`);
        expect(outputs).toHaveLength(index + 2);
        expect(outputs.at(-1)?.server).toEqual(acceptedServer);
        expect(onServerBundleReady).toHaveBeenCalledTimes(1);
        if (index === 1) {
          expect(factsSnapshots.at(-1)?.emittedFiles?.client).toBeUndefined();
        }
      }
    } finally {
      await controller.close();
    }
  });

  it("waits for the first server batch before publishing client artifacts", async () => {
    utoopackMock.deferInitialServerBuild = true;
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createServerBuildContext(config, cwd);
    const onBuildOutput = vi.fn();
    const onServerBundleReady = vi.fn(async () => {});
    const rebuildFlags: boolean[] = [];
    const callbacks = createFrameworkCallbacks({
      config,
      cwd,
      ...buildContext,
      onBuildOutput,
      onServerBundleReady,
    });
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: {
        ...callbacks,
        async onBuildFacts(facts, options) {
          rebuildFlags.push(options.isRebuild);
          return callbacks.onBuildFacts(facts, options);
        },
      },
      hooks: [],
    });

    try {
      await writeClientStats(cwd, ["root-before-server.js", "main.js"]);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(onBuildOutput).not.toHaveBeenCalled();
      expect(onServerBundleReady).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(cwd, "dist/client/index.html"))).toBe(
        false,
      );

      const onServerBuild =
        utoopackMock.startUtoopackDevWorker.mock.calls.at(-1)?.[0]
          .onServerBuild;
      if (!onServerBuild) throw new Error("Expected a server build callback.");
      await onServerBuild();
      expect(onBuildOutput).toHaveBeenCalledTimes(1);
      expect(onServerBundleReady).toHaveBeenCalledTimes(1);
      expect(rebuildFlags).toEqual([false]);
      await expect(
        fs.promises.readFile(path.join(cwd, "dist/client/index.html"), "utf-8"),
      ).resolves.toContain('src="/root-before-server.js"');
    } finally {
      await controller.close();
    }
  });

  it("serializes client publication with a concurrent server batch", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createServerBuildContext(config, cwd);
    const onBuildOutput = vi.fn();
    const onServerBundleReady = vi.fn(async () => {});
    const callbacks = createFrameworkCallbacks({
      config,
      cwd,
      ...buildContext,
      onBuildOutput,
      onServerBundleReady,
    });
    const publicationGate = deferred();
    let publicationCount = 0;
    let activePublications = 0;
    let maximumPublications = 0;
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: {
        ...callbacks,
        async onBuildFacts(facts, options) {
          publicationCount += 1;
          activePublications += 1;
          maximumPublications = Math.max(
            maximumPublications,
            activePublications,
          );
          try {
            if (publicationCount === 2) await publicationGate.promise;
            return await callbacks.onBuildFacts(facts, options);
          } finally {
            activePublications -= 1;
          }
        },
      },
      hooks: [],
    });

    try {
      await waitForCondition(
        () =>
          onBuildOutput.mock.calls.length === 1 &&
          onServerBundleReady.mock.calls.length === 1,
        "Utoopack did not publish the initial server batch",
      );
      await writeClientStats(cwd, ["root-queued.js", "main.js"]);
      await waitForCondition(
        () => publicationCount === 2,
        "Utoopack did not begin the client publication",
      );
      const onServerBuild =
        utoopackMock.startUtoopackDevWorker.mock.calls.at(-1)?.[0]
          .onServerBuild;
      if (!onServerBuild) throw new Error("Expected a server build callback.");
      const serverPublication = onServerBuild();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(publicationCount).toBe(2);
      expect(maximumPublications).toBe(1);

      publicationGate.resolve();
      await serverPublication;
      expect(publicationCount).toBe(3);
      expect(maximumPublications).toBe(1);
      expect(onBuildOutput).toHaveBeenCalledTimes(3);
      expect(onServerBundleReady).toHaveBeenCalledTimes(2);
    } finally {
      publicationGate.resolve();
      await controller.close();
    }
  });

  it("drains active client publication and ignores changes after closing", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const onBuildOutput = vi.fn();
    const callbacks = createFrameworkCallbacks({
      config,
      cwd,
      ...buildContext,
      onBuildOutput,
    });
    const publicationGate = deferred();
    let clientPublicationStarted = false;
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: {
        ...callbacks,
        async onBuildFacts(facts, options) {
          if (options.isRebuild) {
            clientPublicationStarted = true;
            await publicationGate.promise;
          }
          return callbacks.onBuildFacts(facts, options);
        },
      },
      hooks: [],
    });

    try {
      await waitForCondition(
        () => onBuildOutput.mock.calls.length === 1,
        "Utoopack did not publish initial client artifacts",
      );
      await writeClientStats(cwd, ["root-before-close.js", "main.js"]);
      await waitForCondition(
        () => clientPublicationStarted,
        "Utoopack did not begin the client publication",
      );
      let closed = false;
      const closing = controller.close().then(() => {
        closed = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(closed).toBe(false);

      publicationGate.resolve();
      await closing;
      expect(onBuildOutput).toHaveBeenCalledTimes(2);
      const htmlPath = path.join(cwd, "dist/client/index.html");
      const htmlBeforeChange = await fs.promises.readFile(htmlPath, "utf-8");
      await writeClientStats(cwd, ["root-after-close.js", "main.js"]);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await fs.promises.readFile(htmlPath, "utf-8")).toBe(
        htmlBeforeChange,
      );
      expect(onBuildOutput).toHaveBeenCalledTimes(2);
      expect(utoopackMock.workerClose).toHaveBeenCalledTimes(1);
    } finally {
      publicationGate.resolve();
      await controller.close();
    }
  });

  it("waits for readable stats until the session is aborted", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const abortController = new AbortController();
    const pending = utoopackAdapterTesting.waitForReadableDevStats(
      cwd,
      buildContext.plan,
      abortController.signal,
    );
    setTimeout(() => abortController.abort(), 50);

    await expect(pending).rejects.toThrow(
      "closed while waiting for build stats",
    );
  });

  it("returns a listening controller before initial facts are published", async () => {
    utoopackMock.clientStatsDelayMs = 100;
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const onBuildOutput = vi.fn();
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
        onBuildOutput,
      }),
      hooks: [],
    });

    try {
      expect(controller.origin).toBe("http://localhost:3210");
      expect(utoopackMock.startUtoopackDevWorker).toHaveBeenCalledWith(
        expect.objectContaining({ cwd }),
      );
      expect(onBuildOutput).not.toHaveBeenCalled();
      await waitForCondition(
        () => onBuildOutput.mock.calls.length > 0,
        "Utoopack did not publish its initial build facts",
      );
      expect(onBuildOutput).toHaveBeenCalledTimes(1);
    } finally {
      await controller.close();
    }
  });

  it("runs client middleware through the shared public server", async () => {
    const port = await reserveClientDevMiddlewareUpstreamPort();
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      dev: { port },
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const origins: string[] = [];
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
      }),
      hooks: [],
      clientMiddlewares: [
        async (request, response, next, context) => {
          origins.push(context.origin);
          if (request.url === "/__middleware") {
            response.end("handled by Utoopack middleware");
            return;
          }
          await next();
        },
      ],
    });

    try {
      await expect(
        fetch(`${controller.origin}/__middleware`).then((response) =>
          response.text(),
        ),
      ).resolves.toBe("handled by Utoopack middleware");
      expect(controller.origin).toBe(`http://localhost:${port}`);
      expect(origins).toEqual([controller.origin]);
      const workerOptions = utoopackMock.startUtoopackDevWorker.mock.calls.at(
        -1,
      )?.[0] as { server: { https: boolean; port: number } } | undefined;
      expect(workerOptions?.server.https).toBe(false);
      expect(workerOptions?.server.port).not.toBe(port);
    } finally {
      await controller.close();
    }
  });

  it.each([
    "null",
    '{"entrypoints":',
    JSON.stringify({ entrypoints: {} }),
  ])("recovers when initial stats are incomplete: %s", async (initialStats) => {
    utoopackMock.initialClientStats = initialStats;
    utoopackMock.clientStatsDelayMs = 100;
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const rebuildFlags: boolean[] = [];
    const callbacks = createFrameworkCallbacks({
      config,
      cwd,
      ...buildContext,
    });
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: {
        ...callbacks,
        async onBuildFacts(facts, options) {
          rebuildFlags.push(options.isRebuild);
          return callbacks.onBuildFacts(facts, options);
        },
      },
      hooks: [],
    });

    try {
      expect(rebuildFlags).toEqual([]);
      await waitForCondition(
        () => rebuildFlags.length > 0,
        "Utoopack did not recover after stats became readable",
      );
      expect(rebuildFlags).toEqual([false]);
      expect(utoopackMock.workerClose).not.toHaveBeenCalled();
    } finally {
      await controller.close();
    }
  });

  it("keeps the last published artifacts while replacement stats are unreadable", async () => {
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const outputs: BuildOutput[] = [];
    const controller = await utoopackAdapterTesting.startUtoopackDev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
        onBuildOutput(output) {
          outputs.push(output);
        },
      }),
      hooks: [],
    });

    try {
      await waitForCondition(
        () => outputs.length === 1,
        "Utoopack did not publish initial artifacts",
      );
      const htmlPath = path.join(cwd, "dist/client/index.html");
      const initialHtml = await fs.promises.readFile(htmlPath, "utf-8");
      const statsPath = path.join(cwd, "dist/client/stats.json");
      await fs.promises.writeFile(statsPath, "null", "utf-8");
      const pending = controller.processServerBuild();
      await new Promise((resolve) => setTimeout(resolve, 75));

      expect(outputs).toHaveLength(1);
      await expect(fs.promises.readFile(htmlPath, "utf-8")).resolves.toBe(
        initialHtml,
      );

      await fs.promises.writeFile(path.join(cwd, "dist/client/main-v2.js"), "");
      await fs.promises.writeFile(
        statsPath,
        JSON.stringify({
          entrypoints: {
            main: { assets: [{ name: "main-v2.js" }] },
          },
        }),
        "utf-8",
      );
      await expect(pending).resolves.toBeUndefined();
      expect(outputs).toHaveLength(2);
      await expect(fs.promises.readFile(htmlPath, "utf-8")).resolves.toContain(
        'src="/main-v2.js"',
      );
    } finally {
      await controller.close();
    }
  });

  it("closes promptly while waiting for initial stats", async () => {
    utoopackMock.omitClientStats = true;
    const cwd = await makeProject();
    const config = await resolveProjectConfig(cwd, {
      routing: { mode: "spa" },
    });
    const buildContext = await createBuildContext(config, cwd);
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
      }),
      hooks: [],
    });

    await expect(
      Promise.race([
        controller.close(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Utoopack close did not cancel stats")),
            750,
          ),
        ),
      ]),
    ).resolves.toBeUndefined();
    expect(utoopackMock.workerClose).toHaveBeenCalledOnce();
  });

  it("publishes completed server endpoint builds even when stats stay unchanged", async () => {
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
    const onServerBundleReady = vi.fn(async () => {});
    const onBuildOutput = vi.fn();
    const rebuildFlags: boolean[] = [];
    const callbacks = createFrameworkCallbacks({
      config,
      cwd,
      graph,
      plan,
      onBuildOutput,
      onServerBundleReady,
    });
    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      signal: new AbortController().signal,
      plan,
      callbacks: {
        ...callbacks,
        async onBuildFacts(facts, options) {
          rebuildFlags.push(options.isRebuild);
          return callbacks.onBuildFacts(facts, options);
        },
      },
      hooks: [],
    });

    try {
      await waitForCondition(
        () =>
          onBuildOutput.mock.calls.length === 1 &&
          onServerBundleReady.mock.calls.length === 1,
        "Utoopack did not publish its initial server build facts",
      );
      expect(onBuildOutput.mock.calls[0]?.[0].server.renderers).toMatchObject({
        "page-server-index": {
          kind: "page-server",
          assets: { js: ["page-server-index.js"], css: [] },
        },
      });
      const onServerBuild =
        utoopackMock.startUtoopackDevWorker.mock.calls.at(-1)?.[0]
          .onServerBuild;
      if (!onServerBuild) throw new Error("Expected a server build callback.");
      const statsPath = path.join(cwd, "dist/server/stats.json");
      const statsBefore = await fs.promises.stat(statsPath, { bigint: true });
      await fs.promises.writeFile(
        path.join(cwd, "dist/server/page-server-index.js"),
        "// Updated Page implementation without changing the asset inventory.\n",
      );
      await onServerBuild();
      expect(onBuildOutput).toHaveBeenCalledTimes(2);
      expect(onServerBundleReady).toHaveBeenCalledTimes(2);
      const statsAfter = await fs.promises.stat(statsPath, { bigint: true });
      expect(statsAfter.mtimeNs).toBe(statsBefore.mtimeNs);

      await Promise.all(
        ["page-server-index.updated.js", "server-shared.updated.js"].map(
          (file) =>
            fs.promises.writeFile(path.join(cwd, "dist/server", file), ""),
        ),
      );
      await fs.promises.writeFile(
        statsPath,
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

      await onServerBuild();
      expect(onBuildOutput).toHaveBeenCalledTimes(3);
      expect(onServerBundleReady).toHaveBeenCalledTimes(3);
      expect(onBuildOutput.mock.calls[2]?.[0].server.renderers).toMatchObject({
        "page-server-index": {
          kind: "page-server",
          assets: { js: ["page-server-index.updated.js"], css: [] },
        },
      });
      expect(rebuildFlags).toEqual([false, true, true]);
    } finally {
      await controller.close();
    }
  });

  it("emits canonical dev artifacts under the configured client output", async () => {
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
      signal: new AbortController().signal,
      plan: buildContext.plan,
      callbacks: createFrameworkCallbacks({
        config,
        cwd,
        ...buildContext,
      }),
      hooks: [],
    });

    try {
      const metadataPath = path.join(
        cwd,
        "custom-dist/deployment-metadata.json",
      );
      const htmlPath = path.join(cwd, "custom-dist/client/index.html");
      await waitForCondition(
        () => fs.existsSync(metadataPath) && fs.existsSync(htmlPath),
        "Utoopack did not emit framework dev artifacts",
      );
      expect(fs.existsSync(path.join(cwd, "dist/manifest.json"))).toBe(false);
      expect(fs.existsSync(path.join(cwd, "custom-dist/manifest.json"))).toBe(
        false,
      );
    } finally {
      await controller.close();
    }
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

async function createServerBuildContext(
  config: ResolvedConfig<ConfigComplete>,
  cwd: string,
) {
  const initial = await createBuildContext(config, cwd);
  const graph = structuredClone(initial.graph);
  const page = graph.pages.index;
  if (!page) throw new Error("Expected index Page.");
  page.render = "ssr";
  return {
    graph,
    plan: createBuildPlan(config, graph, { mode: "development" }),
  };
}
