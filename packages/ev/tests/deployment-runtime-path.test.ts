import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BuildOutput } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it } from "vitest";
import { resolveContainedRealPath } from "../src/_internal/generated/server/node.js";
import { createNodeDeploymentFiles } from "../src/deployment/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("deployment runtime paths", () => {
  it("rejects lexical and symbolic-link escapes from deployment roots", async () => {
    const container = await createTempDir();
    const deploymentRoot = path.join(container, "dist");
    const publicDir = path.join(deploymentRoot, "client");
    const outsideDir = path.join(container, "outside");
    await Promise.all([
      fs.mkdir(publicDir, { recursive: true }),
      fs.mkdir(outsideDir, { recursive: true }),
    ]);
    const outsideFile = path.join(outsideDir, "secret.txt");
    await fs.writeFile(outsideFile, "outside", "utf-8");
    const linkedDirectory = path.join(deploymentRoot, "linked-client");
    const linkedFile = path.join(publicDir, "linked.txt");
    await Promise.all([
      fs.symlink(outsideDir, linkedDirectory, "dir"),
      fs.symlink(outsideFile, linkedFile),
    ]);
    const realDeploymentRoot = await fs.realpath(deploymentRoot);
    const realPublicDir = await fs.realpath(publicDir);

    await expect(
      resolveContainedRealPath(realDeploymentRoot, outsideDir),
    ).resolves.toBeUndefined();
    await expect(
      resolveContainedRealPath(realDeploymentRoot, linkedDirectory),
    ).resolves.toBeUndefined();
    await expect(
      resolveContainedRealPath(realPublicDir, linkedFile),
    ).resolves.toBeUndefined();

    const movedDeploymentRoot = path.join(container, "moved-dist");
    await fs.rename(deploymentRoot, movedDeploymentRoot);
    await fs.symlink(outsideDir, deploymentRoot, "dir");
    await expect(
      resolveContainedRealPath(
        realDeploymentRoot,
        path.join(realDeploymentRoot, "secret.txt"),
      ),
    ).resolves.toBeUndefined();
  });

  it("pins the real file used after a checked alias is replaced", async () => {
    const container = await createTempDir();
    const serverDir = path.join(container, "dist/server");
    const outsideDir = path.join(container, "outside");
    await Promise.all([
      fs.mkdir(serverDir, { recursive: true }),
      fs.mkdir(outsideDir, { recursive: true }),
    ]);
    const realServerDir = await fs.realpath(serverDir);

    const safeAsset = path.join(realServerDir, "safe.txt");
    const outsideAsset = path.join(outsideDir, "outside.txt");
    const assetAlias = path.join(realServerDir, "asset.txt");
    await Promise.all([
      fs.writeFile(safeAsset, "inside", "utf-8"),
      fs.writeFile(outsideAsset, "outside", "utf-8"),
    ]);
    await fs.symlink(safeAsset, assetAlias);
    const resolvedAsset = await resolveContainedRealPath(
      realServerDir,
      assetAlias,
    );
    if (!resolvedAsset) throw new Error("Expected a contained asset path.");
    expect(resolvedAsset).toBe(await fs.realpath(safeAsset));
    await replaceSymlink(assetAlias, outsideAsset);
    await expect(fs.readFile(resolvedAsset, "utf-8")).resolves.toBe("inside");

    const safeModule = path.join(realServerDir, "safe.mjs");
    const outsideModule = path.join(outsideDir, "outside.mjs");
    const moduleAlias = path.join(realServerDir, "chunk.mjs");
    await Promise.all([
      fs.writeFile(safeModule, 'export default "inside";', "utf-8"),
      fs.writeFile(outsideModule, 'export default "outside";', "utf-8"),
    ]);
    await fs.symlink(safeModule, moduleAlias);
    const resolvedModule = await resolveContainedRealPath(
      realServerDir,
      moduleAlias,
    );
    if (!resolvedModule) throw new Error("Expected a contained module path.");
    expect(resolvedModule).toBe(await fs.realpath(safeModule));
    await replaceSymlink(moduleAlias, outsideModule);
    const mod = await import(pathToFileURL(resolvedModule).href);
    expect(mod.default).toBe("inside");
  });

  it("uses canonical paths for generated static reads and server imports", () => {
    const source = createNodeDeploymentFiles(
      createServerDeploymentOutput(),
    ).serverModule;
    expect(source).toBeDefined();
    expect(source).toContain(
      'import { resolveContainedRealPath, serve } from "@evjs/ev/_internal/server/node";',
    );
    expect(source).toContain(
      "const deploymentRoot = await realpath(__dirname);",
    );
    expect(source).toContain(
      "const clientRoot = await resolveDeploymentDirectory(",
    );
    expect(source).toContain(
      "const serverDir = await resolveDeploymentDirectory(",
    );
    expect(source).toContain(
      "const resolvedFilePath = await resolveContainedRealPath(clientRoot, filePath);",
    );
    expect(source).toContain("const body = await readFile(resolvedFilePath);");
    expect(source).not.toContain("readFile(filePath)");
    expect(source).toContain(
      "pathToFileURL(await resolveServerArtifact(asset)).href",
    );
    expect(source).toContain(
      "pathToFileURL(await resolveServerArtifact(serverEntry)).href",
    );
  });
});

async function createTempDir(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "evjs-deployment-runtime-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function replaceSymlink(link: string, target: string): Promise<void> {
  await fs.unlink(link);
  await fs.symlink(target, link);
}

function createServerDeploymentOutput(): BuildOutput {
  return {
    version: 1,
    buildId: "build-1",
    paths: {
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    },
    publicPath: "/",
    runtime: {
      server: {
        basepath: "/__evjs",
        fn: "__evjs/fn",
      },
    },
    assets: {},
    apps: {},
    pages: {},
    routes: [],
    server: {
      entry: "server.js",
      assets: { js: ["server.js"], css: [] },
      renderers: {},
      functions: {},
      routes: [],
    },
  };
}
