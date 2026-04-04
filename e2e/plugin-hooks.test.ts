import fs from "node:fs";
import path from "node:path";
import { webpack } from "@evjs/bundler-webpack";
import { build } from "@evjs/cli";
import type { EvBuildResult, EvPlugin } from "@evjs/shared";
import { configure, getConsoleSink } from "@logtape/logtape";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * E2E tests — real plugin scenarios.
 *
 * Each test simulates a realistic plugin that a user would write,
 * runs a real webpack build, and verifies the plugin achieved its goal.
 */

const EXAMPLES = path.resolve(import.meta.dirname, "../examples");
const CSR_APP = path.resolve(EXAMPLES, "basic-csr");
const FULLSTACK_APP = path.resolve(EXAMPLES, "basic-server-fns");

let savedCwd: string;

beforeAll(async () => {
  try {
    await configure({
      sinks: { console: getConsoleSink() },
      loggers: [
        { category: ["logtape", "meta"], lowestLevel: "warning" },
        { category: ["evjs"], sinks: ["console"], lowestLevel: "error" },
      ],
      reset: true,
    });
  } catch {
    // Already configured
  }
});

beforeEach(() => {
  savedCwd = process.cwd();
});
afterEach(() => {
  process.chdir(savedCwd);
});

// ─── Scenario 1: Build Notifier Plugin ──────────────────────────────────
// A plugin that captures build metadata for CI/CD — the most common
// real-world use case for buildStart/buildEnd hooks.

describe("build notifier plugin", () => {
  it("captures build metadata for CI reporting", async () => {
    process.chdir(CSR_APP);

    const report = {
      started: false,
      assets: [] as string[],
      duration: 0,
    };

    const buildNotifier: EvPlugin = {
      name: "build-notifier",
      setup(ctx) {
        let t0: number;
        return {
          buildStart() {
            t0 = Date.now();
            report.started = true;
          },
          buildEnd(result) {
            report.duration = Date.now() - t0;
            report.assets = result.clientManifest.assets.js;
          },
        };
      },
    };

    await build({ server: false, plugins: [buildNotifier] });

    expect(report.started).toBe(true);
    expect(report.duration).toBeGreaterThan(0);
    expect(report.assets.length).toBeGreaterThan(0);
    expect(report.assets.every((a) => a.endsWith(".js"))).toBe(true);
  }, 60_000);
});

// ─── Scenario 2: Webpack Define Plugin ──────────────────────────────────
// A plugin that injects build-time constants via webpack.DefinePlugin.
// Uses the typed webpack() helper for type-safe config mutation.

describe("webpack define plugin", () => {
  it("injects build-time constants into webpack config", async () => {
    process.chdir(CSR_APP);

    let injectedPluginCount = 0;

    const envPlugin: EvPlugin = {
      name: "env-inject",
      setup() {
        return {
          bundler: webpack((config) => {
            const { DefinePlugin } = require("webpack");
            config.plugins ??= [];
            config.plugins.push(
              new DefinePlugin({
                __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
                __APP_VERSION__: JSON.stringify("1.0.0"),
              }),
            );
            injectedPluginCount = config.plugins.length;
          }),
        };
      },
    };

    await build({ server: false, plugins: [envPlugin] });

    // The plugin was added to an existing plugins array
    expect(injectedPluginCount).toBeGreaterThan(1);
  }, 60_000);
});

// ─── Scenario 3: Build Manifest Writer ──────────────────────────────────
// A plugin that writes a custom deployment manifest after build.
// Common for CI pipelines that need asset hashes or deploy metadata.

describe("deployment manifest plugin", () => {
  it("writes a deploy manifest from build results", async () => {
    process.chdir(CSR_APP);

    const manifestPath = path.resolve(CSR_APP, "dist/deploy-manifest.json");

    const deployPlugin: EvPlugin = {
      name: "deploy-manifest",
      setup(ctx) {
        return {
          buildEnd(result) {
            const manifest = {
              builtAt: new Date().toISOString(),
              mode: ctx.mode,
              js: result.clientManifest.assets.js,
              css: result.clientManifest.assets.css,
              hasServer: !!result.serverManifest,
            };
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
          },
        };
      },
    };

    await build({ server: false, plugins: [deployPlugin] });

    // Verify the plugin actually wrote the file
    expect(fs.existsSync(manifestPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(written.mode).toBe("production");
    expect(written.js.length).toBeGreaterThan(0);
    expect(written.hasServer).toBe(false);

    // Cleanup
    fs.unlinkSync(manifestPath);
  }, 60_000);
});

// ─── Scenario 4: Fullstack Server Function Discovery ────────────────────
// A plugin that inspects server function metadata after a fullstack build.
// Useful for documentation generators or API introspection tools.

describe("server function discovery plugin", () => {
  it("discovers server functions from fullstack build manifest", async () => {
    process.chdir(FULLSTACK_APP);

    let serverFnCount = 0;
    let serverEntry: string | undefined;

    const discoveryPlugin: EvPlugin = {
      name: "fn-discovery",
      setup() {
        return {
          buildEnd(result) {
            if (result.serverManifest) {
              serverEntry = result.serverManifest.entry;
              serverFnCount = Object.keys(result.serverManifest.fns).length;
            }
          },
        };
      },
    };

    await build({ plugins: [discoveryPlugin] });

    // The basic-server-fns example has server functions
    expect(serverEntry).toBeDefined();
    expect(serverFnCount).toBeGreaterThan(0);
  }, 60_000);
});

// ─── Scenario 5: Composing Multiple Plugins ─────────────────────────────
// Real apps use multiple plugins. Each plugin should see the effects of
// previous plugins (e.g., plugin B sees the webpack rule plugin A added).

describe("plugin composition", () => {
  it("later plugins see config mutations from earlier plugins", async () => {
    process.chdir(CSR_APP);

    let ruleCountSeenBySecondPlugin = 0;

    const addRule: EvPlugin = {
      name: "add-rule",
      setup: () => ({
        bundler: webpack((config) => {
          config.module ??= {};
          config.module.rules ??= [];
          config.module.rules.push({
            test: /\.yaml$/,
            type: "json",
          });
        }),
      }),
    };

    const inspector: EvPlugin = {
      name: "inspector",
      setup: () => ({
        bundler: webpack((config) => {
          const yamlRule = config.module?.rules?.find(
            (r) =>
              r &&
              typeof r === "object" &&
              "test" in r &&
              String(r.test) === String(/\.yaml$/),
          );
          ruleCountSeenBySecondPlugin = yamlRule ? 1 : 0;
        }),
      }),
    };

    await build({ server: false, plugins: [addRule, inspector] });

    // The inspector plugin should have found the rule added by addRule
    expect(ruleCountSeenBySecondPlugin).toBe(1);
  }, 60_000);
});
