import fs from "node:fs";
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
  BundlerDevContext,
} from "../src/_internal/build/bundler.js";
import {
  build,
  dev,
  prepareFrameworkBuild,
} from "../src/_internal/build/commands.js";
import { materializeFrameworkIR } from "../src/_internal/build/generated-contributions.js";
import { PAGE_ANCHOR_ROUTE_CONVENTION_SUMMARY } from "../src/_internal/build/page-route-conventions.js";
import {
  PAGE_ROUTE_TYPES_MARKER,
  PAGE_ROUTE_TYPES_USAGE_HINT,
} from "../src/_internal/build/page-route-types.js";
import { collectPluginHooks } from "../src/_internal/build/plugin-lifecycle.js";
import type { Config } from "../src/config/index.js";
import type {
  BuildResult,
  ConfigureBundlerContext,
  FrameworkPageView,
  FrameworkRouteView,
  HtmlDocument,
  Plugin,
  PluginContext,
  PluginHooks,
} from "../src/plugin/index.js";
import {
  definePlugin,
  PLUGIN_HOOK_ERROR_CODE,
  PluginHookError,
  pluginOptions,
} from "../src/plugin/index.js";

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
    configuration: true,
    html: true,
    entries: true,
    routes: true,
    server: true,
    resolution: true,
  },
} as const;
const TRANSFORM_OUTPUT_HOOK_OWNERSHIP_ERROR =
  "[evjs] transformOutput hooks cannot change non-asset BuildOutput fields. Hooks may only adjust existing AssetGroup contents or deployment metadata.";

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

async function createOscillatingSourceAliasProject() {
  const cwd = await createProject();
  await writeFile(
    path.join(cwd, "src/pages/page.tsx"),
    [
      'import { saveValue } from "@switch/actions";',
      "void saveValue;",
      "export default function Page() { return null; }",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(cwd, "src/with-server/actions.ts"),
    '"use server"; export async function saveValue() {}',
    "utf-8",
  );
  await writeFile(
    path.join(cwd, "src/without-server/actions.ts"),
    "export function saveValue() {}",
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
      return {
        async updatePlan(update) {
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
      };
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
      configure(config, ctx) {
        events.push(`config:${ctx.command}`);
        return config;
      },
      setup(ctx) {
        expect(ctx.config.bundler).toBeUndefined();
        ctx.addWatchFile("./framework-extra.json");
        events.push(`setup:${ctx.command}`);
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

    expect(prepared.config.output.client).toBe("dist/client");
    expect("graph" in prepared).toBe(false);
    expect("plan" in prepared).toBe(false);
    expect("hooks" in prepared).toBe(false);
    expect("pluginContext" in prepared).toBe(false);
    expect(prepared.pluginWatchFiles).toEqual([
      path.join(cwd, "framework-extra.json"),
    ]);
    expect(events).toEqual(["config:build", "setup:build"]);

    await prepared.dispose();
    await prepared.dispose();

    expect(events).toEqual(["config:build", "setup:build", "dispose"]);
  });

  it("syncs one stable static-config bridge regardless of active plugins", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default {};",
      "utf-8",
    );
    const analytics = definePlugin({
      name: "@test/analytics",
      key: "analytics",
      page: pluginOptions<{ channel: string }>(),
    });
    const access = definePlugin({
      name: "@test/access",
      key: "access",
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

  it("syncs Page plugin types before config hooks can fail", async () => {
    const cwd = await createProject();
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default {};",
      "utf-8",
    );

    await expect(
      prepareFrameworkBuild(
        {
          plugins: [
            {
              name: "broken-configure",
              configure() {
                throw new Error("configure failed");
              },
            },
          ],
        },
        { cwd },
      ),
    ).rejects.toThrow("configure failed");

    await expect(
      fs.promises.readFile(path.join(cwd, "src/plugin-types.d.ts"), "utf-8"),
    ).resolves.toContain(
      'readonly config: typeof import("../ev.config").default;',
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
          beforeBuild(buildCtx) {
            events.push(
              `beforeBuild:${buildCtx.flags?.mock}:${buildCtx.flags?.coverage}`,
            );
          },
        };
      },
    };

    await build(
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
        bundler: createMockBundler(events),
      },
    );

    expect(events).toEqual([
      "setup:true:true",
      "bundler.build",
      "bundler.entries:",
      "beforeBuild:true:true",
    ]);
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

  it("attributes lifecycle failures to the plugin and hook", async () => {
    const cwd = await createProject();
    const cause = new Error("beforeBuild blocked");
    let thrown: unknown;

    try {
      await build(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [
            {
              name: "attributed-plugin",
              setup() {
                return {
                  beforeBuild() {
                    throw cause;
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
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PluginHookError);
    expect(thrown).toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "attributed-plugin",
      hook: "beforeBuild",
      cause,
    });
  });

  it("attributes direct managed configureBundler failures", async () => {
    const cwd = await createProject();
    const cause = new Error("bundler configuration blocked");
    const pluginContext = {
      mode: "development",
      command: "dev",
      cwd,
      config: {} as PluginContext<Record<string, never>>["config"],
      logger: console as never,
      addWatchFile() {},
    } satisfies PluginContext<Record<string, never>>;
    const hooks = await collectPluginHooks(
      [
        {
          name: "direct-configure-bundler",
          setup() {
            return {
              configureBundler() {
                throw cause;
              },
            };
          },
        },
      ],
      pluginContext,
    );
    const configureBundler = hooks[0]?.configureBundler;
    if (!configureBundler) {
      throw new Error("Expected a managed configureBundler hook.");
    }
    const bundlerContext = {
      ...pluginContext,
      bundlerName: "test",
      environment: "client",
    } satisfies ConfigureBundlerContext<Record<string, never>>;

    await expect(configureBundler({}, bundlerContext)).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "direct-configure-bundler",
      hook: "configureBundler",
      cause,
    });
  });

  it("runs setup disposers in reverse order when setup throws", async () => {
    const cwd = await createProject();
    const events: string[] = [];

    await expect(
      prepareFrameworkBuild(
        {
          plugins: [
            {
              name: "setup-rollback",
              setup(ctx) {
                ctx.onDispose(() => {
                  events.push("dispose:first");
                });
                ctx.onDispose(() => {
                  events.push("dispose:second");
                });
                events.push("setup");
                throw new Error("setup aborted");
              },
            },
          ],
        },
        { cwd },
      ),
    ).rejects.toThrow("setup aborted");

    expect(events).toEqual(["setup", "dispose:second", "dispose:first"]);
  });

  it("rolls back setup resources when returned hooks are invalid", async () => {
    const cwd = await createProject();
    const events: string[] = [];

    await expect(
      prepareFrameworkBuild(
        {
          plugins: [
            {
              name: "invalid-hooks-rollback",
              setup(ctx) {
                ctx.onDispose(() => {
                  events.push("dispose:first");
                });
                ctx.onDispose(() => {
                  events.push("dispose:second");
                });
                return {
                  beforeBuild: "invalid" as never,
                  dispose() {
                    events.push("dispose:hooks");
                  },
                };
              },
            },
          ],
        },
        { cwd },
      ),
    ).rejects.toThrow(
      'Plugin "invalid-hooks-rollback" setup hook returned beforeBuild must be a function',
    );

    expect(events).toEqual([
      "dispose:hooks",
      "dispose:second",
      "dispose:first",
    ]);
  });

  it.each([
    {
      label: "an inherited hook",
      create(onGetterRead: () => void) {
        void onGetterRead;
        return Object.create({
          beforeBuild() {
            throw new Error("inherited hook must not run");
          },
        });
      },
    },
    {
      label: "an inherited getter",
      create(onGetterRead: () => void) {
        const prototype = Object.create(null);
        Object.defineProperty(prototype, "beforeBuild", {
          enumerable: true,
          get() {
            onGetterRead();
            throw new Error("inherited getter must not run");
          },
        });
        return Object.create(prototype);
      },
    },
    {
      label: "a class instance",
      create(onGetterRead: () => void) {
        void onGetterRead;
        return new (class SetupHooks {
          beforeBuild() {
            throw new Error("class hook must not run");
          }
        })();
      },
    },
  ])("rejects setup results with $label", async ({ create }) => {
    const cwd = await createProject();
    let getterReads = 0;
    const preparing = prepareFrameworkBuild(
      {
        plugins: [
          {
            name: "invalid-setup-result",
            setup() {
              return create(() => {
                getterReads += 1;
              });
            },
          },
        ],
      },
      { cwd },
    );

    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "invalid-setup-result",
      hook: "setup",
      cause: expect.any(Error),
    });
    await expect(preparing).rejects.toThrow(
      "setup hook must return a plain plugin hooks object",
    );
    expect(getterReads).toBe(0);
  });

  it("rejects setup result getters without invoking them", async () => {
    const cwd = await createProject();
    let getterReads = 0;
    const returnedHooks = {};
    Object.defineProperty(returnedHooks, "beforeBuild", {
      enumerable: true,
      get() {
        getterReads += 1;
        throw new Error("own getter must not run");
      },
    });
    const preparing = prepareFrameworkBuild(
      {
        plugins: [
          {
            name: "getter-setup-result",
            setup() {
              return returnedHooks;
            },
          },
        ],
      },
      { cwd },
    );

    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "getter-setup-result",
      hook: "setup",
      cause: expect.any(Error),
    });
    await expect(preparing).rejects.toThrow(
      'setup hook returned "beforeBuild" must be an enumerable own data property',
    );
    expect(getterReads).toBe(0);
  });

  it("accepts null-prototype setup hooks and preserves their receiver", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const returnedHooks = Object.create(null) as PluginHooks;
    returnedHooks.dispose = function () {
      events.push(this === returnedHooks ? "dispose:bound" : "dispose:unbound");
    };
    const prepared = await prepareFrameworkBuild(
      {
        plugins: [
          {
            name: "null-prototype-hooks",
            setup() {
              return returnedHooks;
            },
          },
        ],
      },
      { cwd },
    );

    await prepared.dispose();
    expect(events).toEqual(["dispose:bound"]);
  });

  it("captures setup hooks once and preserves their receiver", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const returnedHooks: PluginHooks<Record<string, never>> = {
      beforeBuild() {
        events.push(this === returnedHooks ? "before:bound" : "before:unbound");
      },
      dispose() {
        events.push(
          this === returnedHooks ? "dispose:bound" : "dispose:unbound",
        );
      },
    };
    const baseBundler = createMockBundler([]);
    const baseBuild = baseBundler.build;
    if (!baseBuild) throw new Error("Expected mock build implementation.");
    const bundler: BundlerAdapter<Record<string, never>> = {
      ...baseBundler,
      async build(context) {
        returnedHooks.beforeBuild = () => {
          events.push("before:replacement");
        };
        returnedHooks.dispose = () => {
          events.push("dispose:replacement");
        };
        return baseBuild(context);
      },
    };

    await build(
      {
        plugins: [
          {
            name: "stable-setup-hooks",
            setup() {
              return returnedHooks;
            },
          },
        ],
      },
      { cwd, bundler },
    );

    expect(events).toEqual(["before:bound", "dispose:bound"]);
  });

  it("isolates resolved config passed to plugin runtime contexts", async () => {
    const cwd = await createProject();
    const snapshots: object[] = [];
    const mutationResults: boolean[] = [];
    let activeConfig: object | undefined;
    let readActiveBasePath: (() => string) | undefined;
    const baseBundler = createMockBundler([]);
    const baseBuild = baseBundler.build;
    if (!baseBuild) throw new Error("Expected mock build implementation.");
    const bundler: BundlerAdapter<Record<string, never>> = {
      ...baseBundler,
      async build(context) {
        activeConfig = context.config;
        readActiveBasePath = () => context.config.server.basePath;
        return baseBuild(context);
      },
    };

    await build(
      {
        server: { basePath: "/api" },
        plugins: [
          {
            name: "isolated-plugin-context",
            setup(ctx) {
              snapshots.push(ctx.config);
              mutationResults.push(
                Reflect.set(ctx.config.server, "basePath", "/from-setup"),
              );
              return {
                beforeBuild(buildCtx) {
                  snapshots.push(buildCtx.config);
                  mutationResults.push(
                    Reflect.set(
                      buildCtx.config.server,
                      "basePath",
                      "/from-before-build",
                    ),
                  );
                },
              };
            },
            emitIR(ctx) {
              snapshots.push(ctx.config);
              mutationResults.push(
                Reflect.set(ctx.config.server, "basePath", "/from-emit-ir"),
              );
            },
          },
        ],
      },
      { cwd, bundler },
    );

    expect(mutationResults).toEqual([false, false, false]);
    expect(snapshots).toHaveLength(3);
    for (const snapshot of snapshots) {
      expect(snapshot).not.toBe(activeConfig);
      expect(Object.isFrozen(snapshot)).toBe(true);
    }
    expect(readActiveBasePath?.()).toBe("/api");
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
      emitIR(ctx) {
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

  it("attributes delayed generated-module source failures to emitIR", async () => {
    const cwd = await createProject();
    const cause = new Error("generated source failed");
    const preparing = prepareFrameworkBuild(
      {
        plugins: [
          {
            name: "delayed-source-failure",
            emitIR(ctx) {
              ctx.emit.module({
                id: "broken-source",
                scope: { kind: "application" },
                source() {
                  throw cause;
                },
              });
            },
          },
        ],
      },
      { cwd },
    );

    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "delayed-source-failure",
      hook: "emitIR",
      cause,
    });
    await expect(preparing).rejects.toBeInstanceOf(PluginHookError);
  });

  it.each([
    { label: "undefined", value: undefined },
    { label: "non-string", value: 42 },
  ])("attributes a $label generated-module source result to emitIR", async ({
    value,
  }) => {
    const cwd = await createProject();
    const preparing = prepareFrameworkBuild(
      {
        plugins: [
          {
            name: "invalid-source-result",
            emitIR(ctx) {
              ctx.emit.module({
                id: "invalid-source",
                scope: { kind: "application" },
                source: (() => value) as never,
              });
            },
          },
        ],
      },
      { cwd },
    );

    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "invalid-source-result",
      hook: "emitIR",
      cause: expect.any(Error),
    });
    await expect(preparing).rejects.toThrow(
      'generated module "invalid-source" source factory must return a string',
    );
  });

  it("attributes delayed defined-plugin source validation to emitPageIR", async () => {
    const cwd = await createSpaProject();
    const pageEmitter = definePlugin({
      name: "@company/page-source",
      key: "page-source",
      page: pluginOptions({ defaults: {} }),
      emitPageIR(ctx) {
        ctx.emit.module({
          id: `source-${ctx.page.id}`,
          scope: { kind: "page", pageId: ctx.page.id },
          source: (() => undefined) as never,
        });
      },
    });
    const preparing = prepareFrameworkBuild(
      {
        plugins: [pageEmitter()],
        routing: { mode: "spa" },
      },
      { cwd },
    );

    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "@company/page-source",
      hook: "emitPageIR",
      cause: expect.any(Error),
    });
    await expect(preparing).rejects.toThrow(
      'generated module "source-index" source factory must return a string',
    );
  });

  it("allocates portable generated module paths past a hash collision", async () => {
    const cwd = await createSpaProject();
    const collidingIds = ["runtime", "runtime*`=)", "runtime{`{+"];
    const plugin: Plugin<Record<string, never>> = {
      name: "collision",
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
      name: "invalid-page-wrapper-runtime",
      emitIR(ctx) {
        ctx.slot("page.wrapper").add({
          id: "server-wrapper",
          module: "./src/ServerWrapper.tsx",
          runtime: "server",
          target: { kind: "page", pageId: "index" },
        });
      },
    };

    const preparing = prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      { cwd },
    );
    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "invalid-page-wrapper-runtime",
      hook: "emitIR",
      cause: expect.any(Error),
    });
    await expect(preparing).rejects.toThrow(
      'page.wrapper contribution "server-wrapper" targets Page "index", but no server Page runtime projection exists',
    );
  });

  it("attributes defined-plugin target validation to emitPageIR", async () => {
    const cwd = await createSpaProject();
    const pageEmitter = definePlugin({
      name: "@company/page-target",
      key: "page-target",
      page: pluginOptions({ defaults: {} }),
      emitPageIR(ctx) {
        ctx.slot("html.tag").add({
          id: `tag-${ctx.page.id}`,
          tag: "meta",
          placement: "head-append",
          target: { kind: "page", pageId: "missing" },
        });
      },
    });
    const preparing = prepareFrameworkBuild(
      {
        plugins: [pageEmitter()],
        routing: { mode: "spa" },
      },
      { cwd },
    );

    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "@company/page-target",
      hook: "emitPageIR",
      cause: expect.any(Error),
    });
    await expect(preparing).rejects.toThrow(
      'html.tag contribution "tag-index" targets unknown page "missing"',
    );
  });

  it("attributes defined-plugin wrapper projection validation to emitPageIR", async () => {
    const cwd = await createSpaProject();
    const pageEmitter = definePlugin({
      name: "@company/page-wrapper",
      key: "page-wrapper",
      page: pluginOptions({ defaults: {} }),
      emitPageIR(ctx) {
        ctx.slot("page.wrapper").add({
          id: `wrapper-${ctx.page.id}`,
          module: "./src/ServerWrapper.tsx",
          runtime: "server",
          target: { kind: "page", pageId: ctx.page.id },
        });
      },
    });
    const preparing = prepareFrameworkBuild(
      {
        plugins: [pageEmitter()],
        routing: { mode: "spa" },
      },
      { cwd },
    );

    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "@company/page-wrapper",
      hook: "emitPageIR",
      cause: expect.any(Error),
    });
    await expect(preparing).rejects.toThrow(
      'page.wrapper contribution "wrapper-index" targets Page "index", but no server Page runtime projection exists',
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

  it("retains prototype-named resolve alias and external specifiers", async () => {
    const cwd = await createSpaProject();
    const plugin: Plugin<Record<string, never>> = {
      name: "prototype-named-resolve",
      emitIR(ctx) {
        ctx.slot("resolve.alias").add({
          id: "prototype-alias",
          specifier: "__proto__",
          replacement: "./src/prototype-alias.ts",
        });
        ctx.slot("resolve.external").add({
          id: "prototype-external",
          specifier: "__proto__",
          source: "PrototypeExternal",
          runtime: "client",
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      { cwd },
    );
    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
    ) as BuildPlan;

    expect(Object.hasOwn(manifest.resolve?.alias ?? {}, "__proto__")).toBe(
      true,
    );
    expect(manifest.resolve?.alias?.__proto__).toBe("./src/prototype-alias.ts");
    expect(Object.hasOwn(manifest.resolve?.external ?? {}, "__proto__")).toBe(
      true,
    );
    expect(manifest.resolve?.external?.__proto__).toEqual({
      source: "PrototypeExternal",
      runtime: "client",
    });

    await prepared.dispose();
  });

  it("retains a prototype-named HTML attribute", async () => {
    const cwd = await createSpaProject();
    const attrs: Record<string, string> = {};
    Object.defineProperty(attrs, "__proto__", {
      enumerable: true,
      value: "prototype-attribute",
    });
    const plugin: Plugin<Record<string, never>> = {
      name: "prototype-named-html-attribute",
      emitIR(ctx) {
        ctx.slot("html.tag").add({
          id: "prototype-attribute",
          tag: "meta",
          placement: "head-append",
          attrs,
        });
      },
    };

    const prepared = await prepareFrameworkBuild(
      {
        plugins: [plugin],
        routing: { mode: "spa" },
      },
      { cwd },
    );
    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
    ) as BuildPlan;
    const manifestSlot = manifest.generated?.slots.find(
      (slot) => slot.slot === "html.tag" && slot.id === "prototype-attribute",
    );
    if (manifestSlot?.slot !== "html.tag") {
      throw new Error("Expected the prototype-attribute html.tag slot.");
    }
    const manifestAttrs = manifestSlot.attrs;

    expect(Object.hasOwn(manifestAttrs ?? {}, "__proto__")).toBe(true);
    expect(manifestAttrs?.__proto__).toBe("prototype-attribute");

    await prepared.dispose();
  });

  it("normalizes generated scopes and targets before serializing IR", async () => {
    const cwd = await createSpaProject();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const scope = {
      kind: "application" as const,
      cycle,
      bigint: 1n,
      toJSON() {
        throw new Error("scope toJSON must not execute");
      },
    };
    Object.defineProperty(scope, "late", {
      enumerable: true,
      get() {
        throw new Error("scope extra getter must not execute");
      },
    });
    const rawEmitter: Plugin<Record<string, never>> = {
      name: "normalizes-generated-scope",
      emitIR(ctx) {
        ctx.emit.module({
          id: "normalized-scope",
          scope,
          source: "export const normalized = true;",
        });
      },
    };
    const pageEmitter = definePlugin({
      name: "@company/normalizes-contribution-target",
      key: "normalizes-target",
      page: pluginOptions({ defaults: {} }),
      emitPageIR(ctx) {
        const target = {
          kind: "application" as const,
          applicationId: ctx.page.applicationId,
          cycle,
          bigint: 1n,
          toJSON() {
            throw new Error("target toJSON must not execute");
          },
        };
        Object.defineProperty(target, "late", {
          enumerable: true,
          get() {
            throw new Error("target extra getter must not execute");
          },
        });
        ctx.slot("html.tag").add({
          id: `normalized-target-${ctx.page.id}`,
          tag: "meta",
          placement: "head-append",
          target,
        });
      },
    });

    const prepared = await prepareFrameworkBuild(
      {
        plugins: [rawEmitter, pageEmitter()],
        routing: { mode: "spa" },
      },
      { cwd },
    );
    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
    ) as BuildPlan;

    expect(
      manifest.generated?.modules.find(
        (module) => module.id === "normalized-scope",
      )?.scope,
    ).toEqual({ kind: "application" });
    const normalizedTargetSlot = manifest.generated?.slots.find(
      (slot) =>
        slot.slot === "html.tag" && slot.id === "normalized-target-index",
    );
    if (normalizedTargetSlot?.slot !== "html.tag") {
      throw new Error("Expected the normalized-target-index html.tag slot.");
    }
    expect(normalizedTargetSlot.target).toEqual({
      kind: "application",
      applicationId: "default",
    });

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
      emitIR(ctx) {
        ctx.emit.data({
          id: "payload",
          scope: { kind: "application" },
          value: createValue() as never,
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
      name: "observe-page-anchors",
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
      name: "invalid-spa-page-entry",
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

    const preparing = prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [plugin],
      },
      { cwd },
    );
    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "invalid-spa-page-entry",
      hook: "emitIR",
      cause: expect.any(Error),
    });
    await expect(preparing).rejects.toThrow(
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
      name: "mpa-application-target",
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
      name: "unknown-constructor-page",
      emitIR(ctx) {
        ctx.emit.module({
          id: "constructor-module",
          scope: { kind: "page", pageId: "constructor" },
          source: "export {};",
        });
      },
    };

    const preparing = prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [plugin],
      },
      { cwd },
    );
    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "unknown-constructor-page",
      hook: "emitIR",
      cause: expect.any(Error),
    });
    await expect(preparing).rejects.toThrow(
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
    await prepared.dispose();
  });

  it("attributes non-converging source aliases to raw emitIR", async () => {
    const cwd = await createOscillatingSourceAliasProject();
    const plugin: Plugin<Record<string, never>> = {
      name: "oscillating-source-alias",
      emitIR(ctx) {
        const foundServerFunction = ctx.framework.serverFunctions.some(
          (serverFunction) =>
            serverFunction.module === "src/with-server/actions.ts",
        );
        ctx.slot("resolve.alias").add({
          id: "switch",
          specifier: "@switch",
          replacement: foundServerFunction
            ? "./src/without-server"
            : "./src/with-server",
        });
      },
    };
    const preparing = prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [plugin],
      },
      { cwd },
    );

    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "oscillating-source-alias",
      hook: "emitIR",
      cause: expect.objectContaining({
        message:
          "[evjs] Plugin source alias contributions did not converge after 5 framework graph analysis passes.",
      }),
    });
  });

  it("attributes non-converging Page source aliases to emitPageIR", async () => {
    const cwd = await createOscillatingSourceAliasProject();
    const pageAlias = definePlugin({
      name: "@company/oscillating-page-alias",
      key: "oscillating-page-alias",
      page: pluginOptions({ defaults: {} }),
      emitPageIR(ctx) {
        const foundServerFunction = ctx.framework.serverFunctions.some(
          (serverFunction) =>
            serverFunction.module === "src/with-server/actions.ts",
        );
        ctx.slot("resolve.alias").add({
          id: `switch-${ctx.page.id}`,
          specifier: "@switch",
          replacement: foundServerFunction
            ? "./src/without-server"
            : "./src/with-server",
        });
      },
    });
    const preparing = prepareFrameworkBuild(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "spa" },
        plugins: [pageAlias()],
      },
      { cwd },
    );

    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "@company/oscillating-page-alias",
      hook: "emitPageIR",
      cause: expect.objectContaining({
        message:
          "[evjs] Plugin source alias contributions did not converge after 5 framework graph analysis passes.",
      }),
    });
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

  it("attributes a client entry replacement conflict to its second origin hook", async () => {
    const cwd = await createSpaProject();
    const firstReplacer: Plugin<Record<string, never>> = {
      name: "first-entry-replacer",
      emitIR(ctx) {
        const replacement = ctx.emit.module({
          id: "first-replacement",
          scope: { kind: "application" },
          source: "export const first = true;",
        });
        ctx.slot("client.entry").add({
          id: "first-replacement-slot",
          module: replacement,
          position: "before-main",
          mode: "replace",
        });
      },
    };
    const pageReplacer = definePlugin({
      name: "@company/page-entry-replacer",
      key: "page-entry-replacer",
      page: pluginOptions({ defaults: {} }),
      emitPageIR(ctx) {
        const replacement = ctx.emit.module({
          id: `replacement-${ctx.page.id}`,
          scope: { kind: "page", pageId: ctx.page.id },
          source: "export const second = true;",
        });
        ctx.slot("client.entry").add({
          id: `replacement-slot-${ctx.page.id}`,
          module: replacement,
          position: "before-main",
          mode: "replace",
          target: {
            kind: "application",
            applicationId: ctx.page.applicationId,
          },
        });
      },
    });
    const preparing = prepareFrameworkBuild(
      {
        plugins: [firstReplacer, pageReplacer()],
        routing: { mode: "spa" },
      },
      { cwd },
    );

    await expect(preparing).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "@company/page-entry-replacer",
      hook: "emitPageIR",
      cause: expect.any(Error),
    });
    await expect(preparing).rejects.toThrow(
      'Entry "main" has multiple replacement client.entry contributions: first-entry-replacer:first-replacement-slot, @company/page-entry-replacer:replacement-slot-index',
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
      name: "server-contribution",
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
      name: "duplicate-contributions",
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

  it("rejects invalid contribution slot payloads", async () => {
    const cwd = await createProject();
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-contribution",
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
          beforeBuild(context) {
            expect(context.isRebuild).toBe(false);
            expect(context).not.toHaveProperty("addWatchFile");
            events.push("beforeBuild:false");
          },
          transformOutput(output) {
            events.push(
              `transformOutput:${Object.keys(output.assets).join(",")}`,
            );
            output.assets.main.css = ["main.patched.css"];
            output.apps.default.assets.js = ["main.patched.js"];
            output.server.assets.js = ["server.patched.js"];
            output.deployment = { platform: "test" };
          },
          afterBuild(result) {
            events.push(
              [
                "afterBuild",
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
      "bundler.build",
      "bundler.entries:main",
      "beforeBuild:false",
      "transformOutput:main",
      "afterBuild:main.patched.css:main.patched.js:server.patched.js:test",
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

  it("preserves the previous canonical output when an HTML transform fails", async () => {
    const cwd = await createProject();
    const alphaPage = path.join(cwd, "src/pages/alpha/page.tsx");
    const stalePage = path.join(cwd, "src/pages/stale/page.tsx");
    const betaPage = path.join(cwd, "src/pages/beta/page.tsx");
    await writeFile(
      alphaPage,
      "export default function Alpha() { return null; }",
      "utf-8",
    );
    await writeFile(
      stalePage,
      "export default function Stale() { return null; }",
      "utf-8",
    );
    const bundler = createMockBundler([]);
    const baseConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "mpa" },
    };

    await build(baseConfig, { cwd, bundler });

    const metadataFile = path.join(cwd, "dist/deployment-metadata.json");
    const alphaHtmlFile = path.join(cwd, "dist/client/alpha/index.html");
    const staleHtmlFile = path.join(cwd, "dist/client/stale/index.html");
    const betaHtmlFile = path.join(cwd, "dist/client/beta/index.html");
    const clientManifestFile = path.join(
      cwd,
      "dist/client/react-client-manifest.json",
    );
    const ssrManifestFile = path.join(
      cwd,
      "dist/client/react-ssr-manifest.json",
    );
    const [previousMetadata, previousAlphaHtml, previousStaleHtml] =
      await Promise.all([
        fs.promises.readFile(metadataFile, "utf-8"),
        fs.promises.readFile(alphaHtmlFile, "utf-8"),
        fs.promises.readFile(staleHtmlFile, "utf-8"),
      ]);
    await Promise.all([
      writeFile(clientManifestFile, "previous client manifest", "utf-8"),
      writeFile(ssrManifestFile, "previous ssr manifest", "utf-8"),
      fs.promises.rm(stalePage),
      writeFile(
        betaPage,
        "export default function Beta() { return null; }",
        "utf-8",
      ),
    ]);

    await expect(
      build(
        {
          ...baseConfig,
          plugins: [
            {
              name: "rejects-beta-html",
              setup() {
                return {
                  transformHtml(_document, ctx) {
                    if (
                      ctx.owner.kind === "page" &&
                      ctx.owner.pageId === "beta"
                    ) {
                      throw new Error("beta HTML transform failed");
                    }
                  },
                };
              },
            },
          ],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow("beta HTML transform failed");

    await expect(fs.promises.readFile(metadataFile, "utf-8")).resolves.toBe(
      previousMetadata,
    );
    await expect(fs.promises.readFile(alphaHtmlFile, "utf-8")).resolves.toBe(
      previousAlphaHtml,
    );
    await expect(fs.promises.readFile(staleHtmlFile, "utf-8")).resolves.toBe(
      previousStaleHtml,
    );
    await expect(
      fs.promises.readFile(clientManifestFile, "utf-8"),
    ).resolves.toBe("previous client manifest");
    await expect(fs.promises.readFile(ssrManifestFile, "utf-8")).resolves.toBe(
      "previous ssr manifest",
    );
    await expect(fs.promises.access(betaHtmlFile)).rejects.toThrow();
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

  it("validates transformOutput hook mutations before emitting artifacts", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-output",
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

    const building = build(
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
    await expect(building).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "invalid-output",
      hook: "transformOutput",
      cause: expect.any(Error),
    });
    await expect(building).rejects.toThrow(
      TRANSFORM_OUTPUT_HOOK_OWNERSHIP_ERROR,
    );

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
      name: "invalid-document-output",
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
      name: "invalid-route-output",
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
      name: "invalid-application-output",
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
      name: "invalid-page-output",
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
      name: "invalid-page-path-output",
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
      name: "invalid-output-path",
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
      ).rejects.toThrow(TRANSFORM_OUTPUT_HOOK_OWNERSHIP_ERROR);

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
        name: "temporarily-mutates-runtime",
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
        name: "observes-temporary-runtime",
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
        name: "restores-runtime",
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
    ).rejects.toThrow(TRANSFORM_OUTPUT_HOOK_OWNERSHIP_ERROR);
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
  }>)("rejects transformOutput $label mutation", async ({ mutate }) => {
    const cwd = await createServerOutputProject();
    const plugin: Plugin<Record<string, never>> = {
      name: "invalid-output-semantics",
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
    ).rejects.toThrow(TRANSFORM_OUTPUT_HOOK_OWNERSHIP_ERROR);
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
      name: "manifest-result",
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
      name: "page-metadata-order",
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
      name: "server-document-shell",
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
            doc.body?.setAttribute("data-transformed", "yes");
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

    let thrown: unknown;
    try {
      await build(
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
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PluginHookError);
    expect(thrown).toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "removes-server-document-marker",
      hook: "transformHtml",
    });
    expect((thrown as PluginHookError).cause).toEqual(
      expect.objectContaining({
        message:
          '[evjs] Server document for Page "dashboard" must preserve exactly one Page-content marker followed by exactly one request-data marker through transformHtml hooks.',
      }),
    );
  });

  it("attributes late HTML serialization failures to transformHtml", async () => {
    const cwd = await createSpaProject();
    const cause = new Error("late HTML serialization failed");
    let thrown: unknown;

    try {
      await build(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "spa" },
          plugins: [
            {
              name: "invalid-html-serializer",
              setup() {
                return {
                  transformHtml(doc) {
                    Object.defineProperty(doc, "toString", {
                      configurable: true,
                      value() {
                        throw cause;
                      },
                    });
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
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PluginHookError);
    expect(thrown).toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "invalid-html-serializer",
      hook: "transformHtml",
      cause,
    });
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
      name: "page-scope",
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
      name: "document-alias-observer",
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
    const transformOutput = JSON.parse(
      fs.readFileSync(path.join(cwd, "dist/deployment-metadata.json"), "utf-8"),
    );

    expect(html).toContain("Prerendered Report");
    expect(html).toContain("http://evjs.local/report");
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain("__EVJS_CLIENT_RUNTIME__");
    expect(html).not.toContain("data-evjs-hydrate");
    expect(transformOutput.server).toEqual({});
    expect(transformOutput.documents).toContainEqual({
      kind: "page",
      id: "report",
      fileName: "report/index.html",
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

  it("runs plugin configure hooks before resolving config", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const bundler = createMockBundler(events, { recordEndpoint: true });

    const plugin: Plugin<Record<string, never>> = {
      name: "sets-server-base-path",
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
      name: "invalid-dev-port",
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
      name: "invalid-config-return",
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
      name: "typo-lifecycle-hook",
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

  it("orders plugin configure and lifecycle hooks by dependencies", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const pluginA: Plugin<Record<string, never>> = {
      name: "plugin-a",
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
      name: "plugin-b",
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

  it("fails on invalid plugin declarations before configure hooks and bundling", async () => {
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
              configure(config) {
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

  it("disposes plugins when the initial dev beforeBuild hook fails", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      ...createMockBundler(events),
      async dev({ callbacks }) {
        events.push("bundler.dev");
        await callbacks.onBuildFacts({}, { isRebuild: false });
      },
    };

    await expect(
      dev(
        {
          output: { client: "dist/client", server: "dist/server" },
          plugins: [
            {
              name: "failing-start",
              setup() {
                return {
                  beforeBuild() {
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

    expect(events).toEqual(["bundler.dev", "dispose"]);
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
        return {
          async updatePlan() {},
          close() {
            events.push("bundler.close");
            throw new Error("close blocked");
          },
        };
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

  it("pairs beforeBuild and afterBuild for initial dev output and rebuilds", async () => {
    const cwd = await createSpaProject();
    const events: string[] = [];
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ callbacks, plan }) {
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
        await callbacks.onBuildFacts(facts, { isRebuild: false });
        await callbacks.onBuildFacts(facts, { isRebuild: true });
        process.emit("SIGINT");
        return { async updatePlan() {} };
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
                beforeBuild(context) {
                  events.push(`before:${context.isRebuild}`);
                },
                afterBuild(result) {
                  events.push(`after:${result.isRebuild}`);
                },
              };
            },
          },
        ],
      },
      { cwd, bundler },
    );

    expect(events).toEqual([
      "before:false",
      "after:false",
      "before:true",
      "after:true",
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
      async dev({ callbacks, plan }) {
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

        await callbacks.onBuildFacts(facts, { isRebuild: false });
        emittedHtml.push(await fs.promises.readFile(htmlPath, "utf-8"));

        rendering = "Rebuilt dev report";
        await callbacks.onBuildFacts(facts, { isRebuild: true });
        emittedHtml.push(await fs.promises.readFile(htmlPath, "utf-8"));

        process.emit("SIGINT");
        return { async updatePlan() {} };
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
        return {
          async updatePlan(update) {
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
        };
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
        return {
          async updatePlan(update) {
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
        };
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
        return {
          async updatePlan(update) {
            const serverEntry = update.entries.added.find(
              (entry) => entry.kind === "server-runtime",
            );
            if (!serverEntry) return;
            events.push("added-server");
            process.emit("SIGINT");
          },
        };
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
        return {
          async updatePlan(update) {
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
        };
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

      const failuresBeforeExternalEdit = events.filter(
        (event) => event === "framework-update-failed",
      ).length;
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
        return {
          async updatePlan(update) {
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
        };
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

      const failuresBeforeExternalEdits = events.filter(
        (event) => event === "framework-update-failed",
      ).length;
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
        return {
          async updatePlan(update) {
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
        };
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
        return {
          async updatePlan(update, options) {
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
        };
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

  it("rejects unsupported config reloads before replacing live IR", async () => {
    const cwd = await createSpaProject();
    const configPath = path.join(cwd, "ev.config.ts");
    await writeFile(configPath, "export default {};", "utf-8");
    const applicationOptions = pluginOptions<{ label: string }>();
    const applicationPlugin = definePlugin<
      "config-reload-ir",
      "config-reload-ir",
      typeof applicationOptions,
      undefined,
      Record<string, never>
    >({
      name: "config-reload-ir",
      key: "config-reload-ir",
      application: applicationOptions,
      emitIR(ctx) {
        ctx.slot("html.tag").add({
          id: "config-reload-ir-meta",
          tag: "meta",
          placement: "head-append",
          attrs: { name: "config-reload-ir", content: ctx.options.label },
        });
      },
    });
    const events: string[] = [];
    const stopCapturingRestart = captureFrameworkWarning(
      events,
      "Failed to update framework dev state:",
      "dev.configuration",
      "restart-required",
    );
    let currentConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      plugins: [applicationPlugin({ label: "initial" })],
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "no-config-reload",
      capabilities: {
        ...fullBundlerCapabilities,
        dev: {
          ...fullBundlerCapabilities.dev,
          configuration: false,
        },
      },
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return {
          async updatePlan() {
            events.push("unexpected-update");
          },
        };
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
      const generatedIrPath = path.join(cwd, ".ev");
      const initialGeneratedIr = await readDirectorySnapshot(generatedIrPath);
      currentConfig = {
        ...currentConfig,
        plugins: [applicationPlugin({ label: "candidate" })],
      };
      await writeFile(configPath, "export default {}; // updated", "utf-8");
      await waitForEvent(events, "restart-required");

      expect(await readDirectorySnapshot(generatedIrPath)).toEqual(
        initialGeneratedIr,
      );
      expect(events).not.toContain("unexpected-update");
      process.emit("SIGINT");
      await running;
    } finally {
      stopCapturingRestart();
    }

    expect(events).toEqual(["bundler.dev", "restart-required"]);
  });

  it("fails closed when a configureBundler watch dependency changes", async () => {
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
        return {
          async updatePlan(update, options) {
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
        };
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
          () =>
            reject(new Error("configureBundler dependency update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual(["bundler.dev", "update:true:0:0:0"]);
  });

  it("uses the next plugin context for build facts emitted during a configureBundler reload", async () => {
    const cwd = await createSpaProject();
    const dependency = path.join(cwd, "bundler-plugin.config.json");
    await writeFile(dependency, '{"mode":"initial"}', "utf-8");
    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      name: "reload-context",
      setup(ctx) {
        const setupTarget = ctx.config.dev.proxy[0]?.target ?? "initial";
        events.push(`setup:${setupTarget}`);
        return {
          transformOutput(_output, buildContext) {
            events.push(
              `transformOutput:${setupTarget}:${buildContext.config.dev.proxy[0]?.target}`,
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
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ addWatchFile, callbacks, plan }) {
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
        events.push("bundler.dev");
        return {
          async updatePlan(_update, options) {
            await callbacks.onBuildFacts(facts, { isRebuild: true });
            events.push(`update:${options?.configChanged}`);
            process.emit("SIGINT");
          },
        };
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

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("configureBundler context update timed out")),
          devUpdateTimeoutMs,
        ),
      ),
    ]);

    expect(events).toEqual([
      "setup:initial",
      "bundler.dev",
      "setup:https://example.com",
      "transformOutput:https://example.com:https://example.com",
      "update:true",
      "dispose:initial",
      "dispose:https://example.com",
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
        return {
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
        };
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
        return {
          async updatePlan() {
            await writeFile(routeTypesPath, userRouteTypes, "utf-8");
            await writeFile(pluginTypesPath, userPluginTypes, "utf-8");
            events.push("update:throw");
            throw new Error("mock update failure after user replacement");
          },
        };
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
        return {
          async updatePlan(update) {
            events.push(
              `update:${update.entries.added.map((entry) => entry.name).join(",")}`,
            );
            process.emit("SIGINT");
          },
        };
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

  it("passes generated compiler input changes to capable dev bundlers", async () => {
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

    const pageThemeConfig = pluginOptions<{ value: string }>();
    const plugin = definePlugin<
      "page-theme",
      "theme",
      undefined,
      typeof pageThemeConfig,
      Record<string, never>
    >({
      name: "page-theme",
      key: "theme",
      page: pageThemeConfig,
      emitPageIR(ctx) {
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
    let configWatcherReady = false;
    const configWatchers: Array<{
      closed: boolean;
      listener: fs.WatchListener<string | Buffer>;
    }> = [];
    const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
      ...args: unknown[]
    ) => {
      const target = path.resolve(String(args[0]));
      const listener = args.at(-1) as fs.WatchListener<string | Buffer>;
      const record = { closed: false, listener };
      const watcher = {
        close() {
          record.closed = true;
        },
      } as fs.FSWatcher;
      if (target === configFile) {
        configWatchers.push(record);
        if (!configWatcherReady) {
          configWatcherReady = true;
          events.push("config-watcher.open");
        }
      }
      return watcher;
    }) as typeof fs.watch);
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return {
          async updatePlan(update) {
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
        };
      },
    };

    let running: Promise<void> | undefined;
    try {
      running = dev(
        {
          output: { client: "dist/client", server: "dist/server" },
          routing: { mode: "mpa" },
          plugins: [plugin],
        },
        { cwd, bundler },
      );

      await waitForEvent(events, "config-watcher.open");
      await writeFile(
        configFile,
        'export default { plugins: { theme: { value: "dark" } } };',
        "utf-8",
      );
      for (const watcher of configWatchers) {
        if (!watcher.closed) {
          watcher.listener("change", path.basename(configFile));
        }
      }

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
        "config-watcher.open",
        "update:true:false:0:0:dark:true:true",
      ]);
    } finally {
      process.emit("SIGINT");
      await running?.catch(() => {});
      watchSpy.mockRestore();
    }
  });

  it("commits Page plugin settings to CoreGraph IR without updating the bundler", async () => {
    const cwd = await createProject();
    const pageDir = path.join(cwd, "src/pages/home");
    const configFile = path.join(pageDir, "page.config.ts");
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

    const pageThemeOptions = pluginOptions<{ value: string }>();
    const plugin = definePlugin<
      "page-theme-settings",
      "theme",
      undefined,
      typeof pageThemeOptions,
      Record<string, never>
    >({
      name: "page-theme-settings",
      key: "theme",
      page: pageThemeOptions,
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
        return {
          async updatePlan() {
            events.push("unexpected-update");
          },
        };
      },
    };
    const coreGraphFile = path.join(cwd, ".ev/framework/core-graph.json");
    const readTheme = async (): Promise<unknown> => {
      const generated = JSON.parse(
        await fs.promises.readFile(coreGraphFile, "utf-8"),
      ) as { graph: CoreGraph };
      return generated.graph.pages.home?.plugins.theme?.config?.value;
    };

    const running = dev(
      {
        output: { client: "dist/client", server: "dist/server" },
        routing: { mode: "mpa" },
        plugins: [plugin],
      },
      { cwd, bundler },
    );

    await waitForEvent(events, "bundler.dev");
    await expect(readTheme()).resolves.toBe("light");
    await writeFile(
      configFile,
      'export default { plugins: { theme: { value: "dark" } } };',
      "utf-8",
    );

    const startedAt = Date.now();
    while ((await readTheme()) !== "dark") {
      if (Date.now() - startedAt > devUpdateTimeoutMs) {
        throw new Error("CoreGraph Page plugin settings update timed out");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    process.emit("SIGINT");
    await running;

    expect(events).toEqual(["bundler.dev"]);
    await expect(readTheme()).resolves.toBe("dark");
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
    const applicationConfig = pluginOptions<{ generation: number }>({
      defaults() {
        resolutionCalls += 1;
        return { generation: resolutionCalls };
      },
    });
    const plugin = definePlugin<
      "stable-application-plugin",
      "stable",
      typeof applicationConfig,
      undefined,
      Record<string, never>
    >({
      name: "stable-application-plugin",
      key: "stable",
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
      emitIR(ctx) {
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
        return {
          async updatePlan() {
            events.push("update");
            process.emit("SIGINT");
          },
        };
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
    await writeFile(path.join(cwd, "plugin-data.json"), "{}", "utf-8");

    const events: string[] = [];
    let contributionCount = 0;
    let resolutionCalls = 0;
    const applicationConfig = pluginOptions<{ generation: number }>({
      defaults() {
        resolutionCalls += 1;
        return { generation: resolutionCalls };
      },
    });
    const plugin = definePlugin<
      "watched-application-plugin",
      "watched",
      typeof applicationConfig,
      undefined,
      Record<string, never>
    >({
      name: "watched-application-plugin",
      key: "watched",
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
      emitIR(ctx) {
        contributionCount += 1;
        events.push(
          `contribution:${ctx.options.generation}:${contributionCount}`,
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
        return {
          async updatePlan() {
            events.push("unexpected update");
          },
        };
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
    await writeFile(
      path.join(cwd, "plugin-data.json"),
      '{"changed":true}',
      "utf-8",
    );
    await waitForEvent(events, "contribution:1:2");
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
    expect(events).toEqual([
      "setup:1",
      "contribution:1:1",
      "bundler.dev",
      "contribution:1:2",
      "dispose:1",
    ]);
  });

  it("refreshes the Application plugin setting for config reloads", async () => {
    const cwd = await createSpaProject();
    const configPath = path.join(cwd, "ev.config.ts");
    await writeFile(configPath, "export default {};", "utf-8");

    const events: string[] = [];
    let resolutionCalls = 0;
    const applicationConfig = pluginOptions<{ generation: number }>({
      defaults() {
        resolutionCalls += 1;
        return { generation: resolutionCalls };
      },
    });
    const plugin = definePlugin<
      "reload-application-plugin",
      "reload",
      typeof applicationConfig,
      undefined,
      Record<string, never>
    >({
      name: "reload-application-plugin",
      key: "reload",
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
      emitIR(ctx) {
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
        return {
          async updatePlan() {
            events.push("update");
            process.emit("SIGINT");
          },
        };
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
    const applicationConfig = pluginOptions<{ generation: number }>({
      defaults() {
        resolutionCalls += 1;
        return { generation: resolutionCalls };
      },
    });
    const plugin = definePlugin<
      "transactional-config-plugin",
      "transactional",
      typeof applicationConfig,
      undefined,
      Record<string, never>
    >({
      name: "transactional-config-plugin",
      key: "transactional",
      application: applicationConfig,
      configure(config, ctx) {
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
      emitIR(ctx) {
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
        return {
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
            process.emit("SIGINT");
          },
        };
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
        return {
          async updatePlan(update) {
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
        };
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
      "update:false:0:1:Updated title:Updated description",
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
      async dev({ plan, callbacks }) {
        const aboutEntry = createPageClientBuildEntryName("about");
        const facts: BundlerBuildFacts = {
          clientEntryAssets: {
            [aboutEntry]: { js: [`${aboutEntry}.js`], css: [] },
          },
        };
        await callbacks.onBuildFacts(facts, { isRebuild: false });
        const aliasPath = path.resolve(
          cwd,
          plan.output.clientDir,
          "about.html",
        );
        events.push(`initial:${fs.existsSync(aliasPath)}`);
        return {
          async updatePlan(update) {
            updateCount += 1;
            const aliases = update.next.html[0]?.aliases?.join(",") ?? "none";
            events.push(
              `update:${updateCount}:${update.html.changed.length}:${aliases}`,
            );
            await callbacks.onBuildFacts(facts, { isRebuild: true });
            events.push(`alias:${updateCount}:${fs.existsSync(aliasPath)}`);
            if (updateCount === 1) {
              await writeFile(pageConfigPath, "export default {};", "utf-8");
            } else {
              process.emit("SIGINT");
            }
          },
        };
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

  it("keeps in-flight output cycles on one plugin snapshot during reload", async () => {
    const cwd = await createSpaProject();
    const configFile = path.join(cwd, "ev.config.ts");
    await writeFile(
      configFile,
      "export default { routing: { mode: 'spa' } };",
      "utf-8",
    );

    const events: string[] = [];
    let releaseOldRebuild!: () => void;
    const oldRebuildGate = new Promise<void>((resolve) => {
      releaseOldRebuild = resolve;
    });
    let markOldRebuildStarted!: () => void;
    const oldRebuildStarted = new Promise<void>((resolve) => {
      markOldRebuildStarted = resolve;
    });

    function createPlugin(
      label: string,
      blockRebuild = false,
    ): Plugin<Record<string, never>> {
      let currentIsRebuild = false;
      return {
        name: "same-name-plugin",
        setup() {
          events.push(`setup:${label}`);
          return {
            async beforeBuild(context) {
              currentIsRebuild = context.isRebuild;
              events.push(`before:${label}:${context.isRebuild}`);
              if (blockRebuild && context.isRebuild) {
                markOldRebuildStarted();
                await oldRebuildGate;
              }
            },
            transformOutput() {
              events.push(`transform:${label}:${currentIsRebuild}`);
            },
            afterBuild(result) {
              events.push(`after:${label}:${result.isRebuild}`);
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
      routing: { mode: "spa" },
      plugins: [createPlugin("old", true)],
    };
    let triggerRebuild!: () => ReturnType<
      BundlerDevContext["callbacks"]["onBuildFacts"]
    >;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "snapshot-cycle-mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ callbacks, plan }) {
        let currentPlan = plan;
        const createFacts = (targetPlan: BuildPlan): BundlerBuildFacts => {
          const clientEntry = targetPlan.entries.find(
            (entry) => entry.environment === "client",
          );
          return clientEntry
            ? {
                clientEntryAssets: {
                  [clientEntry.name]: { js: ["main.js"], css: [] },
                },
              }
            : {};
        };
        await callbacks.onBuildFacts(createFacts(currentPlan), {
          isRebuild: false,
        });
        triggerRebuild = () =>
          callbacks.onBuildFacts(createFacts(currentPlan), {
            isRebuild: true,
          });
        events.push("bundler.ready");
        return {
          async updatePlan(update) {
            currentPlan = update.next;
            events.push("update");
            await callbacks.onBuildFacts(createFacts(currentPlan), {
              isRebuild: true,
            });
            events.push("update.done");
          },
        };
      },
    };

    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });

    await waitForEvent(events, "bundler.ready");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const oldCycle = triggerRebuild();
    await oldRebuildStarted;
    currentConfig = {
      ...currentConfig,
      plugins: [createPlugin("new")],
    };
    await writeFile(
      configFile,
      "export default { routing: { mode: 'spa' } }; // updated",
      "utf-8",
    );

    await waitForEvent(events, "setup:new");
    expect(events).not.toContain("before:new:true");
    expect(events).not.toContain("dispose:old");

    releaseOldRebuild();
    await oldCycle;
    await waitForEvent(events, "update.done");
    await waitForEvent(events, "dispose:old");
    process.emit("SIGINT");
    await running;

    expect(events).toEqual([
      "setup:old",
      "before:old:false",
      "transform:old:false",
      "after:old:false",
      "bundler.ready",
      "before:old:true",
      "setup:new",
      "transform:old:true",
      "after:old:true",
      "update",
      "before:new:true",
      "transform:new:true",
      "after:new:true",
      "update.done",
      "dispose:old",
      "dispose:new",
    ]);
  });

  it("keeps a published plugin snapshot when dev afterBuild fails", async () => {
    const cwd = await createSpaProject();
    const configFile = path.join(cwd, "ev.config.ts");
    await writeFile(
      configFile,
      "export default { routing: { mode: 'spa' } };",
      "utf-8",
    );

    const events: string[] = [];
    const stopCapturingFailures = captureFrameworkWarning(
      events,
      "Plugin afterBuild failed after development output was published;",
      "new afterBuild blocked",
      "afterBuild-failed",
    );

    function createPlugin(
      label: string,
      failFirstAfterBuild = false,
    ): Plugin<Record<string, never>> {
      let currentIsRebuild = false;
      let afterBuildCount = 0;
      return {
        name: "same-name-plugin",
        setup() {
          events.push(`setup:${label}`);
          return {
            beforeBuild(context) {
              currentIsRebuild = context.isRebuild;
              events.push(`before:${label}:${context.isRebuild}`);
            },
            transformOutput() {
              events.push(`transform:${label}:${currentIsRebuild}`);
            },
            afterBuild(result) {
              afterBuildCount += 1;
              events.push(
                `after:${label}:${result.isRebuild}:${afterBuildCount}`,
              );
              if (failFirstAfterBuild && afterBuildCount === 1) {
                throw new Error(`${label} afterBuild blocked`);
              }
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
      routing: { mode: "spa" },
      plugins: [createPlugin("old")],
    };
    let triggerRebuild!: () => ReturnType<
      BundlerDevContext["callbacks"]["onBuildFacts"]
    >;
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "published-snapshot-mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev({ callbacks, plan }) {
        let currentPlan = plan;
        const createFacts = (targetPlan: BuildPlan): BundlerBuildFacts => {
          const clientEntry = targetPlan.entries.find(
            (entry) => entry.environment === "client",
          );
          return clientEntry
            ? {
                clientEntryAssets: {
                  [clientEntry.name]: { js: ["main.js"], css: [] },
                },
              }
            : {};
        };
        await callbacks.onBuildFacts(createFacts(currentPlan), {
          isRebuild: false,
        });
        triggerRebuild = () =>
          callbacks.onBuildFacts(createFacts(currentPlan), {
            isRebuild: true,
          });
        events.push("bundler.ready");
        return {
          async updatePlan(update) {
            currentPlan = update.next;
            events.push("update");
            await callbacks.onBuildFacts(createFacts(currentPlan), {
              isRebuild: true,
            });
            events.push("update.done");
          },
        };
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

      await waitForEvent(events, "bundler.ready");
      await new Promise((resolve) => setTimeout(resolve, 100));
      currentConfig = {
        ...currentConfig,
        plugins: [createPlugin("new", true)],
      };
      await writeFile(
        configFile,
        "export default { routing: { mode: 'spa' } }; // updated",
        "utf-8",
      );

      await waitForEvent(events, "afterBuild-failed");
      await waitForEvent(events, "dispose:old");
      expect(events).toContain("dispose:old");
      expect(events).not.toContain("dispose:new");
      expect(events).toContain("update.done");

      await triggerRebuild();
      events.push("manual.done");
      process.emit("SIGINT");
      await running;

      expect(events).toEqual([
        "setup:old",
        "before:old:false",
        "transform:old:false",
        "after:old:false:1",
        "bundler.ready",
        "setup:new",
        "update",
        "before:new:true",
        "transform:new:true",
        "after:new:true:1",
        "afterBuild-failed",
        "update.done",
        "dispose:old",
        "before:new:true",
        "transform:new:true",
        "after:new:true:2",
        "manual.done",
        "dispose:new",
      ]);
    } finally {
      stopCapturingFailures();
    }
  });

  it("does not run build hooks while staging a dev config snapshot", async () => {
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
        emitIR() {
          events.push(`contribution:${label}`);
        },
        setup() {
          events.push(`setup:${label}`);
          return {
            beforeBuild() {
              events.push(`beforeBuild:${label}`);
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
        return {
          async updatePlan(update) {
            events.push(
              `update:${update.entries.added.map((entry) => entry.name).join(",")}`,
            );
            process.emit("SIGINT");
          },
        };
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
      "contribution:v1",
      "bundler.dev",
      "setup:v2",
      "contribution:v2",
      `update:${createPageClientBuildEntryName("orders")}`,
      "dispose:v1",
      "dispose:v2",
    ]);
  });

  it("rolls back staged plugin hooks when reload beforeBuild fails", async () => {
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

    const events: string[] = [];
    function createPlugin(
      label: string,
      watchFile: string,
      failBeforeBuild = false,
    ): Plugin<Record<string, never>> {
      let contributionCount = 0;
      return {
        name: "same-name-plugin",
        emitIR() {
          contributionCount += 1;
          events.push(`contribution:${label}:${contributionCount}`);
        },
        setup(ctx) {
          events.push(`setup:${label}`);
          ctx.addWatchFile(`./${watchFile}`);
          return {
            beforeBuild() {
              events.push(`beforeBuild:${label}`);
              if (failBeforeBuild) {
                throw new Error(`${label} beforeBuild blocked`);
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
      async dev({ callbacks, plan }) {
        const createFacts = (currentPlan: BuildPlan): BundlerBuildFacts => ({
          clientEntryAssets: Object.fromEntries(
            currentPlan.entries
              .filter((entry) => entry.environment === "client")
              .map((entry) => [
                entry.name,
                { js: [`${entry.name}.js`], css: [] },
              ]),
          ),
          ...serverBuildFacts(currentPlan),
        });
        events.push("bundler.dev");
        await callbacks.onBuildFacts(createFacts(plan), {
          isRebuild: false,
        });
        events.push("bundler.ready");
        return {
          async updatePlan(update) {
            events.push("update");
            await callbacks.onBuildFacts(createFacts(update.next), {
              isRebuild: true,
            });
          },
        };
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

    await waitForEvent(events, "bundler.ready");
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
      "contribution:old:1",
      "bundler.dev",
      "beforeBuild:old",
      "bundler.ready",
      "load:1",
      "setup:new",
      "contribution:new:1",
      "update",
      "beforeBuild:new",
      "dispose:new:mpa",
      "contribution:old:2",
      "dispose:old:mpa",
    ]);
  });

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

    const events: string[] = [];
    function createPlugin(
      label: string,
      watchFile: string,
      failDispose = false,
    ): Plugin<Record<string, never>> {
      let contributionCount = 0;
      return {
        name: "same-name-plugin",
        emitIR() {
          contributionCount += 1;
          events.push(`contribution:${label}:${contributionCount}`);
        },
        setup(ctx) {
          ctx.addWatchFile(`./${watchFile}`);
          events.push(`setup:${label}`);
          return {
            dispose() {
              events.push(`dispose:${label}`);
              if (failDispose) throw new Error(`${label} dispose blocked`);
            },
          };
        },
      };
    }

    let currentConfig: Config<Record<string, never>> = {
      output: { client: "dist/client", server: "dist/server" },
      routing: { mode: "mpa" },
      plugins: [createPlugin("old", "old-watch.txt", true)],
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return {
          async updatePlan(update) {
            events.push(
              `update:${update.entries.added.map((entry) => entry.name).join(",")}`,
            );
          },
        };
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

    await new Promise((resolve) => setTimeout(resolve, 100));
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
    await writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default { routing: { mode: 'mpa' } }; // updated",
      "utf-8",
    );
    await waitForEvent(
      events,
      `update:${createPageClientBuildEntryName("orders")}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));

    await writeFile(path.join(cwd, "new-watch.txt"), "changed", "utf-8");
    await waitForEvent(events, "contribution:new:2");
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

  it("does not reopen dependency watchers while shutdown waits for an update", async () => {
    const cwd = await createSpaProject();
    const configPath = path.join(cwd, "ev.config.ts");
    await writeFile(configPath, "export default {};", "utf-8");

    const events: string[] = [];
    const openWatchers = new Set<fs.FSWatcher>();
    const configWatchers: Array<{
      closed: boolean;
      listener: fs.WatchListener<string | Buffer>;
    }> = [];
    const watchSpy = vi.spyOn(fs, "watch").mockImplementation(((
      ...args: unknown[]
    ) => {
      const target = path.resolve(String(args[0]));
      const listener = args.at(-1) as fs.WatchListener<string | Buffer>;
      const record = { closed: false, listener };
      let watcher: fs.FSWatcher;
      watcher = {
        close() {
          record.closed = true;
          openWatchers.delete(watcher);
        },
      } as fs.FSWatcher;
      if (target === configPath) {
        configWatchers.push(record);
        events.push("config-watcher.open");
      }
      openWatchers.add(watcher);
      return watcher;
    }) as typeof fs.watch);

    let releaseUpdate: (() => void) | undefined;
    const updateCanFinish = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    const createPlugin = (label: string): Plugin<Record<string, never>> => ({
      name: "shutdown-watcher-plugin",
      setup(ctx) {
        ctx.addWatchFile(configPath);
        return {
          dispose() {
            events.push(`dispose:${label}`);
          },
        };
      },
    });
    let currentConfig: Config<Record<string, never>> = {
      plugins: [createPlugin("old")],
      routing: { mode: "spa" },
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "shutdown-watcher-mock",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        events.push("bundler.dev");
        return {
          async updatePlan() {
            events.push("update.start");
            await updateCanFinish;
            events.push("update.end");
          },
        };
      },
    };

    let running: Promise<void> | undefined;
    try {
      running = dev(currentConfig, {
        cwd,
        bundler,
        loadConfig() {
          return currentConfig;
        },
      });
      await waitForEvent(events, "config-watcher.open");

      currentConfig = {
        ...currentConfig,
        plugins: [createPlugin("new")],
      };
      await writeFile(configPath, "export default {}; // updated", "utf-8");
      for (const watcher of configWatchers) {
        if (!watcher.closed)
          watcher.listener("change", path.basename(configPath));
      }
      await waitForEvent(events, "update.start");

      const watcherCountAtShutdown = configWatchers.length;
      process.emit("SIGINT");
      releaseUpdate?.();
      await running;

      expect(events).toContain("update.end");
      expect(events).toContain("dispose:old");
      expect(events).toContain("dispose:new");
      expect(configWatchers).toHaveLength(watcherCountAtShutdown);
      expect(openWatchers.size).toBe(0);
    } finally {
      process.emit("SIGINT");
      releaseUpdate?.();
      await running?.catch(() => {});
      for (const watcher of openWatchers) watcher.close();
      watchSpy.mockRestore();
    }
  });
});
