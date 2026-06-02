import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BuildOutput } from "@evjs/ev";
import { type ResolvedConfig, resolveConfig } from "@evjs/ev";
import {
  createAppGraph,
  createBuildPlan,
  diffBuildPlan,
} from "@evjs/ev/build-tools";
import type { ConfigComplete } from "@utoo/pack";
import { afterEach, describe, expect, it, vi } from "vitest";
import { utoopackAdapter } from "../src/adapter/index.js";

vi.mock("@utoo/pack", () => ({
  serve: vi.fn(async ({ config }) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const clientOutDir = config.output.path;

    await fs.promises.mkdir(clientOutDir, { recursive: true });
    await fs.promises.writeFile(path.join(clientOutDir, "main.js"), "");
    await fs.promises.writeFile(path.join(clientOutDir, "main.css"), "");
    await fs.promises.writeFile(
      path.join(clientOutDir, "stats.json"),
      JSON.stringify({
        entrypoints: {
          main: {
            assets: [{ name: "main.js" }, { name: "main.css" }],
          },
        },
      }),
    );

    if (config.server) {
      const serverOutDir = config.server.output.path;
      await fs.promises.mkdir(serverOutDir, { recursive: true });
      await fs.promises.writeFile(path.join(serverOutDir, "index.js"), "");
      await fs.promises.writeFile(
        path.join(serverOutDir, "stats.json"),
        JSON.stringify({
          entrypoints: {
            main: {
              assets: [{ name: "index.js" }],
            },
          },
        }),
      );
    }
  }),
  build: vi.fn(),
}));

const tempDirs: string[] = [];

async function makeProject() {
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
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.promises.rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("utoopackAdapter dev", () => {
  it("emits flat CSR manifest and index.html in server:false mode", async () => {
    const cwd = await makeProject();
    const config = resolveConfig<ConfigComplete>({
      server: false,
      entry: "./src/main.tsx",
      html: "./index.html",
    });

    const onBuildOutput = vi.fn((output: BuildOutput) => {
      output.assets.devHook = { js: ["dev-hook.js"], css: [] };
    });
    const buildContext = await createBuildContext(config, cwd);

    const controller = await utoopackAdapter.dev({
      config,
      cwd,
      ...buildContext,
      callbacks: { onBuildOutput, onServerBundleReady: vi.fn() },
      hooks: [
        {
          transformHtml(doc) {
            const meta = doc.createElement("meta");
            meta.setAttribute("name", "mode");
            meta.setAttribute("content", "dev");
            doc.head?.appendChild(meta);
          },
        },
      ],
    });

    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
    );
    const html = await fs.promises.readFile(
      path.join(cwd, "dist/index.html"),
      "utf-8",
    );

    expect(manifest.assets).toEqual({
      main: {
        js: ["main.js"],
        css: ["main.css"],
      },
      devHook: {
        js: ["dev-hook.js"],
        css: [],
      },
    });
    expect(onBuildOutput).toHaveBeenCalledTimes(1);
    expect(manifest.apps.default).toEqual({
      assets: {
        js: ["main.js"],
        css: ["main.css"],
      },
      entry: "./src/main.tsx",
      module: {
        type: "entry",
        href: "main.js",
        source: "./src/main.tsx",
      },
    });
    expect(html).toContain('<link rel="stylesheet" href="/main.css">');
    expect(html).toContain('src="/main.js"');
    expect(html).toContain('data-evjs-kind="app"');
    expect(html).toContain('data-evjs-id="default"');
    expect(html).toContain('<meta name="mode" content="dev">');
    expect(fs.existsSync(path.join(cwd, "dist/client"))).toBe(false);
    expect(controller).toBeDefined();
    if (!controller) throw new Error("Expected Utoopack dev controller");
    await expect(
      controller.updatePlan(
        diffBuildPlan(buildContext.plan, buildContext.plan, "config"),
      ),
    ).rejects.toThrow("Utoopack dev plan updates are not supported yet");
    await controller.close?.();
  });

  it("emits a single build manifest plus index.html in fullstack mode", async () => {
    const cwd = await makeProject();
    const onServerBundleReady = vi.fn();
    const config = resolveConfig<ConfigComplete>({
      entry: "./src/main.tsx",
      html: "./index.html",
    });

    await utoopackAdapter.dev({
      config,
      cwd,
      ...(await createBuildContext(config, cwd)),
      callbacks: { onBuildOutput: vi.fn(), onServerBundleReady },
      hooks: [
        {
          transformHtml(doc, ctx) {
            const meta = doc.createElement("meta");
            expect(ctx.kind).toBe("app");
            expect(ctx.htmlId).toBe("index");
            expect(ctx.fileName).toBe("index.html");
            expect(ctx.mode).toBe("development");
            expect(ctx.buildId).toBe(ctx.output.buildId);
            expect(ctx.publicPath).toBe(ctx.output.publicPath);
            meta.setAttribute(
              "name",
              ctx.output.server ? "server-enabled" : "client-only",
            );
            doc.head?.appendChild(meta);
          },
        },
      ],
    });

    const manifest = JSON.parse(
      await fs.promises.readFile(path.join(cwd, "dist/manifest.json"), "utf-8"),
    );
    const html = await fs.promises.readFile(
      path.join(cwd, "dist/client/index.html"),
      "utf-8",
    );

    expect(manifest.apps.default).toEqual({
      assets: {
        js: ["main.js"],
        css: ["main.css"],
      },
      entry: "./src/main.tsx",
      module: {
        type: "entry",
        href: "main.js",
        source: "./src/main.tsx",
      },
    });
    expect(manifest.server.entry).toBe("index.js");
    expect(html).toContain('<link rel="stylesheet" href="/main.css">');
    expect(html).toContain('src="/main.js"');
    expect(html).toContain('data-evjs-kind="app"');
    expect(html).toContain('data-evjs-id="default"');
    expect(html).toContain('<meta name="server-enabled">');
    expect(onServerBundleReady).toHaveBeenCalledTimes(1);
  });
});

async function createBuildContext(
  config: ResolvedConfig<ConfigComplete>,
  cwd: string,
) {
  const analysis = await createAppGraph(config, cwd);
  return {
    graph: analysis.graph,
    plan: createBuildPlan(config, analysis.graph, { mode: "development" }),
  };
}
