import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type BuildOutput,
  type BuildPlan,
  type CoreGraph,
  PAGE_ANCHOR_PROVIDER_ID,
} from "@evjs/shared/manifest";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPageClientBuildEntryName,
  createPageServerBuildEntryName,
  createPprShellBuildEntryName,
  createRscPageBuildEntryName,
} from "../src/_internal/build/build-entry-conventions.js";
import type {
  BundlerAdapter,
  BundlerBuildFacts,
  BundlerDevController,
} from "../src/_internal/build/bundler.js";
import {
  build,
  dev,
  prepareFrameworkBuild,
} from "../src/_internal/build/commands.js";
import {
  prepareFrameworkIR,
  publishFrameworkIR,
} from "../src/_internal/build/generated-contributions.js";
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
import { definePlugin, pluginOptions } from "../src/plugin/index.js";

const repoRoot = path.resolve(process.cwd(), "../..");
const generatedRouteTypesSource = [
  "/* eslint-disable */",
  PAGE_ROUTE_TYPES_MARKER,
  PAGE_ROUTE_TYPES_USAGE_HINT,
  "export {};",
].join("\n");
const routeTypeCheckTimeoutMs = 30_000;
const fullBundlerCapabilities = {
  build: {
    server: true,
    rsc: true,
    ppr: true,
  },
} as const;
const BUILD_OUTPUT_HOOK_OWNERSHIP_ERROR =
  "[evjs] transformOutput hooks cannot change non-asset BuildOutput fields. Hooks may only adjust existing AssetGroup contents or deployment metadata.";

beforeEach(() => {
  // Exercise native event watching by default regardless of whether the test
  // runner itself is hosted in Codex's macOS Seatbelt sandbox.
  vi.stubEnv("CODEX_SANDBOX", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function createTestDevController(
  onClose: () => void = () => {},
): BundlerDevController {
  let closed = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  return {
    origin: "http://localhost:4123",
    done,
    async close() {
      if (closed) return;
      closed = true;
      onClose();
      resolveDone();
    },
  };
}

function createBlockingReadyPlugin(
  events: string[],
): Plugin<Record<string, never>> {
  return {
    id: "blocking-dev-server-ready",
    setup() {
      events.push("setup");
      return {
        devServerReady({ signal }) {
          events.push("ready");
          return new Promise<void>((resolve) => {
            const onAbort = () => {
              events.push("ready:aborted");
              resolve();
            };
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
          });
        },
        dispose() {
          events.push("dispose");
        },
      };
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
    async dispatchTreeChange(file: string): Promise<void> {
      const isActiveAncestor = (record: (typeof records)[number]) => {
        if (record.watcher.close.mock.calls.length > 0) return false;
        const relative = path.relative(record.target, file);
        return !relative.startsWith("..") && !path.isAbsolute(relative);
      };
      await vi.waitFor(() => expect(records.some(isActiveAncestor)).toBe(true));
      for (const record of records) {
        if (!isActiveAncestor(record)) continue;
        const relative = path.relative(record.target, file);
        record.listener("rename", relative || path.basename(file));
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
      return createTestDevController();
    },
  };
}

function serverBuildFacts(
  plan: BuildPlan,
): Pick<BundlerBuildFacts, "serverEntryAssets"> {
  const serverEntryAssets = Object.fromEntries(
    plan.entries
      .filter((entry) => entry.environment === "server")
      .map((entry) => [entry.name, { js: [`${entry.name}.js`], css: [] }]),
  );
  return Object.keys(serverEntryAssets).length > 0 ? { serverEntryAssets } : {};
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

async function readSortedDirectoryEntries(root: string): Promise<string[]> {
  return (await fs.promises.readdir(root)).sort((left, right) =>
    left.localeCompare(right),
  );
}

describe("prepareFrameworkBuild", () => {
  it("releases its project operation lock before returning", async () => {
    const cwd = await createSpaProject();
    const prepared = await prepareFrameworkBuild(
      { routing: { mode: "spa" } },
      { cwd },
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
      id: "prepare-core",
      configure(config, ctx) {
        events.push(`config:${ctx.mode}`);
        return config;
      },
      emitIR(ctx) {
        expect(ctx.config.bundler).toBeUndefined();
        events.push(`emitIR:${ctx.mode}`);
      },
      setup(ctx) {
        expect(ctx.config.bundler).toBeUndefined();
        ctx.addWatchFile("./framework-extra.json");
        events.push(`setup:${ctx.mode}`);
        return {
          beforeBuild() {
            events.push("beforeBuild");
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

    expect(prepared.mode).toBe("production");
    expect(prepared).not.toHaveProperty("command");
    expect(prepared.config.output.client).toBe("dist/client");
    expect("graph" in prepared).toBe(false);
    expect("plan" in prepared).toBe(false);
    expect("hooks" in prepared).toBe(false);
    expect("pluginContext" in prepared).toBe(false);
    expect(prepared.pluginWatchFiles).toEqual([
      path.join(cwd, "framework-extra.json"),
    ]);
    expect(events).toEqual([
      "config:production",
      "emitIR:production",
      "setup:production",
    ]);

    await prepared.dispose();
    await prepared.dispose();

    expect(events).toEqual([
      "config:production",
      "emitIR:production",
      "setup:production",
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
      id: "analytics",
      page: pluginOptions<{ channel: string }>(),
    });
    const access = definePlugin({
      id: "access",
      page: pluginOptions<{ policy: string }>(),
    });
    const pluginTypesFile = path.join(cwd, "src/plugin-types.d.ts");

    const initial = await prepareFrameworkBuild(
      { plugins: [analytics(), access()] },
      { cwd },
    );
    await initial.dispose();
    const initialTypes = await fs.promises.readFile(pluginTypesFile, "utf-8");
    expect(initialTypes).toContain(
      'readonly config: typeof import("../ev.config").default;',
    );

    const narrowed = await prepareFrameworkBuild(
      { plugins: [analytics()] },
      { cwd },
    );
    await narrowed.dispose();
    const narrowedTypes = await fs.promises.readFile(pluginTypesFile, "utf-8");
    expect(narrowedTypes).toBe(initialTypes);

    const empty = await prepareFrameworkBuild({}, { cwd });
    await empty.dispose();
    await expect(fs.promises.readFile(pluginTypesFile, "utf-8")).resolves.toBe(
      initialTypes,
    );
  });

  it("renders the complete generated IR before clearing the canonical tree", async () => {
    const cwd = await createSpaProject();
    const initial = await prepareFrameworkBuild(
      { routing: { mode: "spa" } },
      { cwd },
    );
    await initial.dispose();
    const generatedRoot = path.join(cwd, ".ev");
    const initialSnapshot = await readDirectorySnapshot(generatedRoot);
    const initialRootEntries = await readSortedDirectoryEntries(cwd);
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      id: "render-failure",
      setup() {
        events.push("setup");
      },
      emitIR(ctx) {
        events.push("emitIR");
        ctx.emit.module({
          id: "throws-while-rendering",
          scope: { kind: "application" },
          source() {
            throw new Error("injected generated IR render failure");
          },
        });
      },
    };

    await expect(
      prepareFrameworkBuild(
        { plugins: [plugin], routing: { mode: "spa" } },
        { cwd },
      ),
    ).rejects.toThrow("injected generated IR render failure");

    expect(events).toEqual(["emitIR"]);
    expect(await readDirectorySnapshot(generatedRoot)).toEqual(initialSnapshot);
    expect(await readSortedDirectoryEntries(cwd)).toEqual(initialRootEntries);
  });

  it("fail-stops a direct canonical publication without a completion manifest", async () => {
    const cwd = await createSpaProject();
    const initial = await prepareFrameworkBuild(
      { routing: { mode: "spa" } },
      { cwd },
    );
    await initial.dispose();
    const generatedRoot = path.join(cwd, ".ev");
    const buildPlanFile = path.join(
      generatedRoot,
      "framework",
      "build-plan.json",
    );
    const initialRootEntries = await readSortedDirectoryEntries(cwd);
    const originalWriteFile = fsPromises.writeFile.bind(fsPromises);
    let injectedFailure = false;
    const writeSpy = vi
      .spyOn(fsPromises, "writeFile")
      .mockImplementation((async (
        ...args: Parameters<typeof fsPromises.writeFile>
      ) => {
        const file = path.resolve(String(args[0]));
        if (!injectedFailure && file === buildPlanFile) {
          injectedFailure = true;
          throw Object.assign(
            new Error("injected generated IR publication failure"),
            { code: "EIO" },
          );
        }
        return originalWriteFile(...args);
      }) as typeof fsPromises.writeFile);

    try {
      await expect(
        prepareFrameworkBuild({ routing: { mode: "spa" } }, { cwd }),
      ).rejects.toThrow("injected generated IR publication failure");
    } finally {
      writeSpy.mockRestore();
    }

    expect(injectedFailure).toBe(true);
    await expect(
      fs.promises.access(path.join(generatedRoot, "manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readSortedDirectoryEntries(cwd)).toEqual(initialRootEntries);
  });

  it("exposes CLI flags to setup without running beforeBuild during prepare", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      id: "reads-cli-flags",
      setup(ctx) {
        events.push(`setup:${ctx.flags?.mock}:${ctx.flags?.coverage}`);
        return {
          beforeBuild(buildCtx) {
            events.push(
              `beforeBuild:${buildCtx.flags?.mock}:${buildCtx.flags?.coverage}`,
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

    expect(events).toEqual(["setup:true:true"]);
  });

  it("keeps one immutable CLI flag snapshot for the complete plugin lifecycle", async () => {
    const cwd = await createProject();
    const flags = { feature: ["initial"] };
    const events: string[] = [];
    const readFeature = (value: unknown) =>
      Array.isArray(value) ? value.join(",") : String(value);
    const plugin: Plugin<Record<string, never>> = {
      id: "stable-cli-flags",
      configure(_config, context) {
        events.push(`configure:${readFeature(context.flags?.feature)}`);
      },
      setup(context) {
        events.push(`setup:${readFeature(context.flags?.feature)}`);
        return {
          dispose(disposeContext) {
            events.push(
              `dispose:${readFeature(disposeContext.flags?.feature)}`,
            );
          },
        };
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
      },
      { cwd, flags },
    );
    flags.feature.push("caller-mutation");
    await prepared.dispose();

    expect(events).toEqual([
      "configure:initial",
      "setup:initial",
      "dispose:initial",
    ]);
    expect(flags.feature).toEqual(["initial", "caller-mutation"]);
  });

  it("reuses the initial CLI flag snapshot across immutable dev sessions", async () => {
    const cwd = await createSpaProject();
    const configPath = path.join(cwd, "ev.config.ts");
    await writeFile(configPath, "export default {};", "utf-8");
    const controlledWatch = installControlledFsWatch();
    const flags = { feature: ["initial"] };
    const events: string[] = [];

    function readFeature(value: unknown): string {
      return Array.isArray(value) ? value.join(",") : String(value);
    }

    function createFlagsPlugin(
      snapshot: "old" | "candidate",
    ): Plugin<Record<string, never>> {
      return {
        id: "stable-dev-cli-flags",
        configure(_config, context) {
          events.push(
            `configure:${snapshot}:${readFeature(context.flags?.feature)}`,
          );
        },
        setup(context) {
          events.push(
            `setup:${snapshot}:${readFeature(context.flags?.feature)}`,
          );
          return {
            dispose(disposeContext) {
              events.push(
                `dispose:${snapshot}:${readFeature(disposeContext.flags?.feature)}`,
              );
            },
          };
        },
      };
    }

    const oldConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "spa" },
      plugins: [createFlagsPlugin("old")],
    };
    let currentConfig = oldConfig;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "stable-dev-cli-flags",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController();
      },
    };
    const running = dev(oldConfig, {
      cwd,
      bundler,
      flags,
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
      await vi.waitFor(() =>
        expect(events.filter((event) => event === "bundler.dev")).toHaveLength(
          1,
        ),
      );
      flags.feature.push("caller-mutation");
      currentConfig = {
        ...oldConfig,
        plugins: [createFlagsPlugin("candidate")],
      };
      await writeFile(configPath, "export default { changed: true };", "utf-8");
      await controlledWatch.dispatchFileChange(configPath);
      await vi.waitFor(() =>
        expect(events.filter((event) => event === "bundler.dev")).toHaveLength(
          2,
        ),
      );
      process.emit("SIGINT");
      await running;
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
      controlledWatch.restore();
    }

    expect(events).toEqual([
      "configure:old:initial",
      "setup:old:initial",
      "bundler.dev",
      "configure:candidate:initial",
      "dispose:old:initial",
      "setup:candidate:initial",
      "bundler.dev",
      "dispose:candidate:initial",
    ]);
    expect(flags.feature).toEqual(["initial", "caller-mutation"]);
  });

  it("aborts an active devServerReady hook during SIGINT shutdown", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "ready-sigint",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return createTestDevController(() => events.push("controller.close"));
      },
    };
    const running = dev(
      {
        routing: { mode: "spa" },
        plugins: [createBlockingReadyPlugin(events)],
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
      await vi.waitFor(() => expect(events).toContain("ready"));
      process.emit("SIGINT");
      await running;
    } finally {
      if (!settled) {
        process.emit("SIGINT");
        await running.catch(() => {});
      }
    }

    expect(events).toEqual([
      "setup",
      "bundler.dev",
      "ready",
      "ready:aborted",
      "controller.close",
      "dispose",
    ]);
  });

  it("closes a pending devServerReady hook when the controller fails", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    let rejectController!: (error: unknown) => void;
    const controllerDone = new Promise<void>((_resolve, reject) => {
      rejectController = reject;
    });
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "ready-controller-failure",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return {
          origin: "http://localhost:4123",
          done: controllerDone,
          async close() {
            events.push("controller.close");
          },
        };
      },
    };
    const running = dev(
      {
        routing: { mode: "spa" },
        plugins: [createBlockingReadyPlugin(events)],
      },
      { cwd, bundler },
    );

    await vi.waitFor(() => expect(events).toContain("ready"));
    rejectController(new Error("controller failed during ready hook"));

    await expect(running).rejects.toThrow(
      "controller failed during ready hook",
    );
    expect(events).toEqual([
      "setup",
      "bundler.dev",
      "ready",
      "ready:aborted",
      "controller.close",
      "dispose",
    ]);
  });

  it("isolates one plugin instance across concurrent project preparations", async () => {
    const spaCwd = await createSpaProject();
    const mpaCwd = await createSpaProject();
    const configuredModes = new Map<string, "spa" | "mpa">();
    const setupModes = new Map<string, "spa" | "mpa">();
    let configureArrivals = 0;
    let releaseConfigureHooks: (() => void) | undefined;
    const configureHooksReady = new Promise<void>((resolve) => {
      releaseConfigureHooks = resolve;
    });
    const contextual = definePlugin({
      id: "concurrent-project-context",
      application: pluginOptions<{ routingMode: "spa" | "mpa" }>({
        defaults(context) {
          return { routingMode: context.routingMode };
        },
      }),
      async configure(_config, context) {
        configuredModes.set(context.cwd, context.options.routingMode);
        configureArrivals++;
        if (configureArrivals === 2) releaseConfigureHooks?.();
        await configureHooksReady;
      },
      setup(context) {
        setupModes.set(context.cwd, context.options.routingMode);
      },
    });
    const plugin = contextual();

    const [spaPrepared, mpaPrepared] = await Promise.all([
      prepareFrameworkBuild(
        { routing: { mode: "spa" }, plugins: [plugin] },
        { cwd: spaCwd },
      ),
      prepareFrameworkBuild(
        { routing: { mode: "mpa" }, plugins: [plugin] },
        { cwd: mpaCwd },
      ),
    ]);

    try {
      expect(configuredModes).toEqual(
        new Map([
          [spaCwd, "spa"],
          [mpaCwd, "mpa"],
        ]),
      );
      expect(setupModes).toEqual(configuredModes);
    } finally {
      await Promise.all([spaPrepared.dispose(), mpaPrepared.dispose()]);
    }
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
              id: "first",
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
              id: "second",
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
    await expect(
      fs.promises.access(path.join(cwd, ".ev", "manifest.json")),
    ).resolves.toBeUndefined();
  });

  it("disposes plugins in reverse order and continues after failures", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const prepared = await prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [
          {
            id: "first",
            setup() {
              return {
                dispose() {
                  events.push("dispose:first");
                },
              };
            },
          },
          {
            id: "second",
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
    let emittedPageId: string | undefined;
    const plugin: Plugin<Record<string, never>> = {
      id: "generated-fixture",
      emitIR(ctx) {
        expect(Object.isFrozen(ctx)).toBe(true);
        expect(Object.isFrozen(ctx.emit)).toBe(true);
        expect(Object.isFrozen(ctx.config)).toBe(true);
        expect(Object.isFrozen(ctx.config.plugins)).toBe(true);
        expect(Object.isFrozen(ctx.config.plugins[0])).toBe(true);
        expect(() => {
          (ctx.config.plugins as Plugin<Record<string, never>>[]).splice(0, 1);
        }).toThrow(TypeError);
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
        emittedPageId = ctx.framework.pages[0]?.id;
        if (!emittedPageId) throw new Error("Expected one framework Page.");
        const pageScope: { kind: "page"; pageId: string } = {
          kind: "page",
          pageId: emittedPageId,
        };
        const pageData = ctx.emit.data({
          id: "page-data",
          scope: pageScope,
          value: { enabled: true },
        });
        expect(Object.isFrozen(pageData)).toBe(true);
        expect(Reflect.set(pageData as object, "key", "mutated")).toBe(false);
        pageScope.pageId = "mutated-after-emit";
        const entryCode = ctx.emit.module({
          id: "entry-code",
          scope: { kind: "application" },
          source: ({ importOf }) =>
            [
              `import { value } from ${JSON.stringify(importOf(runtime))};`,
              "window.__evGeneratedValue = value;",
            ].join("\n"),
        });
        const clientEntrySlot = ctx.slot("client.entry");
        expect(Object.isFrozen(clientEntrySlot)).toBe(true);
        clientEntrySlot.add({
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
        target: { android: 5, ios: 8 },
        polyfill: {},
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
    const pageDataModule = manifest.generated?.modules.find(
      (module) => module.id === "page-data",
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
    expect(pageDataModule?.scope).toEqual({
      kind: "page",
      pageId: emittedPageId,
    });
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
    const mainEntrySource = await fs.promises.readFile(
      path.join(cwd, entry?.file ?? ""),
      "utf-8",
    );
    expect(mainEntrySource).toContain(
      'import * as routeModule0 from "../../src/pages/page";',
    );
    expect(mainEntrySource.indexOf("@evjs/ev/_internal/client/polyfill")).toBe(
      mainEntrySource.lastIndexOf("@evjs/ev/_internal/client/polyfill"),
    );
    expect(
      mainEntrySource.indexOf("@evjs/ev/_internal/client/polyfill"),
    ).toBeLessThan(mainEntrySource.indexOf("generated-fixture/runtime"));

    await prepared.dispose();
  });

  it("uses an external core-js UMD without a bundled entry import", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );

    const prepared = await prepareFrameworkBuild(
      {
        target: { android: 5, ios: 8 },
        polyfill: {
          coreJs: "https://cdn.example.com/core-js-bundle.min.js",
        },
        routing: { mode: "spa" },
      },
      { cwd },
    );
    const source = await fs.promises.readFile(
      path.join(cwd, ".ev/entries/main.ts"),
      "utf-8",
    );

    expect(source).not.toContain("@evjs/ev/_internal/client/polyfill");
    await prepared.dispose();
  });

  it("does not inject bundled core-js in development", async () => {
    const cwd = await createSpaProject();
    const prepared = await prepareFrameworkBuild(
      {
        target: { android: 5, ios: 8 },
        routing: { mode: "spa" },
      },
      { cwd, mode: "development" },
    );
    const source = await fs.promises.readFile(
      path.join(cwd, ".ev/entries/main.ts"),
      "utf-8",
    );

    expect(source).not.toContain("@evjs/ev/_internal/client/polyfill");
    await prepared.dispose();
  });

  it("does not inject core-js when browser compatibility is omitted", async () => {
    const cwd = await createSpaProject();
    const prepared = await prepareFrameworkBuild(
      { routing: { mode: "spa" } },
      { cwd },
    );
    const source = await fs.promises.readFile(
      path.join(cwd, ".ev/entries/main.ts"),
      "utf-8",
    );

    expect(source).not.toContain("@evjs/ev/_internal/client/polyfill");
    await prepared.dispose();
  });

  it("allocates portable generated module paths past a hash collision", async () => {
    const cwd = await createSpaProject();
    const collidingIds = ["runtime", "runtime*`=)", "runtime{`{+"];
    const plugin: Plugin<Record<string, never>> = {
      id: "collision",
      emitIR(ctx) {
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

    const prepared = await prepareFrameworkIR({
      cwd,
      mode: "production",
      config: {
        target: { android: 5, ios: 8 },
        polyfill: { coreJs: "bundled" },
      } as never,
      graph: {} as CoreGraph,
      plan,
      plugins: [],
      pluginContext: {} as never,
    });

    expect(prepared.plan.generated?.entries.map((entry) => entry.file)).toEqual(
      [
        "./.ev/entries/runtime.ts",
        "./.ev/entries/runtime-01a49654.ts",
        "./.ev/entries/runtime-01a49654-2.ts",
      ],
    );
    for (const generatedEntry of prepared.plan.generated?.entries ?? []) {
      const entryFile = generatedEntry.file.replace(/^\.\/\.ev\//, "");
      const source = prepared.image.files.find(
        (file) => file.file === entryFile,
      )?.source;
      expect(source).toContain('import "@evjs/ev/_internal/client/polyfill";');
      expect(
        source?.match(/@evjs\/ev\/_internal\/client\/polyfill/g),
      ).toHaveLength(1);
    }
    await expect(
      fs.promises.access(path.join(cwd, ".ev")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const initialRootEntries = await readSortedDirectoryEntries(cwd);

    const writes: string[] = [];
    const originalWriteFile = fsPromises.writeFile.bind(fsPromises);
    const writeSpy = vi
      .spyOn(fsPromises, "writeFile")
      .mockImplementation((async (
        ...args: Parameters<typeof fsPromises.writeFile>
      ) => {
        writes.push(path.resolve(String(args[0])));
        return originalWriteFile(...args);
      }) as typeof fsPromises.writeFile);
    try {
      await publishFrameworkIR(cwd, prepared.image);
    } finally {
      writeSpy.mockRestore();
    }

    expect(writes).toEqual([
      ...prepared.image.files.map(({ file }) => path.resolve(cwd, ".ev", file)),
      path.join(cwd, ".ev", "manifest.json"),
    ]);
    expect(await readSortedDirectoryEntries(cwd)).toEqual(
      [...initialRootEntries, ".ev"].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
  });

  it("projects Page wrappers into SPA routes in deterministic nesting order", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      id: "spa-page-wrappers",
      emitIR(ctx) {
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

  it("projects Application wrappers outside the generated CSR root", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      id: "application-wrappers",
      emitIR(ctx) {
        const first = ctx.emit.module({
          id: "first-application-wrapper",
          scope: { kind: "application" },
          source:
            "export default function First({ children }) { return children; }",
          extension: ".tsx",
        });
        const second = ctx.emit.module({
          id: "second-application-wrapper",
          scope: { kind: "application" },
          source:
            "export default function Second({ children }) { return children; }",
          extension: ".tsx",
        });
        ctx.slot("application.wrapper").add({
          id: "first",
          module: first,
          target: { kind: "application", applicationId: "default" },
        });
        ctx.slot("application.wrapper").add({ id: "second", module: second });
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
        (module) => module.id === "first-application-wrapper",
      );
      const second = manifest.generated?.modules.find(
        (module) => module.id === "second-application-wrapper",
      );
      const main = manifest.entries.find((entry) => entry.name === "main");
      const source = await fs.promises.readFile(
        path.join(cwd, ".ev/entries/main.ts"),
        "utf-8",
      );

      expect(
        main?.metadata?.type === "pages-app"
          ? main.metadata.wrappers
          : undefined,
      ).toEqual([second?.file, first?.file]);
      expect(source).toContain(
        "wrappers: [applicationWrapperModule0, applicationWrapperModule1]",
      );
    } finally {
      await prepared.dispose();
    }
  });

  it("projects Application wrappers into plugin-owned entry facades", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      id: "wrapped-entry-facade",
      emitIR(ctx) {
        const entry = ctx.framework.getApplicationEntry();
        if (!entry) throw new Error("missing Application entry");
        const boundary = ctx.emit.module({
          id: "boundary",
          scope: { kind: "application" },
          source:
            "export default function Boundary({ children }) { return children; }",
          extension: ".tsx",
        });
        ctx.slot("application.wrapper").add({
          id: "boundary-slot",
          module: boundary,
        });
        const original = ctx.emit.entryFacade({
          id: "original-entry",
          entry,
          autoStart: false,
        });
        ctx.slot("client.entry").add({
          id: "entry-replacement",
          module: original,
          position: "before-main",
          mode: "replace",
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
      const source = await fs.promises.readFile(
        path.join(cwd, ".ev/plugins/wrapped-entry-facade/original-entry.ts"),
        "utf-8",
      );
      expect(source).toContain(
        'import * as applicationWrapperModule0 from "./boundary";',
      );
      expect(source).toContain("wrappers: [applicationWrapperModule0]");
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
      id: "all-runtime-page-wrappers",
      emitIR(ctx) {
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
      id: "invalid-page-wrapper-runtime",
      emitIR(ctx) {
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
      id: "tmp-parity",
      emitIR(ctx) {
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
      id: "invalid-generated-data",
      emitIR(ctx) {
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
      id: "observe-semantic-pages",
      emitIR(ctx) {
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
      id: "observe-page-anchors",
      emitIR(ctx) {
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
      id: "invalid-spa-page-entry",
      emitIR(ctx) {
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
      id: "invalid-spa-page-document",
      emitIR(ctx) {
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
      id: "mpa-application-target",
      emitIR(ctx) {
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
        target: { android: 5, ios: 8 },
        polyfill: {},
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
      const pageEntrySource = await fs.promises.readFile(
        path.join(
          cwd,
          `.ev/entries/${createPageClientBuildEntryName("home")}.ts`,
        ),
        "utf-8",
      );
      expect(pageEntrySource).toContain(
        generatedImport(
          cwd,
          `.ev/entries/${createPageClientBuildEntryName("home")}.ts`,
          installer?.file ?? "",
        ),
      );
      expect(
        pageEntrySource.indexOf("@evjs/ev/_internal/client/polyfill"),
      ).toBeLessThan(
        pageEntrySource.indexOf("mpa-application-target/installer"),
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
      id: "invalid-client-entry-runtime",
      emitIR(ctx) {
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
      id: "unknown-constructor-page",
      emitIR(ctx) {
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
      id: "source-alias",
      emitIR(ctx) {
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
    const serverEntry = await fs.promises.readFile(
      path.join(cwd, ".ev/entries/server.ts"),
      "utf-8",
    );
    for (const serverFunction of generatedGraph.graph.serverFunctions) {
      expect(serverEntry).toContain(
        `serverFunctions.register(${JSON.stringify(serverFunction.id)},`,
      );
      expect(serverEntry).toContain(
        `[${JSON.stringify(serverFunction.exportName)}]`,
      );
    }
    expect(serverEntry).toContain("createServerFunctionRegistry()");
    expect(serverEntry).toContain(
      'import { getServerReferenceId } from "@evjs/ev/_internal/server/server-reference";',
    );
    expect(serverEntry).toContain("getServerReferenceId(");
    expect(serverEntry).toContain("serverFunctionBundlerId");
    expect(serverEntry).toContain("!== undefined");
    expect(
      serverEntry.match(/import \* as serverFunctionModule\d+ from/g),
    ).toHaveLength(2);
    expect(serverEntry).toContain(
      "createApp({ middlewares, routes, serverFunctions,",
    );
    expect(serverEntry).not.toContain("registerServerReference");
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
      id: "entry-wrapper",
      emitIR(ctx) {
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
        target: { android: 5, ios: 8 },
        polyfill: {},
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
    expect(
      originalEntry.indexOf("@evjs/ev/_internal/client/polyfill"),
    ).toBeLessThan(originalEntry.indexOf("createPagesApp"));
    expect(deferredEntry).toContain("createPagesApp");
    expect(deferredEntry).toContain("export const pagesApp = createPagesApp");
    expect(deferredEntry).toContain("export const start =");
    expect(deferredEntry).not.toContain('startPagesApp(app, "#app");');
    expect(
      deferredEntry.indexOf("@evjs/ev/_internal/client/polyfill"),
    ).toBeLessThan(deferredEntry.indexOf("createPagesApp"));
    expect(wrapper).toContain('import("./original-entry")');
    expect(mainEntry).toContain(
      'export * from "../plugins/entry-wrapper/wrapper";',
    );
    expect(
      mainEntry.indexOf("@evjs/ev/_internal/client/polyfill"),
    ).toBeLessThan(mainEntry.indexOf("entry-wrapper/wrapper"));
    expect(
      mainEntry.match(/@evjs\/ev\/_internal\/client\/polyfill/g),
    ).toHaveLength(1);
    expect(mainEntry).not.toContain("createPagesApp");

    await prepared.dispose();
  });

  it("composes Page server entry imports around a replacement", async () => {
    const cwd = await createProject();
    for (const pageId of ["home", "admin"]) {
      await writeFile(
        path.join(cwd, `src/pages/${pageId}/page.tsx`),
        `export default function ${pageId}Page() { return null; }`,
        "utf-8",
      );
      await writeFile(
        path.join(cwd, `src/pages/${pageId}/page.config.ts`),
        'export default { render: "ssr" };',
        "utf-8",
      );
    }

    const importsPlugin: Plugin<Record<string, never>> = {
      id: "server-entry-imports",
      emitIR(ctx) {
        for (const [id, position] of [
          ["before", "before-main"],
          ["after", "after-main"],
        ] as const) {
          const module = ctx.emit.module({
            id,
            scope: { kind: "page", pageId: "home" },
            source: `globalThis.__${id}ServerEntry = true;`,
          });
          ctx.slot("server.entry").add({
            id: `${id}-slot`,
            target: { kind: "page", pageId: "home" },
            module,
            position,
          });
        }
        const admin = ctx.emit.module({
          id: "admin",
          scope: { kind: "page", pageId: "admin" },
          source: "globalThis.__adminServerEntry = true;",
        });
        ctx.slot("server.entry").add({
          id: "admin-slot",
          target: { kind: "page", pageId: "admin" },
          module: admin,
          position: "before-main",
        });
      },
    };
    const replacementPlugin: Plugin<Record<string, never>> = {
      id: "server-entry-replacement",
      emitIR(ctx) {
        const module = ctx.emit.module({
          id: "home",
          scope: { kind: "page", pageId: "home" },
          source: [
            "export default function Home() { return null; }",
            "export const replaced = true;",
          ].join("\n"),
        });
        ctx.slot("server.entry").add({
          id: "home-slot",
          target: { kind: "page", pageId: "home" },
          module,
          mode: "replace",
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        routing: { mode: "spa" },
        plugins: [importsPlugin, replacementPlugin],
      },
      { cwd },
    );
    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
    ) as BuildPlan;
    const homeEntryFile = `.ev/entries/${createPageServerBuildEntryName("home")}.ts`;
    const adminEntryFile = `.ev/entries/${createPageServerBuildEntryName("admin")}.ts`;
    const homeEntry = await fs.promises.readFile(
      path.join(cwd, homeEntryFile),
      "utf-8",
    );
    const adminEntry = await fs.promises.readFile(
      path.join(cwd, adminEntryFile),
      "utf-8",
    );
    const before = manifest.generated?.modules.find(
      (module) =>
        module.pluginId === "server-entry-imports" && module.id === "before",
    );
    const after = manifest.generated?.modules.find(
      (module) =>
        module.pluginId === "server-entry-imports" && module.id === "after",
    );
    const replacement = manifest.generated?.modules.find(
      (module) =>
        module.pluginId === "server-entry-replacement" && module.id === "home",
    );
    const admin = manifest.generated?.modules.find(
      (module) =>
        module.pluginId === "server-entry-imports" && module.id === "admin",
    );
    const beforeImport = generatedImport(
      cwd,
      homeEntryFile,
      before?.file ?? "",
    );
    const afterImport = generatedImport(cwd, homeEntryFile, after?.file ?? "");
    const replacementImport = generatedImport(
      cwd,
      homeEntryFile,
      replacement?.file ?? "",
    );
    const adminImport = generatedImport(cwd, adminEntryFile, admin?.file ?? "");

    expect(homeEntry).toContain(`import ${JSON.stringify(beforeImport)};`);
    expect(homeEntry).toContain(
      `export { default } from ${JSON.stringify(replacementImport)};`,
    );
    expect(homeEntry).toContain(`void import(${JSON.stringify(afterImport)});`);
    expect(homeEntry.indexOf(beforeImport)).toBeLessThan(
      homeEntry.indexOf(replacementImport),
    );
    expect(homeEntry.indexOf(replacementImport)).toBeLessThan(
      homeEntry.indexOf(afterImport),
    );
    expect(homeEntry).not.toContain("src/pages/home/page");
    expect(adminEntry).toContain(`import ${JSON.stringify(adminImport)};`);
    expect(adminEntry).toContain("src/pages/admin/page");
    expect(adminEntry).not.toContain(beforeImport);
    expect(adminEntry).not.toContain(afterImport);
    expect(manifest.generated?.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot: "server.entry",
          id: "before-slot",
          position: "before-main",
          mode: "import",
        }),
        expect.objectContaining({
          slot: "server.entry",
          id: "after-slot",
          position: "after-main",
          mode: "import",
        }),
        expect.objectContaining({
          slot: "server.entry",
          id: "home-slot",
          position: "before-main",
          mode: "replace",
        }),
        expect.objectContaining({
          slot: "server.entry",
          id: "admin-slot",
          position: "before-main",
          mode: "import",
        }),
      ]),
    );

    await prepared.dispose();
  });

  it("replaces exact Page server entry facades without changing framework entry identity", async () => {
    const cwd = await createProject();
    for (const pageId of ["home", "admin", "profile"]) {
      await writeFile(
        path.join(cwd, `src/pages/${pageId}/page.tsx`),
        `export default function ${pageId}Page() { return null; }`,
        "utf-8",
      );
      await writeFile(
        path.join(cwd, `src/pages/${pageId}/page.config.ts`),
        'export default { render: "ssr" };',
        "utf-8",
      );
    }

    let compiledPlan: BuildPlan | undefined;
    let linkedOutput: BuildOutput | undefined;
    const plugin: Plugin<Record<string, never>> = {
      id: "server-entry-replacement",
      setup() {
        return {
          afterBuild(result) {
            linkedOutput = result.output;
          },
        };
      },
      emitIR(ctx) {
        for (const pageId of ["home", "admin"] as const) {
          const entry = ctx.emit.module({
            id: `${pageId}-server-entry`,
            scope: { kind: "page", pageId },
            source: [
              `export default function ${pageId}ServerPage() { return null; }`,
              `export const ${pageId}ServerExport = true;`,
            ].join("\n"),
          });
          ctx.slot("server.entry").add({
            id: `${pageId}-server-entry-slot`,
            target: { kind: "page", pageId },
            module: entry,
            mode: "replace",
          });
        }
      },
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [plugin],
      },
      {
        cwd,
        bundler: createMockBundler([], {
          onBuildPlan(plan) {
            compiledPlan = plan;
          },
        }),
      },
    );

    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
    ) as BuildPlan;
    const homeName = createPageServerBuildEntryName("home");
    const adminName = createPageServerBuildEntryName("admin");
    const profileName = createPageServerBuildEntryName("profile");
    const homeModule = manifest.generated?.modules.find(
      (module) => module.id === "home-server-entry",
    );
    const adminModule = manifest.generated?.modules.find(
      (module) => module.id === "admin-server-entry",
    );
    const homeFacadeFile = `.ev/entries/${homeName}.ts`;
    const adminFacadeFile = `.ev/entries/${adminName}.ts`;
    const profileFacadeFile = `.ev/entries/${profileName}.ts`;
    const homeFacade = await fs.promises.readFile(
      path.join(cwd, homeFacadeFile),
      "utf-8",
    );
    const adminFacade = await fs.promises.readFile(
      path.join(cwd, adminFacadeFile),
      "utf-8",
    );
    const profileFacade = await fs.promises.readFile(
      path.join(cwd, profileFacadeFile),
      "utf-8",
    );

    for (const [name, pageId] of [
      [homeName, "home"],
      [adminName, "admin"],
      [profileName, "profile"],
    ] as const) {
      expect(
        compiledPlan?.entries.find((entry) => entry.name === name),
      ).toMatchObject({
        name,
        import: `./.ev/entries/${name}.ts`,
        environment: "server",
        kind: "page-server",
        owner: { pageId },
        metadata: { type: "react-server-page" },
      });
      expect(
        compiledPlan?.server.renderers?.find(
          (renderer) => renderer.name === name,
        ),
      ).toMatchObject({
        name,
        import: `./.ev/entries/${name}.ts`,
        kind: "page-server",
        owner: { pageId },
        metadata: { type: "react-server-page" },
      });
      expect(linkedOutput?.server.renderers?.[name]).toMatchObject({
        kind: "page-server",
        owner: { pageId },
        assets: { js: [`${name}.js`], css: [] },
      });
    }

    const homeImport = generatedImport(
      cwd,
      homeFacadeFile,
      homeModule?.file ?? "",
    );
    const adminImport = generatedImport(
      cwd,
      adminFacadeFile,
      adminModule?.file ?? "",
    );
    expect(homeFacade).toContain(`export { default } from "${homeImport}";`);
    expect(homeFacade).toContain(`export * from "${homeImport}";`);
    expect(adminFacade).toContain(`export { default } from "${adminImport}";`);
    expect(adminFacade).toContain(`export * from "${adminImport}";`);
    expect(homeFacade).not.toContain("src/pages/home/page");
    expect(adminFacade).not.toContain("src/pages/admin/page");
    expect(profileFacade).toContain(
      'import * as pageModule from "../../src/pages/profile/page";',
    );
    expect(profileFacade).toContain(
      'export { PageProvider } from "@evjs/ev/_internal/client/page-context";',
    );
    expect(manifest.generated?.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot: "server.entry",
          id: "home-server-entry-slot",
          target: { kind: "page", pageId: "home" },
          module: homeModule?.file,
          mode: "replace",
        }),
        expect.objectContaining({
          slot: "server.entry",
          id: "admin-server-entry-slot",
          target: { kind: "page", pageId: "admin" },
          module: adminModule?.file,
          mode: "replace",
        }),
      ]),
    );
    expect(manifest.generated?.importEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "server-entry-replacement:home-server-entry-slot",
          to: "server-entry-replacement:home-server-entry",
          kind: "slot-module",
          specifier: homeModule?.file,
        }),
        expect.objectContaining({
          from: "server-entry-replacement:admin-server-entry-slot",
          to: "server-entry-replacement:admin-server-entry",
          kind: "slot-module",
          specifier: adminModule?.file,
        }),
      ]),
    );
  });

  it("rejects multiple replacements for one concrete Page server entry", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/home/page.tsx"),
      "export default function Home() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/home/page.config.ts"),
      'export default { render: "ssr" };',
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      id: "duplicate-server-entry",
      emitIR(ctx) {
        for (const id of ["first", "second"] as const) {
          const entry = ctx.emit.module({
            id: `${id}-entry`,
            scope: { kind: "page", pageId: "home" },
            source: "export default function Home() { return null; }",
          });
          ctx.slot("server.entry").add({
            id: `${id}-slot`,
            target: { kind: "page", pageId: "home" },
            module: entry,
            mode: "replace",
          });
        }
      },
    };

    await expect(
      prepareFrameworkBuild(
        { routing: { mode: "spa" }, plugins: [plugin] },
        { cwd },
      ),
    ).rejects.toThrow(
      `Server page entry "${createPageServerBuildEntryName("home")}" has multiple replacement server.entry contributions: duplicate-server-entry:first-slot, duplicate-server-entry:second-slot.`,
    );
  });

  it("rejects unknown Pages and Pages without a server entry", async () => {
    const createPlugin = (pageId: string): Plugin<Record<string, never>> => ({
      id: `server-entry-${pageId}`,
      emitIR(ctx) {
        const entry = ctx.emit.module({
          id: "entry",
          scope: { kind: "application" },
          source: "export default function Page() { return null; }",
        });
        ctx.slot("server.entry").add({
          id: "entry-slot",
          target: { kind: "page", pageId },
          module: entry,
          mode: "replace",
        });
      },
    });

    const unknownCwd = await createSpaProject();
    await expect(
      prepareFrameworkBuild(
        {
          routing: { mode: "spa" },
          plugins: [createPlugin("missing")],
        },
        { cwd: unknownCwd },
      ),
    ).rejects.toThrow(
      'server.entry contribution "entry-slot" targets unknown page "missing".',
    );

    const csrCwd = await createSpaProject();
    await expect(
      prepareFrameworkBuild(
        {
          routing: { mode: "spa" },
          plugins: [createPlugin("index")],
        },
        { cwd: csrCwd },
      ),
    ).rejects.toThrow(
      'server.entry contribution "entry-slot" targets page "index", but no server page entry matches that target.',
    );
  });

  it("rejects non-Page server entry targets", async () => {
    const cwd = await createSpaProject();
    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-server-entry-target",
      emitIR(ctx) {
        const entry = ctx.emit.module({
          id: "entry",
          scope: { kind: "application" },
          source: "export default function Page() { return null; }",
        });
        ctx.slot("server.entry").add({
          id: "entry-slot",
          target: { kind: "application" } as never,
          module: entry,
          mode: "replace",
        });
      },
    };

    await expect(
      prepareFrameworkBuild(
        { routing: { mode: "spa" }, plugins: [plugin] },
        { cwd },
      ),
    ).rejects.toThrow('server.entry target.kind must be "page".');
  });

  it("requires a position for Page server entry imports", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );
    await writeFile(
      path.join(cwd, "src/pages/page.config.ts"),
      'export default { render: "ssr" };',
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-server-entry-import",
      emitIR(ctx) {
        const module = ctx.emit.module({
          id: "entry",
          scope: { kind: "page", pageId: "index" },
          source: "export {};",
        });
        ctx.slot("server.entry").add({
          id: "entry-slot",
          target: { kind: "page", pageId: "index" },
          module,
        } as never);
      },
    };

    await expect(
      prepareFrameworkBuild(
        { routing: { mode: "spa" }, plugins: [plugin] },
        { cwd },
      ),
    ).rejects.toThrow(
      'invalid-server-entry-import:entry-slot.position must be one of: "polyfill", "before-main-imports", "after-main-imports", "before-main", "after-main"',
    );
  });

  it("adds server.request.middleware contributions to the generated server entry", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "src/apis/hello/api.ts"),
      "export function GET() { return new Response('ok'); }",
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      id: "server-contribution",
      emitIR(ctx) {
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
      id: "duplicate-contributions",
      emitIR(ctx) {
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

  it("keeps one contribution identity when a plugin mutates its id", async () => {
    const cwd = await createSpaProject();
    const plugin: Plugin<Record<string, never>> = {
      id: "stable-contributor",
      emitIR(ctx) {
        expect(Reflect.set(this, "id", "mutated-contributor")).toBe(false);
        const generated = ctx.emit.module({
          id: "runtime",
          scope: { kind: "application" },
          source: "export {};",
        });
        ctx.slot("resolve.alias").add({
          id: "runtime-alias",
          specifier: "virtual:runtime",
          replacement: generated,
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

    try {
      const manifest = JSON.parse(
        await fs.promises.readFile(
          path.join(cwd, ".ev/manifest.json"),
          "utf-8",
        ),
      ) as BuildPlan;
      expect(manifest.generated?.modules).toContainEqual(
        expect.objectContaining({
          key: "stable-contributor:runtime",
          pluginId: "stable-contributor",
          file: "./.ev/plugins/stable-contributor/runtime.ts",
        }),
      );
      expect(manifest.generated?.slots).toContainEqual(
        expect.objectContaining({
          key: "stable-contributor:runtime-alias",
          pluginId: "stable-contributor",
        }),
      );
    } finally {
      await prepared.dispose();
    }
  });

  it("rejects invalid contribution slot payloads", async () => {
    const cwd = await createProject();
    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-contribution",
      emitIR(ctx) {
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
      async dev() {
        return createTestDevController();
      },
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
              id: "cleanup",
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

  it("does not run output-cycle hooks when bundling fails without fresh facts", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "failing-bundler",
      capabilities: fullBundlerCapabilities,
      async build() {
        events.push("bundler.build");
        throw new Error("compile failed");
      },
      async dev() {
        return createTestDevController();
      },
    };

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [
            {
              id: "lifecycle-observer",
              setup() {
                events.push("setup");
                return {
                  beforeBuild() {
                    events.push("beforeBuild");
                  },
                  afterBuild() {
                    events.push("afterBuild");
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
    ).rejects.toThrow("compile failed");

    expect(events).toEqual(["setup", "bundler.build", "dispose"]);
  });

  it("runs framework orchestration around the injected bundler", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      id: "records-lifecycle",
      emitIR() {
        events.push("emitIR:production");
      },
      setup(ctx) {
        expect(ctx.config.bundler?.name).toBe("mock");
        events.push(`setup:${ctx.mode}`);
        return {
          beforeBuild() {
            events.push("beforeBuild");
          },
          transformOutput(output) {
            events.push(
              `transformOutput:${Object.keys(output.assets).join(",")}`,
            );
            output.assets.main.css = ["main.patched.css"];
            output.apps.default.assets.js = ["main.patched.js"];
            output.deployment = { platform: "test" };
          },
          afterBuild(result) {
            events.push(
              [
                "afterBuild",
                result.output.assets.main?.css[0],
                result.output.apps.default.assets.js[0],
                result.output.server.entry ?? "no-server",
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
      "emitIR:production",
      "setup:production",
      "bundler.build",
      "bundler.entries:main",
      "beforeBuild",
      "transformOutput:main",
      "afterBuild:main.patched.css:main.patched.js:no-server:test",
      "dispose:production",
    ]);
    await expect(
      fs.promises.readFile(
        path.join(cwd, "dist/deployment-metadata.json"),
        "utf-8",
      ),
    ).resolves.toContain('"platform": "test"');
  });

  it("publishes production framework output transactionally", async () => {
    const cwd = await createProject();
    for (const pageId of ["alpha", "beta"]) {
      await writeFile(
        path.join(cwd, `src/pages/${pageId}/page.tsx`),
        `export default function ${pageId}() { return null; }`,
        "utf-8",
      );
    }

    const distDir = path.join(cwd, "dist");
    const clientDir = path.join(distDir, "client");
    const bundlerAsset = path.join(clientDir, "bundler.js");
    let buildNumber = 0;
    let failCompile = false;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "transactional-production-output",
      capabilities: fullBundlerCapabilities,
      async build({ plan }) {
        buildNumber += 1;
        const buildRoot = path.resolve(cwd, plan.distDir);
        const buildClientDir = path.resolve(cwd, plan.output.clientDir);
        await fs.promises.rm(buildRoot, { recursive: true, force: true });
        await writeFile(
          path.join(buildClientDir, "bundler.js"),
          `bundler:${buildNumber}`,
          "utf-8",
        );
        const clientEntryAssets = Object.fromEntries(
          plan.entries
            .filter((entry) => entry.environment === "client")
            .map((entry) => [
              entry.name,
              { js: [`${entry.name}.${buildNumber}.js`], css: [] },
            ]),
        );
        for (const asset of Object.values(clientEntryAssets).flatMap(
          (assets) => assets.js,
        )) {
          await writeFile(
            path.join(buildClientDir, asset),
            `asset:${buildNumber}:${asset}`,
            "utf-8",
          );
        }
        if (failCompile) {
          throw new Error("injected bundler compile failure");
        }
        return {
          clientEntryAssets,
          emittedFiles: {
            client: [
              "bundler.js",
              ...Object.values(clientEntryAssets).flatMap(
                (assets) => assets.js,
              ),
            ],
          },
        };
      },
      async dev() {
        return createTestDevController();
      },
    };
    function releasePlugin(
      release: "old" | "next",
      failure?: "output" | "afterBuild",
    ): Plugin<Record<string, never>> {
      return {
        id: "transactional-production-output",
        setup() {
          let htmlTransforms = 0;
          return {
            transformOutput(output) {
              output.deployment = { release };
            },
            transformHtml(document) {
              htmlTransforms += 1;
              document.body?.appendChild(
                document.createComment(` release:${release} `),
              );
              if (failure === "output" && htmlTransforms === 2) {
                throw new Error("injected framework output failure");
              }
            },
            afterBuild() {
              if (failure === "afterBuild") {
                throw new Error("injected afterBuild failure");
              }
            },
          };
        },
      };
    }
    const config = (
      release: "old" | "next",
      failure?: "output" | "afterBuild",
    ): Config<Record<string, never>> => ({
      output: { client: "dist/client", server: "dist/server" },
      plugins: [releasePlugin(release, failure)],
      routing: { mode: "mpa" },
    });

    await build(config("old"), { cwd, bundler });
    const metadataPath = path.join(cwd, "dist/deployment-metadata.json");
    const htmlPaths = ["alpha", "beta"].map((pageId) =>
      path.join(clientDir, `${pageId}.html`),
    );
    const previousDist = await readDirectorySnapshot(distDir);

    failCompile = true;
    await expect(build(config("next"), { cwd, bundler })).rejects.toThrow(
      "injected bundler compile failure",
    );
    failCompile = false;
    expect(await readDirectorySnapshot(distDir)).toEqual(previousDist);

    await expect(
      build(config("next", "output"), { cwd, bundler }),
    ).rejects.toThrow("injected framework output failure");
    expect(await readDirectorySnapshot(distDir)).toEqual(previousDist);

    await build(config("next"), { cwd, bundler });
    const nextMetadata = await fs.promises.readFile(metadataPath, "utf-8");
    expect(nextMetadata).toContain('"release": "next"');
    expect(JSON.parse(nextMetadata).paths).toEqual({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });
    expect(nextMetadata).not.toContain(".candidate");
    for (const htmlPath of htmlPaths) {
      const html = await fs.promises.readFile(htmlPath, "utf-8");
      expect(html).toContain("release:next");
      expect(html).not.toContain("release:old");
    }
    await expect(fs.promises.readFile(bundlerAsset, "utf-8")).resolves.toBe(
      "bundler:4",
    );
    expect(
      Object.keys(await readDirectorySnapshot(clientDir)).some((file) =>
        file.endsWith(".4.js"),
      ),
    ).toBe(true);

    await expect(
      build(config("old", "afterBuild"), { cwd, bundler }),
    ).rejects.toThrow("injected afterBuild failure");
    await expect(
      fs.promises.readFile(metadataPath, "utf-8"),
    ).resolves.toContain('"release": "old"');
    for (const htmlPath of htmlPaths) {
      const html = await fs.promises.readFile(htmlPath, "utf-8");
      expect(html).toContain("release:old");
      expect(html).not.toContain("release:next");
    }
    await expect(fs.promises.readFile(bundlerAsset, "utf-8")).resolves.toBe(
      "bundler:5",
    );
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
      async dev() {
        return createTestDevController();
      },
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
    const unexpectedDist = await fs.promises.lstat(path.join(cwd, "dist"));
    expect(unexpectedDist.isSymbolicLink()).toBe(true);
  });

  it("preserves a canonical dist tree created while production output is staged", async () => {
    const cwd = await createSpaProject();
    const canonicalRoot = path.join(cwd, "dist");
    const sentinel = path.join(canonicalRoot, "concurrent-sentinel.txt");
    const baseBundler = createMockBundler([]);
    const buildMock = baseBundler.build;
    if (!buildMock) throw new Error("Expected mock build implementation.");
    const bundler: BundlerAdapter<Record<string, never>> = {
      ...baseBundler,
      async build(context) {
        const facts = await buildMock(context);
        await writeFile(sentinel, "concurrent", "utf-8");
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
      "plan.distDir changed while production output was being staged",
    );
    await expect(fs.promises.readFile(sentinel, "utf-8")).resolves.toBe(
      "concurrent",
    );
  });

  it("validates transformOutput hook mutations before emitting artifacts", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-output",
      setup() {
        return {
          beforeBuild() {
            events.push("beforeBuild");
          },
          transformOutput(output) {
            events.push("transformOutput");
            (output as { version: number }).version = 2;
          },
          afterBuild() {
            events.push("afterBuild");
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
      "beforeBuild",
      "transformOutput",
      "dispose",
    ]);
  });

  it("keeps CoreGraph Document identity immutable through transformOutput hooks", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-document-output",
      setup() {
        return {
          transformOutput(output) {
            events.push("transformOutput");
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
      '[evjs] transformOutput hooks cannot change Application "default" Document fileName or aliases.',
    );

    expect(fs.existsSync(path.join(cwd, "dist/legacy.html"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, "dist/deployment-metadata.json"))).toBe(
      false,
    );
    expect(events).toEqual([
      "bundler.build",
      "bundler.entries:main",
      "transformOutput",
      "dispose",
    ]);
  });

  it("keeps CoreGraph Route identity immutable through transformOutput hooks", async () => {
    const cwd = await createSpaProject();
    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-route-output",
      setup() {
        return {
          transformOutput(output) {
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
      "[evjs] transformOutput hooks cannot add, remove, reorder, or rename Routes, or change Route paths and ownership.",
    );
  });

  it("keeps CoreGraph Application identity immutable through transformOutput hooks", async () => {
    const cwd = await createSpaProject();
    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-application-output",
      setup() {
        return {
          transformOutput(output) {
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
      "[evjs] transformOutput hooks cannot add, remove, or rename Applications.",
    );
  });

  it("keeps CoreGraph Page identity immutable through transformOutput hooks", async () => {
    const cwd = await createSpaProject();
    await writeFile(
      path.join(cwd, "src/pages/page.config.ts"),
      'export default { title: "Home" };',
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-page-output",
      setup() {
        return {
          transformOutput(output) {
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
      "[evjs] transformOutput hooks cannot add, remove, or rename Pages.",
    );
  });

  it("keeps CoreGraph Page and Route paths immutable through transformOutput hooks", async () => {
    const cwd = await createSpaProject();
    await writeFile(
      path.join(cwd, "src/pages/page.config.ts"),
      'export default { title: "Home" };',
      "utf-8",
    );
    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-page-path-output",
      setup() {
        return {
          transformOutput(output) {
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
      "[evjs] transformOutput hooks cannot add, remove, reorder, or rename Routes, or change Route paths and ownership.",
    );
  });

  it("rejects transformOutput path mutation before writing outside the project", async () => {
    const cwd = await createSpaProject();
    const outsideDir = path.join(
      path.dirname(cwd),
      `${path.basename(cwd)}-outside-output`,
    );
    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-output-path",
      setup() {
        return {
          transformOutput(output) {
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

  it("validates ownership after each transformOutput hook", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const plugins: Plugin<Record<string, never>>[] = [
      {
        id: "temporarily-mutates-runtime",
        setup() {
          return {
            transformOutput(output) {
              events.push("mutate");
              output.runtime.server.fn = "temporary/fn";
            },
          };
        },
      },
      {
        id: "observes-temporary-runtime",
        setup() {
          return {
            transformOutput(output) {
              events.push("observe");
              output.deployment = { observedFn: output.runtime.server.fn };
            },
          };
        },
      },
      {
        id: "restores-runtime",
        setup() {
          return {
            transformOutput(output) {
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
        id: "mutates-transform-snapshot",
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
        id: "observes-transform-snapshot",
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
  }>)("rejects transformOutput $label mutation", async ({ mutate }) => {
    const cwd = await createServerOutputProject();
    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-output-semantics",
      setup() {
        return {
          transformOutput(output) {
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

  it("validates deployment metadata after each transformOutput hook", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const invalidMetadata: Plugin<Record<string, never>> = {
      id: "invalid-deployment-metadata",
      setup() {
        return {
          transformOutput(output) {
            events.push("invalid");
            output.deployment = { serialize() {} } as never;
          },
        };
      },
    };
    const laterPlugin: Plugin<Record<string, never>> = {
      id: "later-output-hook",
      setup() {
        return {
          transformOutput() {
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
      "BuildOutput after transformOutput hooks.deployment.serialize must be JSON-serializable",
    );
    expect(events).toEqual(["invalid"]);
    expect(fs.existsSync(path.join(cwd, "dist/deployment-metadata.json"))).toBe(
      false,
    );
  });

  it("allows transformOutput hooks to adjust every nested AssetGroup and deployment", async () => {
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
        return {
          clientEntryAssets,
          serverEntryAssets,
        };
      },
      async dev() {
        return createTestDevController();
      },
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
      id: "nested-asset-output",
      setup() {
        return {
          transformOutput(output) {
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
          afterBuild(result) {
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
      id: "manifest-result",
      setup() {
        return {
          beforeBuild() {
            events.push("manifest:beforeBuild");
          },
          transformHtml(doc: HtmlDocument, result: BuildResult) {
            events.push(`manifest:html:${firstClientJs(result)}`);
            doc.head?.appendChild(doc.createComment(" manifest html "));
          },
          afterBuild(result: BuildResult) {
            events.push(
              `manifest:afterBuild:${firstClientJs(result)}:${result.deploymentMetadata.server.entry ?? "none"}`,
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
      "bundler.build",
      "bundler.entries:main",
      "manifest:beforeBuild",
      "manifest:html:main.js",
      "manifest:afterBuild:main.js:none",
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
      async dev() {
        return createTestDevController();
      },
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
      id: "html-contribution",
      emitIR(ctx) {
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
      id: "page-metadata-order",
      emitIR(ctx) {
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
          afterBuild(result) {
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
      id: "server-document-shell",
      emitIR(ctx) {
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
            doc.documentElement?.setAttribute("data-capr-version", "2026.08");
            doc.body?.setAttribute("data-transformed", "yes");
            doc.body?.insertAdjacentHTML(
              "beforeend",
              '<script id="capr-runtime" src="/capr.js"></script><script id="ppr-snapshot">globalThis.__PPR__ = true;</script>',
            );
            const title = doc.querySelector("title");
            if (title) title.textContent = "Plugin title";
          },
          afterBuild(result) {
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
        return {
          clientEntryAssets: {
            [clientEntryName]: clientAssets,
          },
          serverEntryAssets: serverEntries,
        };
      },
      async dev() {
        return createTestDevController();
      },
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
      mode === "spa" ? "index.html" : "dashboard.html",
    ]);
    expect(html).toContain('<html lang="zh-CN"');
    expect(html).toContain('data-template="configured"');
    expect(html).toContain(`data-plugin="${mode}"`);
    expect(html).toContain('data-capr-version="2026.08"');
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
    expect(html).toContain(
      '<script id="capr-runtime" src="/capr.js"></script>',
    );
    expect(html).toContain('<script id="ppr-snapshot">');
    expect(html).not.toContain("Template fallback");

    if (mode === "mpa") {
      const fallbackHtml = await fs.promises.readFile(
        path.join(cwd, "dist/client/dashboard.html"),
        "utf-8",
      );
      const deployment = JSON.parse(
        await fs.promises.readFile(
          path.join(cwd, "dist/deployment-metadata.json"),
          "utf-8",
        ),
      );

      expect(fallbackHtml).toContain('data-plugin="mpa"');
      expect(fallbackHtml).toContain('data-capr-version="2026.08"');
      expect(fallbackHtml).toContain('data-transformed="yes"');
      expect(fallbackHtml).toContain(
        '<meta name="from-contribution" content="mpa">',
      );
      expect(fallbackHtml).toContain('<main id="app"></main>');
      expect(fallbackHtml).not.toContain("data-evjs-hydrate");
      expect(fallbackHtml).not.toContain("Template fallback");
      expect(fallbackHtml).toContain('id="__EVJS_CLIENT_RUNTIME__"');
      expect(fallbackHtml).toContain(`src="/${clientEntryName}.js"`);
      expect(fallbackHtml).toContain(
        '<script id="capr-runtime" src="/capr.js"></script>',
      );
      expect(fallbackHtml).toContain('<script id="ppr-snapshot">');
      expect(
        html
          .replace(' data-evjs-hydrate="load"', "")
          .replace("__PAGE_CONTENT__", "")
          .replace("__REQUEST_DATA__", ""),
      ).toBe(fallbackHtml);
      expect(deployment.documents).toContainEqual({
        kind: "page",
        id: "dashboard",
        fileName: "dashboard.html",
        assets: {
          js: clientAssets.js,
          css: [...clientAssets.css, `${pageServerEntryName}.css`],
        },
      });
      expect(deployment.routes).toContainEqual({
        kind: "server-page",
        path: "/dashboard",
        pageId: "dashboard",
        render: "ssr",
        methods: ["GET", "HEAD"],
      });
    }
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
              id: "removes-server-document-marker",
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
      { cwd },
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
      id: "page-scope",
      emitIR(ctx) {
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
      async dev() {
        return createTestDevController();
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
      path.join(cwd, "dist/client/home.html"),
      "utf-8",
    );
    const adminHtml = await fs.promises.readFile(
      path.join(cwd, "dist/client/admin.html"),
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
      path.join(cwd, "src/middlewares/middleware.ts"),
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
      async dev() {
        return createTestDevController();
      },
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
      async dev() {
        return createTestDevController();
      },
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
      fs.promises.readFile(path.join(cwd, "dist/client/product.html"), "utf-8"),
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
            aliases: ["about-alias.html", "legacy/about.htm"],
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
      Record<string, never>
    >({
      id: "document-alias-observer",
      emitIR(ctx) {
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
      async dev() {
        return createTestDevController();
      },
    };
    const config: Config<Record<string, never>> = {
      routing: { mode: "mpa" },
      plugins: [plugin],
    };

    await build(config, { cwd, bundler });

    const primaryPath = path.join(cwd, "dist/client/about.html");
    const aliasPath = path.join(cwd, "dist/client/about-alias.html");
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
    expect(frameworkAliases).toEqual([
      ["about-alias.html", "legacy/about.htm"],
    ]);
    const firstDeployment = JSON.parse(
      await fs.promises.readFile(
        path.join(cwd, "dist/deployment-metadata.json"),
        "utf-8",
      ),
    ) as { documents: unknown[] };
    expect(firstDeployment.documents).toContainEqual({
      kind: "page",
      id: "about",
      fileName: "about.html",
      aliases: ["about-alias.html", "legacy/about.htm"],
      assets: { js: ["page-client-about.js"], css: [] },
    });

    await writeFile(pageConfigFile, "export default {};", "utf-8");
    await build(config, { cwd, bundler });

    expect(transformCalls).toBe(2);
    expect(frameworkAliases).toEqual([
      ["about-alias.html", "legacy/about.htm"],
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

  it("passes linked BuildOutput to afterBuild and emits deployment metadata", async () => {
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
      async dev() {
        return createTestDevController();
      },
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [
          {
            id: "reads-memory-output",
            setup() {
              return {
                afterBuild(result) {
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
      async dev() {
        return createTestDevController();
      },
    };

    await build(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [
          {
            id: "captures-page-output",
            setup() {
              return {
                afterBuild(result) {
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
        };
      },
      async dev() {
        return createTestDevController();
      },
    };

    await build(
      {
        routing: { mode: "mpa" },
        plugins: [
          {
            id: "records-raw-output",
            setup() {
              return {
                afterBuild(result) {
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
        return createTestDevController();
      },
    };

    await build(
      {
        routing: { mode: "mpa" },
      },
      { cwd, bundler },
    );

    const html = fs.readFileSync(
      path.join(cwd, "dist/client/report.html"),
      "utf-8",
    );
    const transformOutput = JSON.parse(
      fs.readFileSync(path.join(cwd, "dist/deployment-metadata.json"), "utf-8"),
    );

    expect(html).toContain("Prerendered Report");
    expect(html).toContain("http://evjs.local/report.html");
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain("__EVJS_CLIENT_RUNTIME__");
    expect(html).not.toContain("data-evjs-hydrate");
    expect(transformOutput.server).toEqual({});
    expect(transformOutput.documents).toContainEqual({
      kind: "page",
      id: "report",
      fileName: "report.html",
    });
    expect(transformOutput.routes).toEqual([
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
        return createTestDevController();
      },
    };

    await build(
      {
        routing: { mode: "mpa" },
      },
      { cwd, bundler },
    );

    const html = fs.readFileSync(
      path.join(cwd, "dist/client/report.html"),
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
        return createTestDevController();
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
        return createTestDevController();
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

  it("replaces the production dist tree while preserving current bundler HTML", async () => {
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
            path.join(cwd, plan.output.clientDir, bundlerOwnedFile),
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
      async dev() {
        return createTestDevController();
      },
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

    const reportHtml = path.join(cwd, "dist/client/report.html");
    const archiveHtml = path.join(cwd, "dist/client/archive.html");
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
    bundlerOwnedFile = "report.html";

    await build(
      { output: { client: "dist/client" }, routing: { mode: "mpa" } },
      { cwd, bundler },
    );

    expect(fs.readFileSync(reportHtml, "utf-8")).toBe("bundler replacement");
    expect(fs.existsSync(archiveHtml)).toBe(false);
    expect(fs.existsSync(unrelatedHtml)).toBe(false);
  });

  it("runs plugin config hooks before resolving config", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const bundler = createMockBundler(events, { recordEndpoint: true });

    const plugin: Plugin<Record<string, never>> = {
      id: "sets-server-base-path",
      configure(config, ctx) {
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
      id: "invalid-dev-port",
      configure(config) {
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

  it("rejects invalid plugin configure hook return values", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-config-return",
      configure() {
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
      '[evjs] Plugin "invalid-config-return" configure hook must return a config object or undefined.',
    );
    expect(events).toEqual(["config"]);
  });

  it("rejects invalid plugin setup hook return values", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      id: "invalid-setup-return",
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
      id: "invalid-lifecycle-hook",
      setup() {
        events.push("setup");
        return {
          beforeBuild: "start" as never,
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
      '[evjs] Plugin "invalid-lifecycle-hook" setup hook returned beforeBuild must be a function.',
    );
    expect(events).toEqual(["setup"]);
  });

  it("suggests the current spelling for mis-cased lifecycle hooks", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      id: "typo-lifecycle-hook",
      setup() {
        events.push("setup");
        return {
          beforebuild() {},
          beforeBuild() {
            events.push("beforeBuild");
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
      '[evjs] Plugin "typo-lifecycle-hook" setup hook returned unsupported hook "beforebuild". Use "beforeBuild" instead.',
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
      path.join(cwd, "src/middlewares/middleware.ts"),
      [
        'import type { MiddlewareChain } from "@evjs/ev/server-context";',
        "const tracing = async (_ctx, next) => next();",
        "const authentication = async (_ctx, next) => next();",
        "export default [tracing, authentication] satisfies MiddlewareChain;",
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
              id: "src/middlewares/middleware.ts:global-middleware",
              module: "src/middlewares/middleware.ts",
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
    await expect(
      fs.promises.readFile(path.join(cwd, ".ev/entries/server.ts"), "utf-8"),
    ).resolves.toContain(
      "const middlewares = [...(Array.isArray(middleware0) ? middleware0 : [middleware0])];",
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

  it("orders plugin configure and lifecycle hooks by dependencies", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const pluginA: Plugin<Record<string, never>> = {
      id: "plugin-a",
      configure(config) {
        events.push("config:a");
        return config;
      },
      setup() {
        events.push("setup:a");
        return {
          beforeBuild() {
            events.push("beforeBuild:a");
          },
          afterBuild() {
            events.push("afterBuild:a");
          },
        };
      },
    };
    const pluginB: Plugin<Record<string, never>> = {
      id: "plugin-b",
      dependencies: ["plugin-a"],
      configure(config) {
        events.push("config:b");
        return config;
      },
      setup() {
        events.push("setup:b");
        return {
          beforeBuild() {
            events.push("beforeBuild:b");
          },
          afterBuild() {
            events.push("afterBuild:b");
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
      "bundler.build",
      "bundler.entries:",
      "beforeBuild:a",
      "beforeBuild:b",
      "afterBuild:a",
      "afterBuild:b",
    ]);
  });

  it("preserves user order for plugins unrelated to a dependency", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    function plugin(
      id: string,
      dependencies?: string[],
    ): Plugin<Record<string, never>> {
      return {
        id,
        dependencies,
        setup() {
          events.push(`setup:${id}`);
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
            id: "post",
            enforce: "post",
            setup() {
              events.push("setup:post");
            },
          },
          {
            id: "normal",
            setup() {
              events.push("setup:normal");
            },
          },
          {
            id: "pre",
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
      id: string,
      options: Pick<
        Plugin<Record<string, never>>,
        "dependencies" | "optionalDependencies"
      > = {},
    ): Plugin<Record<string, never>> {
      return {
        id,
        ...options,
        setup() {
          events.push(`setup:${id}`);
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
            id: "plugin-b",
            dependencies: ["plugin-c"],
            optionalDependencies: ["plugin-a"],
            setup() {
              events.push("setup:plugin-b");
            },
          },
          {
            id: "plugin-c",
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
          plugins: [{ id: "plugin-b", dependencies: ["plugin-a"] }],
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
            { id: "plugin-a", dependencies: ["plugin-b"] },
            { id: "plugin-b", dependencies: ["plugin-a"] },
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
            { id: "plugin-a", optionalDependencies: ["plugin-b"] },
            { id: "plugin-b", dependencies: ["plugin-a"] },
          ],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow(
      "Circular plugin dependency detected: plugin-a -> plugin-b -> plugin-a",
    );
  });

  it("throws on duplicate plugin ids", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [{ id: "plugin-a" }, { id: "plugin-a" }],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow('Duplicate plugin id "plugin-a"');

    await expect(
      build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [{ id: "errorReporting" }, { id: "errorreporting" }],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow(
      'plugin id "errorreporting" conflicts with "errorReporting"',
    );
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
              id: "",
              configure(config) {
                events.push("config");
                return config;
              },
            },
          ],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow(
      '[evjs] plugins[0].id "" must be a lower camel case or lowercase kebab-case plugin id',
    );

    expect(events).toEqual([]);
  });
});
