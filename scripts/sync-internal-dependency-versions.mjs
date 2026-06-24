#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRootDir = path.resolve(scriptDir, "..");
const internalScope = "@evjs/";

export async function syncInternalDependencyVersions({
  rootDir = defaultRootDir,
  releaseVersion,
} = {}) {
  const packages = await readWorkspacePackages(rootDir);
  const packagesByName = new Map(
    packages.map((workspacePackage) => [
      workspacePackage.packageJson.name,
      workspacePackage,
    ]),
  );

  if (releaseVersion) {
    for (const workspacePackage of packages) {
      if (workspacePackage.packageJson.version !== releaseVersion) {
        throw new Error(
          `${workspacePackage.relativePath} version is ${workspacePackage.packageJson.version}; expected ${releaseVersion}`,
        );
      }
    }
  }

  const changes = [];

  for (const workspacePackage of packages) {
    const dependencies = workspacePackage.packageJson.dependencies;
    if (!dependencies) continue;

    let changed = false;
    for (const dependencyName of Object.keys(dependencies).sort()) {
      const dependencyPackage = packagesByName.get(dependencyName);
      if (!dependencyPackage) continue;

      const expectedVersion = dependencyPackage.packageJson.version;
      const currentVersion = dependencies[dependencyName];
      if (currentVersion === expectedVersion) continue;

      dependencies[dependencyName] = expectedVersion;
      changed = true;
      changes.push({
        packageName: workspacePackage.packageJson.name,
        dependencyName,
        from: currentVersion,
        to: expectedVersion,
      });
    }

    if (changed) {
      await writePackageJson(
        workspacePackage.packageJsonPath,
        workspacePackage.packageJson,
      );
    }
  }

  return changes;
}

async function readWorkspacePackages(rootDir) {
  const packagesDir = path.join(rootDir, "packages");
  const entries = await fs.readdir(packagesDir, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const packageJsonPath = path.join(packagesDir, entry.name, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
    if (
      typeof packageJson.name !== "string" ||
      !packageJson.name.startsWith(internalScope) ||
      packageJson.private === true
    ) {
      continue;
    }

    packages.push({
      packageJson,
      packageJsonPath,
      relativePath: path.relative(rootDir, packageJsonPath),
    });
  }

  return packages.sort((left, right) =>
    left.packageJson.name.localeCompare(right.packageJson.name),
  );
}

async function writePackageJson(packageJsonPath, packageJson) {
  await fs.writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
}

function parseArgs(args) {
  const options = { rootDir: defaultRootDir };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      options.rootDir = path.resolve(readRequiredArg(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--version") {
      options.releaseVersion = readRequiredArg(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.releaseVersion) {
    throw new Error("--version is required for release dependency syncing");
  }

  return options;
}

function readRequiredArg(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/sync-internal-dependency-versions.mjs [options]

Options:
  --root <dir>       Repository root. Defaults to this checkout.
  --version <value>  Required release version for published @evjs workspaces.
`);
}

async function main() {
  const changes = await syncInternalDependencyVersions(
    parseArgs(process.argv.slice(2)),
  );

  if (changes.length === 0) {
    console.log(
      "Internal @evjs dependency versions already match workspace package versions.",
    );
    return;
  }

  console.log("Synced internal @evjs dependency versions:");
  for (const change of changes) {
    console.log(
      `- ${change.packageName}: ${change.dependencyName} ${change.from} -> ${change.to}`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
