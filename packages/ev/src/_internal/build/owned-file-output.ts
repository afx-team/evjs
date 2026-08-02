import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Atomically write a framework-owned file without escaping its output tree or
 * following pre-existing symbolic links in the destination path.
 */
export async function writeOwnedOutputFile(
  rootDir: string,
  filePath: string,
  contents: string | Uint8Array,
  field: string,
): Promise<void> {
  const absoluteRoot = path.resolve(rootDir);
  const destination = path.resolve(filePath);
  const relativeDestination = path.relative(absoluteRoot, destination);
  if (!isStrictDescendantPath(relativeDestination)) {
    throw new Error(
      `[evjs] ${field} must stay inside its framework-owned output directory.`,
    );
  }

  await ensureOwnedDirectory(absoluteRoot, path.dirname(destination), field);
  await assertSafeDestination(destination, field);

  const temporary = path.join(
    path.dirname(destination),
    `.evjs-${process.pid}-${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporary, contents, { flag: "wx" });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

/** Remove one owned leaf without traversing a symbolic-link ancestor. */
export async function removeOwnedOutputFile(
  rootDir: string,
  filePath: string,
  field: string,
): Promise<void> {
  const absoluteRoot = path.resolve(rootDir);
  const destination = path.resolve(filePath);
  assertStrictDescendant(absoluteRoot, destination, field);
  if (!(await assertExistingOwnedDirectory(absoluteRoot, field))) return;

  const relativeParent = path.relative(absoluteRoot, path.dirname(destination));
  let current = absoluteRoot;
  for (const segment of relativeParent ? relativeParent.split(path.sep) : []) {
    current = path.join(current, segment);
    if (!(await assertExistingOwnedDirectory(current, field))) return;
  }

  try {
    const stats = await fs.lstat(destination);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      throw new Error(`[evjs] ${field} output path must be a file.`);
    }
    await fs.rm(destination, { force: true });
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
}

export interface OwnedOutputFileSnapshot {
  readonly contents: Buffer | undefined;
  readonly missingDirectories: readonly string[];
}

/** Snapshot one owned regular file and the parent directories it may create. */
export async function snapshotOwnedOutputFile(
  rootDir: string,
  filePath: string,
  field: string,
): Promise<OwnedOutputFileSnapshot> {
  const absoluteRoot = path.resolve(rootDir);
  const destination = path.resolve(filePath);
  assertStrictDescendant(absoluteRoot, destination, field);
  if (!(await assertExistingOwnedDirectory(absoluteRoot, field))) {
    return { contents: undefined, missingDirectories: [] };
  }

  const relativeParent = path.relative(absoluteRoot, path.dirname(destination));
  let current = absoluteRoot;
  const parentSegments = relativeParent ? relativeParent.split(path.sep) : [];
  const missingDirectories: string[] = [];
  for (const [index, segment] of parentSegments.entries()) {
    current = path.join(current, segment);
    if (await assertExistingOwnedDirectory(current, field)) continue;
    missingDirectories.push(current);
    for (const missingSegment of parentSegments.slice(index + 1)) {
      current = path.join(current, missingSegment);
      missingDirectories.push(current);
    }
    return { contents: undefined, missingDirectories };
  }

  try {
    const stats = await fs.lstat(destination);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `[evjs] ${field} must not overwrite a symbolic-link output file.`,
      );
    }
    if (!stats.isFile()) {
      throw new Error(`[evjs] ${field} output path must be a file.`);
    }
    return {
      contents: await fs.readFile(destination),
      missingDirectories,
    };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { contents: undefined, missingDirectories };
    }
    throw error;
  }
}

/** Remove a known-new owned directory only when it is still an empty directory. */
export async function removeOwnedOutputDirectoryIfEmpty(
  rootDir: string,
  directory: string,
  field: string,
): Promise<void> {
  const absoluteRoot = path.resolve(rootDir);
  const destination = path.resolve(directory);
  assertStrictDescendant(absoluteRoot, destination, field);
  if (!(await assertExistingOwnedDirectory(absoluteRoot, field))) return;

  const relativeParent = path.relative(absoluteRoot, path.dirname(destination));
  let current = absoluteRoot;
  for (const segment of relativeParent ? relativeParent.split(path.sep) : []) {
    current = path.join(current, segment);
    if (!(await assertExistingOwnedDirectory(current, field))) return;
  }

  try {
    const stats = await fs.lstat(destination);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`[evjs] ${field} output path must be a directory.`);
    }
    await fs.rmdir(destination);
  } catch (error) {
    if (isMissingPathError(error) || isNonEmptyDirectoryError(error)) return;
    throw error;
  }
}

/** Remove one symbolic-link leaf without following it or a symbolic ancestor. */
export async function removeOwnedOutputSymbolicLink(
  rootDir: string,
  outputPath: string,
  field: string,
): Promise<void> {
  const absoluteRoot = path.resolve(rootDir);
  const destination = path.resolve(outputPath);
  assertStrictDescendant(absoluteRoot, destination, field);
  if (!(await assertExistingOwnedDirectory(absoluteRoot, field))) return;

  const relativeParent = path.relative(absoluteRoot, path.dirname(destination));
  let current = absoluteRoot;
  for (const segment of relativeParent ? relativeParent.split(path.sep) : []) {
    current = path.join(current, segment);
    if (!(await assertExistingOwnedDirectory(current, field))) return;
  }

  try {
    const stats = await fs.lstat(destination);
    if (stats.isSymbolicLink()) {
      await fs.rm(destination);
    }
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
}

/** Synchronous counterpart used by process-exit cleanup paths. */
export function removeOwnedOutputFileSync(
  rootDir: string,
  filePath: string,
  field: string,
): void {
  const absoluteRoot = path.resolve(rootDir);
  const destination = path.resolve(filePath);
  assertStrictDescendant(absoluteRoot, destination, field);
  if (!assertExistingOwnedDirectorySync(absoluteRoot, field)) return;

  const relativeParent = path.relative(absoluteRoot, path.dirname(destination));
  let current = absoluteRoot;
  for (const segment of relativeParent ? relativeParent.split(path.sep) : []) {
    current = path.join(current, segment);
    if (!assertExistingOwnedDirectorySync(current, field)) return;
  }

  try {
    const stats = fsSync.lstatSync(destination);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      throw new Error(`[evjs] ${field} output path must be a file.`);
    }
    fsSync.rmSync(destination, { force: true });
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
}

async function ensureOwnedDirectory(
  rootDir: string,
  targetDir: string,
  field: string,
): Promise<void> {
  await assertDirectory(rootDir, field);

  const relative = path.relative(rootDir, targetDir);
  let current = rootDir;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    try {
      await fs.mkdir(current);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
    await assertDirectory(current, field);
  }
}

async function assertDirectory(
  directory: string,
  field: string,
): Promise<void> {
  const stats = await fs.lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      `[evjs] ${field} must not traverse symbolic links or non-directory output ancestors.`,
    );
  }
}

async function assertExistingOwnedDirectory(
  directory: string,
  field: string,
): Promise<boolean> {
  try {
    await assertDirectory(directory, field);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function assertExistingOwnedDirectorySync(
  directory: string,
  field: string,
): boolean {
  try {
    const stats = fsSync.lstatSync(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(
        `[evjs] ${field} must not traverse symbolic links or non-directory output ancestors.`,
      );
    }
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

async function assertSafeDestination(
  destination: string,
  field: string,
): Promise<void> {
  try {
    const stats = await fs.lstat(destination);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `[evjs] ${field} must not overwrite a symbolic-link output file.`,
      );
    }
    if (stats.isDirectory()) {
      throw new Error(`[evjs] ${field} output path must be a file.`);
    }
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
}

function isStrictDescendantPath(relativePath: string): boolean {
  return (
    relativePath !== "" &&
    !path.isAbsolute(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`)
  );
}

function assertStrictDescendant(
  rootDir: string,
  destination: string,
  field: string,
): void {
  if (!isStrictDescendantPath(path.relative(rootDir, destination))) {
    throw new Error(
      `[evjs] ${field} must stay inside its framework-owned output directory.`,
    );
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function isNonEmptyDirectoryError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EEXIST" || code === "ENOTEMPTY";
}
