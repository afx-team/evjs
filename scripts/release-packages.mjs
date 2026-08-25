#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifestFileName = "release-manifest.json";
const releaseScriptFileName = "release-packages.mjs";
const manifestSchemaVersion = 1;
const registry = "https://registry.npmjs.org";
const repositoryUrl = "git+https://github.com/afx-team/evjs.git";
const dependencySections = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];
const trustedPublisherPackages = new Set([
  "@evjs/bundler-utoopack",
  "@evjs/bundler-webpack",
  "@evjs/cli",
  "@evjs/client",
  "@evjs/create-app",
  "@evjs/ev",
  "@evjs/plugin-qiankun",
  "@evjs/server",
  "@evjs/shared",
]);
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function normalizeVersion(rawVersion) {
  if (typeof rawVersion !== "string" || rawVersion.length === 0) {
    throw new Error("A release version is required.");
  }

  const version = rawVersion.startsWith("v") ? rawVersion.slice(1) : rawVersion;
  if (!semverPattern.test(version)) {
    throw new Error(`${rawVersion} is not a valid semantic version.`);
  }
  return version;
}

export function getNpmTag(version) {
  const normalizedVersion = normalizeVersion(version);
  const prerelease = normalizedVersion.split("-")[1]?.split("+")[0];
  const prereleaseId = prerelease?.split(".")[0];

  if (prereleaseId === "alpha" || prereleaseId === "rc") {
    return prereleaseId;
  }
  return prereleaseId ? "next" : "latest";
}

export function orderWorkspacePackages(workspacePackages) {
  const packagesByName = new Map(
    workspacePackages.map((workspacePackage) => [
      workspacePackage.packageJson.name,
      workspacePackage,
    ]),
  );
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(workspacePackage) {
    const name = workspacePackage.packageJson.name;
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular workspace dependency involving ${name}.`);
    }

    visiting.add(name);
    const dependencyNames = new Set(
      dependencySections.flatMap((section) =>
        Object.keys(workspacePackage.packageJson[section] ?? {}),
      ),
    );
    for (const dependencyName of [...dependencyNames].sort()) {
      const dependencyPackage = packagesByName.get(dependencyName);
      if (dependencyPackage) visit(dependencyPackage);
    }

    visiting.delete(name);
    visited.add(name);
    ordered.push(workspacePackage);
  }

  for (const workspacePackage of workspacePackages.toSorted((left, right) =>
    left.packageJson.name.localeCompare(right.packageJson.name),
  )) {
    visit(workspacePackage);
  }
  return ordered;
}

export function planPublication(manifestPackages, registryStates, npmTag) {
  const published = [];
  const unpublished = [];

  for (const manifestPackage of manifestPackages) {
    const state = registryStates.get(manifestPackage.name);
    if (!state?.versionMetadata) {
      unpublished.push(manifestPackage);
      continue;
    }
    published.push({ manifestPackage, state });
  }

  if (unpublished.length === 0) {
    return { complete: true, published, unpublished };
  }

  for (const { manifestPackage, state } of published) {
    assertMatchingIntegrity(manifestPackage, state.versionMetadata);
    if (state.tagVersion !== manifestPackage.version) {
      throw new Error(
        `${manifestPackage.name}@${manifestPackage.version} exists, but its ${npmTag} dist-tag points to ${state.tagVersion ?? "nothing"}. Refusing to continue a mixed release.`,
      );
    }
  }

  return { complete: false, published, unpublished };
}

function readWorkspacePackages(rootDir, version) {
  const packagesDir = path.join(rootDir, "packages");
  const workspacePackages = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name))
    .filter((dir) => existsSync(path.join(dir, "package.json")))
    .map((dir) => ({
      dir,
      packageJson: JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      ),
    }))
    .filter(
      ({ packageJson }) =>
        packageJson.private !== true &&
        typeof packageJson.name === "string" &&
        packageJson.name.startsWith("@evjs/"),
    );
  const packageNames = new Set(
    workspacePackages.map(({ packageJson }) => packageJson.name),
  );
  for (const packageName of trustedPublisherPackages) {
    if (!packageNames.has(packageName)) {
      throw new Error(
        `Trusted publisher package ${packageName} is missing from the workspace.`,
      );
    }
  }
  for (const packageName of packageNames) {
    if (!trustedPublisherPackages.has(packageName)) {
      throw new Error(
        `${packageName} must be added to the npm trusted publisher preflight before release.`,
      );
    }
  }

  for (const workspacePackage of workspacePackages) {
    const { packageJson } = workspacePackage;
    const relativeManifestPath = path.relative(
      rootDir,
      path.join(workspacePackage.dir, "package.json"),
    );
    if (packageJson.version !== version) {
      throw new Error(
        `${relativeManifestPath} has version ${packageJson.version}; expected ${version}.`,
      );
    }
    const packageRepositoryUrl =
      typeof packageJson.repository === "string"
        ? packageJson.repository
        : packageJson.repository?.url;
    if (packageRepositoryUrl !== repositoryUrl) {
      throw new Error(
        `${relativeManifestPath} must declare repository ${repositoryUrl} for npm trusted publishing.`,
      );
    }

    for (const section of dependencySections) {
      for (const [dependencyName, dependencyVersion] of Object.entries(
        packageJson[section] ?? {},
      )) {
        if (packageNames.has(dependencyName) && dependencyVersion !== version) {
          throw new Error(
            `${relativeManifestPath} has ${section}.${dependencyName}=${dependencyVersion}; expected ${version}.`,
          );
        }
      }
    }
  }

  return orderWorkspacePackages(workspacePackages);
}

function parsePackOutput(stdout, packageName) {
  try {
    const result = JSON.parse(stdout);
    if (Array.isArray(result) && result.length === 1) return result[0];
  } catch {
    // A package lifecycle script may have written a line before npm's JSON.
  }

  for (
    let start = stdout.lastIndexOf("[");
    start !== -1;
    start = stdout.lastIndexOf("[", start - 1)
  ) {
    try {
      const result = JSON.parse(stdout.slice(start).trim());
      if (Array.isArray(result) && result.length === 1) return result[0];
    } catch {
      // Try the preceding array marker until npm's trailing JSON is found.
    }
  }
  throw new Error(`npm pack returned invalid JSON for ${packageName}.`);
}

function getFileIntegrity(filePath) {
  return `sha512-${createHash("sha512")
    .update(readFileSync(filePath))
    .digest("base64")}`;
}

function getSourceCommit(rootDir) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(result.stdout.trim())) {
    throw new Error("Unable to resolve the release source commit.");
  }
  return result.stdout.trim();
}

function packRelease({ rootDir, outputDir, version }) {
  const normalizedVersion = normalizeVersion(version);
  const absoluteRootDir = path.resolve(rootDir);
  const absoluteOutputDir = path.resolve(outputDir);
  if (absoluteOutputDir === absoluteRootDir) {
    throw new Error(
      "The release artifact directory cannot be the repository root.",
    );
  }
  if (existsSync(absoluteOutputDir)) {
    throw new Error(
      `Release artifact directory already exists: ${absoluteOutputDir}`,
    );
  }
  mkdirSync(absoluteOutputDir, { recursive: true });

  const workspacePackages = readWorkspacePackages(
    absoluteRootDir,
    normalizedVersion,
  );
  if (workspacePackages.length === 0) {
    throw new Error("No public @evjs workspace packages were found.");
  }

  const manifestPackages = [];
  for (const workspacePackage of workspacePackages) {
    const name = workspacePackage.packageJson.name;
    console.log(`Packing ${name}@${normalizedVersion}...`);
    const packResult = spawnSync(
      "npm",
      [
        "pack",
        "--workspace",
        path.relative(absoluteRootDir, workspacePackage.dir),
        "--pack-destination",
        absoluteOutputDir,
        "--json",
      ],
      {
        cwd: absoluteRootDir,
        encoding: "utf8",
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    if (packResult.status !== 0) {
      process.stderr.write(packResult.stderr ?? "");
      throw new Error(`npm pack failed for ${name}.`);
    }

    const packed = parsePackOutput(packResult.stdout, name);
    if (packed.name !== name || packed.version !== normalizedVersion) {
      throw new Error(
        `npm pack produced ${packed.name}@${packed.version}; expected ${name}@${normalizedVersion}.`,
      );
    }
    const tarball = path.basename(packed.filename);
    const tarballPath = path.join(absoluteOutputDir, tarball);
    if (!existsSync(tarballPath)) {
      throw new Error(`npm pack did not create ${tarballPath}.`);
    }
    const integrity = getFileIntegrity(tarballPath);
    if (packed.integrity && packed.integrity !== integrity) {
      throw new Error(`npm pack reported the wrong integrity for ${name}.`);
    }

    manifestPackages.push({
      name,
      version: normalizedVersion,
      tarball,
      integrity,
      shasum: packed.shasum,
    });
  }

  const manifest = {
    schemaVersion: manifestSchemaVersion,
    version: normalizedVersion,
    npmTag: getNpmTag(normalizedVersion),
    registry,
    sourceCommit: getSourceCommit(absoluteRootDir),
    packages: manifestPackages,
  };
  writeFileSync(
    path.join(absoluteOutputDir, manifestFileName),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  copyFileSync(
    fileURLToPath(import.meta.url),
    path.join(absoluteOutputDir, releaseScriptFileName),
  );
  console.log(
    `Packed ${manifestPackages.length} packages for ${normalizedVersion} with npm dist-tag ${manifest.npmTag}.`,
  );
}

function readReleaseManifest(inputDir, expectedVersion) {
  const absoluteInputDir = path.resolve(inputDir);
  const manifestPath = path.join(absoluteInputDir, manifestFileName);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version = normalizeVersion(expectedVersion);

  if (manifest.schemaVersion !== manifestSchemaVersion) {
    throw new Error(
      `Unsupported release manifest schema ${manifest.schemaVersion}.`,
    );
  }
  if (manifest.version !== version) {
    throw new Error(
      `Release manifest version is ${manifest.version}; expected ${version}.`,
    );
  }
  if (
    manifest.npmTag !== getNpmTag(version) ||
    manifest.registry !== registry
  ) {
    throw new Error("Release manifest registry or npm dist-tag is invalid.");
  }
  if (!Array.isArray(manifest.packages) || manifest.packages.length === 0) {
    throw new Error("Release manifest contains no packages.");
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit)) {
    throw new Error("Release manifest contains an invalid source commit.");
  }

  const packageNames = new Set();
  for (const manifestPackage of manifest.packages) {
    if (
      typeof manifestPackage.name !== "string" ||
      !manifestPackage.name.startsWith("@evjs/") ||
      packageNames.has(manifestPackage.name)
    ) {
      throw new Error("Release manifest contains an invalid package name.");
    }
    packageNames.add(manifestPackage.name);
    if (manifestPackage.version !== version) {
      throw new Error(
        `${manifestPackage.name} has the wrong manifest version.`,
      );
    }
    if (
      typeof manifestPackage.tarball !== "string" ||
      path.basename(manifestPackage.tarball) !== manifestPackage.tarball
    ) {
      throw new Error(`${manifestPackage.name} has an invalid tarball path.`);
    }
    const tarballPath = path.join(absoluteInputDir, manifestPackage.tarball);
    if (!existsSync(tarballPath)) {
      throw new Error(`Missing release tarball: ${manifestPackage.tarball}`);
    }
    if (getFileIntegrity(tarballPath) !== manifestPackage.integrity) {
      throw new Error(
        `Release tarball integrity mismatch: ${manifestPackage.tarball}`,
      );
    }
    manifestPackage.tarballPath = tarballPath;
  }
  for (const packageName of trustedPublisherPackages) {
    if (!packageNames.has(packageName)) {
      throw new Error(`Release manifest is missing ${packageName}.`);
    }
  }
  for (const packageName of packageNames) {
    if (!trustedPublisherPackages.has(packageName)) {
      throw new Error(`Release manifest contains unexpected ${packageName}.`);
    }
  }
  return manifest;
}

const wait = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

async function fetchPackageState(
  packageName,
  version,
  npmTag,
  { attempts = 4 } = {},
) {
  const escapedPackageName = packageName.replace("/", "%2f");
  const url = new URL(`/${escapedPackageName}`, registry);
  let lastError = "unknown registry error";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      url.searchParams.set("cache", `${Date.now()}-${attempt}`);
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.npm.install-v1+json",
          "Cache-Control": "no-cache",
        },
      });
      if (response.status === 404) {
        return { versionMetadata: null, tagVersion: null };
      }
      if (response.ok) {
        const packument = await response.json();
        return {
          versionMetadata: packument.versions?.[version] ?? null,
          tagVersion: packument["dist-tags"]?.[npmTag] ?? null,
        };
      }
      lastError = `${response.status} ${response.statusText}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) await wait(attempt * 1_000);
  }
  throw new Error(`Failed to read ${packageName} from npm: ${lastError}`);
}

function assertMatchingIntegrity(manifestPackage, versionMetadata) {
  const publishedIntegrity = versionMetadata.dist?.integrity;
  const publishedShasum = versionMetadata.dist?.shasum;
  if (
    publishedIntegrity !== manifestPackage.integrity &&
    (!manifestPackage.shasum || publishedShasum !== manifestPackage.shasum)
  ) {
    throw new Error(
      `${manifestPackage.name}@${manifestPackage.version} is already published from a different tarball.`,
    );
  }
}

async function getGithubNpmIdToken() {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error("GitHub OIDC token request environment is unavailable.");
  }

  let lastError = "unknown error";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const url = new URL(requestUrl);
    url.searchParams.set("audience", `npm:${new URL(registry).hostname}`);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${requestToken}`,
        },
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        lastError = text.slice(0, 200);
      }
      if (response.ok && typeof body?.value === "string") return body.value;
      lastError =
        typeof body?.message === "string"
          ? body.message
          : `${response.status}: ${lastError}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 3) await wait(attempt * 2_000);
  }
  throw new Error(`Failed to retrieve GitHub OIDC token: ${lastError}`);
}

async function verifyTrustedPublisher(packageName) {
  let lastError = "unknown npm OIDC exchange error";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const idToken = await getGithubNpmIdToken();
    const escapedPackageName = packageName.replace("/", "%2f");
    try {
      const response = await fetch(
        new URL(
          `/-/npm/v1/oidc/token/exchange/package/${escapedPackageName}`,
          registry,
        ),
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${idToken}`,
          },
        },
      );
      const body = await response.json().catch(() => ({}));
      if (response.ok && typeof body.token === "string") {
        console.log(`${packageName}: npm trusted publisher verified.`);
        return;
      }
      lastError =
        typeof body.message === "string"
          ? `${response.status} ${body.message}`
          : `${response.status} ${response.statusText}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 3) await wait(attempt * 2_000);
  }
  throw new Error(
    `${packageName}: npm trusted publisher verification failed: ${lastError}`,
  );
}

async function verifyPublishCredentials(unpublishedPackages) {
  for (const manifestPackage of unpublishedPackages) {
    if (!trustedPublisherPackages.has(manifestPackage.name)) {
      throw new Error(
        `${manifestPackage.name} is not configured for trusted publishing.`,
      );
    }
    await verifyTrustedPublisher(manifestPackage.name);
  }
}

async function confirmPublished(manifestPackage, npmTag) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const state = await fetchPackageState(
        manifestPackage.name,
        manifestPackage.version,
        npmTag,
        { attempts: 1 },
      );
      if (state.versionMetadata) {
        assertMatchingIntegrity(manifestPackage, state.versionMetadata);
        if (state.tagVersion !== manifestPackage.version) {
          throw new Error(
            `${manifestPackage.name} published without the expected ${npmTag} dist-tag.`,
          );
        }
        return true;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < 6) await wait(attempt * 1_000);
  }
  if (lastError) throw lastError;
  return false;
}

async function publishPackage(manifestPackage, npmTag) {
  const publishEnv = { ...process.env };
  delete publishEnv.NODE_AUTH_TOKEN;
  delete publishEnv.NPM_CONFIG_USERCONFIG;
  publishEnv.NPM_ID_TOKEN = await getGithubNpmIdToken();

  console.log(
    `Publishing ${manifestPackage.name}@${manifestPackage.version}...`,
  );
  const result = spawnSync(
    "npm",
    [
      "publish",
      manifestPackage.tarballPath,
      "--access",
      "public",
      "--tag",
      npmTag,
      "--ignore-scripts",
      "--registry",
      registry,
    ],
    { stdio: "inherit", env: publishEnv },
  );
  const published = await confirmPublished(manifestPackage, npmTag);
  if (!published) {
    throw new Error(
      `npm publish failed for ${manifestPackage.name} with exit code ${result.status ?? "unknown"}.`,
    );
  }
  if (result.status !== 0) {
    console.log(
      `${manifestPackage.name}@${manifestPackage.version} reached npm despite the CLI error; continuing.`,
    );
  }
}

async function publishRelease({ inputDir, version }) {
  const manifest = readReleaseManifest(inputDir, version);
  console.log(
    `Checking ${manifest.packages.length} packages for ${manifest.version}...`,
  );
  const registryStates = new Map(
    await Promise.all(
      manifest.packages.map(async (manifestPackage) => [
        manifestPackage.name,
        await fetchPackageState(
          manifestPackage.name,
          manifestPackage.version,
          manifest.npmTag,
        ),
      ]),
    ),
  );
  const plan = planPublication(
    manifest.packages,
    registryStates,
    manifest.npmTag,
  );
  if (plan.complete) {
    console.log(`All packages for ${manifest.version} are already published.`);
    return;
  }

  for (const { manifestPackage } of plan.published) {
    console.log(
      `${manifestPackage.name}@${manifestPackage.version} is already published from the matching tarball; skipping.`,
    );
  }
  await verifyPublishCredentials(plan.unpublished);
  console.log("All required npm publishing credentials passed preflight.");

  for (const manifestPackage of plan.unpublished) {
    await publishPackage(manifestPackage, manifest.npmTag);
  }
  console.log(
    `Published all ${manifest.packages.length} packages for ${manifest.version}.`,
  );
}

async function verifyAllTrustedPublishers() {
  await verifyPublishCredentials(
    [...trustedPublisherPackages].sort().map((name) => ({ name })),
  );
  console.log(
    `Verified npm trusted publishing for all ${trustedPublisherPackages.size} packages.`,
  );
}

function readRequiredArg(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(args) {
  const command = args[0];
  if (command === "--help" || command === "-h") return { command: "help" };
  if (command !== "pack" && command !== "publish" && command !== "verify") {
    throw new Error("The first argument must be pack, publish, or verify.");
  }

  const options = { command, rootDir: defaultRootDir };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--version") {
      options.version = readRequiredArg(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--root") {
      options.rootDir = path.resolve(readRequiredArg(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputDir = path.resolve(readRequiredArg(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--input") {
      options.inputDir = path.resolve(readRequiredArg(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") return { command: "help" };
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (command !== "verify" && !options.version) {
    throw new Error("--version is required.");
  }
  if (command === "pack" && !options.outputDir) {
    throw new Error("--output is required for pack.");
  }
  if (command === "publish" && !options.inputDir) {
    throw new Error("--input is required for publish.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/release-packages.mjs pack --version <version> --output <dir>
  node scripts/release-packages.mjs publish --version <version> --input <dir>
  node scripts/release-packages.mjs verify

The pack command validates and packs every public @evjs workspace before any
credentials are granted. The publish command verifies all required credentials
before publishing the immutable tarballs in dependency order. The verify
command checks every npm trusted publisher without publishing.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    printHelp();
    return;
  }
  if (options.command === "pack") {
    packRelease(options);
    return;
  }
  if (options.command === "verify") {
    await verifyAllTrustedPublishers();
    return;
  }
  await publishRelease(options);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
