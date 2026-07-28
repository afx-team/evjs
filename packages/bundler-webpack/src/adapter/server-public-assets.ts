import fs from "node:fs";
import path from "node:path";
import {
  assertPortableRelativeArtifactPath,
  portableArtifactPathsConflict,
  removeOwnedOutputFile,
  writeOwnedOutputFile,
} from "@evjs/ev/_internal/build";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import {
  readServerNonExecutableAssetFiles,
  readServerPublicAssetFiles,
  readWebpackEmittedFiles,
  type WebpackStatsLike,
} from "../manifest-generator.js";

const PUBLIC_URL_BASE = "https://evjs.invalid/";

interface ResolvedServerPublicAssets {
  files: string[];
  contents: Map<string, Buffer>;
}

interface PlannedWrite {
  asset: string;
  contents: Buffer;
}

/**
 * Publish the subset of server compiler output that is reachable from emitted
 * stylesheets. The whole next state is validated before the first mutation and
 * the ownership map changes only after the file transaction commits.
 */
export async function copyServerPublicAssetsToClient(
  cwd: string,
  serverDir: string,
  clientDir: string,
  stats: WebpackStatsLike | undefined,
  memoryFiles: ReadonlyMap<string, string | Uint8Array> = new Map(),
  ownedFiles: Map<string, Buffer> = new Map(),
  clientOwnedFiles: ReadonlySet<string> = new Set(),
  publicPath = "/",
): Promise<string[]> {
  const resolved = await resolveServerPublicAssets(
    cwd,
    serverDir,
    stats,
    memoryFiles,
    publicPath,
  );
  assertPortableClaims(resolved.files, "Webpack server public assets");
  const clientClaims = [...clientOwnedFiles].map((asset) =>
    assertPortableRelativeArtifactPath(
      asset,
      `Webpack client emitted asset ${JSON.stringify(asset)}`,
    ),
  );
  assertPortableClaims(clientClaims, "Webpack client emitted assets");

  const previousOwnership = new Map(ownedFiles);
  assertPortableClaims(
    [...previousOwnership.keys()],
    "Previously copied Webpack server public assets",
  );
  assertOwnershipDoesNotAliasClient(previousOwnership, clientClaims);

  const publicAssetSet = new Set(resolved.files);
  const staleAssets = [...previousOwnership.keys()].filter(
    (asset) => !publicAssetSet.has(asset) && !clientOwnedFiles.has(asset),
  );
  const staleAssetSet = new Set(staleAssets);
  const previousFiles = await verifyPreviousOwnedFiles(
    cwd,
    clientDir,
    previousOwnership,
    clientOwnedFiles,
  );
  const nextOwnership = new Map<string, Buffer>();
  const writes: PlannedWrite[] = [];

  for (const asset of resolved.files) {
    const contents = resolved.contents.get(asset);
    if (!contents) {
      throw new Error(
        `[evjs] Webpack server public asset "${asset}" was not resolved before publication.`,
      );
    }
    const conflictingClientAsset = clientClaims.find(
      (clientAsset) =>
        clientAsset !== asset &&
        portableArtifactPathsConflict(clientAsset, asset),
    );
    if (conflictingClientAsset) {
      throw new Error(
        `[evjs] Webpack server public asset "${asset}" conflicts with client bundler asset "${conflictingClientAsset}" on portable file systems. Use distinct case- and Unicode-stable file paths without file/directory overlap.`,
      );
    }

    const target = resolveWebpackPublicAssetPath(clientDir, asset);
    await assertSafeTargetAncestors(clientDir, asset, staleAssetSet);
    const state = await inspectPath(target);
    const clientOwnsExactPath = clientOwnedFiles.has(asset);
    const previousContents = previousOwnership.get(asset);
    const portablePrevious = findPortableConflict(
      previousOwnership,
      asset,
      staleAssetSet,
    );

    if (state?.isSymbolicLink()) {
      throw new Error(
        `[evjs] Webpack server public asset "${asset}" must be a regular file inside the project client output directory.`,
      );
    }
    if (state?.isDirectory()) {
      if (clientOwnsExactPath) {
        throw missingClientAssetError(asset);
      }
      await assertReplaceableDirectory(clientDir, asset, staleAssetSet);
      writes.push({ asset, contents });
      nextOwnership.set(asset, Buffer.from(contents));
      continue;
    }

    const existingContents = state?.isFile()
      ? await readOwnedWebpackPublicAsset(
          cwd,
          clientDir,
          target,
          `Webpack server public asset "${asset}"`,
          "client output directory",
        )
      : undefined;
    if (clientOwnsExactPath) {
      if (!existingContents) throw missingClientAssetError(asset);
      if (!existingContents.equals(contents)) {
        throw new Error(
          `[evjs] Webpack server public asset "${asset}" conflicts with a client bundler asset at the same path and has different contents. Use distinct client and server asset names.`,
        );
      }
      continue;
    }

    const effectivePreviousContents = previousContents ?? portablePrevious?.[1];
    if (existingContents && effectivePreviousContents) {
      if (!existingContents.equals(effectivePreviousContents)) {
        throw new Error(
          `[evjs] Webpack server public asset "${asset}" changed outside server asset copying and cannot be replaced safely.`,
        );
      }
      if (!existingContents.equals(contents)) writes.push({ asset, contents });
      nextOwnership.set(asset, Buffer.from(contents));
      continue;
    }
    if (existingContents) {
      if (!existingContents.equals(contents)) {
        throw new Error(
          `[evjs] Webpack server public asset "${asset}" conflicts with an existing client output file at the same path and has different contents.`,
        );
      }
      continue;
    }

    writes.push({ asset, contents });
    nextOwnership.set(asset, Buffer.from(contents));
  }

  await commitPublicAssetTransaction({
    cwd,
    clientDir,
    staleAssets,
    writes,
    previousFiles,
    nextOwnership,
    ownedFiles,
  });
  return resolved.files;
}

async function resolveServerPublicAssets(
  cwd: string,
  serverDir: string,
  stats: WebpackStatsLike | undefined,
  memoryFiles: ReadonlyMap<string, string | Uint8Array>,
  publicPath: string,
): Promise<ResolvedServerPublicAssets> {
  const stylesheets = readServerPublicAssetFiles(stats);
  const candidates = readServerNonExecutableAssetFiles(stats).filter(
    (asset) => !stylesheets.includes(asset),
  );
  const runtimeAssets = new Set(readWebpackEmittedFiles(stats) ?? []);
  for (const entrypoint of Object.values(stats?.entrypoints ?? {})) {
    for (const asset of entrypoint.assets ?? []) {
      const name = typeof asset === "string" ? asset : asset.name;
      if (name) runtimeAssets.add(name.replace(/^\.\//u, ""));
    }
  }
  const reader = createServerAssetReader({
    cwd,
    serverDir,
    memoryFiles,
    runtimeAssets,
  });
  const files = new Set(stylesheets);

  for (const stylesheet of stylesheets) {
    const contents = await reader.read(stylesheet);
    for (const reference of readCssUrlReferences(contents.toString("utf-8"))) {
      const referencedAsset = matchEmittedCssAsset(
        stylesheet,
        reference,
        candidates,
        publicPath,
      );
      if (referencedAsset) files.add(referencedAsset);
    }
  }
  for (const asset of files) await reader.read(asset);

  return { files: [...files], contents: reader.contents };
}

function createServerAssetReader(options: {
  cwd: string;
  serverDir: string;
  memoryFiles: ReadonlyMap<string, string | Uint8Array>;
  runtimeAssets: ReadonlySet<string>;
}): { contents: Map<string, Buffer>; read(asset: string): Promise<Buffer> } {
  const contents = new Map<string, Buffer>();
  return {
    contents,
    async read(asset) {
      const cached = contents.get(asset);
      if (cached) return cached;

      const field = `Webpack server public asset "${asset}"`;
      const memorySource = options.memoryFiles.get(asset);
      const memoryContents =
        memorySource === undefined ? undefined : Buffer.from(memorySource);
      const physicalContents = options.runtimeAssets.has(asset)
        ? await readPhysicalServerAssetIfPresent(
            options.cwd,
            options.serverDir,
            asset,
          )
        : undefined;
      if (
        physicalContents &&
        memoryContents &&
        !physicalContents.equals(memoryContents)
      ) {
        throw new Error(
          `[evjs] ${field} was emitted with different contents from runtime and build-only output roots. Use distinct asset names across physical roots.`,
        );
      }
      const resolved = physicalContents ?? memoryContents;
      if (!resolved) {
        throw new Error(
          `[evjs] ${field} was declared by stats but not emitted under the runtime or build-only server output root.`,
        );
      }
      contents.set(asset, resolved);
      return resolved;
    },
  };
}

async function readPhysicalServerAssetIfPresent(
  cwd: string,
  serverDir: string,
  asset: string,
): Promise<Buffer | undefined> {
  const source = resolveWebpackPublicAssetPath(serverDir, asset);
  const state = await inspectPath(source);
  if (!state) return undefined;
  return readOwnedWebpackPublicAsset(
    cwd,
    serverDir,
    source,
    `Webpack server public asset "${asset}"`,
    "server output directory",
  );
}

function readCssUrlReferences(source: string): string[] {
  const references: string[] = [];
  const root = postcss.parse(source);
  root.walkDecls((declaration) => {
    collectCssValueUrlReferences(declaration.value, references);
  });
  root.walkAtRules("import", (atRule) => {
    collectCssValueUrlReferences(atRule.params, references);
    collectCssStringImportReference(atRule.params, references);
  });
  return references;
}

function collectCssStringImportReference(
  value: string,
  references: string[],
): void {
  const firstNode = valueParser(value).nodes.find(
    (node) => node.type !== "space" && node.type !== "comment",
  );
  if (firstNode?.type === "string") {
    appendCssReference(firstNode.value, references);
  }
}

function collectCssValueUrlReferences(
  value: string,
  references: string[],
): void {
  valueParser(value).walk((node) => {
    if (node.type !== "function" || node.value.toLowerCase() !== "url") {
      return;
    }
    const meaningfulNodes = node.nodes.filter(
      (child) => child.type !== "space" && child.type !== "comment",
    );
    if (meaningfulNodes.length !== 1) return;
    const valueNode = meaningfulNodes[0];
    if (valueNode?.type !== "word" && valueNode?.type !== "string") return;
    appendCssReference(valueNode.value, references);
  });
}

function appendCssReference(reference: string, references: string[]): void {
  const value = reference.trim();
  if (
    value &&
    !value.startsWith("#") &&
    !/^(?:data|blob|javascript):/iu.test(value)
  ) {
    references.push(value);
  }
}

function matchEmittedCssAsset(
  stylesheet: string,
  reference: string,
  candidates: readonly string[],
  publicPath: string,
): string | undefined {
  const stylesheetUrl = resolvePublicAssetUrl(stylesheet, publicPath);
  if (!stylesheetUrl) return undefined;
  let referenceUrl: URL;
  try {
    referenceUrl = new URL(reference, stylesheetUrl);
  } catch {
    return undefined;
  }
  referenceUrl.search = "";
  referenceUrl.hash = "";

  return candidates.find((candidate) => {
    const candidateUrl = resolvePublicAssetUrl(candidate, publicPath);
    if (!candidateUrl) return false;
    candidateUrl.search = "";
    candidateUrl.hash = "";
    return candidateUrl.href === referenceUrl.href;
  });
}

function resolvePublicAssetUrl(asset: string, publicPath: string): URL | null {
  const configuredBase = publicPath === "auto" ? "/" : publicPath;
  const directoryBase = configuredBase.endsWith("/")
    ? configuredBase
    : `${configuredBase}/`;
  try {
    return new URL(asset, new URL(directoryBase, PUBLIC_URL_BASE));
  } catch {
    return null;
  }
}

function assertPortableClaims(files: readonly string[], label: string): void {
  const claims: string[] = [];
  for (const asset of files) {
    if (claims.includes(asset)) continue;
    const conflict = claims.find((claim) =>
      portableArtifactPathsConflict(claim, asset),
    );
    if (conflict) {
      throw new Error(
        `[evjs] ${label} "${asset}" conflicts with "${conflict}" on portable file systems. Use one case- and Unicode-stable spelling, and do not overlap file and directory paths.`,
      );
    }
    claims.push(asset);
  }
}

function assertOwnershipDoesNotAliasClient(
  ownership: ReadonlyMap<string, Buffer>,
  clientClaims: readonly string[],
): void {
  for (const asset of ownership.keys()) {
    const conflict = clientClaims.find(
      (clientAsset) =>
        clientAsset !== asset &&
        portableArtifactPathsConflict(clientAsset, asset),
    );
    if (conflict) {
      throw new Error(
        `[evjs] Previously copied Webpack server public asset "${asset}" conflicts with client bundler asset "${conflict}" on portable file systems.`,
      );
    }
  }
}

function findPortableConflict(
  ownership: ReadonlyMap<string, Buffer>,
  asset: string,
  allowedAssets: ReadonlySet<string>,
): [string, Buffer] | undefined {
  return [...ownership].find(
    ([ownedAsset]) =>
      ownedAsset !== asset &&
      allowedAssets.has(ownedAsset) &&
      portableArtifactPathsConflict(ownedAsset, asset),
  );
}

async function verifyPreviousOwnedFiles(
  cwd: string,
  clientDir: string,
  ownership: ReadonlyMap<string, Buffer>,
  clientOwnedFiles: ReadonlySet<string>,
): Promise<Map<string, Buffer>> {
  const existing = new Map<string, Buffer>();
  for (const [asset, previousContents] of ownership) {
    if (clientOwnedFiles.has(asset)) continue;
    const target = resolveWebpackPublicAssetPath(clientDir, asset);
    const state = await inspectPath(target);
    if (!state) continue;
    const currentContents = await readOwnedWebpackPublicAsset(
      cwd,
      clientDir,
      target,
      `Webpack server public asset "${asset}"`,
      "client output directory",
    );
    if (!currentContents.equals(previousContents)) {
      throw new Error(
        `[evjs] Webpack server public asset "${asset}" changed outside server asset copying and cannot be replaced safely.`,
      );
    }
    existing.set(asset, currentContents);
  }
  return existing;
}

async function assertReplaceableDirectory(
  clientDir: string,
  asset: string,
  staleAssets: ReadonlySet<string>,
): Promise<void> {
  const root = resolveWebpackPublicAssetPath(clientDir, asset);
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of await fs.promises.readdir(directory, {
      withFileTypes: true,
    })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `[evjs] Webpack server public asset "${asset}" cannot replace a client output directory containing symbolic links.`,
        );
      }
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      const relative = path
        .relative(clientDir, absolute)
        .split(path.sep)
        .join("/");
      if (!entry.isFile() || !staleAssets.has(relative)) {
        throw new Error(
          `[evjs] Webpack server public asset "${asset}" cannot replace a non-empty client output directory it does not exclusively own.`,
        );
      }
    }
  }
}

async function assertSafeTargetAncestors(
  clientDir: string,
  asset: string,
  staleAssets: ReadonlySet<string>,
): Promise<void> {
  const segments = asset.split("/");
  let current = clientDir;
  const rootState = await inspectPath(current);
  if (rootState && (rootState.isSymbolicLink() || !rootState.isDirectory())) {
    throw new Error(
      `[evjs] Webpack server public asset "${asset}" must not traverse symbolic links or non-directory client output ancestors.`,
    );
  }
  if (!rootState) return;

  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const state = await inspectPath(current);
    if (!state) return;
    const relative = path
      .relative(clientDir, current)
      .split(path.sep)
      .join("/");
    if (state.isSymbolicLink()) {
      throw new Error(
        `[evjs] Webpack server public asset "${asset}" must not traverse symbolic links or non-directory client output ancestors.`,
      );
    }
    if (state.isDirectory()) continue;
    if (state.isFile() && staleAssets.has(relative)) return;
    throw new Error(
      `[evjs] Webpack server public asset "${asset}" must not traverse symbolic links or non-directory client output ancestors.`,
    );
  }
}

async function commitPublicAssetTransaction(options: {
  cwd: string;
  clientDir: string;
  staleAssets: readonly string[];
  writes: readonly PlannedWrite[];
  previousFiles: ReadonlyMap<string, Buffer>;
  nextOwnership: ReadonlyMap<string, Buffer>;
  ownedFiles: Map<string, Buffer>;
}): Promise<void> {
  const writtenAssets = new Set<string>();
  try {
    for (const asset of options.staleAssets) {
      await removeOwnedOutputFile(
        options.cwd,
        resolveWebpackPublicAssetPath(options.clientDir, asset),
        `Webpack stale server public asset "${asset}"`,
      );
    }
    await pruneEmptyAssetDirectories(options.clientDir, options.staleAssets);
    for (const write of options.writes) {
      await writeOwnedOutputFile(
        options.cwd,
        resolveWebpackPublicAssetPath(options.clientDir, write.asset),
        write.contents,
        `Webpack server public asset "${write.asset}"`,
      );
      writtenAssets.add(write.asset);
    }
  } catch (error) {
    try {
      await rollbackPublicAssetFiles(
        options.cwd,
        options.clientDir,
        writtenAssets,
        options.previousFiles,
      );
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "[evjs] Webpack server public asset transaction failed and rollback also failed.",
        { cause: error },
      );
    }
    throw error;
  }

  options.ownedFiles.clear();
  for (const [asset, contents] of options.nextOwnership) {
    options.ownedFiles.set(asset, Buffer.from(contents));
  }
}

async function rollbackPublicAssetFiles(
  cwd: string,
  clientDir: string,
  changedAssets: ReadonlySet<string>,
  previousFiles: ReadonlyMap<string, Buffer>,
): Promise<void> {
  const changed = [...changedAssets].sort(
    (left, right) => right.split("/").length - left.split("/").length,
  );
  for (const asset of changed) {
    await removeOwnedOutputFile(
      cwd,
      resolveWebpackPublicAssetPath(clientDir, asset),
      `Webpack server public asset rollback "${asset}"`,
    );
  }
  await pruneEmptyAssetDirectories(clientDir, changed);
  const previous = [...previousFiles].sort(
    ([left], [right]) => left.split("/").length - right.split("/").length,
  );
  for (const [asset, contents] of previous) {
    await writeOwnedOutputFile(
      cwd,
      resolveWebpackPublicAssetPath(clientDir, asset),
      contents,
      `Webpack server public asset rollback "${asset}"`,
    );
  }
}

async function pruneEmptyAssetDirectories(
  clientDir: string,
  assets: readonly string[],
): Promise<void> {
  const directories = new Set<string>();
  for (const asset of assets) {
    let directory = path.dirname(
      resolveWebpackPublicAssetPath(clientDir, asset),
    );
    while (
      directory !== clientDir &&
      isStrictDescendantPath(path.relative(clientDir, directory))
    ) {
      directories.add(directory);
      directory = path.dirname(directory);
    }
  }
  for (const directory of [...directories].sort(
    (left, right) => right.length - left.length,
  )) {
    try {
      const state = await fs.promises.lstat(directory);
      if (!state.isDirectory() || state.isSymbolicLink()) continue;
      await fs.promises.rmdir(directory);
    } catch (error) {
      if (!isMissingPathError(error) && !isDirectoryNotEmptyError(error)) {
        throw error;
      }
    }
  }
}

function missingClientAssetError(asset: string): Error {
  return new Error(
    `[evjs] Client stats claim Webpack asset "${asset}", but it is missing from the client output directory.`,
  );
}

function resolveWebpackPublicAssetPath(rootDir: string, asset: string): string {
  const relative = asset.replace(/^\.\//u, "");
  const portable = assertPortableRelativeArtifactPath(
    relative,
    `Webpack server public asset ${JSON.stringify(asset)}`,
  );
  return path.resolve(rootDir, ...portable.split("/"));
}

async function inspectPath(file: string): Promise<fs.Stats | undefined> {
  try {
    return await fs.promises.lstat(file);
  } catch (error) {
    if (isMissingPathError(error) || isNotDirectoryError(error))
      return undefined;
    throw error;
  }
}

async function readOwnedWebpackPublicAsset(
  cwd: string,
  outputDir: string,
  source: string,
  field: string,
  outputLabel: string,
): Promise<Buffer> {
  const [projectRoot, outputRoot, stats] = await Promise.all([
    fs.promises.realpath(cwd),
    fs.promises.realpath(outputDir),
    fs.promises.lstat(source),
  ]);
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    !isSameOrDescendantPath(path.relative(projectRoot, outputRoot))
  ) {
    throw new Error(
      `[evjs] ${field} must be a regular file inside the project ${outputLabel}.`,
    );
  }

  const realSource = await fs.promises.realpath(source);
  if (!isStrictDescendantPath(path.relative(outputRoot, realSource))) {
    throw new Error(`[evjs] ${field} must resolve inside the ${outputLabel}.`);
  }
  return fs.promises.readFile(realSource);
}

function isStrictDescendantPath(relativePath: string): boolean {
  return relativePath !== "" && isSameOrDescendantPath(relativePath);
}

function isSameOrDescendantPath(relativePath: string): boolean {
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function isNotDirectoryError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOTDIR";
}

function isDirectoryNotEmptyError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOTEMPTY";
}

export const __testing = {
  matchEmittedCssAsset,
  readCssUrlReferences,
};
