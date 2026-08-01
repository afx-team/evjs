import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  type BuildOutput,
  type BuildPlan,
  type CoreGraph,
  PAGE_ANCHOR_PROVIDER_ID,
} from "@evjs/shared/manifest";
import { configureSync, resetSync } from "@logtape/logtape";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import {
  createPageClientBuildEntryName,
  createPageServerBuildEntryName,
  createPprShellBuildEntryName,
  createRscPageBuildEntryName,
} from "../src/_internal/build/build-entry-conventions.js";
import type {
  BundlerAdapter,
  BundlerBuildFacts,
  BundlerBuildFactsDisposition,
  BundlerDevController,
  BundlerDevUpdateTransition,
} from "../src/_internal/build/bundler.js";
import { isEmptyBuildPlanUpdate } from "../src/_internal/build/bundler.js";
import {
  build,
  dev,
  prepareFrameworkBuild,
} from "../src/_internal/build/commands.js";
import { loadConfigFile } from "../src/_internal/build/config-module.js";
import { materializeFrameworkIR } from "../src/_internal/build/generated-contributions.js";
import { PAGE_ANCHOR_ROUTE_CONVENTION_SUMMARY } from "../src/_internal/build/page-route-conventions.js";
import {
  PAGE_ROUTE_TYPES_MARKER,
  PAGE_ROUTE_TYPES_USAGE_HINT,
} from "../src/_internal/build/page-route-types.js";
import type { Config } from "../src/config/index.js";
import type {
  BuildResult,
  FrameworkPageView,
  FrameworkRouteView,
  HtmlDocument,
  Plugin,
} from "../src/plugin/index.js";
import { definePlugin, pluginConfig } from "../src/plugin/index.js";

const repoRoot = path.resolve(process.cwd(), "../..");
const generatedRouteTypesSource = [
  "/* eslint-disable */",
  PAGE_ROUTE_TYPES_MARKER,
  PAGE_ROUTE_TYPES_USAGE_HINT,
  "export {};",
].join("\n");
const devStartupTimeoutMs = 10_000;
const devUpdateTimeoutMs = 10_000;
const routeTypeCheckTimeoutMs = 30_000;
const fullBundlerCapabilities = {
  build: {
    server: true,
    rsc: true,
    ppr: true,
  },
  dev: {
    html: true,
    entries: true,
    routes: true,
    server: true,
    resolution: true,
  },
} as const;
const BUILD_OUTPUT_HOOK_OWNERSHIP_ERROR =
  "[evjs] buildOutput hooks cannot change non-asset BuildOutput fields. Hooks may only adjust existing AssetGroup contents or deployment metadata.";

type TestDevTransitionOutcome = "accept" | "rollback";

function createTestDevController(
  implementation: Omit<
    BundlerDevController<Record<string, never>>,
    "beginUpdate"
  >,
  hooks: {
    onBegin?(): void | Promise<void>;
    onPrepareFinalize?(): void | Promise<void>;
    onFinalize?(): unknown;
    onResume?(outcome: TestDevTransitionOutcome): void | Promise<void>;
  } = {},
): BundlerDevController<Record<string, never>> {
  let active:
    | {
        outcome?: TestDevTransitionOutcome;
        prepared: boolean;
        resumed: boolean;
        resumeFailed: boolean;
        transition: BundlerDevUpdateTransition;
      }
    | undefined;

  return {
    ...implementation,
    async beginUpdate() {
      if (active) {
        throw new Error("Test bundler received overlapping update boundaries.");
      }
      const transition: BundlerDevUpdateTransition = {
        accept() {
          select("accept");
        },
        rollback() {
          select("rollback");
        },
        async resume() {
          if (!active?.outcome) {
            throw new Error(
              "Test bundler resumed an update before selecting an outcome.",
            );
          }
          if (active.resumed) {
            throw new Error("Test bundler resumed an update outcome twice.");
          }
          const outcome = active.outcome;
          try {
            await hooks.onResume?.(outcome);
            if (active) active.resumed = true;
          } catch (error) {
            if (active) active.resumeFailed = true;
            throw error;
          }
        },
        async prepareFinalize() {
          if (!active?.resumed) {
            throw new Error(
              "Test bundler prepared finalization before a successful resume.",
            );
          }
          await hooks.onPrepareFinalize?.();
          if (active) active.prepared = true;
        },
        finalize() {
          if (!active?.prepared) {
            throw new Error(
              "Test bundler finalized an update before successful preparation.",
            );
          }
          const result = hooks.onFinalize?.();
          active = undefined;
          return result as undefined;
        },
      };
      const select = (outcome: TestDevTransitionOutcome) => {
        if (!active) {
          throw new Error("Test bundler selected a settled update boundary.");
        }
        if (
          active.outcome &&
          !(
            active.outcome === "accept" &&
            outcome === "rollback" &&
            (active.resumeFailed || active.resumed) &&
            !active.prepared
          )
        ) {
          throw new Error("Test bundler selected an update outcome twice.");
        }
        active.outcome = outcome;
        active.prepared = false;
        active.resumed = false;
        active.resumeFailed = false;
      };
      active = {
        prepared: false,
        resumed: false,
        resumeFailed: false,
        transition,
      };
      await hooks.onBegin?.();
      return transition;
    },
    async updatePlan(update, options) {
      if (!active || options.transition !== active.transition) {
        throw new Error(
          "Test bundler updatePlan() did not receive its active transition.",
        );
      }
      await implementation.updatePlan(update, options);
    },
  };
}

interface EmbeddedClientRuntime {
  runtime: {
    server?: Record<string, unknown>;
  };
  app?: Record<string, unknown>;
  routing: {
    kind: string;
    pages?: Record<string, Record<string, unknown>>;
    routes?: Array<Record<string, unknown>>;
  };
  [key: string]: unknown;
}

async function writeFile(
  file: string,
  data: string | NodeJS.ArrayBufferView,
  options?: Parameters<typeof fs.promises.writeFile>[2],
): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, data, options);
}

type ControlledFsWatcher = EventEmitter & {
  close: ReturnType<typeof vi.fn>;
  ref(): fs.FSWatcher;
  unref(): fs.FSWatcher;
};

function installControlledFsWatch() {
  const records: Array<{
    listener: (
      eventType: fs.WatchEventType,
      filename: string | Buffer | null,
    ) => void;
    target: string;
    watcher: ControlledFsWatcher;
  }> = [];
  const spy = vi.spyOn(fs, "watch").mockImplementation(((
    ...args: unknown[]
  ) => {
    const watcher = new EventEmitter() as ControlledFsWatcher;
    watcher.close = vi.fn();
    watcher.ref = () => watcher as fs.FSWatcher;
    watcher.unref = () => watcher as fs.FSWatcher;
    records.push({
      listener: args.at(-1) as (typeof records)[number]["listener"],
      target: path.resolve(String(args[0])),
      watcher,
    });
    return watcher;
  }) as never);

  return {
    async dispatchFileChange(file: string): Promise<void> {
      const watchTarget = path.dirname(file);
      await vi.waitFor(() =>
        expect(
          records.some(
            (record) =>
              record.target === watchTarget &&
              record.watcher.close.mock.calls.length === 0,
          ),
        ).toBe(true),
      );
      for (const record of records) {
        if (
          record.target === watchTarget &&
          record.watcher.close.mock.calls.length === 0
        ) {
          record.listener("change", path.basename(file));
        }
      }
    },
    restore() {
      spy.mockRestore();
    },
  };
}

async function createProject() {
  const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "evjs-"));
  await writeFile(
    path.join(cwd, "index.html"),
    '<div id="app"></div>',
    "utf-8",
  );
  return cwd;
}

async function createSpaProject() {
  const cwd = await createProject();
  await writeFile(
    path.join(cwd, "src/pages/page.tsx"),
    "export default function Page() { return null; }",
    "utf-8",
  );
  return cwd;
}

async function createServerOutputProject() {
  const cwd = await createSpaProject();
  await writeFile(
    path.join(cwd, "src/pages/page.tsx"),
    [
      'import { saveValue } from "../actions.server";',
      "void saveValue;",
      "export default function Page() { return null; }",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(cwd, "src/pages/page.config.ts"),
    'export default { title: "Original", meta: { description: "One", keywords: "Two" } };',
    "utf-8",
  );
  await writeFile(
    path.join(cwd, "src/actions.server.ts"),
    [
      '"use server";',
      "export async function saveValue() { return { ok: true }; }",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(cwd, "src/apis/health/api.ts"),
    [
      "export const GET = () => Response.json({ ok: true });",
      "export const POST = () => Response.json({ ok: true });",
    ].join("\n"),
    "utf-8",
  );
  return cwd;
}

function generatedImport(cwd: string, fromFile: string, targetFile: string) {
  let relative = path
    .relative(
      path.dirname(path.resolve(cwd, fromFile)),
      path.resolve(cwd, targetFile),
    )
    .split(path.sep)
    .join(path.posix.sep);
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative.replace(/\.(?:[cm]?[jt]sx?)$/, "");
}

function readEmbeddedClientRuntime(html: string): EmbeddedClientRuntime {
  const match = html.match(
    /<script\b(?=[^>]*\bid="__EVJS_CLIENT_RUNTIME__")(?=[^>]*\btype="application\/json")[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) {
    throw new Error("Expected embedded client runtime script.");
  }
  return JSON.parse(match[1]) as EmbeddedClientRuntime;
}

async function createWorkspaceProject() {
  const root = path.join(repoRoot, "test-results");
  await fs.promises.mkdir(root, { recursive: true });
  const cwd = await fs.promises.mkdtemp(path.join(root, "evjs-"));
  await writeFile(
    path.join(cwd, "index.html"),
    '<div id="app"></div>',
    "utf-8",
  );
  return cwd;
}

async function writeRouteTypeCheckTsConfig(cwd: string) {
  await fs.promises.mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(
    path.join(cwd, "src/evjs-test-env.d.ts"),
    [
      'declare module "react-server-dom-webpack/client" {',
      "  export function createFromFetch(",
      "    fetchPromise: Promise<Response>,",
      "    options?: { moduleBaseURL?: string },",
      "  ): unknown;",
      "}",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(cwd, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          jsx: "react-jsx",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          types: ["node"],
          paths: {
            "@evjs/ev/_internal/client/route-types": [
              "../../packages/ev/src/_internal/generated/client/route-types.ts",
            ],
            "@evjs/ev/route": ["../../packages/ev/src/route/index.ts"],
            "@evjs/ev/navigation": [
              "../../packages/ev/src/navigation/index.ts",
            ],
            "@evjs/client": ["../../packages/client/src/index.ts"],
            "@evjs/shared": ["../../packages/shared/src/index.ts"],
          },
        },
        include: ["src"],
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function createMockBundler(
  events: string[],
  options: {
    onBuildPlan?: (plan: BuildPlan) => void;
    recordEndpoint?: boolean;
  } = {},
): BundlerAdapter<Record<string, never>> {
  return {
    name: "mock",
    capabilities: fullBundlerCapabilities,
    async build({ config, plan }) {
      options.onBuildPlan?.(plan);
      events.push("bundler.build");
      events.push(
        `bundler.entries:${plan.entries.map((entry) => entry.name).join(",")}`,
      );
      if (options.recordEndpoint) {
        events.push(`bundler.endpoint:${config.server.runtime.fn}`);
      }
      return {
        clientEntryAssets: Object.fromEntries(
          plan.entries
            .filter((entry) => entry.environment === "client")
            .map((entry) => [
              entry.name,
              { js: [`${entry.name}.js`], css: [] },
            ]),
        ),
        ...serverBuildFacts(plan),
      };
    },
    async dev() {
      events.push("bundler.dev");
    },
  };
}

function serverBuildFacts(
  plan: BuildPlan,
): Pick<
  BundlerBuildFacts,
  "serverEntryAssets" | "serverEntry" | "serverAssets"
> {
  const serverEntryAssets = Object.fromEntries(
    plan.entries
      .filter((entry) => entry.environment === "server")
      .map((entry) => [entry.name, { js: [`${entry.name}.js`], css: [] }]),
  );
  const serverRuntimeEntry = plan.entries.find(
    (entry) => entry.kind === "server-runtime",
  );
  if (!serverRuntimeEntry) {
    return Object.keys(serverEntryAssets).length > 0
      ? { serverEntryAssets }
      : {};
  }

  return {
    serverEntryAssets,
    serverEntry: `${serverRuntimeEntry.name}.js`,
    serverAssets: { js: [`${serverRuntimeEntry.name}.js`], css: [] },
  };
}

function createRouteUpdateBundler(
  cwd: string,
  events: string[],
  routeLiteral: string,
): BundlerAdapter<Record<string, never>> {
  return {
    name: "mock",
    capabilities: fullBundlerCapabilities,
    async build() {
      return {};
    },
    async dev({ plan }) {
      recordPagesAppRoutes("initial", plan.entries[0]?.metadata, events);
      return createTestDevController({
        async updatePlan(update, options) {
          options.activate();
          if (isEmptyBuildPlanUpdate(update)) return;
          recordPagesAppRoutes(
            "changed",
            update.entries.changed[0]?.metadata,
            events,
          );
          const routeTypes = await fs.promises.readFile(
            path.join(cwd, "src/route-types.d.ts"),
            "utf-8",
          );
          events.push(
            `types:${routeTypes.includes(JSON.stringify(routeLiteral))}`,
          );
          process.emit("SIGINT");
        },
      });
    },
  };
}

function recordPagesAppRoutes(
  label: string,
  metadata:
    | NonNullable<import("@evjs/shared/manifest").BuildEntry["metadata"]>
    | undefined,
  events: string[],
): void {
  if (metadata?.type !== "pages-app") return;
  events.push(
    `${label}:${metadata.routes.map((route) => route.path).join(",")}`,
  );
}

async function waitForEvent(
  events: string[],
  event: string,
  timeoutMs = devUpdateTimeoutMs,
): Promise<void> {
  const startedAt = Date.now();
  while (!events.includes(event)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Timed out waiting for event: ${event}. Observed: ${events.join(", ")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForEventCountToStabilize(
  events: string[],
  event: string,
  quietMs = 150,
  timeoutMs = devUpdateTimeoutMs,
): Promise<number> {
  const startedAt = Date.now();
  const pollIntervalMs = 20;
  const requiredStableChecks = Math.max(1, Math.ceil(quietMs / pollIntervalMs));
  let lastCount = events.filter((entry) => entry === event).length;
  let stableChecks = 0;

  while (stableChecks < requiredStableChecks) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `Timed out waiting for event count to stabilize: ${event}. Observed: ${events.join(", ")}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const currentCount = events.filter((entry) => entry === event).length;
    if (currentCount === lastCount) {
      stableChecks += 1;
      continue;
    }
    lastCount = currentCount;
    stableChecks = 0;
  }

  return lastCount;
}

function captureFrameworkUpdateFailures(
  events: string[],
  expectedMessage: string,
): () => void {
  return captureFrameworkWarning(
    events,
    "Failed to update framework dev state:",
    expectedMessage,
    "framework-update-failed",
  );
}

function captureFrameworkWarning(
  events: string[],
  expectedPrefix: string,
  expectedMessage: string,
  event: string,
): () => void {
  configureSync({
    reset: true,
    sinks: {
      memory(record) {
        const message = record.message.map(String).join("");
        if (
          message.startsWith(expectedPrefix) &&
          message.includes(expectedMessage)
        ) {
          events.push(event);
        }
      },
    },
    loggers: [
      { category: ["logtape", "meta"], lowestLevel: "fatal" },
      { category: ["evjs"], sinks: ["memory"], lowestLevel: "warning" },
    ],
  });
  return () => resetSync();
}

function captureGeneratedTypeRollbackConflicts(events: string[]): () => void {
  configureSync({
    reset: true,
    sinks: {
      memory(record) {
        const message = record.message.map(String).join("");
        if (!message.startsWith("Generated types rollback preserved")) return;
        if (message.includes("route-types.d.ts")) {
          events.push("preserved:route-types.d.ts");
        }
        if (message.includes("plugin-types.d.ts")) {
          events.push("preserved:plugin-types.d.ts");
        }
      },
    },
    loggers: [
      { category: ["logtape", "meta"], lowestLevel: "fatal" },
      { category: ["evjs"], sinks: ["memory"], lowestLevel: "warning" },
    ],
  });
  return () => resetSync();
}

async function waitForFileContents(
  file: string,
  expected: Buffer,
  timeoutMs = devUpdateTimeoutMs,
): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    try {
      const current = await fs.promises.readFile(file);
      if (current.equals(expected)) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for file contents: ${file}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function readDirectorySnapshot(
  root: string,
): Promise<Record<string, string>> {
  const files: Array<[string, string]> = [];

  async function visit(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push([
        path.relative(root, absolute).split(path.sep).join("/"),
        (await fs.promises.readFile(absolute)).toString("base64"),
      ]);
    }
  }

  await visit(root);
  return Object.fromEntries(files);
}

describe("prepareFrameworkBuild", () => {
  it("releases its project operation lock before returning", async () => {
    const cwd = await createSpaProject();
    const prepared = await prepareFrameworkBuild(
      { routing: { mode: "spa" } },
      { cwd, runLifecycleHooks: false },
    );

    try {
      await expect(
        build(
          { routing: { mode: "spa" } },
          { cwd, bundler: createMockBundler([]) },
        ),
      ).resolves.toBeUndefined();
    } finally {
      await prepared.dispose();
    }
  });

  it("rejects unsafe output directories before framework preparation", async () => {
    const cwd = await createProject();
    const events: string[] = [];

    await expect(
      prepareFrameworkBuild(
        { output: { client: "dist", server: "dist/server" } },
        { cwd, bundler: createMockBundler(events) },
      ),
    ).rejects.toThrow(
      "[evjs] output.client and output.server must be separate, non-nested directories.",
    );
    expect(events).toEqual([]);
  });

  it("rejects mismatched command and mode options", async () => {
    const cwd = await createProject();

    await expect(
      prepareFrameworkBuild(
        { output: { client: "dist/client", server: "dist/server" } },
        { cwd, command: "build", mode: "development" },
      ),
    ).rejects.toThrow(
      'prepareFrameworkBuild command "build" must use mode "production"',
    );
  });

  it("rejects invalid option bundler adapters", async () => {
    const cwd = await createProject();

    await expect(
      prepareFrameworkBuild(
        { output: { client: "dist/client", server: "dist/server" } },
        {
          cwd,
          bundler: [] as never,
        },
      ),
    ).rejects.toThrow(
      "[evjs] options.bundler must be a bundler adapter object.",
    );

    await expect(
      prepareFrameworkBuild(
        { output: { client: "dist/client", server: "dist/server" } },
        {
          cwd,
          bundler: {
            name: "custom",
            capabilities: fullBundlerCapabilities,
            build: async () => {},
            dev: "run" as never,
          } as never,
        },
      ),
    ).rejects.toThrow("[evjs] options.bundler.dev must be a function.");
  });

  it("prepares framework inputs without exposing graph and plan internals", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      name: "prepare-core",
      config(config, ctx) {
        events.push(`config:${ctx.command}`);
        return config;
      },
      setup(ctx) {
        expect(ctx.config.bundler).toBeUndefined();
        ctx.addWatchFile("./framework-extra.json");
        events.push(`setup:${ctx.command}`);
        return {
          buildStart() {
            events.push("buildStart");
          },
          dispose() {
            events.push("dispose");
          },
        };
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
      },
      { cwd },
    );

    expect(prepared.config.output.client).toBe("dist/client");
    expect("graph" in prepared).toBe(false);
    expect("plan" in prepared).toBe(false);
    expect("hooks" in prepared).toBe(false);
    expect("pluginContext" in prepared).toBe(false);
    expect(prepared.pluginWatchFiles).toEqual([
      path.join(cwd, "framework-extra.json"),
    ]);
    expect(events).toEqual(["config:build", "setup:build", "buildStart"]);

    await prepared.dispose();
    await prepared.dispose();

    expect(events).toEqual([
      "config:build",
      "setup:build",
      "buildStart",
      "dispose",
    ]);
  });

  it("syncs one stable static-config bridge regardless of active plugins", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default {};",
      "utf-8",
    );
    const analytics = definePlugin({
      id: "@test/analytics",
      key: "analytics",
      page: pluginConfig<{ channel: string }>(),
    });
    const access = definePlugin({
      id: "@test/access",
      key: "access",
      page: pluginConfig<{ policy: string }>(),
    });
    const pluginTypesFile = path.join(cwd, "src/plugin-types.d.ts");

    const initial = await prepareFrameworkBuild(
      { plugins: [analytics(), access()] },
      { cwd, runLifecycleHooks: false },
    );
    await initial.dispose();
    const initialTypes = await fs.promises.readFile(pluginTypesFile, "utf-8");
    expect(initialTypes).toContain(
      'readonly config: typeof import("../ev.config").default;',
    );

    const narrowed = await prepareFrameworkBuild(
      { plugins: [analytics()] },
      { cwd, runLifecycleHooks: false },
    );
    await narrowed.dispose();
    const narrowedTypes = await fs.promises.readFile(pluginTypesFile, "utf-8");
    expect(narrowedTypes).toBe(initialTypes);

    const empty = await prepareFrameworkBuild(
      {},
      { cwd, runLifecycleHooks: false },
    );
    await empty.dispose();
    await expect(fs.promises.readFile(pluginTypesFile, "utf-8")).resolves.toBe(
      initialTypes,
    );
  });

  it("exposes CLI flags to plugin setup and lifecycle hooks", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      name: "reads-cli-flags",
      setup(ctx) {
        events.push(`setup:${ctx.flags?.mock}:${ctx.flags?.coverage}`);
        return {
          buildStart(buildCtx) {
            events.push(
              `buildStart:${buildCtx.flags?.mock}:${buildCtx.flags?.coverage}`,
            );
          },
        };
      },
    };

    await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
      },
      {
        cwd,
        flags: {
          mock: true,
          coverage: true,
        },
      },
    );

    expect(events).toEqual(["setup:true:true", "buildStart:true:true"]);
  });

  it("rolls back earlier plugin setups when a later setup fails", async () => {
    const cwd = await createProject();
    const events: string[] = [];

    await expect(
      prepareFrameworkBuild(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [
            {
              name: "first",
              setup() {
                events.push("setup:first");
                return {
                  dispose() {
                    events.push("dispose:first");
                  },
                };
              },
            },
            {
              name: "second",
              setup() {
                events.push("setup:second");
                throw new Error("setup blocked");
              },
            },
          ],
        },
        { cwd },
      ),
    ).rejects.toThrow("setup blocked");

    expect(events).toEqual(["setup:first", "setup:second", "dispose:first"]);
  });

  it("disposes plugins in reverse order and continues after failures", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [
          {
            name: "first",
            setup() {
              return {
                dispose() {
                  events.push("dispose:first");
                },
              };
            },
          },
          {
            name: "second",
            setup() {
              return {
                dispose() {
                  events.push("dispose:second");
                  throw new Error("dispose blocked");
                },
              };
            },
          },
        ],
      },
      { cwd },
    );

    await expect(prepared.dispose()).rejects.toThrow("dispose blocked");
    expect(events).toEqual(["dispose:second", "dispose:first"]);
  });

  it("generates .ev framework IR and plugin contributions", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "generated-fixture",
      contributions(ctx) {
        expect(Object.isFrozen(ctx.framework)).toBe(true);
        expect(Object.isFrozen(ctx.framework.entries)).toBe(true);
        const mainEntry = ctx.framework.getEntry("main");
        expect(mainEntry).toBeDefined();
        expect(Object.isFrozen(mainEntry)).toBe(true);
        expect(mainEntry?.owner).toEqual({ applicationId: "default" });
        expect(mainEntry?.owner).not.toHaveProperty("appId");
        expect(ctx.framework.getApplicationEntry("default")).toBe(mainEntry);

        const runtime = ctx.emit.module({
          id: "runtime",
          scope: { kind: "application" },
          source: "export const value = 1;",
        });
        const entryCode = ctx.emit.module({
          id: "entry-code",
          scope: { kind: "application" },
          source: ({ importOf }) =>
            [
              `import { value } from ${JSON.stringify(importOf(runtime))};`,
              "window.__evGeneratedValue = value;",
            ].join("\n"),
        });
        ctx.slot("client.entry").add({
          id: "entry-import",
          module: runtime,
          position: "before-main",
        });
        ctx.slot("client.entry").add({
          id: "entry-code-slot",
          module: entryCode,
          position: "after-main",
        });
        ctx.slot("resolve.external").add({
          id: "external",
          specifier: "qiankun",
          source: "qiankun",
          runtime: "client",
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      { cwd },
    );

    const manifestPath = path.join(cwd, ".ev/manifest.json");
    const manifest = JSON.parse(
      await fs.promises.readFile(manifestPath, "utf-8"),
    ) as BuildPlan & { graph: { rootDir: string } };
    const runtimeModule = manifest.generated?.modules.find(
      (module) => module.id === "runtime",
    );
    const entryCodeModule = manifest.generated?.modules.find(
      (module) => module.id === "entry-code",
    );
    const entry = manifest.generated?.entries.find(
      (item) => item.name === "main",
    );
    const frameworkGraph = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, ".ev/framework/core-graph.json"),
        "utf-8",
      ),
    ) as { graph: { rootDir: string } };
    const frameworkPlan = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, ".ev/framework/build-plan.json"),
        "utf-8",
      ),
    ) as { plan: BuildPlan };
    const generatedTypes = await fs.promises.readFile(
      path.join(cwd, ".ev/types.d.ts"),
      "utf-8",
    );

    expect(runtimeModule?.specifier).toBe(
      "evjs:generated/generated-fixture/runtime",
    );
    expect(manifest.graph).toMatchObject({ rootDir: cwd });
    expect(frameworkGraph.graph.rootDir).toBe(cwd);
    expect(frameworkPlan.plan.entries[0]?.import).toBe("./.ev/entries/main.ts");
    expect(manifest.generated?.frameworkFiles).toEqual([
      {
        id: "core-graph",
        file: "./.ev/framework/core-graph.json",
      },
      {
        id: "build-plan",
        file: "./.ev/framework/build-plan.json",
      },
    ]);
    expect(manifest.generated?.slots).toContainEqual(
      expect.objectContaining({
        slot: "client.entry",
        id: "entry-import",
        module: runtimeModule?.file,
        position: "before-main",
      }),
    );
    expect(manifest.generated?.importEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "generated-fixture:entry-code",
          to: "generated-fixture:runtime",
          kind: "module-import",
          specifier: generatedImport(
            cwd,
            entryCodeModule?.file ?? "",
            runtimeModule?.file ?? "",
          ),
        }),
        expect.objectContaining({
          from: "generated-fixture:entry-code-slot",
          to: "generated-fixture:entry-code",
          kind: "slot-module",
          specifier: entryCodeModule?.file,
        }),
      ]),
    );
    expect(manifest.resolve?.external).toEqual({
      qiankun: { source: "qiankun", runtime: "client" },
    });
    expect(entry?.file).toBe("./.ev/entries/main.ts");
    expect(generatedTypes).toContain('declare module "evjs:generated/*";');
    expect(generatedTypes).toContain('declare module "*.json";');
    await expect(
      fs.promises.readFile(path.join(cwd, runtimeModule?.file ?? ""), "utf-8"),
    ).resolves.toContain("export const value = 1;");
    await expect(
      fs.promises.readFile(
        path.join(cwd, entryCodeModule?.file ?? ""),
        "utf-8",
      ),
    ).resolves.toContain(
      `import { value } from "${generatedImport(
        cwd,
        entryCodeModule?.file ?? "",
        runtimeModule?.file ?? "",
      )}";`,
    );
    await expect(
      fs.promises.readFile(path.join(cwd, entry?.file ?? ""), "utf-8"),
    ).resolves.toContain(
      'import * as routeModule0 from "../../src/pages/page";',
    );

    await prepared.dispose();
  });

  it("allocates portable generated module paths past a hash collision", async () => {
    const cwd = await createSpaProject();
    const collidingIds = ["runtime", "runtime*`=)", "runtime{`{+"];
    const plugin: Plugin<Record<string, never>> = {
      name: "collision",
      contributions(ctx) {
        for (const id of collidingIds) {
          ctx.emit.module({
            id,
            scope: { kind: "application" },
            source: `export const id = ${JSON.stringify(id)};`,
          });
        }
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      { cwd },
    );

    try {
      const manifest = JSON.parse(
        await fs.promises.readFile(
          path.join(cwd, ".ev/manifest.json"),
          "utf-8",
        ),
      ) as BuildPlan;
      const generatedFiles = collidingIds.map((id) => {
        const generatedModule = manifest.generated?.modules.find(
          (module) => module.id === id,
        );
        if (!generatedModule) {
          throw new Error(`Expected generated module "${id}".`);
        }
        return generatedModule.file;
      });

      expect(generatedFiles).toEqual([
        "./.ev/plugins/collision/runtime.ts",
        "./.ev/plugins/collision/runtime-1344a0e3.ts",
        "./.ev/plugins/collision/runtime-1344a0e3-2.ts",
      ]);
      expect(
        new Set(
          generatedFiles.map((file) => file.normalize("NFC").toLowerCase()),
        ).size,
      ).toBe(generatedFiles.length);
      await Promise.all(
        generatedFiles.map((file) => fs.promises.access(path.join(cwd, file))),
      );
    } finally {
      await prepared.dispose();
    }
  });

  it("allocates portable generated entry paths past a hash collision", async () => {
    const cwd = await createProject();
    const collidingNames = ["runtime", "runtime&^^(", "runtime[}=)"];
    const plan: BuildPlan = {
      version: 1,
      buildId: "portable-entry-paths",
      mode: "production",
      distDir: "dist",
      output: {
        clientDir: "dist/client",
        serverDir: "dist/server",
      },
      entries: collidingNames.map((name) => ({
        name,
        import: "./src/entry.ts",
        environment: "client" as const,
        runtime: "browser" as const,
        kind: "runtime" as const,
        metadata: {
          type: "pages-app" as const,
          routes: [],
          mount: "#app",
        },
      })),
      html: [],
      server: {},
      runtime: {
        publicPath: "auto",
        server: { basePath: "/__evjs", fn: "__evjs/fn" },
      },
      dev: {
        clientRoutes: [],
        serverRequestRoutePaths: [],
        serverRenderedPagePaths: [],
        hasPpr: false,
      },
    };

    const materialized = await materializeFrameworkIR({
      cwd,
      mode: "production",
      command: "build",
      config: {} as never,
      graph: {} as CoreGraph,
      plan,
      plugins: [],
      pluginContext: {} as never,
      write: false,
    });

    expect(materialized.generated?.entries.map((entry) => entry.file)).toEqual([
      "./.ev/entries/runtime.ts",
      "./.ev/entries/runtime-01a49654.ts",
      "./.ev/entries/runtime-01a49654-2.ts",
    ]);
  });

  it("projects Page wrappers into SPA routes in deterministic nesting order", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "spa-page-wrappers",
      contributions(ctx) {
        const first = ctx.emit.module({
          id: "first-wrapper",
          scope: { kind: "application" },
          source:
            "export default function First({ children }) { return children; }",
          extension: ".tsx",
        });
        const second = ctx.emit.module({
          id: "second-wrapper",
          scope: { kind: "page", pageId: "index" },
          source:
            "export default function Second({ children }) { return children; }",
          extension: ".tsx",
        });
        ctx.slot("page.wrapper").add({
          id: "first-page-wrapper",
          module: first,
          runtime: "client",
          target: { kind: "application", applicationId: "default" },
        });
        ctx.slot("page.wrapper").add({
          id: "second-page-wrapper",
          module: second,
          runtime: "client",
          target: { kind: "page", pageId: "index" },
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      { cwd },
    );

    try {
      const manifest = JSON.parse(
        await fs.promises.readFile(
          path.join(cwd, ".ev/manifest.json"),
          "utf-8",
        ),
      ) as BuildPlan;
      const first = manifest.generated?.modules.find(
        (module) => module.id === "first-wrapper",
      );
      const second = manifest.generated?.modules.find(
        (module) => module.id === "second-wrapper",
      );
      const main = manifest.entries.find((entry) => entry.name === "main");
      const route =
        main?.metadata?.type === "pages-app"
          ? main.metadata.routes.find(
              (candidate) => candidate.target?.kind === "page",
            )
          : undefined;
      const source = await fs.promises.readFile(
        path.join(cwd, ".ev/entries/main.ts"),
        "utf-8",
      );

      expect(route?.wrappers).toEqual([second?.file, first?.file]);
      expect(manifest.generated?.slots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            slot: "page.wrapper",
            id: "first-page-wrapper",
            module: first?.file,
            runtime: "client",
            target: {
              kind: "application",
              applicationId: "default",
            },
          }),
          expect.objectContaining({
            slot: "page.wrapper",
            id: "second-page-wrapper",
            module: second?.file,
            runtime: "client",
            target: { kind: "page", pageId: "index" },
          }),
        ]),
      );
      expect(source).toContain(
        `import * as routeWrapperModule0_0 from "${generatedImport(
          cwd,
          ".ev/entries/main.ts",
          second?.file ?? "",
        )}";`,
      );
      expect(source).toContain(
        `import * as routeWrapperModule0_1 from "${generatedImport(
          cwd,
          ".ev/entries/main.ts",
          first?.file ?? "",
        )}";`,
      );
      expect(source).toContain(
        "wrappers: [routeWrapperModule0_0, routeWrapperModule0_1]",
      );
    } finally {
      await prepared.dispose();
    }
  });

  it("projects Page wrappers through MPA client and server Page entries", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/layout.tsx"),
      "export default function Layout({ children }) { return children; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/csr/page.tsx"),
      "export default function Csr() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/ssr/page.tsx"),
      "export default function Ssr() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/ssr/page.config.ts"),
      'export default { render: "ssr", hydrate: "load" };',
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/ssg/page.tsx"),
      "export default function Ssg() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/ssg/page.config.ts"),
      'export default { render: "ssg", hydrate: "none", prerender: true };',
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/rsc/page.tsx"),
      "export default function Rsc() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/rsc/page.config.ts"),
      'export default { render: "ssr", hydrate: "none", rsc: true };',
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/ppr/page.tsx"),
      `
        import * as React from "react";
        const Region = React.lazy(() => import("./Offer.region"));
        export default function Ppr() {
          return <React.Suspense fallback={null}><Region /></React.Suspense>;
        }
      `,
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/ppr/Offer.region.tsx"),
      "export default function Offer() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/ppr/page.config.ts"),
      `
        export default {
          render: "ssr",
          hydrate: "none",
          prerender: { partial: true },
        };
      `,
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "all-runtime-page-wrappers",
      contributions(ctx) {
        const first = ctx.emit.module({
          id: "first-wrapper",
          scope: { kind: "application" },
          source:
            "export default function First({ children }) { return children; }",
          extension: ".tsx",
        });
        const second = ctx.emit.module({
          id: "second-wrapper",
          scope: { kind: "application" },
          source:
            "export default function Second({ children }) { return children; }",
          extension: ".tsx",
        });
        ctx.slot("page.wrapper").add({
          id: "first-page-wrapper",
          module: first,
          target: { kind: "application" },
        });
        ctx.slot("page.wrapper").add({
          id: "second-page-wrapper",
          module: second,
          target: { kind: "application" },
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "mpa" },
      },
      { cwd },
    );

    try {
      const manifest = JSON.parse(
        await fs.promises.readFile(
          path.join(cwd, ".ev/manifest.json"),
          "utf-8",
        ),
      ) as BuildPlan;
      const first = manifest.generated?.modules.find(
        (module) => module.id === "first-wrapper",
      );
      const second = manifest.generated?.modules.find(
        (module) => module.id === "second-wrapper",
      );
      const expectedLayers = [
        { kind: "layout", module: "./src/pages/layout.tsx" },
        { kind: "wrapper", module: second?.file },
        { kind: "wrapper", module: first?.file },
      ];
      const entryMetadata = (name: string) =>
        manifest.entries.find((entry) => entry.name === name)?.metadata;
      const ssrClientEntryName = createPageClientBuildEntryName("ssr");
      const ssrServerEntryName = createPageServerBuildEntryName("ssr");

      expect(
        entryMetadata(createPageClientBuildEntryName("csr")),
      ).toMatchObject({
        type: "react-component-page",
        layers: expectedLayers,
      });
      expect(entryMetadata(ssrClientEntryName)).toMatchObject({
        type: "react-component-page",
        layers: expectedLayers,
      });
      expect(
        manifest.generated?.slots
          .filter((slot) => slot.slot === "page.wrapper")
          .map((slot) => slot.runtime),
      ).toEqual(["all", "all"]);
      for (const name of [
        ssrServerEntryName,
        createPageServerBuildEntryName("ssg"),
        createPageServerBuildEntryName("rsc"),
        createRscPageBuildEntryName("rsc"),
        createPprShellBuildEntryName("ppr"),
      ]) {
        expect(entryMetadata(name)).toEqual({
          type: "react-server-page",
          component: expect.any(String),
          layers: expectedLayers,
        });
      }
      expect(
        manifest.server.renderers?.find(
          (renderer) => renderer.name === createRscPageBuildEntryName("rsc"),
        )?.metadata,
      ).toMatchObject({
        type: "react-server-page",
        layers: expectedLayers,
      });

      const clientSource = await fs.promises.readFile(
        path.join(cwd, `.ev/entries/${ssrClientEntryName}.ts`),
        "utf-8",
      );
      const serverSource = await fs.promises.readFile(
        path.join(cwd, `.ev/entries/${ssrServerEntryName}.ts`),
        "utf-8",
      );
      for (const source of [clientSource, serverSource]) {
        expect(source).toContain(
          generatedImport(
            cwd,
            source === clientSource
              ? `.ev/entries/${ssrClientEntryName}.ts`
              : `.ev/entries/${ssrServerEntryName}.ts`,
            second?.file ?? "",
          ),
        );
        expect(source).toContain(
          generatedImport(
            cwd,
            source === clientSource
              ? `.ev/entries/${ssrClientEntryName}.ts`
              : `.ev/entries/${ssrServerEntryName}.ts`,
            first?.file ?? "",
          ),
        );
        expect(source.indexOf("createElement(Layer2")).toBeLessThan(
          source.indexOf("createElement(Layer1"),
        );
        expect(source).not.toContain("Reflect.get(layerModule");
      }

      const pprRegion = manifest.generated?.entries.find(
        (entry) => entry.kind === "ppr-region",
      );
      const pprRegionSource = await fs.promises.readFile(
        path.join(cwd, pprRegion?.file ?? ""),
        "utf-8",
      );
      expect(pprRegionSource).not.toContain(first?.file);
      expect(pprRegionSource).not.toContain(second?.file);
    } finally {
      await prepared.dispose();
    }
  });

  it("rejects Page wrappers without a matching requested runtime", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/ServerWrapper.tsx"),
      "export default function Wrapper({ children }) { return children; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-page-wrapper-runtime",
      contributions(ctx) {
        ctx.slot("page.wrapper").add({
          id: "server-wrapper",
          module: "./src/ServerWrapper.tsx",
          runtime: "server",
          target: { kind: "page", pageId: "index" },
        });
      },
    };

    await expect(
      prepareFrameworkBuild(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
          routing: { mode: "spa" },
        },
        { cwd },
      ),
    ).rejects.toThrow(
      'page.wrapper contribution "server-wrapper" targets Page "index", but no server Page runtime projection exists',
    );
  });

  it("models tmp module entry/runtime/html/resolution patterns as structured contributions", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "tmp-parity",
      contributions(ctx) {
        const config = ctx.emit.data({
          id: "ctoken-config",
          scope: { kind: "application" },
          value: { appId: "demo" },
        });
        const ctokenRuntime = ctx.emit.module({
          id: "ctoken-runtime",
          scope: { kind: "application" },
          source: ({ importOf }) =>
            [
              `import config from ${JSON.stringify(importOf(config))};`,
              "window.__evCtokenConfig = config;",
            ].join("\n"),
        });
        const themeRuntime = ctx.emit.module({
          id: "theme-runtime-plugin",
          scope: { kind: "application" },
          source: [
            "export const theme = 'light';",
            "export function applyTheme() {}",
          ].join("\n"),
        });
        ctx.slot("client.entry").add({
          id: "ctoken-entry",
          module: ctokenRuntime,
          position: "before-main",
        });
        ctx.slot("client.entry").add({
          id: "theme-plugin",
          module: themeRuntime,
          position: "after-main-imports",
        });
        ctx.slot("html.tag").add({
          id: "external-react-cdn",
          tag: "script",
          placement: "head-append",
          attrs: {
            src: "https://cdn.example.com/react.production.min.js",
            crossorigin: "anonymous",
          },
        });
        ctx.slot("resolve.alias").add({
          id: "config-alias",
          specifier: "@tmp/config",
          replacement: config,
        });
        ctx.slot("resolve.external").add({
          id: "react-external",
          specifier: "react",
          source: "React",
          runtime: "client",
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      { cwd },
    );

    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
    ) as BuildPlan;
    const configModule = manifest.generated?.modules.find(
      (module) => module.id === "ctoken-config",
    );
    const ctokenModule = manifest.generated?.modules.find(
      (module) => module.id === "ctoken-runtime",
    );
    const themeModule = manifest.generated?.modules.find(
      (module) => module.id === "theme-runtime-plugin",
    );
    const mainEntry = await fs.promises.readFile(
      path.join(cwd, ".ev/entries/main.ts"),
      "utf-8",
    );
    const ctokenSource = await fs.promises.readFile(
      path.join(cwd, ctokenModule?.file ?? ""),
      "utf-8",
    );
    const configData = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, configModule?.file ?? ""),
        "utf-8",
      ),
    );

    expect(configData).toEqual({ appId: "demo" });
    expect(manifest.generated?.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot: "client.entry",
          id: "ctoken-entry",
          module: ctokenModule?.file,
          position: "before-main",
        }),
        expect.objectContaining({
          slot: "client.entry",
          id: "theme-plugin",
          module: themeModule?.file,
          position: "after-main-imports",
        }),
        expect.objectContaining({
          slot: "html.tag",
          id: "external-react-cdn",
          tag: "script",
        }),
        expect.objectContaining({
          slot: "resolve.alias",
          id: "config-alias",
          replacement: configModule?.file,
        }),
        expect.objectContaining({
          slot: "resolve.external",
          id: "react-external",
          specifier: "react",
          source: "React",
          runtime: "client",
        }),
      ]),
    );
    expect(manifest.generated?.importEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "tmp-parity:ctoken-runtime",
          to: "tmp-parity:ctoken-config",
          kind: "module-import",
          specifier: generatedImport(
            cwd,
            ctokenModule?.file ?? "",
            configModule?.file ?? "",
          ),
        }),
        expect.objectContaining({
          from: "tmp-parity:ctoken-entry",
          to: "tmp-parity:ctoken-runtime",
          kind: "slot-module",
          specifier: ctokenModule?.file,
        }),
        expect.objectContaining({
          from: "tmp-parity:config-alias",
          to: "tmp-parity:ctoken-config",
          kind: "resolve-alias",
          specifier: configModule?.file,
        }),
      ]),
    );
    expect(manifest.resolve?.alias?.["@tmp/config"]).toBe(configModule?.file);
    expect(manifest.resolve?.external?.react).toEqual({
      source: "React",
      runtime: "client",
    });
    expect(ctokenSource).toContain(
      `import config from "${generatedImport(
        cwd,
        ctokenModule?.file ?? "",
        configModule?.file ?? "",
      )}";`,
    );
    expect(mainEntry).toContain(
      generatedImport(cwd, ".ev/entries/main.ts", themeModule?.file ?? ""),
    );
    expect(
      mainEntry.indexOf(
        generatedImport(cwd, ".ev/entries/main.ts", ctokenModule?.file ?? ""),
      ),
    ).toBeLessThan(
      mainEntry.indexOf(
        'import * as routeModule0 from "../../src/pages/page";',
      ),
    );

    await prepared.dispose();
  });

  it.each([
    [
      "undefined",
      (): unknown => undefined,
      /generated data "payload" value must be JSON-serializable/,
    ],
    [
      "a nested function",
      () => ({ invalid: () => true }),
      /value\.invalid must be JSON-serializable/,
    ],
    [
      "a nested symbol",
      () => ({ invalid: Symbol("invalid") }),
      /value\.invalid must be JSON-serializable/,
    ],
    [
      "NaN",
      () => ({ invalid: Number.NaN }),
      /value\.invalid must contain finite numbers/,
    ],
    [
      "Infinity",
      () => ({ invalid: Number.POSITIVE_INFINITY }),
      /value\.invalid must contain finite numbers/,
    ],
    [
      "bigint",
      () => ({ invalid: 1n }),
      /value\.invalid must be JSON-serializable/,
    ],
    [
      "a cycle",
      () => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      },
      /value\.self must not contain cycles/,
    ],
    [
      "an accessor",
      () => {
        const value = {};
        Object.defineProperty(value, "invalid", {
          enumerable: true,
          get() {
            throw new Error("getter must not execute");
          },
        });
        return value;
      },
      /value\.invalid must be an enumerable own data property/,
    ],
    [
      "an unsafe object key",
      () => {
        const value = {};
        Object.defineProperty(value, "__proto__", {
          enumerable: true,
          value: { polluted: true },
        });
        return value;
      },
      /value\.__proto__ is not a safe config field/,
    ],
    [
      "a class instance",
      () => ({ invalid: new Date(0) }),
      /value\.invalid must contain only arrays and plain objects/,
    ],
    [
      "a sparse array",
      () => ({ invalid: new Array(1) }),
      /value\.invalid\[0\] must not be a sparse array hole/,
    ],
  ] as const)("rejects emit.data values containing %s", async (_label, createValue, expected) => {
    const cwd = await createProject();
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-generated-data",
      contributions(ctx) {
        ctx.emit.data({
          id: "payload",
          scope: { kind: "application" },
          value: createValue(),
        });
      },
    };

    await expect(
      prepareFrameworkBuild(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
        },
        { cwd },
      ),
    ).rejects.toThrow(expected);
  });

  it("exposes canonical SPA Pages without Route or Document projections", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    let observedPages: Array<
      Pick<FrameworkPageView, "id" | "applicationId" | "source" | "render"> & {
        hasRelationshipProjection: boolean;
      }
    > = [];
    const plugin: Plugin<Record<string, never>> = {
      name: "observe-semantic-pages",
      contributions(ctx) {
        observedPages = ctx.framework.pages.map((page) => {
          return {
            id: page.id,
            applicationId: page.applicationId,
            source: page.source,
            render: page.render,
            hasRelationshipProjection: [
              "path",
              "routeId",
              "html",
              "mount",
            ].some((key) => Object.hasOwn(page, key)),
          };
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [plugin],
      },
      { cwd },
    );

    expect(observedPages).toEqual([
      {
        id: "index",
        applicationId: "default",
        source: {
          module: "./src/pages/page.tsx",
          scope: { kind: "directory", root: "./src/pages" },
          provider: PAGE_ANCHOR_PROVIDER_ID,
        },
        render: "csr",
        hasRelationshipProjection: false,
      },
    ]);
    await prepared.dispose();
  });

  it("discovers page.* anchors as directory-scoped semantic pages", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/users/components"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/index.tsx"),
      "export default function OrdinaryIndex() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/users/page.tsx"),
      "export default function Users() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/users/model.ts"),
      "export const model = {};",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/users/components/Table.tsx"),
      "export default function Table() { return null; }",
      "utf-8",
    );

    let observedPages: Array<Pick<FrameworkPageView, "id" | "source">> = [];
    let observedRoutes: Array<
      Pick<FrameworkRouteView, "id" | "pattern" | "target">
    > = [];
    let observedClientEntries: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      name: "observe-page-anchors",
      contributions(ctx) {
        observedPages = ctx.framework.pages.map((page) => ({
          id: page.id,
          source: page.source,
        }));
        observedRoutes = ctx.framework.routes.map((route) => ({
          id: route.id,
          pattern: route.pattern,
          target: route.target,
        }));
        observedClientEntries = ctx.framework.entries
          .filter((entry) => entry.environment === "client")
          .map((entry) => entry.kind);
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [plugin],
      },
      { cwd },
    );

    expect(observedPages).toEqual([
      {
        id: "index",
        source: {
          module: "./src/pages/page.tsx",
          scope: { kind: "directory", root: "./src/pages" },
          provider: PAGE_ANCHOR_PROVIDER_ID,
        },
      },
      {
        id: "users",
        source: {
          module: "./src/pages/users/page.tsx",
          scope: { kind: "directory", root: "./src/pages/users" },
          provider: PAGE_ANCHOR_PROVIDER_ID,
        },
      },
    ]);
    expect(observedRoutes).toEqual([
      {
        id: "index",
        pattern: { segments: [] },
        target: { kind: "page", pageId: "index" },
      },
      {
        id: "users",
        pattern: { segments: [{ kind: "static", value: "users" }] },
        target: { kind: "page", pageId: "users" },
      },
    ]);
    expect(observedClientEntries).toEqual(["application-client"]);
    const routeTypes = await fs.promises.readFile(
      path.join(cwd, "src/route-types.d.ts"),
      "utf-8",
    );
    expect(routeTypes).toContain(PAGE_ANCHOR_ROUTE_CONVENTION_SUMMARY);
    const coreGraphEnvelope = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, ".ev/framework/core-graph.json"),
        "utf-8",
      ),
    ) as { generatedBy: "evjs"; graph: CoreGraph };
    const generatedManifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
    ) as BuildPlan;
    expect(coreGraphEnvelope.generatedBy).toBe("evjs");
    expect(coreGraphEnvelope.graph.pages.users).toMatchObject({
      source: {
        module: "./src/pages/users/page.tsx",
        scope: { kind: "directory", root: "./src/pages/users" },
        provider: PAGE_ANCHOR_PROVIDER_ID,
      },
      provenance: {
        producer: { kind: "provider", id: PAGE_ANCHOR_PROVIDER_ID },
        source: "./src/pages/users/page.tsx",
      },
    });
    await expect(
      fs.promises.access(path.join(cwd, ".ev/framework/app-graph.json")),
    ).rejects.toThrow();
    expect(generatedManifest.generated?.frameworkFiles).toEqual([
      {
        id: "core-graph",
        file: "./.ev/framework/core-graph.json",
      },
      {
        id: "build-plan",
        file: "./.ev/framework/build-plan.json",
      },
    ]);
    await prepared.dispose();
  });

  it("rejects page entry contributions when an SPA page shares its application entry", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-spa-page-entry",
      contributions(ctx) {
        const pageModule = ctx.emit.module({
          id: "page-entry",
          scope: { kind: "page", pageId: "index" },
          source: "window.__pageEntry = true;",
        });
        ctx.slot("client.entry").add({
          id: "page-entry-slot",
          module: pageModule,
          position: "before-main",
          target: { kind: "page", pageId: "index" },
        });
      },
    };

    await expect(
      prepareFrameworkBuild(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
          plugins: [plugin],
        },
        { cwd },
      ),
    ).rejects.toThrow(
      'client.entry contribution "page-entry-slot" targets semantic page "index", but that page does not own a client entry. It is served by shared SPA application "default".',
    );
  });

  it("rejects page HTML contributions when an SPA page shares its application document", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-spa-page-document",
      contributions(ctx) {
        ctx.slot("html.tag").add({
          id: "page-meta",
          tag: "meta",
          placement: "head-append",
          attrs: { name: "page-only", content: "1" },
          target: { kind: "page", pageId: "index" },
        });
      },
    };

    await expect(
      prepareFrameworkBuild(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
          plugins: [plugin],
        },
        { cwd },
      ),
    ).rejects.toThrow(
      'html.tag contribution "page-meta" targets semantic page "index", but that page does not own a Document. It shares the Document owned by SPA application "default".',
    );
  });

  it("applies Application targets to their MPA Page entries", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "mpa-application-target",
      contributions(ctx) {
        const installer = ctx.emit.module({
          id: "installer",
          scope: { kind: "application" },
          source: "window.__installed = true;",
        });
        ctx.slot("client.entry").add({
          id: "application-installer",
          module: installer,
          position: "before-main",
          target: { kind: "application" },
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa" },
        plugins: [plugin],
      },
      { cwd },
    );
    try {
      const manifest = JSON.parse(
        await fs.promises.readFile(
          path.join(cwd, ".ev/manifest.json"),
          "utf-8",
        ),
      ) as BuildPlan;
      const installer = manifest.generated?.modules.find(
        (module) => module.id === "installer",
      );
      await expect(
        fs.promises.readFile(
          path.join(
            cwd,
            `.ev/entries/${createPageClientBuildEntryName("home")}.ts`,
          ),
          "utf-8",
        ),
      ).resolves.toContain(
        generatedImport(
          cwd,
          `.ev/entries/${createPageClientBuildEntryName("home")}.ts`,
          installer?.file ?? "",
        ),
      );
    } finally {
      await prepared.dispose();
    }
  });

  it("rejects non-client runtime filters on client entry contributions", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-client-entry-runtime",
      contributions(ctx) {
        const installer = ctx.emit.module({
          id: "installer",
          scope: { kind: "application" },
          source: "window.__installed = true;",
        });
        ctx.slot("client.entry").add({
          id: "all-runtime-installer",
          module: installer,
          position: "before-main",
          runtime: "all" as "client",
        });
      },
    };

    await expect(
      prepareFrameworkBuild(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
          plugins: [plugin],
        },
        { cwd },
      ),
    ).rejects.toThrow('.runtime must be one of: "client".');
  });

  it("does not treat Object prototype keys as known generated page scopes", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "unknown-constructor-page",
      contributions(ctx) {
        ctx.emit.module({
          id: "constructor-module",
          scope: { kind: "page", pageId: "constructor" },
          source: "export {};",
        });
      },
    };

    await expect(
      prepareFrameworkBuild(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
          plugins: [plugin],
        },
        { cwd },
      ),
    ).rejects.toThrow(
      'generated module "constructor-module" targets unknown page "constructor".',
    );
  });

  it("uses contributed source aliases during framework graph analysis", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(cwd, "src/features/orders"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      [
        'import { saveOrder } from "@features/orders/actions";',
        'import { saveProject } from "@project/src/project-actions";',
        "void saveOrder();",
        "void saveProject();",
        "export default function Page() { return null; }",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/features/orders/actions.ts"),
      '"use server"; export async function saveOrder() { return { ok: true }; }',
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/project-actions.ts"),
      '"use server"; export async function saveProject() { return { ok: true }; }',
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "source-alias",
      contributions(ctx) {
        ctx.slot("resolve.alias").add({
          id: "features",
          specifier: "@features",
          replacement: "./src/features",
        });
        ctx.slot("resolve.alias").add({
          id: "project",
          specifier: "@project",
          replacement: ".",
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [plugin],
      },
      { cwd },
    );
    const generatedGraph = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, ".ev/framework/core-graph.json"),
        "utf-8",
      ),
    ) as { graph: CoreGraph };

    expect(generatedGraph.graph.serverFunctions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: "src/features/orders/actions.ts",
          exportName: "saveOrder",
        }),
        expect.objectContaining({
          module: "src/project-actions.ts",
          exportName: "saveProject",
        }),
      ]),
    );
    await prepared.dispose();
  });

  it("lets entry wrapper plugins preserve the original generated entry facade", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "entry-wrapper",
      contributions(ctx) {
        const entry = ctx.framework.getApplicationEntry();
        if (!entry) throw new Error("missing Application entry");
        const original = ctx.emit.entryFacade({
          id: "original-entry",
          entry,
        });
        ctx.emit.entryFacade({
          id: "deferred-entry",
          entry,
          autoStart: false,
        });
        const wrapper = ctx.emit.module({
          id: "wrapper",
          scope: { kind: "application" },
          source: ({ importOf }) =>
            `export const load = () => import(${JSON.stringify(importOf(original))});`,
        });
        ctx.slot("client.entry").add({
          id: "wrapper-slot",
          module: wrapper,
          position: "before-main",
          mode: "replace",
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        routing: { mode: "spa" },
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
      },
      { cwd },
    );

    const originalEntry = await fs.promises.readFile(
      path.join(cwd, ".ev/plugins/entry-wrapper/original-entry.ts"),
      "utf-8",
    );
    const wrapper = await fs.promises.readFile(
      path.join(cwd, ".ev/plugins/entry-wrapper/wrapper.ts"),
      "utf-8",
    );
    const deferredEntry = await fs.promises.readFile(
      path.join(cwd, ".ev/plugins/entry-wrapper/deferred-entry.ts"),
      "utf-8",
    );
    const mainEntry = await fs.promises.readFile(
      path.join(cwd, ".ev/entries/main.ts"),
      "utf-8",
    );

    expect(originalEntry).toContain("createPagesApp");
    expect(originalEntry).toContain("export const pagesApp = createPagesApp");
    expect(originalEntry).toContain("startPagesApp");
    expect(originalEntry).toContain("../../src/pages/page");
    expect(deferredEntry).toContain("createPagesApp");
    expect(deferredEntry).toContain("export const pagesApp = createPagesApp");
    expect(deferredEntry).toContain("export const start =");
    expect(deferredEntry).not.toContain('startPagesApp(app, "#app");');
    expect(wrapper).toContain('import("./original-entry")');
    expect(mainEntry).toContain(
      'export * from "../plugins/entry-wrapper/wrapper";',
    );
    expect(mainEntry).not.toContain("createPagesApp");

    await prepared.dispose();
  });

  it("adds server.request.middleware contributions to the generated server entry", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/apis/hello/api.ts"),
      "export function GET() { return new Response('ok'); }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "server-contribution",
      contributions(ctx) {
        const middleware = ctx.emit.module({
          id: "request-middleware",
          scope: { kind: "server" },
          source: [
            "export default async function contributedMiddleware(ctx, next) {",
            "  await next();",
            "}",
          ].join("\n"),
        });
        ctx.slot("server.request.middleware").add({
          id: "request-middleware-slot",
          module: middleware,
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
      },
      { cwd },
    );

    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
    ) as BuildPlan;
    const middlewareModule = manifest.generated?.modules.find(
      (module) => module.id === "request-middleware",
    );
    const serverEntry = await fs.promises.readFile(
      path.join(cwd, ".ev/entries/server.ts"),
      "utf-8",
    );

    expect(manifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "server",
          import: "./.ev/entries/server.ts",
          kind: "server-runtime",
        }),
      ]),
    );
    expect(manifest.generated?.slots).toContainEqual(
      expect.objectContaining({
        slot: "server.request.middleware",
        id: "request-middleware-slot",
        module: middlewareModule?.file,
      }),
    );
    expect(serverEntry).toContain(
      `import contributedMiddleware0 from "${generatedImport(
        cwd,
        ".ev/entries/server.ts",
        middlewareModule?.file ?? "",
      )}";`,
    );
    expect(serverEntry).toContain(
      'import * as routeModule0 from "../../src/apis/hello/api";',
    );
    expect(serverEntry).not.toContain('from "src/apis/hello/api.ts"');
    expect(serverEntry).toContain(
      "const middlewares = [contributedMiddleware0];",
    );
    expect(serverEntry).toContain(
      ["const routeDefinition0 = {", "  GET: routeModule0.GET,", "};"].join(
        "\n",
      ),
    );
    expect(serverEntry).not.toContain("routeDefinition0.GET =");
    expect(serverEntry).toContain('createRoute("/hello", routeDefinition0)');

    await prepared.dispose();
  });

  it("rejects duplicate contribution ids per plugin", async () => {
    const cwd = await createProject();
    const plugin: Plugin<Record<string, never>> = {
      name: "duplicate-contributions",
      contributions(ctx) {
        ctx.emit.module({
          id: "same",
          scope: { kind: "application" },
          source: "export {};",
        });
        ctx.slot("html.tag").add({
          id: "same",
          tag: "meta",
          placement: "head-append",
          attrs: { name: "same" },
        });
      },
    };

    await expect(
      prepareFrameworkBuild(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
        },
        { cwd },
      ),
    ).rejects.toThrow(
      'Duplicate contribution id "same" in plugin "duplicate-contributions"',
    );
  });

  it("rejects invalid contribution slot payloads", async () => {
    const cwd = await createProject();
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-contribution",
      contributions(ctx) {
        const module = ctx.emit.module({
          id: "module",
          scope: { kind: "application" },
          source: "export {};",
        });
        ctx.slot("client.entry").add({
          id: "entry",
          module,
          position: "during-main" as never,
        });
      },
    };

    await expect(
      prepareFrameworkBuild(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
        },
        { cwd },
      ),
    ).rejects.toThrow(
      'invalid-contribution:entry.position must be one of: "polyfill", "before-main-imports", "after-main-imports", "before-main", "after-main"',
    );
  });
});

describe("build", () => {
  it("serializes concurrent project builds before a second bundler starts", async () => {
    const cwd = await createSpaProject();
    let continueFirstBuild: (() => void) | undefined;
    let markFirstBuildStarted: (() => void) | undefined;
    const firstBuildStarted = new Promise<void>((resolve) => {
      markFirstBuildStarted = resolve;
    });
    const firstBuildCanFinish = new Promise<void>((resolve) => {
      continueFirstBuild = resolve;
    });
    let bundlerStarts = 0;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "serialized-build",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        bundlerStarts += 1;
        markFirstBuildStarted?.();
        await firstBuildCanFinish;
        return {
          clientEntryAssets: {
            main: { js: ["main.js"], css: [] },
          },
          ...serverBuildFacts(plan),
        };
      },
      async dev() {},
    };
    const config = { routing: { mode: "spa" as const } };
    const firstBuild = build(config, { cwd, bundler });
    await firstBuildStarted;

    try {
      await expect(build(config, { cwd, bundler })).rejects.toThrow(
        `Cannot start build for "${await fs.promises.realpath(cwd)}" because build is already running in process ${process.pid}`,
      );
      expect(bundlerStarts).toBe(1);
    } finally {
      continueFirstBuild?.();
    }
    await firstBuild;
  });

  it("requires a bundler from config or options", async () => {
    const cwd = await createProject();
    await expect(
      build(
        { output: { client: "dist/client", server: "dist/server" } },
        { cwd },
      ),
    ).rejects.toThrow("No bundler configured");
  });

  it("disposes prepared plugin hooks when build stops before bundler execution", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "dist"), { recursive: true });
    await writeFile(
      path.join(cwd, "dist/.evjs-dev.lock"),
      JSON.stringify({
        command: "dev",
        distDir: "dist",
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
      "utf-8",
    );
    const events: string[] = [];

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [
            {
              name: "cleanup",
              setup() {
                events.push("setup");
                return {
                  dispose() {
                    events.push("dispose");
                  },
                };
              },
            },
          ],
        },
        { cwd, bundler: createMockBundler(events) },
      ),
    ).rejects.toThrow('Cannot write to "dist"');

    expect(events).toEqual(["setup", "dispose"]);
  });

  it("runs framework orchestration around the injected bundler", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      name: "records-lifecycle",
      setup(ctx) {
        expect(ctx.config.bundler?.name).toBe("mock");
        events.push(`setup:${ctx.mode}`);
        return {
          buildStart() {
            events.push("buildStart");
          },
          buildOutput(output) {
            events.push(`buildOutput:${Object.keys(output.assets).join(",")}`);
            output.assets.main.css = ["main.patched.css"];
            output.apps.default.assets.js = ["main.patched.js"];
            output.server.assets.js = ["server.patched.js"];
            output.deployment = { platform: "test" };
          },
          buildEnd(result) {
            events.push(
              [
                "buildEnd",
                result.output.assets.main?.css[0],
                result.output.apps.default.assets.js[0],
                result.output.server.assets.js[0],
                String(result.output.deployment?.platform),
              ].join(":"),
            );
          },
          dispose(ctx) {
            events.push(`dispose:${ctx.mode}`);
          },
        };
      },
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "setup:production",
      "buildStart",
      "bundler.build",
      "bundler.entries:main",
      "buildOutput:main",
      "buildEnd:main.patched.css:main.patched.js:server.patched.js:test",
      "dispose:production",
    ]);
    await expect(
      fs.promises.readFile(
        path.join(cwd, "dist/deployment-metadata.json"),
        "utf-8",
      ),
    ).resolves.toContain('"platform": "test"');
  });

  it("rejects framework HTML that overlaps the bundler output inventory", async () => {
    const cwd = await createSpaProject();
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "html-output-conflict",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        return {
          emittedFiles: { client: ["index.html"] },
          clientEntryAssets: {
            main: { js: ["main.js"], css: [] },
          },
          ...serverBuildFacts(plan),
        };
      },
      async dev() {},
    };

    await expect(
      build({ routing: { mode: "spa" } }, { cwd, bundler }),
    ).rejects.toThrow(
      'HTML Document "index" output "index.html" conflicts with bundler-emitted client asset "index.html"',
    );
    await expect(
      fs.promises.access(path.join(cwd, "dist/deployment-metadata.json")),
    ).rejects.toThrow();
  });

  it("does not follow a deployment metadata output symlink", async () => {
    const cwd = await createSpaProject();
    const sentinel = path.join(cwd, "metadata-sentinel.json");
    const metadataFile = path.join(cwd, "dist/deployment-metadata.json");
    await writeFile(sentinel, "outside", "utf-8");
    await fs.promises.mkdir(path.dirname(metadataFile), { recursive: true });
    await fs.promises.symlink(sentinel, metadataFile);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        { cwd, bundler: createMockBundler([]) },
      ),
    ).rejects.toThrow(
      "deployment metadata output must not overwrite a symbolic-link output file",
    );
    await expect(fs.promises.readFile(sentinel, "utf-8")).resolves.toBe(
      "outside",
    );
  });

  it("does not follow an HTML Document output symlink", async () => {
    const cwd = await createSpaProject();
    const sentinel = path.join(cwd, "html-sentinel.html");
    const htmlFile = path.join(cwd, "dist/client/index.html");
    await writeFile(sentinel, "outside", "utf-8");
    await fs.promises.mkdir(path.dirname(htmlFile), { recursive: true });
    await fs.promises.symlink(sentinel, htmlFile);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        { cwd, bundler: createMockBundler([]) },
      ),
    ).rejects.toThrow(
      'HTML Document "index" output "index.html" must not overwrite a symbolic-link output file',
    );
    await expect(fs.promises.readFile(sentinel, "utf-8")).resolves.toBe(
      "outside",
    );
  });

  it("revalidates framework output paths after the bundler finishes", async () => {
    const cwd = await createSpaProject();
    const outsideDir = path.join(cwd, "outside-output");
    const sentinel = path.join(outsideDir, "sentinel.txt");
    await writeFile(sentinel, "outside", "utf-8");
    const baseBundler = createMockBundler([]);
    const buildMock = baseBundler.build;
    if (!buildMock) throw new Error("Expected mock build implementation.");
    const bundler: BundlerAdapter<Record<string, never>> = {
      ...baseBundler,
      async build(context) {
        const facts = await buildMock(context);
        await fs.promises.symlink(outsideDir, path.join(cwd, "dist"), "dir");
        return facts;
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow(
      'plan.distDir output directory "dist" must not traverse symbolic link "dist"',
    );
    await expect(fs.promises.readFile(sentinel, "utf-8")).resolves.toBe(
      "outside",
    );
  });

  it("validates buildOutput hook mutations before emitting artifacts", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-output",
      setup() {
        return {
          buildOutput(output) {
            events.push("buildOutput");
            (output as { version: number }).version = 2;
          },
          dispose() {
            events.push("dispose");
          },
        };
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler: createMockBundler(events),
        },
      ),
    ).rejects.toThrow(BUILD_OUTPUT_HOOK_OWNERSHIP_ERROR);

    expect(fs.existsSync(path.join(cwd, "dist/manifest.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "dist/runtime.json"))).toBe(false);
    expect(events).toEqual([
      "bundler.build",
      "bundler.entries:main",
      "buildOutput",
      "dispose",
    ]);
  });

  it("keeps CoreGraph Document identity immutable through buildOutput hooks", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-document-output",
      setup() {
        return {
          buildOutput(output) {
            events.push("buildOutput");
            const document = output.apps.default?.document;
            if (!document) throw new Error("Expected the SPA Document.");
            document.aliases = ["legacy.html"];
          },
          dispose() {
            events.push("dispose");
          },
        };
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler: createMockBundler(events),
        },
      ),
    ).rejects.toThrow(
      '[evjs] buildOutput hooks cannot change Application "default" Document fileName or aliases.',
    );

    expect(fs.existsSync(path.join(cwd, "dist/legacy.html"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "dist/deployment-metadata.json"))).toBe(
      false,
    );
    expect(events).toEqual([
      "bundler.build",
      "bundler.entries:main",
      "buildOutput",
      "dispose",
    ]);
  });

  it("keeps CoreGraph Route identity immutable through buildOutput hooks", async () => {
    const cwd = await createSpaProject();
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-route-output",
      setup() {
        return {
          buildOutput(output) {
            const route = output.routes[0];
            if (!route) throw new Error("Expected the root Route.");
            route.id = "renamed";
          },
        };
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
          routing: { mode: "spa" },
        },
        { cwd, bundler: createMockBundler([]) },
      ),
    ).rejects.toThrow(
      "[evjs] buildOutput hooks cannot add, remove, reorder, or rename Routes, or change Route paths and ownership.",
    );
  });

  it("keeps CoreGraph Application identity immutable through buildOutput hooks", async () => {
    const cwd = await createSpaProject();
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-application-output",
      setup() {
        return {
          buildOutput(output) {
            output.apps.extra = {
              assets: { js: [], css: [] },
            };
          },
        };
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
          routing: { mode: "spa" },
        },
        { cwd, bundler: createMockBundler([]) },
      ),
    ).rejects.toThrow(
      "[evjs] buildOutput hooks cannot add, remove, or rename Applications.",
    );
  });

  it("keeps CoreGraph Page identity immutable through buildOutput hooks", async () => {
    const cwd = await createSpaProject();
    await writeFile(
      path.join(cwd, "src/pages/page.config.ts"),
      'export default { title: "Home" };',
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-page-output",
      setup() {
        return {
          buildOutput(output) {
            const page = output.pages.index;
            if (!page) throw new Error("Expected the root Page.");
            output.pages.extra = {
              ...page,
              path: "/extra",
              routeId: "extra",
            };
            output.routes.push({
              id: "extra",
              path: "/extra",
              appId: "default",
              pageId: "extra",
            });
          },
        };
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
          routing: { mode: "spa" },
        },
        { cwd, bundler: createMockBundler([]) },
      ),
    ).rejects.toThrow(
      "[evjs] buildOutput hooks cannot add, remove, or rename Pages.",
    );
  });

  it("keeps CoreGraph Page and Route paths immutable through buildOutput hooks", async () => {
    const cwd = await createSpaProject();
    await writeFile(
      path.join(cwd, "src/pages/page.config.ts"),
      'export default { title: "Home" };',
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-page-path-output",
      setup() {
        return {
          buildOutput(output) {
            const page = output.pages.index;
            const route = output.routes[0];
            if (!page || !route) {
              throw new Error("Expected the root Page and Route.");
            }
            page.path = "/renamed";
            route.path = "/renamed";
          },
        };
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
          routing: { mode: "spa" },
        },
        { cwd, bundler: createMockBundler([]) },
      ),
    ).rejects.toThrow(
      "[evjs] buildOutput hooks cannot add, remove, reorder, or rename Routes, or change Route paths and ownership.",
    );
  });

  it("rejects buildOutput path mutation before writing outside the project", async () => {
    const cwd = await createSpaProject();
    const outsideDir = path.join(
      path.dirname(cwd),
      `${path.basename(cwd)}-outside-output`,
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-output-path",
      setup() {
        return {
          buildOutput(output) {
            output.paths.rootDir = path.relative(cwd, outsideDir);
          },
        };
      },
    };

    try {
      await expect(
        build(
          {
            output: { client: "dist/client", server: "dist/server" },
            plugins: [plugin],
            routing: { mode: "spa" },
          },
          { cwd, bundler: createMockBundler([]) },
        ),
      ).rejects.toThrow(BUILD_OUTPUT_HOOK_OWNERSHIP_ERROR);

      expect(fs.existsSync(outsideDir)).toBe(false);
      expect(
        fs.existsSync(path.join(cwd, "dist/deployment-metadata.json")),
      ).toBe(false);
    } finally {
      await fs.promises.rm(outsideDir, { force: true, recursive: true });
    }
  });

  it("validates ownership after each buildOutput hook", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const plugins: Plugin<Record<string, never>>[] = [
      {
        name: "temporarily-mutates-runtime",
        setup() {
          return {
            buildOutput(output) {
              events.push("mutate");
              output.runtime.server.fn = "temporary/fn";
            },
          };
        },
      },
      {
        name: "observes-temporary-runtime",
        setup() {
          return {
            buildOutput(output) {
              events.push("observe");
              output.deployment = { observedFn: output.runtime.server.fn };
            },
          };
        },
      },
      {
        name: "restores-runtime",
        setup() {
          return {
            buildOutput(output) {
              events.push("restore");
              output.runtime.server.fn = "__evjs/fn";
            },
          };
        },
      },
    ];

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins,
          routing: { mode: "spa" },
        },
        { cwd, bundler: createMockBundler([]) },
      ),
    ).rejects.toThrow(BUILD_OUTPUT_HOOK_OWNERSHIP_ERROR);
    expect(events).toEqual(["mutate"]);
  });

  it("isolates transformHtml manifest snapshots before framework writes", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/dashboard/page.tsx"),
      "export default function Dashboard() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/dashboard/page.config.ts"),
      'export default { render: "ssr" };',
      "utf-8",
    );
    const outsideDir = path.join(
      path.dirname(cwd),
      `${path.basename(cwd)}-transform-output`,
    );
    const observedRootDirs: string[] = [];
    const plugins: Plugin[] = [
      {
        name: "mutates-transform-snapshot",
        setup() {
          return {
            transformHtml(_doc, ctx) {
              ctx.output.paths.rootDir = path.relative(cwd, outsideDir);
              ctx.output.paths.publicDir = path.relative(
                cwd,
                path.join(outsideDir, "client"),
              );
              ctx.output.paths.serverDir = path.relative(
                cwd,
                path.join(outsideDir, "server"),
              );
            },
          };
        },
      },
      {
        name: "observes-transform-snapshot",
        setup() {
          return {
            transformHtml(_doc, ctx) {
              observedRootDirs.push(ctx.output.paths.rootDir);
            },
          };
        },
      },
    ];

    try {
      await build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
          plugins,
        },
        { cwd, bundler: createMockBundler([]) },
      );

      expect(observedRootDirs.length).toBeGreaterThan(0);
      expect(new Set(observedRootDirs)).toEqual(new Set(["dist"]));
      await expect(
        fs.promises.readFile(
          path.join(cwd, "dist/deployment-metadata.json"),
          "utf-8",
        ),
      ).resolves.toContain('"rootDir": "dist"');
      expect(fs.existsSync(outsideDir)).toBe(false);
    } finally {
      await fs.promises.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it.each([
    {
      label: "build id",
      mutate(output: BuildOutput) {
        output.buildId = "changed-build";
      },
    },
    {
      label: "runtime endpoint",
      mutate(output: BuildOutput) {
        output.runtime.server.fn = "changed-fn";
      },
    },
    {
      label: "public path",
      mutate(output: BuildOutput) {
        output.publicPath = "/patched/";
      },
    },
    {
      label: "AssetGroup record key",
      mutate(output: BuildOutput) {
        output.assets.extra = { js: [], css: [] };
      },
    },
    {
      label: "Application mount",
      mutate(output: BuildOutput) {
        const application = output.apps.default;
        if (!application) throw new Error("Expected one Application.");
        application.mount = "#patched";
      },
    },
    {
      label: "Page metadata",
      mutate(output: BuildOutput) {
        const page = output.pages.index;
        if (!page?.metadata) throw new Error("Expected one Page metadata.");
        Reflect.set(page.metadata, "title", "Patched");
      },
    },
    {
      label: "Page metadata order",
      mutate(output: BuildOutput) {
        const meta = output.pages.index?.metadata?.meta;
        if (!meta?.description) throw new Error("Expected Page meta entries.");
        const description = meta.description;
        Reflect.deleteProperty(meta, "description");
        Reflect.set(meta, "description", description);
      },
    },
    {
      label: "server entry",
      mutate(output: BuildOutput) {
        output.server.entry = "changed-server.js";
      },
    },
    {
      label: "server Function id",
      mutate(output: BuildOutput) {
        const entry = Object.entries(output.server.functions)[0];
        if (!entry) throw new Error("Expected one server Function.");
        delete output.server.functions[entry[0]];
        output.server.functions["renamed-function"] = entry[1];
      },
    },
    {
      label: "server Function export name",
      mutate(output: BuildOutput) {
        const serverFunction = Object.values(output.server.functions)[0];
        if (!serverFunction) throw new Error("Expected one server Function.");
        serverFunction.exportName = "renamedExport";
      },
    },
    {
      label: "server Route path",
      mutate(output: BuildOutput) {
        const route = output.server.routes[0];
        if (!route) throw new Error("Expected one server Route.");
        route.path = "/renamed";
      },
    },
    {
      label: "server Route method order",
      mutate(output: BuildOutput) {
        const route = output.server.routes[0];
        if (!route) throw new Error("Expected one server Route.");
        route.methods.reverse();
      },
    },
  ] satisfies Array<{
    label: string;
    mutate: (output: BuildOutput) => void;
  }>)("rejects buildOutput $label mutation", async ({ mutate }) => {
    const cwd = await createServerOutputProject();
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-output-semantics",
      setup() {
        return {
          buildOutput(output) {
            mutate(output);
          },
        };
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
          routing: { mode: "spa" },
        },
        { cwd, bundler: createMockBundler([]) },
      ),
    ).rejects.toThrow(BUILD_OUTPUT_HOOK_OWNERSHIP_ERROR);
    expect(fs.existsSync(path.join(cwd, "dist/deployment-metadata.json"))).toBe(
      false,
    );
  });

  it("validates deployment metadata after each buildOutput hook", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const invalidMetadata: Plugin<Record<string, never>> = {
      name: "invalid-deployment-metadata",
      setup() {
        return {
          buildOutput(output) {
            events.push("invalid");
            output.deployment = { serialize() {} } as never;
          },
        };
      },
    };
    const laterPlugin: Plugin<Record<string, never>> = {
      name: "later-output-hook",
      setup() {
        return {
          buildOutput() {
            events.push("later");
          },
        };
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [invalidMetadata, laterPlugin],
          routing: { mode: "spa" },
        },
        { cwd, bundler: createMockBundler([]) },
      ),
    ).rejects.toThrow(
      "BuildOutput after buildOutput hooks.deployment.serialize must be JSON-serializable",
    );
    expect(events).toEqual(["invalid"]);
    expect(fs.existsSync(path.join(cwd, "dist/deployment-metadata.json"))).toBe(
      false,
    );
  });

  it("allows buildOutput hooks to adjust every nested AssetGroup and deployment", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/ssr/page.tsx"),
      [
        'import { saveValue } from "../../actions.server";',
        "void saveValue;",
        "export default function Ssr() { return null; }",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/ssr/page.config.ts"),
      'export default { render: "ssr", hydrate: "none" };',
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/ppr/page.tsx"),
      [
        'import * as React from "react";',
        'const Offer = React.lazy(() => import("./Offer.region"));',
        "export default function Ppr() {",
        "  return <React.Suspense fallback={null}><Offer /></React.Suspense>;",
        "}",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/ppr/Offer.region.tsx"),
      "export default function Offer() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/ppr/page.config.ts"),
      'export default { render: "ssr", hydrate: "none", prerender: { partial: true } };',
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/rsc/page.tsx"),
      "export default function Rsc() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/rsc/page.config.ts"),
      'export default { render: "ssr", hydrate: "none", rsc: true };',
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/actions.server.ts"),
      [
        '"use server";',
        "export async function saveValue() { return { ok: true }; }",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/apis/health/api.ts"),
      "export const GET = () => Response.json({ ok: true });",
      "utf-8",
    );

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "nested-asset-output",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        const clientEntryAssets = Object.fromEntries(
          plan.entries
            .filter((entry) => entry.environment === "client")
            .map((entry) => [
              entry.name,
              { js: [`${entry.name}.js`], css: [] },
            ]),
        );
        const serverEntryAssets = Object.fromEntries(
          plan.entries
            .filter((entry) => entry.environment === "server")
            .map((entry) => [
              entry.name,
              { js: [`${entry.name}.js`], css: [] },
            ]),
        );
        const serverRuntime = plan.entries.find(
          (entry) => entry.kind === "server-runtime",
        );
        return {
          clientEntryAssets,
          serverEntryAssets,
          serverEntry: serverRuntime ? `${serverRuntime.name}.js` : undefined,
          serverAssets: serverRuntime
            ? { js: [`${serverRuntime.name}.js`], css: [] }
            : undefined,
        };
      },
      async dev() {},
    };
    const touched: string[] = [];
    let linkedOutput: BuildOutput | undefined;
    const patchAssets = (
      label: string,
      assets: BuildOutput["server"]["assets"],
    ) => {
      const index = touched.length;
      assets.js = [`hook-${index}.js`];
      assets.css = [`hook-${index}.css`];
      touched.push(label);
    };
    const plugin: Plugin<Record<string, never>> = {
      name: "nested-asset-output",
      setup() {
        return {
          buildOutput(output) {
            for (const [pageId, page] of Object.entries(output.pages)) {
              patchAssets(`page:${pageId}`, page.assets);
            }
            const ppr = output.pages.ppr?.ppr;
            if (!ppr) throw new Error("Expected PPR output.");
            patchAssets("ppr:shell", ppr.shell);
            const regions = Object.entries(ppr.regions);
            if (regions.length === 0) throw new Error("Expected a PPR region.");
            for (const [regionId, region] of regions) {
              patchAssets(`ppr:region:${regionId}`, region.assets);
            }
            const renderers = Object.entries(output.server.renderers ?? {});
            if (renderers.length === 0) {
              throw new Error("Expected server renderers.");
            }
            for (const [rendererId, renderer] of renderers) {
              patchAssets(`renderer:${rendererId}`, renderer.assets);
            }
            const serverFunctions = Object.entries(output.server.functions);
            if (serverFunctions.length === 0) {
              throw new Error("Expected a server Function.");
            }
            for (const [functionId, serverFunction] of serverFunctions) {
              patchAssets(`function:${functionId}`, serverFunction.assets);
            }
            if (output.server.routes.length === 0) {
              throw new Error("Expected a server Route.");
            }
            for (const [index, route] of output.server.routes.entries()) {
              patchAssets(`route:${index}`, route.assets);
            }
            const rscPages = Object.entries(output.rsc?.pages ?? {});
            if (rscPages.length === 0) throw new Error("Expected an RSC Page.");
            for (const [pageId, page] of rscPages) {
              patchAssets(`rsc:${pageId}`, page.assets);
            }
            output.deployment = { nestedAssetsPatched: true };
          },
          buildEnd(result) {
            linkedOutput = result.output;
          },
        };
      },
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "mpa" },
      },
      { cwd, bundler },
    );

    expect(touched).toEqual(
      expect.arrayContaining([
        "page:ssr",
        "page:ppr",
        "page:rsc",
        "ppr:shell",
        expect.stringMatching(/^ppr:region:/),
        expect.stringMatching(/^renderer:/),
        expect.stringMatching(/^function:/),
        "route:0",
        "rsc:rsc",
      ]),
    );
    expect(linkedOutput?.deployment).toEqual({ nestedAssetsPatched: true });
    const deploymentMetadata = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/deployment-metadata.json"),
        "utf-8",
      ),
    ) as { metadata?: Record<string, unknown> };
    expect(deploymentMetadata.metadata).toEqual({ nestedAssetsPatched: true });
  });

  it("passes canonical result fields to plugin lifecycle hooks", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);
    const firstClientJs = (result: BuildResult) => {
      return Object.values(result.output.assets)[0]?.js[0] ?? "none";
    };
    const plugin: Plugin<Record<string, never>> = {
      name: "manifest-result",
      setup() {
        return {
          buildStart() {
            events.push("manifest:buildStart");
          },
          transformHtml(doc: HtmlDocument, result: BuildResult) {
            events.push(`manifest:html:${firstClientJs(result)}`);
            doc.head?.appendChild(doc.createComment(" manifest html "));
          },
          buildEnd(result: BuildResult) {
            events.push(
              `manifest:buildEnd:${firstClientJs(result)}:${result.deploymentMetadata.server.entry ?? "none"}`,
            );
          },
        };
      },
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      {
        cwd,
        bundler,
      },
    );

    const html = await fs.promises.readFile(
      path.join(cwd, "dist/client/index.html"),
      "utf-8",
    );
    const clientRuntime = readEmbeddedClientRuntime(html);

    expect(html).toContain("manifest html");
    expect(clientRuntime.routing.kind).toBe("spa");
    expect(clientRuntime).not.toHaveProperty("assets");
    expect(fs.existsSync(path.join(cwd, "dist/runtime.json"))).toBe(false);
    expect(events).toEqual([
      "manifest:buildStart",
      "bundler.build",
      "bundler.entries:main",
      "manifest:html:main.js",
      "manifest:buildEnd:main.js:none",
    ]);
  });

  it("adds crossorigin to injected output HTML assets", async () => {
    const cwd = await createSpaProject();
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock-crossorigin-assets",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        return {
          clientEntryAssets: {
            main: { js: ["main.js"], css: ["main.css"] },
          },
          ...serverBuildFacts(plan),
        };
      },
      async dev() {},
    };

    await build(
      {
        output: {
          client: "dist/client",
          server: "dist/server",
          crossOriginLoading: "anonymous",
        },
        routing: { mode: "spa" },
      },
      {
        cwd,
        bundler,
      },
    );

    const html = await fs.promises.readFile(
      path.join(cwd, "dist/client/index.html"),
      "utf-8",
    );
    expect(html).toMatch(
      /<link[^>]*href="\/main\.css"[^>]*crossorigin="anonymous"/,
    );
    expect(html).toMatch(
      /<script[^>]*src="\/main\.js"[^>]*crossorigin="anonymous"/,
    );
  });

  it("applies html.tag contributions before transformHtml hooks", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    let transformSawContribution = false;
    const plugin: Plugin<Record<string, never>> = {
      name: "html-contribution",
      contributions(ctx) {
        ctx.slot("html.tag").add({
          id: "meta",
          tag: "meta",
          placement: "head-prepend",
          attrs: { name: "from-contribution", content: "1" },
        });
        ctx.slot("html.tag").add({
          id: "script",
          tag: "script",
          placement: "body-append",
          attrs: { src: "https://cdn.example.com/runtime.js" },
        });
      },
      setup() {
        return {
          transformHtml(doc) {
            transformSawContribution = Boolean(
              doc.head?.querySelector('meta[name="from-contribution"]'),
            );
          },
        };
      },
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      {
        cwd,
        bundler: createMockBundler(events),
      },
    );

    const html = await fs.promises.readFile(
      path.join(cwd, "dist/client/index.html"),
      "utf-8",
    );
    expect(transformSawContribution).toBe(true);
    expect(html).toMatch(/<meta[^>]*name="from-contribution"[^>]*content="1"/);
    expect(html).toMatch(
      /<script[^>]*src="https:\/\/cdn\.example\.com\/runtime\.js"/,
    );
  });

  it("applies Page metadata before html.tag and transformHtml hooks", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "index.html"),
      [
        "<!doctype html>",
        "<html>",
        "<head>",
        "<title>Template title</title>",
        '<meta name="description" content="Template description">',
        '<meta name="Description" content="Duplicate description">',
        "</head>",
        '<body><div id="app"></div></body>',
        "</html>",
      ].join(""),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.config.ts"),
      [
        "export default {",
        '  title: "Configured title",',
        "  meta: {",
        '    description: "Configured description",',
        "  },",
        "};",
      ].join("\n"),
      "utf-8",
    );

    let transformSawMetadata = false;
    let runtimeMetadata: unknown;
    let frameworkPageMetadata: unknown;
    const plugin: Plugin<Record<string, never>> = {
      name: "page-metadata-order",
      contributions(ctx) {
        frameworkPageMetadata = ctx.framework.pages.find(
          (page) => page.id === "index",
        )?.metadata;
        ctx.slot("html.tag").add({
          id: "page-metadata-order",
          tag: "meta",
          placement: "head-append",
          attrs: { name: "from-contribution", content: "1" },
        });
      },
      setup() {
        return {
          transformHtml(doc, ctx) {
            if (ctx.owner.kind !== "page") return;
            const title = doc.querySelector("title");
            const description = doc.querySelector('meta[name="description"]');
            transformSawMetadata =
              title?.textContent === "Configured title" &&
              description?.getAttribute("content") ===
                "Configured description" &&
              Boolean(doc.querySelector('meta[name="from-contribution"]'));
            if (title) title.textContent = "Plugin title";
            description?.setAttribute("content", "Plugin description");
          },
          buildEnd(result) {
            const routing = result.frameworkRuntime?.routing;
            runtimeMetadata =
              routing?.kind === "mpa"
                ? routing.pages.index?.metadata
                : undefined;
          },
        };
      },
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa" },
        plugins: [plugin],
      },
      {
        cwd,
        bundler: createMockBundler([]),
      },
    );

    const html = await fs.promises.readFile(
      path.join(cwd, "dist/client/index.html"),
      "utf-8",
    );
    expect(transformSawMetadata).toBe(true);
    expect(runtimeMetadata).toEqual({
      title: "Configured title",
      meta: { description: "Configured description" },
    });
    expect(frameworkPageMetadata).toEqual({
      title: "Configured title",
      meta: { description: "Configured description" },
    });
    expect(html).toContain("<title>Plugin title</title>");
    expect(html).toMatch(
      /<meta[^>]*name="description"[^>]*content="Plugin description"/,
    );
    expect(
      html.match(/<meta[^>]*name="description"[^>]*>/gi) ?? [],
    ).toHaveLength(1);
    expect(html).toMatch(/<meta[^>]*name="from-contribution"[^>]*content="1"/);
  });

  it.each([
    "spa",
    "mpa",
  ] as const)("compiles the configured %s SSR template into the Page runtime shell", async (mode) => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "index.html"),
      [
        "<!doctype html>",
        '<html lang="zh-CN" data-template="configured">',
        "<head>",
        '<meta name="viewport" content="width=device-width">',
        "<title>Template title</title>",
        "</head>",
        '<body class="template-body">',
        "<header>Template header</header>",
        '<main id="app"><p>Template fallback</p></main>',
        "<footer>Template footer</footer>",
        "</body>",
        "</html>",
      ].join(""),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/dashboard/page.tsx"),
      "export default function Dashboard() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/dashboard/page.config.ts"),
      [
        "export default {",
        '  render: "ssr",',
        '  hydrate: "load",',
        '  title: "Dashboard title",',
        '  meta: { description: "Dashboard description" },',
        "};",
      ].join("\n"),
      "utf-8",
    );

    let frameworkRuntime: BuildResult["frameworkRuntime"];
    const transformedFiles: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      name: "server-document-shell",
      contributions(ctx) {
        ctx.slot("html.tag").add({
          id: "server-document-contribution",
          target: { kind: "page", pageId: "dashboard" },
          tag: "meta",
          placement: "head-append",
          attrs: { name: "from-contribution", content: mode },
        });
      },
      setup() {
        return {
          transformHtml(doc, ctx) {
            if (ctx.owner.kind !== "page" || ctx.owner.pageId !== "dashboard") {
              return;
            }
            transformedFiles.push(ctx.fileName);
            doc.documentElement?.setAttribute("data-plugin", mode);
            doc.body?.setAttribute("data-transformed", "yes");
            const title = doc.querySelector("title");
            if (title) title.textContent = "Plugin title";
          },
          buildEnd(result) {
            frameworkRuntime = result.frameworkRuntime;
          },
        };
      },
    };
    const clientEntryName =
      mode === "spa" ? "main" : createPageClientBuildEntryName("dashboard");
    const pageServerEntryName = createPageServerBuildEntryName("dashboard");
    const clientAssets = {
      js: [`${clientEntryName}.js`],
      css: [`${clientEntryName}.css`],
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: `server-document-${mode}`,
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        const serverEntries = Object.fromEntries(
          plan.entries
            .filter((entry) => entry.environment === "server")
            .map((entry) => [
              entry.name,
              {
                js: [`${entry.name}.js`],
                css: entry.kind === "page-server" ? [`${entry.name}.css`] : [],
              },
            ]),
        );
        const serverRuntime = plan.entries.find(
          (entry) => entry.kind === "server-runtime",
        );
        return {
          clientEntryAssets: {
            [clientEntryName]: clientAssets,
          },
          serverEntryAssets: serverEntries,
          serverEntry: serverRuntime ? `${serverRuntime.name}.js` : undefined,
          serverAssets: serverRuntime
            ? { js: [`${serverRuntime.name}.js`], css: [] }
            : undefined,
        };
      },
      async dev() {},
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode },
        plugins: [plugin],
      },
      { cwd, bundler },
    );

    const page = frameworkRuntime?.routing.pages.dashboard;
    const document = page?.document;
    if (!document) {
      throw new Error(`Expected ${mode} server document shell.`);
    }
    const html = [
      document.beforeContent,
      "__PAGE_CONTENT__",
      document.betweenContentAndData,
      "__REQUEST_DATA__",
      document.afterData,
    ].join("");

    expect(transformedFiles).toEqual([
      mode === "spa" ? "index.html" : "dashboard/index.html",
    ]);
    expect(html).toContain('<html lang="zh-CN"');
    expect(html).toContain('data-template="configured"');
    expect(html).toContain(`data-plugin="${mode}"`);
    expect(html).toContain(
      '<body class="template-body" data-transformed="yes">',
    );
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width">',
    );
    expect(html).toContain("<title");
    expect(html).toContain(">Plugin title</title>");
    expect(html).toContain(`<meta name="from-contribution" content="${mode}">`);
    expect(html).toContain(`href="/${clientEntryName}.css"`);
    expect(html).toContain(`href="/${pageServerEntryName}.css"`);
    expect(html).toContain(
      '<main id="app" data-evjs-hydrate="load">__PAGE_CONTENT__</main>',
    );
    expect(html).toContain("<footer>Template footer</footer>__REQUEST_DATA__");
    expect(html).toContain('id="__EVJS_CLIENT_RUNTIME__"');
    expect(html).toContain(`src="/${clientEntryName}.js"`);
    expect(html).not.toContain("Template fallback");
  });

  it("rejects transformHtml hooks that remove server document markers", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/dashboard/page.tsx"),
      "export default function Dashboard() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/dashboard/page.config.ts"),
      'export default { render: "ssr" };',
      "utf-8",
    );

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
          plugins: [
            {
              name: "removes-server-document-marker",
              setup() {
                return {
                  transformHtml(doc, ctx) {
                    if (
                      ctx.owner.kind === "page" &&
                      ctx.owner.pageId === "dashboard"
                    ) {
                      const mount = doc.querySelector("#app");
                      if (mount) mount.innerHTML = "<p>Replaced</p>";
                    }
                  },
                };
              },
            },
          ],
        },
        {
          cwd,
          bundler: createMockBundler([]),
        },
      ),
    ).rejects.toThrow(
      'Server document for Page "dashboard" must preserve exactly one Page-content marker followed by exactly one request-data marker through transformHtml hooks.',
    );
  });

  it("projects Page metadata into the generated SPA route facade", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.config.ts"),
      [
        "export default {",
        '  title: "Home",',
        '  meta: { description: "Home description" },',
        "};",
      ].join("\n"),
      "utf-8",
    );

    const prepared = await prepareFrameworkBuild(
      { routing: { mode: "spa" } },
      { cwd, runLifecycleHooks: false },
    );
    try {
      const source = await fs.promises.readFile(
        path.join(cwd, ".ev/entries/main.ts"),
        "utf-8",
      );
      expect(source).toContain(
        'metadata: {"title":"Home","meta":{"description":"Home description"}}',
      );
    } finally {
      await prepared.dispose();
    }
  });

  it("applies page-scoped entry runtime and html contributions to matching MPA pages", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/admin/page.tsx"),
      "export default function Admin() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      name: "page-scope",
      contributions(ctx) {
        const homeEntry = ctx.emit.module({
          id: "home-entry",
          scope: { kind: "page", pageId: "home" },
          source: "window.__homeContribution = true;",
        });
        const adminRuntime = ctx.emit.module({
          id: "admin-runtime",
          scope: { kind: "page", pageId: "admin" },
          source: "export const adminRuntime = true;",
        });
        ctx.slot("client.entry").add({
          id: "home-entry-slot",
          module: homeEntry,
          position: "before-main",
          target: { kind: "page", pageId: "home" },
        });
        ctx.slot("client.entry").add({
          id: "admin-runtime-slot",
          module: adminRuntime,
          position: "before-main",
          target: { kind: "page", pageId: "admin" },
        });
        ctx.slot("html.tag").add({
          id: "home-meta",
          tag: "meta",
          placement: "head-append",
          attrs: { name: "page-scope", content: "home" },
          target: { kind: "page", pageId: "home" },
        });
      },
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock-pages",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        const clientEntries = plan.entries.filter(
          (entry) => entry.environment === "client",
        );
        const clientEntryAssets = Object.fromEntries(
          clientEntries.map((entry) => [
            entry.name,
            { js: [`${entry.name}.js`], css: [] },
          ]),
        );
        return {
          clientEntryAssets,
          ...serverBuildFacts(plan),
        };
      },
      async dev() {},
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "mpa" },
      },
      { cwd, bundler },
    );

    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
    ) as BuildPlan;
    const homeModule = manifest.generated?.modules.find(
      (module) => module.id === "home-entry",
    );
    const adminModule = manifest.generated?.modules.find(
      (module) => module.id === "admin-runtime",
    );
    const homeEntryName = createPageClientBuildEntryName("home");
    const adminEntryName = createPageClientBuildEntryName("admin");
    const homeEntryFile = `.ev/entries/${homeEntryName}.ts`;
    const adminEntryFile = `.ev/entries/${adminEntryName}.ts`;
    const homeEntry = await fs.promises.readFile(
      path.join(cwd, homeEntryFile),
      "utf-8",
    );
    const adminEntry = await fs.promises.readFile(
      path.join(cwd, adminEntryFile),
      "utf-8",
    );
    const homeHtml = await fs.promises.readFile(
      path.join(cwd, "dist/client/home/index.html"),
      "utf-8",
    );
    const adminHtml = await fs.promises.readFile(
      path.join(cwd, "dist/client/admin/index.html"),
      "utf-8",
    );

    expect(homeEntry).toContain(
      generatedImport(cwd, homeEntryFile, homeModule?.file ?? ""),
    );
    expect(homeEntry).not.toContain(
      generatedImport(cwd, homeEntryFile, adminModule?.file ?? ""),
    );
    expect(adminEntry).toContain(
      generatedImport(cwd, adminEntryFile, adminModule?.file ?? ""),
    );
    expect(adminEntry).not.toContain(
      generatedImport(cwd, adminEntryFile, homeModule?.file ?? ""),
    );
    expect(homeHtml).toContain('name="page-scope"');
    expect(adminHtml).not.toContain('name="page-scope"');
  });

  it("does not infer Page routes or a fallback entry without explicit client routing", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/home/components"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/home/index.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/home/components/index.tsx"),
      "export default function NestedComponent() { return null; }",
      "utf-8",
    );
    const events: string[] = [];

    await build(
      { output: { client: "dist/client", server: "dist/server" } },
      {
        cwd,
        bundler: createMockBundler(events, {
          onBuildPlan(plan) {
            events.push(`entry:${plan.entries[0]?.import}`);
            events.push(`metadata:${plan.entries[0]?.metadata?.type}`);
          },
        }),
      },
    );

    expect(events).toEqual([
      "entry:undefined",
      "metadata:undefined",
      "bundler.build",
      "bundler.entries:",
    ]);
    expect(fs.existsSync(path.join(cwd, "src/route-types.d.ts"))).toBe(false);
  });

  it("does not require a default HTML template for a server-only build", async () => {
    const cwd = await createProject();
    await fs.promises.rm(path.join(cwd, "index.html"));
    await writeFile(
      path.join(cwd, "src/apis/health/api.ts"),
      "export const GET = () => Response.json({ ok: true });",
      "utf-8",
    );
    const events: string[] = [];
    let observedPlan: BuildPlan | undefined;

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
      },
      {
        cwd,
        bundler: createMockBundler(events, {
          onBuildPlan(plan) {
            observedPlan = plan;
          },
        }),
      },
    );

    expect(observedPlan?.html).toEqual([]);
    expect(observedPlan?.entries).toEqual([
      expect.objectContaining({
        kind: "server-runtime",
        environment: "server",
      }),
    ]);
    expect(events).toContain("bundler.build");
  });

  it("builds a canonical Page-anchor SPA without a user entry file", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await fs.promises.mkdir(path.join(cwd, "src/pages/docs"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/docs/$...splat/page.tsx"),
      "export default function DocsCatchAll() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/legacyCamelCase/page.tsx"),
      "export default function Legacy() { return null; }",
      "utf-8",
    );
    const events: string[] = [];
    const bundler = createMockBundler(events, {
      onBuildPlan(plan) {
        const entry = plan.entries[0];
        events.push(`entry:${entry?.import}`);
        events.push(`metadata:${entry?.metadata?.type}`);
        events.push(
          `routes:${
            entry?.metadata?.type === "pages-app"
              ? entry.metadata.routes.map((route) => route.path).join(",")
              : ""
          }`,
        );
      },
    });

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "entry:./.ev/entries/main.ts",
      "metadata:pages-app",
      "routes:/,/docs/$,/legacyCamelCase",
      "bundler.build",
      "bundler.entries:main",
    ]);
    expect(fs.existsSync(path.join(cwd, ".evjs"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".ev/manifest.json"))).toBe(true);
    await expect(
      fs.promises.readFile(path.join(cwd, "src/route-types.d.ts"), "utf-8"),
    ).resolves.toContain(
      'import type * as EvPage_docs_splat from "./pages/docs/$...splat/page";',
    );
  });

  it("does not rewrite unchanged generated SPA route types", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const routeTypesPath = path.join(cwd, "src/route-types.d.ts");

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      {
        cwd,
        bundler: createMockBundler([]),
      },
    );
    const firstStat = await fs.promises.stat(routeTypesPath, {
      bigint: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      {
        cwd,
        bundler: createMockBundler([]),
      },
    );

    const secondStat = await fs.promises.stat(routeTypesPath, {
      bigint: true,
    });
    expect(secondStat.mtimeNs).toBe(firstStat.mtimeNs);
  });

  it("does not remove user-authored files that share the route types file name", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await fs.promises.mkdir(path.join(cwd, "types"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "types/route-types.d.ts"),
      "declare const userAuthoredRouteTypes: string;",
      "utf-8",
    );

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      {
        cwd,
        bundler: createMockBundler([]),
      },
    );

    await expect(
      fs.promises.readFile(path.join(cwd, "types/route-types.d.ts"), "utf-8"),
    ).resolves.toBe("declare const userAuthoredRouteTypes: string;");
  });

  it("disables every file convention without creating a fallback application", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await fs.promises.mkdir(path.join(cwd, "src/apis/admin"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/route-types.d.ts"),
      generatedRouteTypesSource,
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/middleware.ts"),
      "export default async function middleware(_ctx, next) { await next(); }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/apis/admin/middleware.ts"),
      "export default async function middleware(_ctx, next) { await next(); }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/apis/admin/health/api.ts"),
      "export const GET = async () => Response.json({ ok: true });",
      "utf-8",
    );

    let observedPlan: BuildPlan | undefined;

    await build(
      {
        conventions: false,
        output: { client: "dist/client", server: "dist/server" },
      },
      {
        cwd,
        bundler: createMockBundler([], {
          onBuildPlan(plan) {
            observedPlan = plan;
          },
        }),
      },
    );

    expect(fs.existsSync(path.join(cwd, "src/route-types.d.ts"))).toBe(false);
    expect(observedPlan?.entries).toEqual([]);

    const generatedGraph = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, ".ev/framework/core-graph.json"),
        "utf-8",
      ),
    ) as { graph: CoreGraph };
    expect(generatedGraph.graph.applications).toEqual({});
    expect(generatedGraph.graph.pages).toEqual({});
    expect(generatedGraph.graph.routes).toEqual([]);
    expect(generatedGraph.graph.serverRoutes).toEqual([]);
  });

  it("removes generated route types when conventions are disabled", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/route-types.d.ts"),
      generatedRouteTypesSource,
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    await build(
      {
        conventions: false,
        output: { client: "dist/client", server: "dist/server" },
      },
      {
        cwd,
        bundler: createMockBundler([]),
      },
    );

    expect(fs.existsSync(path.join(cwd, "src/route-types.d.ts"))).toBe(false);
  });

  it(
    "generates TypeScript-visible SPA route types for app navigation helpers",
    async () => {
      const cwd = await createWorkspaceProject();
      await fs.promises.mkdir(path.join(cwd, "src/pages/posts"), {
        recursive: true,
      });
      await writeFile(
        path.join(cwd, "src/pages/page.tsx"),
        "export default function Home() { return null; }",
        "utf-8",
      );
      await writeFile(
        path.join(cwd, "src/pages/posts/$postId/page.tsx"),
        [
          "export async function loader() {",
          "  return { title: 'Post' };",
          "}",
          "export default function Post() { return null; }",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        path.join(cwd, "src/pages/search/page.tsx"),
        [
          "export function validateSearch(search: Record<string, unknown>) {",
          "  return { q: String(search.q ?? ''), page: Number(search.page ?? 1) };",
          "}",
          "export default function Search() { return null; }",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        path.join(cwd, "src/check-links.tsx"),
        [
          'import { usePageLoaderData, usePageParams, usePageSearch } from "@evjs/ev/route";',
          'import { Link, Outlet, useLinkProps } from "@evjs/ev/navigation";',
          "",
          "export function CheckLinks() {",
          "  <Outlet />;",
          '  <Link to="/posts/$postId" params={{ postId: "p1" }} />;',
          '  useLinkProps({ to: "/search", search: { q: "router", page: 1 } });',
          '  usePageParams("/posts/$postId").postId.toUpperCase();',
          '  usePageSearch("/search").page.toFixed();',
          '  usePageLoaderData("/posts/$postId").title.toUpperCase();',
          "",
          "  // @ts-expect-error unknown page route paths are rejected.",
          '  useLinkProps({ to: "/missing" });',
          "",
          "  // @ts-expect-error page data hooks use the generated route path list.",
          '  usePageParams("/missing");',
          "",
          "  // @ts-expect-error dynamic page routes require their params.",
          '  useLinkProps({ to: "/posts/$postId" });',
          "",
          "  // @ts-expect-error dynamic params must match the page route segment name.",
          '  useLinkProps({ to: "/posts/$postId", params: { id: "p1" } });',
          "",
          "  // @ts-expect-error search objects follow validateSearch output.",
          '  useLinkProps({ to: "/search", search: { q: "router", page: "one" } });',
          "",
          "  return null;",
          "}",
        ].join("\n"),
        "utf-8",
      );
      await writeRouteTypeCheckTsConfig(cwd);

      await build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler: createMockBundler([]),
        },
      );

      await execa("npx", ["tsc", "-p", path.join(cwd, "tsconfig.json")], {
        cwd: repoRoot,
      });
    },
    routeTypeCheckTimeoutMs,
  );

  it("uses discovered Page routes as the application entry", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const events: string[] = [];
    const bundler = createMockBundler(events, {
      onBuildPlan(plan) {
        events.push(`entry:${plan.entries[0]?.import}`);
        events.push(`metadata:${plan.entries[0]?.metadata?.type}`);
      },
    });

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "entry:./.ev/entries/main.ts",
      "metadata:pages-app",
      "bundler.build",
      "bundler.entries:main",
    ]);
  });

  it("builds MPA pages without a router or generated route files", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/route-types.d.ts"),
      generatedRouteTypesSource,
      "utf-8",
    );
    await fs.promises.mkdir(path.join(cwd, "src/layout"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/layout.tsx"),
      "export default function Layout() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/about/page.tsx"),
      "export default function About() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/about/index.html"),
      '<div id="app"></div>',
      "utf-8",
    );
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock-mpa",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        events.push(
          `entries:${plan.entries.map((entry) => `${entry.name}:${entry.kind}`).join(",")}`,
        );
        events.push(
          `metadata:${plan.entries.map((entry) => entry.metadata?.type ?? "none").join(",")}`,
        );
        events.push(
          `html:${plan.html.map((document) => `${document.id}:${document.template}`).join(",")}`,
        );
        return {
          clientEntryAssets: {
            [createPageClientBuildEntryName("index")]: {
              js: ["page-client-index.js"],
              css: [],
            },
            [createPageClientBuildEntryName("about")]: {
              js: ["page-client-about.js"],
              css: [],
            },
          },
          ...serverBuildFacts(plan),
        };
      },
      async dev() {},
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: {
          mode: "mpa",
        },
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "entries:page-client-index:page-client,page-client-about:page-client",
      "metadata:react-component-page,react-component-page",
      "html:index:./index.html,about:./src/pages/about/index.html",
    ]);
    expect(fs.existsSync(path.join(cwd, ".evjs"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "src/route-types.d.ts"))).toBe(false);
  });

  it("builds MPA page routes with colocated HTML templates without a root routing html", async () => {
    const cwd = await createProject();
    await fs.promises.rm(path.join(cwd, "index.html"));
    await fs.promises.mkdir(path.join(cwd, "src/pages/product"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/product/page.tsx"),
      "export default function Product() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/product/index.html"),
      '<html><body><main id="app"></main></body></html>',
      "utf-8",
    );
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock-mpa-colocated-html",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        events.push(
          `html:${plan.html.map((document) => `${document.id}:${document.template}`).join(",")}`,
        );
        return {
          clientEntryAssets: {
            [createPageClientBuildEntryName("product")]: {
              js: ["page-client-product.js"],
              css: [],
            },
          },
          ...serverBuildFacts(plan),
        };
      },
      async dev() {},
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa" },
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual(["html:product:./src/pages/product/index.html"]);
    await expect(
      fs.promises.readFile(
        path.join(cwd, "dist/client/product/index.html"),
        "utf-8",
      ),
    ).resolves.toContain('<main id="app">');
  });

  it("emits one transformed Document to aliases and removes stale aliases", async () => {
    const cwd = await createProject();
    const pageConfigFile = path.join(cwd, "src/pages/about/page.config.ts");
    await writeFile(
      path.join(cwd, "src/pages/about/page.tsx"),
      "export default function About() { return null; }",
      "utf-8",
    );
    await writeFile(
      pageConfigFile,
      `
        export default {
          document: {
            aliases: ["about.html", "legacy/about.htm"],
          },
        };
      `,
      "utf-8",
    );

    let transformCalls = 0;
    const frameworkAliases: Array<readonly string[] | undefined> = [];
    const plugin = definePlugin<
      "document-alias-observer",
      undefined,
      undefined,
      undefined,
      Record<string, never>
    >({
      id: "document-alias-observer",
      contributions(ctx) {
        frameworkAliases.push(
          ctx.framework.documents.find(
            (document) =>
              document.owner.kind === "page" &&
              document.owner.pageId === "about",
          )?.aliases,
        );
      },
      setup() {
        return {
          transformHtml(doc, ctx) {
            if (ctx.owner.kind !== "page" || ctx.owner.pageId !== "about") {
              return;
            }
            transformCalls += 1;
            doc.body?.appendChild(doc.createComment(" alias-transform "));
          },
        };
      },
    })();
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "document-alias-output",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        const aboutEntry = createPageClientBuildEntryName("about");
        return {
          clientEntryAssets: {
            [aboutEntry]: { js: [`${aboutEntry}.js`], css: [] },
          },
          ...serverBuildFacts(plan),
        };
      },
      async dev() {},
    };
    const config: Config<Record<string, never>> = {
      routing: { mode: "mpa" },
      plugins: [plugin],
    };

    await build(config, { cwd, bundler });

    const primaryPath = path.join(cwd, "dist/client/about/index.html");
    const aliasPath = path.join(cwd, "dist/client/about.html");
    const nestedAliasPath = path.join(cwd, "dist/client/legacy/about.htm");
    const [primary, alias, nestedAlias] = await Promise.all([
      fs.promises.readFile(primaryPath, "utf-8"),
      fs.promises.readFile(aliasPath, "utf-8"),
      fs.promises.readFile(nestedAliasPath, "utf-8"),
    ]);
    expect(alias).toBe(primary);
    expect(nestedAlias).toBe(primary);
    expect(primary).toContain("alias-transform");
    expect(transformCalls).toBe(1);
    expect(frameworkAliases).toEqual([["about.html", "legacy/about.htm"]]);
    const firstDeployment = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/deployment-metadata.json"),
        "utf-8",
      ),
    ) as { documents: unknown[] };
    expect(firstDeployment.documents).toContainEqual({
      kind: "page",
      id: "about",
      fileName: "about/index.html",
      aliases: ["about.html", "legacy/about.htm"],
      assets: { js: ["page-client-about.js"], css: [] },
    });

    await writeFile(pageConfigFile, "export default {};", "utf-8");
    await build(config, { cwd, bundler });

    expect(transformCalls).toBe(2);
    expect(frameworkAliases).toEqual([
      ["about.html", "legacy/about.htm"],
      undefined,
    ]);
    await expect(fs.promises.access(aliasPath)).rejects.toThrow();
    await expect(fs.promises.access(nestedAliasPath)).rejects.toThrow();
    await expect(fs.promises.readFile(primaryPath, "utf-8")).resolves.toContain(
      "alias-transform",
    );
  });

  it("removes stale generated route types in MPA mode", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/route-types.d.ts"),
      generatedRouteTypesSource,
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa" },
      },
      {
        cwd,
        bundler: createMockBundler([]),
      },
    );

    expect(fs.existsSync(path.join(cwd, "src/route-types.d.ts"))).toBe(false);
  });

  it("does not remove user-authored route type declarations in MPA mode", async () => {
    const cwd = await createProject();
    const userAuthoredSource = "declare const userAuthoredRouteTypes: string;";
    await writeFile(
      path.join(cwd, "src/route-types.d.ts"),
      userAuthoredSource,
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa" },
      },
      {
        cwd,
        bundler: createMockBundler([]),
      },
    );

    await expect(
      fs.promises.readFile(path.join(cwd, "src/route-types.d.ts"), "utf-8"),
    ).resolves.toBe(userAuthoredSource);
  });

  it("passes linked BuildOutput to buildEnd and emits deployment metadata", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "memory-output",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        return {
          clientEntryAssets: {
            main: { js: ["memory.js"], css: [] },
          },
          ...serverBuildFacts(plan),
        };
      },
      async dev() {},
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [
          {
            name: "reads-memory-output",
            setup() {
              return {
                buildEnd(result) {
                  events.push(result.output.apps.default.assets.js[0] ?? "");
                },
              };
            },
          },
        ],
      },
      { cwd, bundler },
    );

    expect(events).toEqual(["memory.js"]);
    expect(fs.existsSync(path.join(cwd, "dist/deployment-metadata.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(cwd, "dist/manifest.json"))).toBe(false);
  });

  it("keeps opt-in page semantic Pages out of the v1 linked BuildOutput", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    let linkedOutput: BuildOutput | undefined;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "page-output",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {
          clientEntryAssets: {
            main: { js: ["main.js"], css: [] },
          },
        };
      },
      async dev() {},
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [
          {
            name: "captures-page-output",
            setup() {
              return {
                buildEnd(result) {
                  linkedOutput = result.output;
                },
              };
            },
          },
        ],
      },
      { cwd, bundler },
    );

    expect(linkedOutput?.pages).toEqual({});
    expect(linkedOutput?.routes).toEqual([
      { id: "index", path: "/", appId: "default" },
    ]);
  });

  it("emits canonical deployment metadata without split manifests", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/dashboard/page.tsx"),
      "export default function Dashboard() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/dashboard/page.config.ts"),
      'export default { render: "ssr" };',
      "utf-8",
    );

    const rawOutputModules: Array<string | undefined> = [];
    let linkedOutput: BuildOutput | undefined;
    let frameworkRuntime: BuildResult["frameworkRuntime"];
    let deploymentMetadata: BuildResult["deploymentMetadata"] | undefined;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "memory-output",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        const serverFacts = serverBuildFacts(plan);
        const dashboardClientEntry =
          createPageClientBuildEntryName("dashboard");
        const dashboardServerEntry =
          createPageServerBuildEntryName("dashboard");
        return {
          clientEntryAssets: {
            [dashboardClientEntry]: {
              js: [`${dashboardClientEntry}.js`],
              css: [],
            },
          },
          serverEntryAssets: {
            ...serverFacts.serverEntryAssets,
            [dashboardServerEntry]: {
              js: [`${dashboardServerEntry}.js`],
              css: [],
            },
          },
          serverEntry: serverFacts.serverEntry,
          serverAssets: serverFacts.serverAssets,
        };
      },
      async dev() {},
    };

    await build(
      {
        routing: { mode: "mpa" },
        plugins: [
          {
            name: "records-raw-output",
            setup() {
              return {
                buildEnd(result) {
                  linkedOutput = result.output;
                  rawOutputModules.push(
                    result.output.pages.dashboard.module?.type,
                  );
                  frameworkRuntime = result.frameworkRuntime;
                  deploymentMetadata = result.deploymentMetadata;
                },
              };
            },
          },
        ],
      },
      { cwd, bundler },
    );

    if (!linkedOutput) throw new Error("Expected linked BuildOutput.");
    if (!deploymentMetadata) {
      throw new Error("Expected canonical deployment metadata.");
    }
    const deploymentMetadataText = fs.readFileSync(
      path.join(cwd, "dist/deployment-metadata.json"),
      "utf-8",
    );
    const emittedDeploymentMetadata = JSON.parse(deploymentMetadataText);

    expect(rawOutputModules).toEqual(["react-component"]);
    expect(emittedDeploymentMetadata).toEqual(deploymentMetadata);
    expect(deploymentMetadata.server).toEqual({ entry: "server.js" });
    expect(deploymentMetadata.routes).toContainEqual({
      kind: "server-page",
      path: "/dashboard",
      pageId: "dashboard",
      render: "ssr",
      methods: ["GET", "HEAD"],
    });
    expect(deploymentMetadata).not.toHaveProperty("runtime");
    expect(deploymentMetadata).not.toHaveProperty("pages");
    expect(deploymentMetadata.server).not.toHaveProperty("renderers");
    expect(deploymentMetadata.server).not.toHaveProperty("functions");
    expect(frameworkRuntime?.server?.renderers).toHaveProperty(
      createPageServerBuildEntryName("dashboard"),
    );
    expect(deploymentMetadataText).not.toContain(
      "./src/pages/dashboard/page.tsx",
    );
    expect(deploymentMetadataText).toContain("server.js");
    expect(fs.existsSync(path.join(cwd, "dist/manifest.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "dist/client/manifest.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(cwd, "dist/server/manifest.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(cwd, "dist/runtime.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "dist/client/runtime.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(cwd, "dist/server/runtime.json"))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(cwd, "dist/server/framework-runtime.json")),
    ).toBe(false);
    expect(fs.existsSync(path.join(cwd, "dist/deployment-metadata.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(cwd, "dist/server/deployment-metadata.json")),
    ).toBe(false);
  });

  it("prerenders SSG page HTML during production builds", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/report/page.tsx"),
      "export default function Report() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/report/page.config.ts"),
      'export default { render: "ssg" };',
      "utf-8",
    );

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "ssg-mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        const reportServerEntry = createPageServerBuildEntryName("report");
        return {
          clientEntryAssets: {},
          serverEntryAssets: {
            [reportServerEntry]: {
              js: [`${reportServerEntry}.js`],
              css: [],
            },
          },
          serverAssets: { js: [], css: [] },
          async loadServerModule(asset) {
            if (asset !== `${reportServerEntry}.js`) {
              throw new Error(`Unexpected server module asset: ${asset}`);
            }
            return {
              render(ctx: { pageId: string; request: Request }) {
                return `<main data-page="${ctx.pageId}"><h1>Prerendered Report</h1><p>${ctx.request.url}</p></main>`;
              },
            };
          },
        };
      },
      async dev() {
        return undefined;
      },
    };

    await build(
      {
        routing: { mode: "mpa" },
      },
      { cwd, bundler },
    );

    const html = fs.readFileSync(
      path.join(cwd, "dist/client/report/index.html"),
      "utf-8",
    );
    const buildOutput = JSON.parse(
      fs.readFileSync(path.join(cwd, "dist/deployment-metadata.json"), "utf-8"),
    );

    expect(html).toContain("Prerendered Report");
    expect(html).toContain("http://evjs.local/report");
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain("__EVJS_CLIENT_RUNTIME__");
    expect(html).not.toContain("data-evjs-hydrate");
    expect(buildOutput.server).toEqual({});
    expect(buildOutput.documents).toContainEqual({
      kind: "page",
      id: "report",
      fileName: "report/index.html",
    });
    expect(buildOutput.routes).toEqual([
      {
        kind: "static-page",
        path: "/report",
        pageId: "report",
        documentId: "report",
        render: "ssg",
        methods: ["GET", "HEAD"],
      },
    ]);
    expect(fs.existsSync(path.join(cwd, "dist/server"))).toBe(false);
  });

  it("marks hydrated SSG HTML for client bootstrap", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/report/page.tsx"),
      "export default function Report() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/report/page.config.ts"),
      'export default { render: "ssg", hydrate: "load" };',
      "utf-8",
    );

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "hydrated-ssg-mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        const reportClientEntry = createPageClientBuildEntryName("report");
        const reportServerEntry = createPageServerBuildEntryName("report");
        return {
          clientEntryAssets: {
            [reportClientEntry]: {
              js: [`${reportClientEntry}.js`],
              css: [],
            },
          },
          serverEntryAssets: {
            server: { js: ["server.js"], css: [] },
            [reportServerEntry]: {
              js: [`${reportServerEntry}.js`],
              css: [],
            },
          },
          async loadServerModule(asset) {
            if (asset !== `${reportServerEntry}.js`) {
              throw new Error(`Unexpected server module asset: ${asset}`);
            }
            return {
              render() {
                return "<h1>Hydrated Report</h1>";
              },
            };
          },
        };
      },
      async dev() {
        return undefined;
      },
    };

    await build(
      {
        routing: { mode: "mpa" },
      },
      { cwd, bundler },
    );

    const html = fs.readFileSync(
      path.join(cwd, "dist/client/report/index.html"),
      "utf-8",
    );
    expect(html).toContain(
      '<div id="app" data-evjs-hydrate="load"><h1>Hydrated Report</h1></div>',
    );
    expect(html).toContain(
      `src="/${createPageClientBuildEntryName("report")}.js"`,
    );
    expect(html).toContain("__EVJS_CLIENT_RUNTIME__");
  });

  it("emits hydrated SPA SSG HTML without duplicating the Application Document", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/report/page.tsx"),
      "export default function Report() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/report/page.config.ts"),
      'export default { render: "ssg", hydrate: "load" };',
      "utf-8",
    );

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "hydrated-spa-ssg-mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        const reportServerEntry = createPageServerBuildEntryName("report");
        return {
          clientEntryAssets: {
            main: { js: ["main.js"], css: ["main.css"] },
          },
          serverEntryAssets: {
            [reportServerEntry]: {
              js: [`${reportServerEntry}.js`],
              css: [],
            },
          },
          async loadServerModule(asset) {
            if (asset !== `${reportServerEntry}.js`) {
              throw new Error(`Unexpected server module asset: ${asset}`);
            }
            return {
              render() {
                return "<h1>Hydrated SPA Report</h1>";
              },
            };
          },
        };
      },
      async dev() {
        return undefined;
      },
    };

    await build(
      {
        routing: { mode: "spa" },
      },
      { cwd, bundler },
    );

    const html = fs.readFileSync(
      path.join(cwd, "dist/client/report/index.html"),
      "utf-8",
    );
    expect(html).toContain(
      '<div id="app" data-evjs-hydrate="load"><h1>Hydrated SPA Report</h1></div>',
    );
    expect(html).toContain('href="/main.css"');
    expect(html).toContain('src="/main.js"');
    expect(html).toContain("__EVJS_CLIENT_RUNTIME__");
    expect(fs.existsSync(path.join(cwd, "dist/client/index.html"))).toBe(false);
  });

  it("keeps root SPA SSG output separate from a mixed Application shell", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.config.ts"),
      'export default { render: "ssg", hydrate: "none" };',
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/dashboard/page.tsx"),
      "export default function Dashboard() { return null; }",
      "utf-8",
    );

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mixed-root-spa-ssg-mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        const indexServerEntry = createPageServerBuildEntryName("index");
        return {
          clientEntryAssets: {
            main: { js: ["main.js"], css: [] },
          },
          serverEntryAssets: {
            [indexServerEntry]: {
              js: [`${indexServerEntry}.js`],
              css: [],
            },
          },
          async loadServerModule(asset) {
            if (asset !== `${indexServerEntry}.js`) {
              throw new Error(`Unexpected server module asset: ${asset}`);
            }
            return {
              render() {
                return "<h1>Static Home</h1>";
              },
            };
          },
        };
      },
      async dev() {
        return undefined;
      },
    };

    await build(
      {
        routing: { mode: "spa" },
      },
      { cwd, bundler },
    );

    const rootHtml = fs.readFileSync(
      path.join(cwd, "dist/client/index.html"),
      "utf-8",
    );
    const applicationHtml = fs.readFileSync(
      path.join(cwd, "dist/client/__evjs/default.html"),
      "utf-8",
    );
    expect(rootHtml).toContain('<div id="app"><h1>Static Home</h1></div>');
    expect(rootHtml).not.toContain('src="/main.js"');
    expect(applicationHtml).toContain('src="/main.js"');
  });

  it("removes stale framework HTML while preserving replaced and unrelated files", async () => {
    const cwd = await createProject();
    let bundlerOwnedFile: string | undefined;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock-mpa",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        const clientEntryAssets = Object.fromEntries(
          plan.entries
            .filter((entry) => entry.environment === "client")
            .map((entry) => [
              entry.name,
              { js: [`${entry.name}.js`], css: [] },
            ]),
        );
        if (bundlerOwnedFile) {
          await writeFile(
            path.join(cwd, "dist/client", bundlerOwnedFile),
            "bundler replacement",
            "utf-8",
          );
        }
        return {
          clientEntryAssets,
          emittedFiles: {
            client: [
              ...Object.values(clientEntryAssets).flatMap(
                (assets) => assets.js,
              ),
              ...(bundlerOwnedFile ? [bundlerOwnedFile] : []),
            ],
          },
        };
      },
      async dev() {},
    };
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const reportPage = path.join(cwd, "src/pages/report/page.tsx");
    const archivePage = path.join(cwd, "src/pages/archive/page.tsx");
    await writeFile(
      reportPage,
      "export default function Report() { return null; }",
      "utf-8",
    );
    await writeFile(
      archivePage,
      "export default function Archive() { return null; }",
      "utf-8",
    );

    await build(
      { output: { client: "dist/client" }, routing: { mode: "mpa" } },
      { cwd, bundler },
    );

    const reportHtml = path.join(cwd, "dist/client/report/index.html");
    const archiveHtml = path.join(cwd, "dist/client/archive/index.html");
    const unrelatedHtml = path.join(cwd, "dist/client/manual.html");
    expect(fs.existsSync(reportHtml)).toBe(true);
    expect(fs.existsSync(archiveHtml)).toBe(true);
    await writeFile(
      archiveHtml,
      "<!doctype html><html><head></head><body>plugin replacement</body></html>",
      "utf-8",
    );
    await writeFile(
      unrelatedHtml,
      "<!doctype html><html><head></head><body>manual</body></html>",
      "utf-8",
    );
    await fs.promises.rm(reportPage);
    await fs.promises.rm(archivePage);
    bundlerOwnedFile = "report/index.html";

    await build(
      { output: { client: "dist/client" }, routing: { mode: "mpa" } },
      { cwd, bundler },
    );

    expect(fs.readFileSync(reportHtml, "utf-8")).toBe("bundler replacement");
    expect(fs.readFileSync(archiveHtml, "utf-8")).toContain(
      "plugin replacement",
    );
    expect(fs.readFileSync(unrelatedHtml, "utf-8")).toContain("manual");
  });

  it("runs plugin config hooks before resolving config", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const bundler = createMockBundler(events, { recordEndpoint: true });

    const plugin: Plugin<Record<string, never>> = {
      name: "sets-server-base-path",
      config(config, ctx) {
        events.push(`config:${ctx.mode}`);
        config.server = {
          ...(typeof config.server === "object" ? config.server : {}),
          basePath: "/api",
        };
        return config;
      },
      setup(ctx) {
        events.push(`setup:${ctx.config.server.runtime.fn}`);
      },
    };

    await build(
      { plugins: [plugin], routing: { mode: "spa" } },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "config:production",
      "setup:api/fn",
      "bundler.build",
      "bundler.entries:main",
      "bundler.endpoint:api/fn",
    ]);
  });

  it("validates plugin-mutated config before setup and bundling", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-dev-port",
      config(config) {
        events.push("config");
        config.dev = {
          ...config.dev,
          port: 70000,
        };
        return config;
      },
      setup() {
        events.push("setup");
      },
    };

    await expect(
      build(
        { plugins: [plugin] },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      "[evjs] dev.port must be an integer TCP port from 1 to 65535.",
    );
    expect(events).toEqual(["config"]);
  });

  it("rejects invalid plugin config hook return values", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-config-return",
      config() {
        events.push("config");
        return null as never;
      },
      setup() {
        events.push("setup");
      },
    };

    await expect(
      build(
        { plugins: [plugin] },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      '[evjs] Plugin "invalid-config-return" config hook must return a config object or undefined.',
    );
    expect(events).toEqual(["config"]);
  });

  it("rejects invalid plugin setup hook return values", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-setup-return",
      setup() {
        events.push("setup");
        return [] as never;
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      '[evjs] Plugin "invalid-setup-return" setup hook must return a plugin hooks object or undefined.',
    );
    expect(events).toEqual(["setup"]);
  });

  it("rejects non-function lifecycle hooks returned from plugin setup", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-lifecycle-hook",
      setup() {
        events.push("setup");
        return {
          buildStart: "start" as never,
        };
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      '[evjs] Plugin "invalid-lifecycle-hook" setup hook returned buildStart must be a function.',
    );
    expect(events).toEqual(["setup"]);
  });

  it("suggests the current spelling for mis-cased lifecycle hooks", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      name: "typo-lifecycle-hook",
      setup() {
        events.push("setup");
        return {
          buildstart() {},
          buildStart() {
            events.push("buildStart");
          },
        } as never;
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [plugin],
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      '[evjs] Plugin "typo-lifecycle-hook" setup hook returned unsupported hook "buildstart". Use "buildStart" instead.',
    );
    expect(events).toEqual(["setup"]);
  });

  it("fails on missing Application Document templates before running the bundler", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          application: {
            document: { template: "./missing-app.html" },
            routes: [{ path: "/", page: "home" }],
          },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      "[evjs] Application Document html template not found: ./missing-app.html",
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on missing routing html templates before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: {
            mode: "spa",
            html: "./missing-routing.html",
            mount: "#app",
          },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      "[evjs] Page routing html template not found: ./missing-routing.html",
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on directory-valued html templates before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "templates"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa", html: "./templates" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      "[evjs] Page routing html template must be a file: ./templates",
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails when routing html lacks the mount target before running the bundler", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "index.html"),
      '<main id="root"></main>',
      "utf-8",
    );
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      '[evjs] Page routing mount target was not found "#app" in html template: ./index.html',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("validates the shared MPA mount before running the bundler", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "index.html"),
      '<div id="home"></div>',
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/admin/page.tsx"),
      "export default function Admin() { return null; }",
      "utf-8",
    );
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "mpa", mount: "#admin" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      '[evjs] Page routing mount target was not found "#admin" in html template: ./index.html',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on missing explicit page route directories before running the bundler", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow("Page route directory not found: ./src/pages.");
    expect(events).not.toContain("bundler.build");
  });

  it("fails on file-valued explicit page route directories before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src/pages"), "not a directory", "utf-8");
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow("Page route directory must be a directory: ./src/pages.");
    expect(events).not.toContain("bundler.build");
  });

  it("fails on empty explicit page route directories with a creation hint", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    const events: string[] = [];
    const bundler = createMockBundler(events);
    let error: unknown;

    try {
      await build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "No page routes found in ./src/pages. Add a default-exporting Page anchor such as ./src/pages/page.tsx or set conventions: false.",
    );
    expect((error as Error).message).toContain(
      PAGE_ANCHOR_ROUTE_CONVENTION_SUMMARY,
    );
    expect((error as Error).message).toContain(
      "See https://afx-team.github.io/evjs/docs/file-conventions#client-page-routes for the page route file convention.",
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on page route convention errors before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/users"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/users/[id]/page.tsx"),
      "export default function UserByBracketParam() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);
    let error: unknown;

    try {
      await build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "[evjs] Page route discovery failed.",
    );
    expect((error as Error).message).toContain("src/pages/users/[id]/page.tsx");
    expect((error as Error).message).toContain(
      'Dynamic page route segments must use $param directory names. Bracket segment "[id]" is not supported. Rename the route directory to "$id" for a dynamic segment.',
    );
    expect((error as Error).message).toContain(
      PAGE_ANCHOR_ROUTE_CONVENTION_SUMMARY,
    );
    expect((error as Error).message).toContain(
      "See https://afx-team.github.io/evjs/docs/file-conventions#client-page-routes for the page route file convention.",
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on invalid page route segment names before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/users"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/contact us/page.tsx"),
      "export default function ContactUs() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/users/$123/page.tsx"),
      "export default function User() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);
    let error: unknown;

    try {
      await build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "[evjs] Page route discovery failed.",
    );
    expect((error as Error).message).toContain("src/pages/contact us/page.tsx");
    expect((error as Error).message).toContain(
      'Static page route segment "contact us" must start with a letter or number and then use only URL-safe characters: letters, numbers, ".", "_", "-", or "~". Rename the route directory to a URL-safe segment.',
    );
    expect((error as Error).message).toContain("src/pages/users/$123/page.tsx");
    expect((error as Error).message).toContain(
      'Dynamic page route segment "$123" must use a JavaScript identifier after "$", such as "$userId".',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on ambiguous dynamic page route shapes before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/users"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/users/$id/page.tsx"),
      "export default function UserById() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/users/$userId/page.tsx"),
      "export default function UserByUserId() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);
    let error: unknown;

    try {
      await build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "[evjs] Page route discovery failed.",
    );
    expect((error as Error).message).toContain(
      "src/pages/users/$userId/page.tsx",
    );
    expect((error as Error).message).toContain(
      'Ambiguous page route shape "/users/:param" for path "/users/$userId" also matches ./src/pages/users/$id/page.tsx (/users/$id). Use one dynamic parameter directory name for each URL shape.',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on unsupported page render metadata before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.tsx"),
      "export default function Campaign() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.config.ts"),
      'export default { render: "ppr", prerender: { partial: true } };',
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      'Page "campaign" config "./src/pages/campaign/page.config.ts" render must be "csr", "ssr", or "ssg".',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on unsupported page rsc metadata before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.tsx"),
      "export default function Campaign() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.config.ts"),
      'export default { render: "ssr", rsc: "yes" };',
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      'Page "campaign" config "./src/pages/campaign/page.config.ts" rsc must be true when provided.',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on invalid page rendering combinations before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/insights/page.tsx"),
      "export default function Insights() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/insights/page.config.ts"),
      "export default { rsc: true };",
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      'Page "insights" config "./src/pages/insights/page.config.ts" uses RSC and must declare render: "ssr".',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on RSC pages with partial prerendering before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.tsx"),
      "export default function Campaign() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.config.ts"),
      'export default { render: "ssr", rsc: true, prerender: { partial: true } };',
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      'Page "campaign" config "./src/pages/campaign/page.config.ts" combines RSC and partial prerendering, which is unsupported. Choose either rsc: true or prerender: { partial: true }, or split them into separate page routes.',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails when canonical Page config explicitly disables RSC", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.tsx"),
      "export default function Campaign() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.config.ts"),
      'export default { render: "ssr", rsc: false };',
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      'Page "campaign" config "./src/pages/campaign/page.config.ts" rsc must be true when provided.',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on unsupported page prerender object metadata before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.tsx"),
      "export default function Campaign() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.config.ts"),
      'export default { render: "ssr", prerender: { revaidate: 60 } };',
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      'Page "campaign" config "./src/pages/campaign/page.config.ts" prerender has unknown field "revaidate".',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on malformed configured page modules before running the bundler", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.tsx"),
      ["export default function Campaign( {"].join("\n"),
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow("Page-anchor route module could not be parsed:");
    expect(events).not.toContain("bundler.build");
  });

  it("fails on malformed PPR region modules before running the bundler", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.tsx"),
      [
        'import * as React from "react";',
        'const OfferRegion = React.lazy(() => import("./Offer.region"));',
        "export default function Page() {",
        "  return <React.Suspense fallback={null}><OfferRegion /></React.Suspense>;",
        "}",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.config.ts"),
      'export default { render: "ssr", hydrate: "none", prerender: { partial: true } };',
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/campaign/Offer.region.tsx"),
      [
        "export const cache = { revalidate: 30 };",
        "export default function Offer( {",
      ].join("\n"),
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow("PPR region metadata could not be parsed:");
    expect(events).not.toContain("bundler.build");
  });

  it("builds server-rendered pages in flat output mode", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.tsx"),
      "export default function Campaign() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/campaign/page.config.ts"),
      'export default { render: "ssr", hydrate: "none", prerender: true };',
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa" },
      },
      {
        cwd,
        bundler,
      },
    );
    expect(events).toContain("bundler.build");
    expect(fs.existsSync(path.join(cwd, "dist/deployment-metadata.json"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(cwd, "dist/manifest.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "dist/runtime.json"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "dist/server/manifest.json"))).toBe(
      false,
    );
  });

  it("fails on invalid explicit Application route declarations before running the bundler", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          application: {
            routes: [{ path: "/", page: "" }],
          },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      "[evjs] application.routes[0].page must be a non-empty string.",
    );
    expect(events).not.toContain("bundler.build");

    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/dashboard/page.tsx"),
      "export default function Dashboard() { return null; }",
      "utf-8",
    );

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          application: {
            routes: [
              { path: "/dashboard", page: "home" },
              { path: "/dashboard", page: "dashboard" },
            ],
          },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow('page route "/dashboard" conflicts with sibling');
    expect(events).not.toContain("bundler.build");
  });

  it("fails on invalid routing declarations before running the bundler", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: {
            mode: "spa",
            unknown: true,
          } as never,
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow("[evjs] routing.unknown is not supported.");
    expect(events).not.toContain("bundler.build");
  });

  it("fails on invalid server path declarations before running the bundler", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          server: {
            basePath: "api",
          },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow('[evjs] server.basePath must start with "/".');
    expect(events).not.toContain("bundler.build");
  });

  it("discovers default server routes and middleware conventions", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/apis/api"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/middleware.ts"),
      [
        "export default async function middleware(_ctx, next) {",
        "  await next();",
        "}",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/apis/api/middleware.ts"),
      [
        "export default async function middleware(_ctx, next) {",
        "  await next();",
        "}",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/apis/api/health/api.ts"),
      "export const GET = async () => Response.json({ ok: true });",
      "utf-8",
    );

    let observedPlan: BuildPlan | undefined;
    const events: string[] = [];
    const bundler = createMockBundler(events, {
      onBuildPlan(plan) {
        observedPlan = plan;
      },
    });

    await build({}, { cwd, bundler });

    expect(events).toContain("bundler.build");
    expect(observedPlan?.entries).toContainEqual(
      expect.objectContaining({
        name: "server",
        import: "./.ev/entries/server.ts",
        metadata: {
          type: "server-app",
          middlewares: [
            {
              id: "src/middleware.ts:global-middleware",
              module: "src/middleware.ts",
              scope: "global",
              scopeSegments: [],
            },
          ],
          routes: [
            {
              id: "src/apis/api/health/api.ts:/api/health:GET",
              module: "src/apis/api/health/api.ts",
              path: "/api/health",
              methods: ["GET"],
              moduleSegments: ["api", "health"],
              middlewares: [
                {
                  id: "src/apis/api/middleware.ts:route-middleware",
                  module: "src/apis/api/middleware.ts",
                  scope: "route",
                  scopeSegments: ["api"],
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it("fails on invalid default api anchors before running the bundler", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/apis/users/api.ts"),
      "export const get = async () => Response.json({ ok: true });",
      "utf-8",
    );
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(build({}, { cwd, bundler })).rejects.toThrow(
      [
        "[evjs] Server route discovery failed.",
        "src/apis/users/api.ts - api.ts, api.tsx, api.js, or api.jsx anchor modules must export at least one uppercase HTTP method such as GET or POST.",
        'src/apis/users/api.ts - Server route module exports lowercase method "get". Use uppercase "GET".',
      ].join("\n"),
    );
    expect(events).not.toContain("bundler.build");
  });

  it("does not fall back to src/server/routes for server file routes", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/apis"), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(cwd, "src/server/routes"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/server/routes/health.ts"),
      "export const GET = async () => Response.json({ ok: true });",
      "utf-8",
    );
    const events: string[] = [];
    let observedPlan: BuildPlan | undefined;
    const bundler = createMockBundler(events, {
      onBuildPlan(plan) {
        observedPlan = plan;
      },
    });

    await build({}, { cwd, bundler });

    expect(events).toContain("bundler.build");
    expect(observedPlan?.entries).not.toContainEqual(
      expect.objectContaining({ name: "server" }),
    );
  });

  it("does not fall back to src/server/middleware for global server middleware", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/apis"), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(cwd, "src/server"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/server/middleware.ts"),
      [
        "export default async function middleware(_ctx, next) {",
        "  await next();",
        "}",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/apis/health/api.ts"),
      "export const GET = async () => Response.json({ ok: true });",
      "utf-8",
    );

    let observedPlan: BuildPlan | undefined;
    const events: string[] = [];
    const bundler = createMockBundler(events, {
      onBuildPlan(plan) {
        observedPlan = plan;
      },
    });

    await build({}, { cwd, bundler });

    expect(events).toContain("bundler.build");
    const serverEntry = observedPlan?.entries.find(
      (entry) => entry.name === "server",
    );
    expect(serverEntry?.metadata).toEqual(
      expect.objectContaining({
        type: "server-app",
        routes: [expect.objectContaining({ module: "src/apis/health/api.ts" })],
      }),
    );
    expect(serverEntry?.metadata).not.toHaveProperty("middlewares");
  });

  it("fails on an unknown server config field before running the bundler", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          server: {
            // @ts-expect-error runtime config loading can still produce unknown keys.
            unknown: true,
          },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow("[evjs] server.unknown is not supported");
    expect(events).not.toContain("bundler.build");
  });

  it("fails on invalid dev port declarations before running the bundler", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          dev: {
            port: 70000,
          },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      "[evjs] dev.port must be an integer TCP port from 1 to 65535.",
    );
    expect(events).not.toContain("bundler.build");
  });

  it("builds reachable use-server modules in flat output mode", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      [
        'import { getUser } from "../api/user.server";',
        "void getUser;",
        "export default function Page() { return null; }",
      ].join("\n"),
      "utf-8",
    );
    await fs.promises.mkdir(path.join(cwd, "src/api"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/api/user.server.ts"),
      [
        '"use server";',
        "export async function getUser() {",
        "  return { id: '1' };",
        "}",
      ].join("\n"),
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      {
        cwd,
        bundler,
      },
    );
    expect(events).toContain("bundler.build");
  });

  it("builds reachable use-server modules with long headers in flat output mode", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      [
        'import { getUser } from "../api/user.server";',
        "void getUser;",
        "export default function Page() { return null; }",
      ].join("\n"),
      "utf-8",
    );
    await fs.promises.mkdir(path.join(cwd, "src/api"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/api/user.server.ts"),
      [
        `/* ${"license ".repeat(80)} */`,
        '"use server";',
        "export async function getUser() {",
        "  return { id: '1' };",
        "}",
      ].join("\n"),
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      {
        cwd,
        bundler,
      },
    );
    expect(events).toContain("bundler.build");
  });

  it("fails on unsupported use-server exports before running the bundler", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      [
        'import getUser from "../api/user.server";',
        "void getUser;",
        "export default function Page() { return null; }",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/api/user.server.ts"),
      [
        '"use server";',
        "export default async function getUser() {",
        "  return { id: '1' };",
        "}",
      ].join("\n"),
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        { routing: { mode: "spa" } },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      '"use server" modules cannot default-export server functions. Export a named function instead.',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on malformed use-server modules before running the bundler", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      [
        'import { getUser } from "../api/user.server";',
        "void getUser;",
        "export default function Page() { return null; }",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/api/user.server.ts"),
      ['"use server";', "export async function getUser( {"].join("\n"),
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        { routing: { mode: "spa" } },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      "src/api/user.server.ts - Server function module could not be parsed:",
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails on use-server runtime re-exports before running the bundler", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      [
        'import { saveUser } from "../api/user.server";',
        "void saveUser;",
        "export default function Page() { return null; }",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/api/user.server.ts"),
      ['"use server";', 'export { saveUser } from "./user-impl";'].join("\n"),
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/api/user-impl.ts"),
      [
        "export async function saveUser() {",
        "  return { ok: true };",
        "}",
      ].join("\n"),
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        { routing: { mode: "spa" } },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      'src/api/user.server.ts - "use server" modules cannot re-export server functions from another module. Export functions from the defining module.',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails when a page route has no default export", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export const title = 'Home';",
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow(
      "page.* anchor modules must default-export a React component. Rename ordinary modules so only route anchors use the page.* basename.",
    );
    expect(events).not.toContain("bundler.build");
  });

  it("fails when a page route cannot be parsed", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home( {",
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).rejects.toThrow("Page-anchor route module could not be parsed:");
    expect(events).not.toContain("bundler.build");
  });

  it("builds with a root layout in the routing root", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/layout.tsx"),
      "export default function Layout() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).resolves.toBeUndefined();
    expect(events).toContain("bundler.build");
  });

  it("builds when a nested layout is placed in the page route directory", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/posts"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/posts/layout.tsx"),
      "export default function PostsLayout() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/posts/$postId/page.tsx"),
      "export default function Post() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        {
          cwd,
          bundler,
        },
      ),
    ).resolves.toBeUndefined();
    expect(events).toContain("bundler.build");
  });

  it("orders plugin config and lifecycle hooks by dependencies", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const pluginA: Plugin<Record<string, never>> = {
      name: "plugin-a",
      config(config) {
        events.push("config:a");
        return config;
      },
      setup() {
        events.push("setup:a");
        return {
          buildStart() {
            events.push("buildStart:a");
          },
          buildEnd() {
            events.push("buildEnd:a");
          },
        };
      },
    };
    const pluginB: Plugin<Record<string, never>> = {
      name: "plugin-b",
      dependencies: ["plugin-a"],
      config(config) {
        events.push("config:b");
        return config;
      },
      setup() {
        events.push("setup:b");
        return {
          buildStart() {
            events.push("buildStart:b");
          },
          buildEnd() {
            events.push("buildEnd:b");
          },
        };
      },
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [pluginB, pluginA],
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "config:a",
      "config:b",
      "setup:a",
      "setup:b",
      "buildStart:a",
      "buildStart:b",
      "bundler.build",
      "bundler.entries:",
      "buildEnd:a",
      "buildEnd:b",
    ]);
  });

  it("preserves user order for plugins unrelated to a dependency", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    function plugin(
      name: string,
      dependencies?: string[],
    ): Plugin<Record<string, never>> {
      return {
        name,
        dependencies,
        setup() {
          events.push(`setup:${name}`);
        },
      };
    }

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [
          plugin("plugin-a", ["plugin-c"]),
          plugin("plugin-b"),
          plugin("plugin-c"),
        ],
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "setup:plugin-b",
      "setup:plugin-c",
      "setup:plugin-a",
      "bundler.build",
      "bundler.entries:",
    ]);
  });

  it("orders unrelated plugins by enforce tier", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [
          {
            name: "post",
            enforce: "post",
            setup() {
              events.push("setup:post");
            },
          },
          {
            name: "normal",
            setup() {
              events.push("setup:normal");
            },
          },
          {
            name: "pre",
            enforce: "pre",
            setup() {
              events.push("setup:pre");
            },
          },
        ],
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "setup:pre",
      "setup:normal",
      "setup:post",
      "bundler.build",
      "bundler.entries:",
    ]);
  });

  it("orders plugins by optional dependencies when they are present", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    function plugin(
      name: string,
      options: Pick<
        Plugin<Record<string, never>>,
        "dependencies" | "optionalDependencies"
      > = {},
    ): Plugin<Record<string, never>> {
      return {
        name,
        ...options,
        setup() {
          events.push(`setup:${name}`);
        },
      };
    }

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [
          plugin("plugin-b", {
            dependencies: ["plugin-c"],
            optionalDependencies: ["plugin-a"],
          }),
          plugin("plugin-c"),
          plugin("plugin-a"),
        ],
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "setup:plugin-c",
      "setup:plugin-a",
      "setup:plugin-b",
      "bundler.build",
      "bundler.entries:",
    ]);
  });

  it("ignores optional dependencies when they are missing", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [
          {
            name: "plugin-b",
            dependencies: ["plugin-c"],
            optionalDependencies: ["plugin-a"],
            setup() {
              events.push("setup:plugin-b");
            },
          },
          {
            name: "plugin-c",
            setup() {
              events.push("setup:plugin-c");
            },
          },
        ],
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "setup:plugin-c",
      "setup:plugin-b",
      "bundler.build",
      "bundler.entries:",
    ]);
  });

  it("throws when a plugin dependency is missing", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [{ name: "plugin-b", dependencies: ["plugin-a"] }],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow('Plugin "plugin-b" depends on missing plugin "plugin-a"');
  });

  it("throws on circular plugin dependencies", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [
            { name: "plugin-a", dependencies: ["plugin-b"] },
            { name: "plugin-b", dependencies: ["plugin-a"] },
          ],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow(
      "Circular plugin dependency detected: plugin-a -> plugin-b -> plugin-a",
    );
  });

  it("throws when optional dependencies create a cycle", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [
            { name: "plugin-a", optionalDependencies: ["plugin-b"] },
            { name: "plugin-b", dependencies: ["plugin-a"] },
          ],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow(
      "Circular plugin dependency detected: plugin-a -> plugin-b -> plugin-a",
    );
  });

  it("throws on duplicate plugin names", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [{ name: "plugin-a" }, { name: "plugin-a" }],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow('Duplicate plugin name "plugin-a"');
  });

  it("fails on invalid plugin declarations before config hooks and bundling", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [
            {
              name: "",
              config(config) {
                events.push("config");
                return config;
              },
            },
          ],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow("[evjs] plugins[0].name must be a non-empty string.");

    expect(events).toEqual([]);
  });
});

describe("dev", () => {
  it("rejects a duplicate dev run before starting a second bundler", async () => {
    const cwd = await createProject();
    let starts = 0;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        starts++;
        markStarted?.();
      },
    };

    const firstRun = dev(
      { output: { client: "dist/client", server: "dist/server" } },
      { cwd, bundler },
    );
    await started;

    await expect(
      dev(
        { output: { client: "dist/client", server: "dist/server" } },
        { cwd, bundler },
      ),
    ).rejects.toThrow("Dev is already running");
    expect(starts).toBe(1);

    process.emit("SIGINT");
    await firstRun;
  });

  it("passes coordinated replacement ports to the bundler when a requested port is occupied", async () => {
    const cwd = await createProject();
    const occupiedServer = createServer();
    occupiedServer.unref();
    await new Promise<void>((resolve, reject) => {
      occupiedServer.once("error", reject);
      occupiedServer.listen(0, resolve);
    });
    const address = occupiedServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP server address.");
    }

    let receivedPorts: { client: number; server: number } | undefined;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ config }) {
        receivedPorts = {
          client: config.dev.port,
          server: config.server.dev.port,
        };
        process.emit("SIGINT");
      },
    };

    try {
      await dev(
        {
          output: { client: "dist/client", server: "dist/server" },
          dev: { port: address.port },
          server: { dev: { port: address.port } },
        },
        { cwd, bundler },
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        occupiedServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    expect(receivedPorts?.client).not.toBe(address.port);
    expect(receivedPorts?.server).not.toBe(address.port);
    expect(receivedPorts?.client).not.toBe(receivedPorts?.server);
  });

  it("rejects invalid option bundler adapters before startup", async () => {
    const cwd = await createProject();

    await expect(
      dev(
        { output: { client: "dist/client", server: "dist/server" } },
        {
          cwd,
          bundler: {
            name: "custom",
            capabilities: fullBundlerCapabilities,
            build: "run" as never,
            dev: async () => {},
          } as never,
        },
      ),
    ).rejects.toThrow("[evjs] options.bundler.build must be a function.");
  });

  it("disposes plugins when dev initialization fails", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      dev(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [
            {
              name: "failing-start",
              setup() {
                return {
                  buildStart() {
                    throw new Error("start blocked");
                  },
                  dispose() {
                    events.push("dispose");
                  },
                };
              },
            },
          ],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow("start blocked");

    expect(events).toEqual(["dispose"]);
  });

  it("continues dev cleanup when the bundler close hook fails", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        process.emit("SIGINT");
        return createTestDevController({
          async updatePlan() {},
          close() {
            events.push("bundler.close");
            throw new Error("close blocked");
          },
        });
      },
    };

    await expect(
      dev(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [
            {
              name: "cleanup",
              setup() {
                return {
                  dispose() {
                    events.push("dispose");
                  },
                };
              },
            },
          ],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow("close blocked");

    expect(events).toEqual(["bundler.dev", "bundler.close", "dispose"]);
  });

  it("terminates and cleans up dev after an asynchronous dependency watcher failure", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const watchers: Array<
      EventEmitter & {
        close: ReturnType<typeof vi.fn>;
        ref(): fs.FSWatcher;
        unref(): fs.FSWatcher;
      }
    > = [];
    let markWatcherOpened: (() => void) | undefined;
    const watcherOpened = new Promise<void>((resolve) => {
      markWatcherOpened = resolve;
    });
    const watchSpy = vi.spyOn(fs, "watch").mockImplementation((() => {
      const watcher = new EventEmitter() as (typeof watchers)[number];
      watcher.close = vi.fn();
      watcher.ref = () => watcher as fs.FSWatcher;
      watcher.unref = () => watcher as fs.FSWatcher;
      watchers.push(watcher);
      markWatcherOpened?.();
      return watcher;
    }) as never);
    const resourceError = Object.assign(new Error("watcher access denied"), {
      code: "EACCES",
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan() {},
          close() {
            events.push("bundler.close");
          },
        });
      },
    };
    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [
          {
            name: "watcher-cleanup",
            setup() {
              return {
                dispose() {
                  events.push("dispose");
                },
              };
            },
          },
        ],
      },
      { cwd, bundler },
    );
    let settled = false;
    const outcome = running.then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      await watcherOpened;
      watchers[0]?.emit("error", resourceError);
      const failure = await Promise.race([
        outcome,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("watcher failure cleanup timed out")),
            2_000,
          );
        }),
      ]);

      expect(failure).toMatchObject({
        cause: resourceError,
        code: "EACCES",
      });
      expect(String(failure)).toContain(
        "[evjs] Development dependency watcher failed for",
      );
      expect(watchers.length).toBeGreaterThan(0);
      for (const watcher of watchers) {
        expect(watcher.close).toHaveBeenCalledTimes(1);
      }
      expect(events).toEqual(["bundler.dev", "bundler.close", "dispose"]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      watchSpy.mockRestore();
    }

    await dev(
      { output: { client: "dist/client", server: "dist/server" } },
      {
        cwd,
        bundler: {
          name: "retry",
          capabilities: fullBundlerCapabilities,
          async build() {
            return {};
          },
          async dev() {
            process.emit("SIGINT");
          },
        },
      },
    );
  });

  it("fails closed when a late plugin watch registration cannot be inspected", async () => {
    const cwd = await createSpaProject();
    const forbiddenPath = path.join(cwd, "forbidden-watch.txt");
    const events: string[] = [];
    const watchRecords: Array<{
      listener: (
        eventType: fs.WatchEventType,
        filename: string | Buffer | null,
      ) => void;
      target: string;
      watcher: EventEmitter & {
        close: ReturnType<typeof vi.fn>;
        ref(): fs.FSWatcher;
        unref(): fs.FSWatcher;
      };
    }> = [];
    const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
      ...args: unknown[]
    ) => {
      const watcher =
        new EventEmitter() as (typeof watchRecords)[number]["watcher"];
      watcher.close = vi.fn();
      watcher.ref = () => watcher as fs.FSWatcher;
      watcher.unref = () => watcher as fs.FSWatcher;
      watchRecords.push({
        listener: args.at(-1) as (typeof watchRecords)[number]["listener"],
        target: path.resolve(String(args[0])),
        watcher,
      });
      return watcher;
    }) as never);
    let contributionCalls = 0;
    const plugin: Plugin<Record<string, never>> = {
      name: "late-watch-registration-failure",
      contributions(ctx) {
        contributionCalls += 1;
        if (contributionCalls > 1) ctx.addWatchFile(forbiddenPath);
      },
      setup() {
        return {
          dispose() {
            events.push("dispose");
          },
        };
      },
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "late-watch-registration-failure",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan() {},
          close() {
            events.push("bundler.close");
          },
        });
      },
    };
    const running = dev(
      {
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      { cwd, bundler },
    );
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    const originalLstat = fs.lstatSync;
    let lstatSpy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await waitForEvent(events, "bundler.dev");
      lstatSpy = vi.spyOn(fs, "lstatSync").mockImplementation(((
        target: fs.PathLike,
        ...args: unknown[]
      ) => {
        if (path.resolve(String(target)) === forbiddenPath) {
          throw Object.assign(new Error("watch dependency access denied"), {
            code: "EACCES",
          });
        }
        return Reflect.apply(originalLstat, fs, [target, ...args]);
      }) as typeof fs.lstatSync);
      await vi.waitFor(() =>
        expect(
          watchRecords.some(
            (record) => record.target === path.join(cwd, "src/pages"),
          ),
        ).toBe(true),
      );
      const pageWatcher = watchRecords.find(
        (record) => record.target === path.join(cwd, "src/pages"),
      );
      if (!pageWatcher) throw new Error("Expected the Page watcher to start.");
      pageWatcher.listener("change", "page.tsx");

      await expect(
        Promise.race([
          running,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () => reject(new Error("late watch registration did not fail")),
              devUpdateTimeoutMs,
            ),
          ),
        ]),
      ).rejects.toMatchObject({ code: "EACCES" });
      expect(events).toEqual(["bundler.dev", "bundler.close", "dispose"]);
    } finally {
      lstatSpy?.mockRestore();
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      watchSpy.mockRestore();
    }
  });

  it("falls back to polling when dependency event watchers exhaust resources", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    let markPollingReady: (() => void) | undefined;
    const pollingReady = new Promise<void>((resolve) => {
      markPollingReady = resolve;
    });
    const watchSpy = vi.spyOn(fs, "watch").mockImplementation((() => {
      markPollingReady?.();
      throw Object.assign(new Error("event watcher capacity exhausted"), {
        code: "EMFILE",
      });
    }) as never);
    const bundler = createRouteUpdateBundler(cwd, events, "/admin");
    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      { cwd, bundler },
    );
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      await waitForEvent(events, "initial:/");
      await pollingReady;
      await writeFile(
        path.join(cwd, "src/pages/admin/page.tsx"),
        "export default function Admin() { return null; }",
        "utf-8",
      );
      await Promise.race([
        running,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("polling route update timed out")),
            devUpdateTimeoutMs,
          );
        }),
      ]);
      expect(watchSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      watchSpy.mockRestore();
    }

    expect(events).toEqual(["initial:/", "changed:/,/admin", "types:true"]);
  });

  it("reconciles route edits made while the bundler dev server starts", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    let markBundlerStarted: (() => void) | undefined;
    const bundlerStarted = new Promise<void>((resolve) => {
      markBundlerStarted = resolve;
    });
    let releaseBundler: (() => void) | undefined;
    const bundlerGate = new Promise<void>((resolve) => {
      releaseBundler = resolve;
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "startup-route-reconciliation",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        markBundlerStarted?.();
        await bundlerGate;
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            const appEntry = update.next.entries.find(
              (entry) => entry.metadata?.type === "pages-app",
            );
            const routes =
              appEntry?.metadata?.type === "pages-app"
                ? appEntry.metadata.routes.map((route) => route.path)
                : [];
            events.push(`update:${options?.configChanged}:${routes.join(",")}`);
            process.emit("SIGINT");
          },
        });
      },
    };
    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      { cwd, bundler },
    );
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await bundlerStarted;
      await writeFile(
        path.join(cwd, "src/pages/admin/page.tsx"),
        "export default function Admin() { return null; }",
        "utf-8",
      );
      releaseBundler?.();
      await Promise.race([
        running,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("startup route reconciliation timed out")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);
    } finally {
      releaseBundler?.();
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
    }

    expect(events).toEqual(["bundler.dev", "update:false:/,/admin"]);
  });

  it.each([
    { changed: false, label: "does not invalidate an unchanged dependency" },
    { changed: true, label: "invalidates a dependency changed during startup" },
  ])("$label after the bundler registers it", async ({ changed }) => {
    const cwd = await createSpaProject();
    const dependency = path.join(cwd, "bundler.config.json");
    await writeFile(dependency, "initial", "utf-8");
    const events: string[] = [];
    let markRegistered: (() => void) | undefined;
    const registered = new Promise<void>((resolve) => {
      markRegistered = resolve;
    });
    let releaseBundler: (() => void) | undefined;
    const bundlerGate = new Promise<void>((resolve) => {
      releaseBundler = resolve;
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "startup-bundler-watch-reconciliation",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile }) {
        addWatchFile?.(dependency);
        events.push("registered");
        markRegistered?.();
        await bundlerGate;
        return createTestDevController({
          async updatePlan(_update, options) {
            options.activate();
            events.push(`update:${options?.configChanged}`);
            process.emit("SIGINT");
          },
        });
      },
    };
    const running = dev(
      { output: { client: "dist/client", server: "dist/server" } },
      { cwd, bundler },
    );
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await registered;
      if (changed) {
        await fs.promises.writeFile(dependency, "changed", "utf-8");
      }
      releaseBundler?.();
      if (changed) {
        await Promise.race([
          running,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "startup bundler dependency reconciliation timed out",
                  ),
                ),
              devUpdateTimeoutMs,
            ),
          ),
        ]);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 300));
        process.emit("SIGINT");
        await running;
      }
    } finally {
      releaseBundler?.();
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
    }

    expect(events).toEqual(
      changed ? ["registered", "update:true"] : ["registered"],
    );
  });

  it(
    "reconciles a plugin watch file changed while the bundler dev server starts",
    async () => {
      const cwd = await createSpaProject();
      const pluginDataPath = path.join(cwd, "plugin-data.json");
      await writeFile(pluginDataPath, "initial", "utf-8");
      const events: string[] = [];
      let setupCalls = 0;
      let loadConfigCalls = 0;
      const plugin: Plugin<Record<string, never>> = {
        name: "startup-plugin-watch-reconciliation",
        setup(ctx) {
          setupCalls += 1;
          ctx.addWatchFile(pluginDataPath);
        },
        contributions(ctx) {
          const value = fs.readFileSync(pluginDataPath, "utf-8");
          events.push(`contribution:${value}`);
          ctx.emit.data({
            id: "startup-plugin-watch-data",
            scope: { kind: "application" },
            value,
          });
        },
      };
      const bundler: BundlerAdapter<Record<string, never>> = {
        name: "startup-plugin-watch-reconciliation",
        capabilities: fullBundlerCapabilities,
        async build() {
          return {};
        },
        async dev() {
          events.push("bundler.dev");
          await writeFile(pluginDataPath, "changed-during-startup", "utf-8");
          return createTestDevController({
            async updatePlan(_update, options) {
              options.activate();
              events.push(`update:${options?.configChanged}`);
              process.emit("SIGINT");
            },
          });
        },
      };
      const config: Config<Record<string, never>> = {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      };

      const running = dev(config, {
        cwd,
        bundler,
        loadConfig() {
          loadConfigCalls += 1;
          return config;
        },
      });
      let settled = false;
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;

      try {
        await Promise.race([
          running,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    "startup plugin dependency reconciliation timed out",
                  ),
                ),
              devUpdateTimeoutMs,
            );
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
        if (!settled) {
          process.emit("SIGINT");
          await running.catch(() => {});
        }
      }

      expect(setupCalls).toBe(1);
      expect(loadConfigCalls).toBe(0);
      expect(events).toEqual([
        "contribution:initial",
        "bundler.dev",
        "contribution:changed-during-startup",
        "update:false",
      ]);
    },
    devUpdateTimeoutMs + 1_000,
  );

  it(
    "reconciles a Page added while initial plugin contributions are paused",
    async () => {
      const cwd = await createSpaProject();
      const nestedPageDirectory = path.join(cwd, "src/pages/catalog/details");
      await fs.promises.mkdir(nestedPageDirectory, { recursive: true });
      const events: string[] = [];
      let markInitialContributionStarted: (() => void) | undefined;
      const initialContributionStarted = new Promise<void>((resolve) => {
        markInitialContributionStarted = resolve;
      });
      let releaseInitialContribution: (() => void) | undefined;
      const initialContributionGate = new Promise<void>((resolve) => {
        releaseInitialContribution = resolve;
      });
      let contributionCalls = 0;
      let loadConfigCalls = 0;
      const plugin: Plugin<Record<string, never>> = {
        name: "startup-paused-plugin-contributions",
        async contributions(ctx) {
          contributionCalls += 1;
          events.push(`contribution:${contributionCalls}`);
          if (contributionCalls === 1) {
            markInitialContributionStarted?.();
            await initialContributionGate;
          }
          ctx.emit.data({
            id: "startup-paused-plugin-data",
            scope: { kind: "application" },
            value: contributionCalls,
          });
        },
      };
      const config: Config<Record<string, never>> = {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      };
      const bundler: BundlerAdapter<Record<string, never>> = {
        name: "startup-paused-plugin-contributions",
        capabilities: fullBundlerCapabilities,
        async build() {
          return {};
        },
        async dev() {
          events.push("bundler.dev");
          return createTestDevController({
            async updatePlan(update, options) {
              options.activate();
              const appEntry = update.next.entries.find(
                (entry) => entry.metadata?.type === "pages-app",
              );
              const routes =
                appEntry?.metadata?.type === "pages-app"
                  ? appEntry.metadata.routes.map((route) => route.path)
                  : [];
              events.push(
                `update:${options?.configChanged}:${routes.join(",")}`,
              );
              process.emit("SIGINT");
            },
          });
        },
      };
      const running = dev(config, {
        cwd,
        bundler,
        loadConfig() {
          loadConfigCalls += 1;
          return config;
        },
      });
      let settled = false;
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      try {
        await initialContributionStarted;
        await writeFile(
          path.join(nestedPageDirectory, "page.tsx"),
          "export default function Details() { return null; }",
          "utf-8",
        );
        releaseInitialContribution?.();
        await Promise.race([
          running,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () => reject(new Error("startup Page reconciliation timed out")),
              devUpdateTimeoutMs,
            ),
          ),
        ]);
      } finally {
        releaseInitialContribution?.();
        if (!settled) {
          process.emit("SIGINT");
          await running.catch(() => {});
        }
      }

      expect(loadConfigCalls).toBe(0);
      expect(events).toEqual([
        "contribution:1",
        "bundler.dev",
        "contribution:2",
        "update:false:/,/catalog/details",
      ]);
    },
    devUpdateTimeoutMs + 1_000,
  );

  it(
    "reconciles an analysis dependency changed while initial plugin contributions are paused",
    async () => {
      const cwd = await createSpaProject();
      const dependency = path.join(cwd, "framework-extra.json");
      await writeFile(dependency, "initial", "utf-8");
      const events: string[] = [];
      let markInitialContributionStarted: (() => void) | undefined;
      const initialContributionStarted = new Promise<void>((resolve) => {
        markInitialContributionStarted = resolve;
      });
      let releaseInitialContribution: (() => void) | undefined;
      const initialContributionGate = new Promise<void>((resolve) => {
        releaseInitialContribution = resolve;
      });
      let contributionCalls = 0;
      let loadConfigCalls = 0;
      const plugin: Plugin<Record<string, never>> = {
        name: "startup-analysis-dependency-reconciliation",
        setup(ctx) {
          if (!ctx.config.routing) {
            throw new Error("Expected canonical Page routing to be resolved.");
          }
          Object.assign(ctx.config.routing, { dependencies: [dependency] });
        },
        async contributions(ctx) {
          contributionCalls += 1;
          const value = fs.readFileSync(dependency, "utf-8");
          events.push(`contribution:${contributionCalls}:${value}`);
          if (contributionCalls === 1) {
            markInitialContributionStarted?.();
            await initialContributionGate;
          }
          ctx.emit.data({
            id: "startup-analysis-dependency-data",
            scope: { kind: "application" },
            value,
          });
        },
      };
      const config: Config<Record<string, never>> = {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      };
      const bundler: BundlerAdapter<Record<string, never>> = {
        name: "startup-analysis-dependency-reconciliation",
        capabilities: fullBundlerCapabilities,
        async build() {
          return {};
        },
        async dev() {
          events.push("bundler.dev");
          return createTestDevController({
            async updatePlan(_update, options) {
              options.activate();
              events.push(`update:${options?.configChanged}`);
              process.emit("SIGINT");
            },
          });
        },
      };
      const running = dev(config, {
        cwd,
        bundler,
        loadConfig() {
          loadConfigCalls += 1;
          return config;
        },
      });
      let settled = false;
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      try {
        await initialContributionStarted;
        await writeFile(dependency, "changed-during-startup", "utf-8");
        releaseInitialContribution?.();
        await Promise.race([
          running,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "startup analysis dependency reconciliation timed out",
                  ),
                ),
              devUpdateTimeoutMs,
            ),
          ),
        ]);
      } finally {
        releaseInitialContribution?.();
        if (!settled) {
          process.emit("SIGINT");
          await running.catch(() => {});
        }
      }

      expect(loadConfigCalls).toBe(0);
      expect(events).toEqual([
        "contribution:1:initial",
        "bundler.dev",
        "contribution:2:changed-during-startup",
        "update:false",
      ]);
    },
    devUpdateTimeoutMs + 1_000,
  );

  it(
    "reconciles a first-discovered source changed between its read and analysis snapshot",
    async () => {
      const cwd = await createSpaProject();
      const dependency = path.join(cwd, "src/actions.server.ts");
      await writeFile(
        path.join(cwd, "src/pages/page.tsx"),
        [
          'import { saveInitial } from "../actions.server";',
          "void saveInitial;",
          "export default function Page() { return null; }",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        dependency,
        [
          '"use server";',
          "export async function saveInitial() { return 'initial'; }",
        ].join("\n"),
        "utf-8",
      );

      const changedSource = [
        '"use server";',
        "export async function saveChanged() { return 'changed'; }",
      ].join("\n");
      const originalReadFile = fsPromises.readFile.bind(fsPromises);
      let replacedDuringRead = false;
      const readFileSpy = vi
        .spyOn(fsPromises, "readFile")
        .mockImplementation((async (
          ...args: Parameters<typeof fsPromises.readFile>
        ) => {
          const source = await originalReadFile(...args);
          if (
            !replacedDuringRead &&
            path.resolve(String(args[0])) === dependency
          ) {
            replacedDuringRead = true;
            await fs.promises.writeFile(dependency, changedSource, "utf-8");
          }
          return source;
        }) as typeof fsPromises.readFile);

      const events: string[] = [];
      let loadConfigCalls = 0;
      const config: Config<Record<string, never>> = {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      };
      const bundler: BundlerAdapter<Record<string, never>> = {
        name: "source-read-reconciliation",
        capabilities: fullBundlerCapabilities,
        async build() {
          return {};
        },
        async dev() {
          events.push("bundler.dev");
          return createTestDevController({
            async updatePlan(update, options) {
              options.activate();
              const serverEntry = update.next.entries.find(
                (entry) => entry.metadata?.type === "server-app",
              );
              const serverFunctions =
                serverEntry?.metadata?.type === "server-app"
                  ? (serverEntry.metadata.serverFunctions ?? []).map(
                      (serverFunction) => serverFunction.exportName,
                    )
                  : [];
              events.push(
                `update:${options?.configChanged}:${serverFunctions.join(",")}`,
              );
              process.emit("SIGINT");
            },
          });
        },
      };
      const running = dev(config, {
        cwd,
        bundler,
        loadConfig() {
          loadConfigCalls += 1;
          return config;
        },
      });
      let settled = false;
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      try {
        await Promise.race([
          running,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () => reject(new Error("source read reconciliation timed out")),
              devUpdateTimeoutMs,
            ),
          ),
        ]);
      } finally {
        readFileSpy.mockRestore();
        if (!settled) {
          process.emit("SIGINT");
          await running.catch(() => {});
        }
      }

      expect(replacedDuringRead).toBe(true);
      expect(loadConfigCalls).toBe(0);
      expect(events).toEqual(["bundler.dev", "update:false:saveChanged"]);
    },
    devUpdateTimeoutMs + 1_000,
  );

  it(
    "reconciles a newly discovered source changed before route watcher handoff",
    async () => {
      const cwd = await createSpaProject();
      const dependency = path.join(cwd, "src/actions.server.ts");
      await writeFile(
        dependency,
        [
          '"use server";',
          "export async function saveInitial() { return 'initial'; }",
        ].join("\n"),
        "utf-8",
      );

      const events: string[] = [];
      type FakeDevWatcher = EventEmitter & {
        close: ReturnType<typeof vi.fn>;
        ref(): fs.FSWatcher;
        unref(): fs.FSWatcher;
      };
      const watchRecords: Array<{
        listener: (
          eventType: fs.WatchEventType,
          filename: string | Buffer | null,
        ) => void;
        target: string;
        watcher: FakeDevWatcher;
      }> = [];
      const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
        ...args: unknown[]
      ) => {
        const watcher = new EventEmitter() as FakeDevWatcher;
        watcher.close = vi.fn();
        watcher.ref = () => watcher as fs.FSWatcher;
        watcher.unref = () => watcher as fs.FSWatcher;
        watchRecords.push({
          listener: args.at(-1) as (typeof watchRecords)[number]["listener"],
          target: path.resolve(String(args[0])),
          watcher,
        });
        return watcher;
      }) as never);

      let updateCalls = 0;
      const config: Config<Record<string, never>> = {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      };
      const bundler: BundlerAdapter<Record<string, never>> = {
        name: "route-source-read-reconciliation",
        capabilities: fullBundlerCapabilities,
        async build() {
          return {};
        },
        async dev() {
          events.push("bundler.dev");
          return createTestDevController({
            async updatePlan(update, options) {
              options.activate();
              updateCalls += 1;
              const serverEntry = update.next.entries.find(
                (entry) => entry.metadata?.type === "server-app",
              );
              const serverFunctions =
                serverEntry?.metadata?.type === "server-app"
                  ? (serverEntry.metadata.serverFunctions ?? []).map(
                      (serverFunction) => serverFunction.exportName,
                    )
                  : [];
              events.push(
                `update:${updateCalls}:${options?.configChanged}:${serverFunctions.join(",")}`,
              );
              if (updateCalls === 2) process.emit("SIGINT");
            },
          });
        },
      };
      const running = dev(config, { cwd, bundler });
      let settled = false;
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      let readFileSpy: ReturnType<typeof vi.spyOn> | undefined;
      try {
        await waitForEvent(events, "bundler.dev");
        const pageRoot = path.join(cwd, "src/pages");
        await vi.waitFor(() =>
          expect(
            watchRecords.some((record) => record.target === pageRoot),
          ).toBe(true),
        );

        const changedSource = [
          '"use server";',
          "export async function saveChanged() { return 'changed'; }",
        ].join("\n");
        const originalReadFile = fsPromises.readFile.bind(fsPromises);
        let replacedDuringRead = false;
        readFileSpy = vi
          .spyOn(fsPromises, "readFile")
          .mockImplementation((async (
            ...args: Parameters<typeof fsPromises.readFile>
          ) => {
            const source = await originalReadFile(...args);
            if (
              !replacedDuringRead &&
              path.resolve(String(args[0])) === dependency
            ) {
              replacedDuringRead = true;
              await fs.promises.writeFile(dependency, changedSource, "utf-8");
            }
            return source;
          }) as typeof fsPromises.readFile);

        await writeFile(
          path.join(pageRoot, "new/page.tsx"),
          [
            'import { saveInitial } from "../../actions.server";',
            "void saveInitial;",
            "export default function NewPage() { return null; }",
          ].join("\n"),
          "utf-8",
        );
        for (const record of watchRecords) {
          record.listener(
            "rename",
            path.relative(record.target, path.join(pageRoot, "new/page.tsx")),
          );
        }

        await Promise.race([
          running,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(new Error("route source read reconciliation timed out")),
              devUpdateTimeoutMs,
            ),
          ),
        ]);
        expect(replacedDuringRead).toBe(true);
      } finally {
        readFileSpy?.mockRestore();
        watchSpy.mockRestore();
        if (!settled) {
          process.emit("SIGINT");
          await running.catch(() => {});
        }
      }

      expect(events).toEqual([
        "bundler.dev",
        "update:1:false:saveInitial",
        "update:2:false:saveChanged",
      ]);
    },
    devUpdateTimeoutMs + 1_000,
  );

  it(
    "reloads when a higher-priority extensionless source candidate is created",
    async () => {
      const cwd = await createSpaProject();
      const promotedSource = path.join(cwd, "src/priority.ts");
      await writeFile(
        path.join(cwd, "src/pages/page.tsx"),
        [
          'import { runPriority } from "../priority";',
          "void runPriority;",
          "export default function Page() { return null; }",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        path.join(cwd, "src/priority.js"),
        "export async function runPriority() { return 'js'; }",
        "utf-8",
      );

      type FakeDevWatcher = EventEmitter & {
        close: ReturnType<typeof vi.fn>;
        ref(): fs.FSWatcher;
        unref(): fs.FSWatcher;
      };
      const watchRecords: Array<{
        listener: (
          eventType: fs.WatchEventType,
          filename: string | Buffer | null,
        ) => void;
        target: string;
        watcher: FakeDevWatcher;
      }> = [];
      const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
        ...args: unknown[]
      ) => {
        const watcher = new EventEmitter() as FakeDevWatcher;
        watcher.close = vi.fn();
        watcher.ref = () => watcher as fs.FSWatcher;
        watcher.unref = () => watcher as fs.FSWatcher;
        watchRecords.push({
          listener: args.at(-1) as (typeof watchRecords)[number]["listener"],
          target: path.resolve(String(args[0])),
          watcher,
        });
        return watcher;
      }) as never);

      const events: string[] = [];
      const config: Config<Record<string, never>> = {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      };
      const bundler: BundlerAdapter<Record<string, never>> = {
        name: "extensionless-candidate-promotion",
        capabilities: fullBundlerCapabilities,
        async build() {
          return {};
        },
        async dev() {
          events.push("bundler.dev");
          return createTestDevController({
            async updatePlan(update, options) {
              options.activate();
              const serverEntry = update.next.entries.find(
                (entry) => entry.metadata?.type === "server-app",
              );
              const serverFunctions =
                serverEntry?.metadata?.type === "server-app"
                  ? (serverEntry.metadata.serverFunctions ?? []).map(
                      (serverFunction) => serverFunction.exportName,
                    )
                  : [];
              events.push(
                `update:${options.configChanged}:${serverFunctions.join(",")}`,
              );
              process.emit("SIGINT");
            },
          });
        },
      };
      const running = dev(config, { cwd, bundler });
      let settled = false;
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      try {
        await waitForEvent(events, "bundler.dev");
        const sourceRoot = path.join(cwd, "src");
        await vi.waitFor(() =>
          expect(
            watchRecords.some(
              (record) =>
                record.target === sourceRoot &&
                record.watcher.close.mock.calls.length === 0,
            ),
          ).toBe(true),
        );

        await writeFile(
          promotedSource,
          [
            '"use server";',
            "export async function runPriority() { return 'ts'; }",
          ].join("\n"),
          "utf-8",
        );
        for (const record of watchRecords) {
          if (
            record.target === sourceRoot &&
            record.watcher.close.mock.calls.length === 0
          ) {
            record.listener("rename", path.basename(promotedSource));
          }
        }

        await Promise.race([
          running,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error("extensionless candidate promotion timed out"),
                ),
              devUpdateTimeoutMs,
            ),
          ),
        ]);
      } finally {
        watchSpy.mockRestore();
        if (!settled) {
          process.emit("SIGINT");
          await running.catch(() => {});
        }
      }

      expect(events).toEqual(["bundler.dev", "update:false:runPriority"]);
    },
    devUpdateTimeoutMs + 1_000,
  );

  it("does not inspect disabled file-convention route roots during startup", async () => {
    const cwd = await createProject();
    const pageRoot = path.join(cwd, "src/pages");
    const apiRoot = path.join(cwd, "src/apis");
    await fs.promises.mkdir(pageRoot, { recursive: true });
    await fs.promises.mkdir(apiRoot, { recursive: true });
    const disabledRoots = new Set([pageRoot, apiRoot]);
    const originalReaddir = fs.promises.readdir;
    const readdirSpy = vi.spyOn(fs.promises, "readdir").mockImplementation(((
      ...args: unknown[]
    ) => {
      const target = path.resolve(String(args[0]));
      if (disabledRoots.has(target)) {
        return Promise.reject(
          Object.assign(new Error("disabled route root is inaccessible"), {
            code: "EACCES",
          }),
        );
      }
      return Reflect.apply(originalReaddir, fs.promises, args);
    }) as typeof fs.promises.readdir);
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "disabled-route-root-watch",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        process.emit("SIGINT");
      },
    };

    try {
      await dev(
        {
          conventions: false,
          output: { client: "dist/client", server: "dist/server" },
        },
        { cwd, bundler },
      );
    } finally {
      readdirSpy.mockRestore();
    }

    expect(events).toEqual(["bundler.dev"]);
  });

  it("keeps an unchanged physical watch plan across filesystem events", async () => {
    const cwd = await createSpaProject();
    const dependency = path.join(cwd, "plugin-data.json");
    await writeFile(dependency, "initial", "utf-8");

    type FakeDevWatcher = EventEmitter & {
      close: ReturnType<typeof vi.fn>;
      ref(): fs.FSWatcher;
      unref(): fs.FSWatcher;
    };
    const records: Array<{
      listener: (
        eventType: fs.WatchEventType,
        filename: string | Buffer | null,
      ) => void;
      target: string;
      watcher: FakeDevWatcher;
    }> = [];
    let markDependencyWatcherReady: (() => void) | undefined;
    const dependencyWatcherReady = new Promise<void>((resolve) => {
      markDependencyWatcherReady = resolve;
    });
    const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
      ...args: unknown[]
    ) => {
      const target = path.resolve(String(args[0]));
      const listener = args.at(-1) as (typeof records)[number]["listener"];
      const watcher = new EventEmitter() as FakeDevWatcher;
      watcher.close = vi.fn();
      watcher.ref = () => watcher as fs.FSWatcher;
      watcher.unref = () => watcher as fs.FSWatcher;
      records.push({ listener, target, watcher });
      if (target === cwd) markDependencyWatcherReady?.();
      return watcher;
    }) as never);
    const events: string[] = [];
    let contributionCount = 0;
    let updateCount = 0;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "unchanged-watch-key",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(_update, options) {
            options.activate();
            updateCount += 1;
            const currentUpdate = updateCount;
            events.push(`update:${currentUpdate}`);
            setImmediate(() => events.push(`update.done:${currentUpdate}`));
          },
        });
      },
    };
    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [
          {
            name: "unchanged-watch-key",
            setup(context) {
              context.addWatchFile(dependency);
              return {
                dispose() {
                  events.push("dispose");
                },
              };
            },
            contributions(context) {
              contributionCount += 1;
              events.push(`contribution:${contributionCount}`);
              context.emit.data({
                id: "unchanged-watch-key-data",
                scope: { kind: "application" },
                value: fs.readFileSync(dependency, "utf-8"),
              });
            },
          },
        ],
      },
      { cwd, bundler },
    );
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await dependencyWatcherReady;
      const firstDependencyWatcher = records.find(
        (record) => record.target === cwd,
      );
      if (!firstDependencyWatcher) {
        throw new Error("Expected the plugin dependency watcher to start.");
      }
      const initialWatcherCount = records.length;

      await writeFile(dependency, "first", "utf-8");
      firstDependencyWatcher.listener("change", path.basename(dependency));
      await waitForEvent(events, "update.done:1");

      expect(records).toHaveLength(initialWatcherCount);
      expect(
        records.every((record) => record.watcher.close.mock.calls.length === 0),
      ).toBe(true);

      await writeFile(dependency, "second", "utf-8");
      firstDependencyWatcher.listener("change", path.basename(dependency));
      await waitForEvent(events, "update.done:2");

      expect(records).toHaveLength(initialWatcherCount);
      expect(
        records.every((record) => record.watcher.close.mock.calls.length === 0),
      ).toBe(true);
      process.emit("SIGINT");
      await running;
      expect(
        records.every((record) => record.watcher.close.mock.calls.length === 1),
      ).toBe(true);
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      watchSpy.mockRestore();
    }

    expect(events).toEqual([
      "contribution:1",
      "bundler.dev",
      "contribution:2",
      "update:1",
      "update.done:1",
      "contribution:3",
      "update:2",
      "update.done:2",
      "dispose",
    ]);
  });

  it("runs buildEnd after initial dev output and rebuild output", async () => {
    const cwd = await createSpaProject();
    const rebuildFlags: boolean[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ callbacks, generation, plan }) {
        const clientEntry = plan.entries.find(
          (entry) => entry.environment === "client",
        );
        const facts: BundlerBuildFacts = clientEntry
          ? {
              clientEntryAssets: {
                [clientEntry.name]: { js: ["main.js"], css: [] },
              },
            }
          : {};
        await callbacks.onBuildFacts(generation, facts, { isRebuild: false });
        await callbacks.onBuildFacts(generation, facts, { isRebuild: true });
        process.emit("SIGINT");
        return createTestDevController({ async updatePlan() {} });
      },
    };

    await dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [
          {
            name: "dev-build-end",
            setup() {
              return {
                buildEnd(result) {
                  rebuildFlags.push(result.isRebuild);
                },
              };
            },
          },
        ],
      },
      { cwd, bundler },
    );

    expect(rebuildFlags).toEqual([false, true]);
  });

  it("restores framework-owned dev output when a candidate buildEnd hook fails", async () => {
    const cwd = await createSpaProject();
    const dependency = path.join(cwd, "bundler-plugin.config.json");
    await writeFile(dependency, '{"mode":"initial"}', "utf-8");
    const controlledWatch = installControlledFsWatch();
    const events: string[] = [];
    const stopCapturingRollback = captureFrameworkWarning(
      events,
      "Unable to apply framework plan update without restart:",
      "candidate buildEnd failed",
      "candidate-rolled-back",
    );

    function createOutputPlugin(
      snapshot: "old" | "candidate",
      failBuildEnd = false,
    ): Plugin<Record<string, never>> {
      return {
        name: "framework-output-build-end-rollback",
        setup() {
          return {
            transformHtml(document) {
              document.body?.appendChild(
                document.createComment(` snapshot:${snapshot} `),
              );
            },
            buildEnd() {
              events.push(`buildEnd:${snapshot}`);
              if (failBuildEnd) {
                throw new Error("candidate buildEnd failed");
              }
            },
          };
        },
      };
    }

    const oldConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "spa" },
      plugins: [createOutputPlugin("old")],
    };
    let currentConfig = oldConfig;
    let initialHtml: Buffer | undefined;
    let initialMetadata: Buffer | undefined;
    const htmlPath = path.join(cwd, "dist/client/index.html");
    const metadataPath = path.join(cwd, "dist/deployment-metadata.json");
    const factsForPlan = (plan: BuildPlan): BundlerBuildFacts => ({
      clientEntryAssets: Object.fromEntries(
        plan.entries
          .filter((entry) => entry.environment === "client")
          .map((entry) => [entry.name, { js: [`${entry.name}.js`], css: [] }]),
      ),
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "framework-output-build-end-rollback",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile, callbacks, generation, plan }) {
        addWatchFile?.(dependency);
        await callbacks.onBuildFacts(generation, factsForPlan(plan));
        initialHtml = await fs.promises.readFile(htmlPath);
        initialMetadata = await fs.promises.readFile(metadataPath);
        events.push("initial-output");
        let selectedPlan = plan;
        let selectedGeneration = generation;
        return createTestDevController(
          {
            async updatePlan(update, options) {
              options.activate();
              selectedPlan = update.next;
              selectedGeneration = options.generation;
              events.push("candidate-output");
            },
          },
          {
            async onResume(outcome) {
              if (outcome === "rollback") {
                selectedPlan = plan;
                selectedGeneration = generation;
              }
              await callbacks.onBuildFacts(
                selectedGeneration,
                factsForPlan(selectedPlan),
                { isRebuild: true },
              );
            },
          },
        );
      },
    };
    const running = dev(oldConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, "initial-output");
      currentConfig = {
        ...oldConfig,
        plugins: [createOutputPlugin("candidate", true)],
      };
      await writeFile(dependency, '{"mode":"candidate"}', "utf-8");
      await controlledWatch.dispatchFileChange(dependency);
      await waitForEvent(events, "candidate-rolled-back");

      expect(initialHtml).toBeDefined();
      expect(initialMetadata).toBeDefined();
      await expect(fs.promises.readFile(htmlPath)).resolves.toEqual(
        initialHtml,
      );
      await expect(fs.promises.readFile(metadataPath)).resolves.toEqual(
        initialMetadata,
      );
      expect(await fs.promises.readFile(htmlPath, "utf-8")).toContain(
        "snapshot:old",
      );
      process.emit("SIGINT");
      await running;
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      controlledWatch.restore();
      stopCapturingRollback();
    }

    expect(events).toEqual([
      "buildEnd:old",
      "initial-output",
      "candidate-output",
      "buildEnd:candidate",
      "buildEnd:old",
      "candidate-rolled-back",
    ]);
  });

  it("restores candidate state when transition finalization preparation fails", async () => {
    const cwd = await createSpaProject();
    const dependency = path.join(cwd, "bundler-plugin.config.json");
    await writeFile(dependency, '{"mode":"initial"}', "utf-8");
    const controlledWatch = installControlledFsWatch();
    const events: string[] = [];
    const stopCapturingRollback = captureFrameworkWarning(
      events,
      "Unable to apply framework plan update without restart:",
      "synthetic finalization preparation failure",
      "candidate-rolled-back",
    );

    function createOutputPlugin(
      snapshot: "old" | "candidate",
    ): Plugin<Record<string, never>> {
      return {
        name: "framework-output-finalization-rollback",
        setup() {
          return {
            transformHtml(document) {
              document.body?.appendChild(
                document.createComment(` snapshot:${snapshot} `),
              );
            },
            dispose() {
              events.push(`dispose:${snapshot}`);
            },
          };
        },
      };
    }

    const oldConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "spa" },
      plugins: [createOutputPlugin("old")],
    };
    let currentConfig = oldConfig;
    const htmlPath = path.join(cwd, "dist/client/index.html");
    const metadataPath = path.join(cwd, "dist/deployment-metadata.json");
    const generatedRoot = path.join(cwd, ".ev");
    let initialHtml: Buffer | undefined;
    let initialMetadata: Buffer | undefined;
    let initialGeneratedState: Record<string, string> | undefined;
    let prepareCount = 0;
    const factsForPlan = (plan: BuildPlan): BundlerBuildFacts => ({
      clientEntryAssets: Object.fromEntries(
        plan.entries
          .filter((entry) => entry.environment === "client")
          .map((entry) => [entry.name, { js: [`${entry.name}.js`], css: [] }]),
      ),
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "framework-output-finalization-rollback",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile, callbacks, generation, plan }) {
        addWatchFile?.(dependency);
        await callbacks.onBuildFacts(generation, factsForPlan(plan));
        initialHtml = await fs.promises.readFile(htmlPath);
        initialMetadata = await fs.promises.readFile(metadataPath);
        initialGeneratedState = await readDirectorySnapshot(generatedRoot);
        let selectedGeneration = generation;
        let selectedPlan = plan;
        events.push("initial-output");
        return createTestDevController(
          {
            async updatePlan(update, options) {
              options.activate();
              selectedGeneration = options.generation;
              selectedPlan = update.next;
              events.push("candidate-input");
            },
          },
          {
            async onResume(outcome) {
              if (outcome === "rollback") {
                expect(initialHtml).toBeDefined();
                expect(initialMetadata).toBeDefined();
                expect(initialGeneratedState).toBeDefined();
                await expect(fs.promises.readFile(htmlPath)).resolves.toEqual(
                  initialHtml,
                );
                await expect(
                  fs.promises.readFile(metadataPath),
                ).resolves.toEqual(initialMetadata);
                expect(await readDirectorySnapshot(generatedRoot)).toEqual(
                  initialGeneratedState,
                );
                selectedGeneration = generation;
                selectedPlan = plan;
                events.push("rollback-state-restored");
              }
              await callbacks.onBuildFacts(
                selectedGeneration,
                factsForPlan(selectedPlan),
                { isRebuild: true },
              );
              events.push(`facts:${outcome}`);
            },
            async onPrepareFinalize() {
              prepareCount += 1;
              if (prepareCount !== 1) return;
              expect(await fs.promises.readFile(htmlPath, "utf-8")).toContain(
                "snapshot:candidate",
              );
              expect(await readDirectorySnapshot(generatedRoot)).not.toEqual(
                initialGeneratedState,
              );
              events.push("prepare-finalize:reject");
              throw new Error("synthetic finalization preparation failure");
            },
          },
        );
      },
    };
    const running = dev(oldConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, "initial-output");
      currentConfig = {
        ...oldConfig,
        routing: { mode: "mpa" },
        plugins: [createOutputPlugin("candidate")],
      };
      await writeFile(dependency, '{"mode":"candidate"}', "utf-8");
      await controlledWatch.dispatchFileChange(dependency);
      await waitForEvent(events, "candidate-rolled-back");

      await expect(fs.promises.readFile(htmlPath)).resolves.toEqual(
        initialHtml,
      );
      await expect(fs.promises.readFile(metadataPath)).resolves.toEqual(
        initialMetadata,
      );
      expect(await readDirectorySnapshot(generatedRoot)).toEqual(
        initialGeneratedState,
      );
      expect(
        events.filter((event) => event === "dispose:candidate"),
      ).toHaveLength(1);
      process.emit("SIGINT");
      await running;
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      controlledWatch.restore();
      stopCapturingRollback();
    }

    expect(events).toEqual([
      "initial-output",
      "candidate-input",
      "facts:accept",
      "prepare-finalize:reject",
      "dispose:candidate",
      "rollback-state-restored",
      "facts:rollback",
      "candidate-rolled-back",
      "dispose:old",
    ]);
  });

  it("fail-stops a committed candidate when transition finalize returns a Promise", async () => {
    const cwd = await createSpaProject();
    const dependency = path.join(cwd, "bundler-plugin.config.json");
    await writeFile(dependency, '{"mode":"initial"}', "utf-8");
    const events: string[] = [];

    function createOutputPlugin(
      snapshot: "old" | "candidate",
    ): Plugin<Record<string, never>> {
      return {
        name: "framework-output-finalize-contract",
        setup() {
          return {
            transformHtml(document) {
              document.body?.appendChild(
                document.createComment(` snapshot:${snapshot} `),
              );
            },
            dispose() {
              events.push(`dispose:${snapshot}`);
            },
          };
        },
      };
    }

    const oldConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "spa" },
      plugins: [createOutputPlugin("old")],
    };
    let currentConfig = oldConfig;
    const htmlPath = path.join(cwd, "dist/client/index.html");
    const generatedRoot = path.join(cwd, ".ev");
    let initialGeneratedState: Record<string, string> | undefined;
    const factsForPlan = (plan: BuildPlan): BundlerBuildFacts => ({
      clientEntryAssets: Object.fromEntries(
        plan.entries
          .filter((entry) => entry.environment === "client")
          .map((entry) => [entry.name, { js: [`${entry.name}.js`], css: [] }]),
      ),
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "framework-output-finalize-contract",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile, callbacks, generation, plan }) {
        addWatchFile?.(dependency);
        await callbacks.onBuildFacts(generation, factsForPlan(plan));
        initialGeneratedState = await readDirectorySnapshot(generatedRoot);
        let selectedGeneration = generation;
        let selectedPlan = plan;
        events.push("initial-output");
        return createTestDevController(
          {
            async updatePlan(update, options) {
              options.activate();
              selectedGeneration = options.generation;
              selectedPlan = update.next;
              events.push("candidate-input");
            },
          },
          {
            async onResume(outcome) {
              events.push(`resume:${outcome}`);
              await callbacks.onBuildFacts(
                selectedGeneration,
                factsForPlan(selectedPlan),
                { isRebuild: true },
              );
            },
            onFinalize() {
              events.push("finalize:async");
              return new Promise<void>(() => {});
            },
          },
        );
      },
    };
    const running = dev(oldConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, "initial-output");
      currentConfig = {
        ...oldConfig,
        routing: { mode: "mpa" },
        plugins: [createOutputPlugin("candidate")],
      };
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(dependency, '{"mode":"candidate"}', "utf-8");
      await expect(
        Promise.race([
          running,
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(new Error("async finalize contract check timed out")),
              devUpdateTimeoutMs,
            ),
          ),
        ]),
      ).rejects.toThrow(
        "returned a Promise from development transition finalize",
      );
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
    }

    expect(await fs.promises.readFile(htmlPath, "utf-8")).toContain(
      "snapshot:candidate",
    );
    expect(await readDirectorySnapshot(generatedRoot)).not.toEqual(
      initialGeneratedState,
    );
    expect(events).toEqual([
      "initial-output",
      "candidate-input",
      "resume:accept",
      "finalize:async",
      "dispose:old",
      "dispose:candidate",
    ]);
  });

  it("restores candidate output when the adapter rejects an otherwise successful update", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/about/page.tsx"),
      "export default function About() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/contact/page.tsx"),
      "export default function Contact() { return null; }",
      "utf-8",
    );
    const dependency = path.join(cwd, "bundler-plugin.config.json");
    await writeFile(dependency, '{"mode":"initial"}', "utf-8");
    const events: string[] = [];
    const stopCapturingRollback = captureFrameworkWarning(
      events,
      "Unable to apply framework plan update without restart:",
      "synthetic adapter update failure",
      "candidate-rolled-back",
    );

    function createOutputPlugin(
      snapshot: "old" | "candidate",
    ): Plugin<Record<string, never>> {
      return {
        name: "framework-output-adapter-rollback",
        setup() {
          return {
            transformHtml(document) {
              document.body?.appendChild(
                document.createComment(` snapshot:${snapshot} `),
              );
            },
            buildEnd() {
              events.push(`buildEnd:${snapshot}`);
            },
          };
        },
      };
    }

    const oldConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "spa" },
      plugins: [createOutputPlugin("old")],
    };
    let currentConfig = oldConfig;
    const htmlPath = path.join(cwd, "dist/client/index.html");
    const metadataPath = path.join(cwd, "dist/deployment-metadata.json");
    let initialHtml: Buffer | undefined;
    let initialMetadata: Buffer | undefined;
    let candidateHtmlPaths: string[] = [];
    const factsForPlan = (plan: BuildPlan): BundlerBuildFacts => ({
      clientEntryAssets: Object.fromEntries(
        plan.entries
          .filter((entry) => entry.environment === "client")
          .map((entry) => [entry.name, { js: [`${entry.name}.js`], css: [] }]),
      ),
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "framework-output-adapter-rollback",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile, callbacks, generation, plan }) {
        addWatchFile?.(dependency);
        await callbacks.onBuildFacts(generation, factsForPlan(plan));
        initialHtml = await fs.promises.readFile(htmlPath);
        initialMetadata = await fs.promises.readFile(metadataPath);
        events.push("initial-output");
        return createTestDevController(
          {
            async updatePlan(update, options) {
              options.activate();
              candidateHtmlPaths = update.next.html.flatMap((document) =>
                [document.fileName, ...(document.aliases ?? [])].map((file) =>
                  path.resolve(cwd, update.next.output.clientDir, file),
                ),
              );
              events.push("candidate-input-rejected");
              throw new Error("synthetic adapter update failure");
            },
          },
          {
            async onResume(outcome) {
              expect(outcome).toBe("rollback");
              await callbacks.onBuildFacts(generation, factsForPlan(plan), {
                isRebuild: true,
              });
            },
          },
        );
      },
    };
    const running = dev(oldConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, "initial-output");
      currentConfig = {
        ...oldConfig,
        routing: { mode: "mpa" },
        plugins: [createOutputPlugin("candidate")],
      };
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(dependency, '{"mode":"candidate"}', "utf-8");
      await waitForEvent(events, "candidate-rolled-back");

      expect(initialHtml).toBeDefined();
      expect(initialMetadata).toBeDefined();
      await expect(fs.promises.readFile(htmlPath)).resolves.toEqual(
        initialHtml,
      );
      await expect(fs.promises.readFile(metadataPath)).resolves.toEqual(
        initialMetadata,
      );
      expect(await fs.promises.readFile(htmlPath, "utf-8")).toContain(
        "snapshot:old",
      );
      expect(candidateHtmlPaths).toHaveLength(2);
      await Promise.all(
        candidateHtmlPaths.map(async (file) => {
          await expect(fs.promises.lstat(file)).rejects.toMatchObject({
            code: "ENOENT",
          });
        }),
      );
      await Promise.all(
        [...new Set(candidateHtmlPaths.map((file) => path.dirname(file)))].map(
          async (directory) => {
            await expect(fs.promises.lstat(directory)).rejects.toMatchObject({
              code: "ENOENT",
            });
          },
        ),
      );
      process.emit("SIGINT");
      await running;
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      stopCapturingRollback();
    }

    expect(events).toEqual([
      "buildEnd:old",
      "initial-output",
      "candidate-input-rejected",
      "buildEnd:old",
      "candidate-rolled-back",
    ]);
  });

  it("restores framework-owned output when an ordinary dev rebuild fails", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const htmlPath = path.join(cwd, "dist/client/index.html");
    const metadataPath = path.join(cwd, "dist/deployment-metadata.json");
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "framework-output-rebuild-rollback",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ callbacks, generation, plan }) {
        const clientEntry = plan.entries.find(
          (entry) => entry.environment === "client",
        );
        const facts: BundlerBuildFacts = clientEntry
          ? {
              clientEntryAssets: {
                [clientEntry.name]: { js: ["main.js"], css: [] },
              },
            }
          : {};
        await callbacks.onBuildFacts(generation, facts);
        const initialHtml = await fs.promises.readFile(htmlPath);
        const initialMetadata = await fs.promises.readFile(metadataPath);
        events.push("initial-output");

        await expect(
          callbacks.onBuildFacts(generation, facts, { isRebuild: true }),
        ).rejects.toThrow("ordinary rebuild buildEnd failed");
        events.push("rebuild-rejected");
        await expect(fs.promises.readFile(htmlPath)).resolves.toEqual(
          initialHtml,
        );
        await expect(fs.promises.readFile(metadataPath)).resolves.toEqual(
          initialMetadata,
        );
        expect(await fs.promises.readFile(htmlPath, "utf-8")).toContain(
          "cycle:initial",
        );
        process.emit("SIGINT");
      },
    };

    await dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [
          {
            name: "framework-output-rebuild-rollback",
            setup() {
              return {
                transformHtml(document, context) {
                  const cycle = context.isRebuild ? "failed" : "initial";
                  events.push(`transform:${cycle}`);
                  document.body?.appendChild(
                    document.createComment(` cycle:${cycle} `),
                  );
                },
                buildEnd(result) {
                  const cycle = result.isRebuild ? "failed" : "initial";
                  events.push(`buildEnd:${cycle}`);
                  if (result.isRebuild) {
                    throw new Error("ordinary rebuild buildEnd failed");
                  }
                },
              };
            },
          },
        ],
      },
      { cwd, bundler },
    );

    expect(events).toEqual([
      "transform:initial",
      "buildEnd:initial",
      "initial-output",
      "transform:failed",
      "buildEnd:failed",
      "rebuild-rejected",
    ]);
  });

  it("restores partially written MPA output when candidate transformHtml fails", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/about/page.tsx"),
      "export default function About() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/contact/page.tsx"),
      "export default function Contact() { return null; }",
      "utf-8",
    );
    const dependency = path.join(cwd, "bundler-plugin.config.json");
    await writeFile(dependency, '{"mode":"initial"}', "utf-8");
    const events: string[] = [];
    const stopCapturingRollback = captureFrameworkWarning(
      events,
      "Unable to apply framework plan update without restart:",
      "candidate transformHtml failed",
      "candidate-rolled-back",
    );

    function createOutputPlugin(
      snapshot: "old" | "candidate",
      failSecondDocument = false,
    ): Plugin<Record<string, never>> {
      return {
        name: "framework-output-transform-html-rollback",
        setup() {
          let transformedDocuments = 0;
          return {
            transformHtml(document) {
              transformedDocuments += 1;
              events.push(`transform:${snapshot}:${transformedDocuments}`);
              if (failSecondDocument && transformedDocuments === 2) {
                throw new Error("candidate transformHtml failed");
              }
              document.body?.appendChild(
                document.createComment(` snapshot:${snapshot} `),
              );
            },
          };
        },
      };
    }

    const oldConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "spa" },
      plugins: [createOutputPlugin("old")],
    };
    let currentConfig = oldConfig;
    const htmlPath = path.join(cwd, "dist/client/index.html");
    const metadataPath = path.join(cwd, "dist/deployment-metadata.json");
    let initialHtml: Buffer | undefined;
    let initialMetadata: Buffer | undefined;
    let candidateHtmlPaths: string[] = [];
    const factsForPlan = (plan: BuildPlan): BundlerBuildFacts => ({
      clientEntryAssets: Object.fromEntries(
        plan.entries
          .filter((entry) => entry.environment === "client")
          .map((entry) => [entry.name, { js: [`${entry.name}.js`], css: [] }]),
      ),
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "framework-output-transform-html-rollback",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile, callbacks, generation, plan }) {
        addWatchFile?.(dependency);
        await callbacks.onBuildFacts(generation, factsForPlan(plan));
        initialHtml = await fs.promises.readFile(htmlPath);
        initialMetadata = await fs.promises.readFile(metadataPath);
        events.push("initial-output");
        let selectedPlan = plan;
        let selectedGeneration = generation;
        return createTestDevController(
          {
            async updatePlan(update, options) {
              options.activate();
              events.push("candidate-output");
              selectedPlan = update.next;
              selectedGeneration = options.generation;
              candidateHtmlPaths = update.next.html.flatMap((document) =>
                [document.fileName, ...(document.aliases ?? [])].map((file) =>
                  path.resolve(cwd, update.next.output.clientDir, file),
                ),
              );
            },
          },
          {
            async onResume(outcome) {
              if (outcome === "rollback") {
                selectedPlan = plan;
                selectedGeneration = generation;
              }
              await callbacks.onBuildFacts(
                selectedGeneration,
                factsForPlan(selectedPlan),
                { isRebuild: true },
              );
            },
          },
        );
      },
    };
    const running = dev(oldConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, "initial-output");
      currentConfig = {
        ...oldConfig,
        routing: { mode: "mpa" },
        plugins: [createOutputPlugin("candidate", true)],
      };
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(dependency, '{"mode":"candidate"}', "utf-8");
      await waitForEvent(events, "candidate-rolled-back");

      expect(initialMetadata).toBeDefined();
      await expect(fs.promises.readFile(metadataPath)).resolves.toEqual(
        initialMetadata,
      );
      expect(initialHtml).toBeDefined();
      await expect(fs.promises.readFile(htmlPath)).resolves.toEqual(
        initialHtml,
      );
      expect(await fs.promises.readFile(htmlPath, "utf-8")).toContain(
        "snapshot:old",
      );
      expect(candidateHtmlPaths).toHaveLength(2);
      await Promise.all(
        candidateHtmlPaths.map(async (file) => {
          await expect(fs.promises.lstat(file)).rejects.toMatchObject({
            code: "ENOENT",
          });
        }),
      );
      await Promise.all(
        [...new Set(candidateHtmlPaths.map((file) => path.dirname(file)))].map(
          async (directory) => {
            await expect(fs.promises.lstat(directory)).rejects.toMatchObject({
              code: "ENOENT",
            });
          },
        ),
      );
      process.emit("SIGINT");
      await running;
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      stopCapturingRollback();
    }

    expect(events).toEqual([
      "transform:old:1",
      "initial-output",
      "candidate-output",
      "transform:candidate:1",
      "transform:candidate:2",
      "transform:old:2",
      "candidate-rolled-back",
    ]);
  });

  it("prerenders clientless SSG HTML during initial dev output and rebuilds", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/report/page.tsx"),
      "export default function Report() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/report/page.config.ts"),
      'export default { render: "ssg" };',
      "utf-8",
    );

    const emittedHtml: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "ssg-dev-mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ callbacks, generation, plan }) {
        const reportServerEntry = createPageServerBuildEntryName("report");
        expect(plan.mode).toBe("development");
        expect(plan.entries).toContainEqual(
          expect.objectContaining({
            name: reportServerEntry,
            environment: "server",
            kind: "page-server",
          }),
        );
        expect(
          plan.entries.some((entry) => entry.environment === "client"),
        ).toBe(false);
        let rendering = "Initial dev report";
        const facts: BundlerBuildFacts = {
          clientEntryAssets: {},
          serverEntryAssets: {
            [reportServerEntry]: {
              js: [`${reportServerEntry}.js`],
              css: [],
            },
          },
          serverAssets: { js: [], css: [] },
          async loadServerModule(asset) {
            if (asset !== `${reportServerEntry}.js`) {
              throw new Error(`Unexpected server module asset: ${asset}`);
            }
            const currentRendering = rendering;
            return {
              render() {
                return `<h1>${currentRendering}</h1>`;
              },
            };
          },
        };
        const htmlPath = path.join(cwd, "dist/client/report/index.html");

        await callbacks.onBuildFacts(generation, facts, { isRebuild: false });
        emittedHtml.push(await fs.promises.readFile(htmlPath, "utf-8"));

        rendering = "Rebuilt dev report";
        await callbacks.onBuildFacts(generation, facts, { isRebuild: true });
        emittedHtml.push(await fs.promises.readFile(htmlPath, "utf-8"));

        process.emit("SIGINT");
        return createTestDevController({ async updatePlan() {} });
      },
    };

    await dev(
      {
        routing: { mode: "mpa" },
      },
      { cwd, bundler },
    );

    expect(emittedHtml).toHaveLength(2);
    expect(emittedHtml[0]).toContain(
      '<div id="app"><h1>Initial dev report</h1></div>',
    );
    expect(emittedHtml[1]).toContain(
      '<div id="app"><h1>Rebuilt dev report</h1></div>',
    );
    for (const html of emittedHtml) {
      expect(html).not.toMatch(/<script[^>]+src=/);
      expect(html).not.toContain("__EVJS_CLIENT_RUNTIME__");
      expect(html).not.toContain("data-evjs-hydrate");
    }
  });

  it("discovers the first default api.* anchor when src/apis is created during dev", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ plan }) {
        events.push(
          `initial-server:${plan.entries.some((entry) => entry.kind === "server-runtime")}`,
        );
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            if (isEmptyBuildPlanUpdate(update)) return;
            const serverEntry = update.entries.added.find(
              (entry) => entry.kind === "server-runtime",
            );
            const routes =
              serverEntry?.metadata?.type === "server-app"
                ? serverEntry.metadata.routes
                : [];
            events.push(
              `added-server:${serverEntry !== undefined}:${routes.map((route) => route.path).join(",")}`,
            );
            process.emit("SIGINT");
          },
        });
      },
    };

    const running = dev(
      { output: { client: "dist/client", server: "dist/server" } },
      { cwd, bundler },
    );
    await waitForEvent(events, "initial-server:false");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(
      path.join(cwd, "src/apis/health/api.ts"),
      "export const GET = async () => Response.json({ ok: true });",
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("first dev api route update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "initial-server:false",
      "added-server:true:/health",
    ]);
  });

  it("rebinds the api route-root watcher after empty directory topology changes", async () => {
    const cwd = await createProject();
    const sourceRoot = path.join(cwd, "src");
    const routeRoot = path.join(sourceRoot, "apis");
    await fs.promises.mkdir(sourceRoot);
    type FakeDevWatcher = EventEmitter & {
      close: ReturnType<typeof vi.fn>;
      ref(): fs.FSWatcher;
      unref(): fs.FSWatcher;
    };
    const records: Array<{
      listener: (
        eventType: fs.WatchEventType,
        filename: string | Buffer | null,
      ) => void;
      target: string;
      watcher: FakeDevWatcher;
    }> = [];
    const watchCounts = new Map<string, number>();
    const events: string[] = [];
    const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
      ...args: unknown[]
    ) => {
      const target = path.resolve(String(args[0]));
      const listener = args.at(-1) as (typeof records)[number]["listener"];
      const watcher = new EventEmitter() as FakeDevWatcher;
      watcher.close = vi.fn();
      watcher.ref = () => watcher as fs.FSWatcher;
      watcher.unref = () => watcher as fs.FSWatcher;
      records.push({ listener, target, watcher });
      const count = (watchCounts.get(target) ?? 0) + 1;
      watchCounts.set(target, count);
      events.push(`watch:${target}:${count}`);
      return watcher;
    }) as never);
    let contributionCount = 0;
    let loadConfigCalls = 0;
    let setupCount = 0;
    const topologyPlugin: Plugin<Record<string, never>> = {
      name: "route-root-topology-probe",
      setup() {
        setupCount += 1;
        return {};
      },
      contributions() {
        contributionCount += 1;
        events.push(`contribution:${contributionCount}`);
      },
    };
    const config: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      plugins: [topologyPlugin],
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "route-root-topology",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ plan }) {
        events.push(
          `initial-server:${plan.entries.some((entry) => entry.kind === "server-runtime")}`,
        );
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            events.push(`config-changed:${options?.configChanged}`);
            const serverEntry = update.entries.added.find(
              (entry) => entry.kind === "server-runtime",
            );
            const routes =
              serverEntry?.metadata?.type === "server-app"
                ? serverEntry.metadata.routes.map((route) => route.path)
                : [];
            if (!routes.includes("/health")) return;
            events.push("added-server:/health");
            process.emit("SIGINT");
          },
        });
      },
    };
    const running = dev(config, {
      cwd,
      bundler,
      loadConfig() {
        loadConfigCalls += 1;
        return config;
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, `watch:${sourceRoot}:1`, 2_000);
      const initialWatcher = records.find(
        (record) => record.target === sourceRoot,
      );
      if (!initialWatcher) {
        throw new Error("Expected the initial route-root ancestor watcher.");
      }

      await fs.promises.mkdir(routeRoot);
      initialWatcher.listener("rename", "apis");
      await waitForEvent(events, `watch:${routeRoot}:1`, 2_000);

      const firstRouteRootWatcher = records.find(
        (record) => record.target === routeRoot,
      );
      if (!firstRouteRootWatcher) {
        throw new Error("Expected the created route-root watcher.");
      }
      await fs.promises.rmdir(routeRoot);
      firstRouteRootWatcher.listener("rename", null);
      await waitForEvent(events, `watch:${sourceRoot}:2`, 2_000);

      const sourceWatcher = records.findLast(
        (record) => record.target === sourceRoot,
      );
      if (!sourceWatcher) {
        throw new Error("Expected the missing route-root ancestor watcher.");
      }
      await fs.promises.mkdir(routeRoot);
      sourceWatcher.listener("rename", "apis");
      await waitForEvent(events, `watch:${routeRoot}:2`, 2_000);

      const rebuiltRouteRootWatcher = records.findLast(
        (record) => record.target === routeRoot,
      );
      if (!rebuiltRouteRootWatcher) {
        throw new Error("Expected the rebuilt route-root watcher.");
      }
      await writeFile(
        path.join(routeRoot, "health/api.ts"),
        "export const GET = async () => Response.json({ ok: true });",
        "utf-8",
      );
      rebuiltRouteRootWatcher.listener("rename", "health");

      await Promise.race([
        running,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("rebuilt route-root update timed out")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);
      expect(events).toContain("added-server:/health");
      expect(events).toContain("config-changed:false");
      expect(events).not.toContain("config-changed:true");
      expect(loadConfigCalls).toBe(0);
      expect(setupCount).toBe(1);
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      watchSpy.mockRestore();
    }
  });

  it("recovers when the optional api route root changes from a file to a directory", async () => {
    const cwd = await createProject();
    const routeRoot = path.join(cwd, "src/apis");
    await writeFile(routeRoot, "not a directory", "utf-8");
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ plan }) {
        events.push(
          `initial-server:${plan.entries.some((entry) => entry.kind === "server-runtime")}`,
        );
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            if (
              !update.entries.added.some(
                (entry) => entry.kind === "server-runtime",
              )
            ) {
              return;
            }
            events.push("added-server");
            process.emit("SIGINT");
          },
        });
      },
    };

    const running = dev(
      { output: { client: "dist/client", server: "dist/server" } },
      { cwd, bundler },
    );
    await waitForEvent(events, "initial-server:false");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.promises.rm(routeRoot);
    await writeFile(
      path.join(routeRoot, "health/api.ts"),
      "export const GET = async () => Response.json({ ok: true });",
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("file route root recovery timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual(["initial-server:false", "added-server"]);
  });

  it("keeps watching a newly created api route tree after invalid discovery", async () => {
    const cwd = await createProject();
    const routeFile = path.join(cwd, "src/apis/users/api.ts");
    const events: string[] = [];
    const stopCapturingFailures = captureFrameworkUpdateFailures(
      events,
      'Server route module exports lowercase method "get".',
    );
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ plan }) {
        events.push(
          `initial-server:${plan.entries.some((entry) => entry.kind === "server-runtime")}`,
        );
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            const serverEntry = update.entries.added.find(
              (entry) => entry.kind === "server-runtime",
            );
            if (!serverEntry) return;
            events.push("added-server");
            process.emit("SIGINT");
          },
        });
      },
    };

    try {
      const running = dev(
        {
          output: { client: "dist/client", server: "dist/server" },
        },
        { cwd, bundler },
      );
      await waitForEvent(events, "initial-server:false");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(
        routeFile,
        "export const get = async () => Response.json([]);",
        "utf-8",
      );
      await waitForEvent(events, "framework-update-failed");
      expect(events).not.toContain("added-server");

      await writeFile(
        routeFile,
        "export const GET = async () => Response.json([]);",
        "utf-8",
      );

      await Promise.race([
        running,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("fixed dev api route update timed out")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);

      expect(events).toEqual([
        "initial-server:false",
        "framework-update-failed",
        "added-server",
      ]);
    } finally {
      stopCapturingFailures();
    }
  });

  it("keeps watching a newly created Page tree after invalid config discovery", async () => {
    const cwd = await createSpaProject();
    const pageDirectory = path.join(cwd, "src/pages/catalog/details");
    const pageConfig = path.join(pageDirectory, "page.config.ts");
    const events: string[] = [];
    const stopCapturingFailures = captureFrameworkUpdateFailures(
      events,
      'has unknown field "unknown"',
    );
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "invalid-page-config-recovery",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ plan }) {
        const appEntry = plan.entries.find(
          (entry) => entry.metadata?.type === "pages-app",
        );
        recordPagesAppRoutes("initial", appEntry?.metadata, events);
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            const nextAppEntry = update.next.entries.find(
              (entry) => entry.metadata?.type === "pages-app",
            );
            if (nextAppEntry?.metadata?.type !== "pages-app") return;
            const routes = nextAppEntry.metadata.routes.map(
              (route) => route.path,
            );
            if (!routes.includes("/catalog/details")) return;
            events.push("added-page");
            process.emit("SIGINT");
          },
        });
      },
    };

    let running: Promise<void> | undefined;
    let settled = false;
    try {
      running = dev(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        { cwd, bundler },
      );
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await waitForEvent(events, "initial:/");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(
        path.join(pageDirectory, "page.tsx"),
        "export default function Details() { return null; }",
        "utf-8",
      );
      await writeFile(pageConfig, "export default { unknown: true };", "utf-8");
      await waitForEvent(events, "framework-update-failed");
      expect(events).not.toContain("added-page");

      await writeFile(
        pageConfig,
        'export default { title: "Details" };',
        "utf-8",
      );

      await Promise.race([
        running,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("fixed Page config update timed out")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);

      expect(events).toEqual([
        "initial:/",
        "framework-update-failed",
        "added-page",
      ]);
    } finally {
      if (running && !settled) {
        process.emit("SIGINT");
        await running.catch(() => undefined);
      }
      stopCapturingFailures();
    }
  });

  it(
    "retries a new Page config after only its failing helper changes",
    async () => {
      const cwd = await createSpaProject();
      const pageDirectory = path.join(cwd, "src/pages/catalog/details");
      const helper = path.join(cwd, "src/config/page-settings.ts");
      const helperDirectory = path.dirname(helper);
      await fs.promises.mkdir(helperDirectory, { recursive: true });
      type FakeDevWatcher = EventEmitter & {
        close: ReturnType<typeof vi.fn>;
        ref(): fs.FSWatcher;
        unref(): fs.FSWatcher;
      };
      const watchRecords: Array<{
        listener: (
          eventType: fs.WatchEventType,
          filename: string | Buffer | null,
        ) => void;
        target: string;
        watcher: FakeDevWatcher;
      }> = [];
      const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
        ...args: unknown[]
      ) => {
        const target = path.resolve(String(args[0]));
        const listener = args.at(
          -1,
        ) as (typeof watchRecords)[number]["listener"];
        const watcher = new EventEmitter() as FakeDevWatcher;
        watcher.close = vi.fn();
        watcher.ref = () => watcher as fs.FSWatcher;
        watcher.unref = () => watcher as fs.FSWatcher;
        watchRecords.push({ listener, target, watcher });
        return watcher;
      }) as never);
      const dispatchChange = (file: string) => {
        for (const record of watchRecords) {
          if (record.watcher.close.mock.calls.length > 0) continue;
          const relative = path.relative(record.target, file);
          if (
            relative !== "" &&
            (relative.startsWith("..") || path.isAbsolute(relative))
          ) {
            continue;
          }
          record.listener("rename", relative || path.basename(file));
        }
      };
      const events: string[] = [];
      const stopCapturingFailures = captureFrameworkUpdateFailures(
        events,
        "Failed to load static config module",
      );
      const bundler: BundlerAdapter<Record<string, never>> = {
        name: "failed-page-config-helper-recovery",
        capabilities: fullBundlerCapabilities,
        async build() {
          return {};
        },
        async dev({ plan }) {
          const appEntry = plan.entries.find(
            (entry) => entry.metadata?.type === "pages-app",
          );
          recordPagesAppRoutes("initial", appEntry?.metadata, events);
          return createTestDevController({
            async updatePlan(update, options) {
              options.activate();
              const nextAppEntry = update.next.entries.find(
                (entry) => entry.metadata?.type === "pages-app",
              );
              if (nextAppEntry?.metadata?.type !== "pages-app") return;
              const routes = nextAppEntry.metadata.routes.map(
                (route) => route.path,
              );
              if (!routes.includes("/catalog/details")) return;
              events.push(`added-page:${options?.configChanged}`);
              process.emit("SIGINT");
            },
          });
        },
      };

      let running: Promise<void> | undefined;
      let settled = false;
      try {
        running = dev(
          {
            output: { client: "dist/client", server: "dist/server" },
            routing: { mode: "spa" },
          },
          { cwd, bundler },
        );
        void running.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        await waitForEvent(events, "initial:/");
        await writeFile(
          path.join(pageDirectory, "page.tsx"),
          "export default function Details() { return null; }",
          "utf-8",
        );
        await writeFile(
          path.join(pageDirectory, "page.config.ts"),
          [
            'import { title } from "../../../config/page-settings.js";',
            "export default { title };",
          ].join("\n"),
          "utf-8",
        );
        dispatchChange(path.join(pageDirectory, "page.config.ts"));
        await waitForEvent(events, "framework-update-failed");
        expect(events).not.toContain("added-page:false");

        const watcherStartedAt = Date.now();
        while (
          !watchRecords.some(
            (record) =>
              record.target === helperDirectory &&
              record.watcher.close.mock.calls.length === 0,
          )
        ) {
          if (Date.now() - watcherStartedAt > devUpdateTimeoutMs) {
            throw new Error(
              `Missing failed Page helper watcher. Watched: ${watchRecords
                .map((record) => record.target)
                .join(", ")}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        await writeFile(helper, 'export const title = "Details";', "utf-8");
        dispatchChange(helper);

        await Promise.race([
          running,
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(new Error("fixed Page config helper update timed out")),
              devUpdateTimeoutMs,
            ),
          ),
        ]);

        expect(events).toEqual([
          "initial:/",
          "framework-update-failed",
          "added-page:false",
        ]);
      } finally {
        if (running && !settled) {
          process.emit("SIGINT");
          await running.catch(() => undefined);
        }
        watchSpy.mockRestore();
        stopCapturingFailures();
      }
    },
    devUpdateTimeoutMs + 1_000,
  );

  it("does not follow an api route root symlink outside cwd and recovers after replacement", async () => {
    const cwd = await createProject();
    const routeRoot = path.join(cwd, "src/apis");
    await writeFile(
      path.join(routeRoot, "initial/api.ts"),
      "export const GET = async () => Response.json({ initial: true });",
      "utf-8",
    );
    const externalRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-external-apis-"),
    );
    const externalRoute = path.join(externalRoot, "outside/api.ts");
    await writeFile(
      externalRoute,
      "export const GET = async () => Response.json({ outside: true });",
      "utf-8",
    );

    const events: string[] = [];
    const stopCapturingFailures = captureFrameworkUpdateFailures(
      events,
      "Server route directory must resolve inside the project root.",
    );
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            const serverEntry = [
              ...update.entries.added,
              ...update.entries.changed,
            ].find((entry) => entry.kind === "server-runtime");
            const routes =
              serverEntry?.metadata?.type === "server-app"
                ? serverEntry.metadata.routes
                : [];
            if (!routes.some((route) => route.path === "/recovered")) return;
            events.push("recovered-server");
            process.emit("SIGINT");
          },
        });
      },
    };

    try {
      const running = dev(
        {
          output: { client: "dist/client", server: "dist/server" },
        },
        { cwd, bundler },
      );
      await waitForEvent(events, "bundler.dev");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fs.promises.rm(routeRoot, { recursive: true });
      await fs.promises.symlink(
        externalRoot,
        routeRoot,
        process.platform === "win32" ? "junction" : "dir",
      );
      await waitForEvent(events, "framework-update-failed");

      const failuresBeforeExternalEdit = await waitForEventCountToStabilize(
        events,
        "framework-update-failed",
      );
      await writeFile(
        externalRoute,
        "export const GET = async () => Response.json({ outside: false });",
        "utf-8",
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(
        events.filter((event) => event === "framework-update-failed"),
      ).toHaveLength(failuresBeforeExternalEdit);

      await fs.promises.rm(routeRoot);
      await writeFile(
        path.join(routeRoot, "recovered/api.ts"),
        "export const GET = async () => Response.json({ recovered: true });",
        "utf-8",
      );

      await Promise.race([
        running,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("symlink route root recovery timed out")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);

      expect(events).toContain("recovered-server");
    } finally {
      stopCapturingFailures();
    }
  });

  it("filters page and api watchers below an escaped route-root ancestor", async () => {
    const cwd = await createProject();
    const sourceRoot = path.join(cwd, "src");
    await writeFile(
      path.join(sourceRoot, "pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(sourceRoot, "apis/initial/api.ts"),
      "export const GET = async () => Response.json({ initial: true });",
      "utf-8",
    );

    const externalSourceRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-external-src-"),
    );
    const externalPage = path.join(externalSourceRoot, "pages/page.tsx");
    const externalApi = path.join(externalSourceRoot, "apis/outside/api.ts");
    await writeFile(
      externalPage,
      "export default function OutsidePage() { return null; }",
      "utf-8",
    );
    await writeFile(
      externalApi,
      "export const GET = async () => Response.json({ outside: true });",
      "utf-8",
    );

    const events: string[] = [];
    const stopCapturingFailures = captureFrameworkUpdateFailures(
      events,
      "Page route directory must resolve inside the project root.",
    );
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            const serverEntry = [
              ...update.entries.added,
              ...update.entries.changed,
            ].find((entry) => entry.kind === "server-runtime");
            const routes =
              serverEntry?.metadata?.type === "server-app"
                ? serverEntry.metadata.routes
                : [];
            if (!routes.some((route) => route.path === "/recovered")) return;
            events.push("recovered-source");
            process.emit("SIGINT");
          },
        });
      },
    };

    try {
      const running = dev(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        { cwd, bundler },
      );
      await waitForEvent(events, "bundler.dev");
      await new Promise((resolve) => setTimeout(resolve, 100));
      await fs.promises.rm(sourceRoot, { recursive: true });
      await fs.promises.symlink(
        externalSourceRoot,
        sourceRoot,
        process.platform === "win32" ? "junction" : "dir",
      );
      await waitForEvent(events, "framework-update-failed");

      const failuresBeforeExternalEdits = await waitForEventCountToStabilize(
        events,
        "framework-update-failed",
      );
      await writeFile(
        externalPage,
        "export default function ChangedOutsidePage() { return null; }",
        "utf-8",
      );
      await writeFile(
        externalApi,
        "export const GET = async () => Response.json({ outside: false });",
        "utf-8",
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(
        events.filter((event) => event === "framework-update-failed"),
      ).toHaveLength(failuresBeforeExternalEdits);

      await fs.promises.rm(sourceRoot);
      await writeFile(
        path.join(sourceRoot, "pages/page.tsx"),
        "export default function RecoveredPage() { return null; }",
        "utf-8",
      );
      await writeFile(
        path.join(sourceRoot, "apis/recovered/api.ts"),
        "export const GET = async () => Response.json({ recovered: true });",
        "utf-8",
      );

      await Promise.race([
        running,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("source symlink recovery timed out")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);

      expect(events).toContain("recovered-source");
    } finally {
      stopCapturingFailures();
    }
  });

  it("continues watching an empty api route directory after its last anchor is removed", async () => {
    const cwd = await createProject();
    const routeFile = path.join(cwd, "src/apis/users/api.ts");
    await writeFile(
      routeFile,
      "export const GET = async () => Response.json([]);",
      "utf-8",
    );
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ plan }) {
        events.push(
          `initial-server:${plan.entries.some((entry) => entry.kind === "server-runtime")}`,
        );
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            const removedServer = update.entries.removed.some(
              (entry) => entry.kind === "server-runtime",
            );
            const addedServer = update.entries.added.some(
              (entry) => entry.kind === "server-runtime",
            );
            if (removedServer) events.push("removed-server");
            if (addedServer) {
              events.push("restored-server");
              process.emit("SIGINT");
            }
          },
        });
      },
    };

    const running = dev(
      { output: { client: "dist/client", server: "dist/server" } },
      { cwd, bundler },
    );
    await waitForEvent(events, "initial-server:true");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.promises.rm(routeFile);
    await waitForEvent(events, "removed-server");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(
      routeFile,
      "export const GET = async () => Response.json([{ id: 1 }]);",
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("restored dev api route update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "initial-server:true",
      "removed-server",
      "restored-server",
    ]);
  });

  it("passes config-only dev reloads to the bundler controller", async () => {
    const cwd = await createSpaProject();
    const configPath = path.join(cwd, "ev.config.ts");
    await writeFile(configPath, "export default {};", "utf-8");
    const events: string[] = [];
    let currentConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            events.push(
              [
                "update",
                options?.configChanged,
                update.entries.added.length,
                update.entries.removed.length,
                update.entries.changed.length,
                options?.config.dev.proxy[0]?.target,
              ].join(":"),
            );
            process.emit("SIGINT");
          },
        });
      },
    };

    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });
    await waitForEvent(events, "bundler.dev");
    currentConfig = {
      ...currentConfig,
      dev: {
        proxy: [
          {
            context: ["/api"],
            target: "https://example.com",
          },
        ],
      },
    };
    await writeFile(configPath, "export default { dev: {} };", "utf-8");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev config-only update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "bundler.dev",
      "update:true:0:0:0:https://example.com",
    ]);
  });

  it("runs semantic-empty source changes through a fresh generation", async () => {
    const cwd = await createSpaProject();
    const sourceDependency = path.join(cwd, "semantic-source.txt");
    await writeFile(sourceDependency, "initial", "utf-8");
    const events: string[] = [];
    let postFinalizeFactsError: unknown;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "semantic-empty-generation",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ callbacks, generation, plan }) {
        let currentGeneration = generation;
        const clientEntry = plan.entries.find(
          (entry) => entry.environment === "client",
        );
        const facts: BundlerBuildFacts = clientEntry
          ? {
              clientEntryAssets: {
                [clientEntry.name]: { js: ["main.js"], css: [] },
              },
            }
          : {};
        events.push("bundler.dev");
        return createTestDevController(
          {
            async updatePlan(update, options) {
              expect(isEmptyBuildPlanUpdate(update)).toBe(true);
              options.activate();
              currentGeneration = options.generation;
              events.push("update:empty");
            },
          },
          {
            onBegin() {
              events.push("boundary:begin");
            },
            async onResume(outcome) {
              expect(outcome).toBe("accept");
              events.push("resume:accept");
              await callbacks.onBuildFacts(currentGeneration, facts, {
                isRebuild: true,
              });
              events.push("facts:fresh");
            },
            onFinalize() {
              events.push("transition:finalize");
              void Promise.resolve(
                callbacks.onBuildFacts(currentGeneration, facts, {
                  isRebuild: true,
                }),
              )
                .then((disposition) => {
                  events.push(`facts:post-finalize:${disposition}`);
                  process.emit("SIGINT");
                })
                .catch((error) => {
                  postFinalizeFactsError = error;
                  process.emit("SIGINT");
                });
            },
          },
        );
      },
    };

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [
          {
            name: "semantic-empty-output",
            setup(ctx) {
              ctx.addWatchFile("./semantic-source.txt");
              return {
                buildEnd(result) {
                  events.push(`buildEnd:${result.isRebuild}`);
                },
              };
            },
          },
        ],
      },
      { cwd, bundler },
    );
    await waitForEvent(events, "bundler.dev");
    await writeFile(sourceDependency, "changed", "utf-8");
    await Promise.race([
      running,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("semantic-empty update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);
    if (postFinalizeFactsError) throw postFinalizeFactsError;

    expect(events).toEqual([
      "bundler.dev",
      "boundary:begin",
      "update:empty",
      "resume:accept",
      "buildEnd:true",
      "facts:fresh",
      "transition:finalize",
      "buildEnd:true",
      "facts:post-finalize:published",
    ]);
  });

  it("does not materialize candidate .ev input without a dev controller", async () => {
    const cwd = await createSpaProject();
    const bundlerDependency = path.join(cwd, "bundler.config.json");
    await writeFile(bundlerDependency, '{"mode":"initial"}', "utf-8");
    const generatedRoot = path.join(cwd, ".ev");
    const events: string[] = [];
    const generatedWrites: string[] = [];
    let recordGeneratedWrites = false;
    const originalWriteFile = fsPromises.writeFile.bind(fsPromises);
    const writeSpy = vi
      .spyOn(fsPromises, "writeFile")
      .mockImplementation((async (
        ...args: Parameters<typeof fsPromises.writeFile>
      ) => {
        const file = path.resolve(String(args[0]));
        if (
          recordGeneratedWrites &&
          (file === generatedRoot ||
            file.startsWith(`${generatedRoot}${path.sep}`))
        ) {
          generatedWrites.push(file);
        }
        return originalWriteFile(...args);
      }) as typeof fsPromises.writeFile);
    const stopCapturingRestart = captureFrameworkWarning(
      events,
      "The selected bundler does not expose a dev controller.",
      "Please restart ev dev",
      "restart-required",
    );
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "no-dev-controller",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile }) {
        addWatchFile?.(bundlerDependency);
        events.push("bundler.dev");
      },
    };
    const running = dev(
      { output: { client: "dist/client", server: "dist/server" } },
      { cwd, bundler },
    );
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, "bundler.dev");
      const initialGeneratedState = await readDirectorySnapshot(generatedRoot);
      recordGeneratedWrites = true;
      await writeFile(bundlerDependency, '{"mode":"changed"}', "utf-8");
      await waitForEvent(events, "restart-required");
      expect(generatedWrites).toEqual([]);
      expect(await readDirectorySnapshot(generatedRoot)).toEqual(
        initialGeneratedState,
      );
      process.emit("SIGINT");
      await running;
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => undefined);
      }
      stopCapturingRestart();
      writeSpy.mockRestore();
    }

    expect(events).toEqual(["bundler.dev", "restart-required"]);
  });

  it("keeps every config extension candidate watched across replacements", async () => {
    const cwd = await createSpaProject();
    const tsConfigPath = path.join(cwd, "ev.config.ts");
    const mjsConfigPath = path.join(cwd, "ev.config.mjs");
    await writeFile(tsConfigPath, "export default {};", "utf-8");
    const events: string[] = [];
    let configLabel = "initial";
    let loadConfigCalls = 0;
    let updateCount = 0;
    const currentConfig = (): Config<Record<string, never>> => ({
      dev: {
        proxy: [
          {
            context: ["/api"],
            target: `https://${configLabel}.example`,
          },
        ],
      },
      output: { client: "dist/client", server: "dist/server" },
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "config-extension-replacement",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(_update, options) {
            options.activate();
            updateCount += 1;
            events.push(
              `update:${updateCount}:${options?.configChanged}:${options?.config.dev.proxy[0]?.target}`,
            );
            if (updateCount === 2) process.emit("SIGINT");
          },
        });
      },
    };
    const running = dev(currentConfig(), {
      cwd,
      bundler,
      loadConfig() {
        loadConfigCalls += 1;
        return currentConfig();
      },
    });

    await waitForEvent(events, "bundler.dev");
    configLabel = "without-ts";
    await fs.promises.unlink(tsConfigPath);
    await waitForEvent(events, "update:1:true:https://without-ts.example");

    configLabel = "from-mjs";
    await writeFile(mjsConfigPath, "export default {};", "utf-8");
    await Promise.race([
      running,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("config extension replacement timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(loadConfigCalls).toBe(2);
    expect(events).toEqual([
      "bundler.dev",
      "update:1:true:https://without-ts.example",
      "update:2:true:https://from-mjs.example",
    ]);
  });

  it("reloads when only an imported ev.config helper changes", async () => {
    const cwd = await createSpaProject();
    const configPath = path.join(cwd, "ev.config.ts");
    const helper = path.join(cwd, "src/config/dev-settings.ts");
    await writeFile(
      helper,
      'export const target = "https://initial.example";',
      "utf-8",
    );
    await writeFile(
      configPath,
      [
        'import { target } from "./src/config/dev-settings.js";',
        "export default {",
        '  output: { client: "dist/client", server: "dist/server" },',
        '  dev: { proxy: [{ context: ["/api"], target }] },',
        "};",
      ].join("\n"),
      "utf-8",
    );
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "imported-config-helper",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ config }) {
        events.push(`initial:${config.dev.proxy[0]?.target}`);
        return createTestDevController({
          async updatePlan(_update, options) {
            options.activate();
            events.push(
              `update:${options?.configChanged}:${options?.config.dev.proxy[0]?.target}`,
            );
            process.emit("SIGINT");
          },
        });
      },
    };

    const running = dev(undefined, {
      cwd,
      bundler,
      reloadInitialConfig: true,
      loadConfig(_cwd, context) {
        return loadConfigFile<Record<string, never>>(configPath, {
          onDependency: context?.onDependency,
        });
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, "initial:https://initial.example");
      await writeFile(
        helper,
        'export const target = "https://updated.example";',
        "utf-8",
      );

      await Promise.race([
        running,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("imported config helper update timed out")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => undefined);
      }
    }

    expect(events).toEqual([
      "initial:https://initial.example",
      "update:true:https://updated.example",
    ]);
  });

  it("fails closed when a bundlerConfig watch dependency changes", async () => {
    const cwd = await createSpaProject();
    const dependency = path.join(cwd, "bundler-plugin.config.json");
    await writeFile(dependency, '{"mode":"initial"}', "utf-8");
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile }) {
        addWatchFile?.(dependency);
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            events.push(
              [
                "update",
                options?.configChanged,
                update.entries.added.length,
                update.entries.removed.length,
                update.entries.changed.length,
              ].join(":"),
            );
            process.emit("SIGINT");
          },
        });
      },
    };

    const running = dev(
      { output: { client: "dist/client", server: "dist/server" } },
      { cwd, bundler },
    );
    await waitForEvent(events, "bundler.dev");
    await writeFile(dependency, '{"mode":"changed"}', "utf-8");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("bundlerConfig dependency update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual(["bundler.dev", "update:true:0:0:0"]);
  });

  it("uses the next plugin context for build facts emitted during a bundlerConfig reload", async () => {
    const cwd = await createSpaProject();
    const dependency = path.join(cwd, "bundler-plugin.config.json");
    await writeFile(dependency, '{"mode":"initial"}', "utf-8");
    const events: string[] = [];
    let markCandidateContributionStarted: (() => void) | undefined;
    const candidateContributionStarted = new Promise<void>((resolve) => {
      markCandidateContributionStarted = resolve;
    });
    let releaseCandidateContribution: (() => void) | undefined;
    const candidateContributionGate = new Promise<void>((resolve) => {
      releaseCandidateContribution = resolve;
    });
    const plugin: Plugin<Record<string, never>> = {
      name: "reload-context",
      async contributions(ctx) {
        if (ctx.config.dev.proxy[0]?.target === "https://example.com") {
          markCandidateContributionStarted?.();
          await candidateContributionGate;
        }
      },
      setup(ctx) {
        const setupTarget = ctx.config.dev.proxy[0]?.target ?? "initial";
        events.push(`setup:${setupTarget}`);
        return {
          buildOutput(_output, buildContext) {
            events.push(
              `buildOutput:${setupTarget}:${buildContext.config.dev.proxy[0]?.target}`,
            );
          },
          dispose() {
            events.push(`dispose:${setupTarget}`);
          },
        };
      },
    };
    let currentConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      plugins: [plugin],
    };
    let emitActiveBuildFacts:
      | (() => Promise<BundlerBuildFactsDisposition>)
      | undefined;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile, callbacks, generation, plan }) {
        addWatchFile?.(dependency);
        let currentGeneration = generation;
        const clientEntry = plan.entries.find(
          (entry) => entry.environment === "client",
        );
        const facts: BundlerBuildFacts = clientEntry
          ? {
              clientEntryAssets: {
                [clientEntry.name]: { js: ["main.js"], css: [] },
              },
            }
          : {};
        emitActiveBuildFacts = async () =>
          await callbacks.onBuildFacts(currentGeneration, facts, {
            isRebuild: true,
          });
        events.push("bundler.dev");
        return createTestDevController(
          {
            async updatePlan(_update, options) {
              options.activate();
              currentGeneration = options.generation;
              events.push(`update:${options.configChanged}`);
            },
          },
          {
            async onResume(outcome) {
              expect(outcome).toBe("accept");
              await callbacks.onBuildFacts(currentGeneration, facts, {
                isRebuild: true,
              });
              events.push("candidate:fresh");
              process.emit("SIGINT");
            },
          },
        );
      },
    };

    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });
    await waitForEvent(events, "bundler.dev");
    currentConfig = {
      ...currentConfig,
      dev: {
        proxy: [
          {
            context: ["/api"],
            target: "https://example.com",
          },
        ],
      },
    };
    await writeFile(dependency, '{"mode":"changed"}', "utf-8");

    try {
      await candidateContributionStarted;
      await expect(emitActiveBuildFacts?.()).resolves.toBe("discarded");
      events.push("boundary:discarded");
      releaseCandidateContribution?.();
      await Promise.race([
        running,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("bundlerConfig context update timed out")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);
    } finally {
      releaseCandidateContribution?.();
    }

    expect(events).toEqual([
      "setup:initial",
      "bundler.dev",
      "setup:https://example.com",
      "boundary:discarded",
      "update:true",
      "buildOutput:https://example.com:https://example.com",
      "candidate:fresh",
      "dispose:initial",
      "dispose:https://example.com",
    ]);
  });

  it("binds late old facts to their original snapshot until generation commit", async () => {
    const cwd = await createSpaProject();
    const dependency = path.join(cwd, "bundler-plugin.config.json");
    await writeFile(dependency, '{"mode":"initial"}', "utf-8");
    const events: string[] = [];

    const createSnapshotPlugin = (
      snapshot: "new" | "old",
    ): Plugin<Record<string, never>> => ({
      name: "late-generation-snapshot",
      setup(ctx) {
        const setupTarget = ctx.config.dev.proxy[0]?.target ?? "initial";
        events.push(`setup:${snapshot}:${setupTarget}`);
        return {
          buildOutput(_output, buildContext) {
            const buildTarget =
              buildContext.config.dev.proxy[0]?.target ?? "initial";
            events.push(`buildOutput:${snapshot}:${buildTarget}`);
          },
          dispose(disposeContext) {
            const disposeTarget =
              disposeContext.config.dev.proxy[0]?.target ?? "initial";
            events.push(`dispose:${snapshot}:${disposeTarget}`);
          },
        };
      },
    });

    const oldConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      plugins: [createSnapshotPlugin("old")],
      routing: { mode: "spa" },
    };
    const nextConfig: Config<Record<string, never>> = {
      ...oldConfig,
      dev: {
        proxy: [
          {
            context: ["/api"],
            target: "https://next.example",
          },
        ],
      },
      plugins: [createSnapshotPlugin("new")],
    };
    let currentConfig = oldConfig;
    let emitRetiredFacts:
      | (() => Promise<BundlerBuildFactsDisposition>)
      | undefined;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "late-generation-snapshot",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile, callbacks, generation, plan }) {
        addWatchFile?.(dependency);
        const clientEntry = plan.entries.find(
          (entry) => entry.environment === "client",
        );
        const facts: BundlerBuildFacts = clientEntry
          ? {
              clientEntryAssets: {
                [clientEntry.name]: { js: ["main.js"], css: [] },
              },
            }
          : {};
        emitRetiredFacts = async () =>
          await callbacks.onBuildFacts(generation, facts, {
            isRebuild: true,
          });
        events.push("bundler.dev");
        let candidateGeneration = generation;
        return createTestDevController(
          {
            async updatePlan(_update, options) {
              options.activate();
              candidateGeneration = options.generation;
              events.push("generation:activated");
              await expect(
                callbacks.onBuildFacts(generation, facts, {
                  isRebuild: true,
                }),
              ).resolves.toBe("discarded");
              events.push("boundary:old-discarded");
              await expect(
                callbacks.onBuildFacts(candidateGeneration, facts, {
                  isRebuild: true,
                }),
              ).resolves.toBe("discarded");
              events.push("boundary:candidate-discarded");
              events.push("update:return");
            },
          },
          {
            async onResume(outcome) {
              expect(outcome).toBe("accept");
              await callbacks.onBuildFacts(candidateGeneration, facts, {
                isRebuild: true,
              });
              events.push("candidate:fresh");
            },
          },
        );
      },
    };

    const running = dev(oldConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, "bundler.dev");
      currentConfig = nextConfig;
      await writeFile(dependency, '{"mode":"changed"}', "utf-8");
      await waitForEvent(events, "dispose:old:initial");

      const emitRetired = emitRetiredFacts;
      if (!emitRetired) {
        throw new Error("Expected a retained old-generation callback.");
      }
      await expect(emitRetired()).resolves.toBe("discarded");
      events.push("retired:discarded");
      process.emit("SIGINT");
      await running;
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
    }

    expect(events).toEqual([
      "setup:old:initial",
      "bundler.dev",
      "setup:new:https://next.example",
      "generation:activated",
      "boundary:old-discarded",
      "boundary:candidate-discarded",
      "update:return",
      "buildOutput:new:https://next.example",
      "candidate:fresh",
      "dispose:old:initial",
      "retired:discarded",
      "dispose:new:https://next.example",
    ]);
  });

  it.each([
    {
      behavior: "publish-staged",
      expectedError:
        "publishing output before activating its staged generation",
    },
    {
      behavior: "omit-activation",
      expectedError: "completing updatePlan() without calling activate()",
    },
    {
      behavior: "activate-twice",
      expectedError: "calling updatePlan().activate() more than once",
    },
  ] as const)("rejects a bundler generation contract violation: $behavior", async ({
    behavior,
    expectedError,
  }) => {
    const cwd = await createSpaProject();
    const dependency = path.join(cwd, "bundler-plugin.config.json");
    await writeFile(dependency, '{"mode":"initial"}', "utf-8");
    const events: string[] = [];
    const stopCapturingRollback = captureFrameworkWarning(
      events,
      "Unable to apply framework plan update without restart:",
      expectedError,
      "update:rolled-back",
    );
    let emitOldFacts: (() => Promise<void>) | undefined;
    const config: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "spa" },
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: `generation-contract-${behavior}`,
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile, callbacks, generation, plan }) {
        addWatchFile?.(dependency);
        const clientEntry = plan.entries.find(
          (entry) => entry.environment === "client",
        );
        const facts: BundlerBuildFacts = clientEntry
          ? {
              clientEntryAssets: {
                [clientEntry.name]: { js: ["main.js"], css: [] },
              },
            }
          : {};
        emitOldFacts = async () => {
          await callbacks.onBuildFacts(generation, facts, {
            isRebuild: true,
          });
        };
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(_update, options) {
            events.push(`update:${behavior}`);
            if (behavior === "publish-staged") {
              await callbacks.onBuildFacts(options.generation, facts, {
                isRebuild: true,
              });
              return;
            }
            if (behavior === "activate-twice") {
              options.activate();
              options.activate();
            }
          },
        });
      },
    };
    const running = dev(config, {
      cwd,
      bundler,
      loadConfig() {
        return config;
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, "bundler.dev");
      await writeFile(dependency, '{"mode":"changed"}', "utf-8");
      await waitForEvent(events, "update:rolled-back");
      const emitOld = emitOldFacts;
      if (!emitOld) throw new Error("Expected an old-generation callback.");
      await emitOld();
      events.push("old:accepted");
      process.emit("SIGINT");
      await running;
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      stopCapturingRollback();
    }

    expect(events).toEqual([
      "bundler.dev",
      `update:${behavior}`,
      "update:rolled-back",
      "old:accepted",
    ]);
  });

  it(
    "drains in-flight output before opening a config transition and publishes fresh candidate facts",
    async () => {
      const cwd = await createSpaProject();
      const dependency = path.join(cwd, "bundler-plugin.config.json");
      await writeFile(dependency, '{"mode":"initial"}', "utf-8");

      type FakeDevWatcher = EventEmitter & {
        close: ReturnType<typeof vi.fn>;
        ref(): fs.FSWatcher;
        unref(): fs.FSWatcher;
      };
      const watchRecords: Array<{
        listener: (
          eventType: fs.WatchEventType,
          filename: string | Buffer | null,
        ) => void;
        target: string;
        watcher: FakeDevWatcher;
      }> = [];
      const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
        ...args: unknown[]
      ) => {
        const watcher = new EventEmitter() as FakeDevWatcher;
        watcher.close = vi.fn();
        watcher.ref = () => watcher as fs.FSWatcher;
        watcher.unref = () => watcher as fs.FSWatcher;
        watchRecords.push({
          listener: args.at(-1) as (typeof watchRecords)[number]["listener"],
          target: path.resolve(String(args[0])),
          watcher,
        });
        return watcher;
      }) as never);

      const events: string[] = [];
      let markOldOutputStarted: (() => void) | undefined;
      const oldOutputStarted = new Promise<void>((resolve) => {
        markOldOutputStarted = resolve;
      });
      let releaseOldOutput: (() => void) | undefined;
      const oldOutputGate = new Promise<void>((resolve) => {
        releaseOldOutput = resolve;
      });
      let oldOutputBlocked = false;

      function createSnapshotPlugin(
        name: string,
        snapshot: "old" | "new",
        blockFirstOutput = false,
      ): Plugin<Record<string, never>> {
        return {
          name,
          setup(ctx) {
            const setupTarget = ctx.config.dev.proxy[0]?.target ?? "initial";
            return {
              async buildOutput(_output, buildContext) {
                const buildTarget =
                  buildContext.config.dev.proxy[0]?.target ?? "initial";
                events.push(
                  `buildOutput:${name}:${snapshot}:start:${buildTarget}`,
                );
                if (blockFirstOutput && !oldOutputBlocked) {
                  oldOutputBlocked = true;
                  markOldOutputStarted?.();
                  await oldOutputGate;
                }
                events.push(
                  `buildOutput:${name}:${snapshot}:end:${buildTarget}`,
                );
              },
              buildEnd() {
                events.push(`buildEnd:${name}:${snapshot}`);
              },
              transformHtml(document) {
                events.push(`transformHtml:${name}:${snapshot}`);
                document.body?.appendChild(
                  document.createComment(` snapshot:${snapshot} `),
                );
              },
              dispose(disposeContext) {
                const disposeTarget =
                  disposeContext.config.dev.proxy[0]?.target ?? "initial";
                events.push(
                  `dispose:${name}:${snapshot}:${setupTarget}:${disposeTarget}`,
                );
              },
            };
          },
        };
      }

      const oldConfig: Config<Record<string, never>> = {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [
          createSnapshotPlugin("first", "old", true),
          createSnapshotPlugin("second", "old"),
        ],
        routing: { mode: "spa" },
      };
      const nextConfig: Config<Record<string, never>> = {
        ...oldConfig,
        dev: {
          proxy: [
            {
              context: ["/api"],
              target: "https://next.example",
            },
          ],
        },
        plugins: [
          createSnapshotPlugin("first", "new"),
          createSnapshotPlugin("second", "new"),
        ],
      };
      let currentConfig = oldConfig;
      let emitBuildFacts: (() => Promise<void>) | undefined;
      let inFlightOldCycle: Promise<void> | undefined;
      let markUpdateStarted: (() => void) | undefined;
      const updateStarted = new Promise<void>((resolve) => {
        markUpdateStarted = resolve;
      });
      const bundler: BundlerAdapter<Record<string, never>> = {
        name: "plugin-snapshot-output-cycle",
        capabilities: fullBundlerCapabilities,
        async build() {
          return {};
        },
        async dev({ addWatchFile, callbacks, generation, plan }) {
          addWatchFile?.(dependency);
          let currentGeneration = generation;
          const clientEntry = plan.entries.find(
            (entry) => entry.environment === "client",
          );
          const facts: BundlerBuildFacts = clientEntry
            ? {
                clientEntryAssets: {
                  [clientEntry.name]: { js: ["main.js"], css: [] },
                },
              }
            : {};
          emitBuildFacts = async () => {
            await callbacks.onBuildFacts(currentGeneration, facts, {
              isRebuild: true,
            });
          };
          events.push("bundler.dev");
          return createTestDevController(
            {
              async updatePlan(_update, options) {
                events.push("update");
                markUpdateStarted?.();
                options.activate();
                currentGeneration = options.generation;
              },
            },
            {
              async onBegin() {
                events.push("boundary:waiting");
                await inFlightOldCycle;
                events.push("boundary:ready");
              },
              async onResume(outcome) {
                expect(outcome).toBe("accept");
                const nextCycle = emitBuildFacts?.();
                if (!nextCycle) {
                  throw new Error("Expected a fresh build-facts callback.");
                }
                events.push("next-cycle:fresh");
                await nextCycle;
              },
            },
          );
        },
      };
      const running = dev(oldConfig, {
        cwd,
        bundler,
        loadConfig() {
          return currentConfig;
        },
      });
      let settled = false;
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      try {
        await waitForEvent(events, "bundler.dev");
        const firstCycle = emitBuildFacts?.();
        if (!firstCycle) throw new Error("Expected a build-facts callback.");
        inFlightOldCycle = firstCycle;
        await oldOutputStarted;

        currentConfig = nextConfig;
        let dependencyWatcher: (typeof watchRecords)[number] | undefined;
        await vi.waitFor(() => {
          dependencyWatcher = watchRecords
            .slice()
            .reverse()
            .find(
              (record) =>
                record.target === path.dirname(dependency) &&
                record.watcher.close.mock.calls.length === 0,
            );
          expect(dependencyWatcher).toBeDefined();
        });
        if (!dependencyWatcher) {
          throw new Error("Expected the bundler config dependency watcher.");
        }
        dependencyWatcher.listener("change", path.basename(dependency));

        await waitForEvent(events, "boundary:waiting");
        expect(events).not.toContain("update");
        releaseOldOutput?.();
        await firstCycle;
        await updateStarted;
        await waitForEvent(events, "dispose:first:old:initial:initial");
        process.emit("SIGINT");
        await running;
      } finally {
        releaseOldOutput?.();
        if (!settled) {
          process.emit("SIGINT");
          await running.catch(() => {});
        }
        watchSpy.mockRestore();
      }

      expect(events).toEqual([
        "bundler.dev",
        "buildOutput:first:old:start:initial",
        "boundary:waiting",
        "buildOutput:first:old:end:initial",
        "buildOutput:second:old:start:initial",
        "buildOutput:second:old:end:initial",
        "transformHtml:first:old",
        "transformHtml:second:old",
        "buildEnd:first:old",
        "buildEnd:second:old",
        "boundary:ready",
        "update",
        "next-cycle:fresh",
        "buildOutput:first:new:start:https://next.example",
        "buildOutput:first:new:end:https://next.example",
        "buildOutput:second:new:start:https://next.example",
        "buildOutput:second:new:end:https://next.example",
        "transformHtml:first:new",
        "transformHtml:second:new",
        "buildEnd:first:new",
        "buildEnd:second:new",
        "dispose:second:old:initial:initial",
        "dispose:first:old:initial:initial",
        "dispose:second:new:https://next.example:https://next.example",
        "dispose:first:new:https://next.example:https://next.example",
      ]);
      const html = await fs.promises.readFile(
        path.join(cwd, "dist/client/index.html"),
        "utf-8",
      );
      expect(html).toContain("snapshot:new");
      expect(html).not.toContain("snapshot:old");
    },
    devUpdateTimeoutMs + 1_000,
  );

  it("restores the previous plugin snapshot before awaiting rollback disposal", async () => {
    const cwd = await createSpaProject();
    const dependency = path.join(cwd, "bundler-plugin.config.json");
    await writeFile(dependency, '{"mode":"initial"}', "utf-8");
    const events: string[] = [];
    const stopCapturingRollback = captureFrameworkWarning(
      events,
      "Unable to apply framework plan update without restart:",
      "mock snapshot rollback failure",
      "config-update-rolled-back",
    );
    let markCandidateDisposeStarted: (() => void) | undefined;
    const candidateDisposeStarted = new Promise<void>((resolve) => {
      markCandidateDisposeStarted = resolve;
    });
    let releaseCandidateDispose: (() => void) | undefined;
    const candidateDisposeGate = new Promise<void>((resolve) => {
      releaseCandidateDispose = resolve;
    });
    const plugin: Plugin<Record<string, never>> = {
      name: "rollback-snapshot-context",
      setup(ctx) {
        const setupTarget = ctx.config.dev.proxy[0]?.target ?? "initial";
        events.push(`setup:${setupTarget}`);
        return {
          buildOutput(_output, buildContext) {
            events.push(
              `buildOutput:${setupTarget}:${buildContext.config.dev.proxy[0]?.target}`,
            );
          },
          async dispose(disposeContext) {
            const disposeTarget =
              disposeContext.config.dev.proxy[0]?.target ?? "initial";
            events.push(`dispose:${setupTarget}:${disposeTarget}:start`);
            if (setupTarget === "https://example.com") {
              markCandidateDisposeStarted?.();
              await candidateDisposeGate;
            }
            events.push(`dispose:${setupTarget}:${disposeTarget}:end`);
          },
        };
      },
    };
    let currentConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      plugins: [plugin],
    };
    let emitActiveBuildFacts:
      | (() => Promise<BundlerBuildFactsDisposition>)
      | undefined;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "rollback-snapshot-context",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile, callbacks, generation, plan }) {
        addWatchFile?.(dependency);
        const clientEntry = plan.entries.find(
          (entry) => entry.environment === "client",
        );
        const facts: BundlerBuildFacts = clientEntry
          ? {
              clientEntryAssets: {
                [clientEntry.name]: { js: ["main.js"], css: [] },
              },
            }
          : {};
        emitActiveBuildFacts = async () =>
          await callbacks.onBuildFacts(generation, facts, {
            isRebuild: true,
          });
        events.push("bundler.dev");
        return createTestDevController(
          {
            async updatePlan() {
              events.push("update");
              throw new Error("mock snapshot rollback failure");
            },
          },
          {
            async onResume(outcome) {
              expect(outcome).toBe("rollback");
              await emitActiveBuildFacts?.();
              events.push("rollback:fresh");
            },
          },
        );
      },
    };
    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, "bundler.dev");
      currentConfig = {
        ...currentConfig,
        dev: {
          proxy: [
            {
              context: ["/api"],
              target: "https://example.com",
            },
          ],
        },
      };
      await writeFile(dependency, '{"mode":"changed"}', "utf-8");
      await candidateDisposeStarted;
      await expect(emitActiveBuildFacts?.()).resolves.toBe("discarded");
      events.push("boundary:discarded");
      releaseCandidateDispose?.();
      await waitForEvent(events, "config-update-rolled-back");
      process.emit("SIGINT");
      await running;
    } finally {
      releaseCandidateDispose?.();
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      stopCapturingRollback();
    }

    expect(events).toEqual([
      "setup:initial",
      "bundler.dev",
      "setup:https://example.com",
      "update",
      "dispose:https://example.com:https://example.com:start",
      "boundary:discarded",
      "dispose:https://example.com:https://example.com:end",
      "buildOutput:initial:undefined",
      "rollback:fresh",
      "config-update-rolled-back",
      "dispose:initial:initial:start",
      "dispose:initial:initial:end",
    ]);
  });

  it("writes generated SPA route types before starting the dev bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ plan }) {
        events.push(`entry:${plan.entries[0]?.import}`);
        events.push(
          `routeTypes:${fs.existsSync(path.join(cwd, "src/route-types.d.ts"))}`,
        );
        process.emit("SIGINT");
      },
    };

    await Promise.race([
      dev(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        { cwd, bundler },
      ),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev startup timed out")),
          devStartupTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual(["entry:./.ev/entries/main.ts", "routeTypes:true"]);
    await expect(
      fs.promises.readFile(path.join(cwd, "src/route-types.d.ts"), "utf-8"),
    ).resolves.toContain('import type * as EvPage_index from "./pages/page";');
  });

  it("removes stale generated route types before starting MPA dev", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/route-types.d.ts"),
      generatedRouteTypesSource,
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ plan }) {
        events.push(`entry:${plan.entries[0]?.kind}`);
        events.push(
          `routeTypes:${fs.existsSync(path.join(cwd, "src/route-types.d.ts"))}`,
        );
        process.emit("SIGINT");
      },
    };

    await Promise.race([
      dev(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: {
            mode: "mpa",
          },
        },
        { cwd, bundler },
      ),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev startup timed out")),
          devStartupTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual(["entry:page-client", "routeTypes:false"]);
    expect(fs.existsSync(path.join(cwd, "src/route-types.d.ts"))).toBe(false);
  });

  it("logs every MPA page URL after starting dev", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/users"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/about/page.tsx"),
      "export default function About() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/report/page.tsx"),
      "export default function Report() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/report/page.config.ts"),
      'export default { render: "ssr" };',
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/users/alice/page.tsx"),
      "export default function User() { return null; }",
      "utf-8",
    );

    const logs: string[] = [];
    configureSync({
      reset: true,
      sinks: {
        memory(record) {
          logs.push(record.message.map(String).join(""));
        },
      },
      loggers: [
        { category: ["logtape", "meta"], lowestLevel: "fatal" },
        { category: ["evjs"], sinks: ["memory"], lowestLevel: "info" },
      ],
    });

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ callbacks }) {
        await callbacks.onDevServerReady?.({
          origin: "http://localhost:4123",
        });
        process.emit("SIGINT");
      },
    };

    try {
      await Promise.race([
        dev(
          {
            output: { client: "dist/client", server: "dist/server" },
            dev: { port: 4123 },
            routing: { mode: "mpa" },
          },
          { cwd, bundler },
        ),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("dev startup timed out")),
            devStartupTimeoutMs,
          ),
        ),
      ]);
    } finally {
      resetSync();
    }

    const readyLog = logs.find((log) => log.startsWith("App listening at:"));
    expect(readyLog).toContain("  Local: http://localhost:4123");
    expect(readyLog).not.toContain("Loopback:");
    expect(readyLog).toContain("  Pages:");
    expect(readyLog).toContain("    index: http://localhost:4123/index.html");
    expect(readyLog).toContain(
      "    about: http://localhost:4123/about/index.html",
    );
    expect(readyLog).toContain(
      "    users_alice: http://localhost:4123/users/alice/index.html",
    );
    expect(readyLog).toContain("    report: http://localhost:4123/report");

    const hasNetworkAddress = Object.values(os.networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .some((entry) => entry.family === "IPv4" && !entry.internal);
    expect(readyLog?.includes("  Network: ")).toBe(hasNetworkAddress);
  });

  it("updates generated SPA route types when a nested page route is added during dev", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/posts"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/posts/page.tsx"),
      "export default function Posts() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createRouteUpdateBundler(cwd, events, "/posts/$postId");

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      { cwd, bundler },
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(
      path.join(cwd, "src/pages/posts/$postId/page.tsx"),
      "export default function Post() { return null; }",
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev route update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "initial:/,/posts",
      "changed:/,/posts,/posts/$postId",
      "types:true",
    ]);
  });

  it("updates generated SPA route types when a new nested route directory is populated during dev", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createRouteUpdateBundler(cwd, events, "/admin");

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      { cwd, bundler },
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.promises.mkdir(path.join(cwd, "src/pages/admin"), {
      recursive: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await writeFile(
      path.join(cwd, "src/pages/admin/page.tsx"),
      "export default function Admin() { return null; }",
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev route update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual(["initial:/", "changed:/,/admin", "types:true"]);
  });

  it("updates generated SPA route types when a page route is deleted during dev", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/posts"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/posts/page.tsx"),
      "export default function Posts() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/posts/$postId/page.tsx"),
      "export default function Post() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createRouteUpdateBundler(cwd, events, "/posts/$postId");

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      },
      { cwd, bundler },
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.promises.rm(path.join(cwd, "src/pages/posts/$postId/page.tsx"));

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev route update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "initial:/,/posts,/posts/$postId",
      "changed:/,/posts",
      "types:false",
    ]);
  });

  it("restores committed plugin and generated state when a route update fails", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      name: "observe-committed-config",
      setup() {
        return {
          dispose(ctx) {
            events.push(`dispose-routes:${ctx.config.routing?.routes.length}`);
          },
        };
      },
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan() {
            const candidateRouteTypes = await fs.promises.readFile(
              path.join(cwd, "src/route-types.d.ts"),
              "utf-8",
            );
            events.push(
              `candidate-types:${candidateRouteTypes.includes(JSON.stringify("/about"))}`,
            );
            events.push("update:throw");
            throw new Error("mock update failure");
          },
        });
      },
    };

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      { cwd, bundler },
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    const routeTypesPath = path.join(cwd, "src/route-types.d.ts");
    const generatedIrPath = path.join(cwd, ".ev");
    const initialRouteTypes = await fs.promises.readFile(routeTypesPath);
    const initialGeneratedIr = await readDirectorySnapshot(generatedIrPath);
    await writeFile(
      path.join(cwd, "src/pages/about/page.tsx"),
      "export default function About() { return null; }",
      "utf-8",
    );
    await waitForEvent(events, "update:throw");
    await waitForFileContents(routeTypesPath, initialRouteTypes);
    expect(await readDirectorySnapshot(generatedIrPath)).toEqual(
      initialGeneratedIr,
    );
    process.emit("SIGINT");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev shutdown timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "bundler.dev",
      "candidate-types:true",
      "update:throw",
      "dispose-routes:1",
    ]);
  });

  it("preserves user-owned generated declaration replacements during rollback", async () => {
    const cwd = await createSpaProject();
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default {};",
      "utf-8",
    );
    const routeTypesPath = path.join(cwd, "src/route-types.d.ts");
    const pluginTypesPath = path.join(cwd, "src/plugin-types.d.ts");
    const userRouteTypes = "declare const userRouteTypes: true;\n";
    const userPluginTypes = "declare const userPluginTypes: true;\n";
    const events: string[] = [];
    const stopCapturingConflicts =
      captureGeneratedTypeRollbackConflicts(events);
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan() {
            await writeFile(routeTypesPath, userRouteTypes, "utf-8");
            await writeFile(pluginTypesPath, userPluginTypes, "utf-8");
            events.push("update:throw");
            throw new Error("mock update failure after user replacement");
          },
        });
      },
    };

    try {
      const running = dev(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
        },
        { cwd, bundler },
      );
      await waitForEvent(events, "bundler.dev");
      await writeFile(
        path.join(cwd, "src/pages/about/page.tsx"),
        "export default function About() { return null; }",
        "utf-8",
      );
      await waitForEvent(events, "preserved:route-types.d.ts");
      await waitForEvent(events, "preserved:plugin-types.d.ts");

      await expect(fs.promises.readFile(routeTypesPath, "utf-8")).resolves.toBe(
        userRouteTypes,
      );
      await expect(
        fs.promises.readFile(pluginTypesPath, "utf-8"),
      ).resolves.toBe(userPluginTypes);
      process.emit("SIGINT");
      await Promise.race([
        running,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("dev shutdown timed out")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);
      expect(events).toContain("update:throw");
    } finally {
      stopCapturingConflicts();
    }
  });

  it("updates the dev bundler when config changes add an MPA page", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default { routing: { mode: 'mpa' } };",
      "utf-8",
    );

    const events: string[] = [];
    let currentConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "mpa" },
    };

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            events.push(
              `update:${update.entries.added.map((entry) => entry.name).join(",")}`,
            );
            process.emit("SIGINT");
          },
        });
      },
    };

    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(
      path.join(cwd, "src/pages/orders/page.tsx"),
      "export default function Orders() { return null; }",
      "utf-8",
    );
    currentConfig = {
      ...currentConfig,
      routing: { mode: "mpa" },
    };
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default { routing: { mode: 'mpa' } }; // updated",
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "bundler.dev",
      `update:${createPageClientBuildEntryName("orders")}`,
    ]);
  });

  it("updates the dev bundler when Page plugin config only changes generated IR", async () => {
    const cwd = await createProject();
    const pageDir = path.join(cwd, "src/pages/home");
    const configFile = path.join(pageDir, "page.config.ts");
    await fs.promises.mkdir(pageDir, { recursive: true });
    await writeFile(
      path.join(pageDir, "page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      configFile,
      'export default { plugins: { theme: { value: "light" } } };',
      "utf-8",
    );

    const pageThemeConfig = pluginConfig<{ value: string }>();
    const plugin = definePlugin<
      "page-theme",
      "theme",
      undefined,
      typeof pageThemeConfig,
      Record<string, never>
    >({
      id: "page-theme",
      key: "theme",
      page: pageThemeConfig,
      contributePage(ctx) {
        const theme = ctx.pageOptions.value;
        ctx.emit.data({
          id: "page-theme-data",
          scope: { kind: "page", pageId: ctx.page.id },
          value: { theme },
        });
        ctx.slot("html.tag").add({
          id: "page-theme-meta",
          tag: "meta",
          placement: "head-append",
          attrs: { name: "theme", content: String(theme) },
          target: { kind: "page", pageId: ctx.page.id },
        });
      },
    })();

    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            const tag = update.next.generated?.slots.find(
              (item) =>
                item.slot === "html.tag" && item.id === "page-theme-meta",
            );
            const previousModule = update.previous.generated?.modules.find(
              (item) => item.id === "page-theme-data",
            );
            const nextModule = update.next.generated?.modules.find(
              (item) => item.id === "page-theme-data",
            );
            events.push(
              [
                "update",
                update.generatedChanged,
                update.resolveChanged,
                update.entries.changed.length,
                update.html.changed.length,
                tag?.slot === "html.tag" ? tag.attrs?.content : "missing",
                previousModule?.sourceHash !== nextModule?.sourceHash,
                update.previous.generated?.coreGraphHash !==
                  update.next.generated?.coreGraphHash,
              ].join(":"),
            );
            process.emit("SIGINT");
          },
        });
      },
    };

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa" },
        plugins: [plugin],
      },
      { cwd, bundler },
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(
      configFile,
      'export default { plugins: { theme: { value: "dark" } } };',
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev generated IR update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "bundler.dev",
      "update:true:false:0:0:dark:true:true",
    ]);
  });

  it("reuses the active Application plugin setting for route updates", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/home"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );

    const events: string[] = [];
    let resolutionCalls = 0;
    const applicationConfig = pluginConfig<{ generation: number }>({
      defaults() {
        resolutionCalls += 1;
        return { generation: resolutionCalls };
      },
    });
    const plugin = definePlugin<
      "stable-application-plugin",
      undefined,
      typeof applicationConfig,
      undefined,
      Record<string, never>
    >({
      id: "stable-application-plugin",
      application: applicationConfig,
      setup(ctx) {
        const value = ctx.options;
        events.push(`setup:${value.generation}`);
        return {
          dispose() {
            events.push(`dispose:${value.generation}`);
          },
        };
      },
      contributions(ctx) {
        const value = ctx.options;
        events.push(`contribution:${value.generation}`);
      },
    })();
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(_update, options) {
            options.activate();
            events.push("update");
            process.emit("SIGINT");
          },
        });
      },
    };

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "mpa" },
      },
      { cwd, bundler },
    );

    await waitForEvent(events, "bundler.dev");
    await fs.promises.mkdir(path.join(cwd, "src/pages/orders"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, "src/pages/orders/page.tsx"),
      "export default function Orders() { return null; }",
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev route update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(resolutionCalls).toBe(1);
    expect(events).toEqual([
      "setup:1",
      "contribution:1",
      "bundler.dev",
      "contribution:1",
      "update",
      "dispose:1",
    ]);
  });

  it("reuses the active plugin snapshot for plugin watch updates", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const pluginDataPath = path.join(cwd, "plugin-data.json");
    await writeFile(pluginDataPath, "initial", "utf-8");

    const events: string[] = [];
    let contributionCount = 0;
    let loadConfigCalls = 0;
    let resolutionCalls = 0;
    const applicationConfig = pluginConfig<{ generation: number }>({
      defaults() {
        resolutionCalls += 1;
        return { generation: resolutionCalls };
      },
    });
    const plugin = definePlugin<
      "watched-application-plugin",
      undefined,
      typeof applicationConfig,
      undefined,
      Record<string, never>
    >({
      id: "watched-application-plugin",
      application: applicationConfig,
      setup(ctx) {
        const value = ctx.options;
        events.push(`setup:${value.generation}`);
        ctx.addWatchFile("./plugin-data.json");
        return {
          dispose() {
            events.push(`dispose:${value.generation}`);
          },
        };
      },
      contributions(ctx) {
        contributionCount += 1;
        const state = fs.existsSync(pluginDataPath)
          ? fs.readFileSync(pluginDataPath, "utf-8")
          : "missing";
        events.push(
          `contribution:${ctx.options.generation}:${contributionCount}:${state}`,
        );
      },
    })();
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            expect(isEmptyBuildPlanUpdate(update)).toBe(true);
            options.activate();
          },
        });
      },
    };

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "mpa" },
      },
      {
        cwd,
        bundler,
        loadConfig() {
          loadConfigCalls += 1;
          return {
            output: { client: "dist/client", server: "dist/server" },
            plugins: [plugin],
            routing: { mode: "mpa" },
          };
        },
      },
    );

    await waitForEvent(events, "bundler.dev");
    await fs.promises.unlink(pluginDataPath);
    await waitForEvent(events, "contribution:1:2:missing");
    await writeFile(pluginDataPath, "recreated", "utf-8");
    await waitForEvent(events, "contribution:1:3:recreated");
    process.emit("SIGINT");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev plugin watch update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(resolutionCalls).toBe(1);
    expect(loadConfigCalls).toBe(0);
    expect(events).toEqual([
      "setup:1",
      "contribution:1:1:initial",
      "bundler.dev",
      "contribution:1:2:missing",
      "contribution:1:3:recreated",
      "dispose:1",
    ]);
  });

  it("refreshes the Application plugin setting for config reloads", async () => {
    const cwd = await createSpaProject();
    const configPath = path.join(cwd, "ev.config.ts");
    await writeFile(configPath, "export default {};", "utf-8");

    const events: string[] = [];
    let resolutionCalls = 0;
    const applicationConfig = pluginConfig<{ generation: number }>({
      defaults() {
        resolutionCalls += 1;
        return { generation: resolutionCalls };
      },
    });
    const plugin = definePlugin<
      "reload-application-plugin",
      undefined,
      typeof applicationConfig,
      undefined,
      Record<string, never>
    >({
      id: "reload-application-plugin",
      application: applicationConfig,
      setup(ctx) {
        const value = ctx.options;
        events.push(`setup:${value.generation}`);
        return {
          dispose() {
            events.push(`dispose:${value.generation}`);
          },
        };
      },
      contributions(ctx) {
        const value = ctx.options;
        events.push(`contribution:${value.generation}`);
      },
    })();
    const currentConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      plugins: [plugin],
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(_update, options) {
            options.activate();
            events.push("update");
            process.emit("SIGINT");
          },
        });
      },
    };

    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });
    await waitForEvent(events, "bundler.dev");
    await writeFile(configPath, "export default {}; // updated", "utf-8");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev config reload timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(resolutionCalls).toBe(2);
    expect(events).toEqual([
      "setup:1",
      "contribution:1",
      "bundler.dev",
      "setup:2",
      "contribution:2",
      "update",
      "dispose:1",
      "dispose:2",
    ]);
  });

  it("rolls back failed plugin config state before retrying it on route changes", async () => {
    const cwd = await createSpaProject();
    const configPath = path.join(cwd, "ev.config.ts");
    await writeFile(configPath, "export default {};", "utf-8");
    const bundlerWatchPath = path.join(cwd, "bundler-watch.txt");
    await writeFile(bundlerWatchPath, "initial", "utf-8");
    await writeFile(
      path.join(cwd, "src/apis/initial/api.ts"),
      "export const GET = async () => Response.json({ initial: true });",
      "utf-8",
    );

    const events: string[] = [];
    const stopCapturingRollback = captureFrameworkWarning(
      events,
      "Unable to apply framework plan update without restart:",
      "mock config update failure",
      "config-update-rolled-back",
    );
    let resolutionCalls = 0;
    const applicationConfig = pluginConfig<{ generation: number }>({
      defaults() {
        resolutionCalls += 1;
        return { generation: resolutionCalls };
      },
    });
    const plugin = definePlugin<
      "transactional-config-plugin",
      undefined,
      typeof applicationConfig,
      undefined,
      Record<string, never>
    >({
      id: "transactional-config-plugin",
      application: applicationConfig,
      config(config, ctx) {
        events.push(`config:${ctx.options.generation}`);
        config.server = {
          ...config.server,
          basePath: `/generation-${ctx.options.generation}`,
        };
      },
      setup(ctx) {
        const generation = ctx.options.generation;
        events.push(`setup:${generation}`);
        return {
          dispose() {
            events.push(`dispose:${generation}`);
          },
        };
      },
      contributions(ctx) {
        events.push(`contribution:${ctx.options.generation}`);
      },
    })();
    const currentConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      plugins: [plugin],
    };
    let updateCalls = 0;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile }) {
        addWatchFile?.(bundlerWatchPath);
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            updateCalls += 1;
            const serverEntry = update.next.entries.find(
              (entry) => entry.kind === "server-runtime",
            );
            const routes =
              serverEntry?.metadata?.type === "server-app"
                ? serverEntry.metadata.routes.map((route) => route.path)
                : [];
            events.push(
              `update:${updateCalls}:${options?.config.server.basePath}:${routes.join(",")}`,
            );
            if (updateCalls === 1) {
              throw new Error("mock config update failure");
            }
            options.activate();
            process.emit("SIGINT");
          },
        });
      },
    };

    try {
      const running = dev(currentConfig, {
        cwd,
        bundler,
        loadConfig() {
          return currentConfig;
        },
      });

      await waitForEvent(events, "bundler.dev");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(currentConfig.server).toBeUndefined();
      await writeFile(bundlerWatchPath, "failed candidate", "utf-8");
      await waitForEvent(events, "config-update-rolled-back");
      expect(currentConfig.server).toBeUndefined();

      await writeFile(
        path.join(cwd, "src/apis/after/api.ts"),
        "export const GET = async () => Response.json({ after: true });",
        "utf-8",
      );

      await Promise.race([
        running,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("dev transaction rollback timed out")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);

      expect(events).toEqual([
        "config:1",
        "setup:1",
        "contribution:1",
        "bundler.dev",
        "config:2",
        "setup:2",
        "contribution:2",
        "update:1:/generation-2:/initial",
        "dispose:2",
        "config-update-rolled-back",
        "config:3",
        "setup:3",
        "contribution:3",
        "update:2:/generation-3:/after,/initial",
        "dispose:1",
        "dispose:3",
      ]);
      expect(resolutionCalls).toBe(3);
    } finally {
      stopCapturingRollback();
    }
  });

  it("keeps failed-config route changes forced while a retry is in flight", async () => {
    const cwd = await createSpaProject();
    const watchSpy = vi.spyOn(fs, "watch").mockImplementation((() => {
      throw Object.assign(new Error("simulated watcher exhaustion"), {
        code: "EMFILE",
      });
    }) as typeof fs.watch);
    const bundlerWatchPath = path.join(cwd, "bundler-watch.txt");
    await writeFile(bundlerWatchPath, "initial", "utf-8");
    await writeFile(
      path.join(cwd, "src/apis/initial/api.ts"),
      "export const GET = async () => Response.json({ initial: true });",
      "utf-8",
    );

    const events: string[] = [];
    const stopCapturingRollback = captureFrameworkWarning(
      events,
      "Unable to apply framework plan update without restart:",
      "mock overlapping config update failure",
      "config-update-rolled-back",
    );
    const currentConfig: Config<Record<string, never>> = {
      conventions: false,
      output: { client: "dist/client", server: "dist/server" },
    };
    let reloadCalls = 0;
    let updateCalls = 0;
    let markSecondUpdateStarted: (() => void) | undefined;
    const secondUpdateStarted = new Promise<void>((resolve) => {
      markSecondUpdateStarted = resolve;
    });
    let releaseSecondUpdate: (() => void) | undefined;
    const secondUpdateGate = new Promise<void>((resolve) => {
      releaseSecondUpdate = resolve;
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "overlapping-failed-config-retry",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile }) {
        addWatchFile?.(bundlerWatchPath);
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            updateCalls += 1;
            const serverEntry = update.next.entries.find(
              (entry) => entry.kind === "server-runtime",
            );
            const routes =
              serverEntry?.metadata?.type === "server-app"
                ? serverEntry.metadata.routes.map((route) => route.path)
                : [];
            events.push(
              [
                `update:${updateCalls}`,
                options?.configChanged,
                options?.config.server.basePath,
                routes.join(","),
              ].join(":"),
            );
            if (updateCalls === 1) {
              throw new Error("mock overlapping config update failure");
            }
            if (updateCalls === 2) {
              markSecondUpdateStarted?.();
              await secondUpdateGate;
              throw new Error("mock overlapping config update failure");
            }
            options.activate();
            process.emit("SIGINT");
          },
        });
      },
    };
    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        reloadCalls += 1;
        return {
          ...currentConfig,
          conventions: true,
          server: { basePath: `/reload-${reloadCalls}` },
        };
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    try {
      await waitForEvent(events, "bundler.dev");
      await writeFile(bundlerWatchPath, "first failed candidate", "utf-8");
      await waitForEvent(events, "config-update-rolled-back");

      await writeFile(
        path.join(cwd, "src/apis/after/api.ts"),
        "export const GET = async () => Response.json({ after: true });",
        "utf-8",
      );
      await Promise.race([
        secondUpdateStarted,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("second config retry did not start")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);

      await writeFile(
        path.join(cwd, "src/apis/during/api.ts"),
        "export const GET = async () => Response.json({ during: true });",
        "utf-8",
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      releaseSecondUpdate?.();

      await Promise.race([
        running,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("overlapping config retry timed out")),
            devUpdateTimeoutMs,
          ),
        ),
      ]);

      expect(reloadCalls).toBe(3);
      expect(events).toContain(
        "update:3:true:/reload-3:/after,/during,/initial",
      );
    } finally {
      releaseSecondUpdate?.();
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      watchSpy.mockRestore();
      stopCapturingRollback();
    }
  });

  it("updates Page metadata when an adjacent page.config.ts changes during dev", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    const pageConfigPath = path.join(cwd, "src/pages/page.config.ts");
    await writeFile(
      pageConfigPath,
      'export default { title: "Initial title", meta: { description: "Initial description" } };',
      "utf-8",
    );

    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            const html = update.next.html.find((item) => item.id === "index");
            events.push(
              [
                "update",
                update.generatedChanged,
                update.entries.changed.length,
                update.html.changed.length,
                html?.metadata?.title,
                html?.metadata?.meta?.description,
              ].join(":"),
            );
            process.emit("SIGINT");
          },
        });
      },
    };

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa" },
      },
      { cwd, bundler },
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(
      pageConfigPath,
      'export default { title: "Updated title", meta: { description: "Updated description" } };',
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev Page metadata update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "bundler.dev",
      "update:true:0:1:Updated title:Updated description",
    ]);
  });

  it("keeps a missing higher-priority Page config import watched after reload", async () => {
    const cwd = await createProject();
    const pageConfigPath = path.join(cwd, "src/pages/report/page.config.ts");
    const javascriptHelper = path.join(cwd, "src/config/title.js");
    const typescriptHelper = path.join(cwd, "src/config/title.ts");
    await writeFile(
      path.join(cwd, "src/pages/report/page.tsx"),
      "export default function Report() { return null; }",
      "utf-8",
    );
    await writeFile(
      pageConfigPath,
      [
        'import { title } from "../../config/title.js";',
        "export default { title };",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      typescriptHelper,
      'export const title = "Initial TypeScript";',
      "utf-8",
    );

    const events: string[] = [];
    let updateCount = 0;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "page-config-import-priority",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ callbacks, generation, plan }) {
        let currentGeneration = generation;
        let currentPlan = plan;
        const factsForPlan = (nextPlan: BuildPlan): BundlerBuildFacts => ({
          clientEntryAssets: Object.fromEntries(
            nextPlan.entries
              .filter((entry) => entry.environment === "client")
              .map((entry) => [
                entry.name,
                { js: [`${entry.name}.js`], css: [] },
              ]),
          ),
        });
        events.push(
          `initial:${plan.html.find((document) => document.id === "report")?.metadata?.title}`,
        );
        return createTestDevController(
          {
            async updatePlan(update, options) {
              updateCount += 1;
              options.activate();
              currentGeneration = options.generation;
              currentPlan = update.next;
              events.push(
                `update:${updateCount}:${update.next.html.find((document) => document.id === "report")?.metadata?.title}`,
              );
            },
          },
          {
            async onResume(outcome) {
              expect(outcome).toBe("accept");
              await callbacks.onBuildFacts(
                currentGeneration,
                factsForPlan(currentPlan),
                { isRebuild: true },
              );
              events.push(`facts:${updateCount}`);
            },
            onFinalize() {
              events.push(`finalize:${updateCount}`);
              if (updateCount === 2) process.emit("SIGINT");
            },
          },
        );
      },
    };
    const running = dev({ routing: { mode: "mpa" } }, { cwd, bundler });

    await waitForEvent(events, "initial:Initial TypeScript");
    await writeFile(
      typescriptHelper,
      'export const title = "Reloaded TypeScript";',
      "utf-8",
    );
    await waitForEvent(events, "finalize:1");
    await writeFile(
      javascriptHelper,
      'export const title = "Higher Priority JavaScript";',
      "utf-8",
    );
    await Promise.race([
      running,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("Page config import priority timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "initial:Initial TypeScript",
      "update:1:Reloaded TypeScript",
      "facts:1",
      "finalize:1",
      "update:2:Higher Priority JavaScript",
      "facts:2",
      "finalize:2",
    ]);
  });

  it("adds and removes static Document aliases during dev updates", async () => {
    const cwd = await createProject();
    const pageConfigPath = path.join(cwd, "src/pages/about/page.config.ts");
    await writeFile(
      path.join(cwd, "src/pages/about/page.tsx"),
      "export default function About() { return null; }",
      "utf-8",
    );
    await writeFile(pageConfigPath, "export default {};", "utf-8");

    const events: string[] = [];
    let updateCount = 0;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "document-alias-dev",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ plan, callbacks, generation }) {
        let currentGeneration = generation;
        const aboutEntry = createPageClientBuildEntryName("about");
        const facts: BundlerBuildFacts = {
          clientEntryAssets: {
            [aboutEntry]: { js: [`${aboutEntry}.js`], css: [] },
          },
        };
        await callbacks.onBuildFacts(currentGeneration, facts);
        const aliasPath = path.resolve(
          cwd,
          plan.output.clientDir,
          "about.html",
        );
        events.push(`initial:${fs.existsSync(aliasPath)}`);
        return createTestDevController(
          {
            async updatePlan(update, options) {
              updateCount += 1;
              options.activate();
              currentGeneration = options.generation;
              const aliases = update.next.html[0]?.aliases?.join(",") ?? "none";
              events.push(
                `update:${updateCount}:${update.html.changed.length}:${aliases}`,
              );
            },
          },
          {
            async onResume(outcome) {
              expect(outcome).toBe("accept");
              await callbacks.onBuildFacts(currentGeneration, facts, {
                isRebuild: true,
              });
              events.push(`alias:${updateCount}:${fs.existsSync(aliasPath)}`);
              if (updateCount === 1) {
                await writeFile(pageConfigPath, "export default {};", "utf-8");
              } else {
                process.emit("SIGINT");
              }
            },
          },
        );
      },
    };

    const running = dev(
      {
        routing: { mode: "mpa" },
      },
      { cwd, bundler },
    );

    await waitForEvent(events, "initial:false");
    await writeFile(
      pageConfigPath,
      'export default { document: { aliases: ["about.html"] } };',
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev Document alias update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "initial:false",
      "update:1:1:about.html",
      "alias:1:true",
      "update:2:1:none",
      "alias:2:false",
    ]);
  });

  it("runs staged same-name plugin hooks before applying a dev config update", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default { routing: { mode: 'mpa' } };",
      "utf-8",
    );

    const events: string[] = [];
    function createPlugin(label: string): Plugin<Record<string, never>> {
      return {
        name: "same-name-plugin",
        contributions() {
          events.push(`contribution:${label}`);
        },
        setup() {
          events.push(`setup:${label}`);
          return {
            buildStart() {
              events.push(`buildStart:${label}`);
            },
            dispose() {
              events.push(`dispose:${label}`);
            },
          };
        },
      };
    }

    let currentConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "mpa" },
      plugins: [createPlugin("v1")],
    };

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            events.push(
              `update:${update.entries.added.map((entry) => entry.name).join(",")}`,
            );
            process.emit("SIGINT");
          },
        });
      },
    };

    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(
      path.join(cwd, "src/pages/orders/page.tsx"),
      "export default function Orders() { return null; }",
      "utf-8",
    );
    currentConfig = {
      ...currentConfig,
      routing: { mode: "mpa" },
      plugins: [createPlugin("v2")],
    };
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default { routing: { mode: 'mpa' } }; // updated",
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "setup:v1",
      "buildStart:v1",
      "contribution:v1",
      "bundler.dev",
      "setup:v2",
      "buildStart:v2",
      "contribution:v2",
      `update:${createPageClientBuildEntryName("orders")}`,
      "dispose:v1",
      "dispose:v2",
    ]);
  });

  it("rolls back staged plugin hooks when reload buildStart fails", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default { routing: { mode: 'mpa' } };",
      "utf-8",
    );
    await writeFile(path.join(cwd, "old-watch.txt"), "old", "utf-8");
    await writeFile(path.join(cwd, "new-watch.txt"), "new", "utf-8");
    await writeFile(path.join(cwd, "retired-watch.txt"), "retired", "utf-8");

    const events: string[] = [];
    function createPlugin(
      label: string,
      watchFile: string,
      failBuildStart = false,
    ): Plugin<Record<string, never>> {
      let contributionCount = 0;
      return {
        name: "same-name-plugin",
        contributions() {
          contributionCount += 1;
          events.push(`contribution:${label}:${contributionCount}`);
        },
        setup(ctx) {
          events.push(`setup:${label}`);
          ctx.addWatchFile(`./${watchFile}`);
          return {
            buildStart() {
              events.push(`buildStart:${label}`);
              if (failBuildStart) {
                throw new Error(`${label} buildStart blocked`);
              }
            },
            dispose(disposeCtx) {
              events.push(
                `dispose:${label}:${disposeCtx.config.routing?.mode ?? "missing"}`,
              );
            },
          };
        },
      };
    }

    const oldPlugin = createPlugin("old", "old-watch.txt");
    const oldConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "mpa" },
      plugins: [oldPlugin],
    };
    let currentConfig = oldConfig;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            expect(isEmptyBuildPlanUpdate(update)).toBe(true);
            options.activate();
          },
        });
      },
    };
    let loadCount = 0;
    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        loadCount += 1;
        events.push(`load:${loadCount}`);
        return currentConfig;
      },
    });

    await waitForEvent(events, "bundler.dev");
    currentConfig = {
      ...oldConfig,
      routing: { mode: "mpa" },
      plugins: [createPlugin("new", "new-watch.txt", true)],
    };
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default { routing: { mode: 'mpa' } }; // updated",
      "utf-8",
    );
    await waitForEvent(events, "dispose:new:mpa", devUpdateTimeoutMs);

    currentConfig = oldConfig;
    await writeFile(path.join(cwd, "old-watch.txt"), "changed", "utf-8");
    await waitForEvent(events, "contribution:old:2");
    process.emit("SIGINT");

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("dev shutdown timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "setup:old",
      "buildStart:old",
      "contribution:old:1",
      "bundler.dev",
      "load:1",
      "setup:new",
      "buildStart:new",
      "dispose:new:mpa",
      "contribution:old:2",
      "dispose:old:mpa",
    ]);
  });

  it(
    "retries a failed config update when only its candidate Page config changes",
    async () => {
      const cwd = await createProject();
      const configPath = path.join(cwd, "ev.config.ts");
      await writeFile(configPath, "export default {};", "utf-8");
      const candidatePagePath = path.join(cwd, "src/pages/catalog/page.tsx");
      const candidatePageConfigPath = path.join(
        cwd,
        "src/pages/catalog/page.config.ts",
      );
      const events: string[] = [];
      type FakeDevWatcher = EventEmitter & {
        close: ReturnType<typeof vi.fn>;
        ref(): fs.FSWatcher;
        unref(): fs.FSWatcher;
      };
      const watchRecords: Array<{
        listener: (
          eventType: fs.WatchEventType,
          filename: string | Buffer | null,
        ) => void;
        target: string;
        watcher: FakeDevWatcher;
      }> = [];
      const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
        ...args: unknown[]
      ) => {
        const watcher = new EventEmitter() as FakeDevWatcher;
        watcher.close = vi.fn();
        watcher.ref = () => watcher as fs.FSWatcher;
        watcher.unref = () => watcher as fs.FSWatcher;
        watchRecords.push({
          listener: args.at(-1) as (typeof watchRecords)[number]["listener"],
          target: path.resolve(String(args[0])),
          watcher,
        });
        return watcher;
      }) as never);
      const stopCapturingRollback = captureFrameworkWarning(
        events,
        "Unable to apply framework plan update without restart:",
        "mock candidate Page config update failure",
        "config-update-rolled-back",
      );
      const activeConfig: Config<Record<string, never>> = {
        conventions: false,
        output: { client: "dist/client", server: "dist/server" },
      };
      const candidateConfig: Config<Record<string, never>> = {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
      };
      let currentConfig = activeConfig;
      let loadConfigCalls = 0;
      let updateCalls = 0;
      const bundler: BundlerAdapter<Record<string, never>> = {
        name: "candidate-page-watch-retry",
        capabilities: fullBundlerCapabilities,
        async build() {
          return {};
        },
        async dev() {
          events.push("bundler.dev");
          return createTestDevController({
            async updatePlan(_update, options) {
              updateCalls += 1;
              events.push(`update:${updateCalls}:${options?.configChanged}`);
              if (updateCalls === 1) {
                throw new Error("mock candidate Page config update failure");
              }
              options.activate();
              process.emit("SIGINT");
            },
          });
        },
      };
      const running = dev(activeConfig, {
        cwd,
        bundler,
        loadConfig() {
          loadConfigCalls += 1;
          return currentConfig;
        },
      });
      let settled = false;
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      try {
        await waitForEvent(events, "bundler.dev");
        await vi.waitFor(() =>
          expect(watchRecords.some((record) => record.target === cwd)).toBe(
            true,
          ),
        );
        const configWatcher = watchRecords.find(
          (record) => record.target === cwd,
        );
        if (!configWatcher) {
          throw new Error("Expected the config watcher to start.");
        }
        const initialWatcherCount = watchRecords.length;
        await writeFile(
          candidatePagePath,
          "export default function Catalog() { return null; }",
          "utf-8",
        );
        await writeFile(
          candidatePageConfigPath,
          'export default { title: "First" };',
          "utf-8",
        );
        currentConfig = candidateConfig;
        configWatcher.listener("change", path.basename(configPath));
        await waitForEvent(events, "config-update-rolled-back");

        const candidatePageConfigWatcher = watchRecords
          .slice(initialWatcherCount)
          .reverse()
          .find(
            (record) =>
              record.target === path.dirname(candidatePageConfigPath) &&
              record.watcher.close.mock.calls.length === 0,
          );
        if (!candidatePageConfigWatcher) {
          throw new Error(
            "Expected the candidate Page config watcher to start.",
          );
        }
        await writeFile(
          candidatePageConfigPath,
          'export default { title: "Second" };',
          "utf-8",
        );
        candidatePageConfigWatcher.listener(
          "change",
          path.basename(candidatePageConfigPath),
        );
        await Promise.race([
          running,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `candidate Page config retry did not complete. Observed: ${events.join(", ")}`,
                  ),
                ),
              devUpdateTimeoutMs,
            ),
          ),
        ]);
      } finally {
        if (!settled) {
          process.emit("SIGINT");
          await running.catch(() => {});
        }
        watchSpy.mockRestore();
        stopCapturingRollback();
      }

      expect(loadConfigCalls).toBe(2);
      expect(events).toEqual([
        "bundler.dev",
        "update:1:true",
        "config-update-rolled-back",
        "update:2:true",
      ]);
    },
    devUpdateTimeoutMs + 1_000,
  );

  it(
    "retries a failed config update when only its staged plugin watch file changes",
    async () => {
      const cwd = await createProject();
      await writeFile(
        path.join(cwd, "src/pages/home/page.tsx"),
        "export default function Home() { return null; }",
        "utf-8",
      );
      const configPath = path.join(cwd, "ev.config.ts");
      await writeFile(configPath, "export default {};", "utf-8");
      await writeFile(path.join(cwd, "old-watch.txt"), "old", "utf-8");
      const newWatchPath = path.join(cwd, "new-watch.txt");
      await writeFile(newWatchPath, "new", "utf-8");

      const events: string[] = [];
      type FakeDevWatcher = EventEmitter & {
        close: ReturnType<typeof vi.fn>;
        ref(): fs.FSWatcher;
        unref(): fs.FSWatcher;
      };
      const watchRecords: Array<{
        listener: (
          eventType: fs.WatchEventType,
          filename: string | Buffer | null,
        ) => void;
        target: string;
        watcher: FakeDevWatcher;
      }> = [];
      const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
        ...args: unknown[]
      ) => {
        const watcher = new EventEmitter() as FakeDevWatcher;
        watcher.close = vi.fn();
        watcher.ref = () => watcher as fs.FSWatcher;
        watcher.unref = () => watcher as fs.FSWatcher;
        watchRecords.push({
          listener: args.at(-1) as (typeof watchRecords)[number]["listener"],
          target: path.resolve(String(args[0])),
          watcher,
        });
        return watcher;
      }) as never);
      const stopCapturingRollback = captureFrameworkWarning(
        events,
        "Unable to apply framework plan update without restart:",
        "mock staged plugin config update failure",
        "config-update-rolled-back",
      );
      function createPlugin(
        label: string,
        watchFile: string,
      ): Plugin<Record<string, never>> {
        return {
          name: "candidate-plugin-watch",
          setup(ctx) {
            events.push(`setup:${label}`);
            ctx.addWatchFile(`./${watchFile}`);
            return {
              dispose() {
                events.push(`dispose:${label}`);
              },
            };
          },
          contributions() {
            events.push(`contribution:${label}`);
          },
        };
      }

      const oldConfig: Config<Record<string, never>> = {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [createPlugin("old", "old-watch.txt")],
        routing: { mode: "mpa" },
      };
      const nextConfig: Config<Record<string, never>> = {
        ...oldConfig,
        plugins: [createPlugin("new", "new-watch.txt")],
      };
      let currentConfig = oldConfig;
      let loadConfigCalls = 0;
      let updateCalls = 0;
      const bundler: BundlerAdapter<Record<string, never>> = {
        name: "candidate-plugin-watch-retry",
        capabilities: fullBundlerCapabilities,
        async build() {
          return {};
        },
        async dev() {
          events.push("bundler.dev");
          return createTestDevController({
            async updatePlan(_update, options) {
              updateCalls += 1;
              events.push(`update:${updateCalls}:${options?.configChanged}`);
              if (updateCalls === 1) {
                throw new Error("mock staged plugin config update failure");
              }
              options.activate();
              process.emit("SIGINT");
            },
          });
        },
      };
      const running = dev(oldConfig, {
        cwd,
        bundler,
        loadConfig() {
          loadConfigCalls += 1;
          return currentConfig;
        },
      });
      let settled = false;
      void running.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      try {
        await waitForEvent(events, "bundler.dev");
        await vi.waitFor(() =>
          expect(watchRecords.some((record) => record.target === cwd)).toBe(
            true,
          ),
        );
        const configWatcher = watchRecords.find(
          (record) => record.target === cwd,
        );
        if (!configWatcher) {
          throw new Error("Expected the config watcher to start.");
        }
        const initialWatcherCount = watchRecords.length;
        currentConfig = nextConfig;
        configWatcher.listener("change", path.basename(configPath));
        await waitForEvent(events, "config-update-rolled-back");

        const candidatePluginWatcher = watchRecords
          .slice(initialWatcherCount)
          .reverse()
          .find(
            (record) =>
              record.target === path.dirname(newWatchPath) &&
              record.watcher.close.mock.calls.length === 0,
          );
        if (!candidatePluginWatcher) {
          throw new Error(
            "Expected the candidate plugin watch-file watcher to start.",
          );
        }

        await writeFile(newWatchPath, "changed", "utf-8");
        candidatePluginWatcher.listener("change", path.basename(newWatchPath));
        await Promise.race([
          running,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () =>
                reject(new Error("staged plugin watch retry did not complete")),
              devUpdateTimeoutMs,
            ),
          ),
        ]);
      } finally {
        if (!settled) {
          process.emit("SIGINT");
          await running.catch(() => {});
        }
        watchSpy.mockRestore();
        stopCapturingRollback();
      }

      expect(loadConfigCalls).toBe(2);
      expect(events).toEqual([
        "setup:old",
        "contribution:old",
        "bundler.dev",
        "setup:new",
        "contribution:new",
        "update:1:true",
        "dispose:new",
        "config-update-rolled-back",
        "setup:new",
        "contribution:new",
        "update:2:true",
        "dispose:old",
        "dispose:new",
      ]);
    },
    devUpdateTimeoutMs + 1_000,
  );

  it("refreshes plugin watch files after committed plugin cleanup fails", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default { routing: { mode: 'mpa' } };",
      "utf-8",
    );
    await writeFile(path.join(cwd, "old-watch.txt"), "old", "utf-8");
    await writeFile(path.join(cwd, "new-watch.txt"), "new", "utf-8");

    type FakeDevWatcher = EventEmitter & {
      close: ReturnType<typeof vi.fn>;
      ref(): fs.FSWatcher;
      unref(): fs.FSWatcher;
    };
    const watchRecords: Array<{
      listener: (
        eventType: fs.WatchEventType,
        filename: string | Buffer | null,
      ) => void;
      target: string;
      watcher: FakeDevWatcher;
    }> = [];
    const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
      ...args: unknown[]
    ) => {
      const watcher = new EventEmitter() as FakeDevWatcher;
      watcher.close = vi.fn();
      watcher.ref = () => watcher as fs.FSWatcher;
      watcher.unref = () => watcher as fs.FSWatcher;
      watchRecords.push({
        listener: args.at(-1) as (typeof watchRecords)[number]["listener"],
        target: path.resolve(String(args[0])),
        watcher,
      });
      return watcher;
    }) as never);
    const dispatchDirectFileChange = (file: string) => {
      const parent = path.dirname(file);
      const basename = path.basename(file);
      for (const record of watchRecords) {
        if (
          record.target === parent &&
          record.watcher.close.mock.calls.length === 0
        ) {
          record.listener("change", basename);
        }
      }
    };

    const events: string[] = [];
    function createPlugin(
      label: string,
      watchFile: string,
      failDispose = false,
      registerDuringDispose = false,
    ): Plugin<Record<string, never>> {
      let contributionCount = 0;
      return {
        name: "same-name-plugin",
        contributions() {
          contributionCount += 1;
          events.push(`contribution:${label}:${contributionCount}`);
        },
        setup(ctx) {
          ctx.addWatchFile(`./${watchFile}`);
          events.push(`setup:${label}`);
          return {
            dispose() {
              events.push(`dispose:${label}`);
              if (registerDuringDispose) {
                ctx.addWatchFile("./retired-watch.txt");
              }
              if (failDispose) throw new Error(`${label} dispose blocked`);
            },
          };
        },
      };
    }

    let currentConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "mpa" },
      plugins: [createPlugin("old", "old-watch.txt", true, true)],
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController({
          async updatePlan(update, options) {
            options.activate();
            events.push(
              `update:${update.entries.added.map((entry) => entry.name).join(",")}`,
            );
          },
        });
      },
    };
    let loadCount = 0;
    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        loadCount += 1;
        events.push(`load:${loadCount}`);
        return currentConfig;
      },
    });
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    let timeoutSpy: ReturnType<typeof vi.spyOn> | undefined;

    try {
      await waitForEvent(events, "bundler.dev");
      await writeFile(
        path.join(cwd, "src/pages/orders/page.tsx"),
        "export default function Orders() { return null; }",
        "utf-8",
      );
      currentConfig = {
        ...currentConfig,
        routing: { mode: "mpa" },
        plugins: [createPlugin("new", "new-watch.txt")],
      };
      const configPath = path.join(cwd, "ev.config.ts");
      await writeFile(
        configPath,
        "export default { routing: { mode: 'mpa' } }; // updated",
        "utf-8",
      );
      dispatchDirectFileChange(configPath);
      await waitForEvent(
        events,
        `update:${createPageClientBuildEntryName("orders")}`,
      );
      await waitForEvent(events, "dispose:old");
      const watcherRetirementStartedAt = Date.now();
      while (
        watchRecords.filter(
          (record) =>
            record.target === cwd &&
            record.watcher.close.mock.calls.length === 0,
        ).length !== 1
      ) {
        if (Date.now() - watcherRetirementStartedAt > devUpdateTimeoutMs) {
          throw new Error(
            "Timed out waiting for the candidate watcher to close.",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(loadCount).toBe(1);

      timeoutSpy = vi.spyOn(globalThis, "setTimeout");
      dispatchDirectFileChange(path.join(cwd, "retired-watch.txt"));
      expect(
        timeoutSpy.mock.calls.some(
          (call: readonly unknown[]) => call[1] === 50,
        ),
      ).toBe(false);
      timeoutSpy.mockRestore();
      timeoutSpy = undefined;
      expect(loadCount).toBe(1);

      const newWatchPath = path.join(cwd, "new-watch.txt");
      await writeFile(newWatchPath, "changed", "utf-8");
      dispatchDirectFileChange(newWatchPath);
      await waitForEvent(events, "contribution:new:2");
      expect(loadCount).toBe(1);
      process.emit("SIGINT");
      await running;
    } finally {
      timeoutSpy?.mockRestore();
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      watchSpy.mockRestore();
    }

    expect(events).toEqual(
      expect.arrayContaining([
        "setup:old",
        "contribution:old:1",
        "bundler.dev",
        "setup:new",
        "contribution:new:1",
        `update:${createPageClientBuildEntryName("orders")}`,
        "dispose:old",
        "contribution:new:2",
        "dispose:new",
      ]),
    );
    expect(loadCount).toBe(1);
  });
});
