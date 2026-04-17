import type {
  EvBuildResult,
  EvPlugin,
  EvPluginContext,
  EvPluginHooks,
} from "@evjs/ev";
import { resolveConfig } from "@evjs/ev";
import { describe, expect, it } from "vitest";

/**
 * Unit tests for plugin lifecycle hooks.
 *
 * These cover edge cases and guarantees that can't be verified
 * in e2e tests (async ordering, dev-mode isRebuild, closure patterns).
 */

// Re-implement private functions for isolated testing.
async function collectPluginHooks(
  plugins: EvPlugin[],
  ctx: EvPluginContext,
): Promise<EvPluginHooks[]> {
  const allHooks: EvPluginHooks[] = [];
  for (const plugin of plugins) {
    if (plugin.setup) {
      const hooks = await plugin.setup(ctx);
      if (hooks) allHooks.push(hooks);
    }
  }
  return allHooks;
}

async function runBuildStartHooks(hooks: EvPluginHooks[]): Promise<void> {
  for (const h of hooks) {
    if (h.buildStart) await h.buildStart();
  }
}

async function runBuildEndHooks(
  hooks: EvPluginHooks[],
  result: EvBuildResult,
): Promise<void> {
  for (const h of hooks) {
    if (h.buildEnd) await h.buildEnd(result);
  }
}

const TEST_CONFIG = resolveConfig({});
const CTX: EvPluginContext = { mode: "production", config: TEST_CONFIG };

describe("resolveConfig", () => {
  it("resolved config no longer exposes bundler.config escape hatch", () => {
    const config = resolveConfig({});
    expect(config.bundler).toEqual({ name: "webpack" });
    expect("config" in config.bundler).toBe(false);
  });
});

describe("plugin setup edge cases", () => {
  it("plugins without setup or returning void are silently skipped", async () => {
    const plugins: EvPlugin[] = [
      { name: "no-setup" },
      { name: "void-setup", setup: () => undefined },
      { name: "real", setup: () => ({ buildStart: () => {} }) },
    ];
    const hooks = await collectPluginHooks(plugins, CTX);
    expect(hooks).toHaveLength(1);
  });

  it("async setup is awaited before collecting next plugin", async () => {
    const order: string[] = [];
    const plugins: EvPlugin[] = [
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
    const hooks: EvPluginHooks[] = [
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

    const hooks: EvPluginHooks[] = [
      {
        buildEnd(r) {
          results.push({
            isRebuild: r.isRebuild,
            jsCount: r.clientManifest.assets.js.length,
          });
        },
      },
    ];

    const manifest = {
      version: 1 as const,
      assets: { js: ["main.js"], css: [] },
    };

    // Initial build
    await runBuildEndHooks(hooks, {
      clientManifest: manifest,
      isRebuild: false,
    });
    // Hot rebuild in dev mode
    await runBuildEndHooks(hooks, {
      clientManifest: manifest,
      isRebuild: true,
    });

    expect(results[0].isRebuild).toBe(false);
    expect(results[1].isRebuild).toBe(true);
  });
});

describe("closure-based shared state between hooks", () => {
  it("enables typical analytics plugin pattern", async () => {
    let reported = { mode: "", elapsed: 0, assets: 0 };

    const analyticsPlugin: EvPlugin = {
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
              assets: result.clientManifest.assets.js.length,
            };
          },
        };
      },
    };

    const hooks = await collectPluginHooks([analyticsPlugin], CTX);
    await runBuildStartHooks(hooks);
    await runBuildEndHooks(hooks, {
      clientManifest: { version: 1, assets: { js: ["a.js", "b.js"], css: [] } },
      isRebuild: false,
    });

    expect(reported.mode).toBe("production");
    expect(reported.elapsed).toBe(100);
    expect(reported.assets).toBe(2);
  });
});
