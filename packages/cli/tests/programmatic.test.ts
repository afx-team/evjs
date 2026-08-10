import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BundlerAdapter } from "@evjs/ev/_internal/build";
import type { Config } from "@evjs/ev/config";
import { describe, expect, it } from "vitest";
import type { DefaultBundlerConfig } from "../src/index.js";
import { build, dev, loadConfig, prepare } from "../src/index.js";

type CustomBundlerConfig = { customFlag: boolean };

function assertCustomBundlerRequiresAdapter(
  bundler: BundlerAdapter<CustomBundlerConfig>,
): void {
  // @ts-expect-error custom build config cannot silently use Utoopack
  void build<CustomBundlerConfig>({}, { cwd: "/tmp/evjs-cli-type-test" });
  // @ts-expect-error custom dev config cannot silently use Utoopack
  void dev<CustomBundlerConfig>({}, { cwd: "/tmp/evjs-cli-type-test" });
  void dev<CustomBundlerConfig>(undefined, {
    cwd: "/tmp/evjs-cli-type-test",
    fallbackBundler: bundler,
  });
}

void assertCustomBundlerRequiresAdapter;

function assertLoadConfigUsesCliDefault(): void {
  const loaded: Promise<Config<DefaultBundlerConfig> | undefined> = loadConfig(
    "/tmp/evjs-cli-type-test",
  );
  void loaded;
}

void assertLoadConfigUsesCliDefault;

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
  it("forwards prepare calls through the framework API", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src"), { recursive: true });
    await fs.promises.writeFile(
      path.join(cwd, "src/main.tsx"),
      "console.log('app');",
      "utf-8",
    );

    await prepare(
      { output: { client: "dist/client", server: "dist/server" } },
      { cwd },
    );

    await expect(
      fs.promises.access(path.join(cwd, ".ev/manifest.json")),
    ).resolves.toBeUndefined();
    await expect(fs.promises.access(path.join(cwd, "dist"))).rejects.toThrow();
  });

  it("forwards build calls through the framework API", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages"), { recursive: true });
    await fs.promises.writeFile(
      path.join(cwd, "src/pages/page.tsx"),
      "export default function Page() { return null; }",
      "utf-8",
    );
    const events: string[] = [];
    const bundler: BundlerAdapter<DefaultBundlerConfig> = {
      name: "mock",
      capabilities: {
        build: { server: true, rsc: true, ppr: true },
      },
      async build({ cwd: buildCwd, plan }) {
        events.push(`build:${buildCwd}:${plan.entries[0]?.name}`);
        return {
          clientEntryAssets: {
            main: { js: ["main.js"], css: [] },
          },
        };
      },
      async dev() {
        events.push("dev");
        return {
          origin: "http://localhost",
          done: Promise.resolve(),
          async close() {},
        };
      },
    };

    await build(
      {
        routing: { mode: "spa" },
        output: { client: "dist/client", server: "dist/server" },
      },
      { cwd, bundler },
    );

    expect(events).toEqual([`build:${cwd}:main`]);
  });

  it("supports explicit non-default bundler config types", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler: BundlerAdapter<CustomBundlerConfig> = {
      name: "custom",
      capabilities: {
        build: { server: true, rsc: true, ppr: true },
      },
      async build({ config }) {
        events.push(String(config.bundler?.name));
        return {
          clientEntryAssets: {
            main: { js: ["main.js"], css: [] },
          },
        };
      },
      async dev() {
        events.push("dev");
        return {
          origin: "http://localhost",
          done: Promise.resolve(),
          async close() {},
        };
      },
    };

    await build<CustomBundlerConfig>(
      { output: { client: "dist/client", server: "dist/server" } },
      { cwd, bundler },
    );

    expect(events).toEqual(["custom"]);
  });
});
