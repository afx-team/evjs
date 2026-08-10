import type { BundlerAdapter } from "@evjs/ev/_internal/build";
import { resolveConfig } from "@evjs/ev/config";
import type {
  BeforeBuildContext,
  BuildResult,
  Plugin,
  PluginHooks,
  PluginSetupContext,
} from "@evjs/ev/plugin";
import type { BuildOutput } from "@evjs/shared/manifest";
import { createDeploymentMetadata } from "@evjs/shared/manifest";
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
  ctx: PluginSetupContext,
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

async function runBeforeBuildHooks(
  hooks: PluginHooks[],
  ctx: BeforeBuildContext = BEFORE_BUILD_CTX,
): Promise<void> {
  for (const h of hooks) {
    if (h.beforeBuild) await h.beforeBuild(ctx);
  }
}

async function runAfterBuildHooks(
  hooks: PluginHooks[],
  result: BuildResult,
): Promise<void> {
  for (const h of hooks) {
    if (h.afterBuild) await h.afterBuild(result);
  }
}

const TEST_CONFIG = resolveConfig({});
const CTX: PluginSetupContext = {
  mode: "production",
  cwd: process.cwd(),
  config: TEST_CONFIG,
  logger: getLogger(["evjs", "test"]),
  addWatchFile() {},
};
const BEFORE_BUILD_CTX: BeforeBuildContext = {
  mode: CTX.mode,
  cwd: CTX.cwd,
  config: CTX.config,
  logger: CTX.logger,
  isRebuild: false,
};
const TEST_OUTPUT: BuildOutput = {
  version: 1,
  buildId: "test",
  paths: {
    rootDir: "dist",
    publicDir: "dist/client",
    serverDir: "dist/server",
  },
  publicPath: "/",
  runtime: {
    server: {
      basePath: "/__evjs",
      fn: "__evjs/fn",
    },
  },
  assets: {
    main: { js: ["main.js"], css: [] },
  },
  apps: {
    default: {
      assets: { js: ["main.js"], css: [] },
    },
  },
  pages: {},
  routes: [],
  server: {
    entry: "server.js",
    assets: { js: ["server.js"], css: [] },
    functions: {},
    routes: [],
  },
};

function createTestBuildResult(
  output: BuildOutput,
  isRebuild: boolean,
): BuildResult {
  return {
    output,
    deploymentMetadata: createDeploymentMetadata(output),
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
      capabilities: {
        build: { server: false, rsc: false, ppr: false },
      },
      build: async () => ({}),
      dev: async () => ({
        origin: "http://localhost",
        done: Promise.resolve(),
        async close() {},
      }),
    } as BundlerAdapter;

    const config = {
      ...resolveConfig({}),
      bundler,
    };

    const plugin: Plugin = {
      id: "reads-bundler-name",
      setup(ctx) {
        expect(ctx.config.bundler?.name).toBe("utoopack");
        return {};
      },
    };

    await collectPluginHooks([plugin], {
      mode: "production",
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
      { id: "no-setup" },
      { id: "void-setup", setup: () => undefined },
      { id: "real", setup: () => ({ beforeBuild: () => {} }) },
    ];
    const hooks = await collectPluginHooks(plugins, CTX);
    expect(hooks).toHaveLength(1);
  });

  it("async setup is awaited before collecting next plugin", async () => {
    const order: string[] = [];
    const plugins: Plugin[] = [
      {
        id: "slow",
        async setup() {
          await new Promise((r) => setTimeout(r, 10));
          order.push("slow-setup-done");
          return { beforeBuild: () => {} };
        },
      },
      {
        id: "fast",
        setup() {
          order.push("fast-setup-done");
          return { beforeBuild: () => {} };
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
        async beforeBuild() {
          await new Promise((r) => setTimeout(r, 20));
          order.push(1);
        },
      },
      {
        beforeBuild() {
          order.push(2);
        },
      },
    ];

    await runBeforeBuildHooks(hooks);
    // If hooks ran in parallel, 2 would appear before 1
    expect(order).toEqual([1, 2]);
  });
});

describe("isRebuild flag (dev-mode simulation)", () => {
  it("distinguishes initial build from hot rebuild via isRebuild", async () => {
    const results: { isRebuild: boolean; jsCount: number }[] = [];

    const hooks: PluginHooks[] = [
      {
        afterBuild(r) {
          results.push({
            isRebuild: r.isRebuild,
            jsCount: r.output.assets.main.js.length,
          });
        },
      },
    ];

    // Initial build
    await runAfterBuildHooks(hooks, createTestBuildResult(TEST_OUTPUT, false));
    // Hot rebuild in dev mode
    await runAfterBuildHooks(hooks, createTestBuildResult(TEST_OUTPUT, true));

    expect(results[0].isRebuild).toBe(false);
    expect(results[1].isRebuild).toBe(true);
  });
});

describe("closure-based shared state between hooks", () => {
  it("enables typical analytics plugin pattern", async () => {
    let reported = { mode: "", elapsed: 0, assets: 0 };

    const analyticsPlugin: Plugin = {
      id: "analytics",
      setup(ctx) {
        let t0 = 0;
        return {
          beforeBuild() {
            t0 = 100; // simulated Date.now()
          },
          afterBuild(result) {
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
    await runBeforeBuildHooks(hooks);
    await runAfterBuildHooks(
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
