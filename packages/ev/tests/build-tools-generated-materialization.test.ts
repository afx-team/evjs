import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BuildPlan, CoreGraph } from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareFrameworkBuild } from "../src/_internal/build/commands.js";
import { materializeFrameworkIR } from "../src/_internal/build/generated-contributions.js";
import { writeOwnedOutputFileIfChanged } from "../src/_internal/build/owned-file-output.js";
import { resolveConfig } from "../src/config/index.js";
import type { Plugin } from "../src/plugin/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("generated .ev materialization", () => {
  it("keeps unchanged files stable and removes stale owned outputs", async () => {
    const cwd = await createProject();
    const first = await prepareFrameworkBuild(createBaseConfig(), { cwd });
    await first.dispose();

    const generatedFiles = await listFiles(path.join(cwd, ".ev"));
    const fixedTime = new Date("2001-02-03T04:05:06.000Z");
    await Promise.all(
      generatedFiles.map((file) => fs.utimes(file, fixedTime, fixedTime)),
    );
    const staleFile = path.join(cwd, ".ev/plugins/stale/removed.ts");
    await fs.mkdir(path.dirname(staleFile), { recursive: true });
    await fs.writeFile(staleFile, "stale", "utf-8");

    const second = await prepareFrameworkBuild(createBaseConfig(), { cwd });
    await second.dispose();

    await expect(fs.access(staleFile)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      Promise.all(
        generatedFiles.map(async (file) => (await fs.stat(file)).mtimeMs),
      ),
    ).resolves.toEqual(generatedFiles.map(() => fixedTime.getTime()));
  });

  it("keeps the previous manifest when an atomic generated write fails", async () => {
    const cwd = await createProject();
    const first = await prepareFrameworkBuild(createBaseConfig(), { cwd });
    await first.dispose();
    const manifestFile = path.join(cwd, ".ev/manifest.json");
    const previousManifest = await fs.readFile(manifestFile, "utf-8");
    const blockedFile = path.join(cwd, ".ev/plugins/failed-write/blocked.ts");
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (path.resolve(String(to)) === blockedFile) {
        throw new Error("generated write blocked");
      }
      await rename(from, to);
    });

    await expect(
      prepareFrameworkBuild(
        {
          ...createBaseConfig(),
          plugins: [
            {
              name: "failed-write",
              contributions(ctx) {
                ctx.emit.module({
                  id: "blocked",
                  scope: { kind: "application" },
                  source: "export const blocked = true;",
                });
              },
            },
          ],
        },
        { cwd },
      ),
    ).rejects.toThrow("generated write blocked");

    await expect(fs.readFile(manifestFile, "utf-8")).resolves.toBe(
      previousManifest,
    );
    const generatedEntries = await fs.readdir(path.join(cwd, ".ev"), {
      recursive: true,
    });
    expect(
      generatedEntries.filter((entry) =>
        path.basename(entry).startsWith(".evjs-"),
      ),
    ).toEqual([]);
  });

  it("serializes concurrent candidates into one complete generated snapshot", async () => {
    const cwd = await createProject();
    const initial = await prepareFrameworkBuild(createBaseConfig(), { cwd });
    await initial.dispose();
    const graphFile = JSON.parse(
      await fs.readFile(
        path.join(cwd, ".ev/framework/core-graph.json"),
        "utf-8",
      ),
    ) as { graph: CoreGraph };
    const planFile = JSON.parse(
      await fs.readFile(
        path.join(cwd, ".ev/framework/build-plan.json"),
        "utf-8",
      ),
    ) as { plan: BuildPlan };
    const graph = graphFile.graph;
    const basePlan = planFile.plan;
    const materializeCandidate = (label: "a" | "b") => {
      const plugin: Plugin<Record<string, never>> = {
        name: "concurrent-candidate",
        contributions(ctx) {
          ctx.emit.module({
            id: "shared",
            scope: { kind: "application" },
            source: `export const candidate = ${JSON.stringify(label)};`,
          });
          ctx.emit.module({
            id: `${label}-only`,
            scope: { kind: "application" },
            source: `export const only = ${JSON.stringify(label)};`,
          });
        },
      };
      const config = resolveConfig({
        ...createBaseConfig(),
        plugins: [plugin],
      });
      return materializeFrameworkIR({
        cwd,
        mode: "production",
        command: "build",
        config,
        graph,
        plan: basePlan,
        plugins: [plugin],
        pluginContext: {
          mode: "production",
          command: "build",
          cwd,
          config,
          logger: getLogger(["evjs", "test"]),
          addWatchFile() {},
        },
      });
    };

    for (let attempt = 0; attempt < 10; attempt++) {
      await Promise.all([materializeCandidate("a"), materializeCandidate("b")]);

      const pluginRoot = path.join(cwd, ".ev/plugins/concurrent-candidate");
      const shared = await fs.readFile(
        path.join(pluginRoot, "shared.ts"),
        "utf-8",
      );
      const hasA = await pathExists(path.join(pluginRoot, "a-only.ts"));
      const hasB = await pathExists(path.join(pluginRoot, "b-only.ts"));
      const finalCandidate = shared.includes('"a"') ? "a" : "b";

      expect([hasA, hasB]).toEqual(
        finalCandidate === "a" ? [true, false] : [false, true],
      );
      const manifest = JSON.parse(
        await fs.readFile(path.join(cwd, ".ev/manifest.json"), "utf-8"),
      ) as { generated: { modules: Array<{ id: string }> } };
      expect(
        manifest.generated.modules
          .filter((module) => module.id.endsWith("-only"))
          .map((module) => module.id),
      ).toEqual([`${finalCandidate}-only`]);
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked generated root without writing outside the project",
    async () => {
      const cwd = await createProject();
      const external = await fs.mkdtemp(
        path.join(os.tmpdir(), "evjs-generated-external-"),
      );
      tempDirs.push(external);
      const sentinel = path.join(external, "sentinel.txt");
      await fs.writeFile(sentinel, "owned elsewhere", "utf-8");
      await fs.symlink(external, path.join(cwd, ".ev"), "dir");

      await expect(
        prepareFrameworkBuild(createBaseConfig(), { cwd }),
      ).rejects.toThrow("Refusing to materialize generated IR");
      await expect(fs.readFile(sentinel, "utf-8")).resolves.toBe(
        "owned elsewhere",
      );
      await expect(fs.readdir(external)).resolves.toEqual(["sentinel.txt"]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects symbolic links inside an existing generated tree",
    async () => {
      const cwd = await createProject();
      const first = await prepareFrameworkBuild(createBaseConfig(), { cwd });
      await first.dispose();
      const external = await fs.mkdtemp(
        path.join(os.tmpdir(), "evjs-generated-nested-external-"),
      );
      tempDirs.push(external);
      await fs.mkdir(path.join(cwd, ".ev/plugins"), { recursive: true });
      await fs.symlink(external, path.join(cwd, ".ev/plugins/escape"), "dir");

      await expect(
        prepareFrameworkBuild(createBaseConfig(), { cwd }),
      ).rejects.toThrow("symbolic link");
      await expect(fs.readdir(external)).resolves.toEqual([]);
    },
  );
});

describe("writeOwnedOutputFileIfChanged", () => {
  it("preserves mtime and mode for unchanged bytes and mode on replacement", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-owned-write-"));
    tempDirs.push(root);
    const file = path.join(root, "nested/output.txt");
    await expect(
      writeOwnedOutputFileIfChanged(root, file, "first\n", "test output"),
    ).resolves.toBe(true);
    await fs.chmod(file, 0o640);
    const fixedTime = new Date("2002-03-04T05:06:07.000Z");
    await fs.utimes(file, fixedTime, fixedTime);

    await expect(
      writeOwnedOutputFileIfChanged(root, file, "first\n", "test output"),
    ).resolves.toBe(false);
    expect((await fs.stat(file)).mtimeMs).toBe(fixedTime.getTime());

    await expect(
      writeOwnedOutputFileIfChanged(root, file, "second\n", "test output"),
    ).resolves.toBe(true);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o640);
    await expect(fs.readFile(file, "utf-8")).resolves.toBe("second\n");
  });
});

async function createProject(): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-materialize-"));
  tempDirs.push(cwd);
  await fs.mkdir(path.join(cwd, "src"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(cwd, "index.html"), '<div id="app"></div>', "utf-8"),
    fs.writeFile(path.join(cwd, "src/main.ts"), "export {};\n", "utf-8"),
  ]);
  return cwd;
}

function createBaseConfig() {
  return {
    output: { client: "dist/client", server: "dist/server" },
    conventions: false as const,
  };
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(file)));
    } else {
      files.push(file);
    }
  }
  return files.sort();
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
