import fs from "node:fs";
import path from "node:path";
import { utoopackAdapter } from "@evjs/bundler-utoopack";
import type { DefaultBundlerConfig } from "@evjs/cli";
import { build } from "@evjs/cli";
import type { BundlerAdapter, Plugin } from "@evjs/ev";
import { configure, getConsoleSink } from "@logtape/logtape";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * E2E tests — real plugin scenarios.
 *
 * Each test simulates a realistic plugin that a user would write,
 * runs a real build, and verifies the plugin achieved its goal.
 */

const EXAMPLES = path.resolve(__dirname, "../examples");
const CSR_APP = path.resolve(EXAMPLES, "plugin-authoring");
const FULLSTACK_APP = path.resolve(EXAMPLES, "basic");

type DefaultPlugin = Plugin<DefaultBundlerConfig>;

const BUNDLERS: [string, BundlerAdapter<DefaultBundlerConfig>][] = [
  ["utoopack", utoopackAdapter],
];

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

describe.each(BUNDLERS)("build notifier plugin [%s]", (_name, bundler) => {
  it("captures build metadata for CI reporting", async () => {
    process.chdir(CSR_APP);

    const report = {
      started: false,
      assets: [] as string[],
      duration: 0,
    };

    const buildNotifier: DefaultPlugin = {
      name: "build-notifier",
      setup(_ctx) {
        let t0: number;
        return {
          buildStart() {
            t0 = Date.now();
            report.started = true;
          },
          buildEnd(result) {
            report.duration = Date.now() - t0;
            report.assets = Object.values(result.output.assets).flatMap(
              (assets) => assets.js,
            );
          },
        };
      },
    };

    await build({
      output: { client: "dist" },
      bundler,
      plugins: [buildNotifier],
    });

    expect(report.started).toBe(true);
    expect(report.duration).toBeGreaterThan(0);
    expect(report.assets.length).toBeGreaterThan(0);
    expect(report.assets.every((a) => a.endsWith(".js"))).toBe(true);
  }, 60_000);
});

// ─── Scenario 2: Build Manifest Writer ──────────────────────────────────
// A plugin that writes a custom deployment manifest after build.
// Common for CI pipelines that need asset hashes or deploy metadata.

describe.each(BUNDLERS)("deployment manifest plugin [%s]", (_name, bundler) => {
  it("writes a deploy manifest from build results", async () => {
    process.chdir(CSR_APP);

    const manifestPath = path.resolve(CSR_APP, "dist/deploy-manifest.json");

    const deployPlugin: DefaultPlugin = {
      name: "deploy-manifest",
      setup(ctx) {
        return {
          buildEnd(result) {
            const manifest = {
              builtAt: new Date().toISOString(),
              mode: ctx.mode,
              js: Object.values(result.output.assets).flatMap(
                (assets) => assets.js,
              ),
              css: Object.values(result.output.assets).flatMap(
                (assets) => assets.css,
              ),
              hasServer: !!result.output.server,
            };
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
          },
        };
      },
    };

    await build({
      output: { client: "dist" },
      bundler,
      plugins: [deployPlugin],
    });

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

// ─── Scenario 3: Fullstack Server Function Discovery ────────────────────
// A plugin that inspects server function metadata after a fullstack build.
// Useful for documentation generators or API introspection tools.

describe.each(
  BUNDLERS,
)("server function discovery plugin [%s]", (_name, bundler) => {
  it("discovers server functions from fullstack build manifest", async () => {
    process.chdir(FULLSTACK_APP);

    let serverFnCount = 0;
    let serverEntry: string | undefined;

    const discoveryPlugin: DefaultPlugin = {
      name: "fn-discovery",
      setup() {
        return {
          buildEnd(result) {
            if (result.output.server) {
              serverEntry = result.output.server.entry;
              serverFnCount = Object.keys(
                result.output.server.functions,
              ).length;
            }
          },
        };
      },
    };

    await build({ bundler, plugins: [discoveryPlugin] });

    // The basic example has server functions
    expect(serverEntry).toBeDefined();
    expect(serverFnCount).toBeGreaterThan(0);
  }, 60_000);
});

// ─── Scenario 4: Transform HTML via DOM Manipulation ────────────────────
// A plugin that uses the HtmlDocument DOM API to inject a <meta> tag.
// Verifies that transformHtml receives a live DOM document that plugins
// can mutate with standard DOM methods.

describe.each(
  BUNDLERS,
)("transformHtml DOM manipulation [%s]", (_name, bundler) => {
  it("injects a meta tag into the document via DOM API", async () => {
    process.chdir(CSR_APP);

    const htmlPlugin: DefaultPlugin = {
      name: "meta-injector",
      setup() {
        return {
          transformHtml(doc) {
            const meta = doc.createElement("meta");
            meta.setAttribute("name", "generator");
            meta.setAttribute("content", "evjs");
            doc.head?.appendChild(meta);
          },
        };
      },
    };

    await build({
      output: { client: "dist" },
      bundler,
      plugins: [htmlPlugin],
    });

    // Read the emitted index.html and verify the meta tag
    const html = fs.readFileSync(
      path.join(CSR_APP, "dist", "index.html"),
      "utf-8",
    );
    expect(html).toContain('<meta name="generator" content="evjs">');
  }, 60_000);

  it("injects a comment node via DOM API", async () => {
    process.chdir(CSR_APP);

    const commentPlugin: DefaultPlugin = {
      name: "comment-injector",
      setup() {
        return {
          transformHtml(doc, ctx) {
            const count = ctx.assets.js.length;
            const comment = doc.createComment(` ${count} JS asset(s) `);
            doc.body?.insertBefore(comment, doc.body?.firstChild);
          },
        };
      },
    };

    await build({
      output: { client: "dist" },
      bundler,
      plugins: [commentPlugin],
    });

    const html = fs.readFileSync(
      path.join(CSR_APP, "dist", "index.html"),
      "utf-8",
    );
    expect(html).toMatch(/<!--\s+\d+ JS asset\(s\)\s+-->/);
  }, 60_000);
});

// ─── Scenario 5: Multiple transformHtml Plugins Compose ─────────────────
// Multiple plugins should all get the same document reference and their
// mutations should accumulate in order.

describe.each(BUNDLERS)("transformHtml composition [%s]", (_name, bundler) => {
  it("multiple plugins accumulate DOM mutations", async () => {
    process.chdir(CSR_APP);

    const plugin1: DefaultPlugin = {
      name: "meta-1",
      setup: () => ({
        transformHtml(doc) {
          const meta = doc.createElement("meta");
          meta.setAttribute("name", "plugin-1");
          meta.setAttribute("content", "first");
          doc.head?.appendChild(meta);
        },
      }),
    };

    const plugin2: DefaultPlugin = {
      name: "meta-2",
      setup: () => ({
        transformHtml(doc) {
          const meta = doc.createElement("meta");
          meta.setAttribute("name", "plugin-2");
          meta.setAttribute("content", "second");
          doc.head?.appendChild(meta);
        },
      }),
    };

    await build({
      output: { client: "dist" },
      bundler,
      plugins: [plugin1, plugin2],
    });

    const html = fs.readFileSync(
      path.join(CSR_APP, "dist", "index.html"),
      "utf-8",
    );
    // Both plugins should have mutated the same document
    expect(html).toContain('<meta name="plugin-1" content="first">');
    expect(html).toContain('<meta name="plugin-2" content="second">');

    // Plugin 1's meta should appear before plugin 2's meta
    const idx1 = html.indexOf("plugin-1");
    const idx2 = html.indexOf("plugin-2");
    expect(idx1).toBeLessThan(idx2);
  }, 60_000);
});
