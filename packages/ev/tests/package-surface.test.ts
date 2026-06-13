import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const expectedPackageDirs = [
  "bundler-utoopack",
  "bundler-webpack",
  "cli",
  "client",
  "create-app",
  "ev",
  "server",
  "shared",
];

const expectedPackageNames = [
  "@evjs/bundler-utoopack",
  "@evjs/bundler-webpack",
  "@evjs/cli",
  "@evjs/client",
  "@evjs/create-app",
  "@evjs/ev",
  "@evjs/server",
  "@evjs/shared",
];

const forbiddenPackageNames = [
  "@evjs/build-tools",
  "@evjs/manifest",
  "@evjs/router",
  "@evjs/router-tanstack",
];

describe("workspace package surface", () => {
  it("keeps the distributed evjs package set intentional", async () => {
    const packageDirs = await listPackageDirs();
    expect(packageDirs).toEqual(expectedPackageDirs);

    const packageNames = await Promise.all(packageDirs.map(readPackageName));
    expect(packageNames.sort()).toEqual(expectedPackageNames);
    expect(packageNames).not.toEqual(
      expect.arrayContaining(forbiddenPackageNames),
    );
  });

  it("does not keep legacy package names in the lockfile", async () => {
    const lockfile = JSON.parse(
      await fs.readFile(path.join(repoRoot, "package-lock.json"), "utf-8"),
    ) as {
      packages?: Record<string, { name?: string }>;
    };

    const lockedPackageNames = Object.values(lockfile.packages ?? {})
      .map((pkg) => pkg.name)
      .filter((name): name is string => typeof name === "string");

    expect(lockedPackageNames).not.toEqual(
      expect.arrayContaining(forbiddenPackageNames),
    );
  });

  it("keeps @evjs/client router internals out of published subpath exports", async () => {
    const clientPackageJson = JSON.parse(
      await fs.readFile(
        path.join(repoRoot, "packages/client/package.json"),
        "utf-8",
      ),
    ) as {
      exports?: Record<string, unknown>;
    };

    const exportedSubpaths = Object.keys(
      clientPackageJson.exports ?? {},
    ).sort();
    expect(exportedSubpaths).toEqual([
      ".",
      "./internal",
      "./internal/page-context",
      "./internal/react-page",
      "./internal/route-types",
      "./internal/rsc-page-context",
    ]);
    expect(exportedSubpaths).not.toEqual(
      expect.arrayContaining([
        "./app",
        "./internal/app",
        "./internal/page-route",
        "./internal/react",
        "./internal/shell",
        "./navigation",
        "./page-route",
        "./route",
        "./tanstack",
      ]),
    );
  });
});

async function listPackageDirs(): Promise<string[]> {
  const entries = await fs.readdir(path.join(repoRoot, "packages"), {
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function readPackageName(packageDir: string): Promise<string> {
  const packageJson = JSON.parse(
    await fs.readFile(
      path.join(repoRoot, "packages", packageDir, "package.json"),
      "utf-8",
    ),
  ) as {
    name?: string;
  };
  if (!packageJson.name) {
    throw new Error(`Missing package name for packages/${packageDir}`);
  }
  return packageJson.name;
}
