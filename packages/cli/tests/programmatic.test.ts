import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BuildOutput, BundlerAdapter } from "@evjs/ev";
import { describe, expect, it } from "vitest";
import { build } from "../src/index.js";

async function createProject() {
  const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "evjs-cli-"));
  await fs.promises.writeFile(
    path.join(cwd, "index.html"),
    '<div id="app"></div>',
    "utf-8",
  );
  return cwd;
}

describe("programmatic API", () => {
  it("forwards build calls through the framework API", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler: BundlerAdapter = {
      name: "mock",
      async build({ callbacks, cwd: buildCwd, plan }) {
        events.push(`build:${buildCwd}:${plan.entries[0]?.name}`);
        const output: BuildOutput = {
          version: 1,
          buildId: plan.buildId,
          distDir: plan.distDir,
          publicPath: plan.runtime.publicPath,
          runtime: {
            server: plan.runtime.server,
            transport: plan.runtime.transport,
          },
          assets: {},
          apps: {},
          pages: {},
          routes: [],
        };
        await callbacks.onBuildOutput(output);
        const dist = path.join(buildCwd, "dist");
        await fs.promises.mkdir(dist, { recursive: true });
        await fs.promises.writeFile(
          path.join(dist, "manifest.json"),
          JSON.stringify(output),
          "utf-8",
        );
      },
      async dev() {
        events.push("dev");
      },
    };

    await build({ server: false }, { cwd, bundler });

    expect(events).toEqual([`build:${cwd}:main`]);
  });
});
