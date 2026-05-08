import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { BundlerAdapter } from "../src/bundler.js";
import { build, type EvPlugin } from "../src/index.js";

async function createProject() {
  const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "evjs-"));
  await fs.promises.writeFile(
    path.join(cwd, "index.html"),
    '<div id="app"></div>',
    "utf-8",
  );
  return cwd;
}

function createMockBundler(
  events: string[],
): BundlerAdapter<Record<string, never>> {
  return {
    name: "mock",
    async build(config, cwd) {
      events.push("bundler.build");
      const dist = path.join(cwd, "dist");
      await fs.promises.mkdir(dist, { recursive: true });
      await fs.promises.writeFile(
        path.join(dist, "manifest.json"),
        JSON.stringify({
          version: 1,
          assets: { js: ["main.js"], css: [] },
        }),
        "utf-8",
      );
      if (config.serverEnabled) {
        events.push(`bundler.endpoint:${config.server.endpoint}`);
      }
    },
    async dev() {
      events.push("bundler.dev");
    },
  };
}

describe("build", () => {
  it("requires a bundler from config or options", async () => {
    const cwd = await createProject();
    await expect(build({ server: false }, { cwd })).rejects.toThrow(
      "No bundler configured",
    );
  });

  it("runs framework orchestration around the injected bundler", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: EvPlugin<Record<string, never>> = {
      name: "records-lifecycle",
      setup(ctx) {
        expect(ctx.config.bundler?.name).toBe("mock");
        events.push(`setup:${ctx.mode}`);
        return {
          buildStart() {
            events.push("buildStart");
          },
          buildEnd(result) {
            events.push(`buildEnd:${result.clientManifest.assets.js[0]}`);
          },
        };
      },
    };

    await build(
      { server: false, plugins: [plugin] },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "setup:production",
      "buildStart",
      "bundler.build",
      "buildEnd:main.js",
    ]);
  });

  it("runs plugin config hooks before resolving config", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: EvPlugin<Record<string, never>> = {
      name: "sets-endpoint",
      config(config, ctx) {
        events.push(`config:${ctx.mode}`);
        config.server = {
          ...(typeof config.server === "object" ? config.server : {}),
          endpoint: "/api/rpc",
        };
        return config;
      },
      setup(ctx) {
        events.push(`setup:${ctx.config.server.endpoint}`);
      },
    };

    await build(
      { plugins: [plugin] },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "config:production",
      "setup:/api/rpc",
      "bundler.build",
      "bundler.endpoint:/api/rpc",
    ]);
  });
});
