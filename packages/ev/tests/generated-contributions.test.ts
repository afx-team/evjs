import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BuildPlan, CoreGraph } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it } from "vitest";
import {
  materializeFrameworkIR,
  restoreGeneratedIRSnapshot,
} from "../src/_internal/build/generated-contributions.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { force: true, recursive: true }),
      ),
  );
});

describe("generated framework IR reconciliation", () => {
  it("retains byte-identical compiler inputs while atomically replacing metadata", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-generated-ir-"),
    );
    temporaryDirectories.push(cwd);
    const initialPlan = createPlan("initial");

    await materialize(initialPlan, cwd);

    const entryFile = path.join(cwd, ".ev/entries/main.ts");
    const manifestFile = path.join(cwd, ".ev/manifest.json");
    const snapshotDir = path.join(cwd, "generated-ir-snapshot");
    await fs.promises.cp(path.join(cwd, ".ev"), snapshotDir, {
      recursive: true,
    });
    const entryHandle = await fs.promises.open(entryFile, "r");
    const manifestHandle = await fs.promises.open(manifestFile, "r");
    try {
      const entryIdentity = await entryHandle.stat();
      const manifestIdentity = await manifestHandle.stat();

      await materialize(createPlan("next"), cwd);

      expect((await fs.promises.stat(entryFile)).ino).toBe(entryIdentity.ino);
      expect((await fs.promises.stat(manifestFile)).ino).not.toBe(
        manifestIdentity.ino,
      );
      expect(JSON.parse(await manifestHandle.readFile("utf-8")).buildId).toBe(
        "initial",
      );
      expect(
        JSON.parse(await fs.promises.readFile(manifestFile, "utf-8")).buildId,
      ).toBe("next");

      const nextManifestIdentity = await fs.promises.stat(manifestFile);
      await restoreGeneratedIRSnapshot(path.join(cwd, ".ev"), snapshotDir);

      expect((await fs.promises.stat(entryFile)).ino).toBe(entryIdentity.ino);
      expect((await fs.promises.stat(manifestFile)).ino).not.toBe(
        nextManifestIdentity.ino,
      );
      expect(
        JSON.parse(await fs.promises.readFile(manifestFile, "utf-8")).buildId,
      ).toBe("initial");
    } finally {
      await Promise.all([entryHandle.close(), manifestHandle.close()]);
    }
  });
});

async function materialize(plan: BuildPlan, cwd: string): Promise<void> {
  await materializeFrameworkIR({
    cwd,
    mode: "development",
    command: "dev",
    config: {} as never,
    graph: {} as CoreGraph,
    plan,
    plugins: [],
    pluginContext: {} as never,
  });
}

function createPlan(buildId: string): BuildPlan {
  return {
    version: 1,
    buildId,
    mode: "development",
    distDir: "dist",
    output: {
      clientDir: "dist/client",
      serverDir: "dist/server",
    },
    entries: [
      {
        name: "main",
        import: "./src/page.tsx",
        environment: "client",
        runtime: "browser",
        kind: "app-client",
        owner: { appId: "default" },
        metadata: {
          type: "pages-app",
          routes: [],
          mount: "#app",
        },
      },
    ],
    html: [],
    server: {},
    runtime: {
      publicPath: "auto",
      server: { basePath: "/__evjs", fn: "__evjs/fn" },
    },
    dev: {
      clientRoutes: [],
      serverRequestRoutePaths: [],
      serverRenderedPagePaths: [],
      hasPpr: false,
    },
  };
}
