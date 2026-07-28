import fs from "node:fs/promises";
import path from "node:path";

/** Absolute framework output paths resolved against the active project cwd. */
export interface ResolvedBuildOutputPaths {
  rootDir: string;
  clientDir: string;
  serverDir: string;
}

/**
 * Fail closed before a bundler recursively cleans framework-owned output.
 *
 * Lexical config validation is not enough because an in-project path can pass
 * through a symbolic link whose target lives outside the project.
 */
export async function assertSafeBuildOutputPaths(
  cwd: string,
  outputPaths: ResolvedBuildOutputPaths,
): Promise<void> {
  await assertProjectOutputPathWithoutSymlinks(
    cwd,
    "plan.distDir",
    outputPaths.rootDir,
  );
  await assertProjectOutputPathWithoutSymlinks(
    cwd,
    "output.client",
    outputPaths.clientDir,
  );
  await assertProjectOutputPathWithoutSymlinks(
    cwd,
    "output.server",
    outputPaths.serverDir,
  );
  assertResolvedBuildOutputOwnership(cwd, outputPaths);
}

/** Validate one effective bundler output owned by the active BuildPlan. */
export async function assertSafeBuildOwnedOutputPath(
  cwd: string,
  field: string,
  rootDir: string,
  outputPath: string,
): Promise<void> {
  await assertProjectOutputPathWithoutSymlinks(cwd, "plan.distDir", rootDir);
  await assertProjectOutputPathWithoutSymlinks(cwd, field, outputPath);

  const projectRoot = path.resolve(cwd);
  const absoluteRoot = path.resolve(cwd, rootDir);
  const absoluteOutput = path.resolve(cwd, outputPath);
  if (!isStrictDescendantPath(path.relative(absoluteRoot, absoluteOutput))) {
    throw new Error(
      `[evjs] ${field} output directory "${formatProjectRelativePath(path.relative(projectRoot, absoluteOutput))}" must be a strict descendant of plan.distDir "${formatProjectRelativePath(path.relative(projectRoot, absoluteRoot))}" so bundler output stays inside framework-owned output.`,
    );
  }
}

/** Validate one effective recursive-clean path, including plugin overrides. */
export async function assertSafeBundlerCleanOutputPath(
  cwd: string,
  field: string,
  rootDir: string,
  outputPath: string,
): Promise<void> {
  await assertSafeBuildOwnedOutputPath(cwd, field, rootDir, outputPath);
}

async function assertProjectOutputPathWithoutSymlinks(
  cwd: string,
  field: string,
  outputPath: string,
): Promise<void> {
  const projectRoot = path.resolve(cwd);
  const absoluteOutputPath = path.resolve(cwd, outputPath);
  const relativeOutputPath = path.relative(projectRoot, absoluteOutputPath);
  const displayOutputPath = formatProjectRelativePath(relativeOutputPath);

  if (!isStrictDescendantPath(relativeOutputPath)) {
    throw new Error(
      `[evjs] ${field} output directory "${displayOutputPath}" must be a project-relative descendant of the project root.`,
    );
  }

  let existingAncestor = projectRoot;
  let candidate = projectRoot;
  for (const segment of relativeOutputPath.split(path.sep)) {
    candidate = path.join(candidate, segment);
    let stats: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stats = await fs.lstat(candidate);
    } catch (error) {
      if (isMissingPathError(error)) break;
      throw unsafeInspectionError(field, displayOutputPath);
    }

    if (stats.isSymbolicLink()) {
      const symlinkPath = formatProjectRelativePath(
        path.relative(projectRoot, candidate),
      );
      throw new Error(
        `[evjs] ${field} output directory "${displayOutputPath}" must not traverse symbolic link "${symlinkPath}".`,
      );
    }
    existingAncestor = candidate;
  }

  try {
    const [realProjectRoot, realExistingAncestor] = await Promise.all([
      fs.realpath(projectRoot),
      fs.realpath(existingAncestor),
    ]);
    const realRelativePath = path.relative(
      realProjectRoot,
      realExistingAncestor,
    );
    if (!isSameOrDescendantPath(realRelativePath)) {
      throw new Error(
        `[evjs] ${field} output directory "${displayOutputPath}" must resolve inside the project root.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("[evjs]")) {
      throw error;
    }
    throw unsafeInspectionError(field, displayOutputPath);
  }
}

function isStrictDescendantPath(relativePath: string): boolean {
  return relativePath !== "" && isSameOrDescendantPath(relativePath);
}

function assertResolvedBuildOutputOwnership(
  cwd: string,
  outputPaths: ResolvedBuildOutputPaths,
): void {
  const projectRoot = path.resolve(cwd);
  const rootDir = path.resolve(cwd, outputPaths.rootDir);
  const ownedOutputs = [
    ["output.client", path.resolve(cwd, outputPaths.clientDir)],
    ["output.server", path.resolve(cwd, outputPaths.serverDir)],
  ] as const;

  for (const [field, outputPath] of ownedOutputs) {
    if (!isStrictDescendantPath(path.relative(rootDir, outputPath))) {
      throw new Error(
        `[evjs] ${field} output directory "${formatProjectRelativePath(path.relative(projectRoot, outputPath))}" must be a strict descendant of plan.distDir "${formatProjectRelativePath(path.relative(projectRoot, rootDir))}" so recursive cleaning stays inside framework-owned output.`,
      );
    }
  }

  const clientToServer = path.relative(
    path.resolve(cwd, outputPaths.clientDir),
    path.resolve(cwd, outputPaths.serverDir),
  );
  const serverToClient = path.relative(
    path.resolve(cwd, outputPaths.serverDir),
    path.resolve(cwd, outputPaths.clientDir),
  );
  if (
    isSameOrDescendantPath(clientToServer) ||
    isSameOrDescendantPath(serverToClient)
  ) {
    throw new Error(
      "[evjs] output.client and output.server must be separate, non-nested directories.",
    );
  }
}

function isSameOrDescendantPath(relativePath: string): boolean {
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

function formatProjectRelativePath(relativePath: string): string {
  if (relativePath === "") return ".";
  if (path.isAbsolute(relativePath)) return "<outside-project>";
  return relativePath.split(path.sep).join("/");
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function unsafeInspectionError(field: string, relativePath: string): Error {
  return new Error(
    `[evjs] ${field} output directory "${relativePath}" could not be verified safely.`,
  );
}
