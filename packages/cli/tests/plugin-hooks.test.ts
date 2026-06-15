import type {
  BuildOutput,
  BuildResult,
  BundlerAdapter,
  Plugin,
  PluginContext,
  PluginHooks,
} from "@evjs/ev";
import { resolveConfig } from "@evjs/ev";
import { getLogger } from "@logtape/logtape";
import { describe, expect, it } from "vitest";

/**
 * Unit tests for plugin lifecycle hooks.
 *
 * These cover edge cases and guarantees that can't be verified
 * in e2e tests (async ordering, dev-mode isRebuild, closure patterns).
 */

// Re-implement private functions for isolated testing.
async function collectPluginHooks(
  plugins: Plugin[],
  ctx: PluginContext,
): Promise<PluginHooks[]> {
  const allHooks: PluginHooks[] = [];
  for (const plugin of plugins) {
    if (plugin.setup) {
      const hooks = await plugin.setup(ctx);
      if (hooks) allHooks.push(hooks);
    }
  }
  return allHooks;
}

async function runBuildStartHooks(
  hooks: PluginHooks[],
  ctx: PluginContext = CTX,
): Promise<void> {
  for (const h of hooks) {
    if (h.buildStart) await h.buildStart(ctx);
  }
}

async function runBuildEndHooks(
  hooks: PluginHooks[],
  result: BuildResult,
): Promise<void> {
  for (const h of hooks) {
    if (h.buildEnd) await h.buildEnd(result);
  }
}

const TEST_CONFIG = resolveConfig({});
const CTX: PluginContext = {
  mode: "production",
  command: "build",
  cwd: process.cwd(),
  config: TEST_CONFIG,
  logger: getLogger(["evjs", "test"]),
  addWatchFile() {},
};
const TEST_OUTPUT: BuildOutput = {
  version: 1,
  buildId: "test",
  distDir: "dist",
  publicPath: "/",
  runtime: {},
  assets: {
    main: { js: ["main.js"], css: [] },
  },
  apps: {
    default: {
      assets: { js: ["main.js"], css: [] },
      entry: "./src/main.tsx",
    },
  },
  pages: {},
  routes: [],
};

function createTestBuildResult(
  output: BuildOutput,
  isRebuild: boolean,
): BuildResult {
  return {
    output,
    clientManifest: {
      version: 1,
      assets: output.apps.default?.assets ?? { js: [], css: [] },
    },
    ...(output.server
      ? {
          serverManifest: {
            version: 1 as const,
            ...(output.server.entry ? { entry: output.server.entry } : {}),
            assets: output.server.assets,
            fns: Object.fromEntries(
              Object.entries(output.server.functions).map(([id, fn]) => [
                id,
                { assets: fn.assets },
              ]),
            ),
            ...(output.server.routes.length > 0
              ? { routes: output.server.routes }
              : {}),
          },
        }
      : {}),
    isRebuild,
  };
}

describe("resolveConfig", () => {
  it("resolved config uses undefined bundler by default (CLI falls back to utoopack)", () => {
    const config = resolveConfig({});
    expect(config.bundler).toBeUndefined();
  });

  it("plugin contexts can carry the active default bundler", async () => {
    const bundler = {
      name: "utoopack",
      build: async () => ({}),
      dev: async () => {},
    } as BundlerAdapter;

    const config = {
      ...resolveConfig({}),
      bundler,
    };

    const plugin: Plugin = {
      name: "reads-bundler-name",
      setup(ctx) {
        expect(ctx.config.bundler?.name).toBe("utoopack");
        return {};
      },
    };

    await collectPluginHooks([plugin], {
      mode: "production",
      command: "build",
      cwd: process.cwd(),
      config,
      logger: getLogger(["evjs", "test"]),
      addWatchFile() {},
    });
  });
});

describe("plugin setup edge cases", () => {
  it("plugins without setup or returning void are silently skipped", async () => {
    const plugins: Plugin[] = [
      { name: "no-setup" },
      { name: "void-setup", setup: () => undefined },
      { name: "real", setup: () => ({ buildStart: () => {} }) },
    ];
    const hooks = await collectPluginHooks(plugins, CTX);
    expect(hooks).toHaveLength(1);
  });

  it("async setup is awaited before collecting next plugin", async () => {
    const order: string[] = [];
    const plugins: Plugin[] = [
      {
        name: "slow",
        async setup() {
          await new Promise((r) => setTimeout(r, 10));
          order.push("slow-setup-done");
          return { buildStart: () => {} };
        },
      },
      {
        name: "fast",
        setup() {
          order.push("fast-setup-done");
          return { buildStart: () => {} };
        },
      },
    ];

    await collectPluginHooks(plugins, CTX);
    expect(order).toEqual(["slow-setup-done", "fast-setup-done"]);
  });
});

describe("async hook sequencing", () => {
  it("slow hooks block subsequent hooks (no parallel execution)", async () => {
    const order: number[] = [];
    const hooks: PluginHooks[] = [
      {
        async buildStart() {
          await new Promise((r) => setTimeout(r, 20));
          order.push(1);
        },
      },
      {
        buildStart() {
          order.push(2);
        },
      },
    ];

    await runBuildStartHooks(hooks);
    // If hooks ran in parallel, 2 would appear before 1
    expect(order).toEqual([1, 2]);
  });
});

describe("isRebuild flag (dev-mode simulation)", () => {
  it("distinguishes initial build from hot rebuild via isRebuild", async () => {
    const results: { isRebuild: boolean; jsCount: number }[] = [];

    const hooks: PluginHooks[] = [
      {
        buildEnd(r) {
          results.push({
            isRebuild: r.isRebuild,
            jsCount: r.output.assets.main.js.length,
          });
        },
      },
    ];

    // Initial build
    await runBuildEndHooks(hooks, createTestBuildResult(TEST_OUTPUT, false));
    // Hot rebuild in dev mode
    await runBuildEndHooks(hooks, createTestBuildResult(TEST_OUTPUT, true));

    expect(results[0].isRebuild).toBe(false);
    expect(results[1].isRebuild).toBe(true);
  });
});

describe("closure-based shared state between hooks", () => {
  it("enables typical analytics plugin pattern", async () => {
    let reported = { mode: "", elapsed: 0, assets: 0 };

    const analyticsPlugin: Plugin = {
      name: "analytics",
      setup(ctx) {
        let t0 = 0;
        return {
          buildStart() {
            t0 = 100; // simulated Date.now()
          },
          buildEnd(result) {
            reported = {
              mode: ctx.mode,
              elapsed: 200 - t0, // simulated
              assets: result.output.assets.main.js.length,
            };
          },
        };
      },
    };

    const hooks = await collectPluginHooks([analyticsPlugin], CTX);
    await runBuildStartHooks(hooks);
    await runBuildEndHooks(
      hooks,
      createTestBuildResult(
        {
          ...TEST_OUTPUT,
          assets: {
            main: { js: ["a.js", "b.js"], css: [] },
          },
        },
        false,
      ),
    );

    expect(reported.mode).toBe("production");
    expect(reported.elapsed).toBe(100);
    expect(reported.assets).toBe(2);
  });
});
