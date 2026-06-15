import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BundlerAdapter } from "@evjs/ev";
import { describe, expect, it } from "vitest";
import type { DefaultBundlerConfig } from "../src/index.js";
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
    const bundler: BundlerAdapter<DefaultBundlerConfig> = {
      name: "mock",
      async build({ cwd: buildCwd, plan }) {
        events.push(`build:${buildCwd}:${plan.entries[0]?.name}`);
        return {
          clientEntryAssets: {
            main: { js: ["main.js"], css: [] },
          },
          firstClientEntryAssets: { js: ["main.js"], css: [] },
        };
      },
      async dev() {
        events.push("dev");
      },
    };

    await build({ server: false }, { cwd, bundler });

    expect(events).toEqual([`build:${cwd}:main`]);
  });
});
