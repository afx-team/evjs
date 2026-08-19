import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeBuildOutputPaths,
  assertSafeBundlerCleanOutputPath,
  type ResolvedBuildOutputPaths,
  removeOwnedOutputFile,
  writeOwnedOutputFile,
} from "../src/_internal/build/index.js";
import { removeOwnedOutputFileSync } from "../src/_internal/build/output/owned-file-output.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("build output path safety", () => {
  it("accepts non-existent output directories below the project root", async () => {
    const cwd = await makeTempDir("evjs-output-project-");

    await expect(
      assertSafeBuildOutputPaths(cwd, createOutputPaths(cwd)),
    ).resolves.toBeUndefined();
  });

  it("preserves source files when a configured output is outside distDir", async () => {
    const cwd = await makeTempDir("evjs-output-project-");
    const sentinel = path.join(cwd, "src", "sentinel.ts");
    await fs.mkdir(path.dirname(sentinel), { recursive: true });
    await fs.writeFile(sentinel, "export {};", "utf-8");
    const outputPaths = createOutputPaths(cwd);
    outputPaths.clientDir = path.join(cwd, "src");

    await expect(assertSafeBuildOutputPaths(cwd, outputPaths)).rejects.toThrow(
      '[evjs] output.client output directory "src" must be a strict descendant of plan.distDir "dist"',
    );
    await expect(fs.readFile(sentinel, "utf-8")).resolves.toBe("export {};");
  });

  it("requires every bundler clean override to stay below distDir", async () => {
    const cwd = await makeTempDir("evjs-output-project-");

    await expect(
      assertSafeBundlerCleanOutputPath(
        cwd,
        'Webpack config "client" clean',
        path.join(cwd, "dist"),
        path.join(cwd, "src"),
      ),
    ).rejects.toThrow(
      'Webpack config "client" clean output directory "src" must be a strict descendant of plan.distDir "dist"',
    );
    await expect(
      assertSafeBundlerCleanOutputPath(
        cwd,
        'Webpack config "client" clean',
        path.join(cwd, "dist"),
        path.join(cwd, "dist", "plugin-client"),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects symbolic-link ancestors for every framework output field", async () => {
    const cases: Array<{
      field: keyof ResolvedBuildOutputPaths;
      label: string;
    }> = [
      { field: "rootDir", label: "plan.distDir" },
      { field: "clientDir", label: "output.client" },
      { field: "serverDir", label: "output.server" },
    ];

    for (const testCase of cases) {
      const cwd = await makeTempDir("evjs-output-project-");
      const outside = await makeTempDir("evjs-output-outside-");
      await fs.symlink(outside, path.join(cwd, "linked-output"), "dir");
      const outputPaths = createOutputPaths(cwd);
      outputPaths[testCase.field] = path.join(cwd, "linked-output", "nested");

      await expect(
        assertSafeBuildOutputPaths(cwd, outputPaths),
      ).rejects.toThrow(
        `[evjs] ${testCase.label} output directory "linked-output/nested" must not traverse symbolic link "linked-output".`,
      );
    }
  });

  it("does not disclose an external absolute output path", async () => {
    const cwd = await makeTempDir("evjs-output-project-");
    const outside = await makeTempDir("evjs-output-outside-");
    const outputPaths = createOutputPaths(cwd);
    outputPaths.clientDir = path.join(outside, "client");

    let message = "";
    try {
      await assertSafeBuildOutputPaths(cwd, outputPaths);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("output.client");
    expect(message).toContain("../");
    expect(message).not.toContain(outside);
  });

  it("does not follow leaf or intermediate symlinks for owned file writes", async () => {
    const cwd = await makeTempDir("evjs-output-project-");
    const rootDir = path.join(cwd, "dist");
    const outsideDir = path.join(cwd, "outside");
    const sentinel = path.join(outsideDir, "sentinel.txt");
    await fs.mkdir(rootDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(sentinel, "outside", "utf-8");

    const leaf = path.join(rootDir, "deployment-metadata.json");
    await fs.symlink(sentinel, leaf);
    await expect(
      writeOwnedOutputFile(rootDir, leaf, "framework", "metadata output"),
    ).rejects.toThrow(
      "metadata output must not overwrite a symbolic-link output file",
    );
    await expect(fs.readFile(sentinel, "utf-8")).resolves.toBe("outside");

    const linkedDirectory = path.join(rootDir, "nested");
    await fs.symlink(outsideDir, linkedDirectory, "dir");
    await expect(
      writeOwnedOutputFile(
        rootDir,
        path.join(linkedDirectory, "page.html"),
        "framework",
        "HTML output",
      ),
    ).rejects.toThrow(
      "HTML output must not traverse symbolic links or non-directory output ancestors",
    );
    await expect(
      fs.access(path.join(outsideDir, "page.html")),
    ).rejects.toThrow();
    await expect(
      removeOwnedOutputFile(
        cwd,
        path.join(linkedDirectory, "sentinel.txt"),
        "rollback output",
      ),
    ).rejects.toThrow(
      "rollback output must not traverse symbolic links or non-directory output ancestors",
    );
    await expect(fs.readFile(sentinel, "utf-8")).resolves.toBe("outside");

    expect(() =>
      removeOwnedOutputFileSync(
        cwd,
        path.join(linkedDirectory, "sentinel.txt"),
        "sync rollback output",
      ),
    ).toThrow(
      "sync rollback output must not traverse symbolic links or non-directory output ancestors",
    );
    await expect(fs.readFile(sentinel, "utf-8")).resolves.toBe("outside");
  });
});

function createOutputPaths(cwd: string): ResolvedBuildOutputPaths {
  return {
    rootDir: path.join(cwd, "dist"),
    clientDir: path.join(cwd, "dist", "client"),
    serverDir: path.join(cwd, "dist", "server"),
  };
}

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}
