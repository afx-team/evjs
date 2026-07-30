import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type OwnedOutputFileMutation =
  | {
      type: "write";
      filePath: string;
      contents: string | Uint8Array;
      field: string;
    }
  | {
      type: "remove";
      filePath: string;
      field: string;
    };

type OwnedOutputFileSnapshot =
  | { exists: false }
  | { exists: true; contents: Uint8Array };

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

/**
 * Apply a set of owned-file mutations as one transaction. Every destination is
 * validated and snapshotted before the first mutation. If a later mutation
 * fails, all successfully changed files are restored to their prior contents.
 */
export async function applyOwnedOutputFileTransaction(
  rootDir: string,
  mutations: readonly OwnedOutputFileMutation[],
): Promise<void> {
  const snapshots = new Map<string, OwnedOutputFileSnapshot>();
  const fields = new Map<string, string>();

  for (const mutation of mutations) {
    const destination = path.resolve(mutation.filePath);
    if (!snapshots.has(destination)) {
      snapshots.set(
        destination,
        await snapshotOwnedOutputFile(rootDir, destination, mutation.field),
      );
      fields.set(destination, mutation.field);
    }
  }

  const changedDestinations: string[] = [];
  const changed = new Set<string>();
  try {
    for (const mutation of mutations) {
      if (mutation.type === "write") {
        await writeOwnedOutputFile(
          rootDir,
          mutation.filePath,
          mutation.contents,
          mutation.field,
        );
      } else {
        await removeOwnedOutputFile(rootDir, mutation.filePath, mutation.field);
      }

      const destination = path.resolve(mutation.filePath);
      if (!changed.has(destination)) {
        changed.add(destination);
        changedDestinations.push(destination);
      }
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const destination of changedDestinations.reverse()) {
      const snapshot = snapshots.get(destination);
      const field = fields.get(destination);
      if (!snapshot || !field) continue;
      try {
        if (snapshot.exists) {
          await writeOwnedOutputFile(
            rootDir,
            destination,
            snapshot.contents,
            field,
          );
        } else {
          await removeOwnedOutputFile(rootDir, destination, field);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "[evjs] Failed to roll back framework-owned output files.",
      );
    }
    throw error;
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

async function snapshotOwnedOutputFile(
  rootDir: string,
  filePath: string,
  field: string,
): Promise<OwnedOutputFileSnapshot> {
  const absoluteRoot = path.resolve(rootDir);
  const destination = path.resolve(filePath);
  assertStrictDescendant(absoluteRoot, destination, field);
  if (!(await assertExistingOwnedDirectory(absoluteRoot, field))) {
    return { exists: false };
  }

  const relativeParent = path.relative(absoluteRoot, path.dirname(destination));
  let current = absoluteRoot;
  for (const segment of relativeParent ? relativeParent.split(path.sep) : []) {
    current = path.join(current, segment);
    if (!(await assertExistingOwnedDirectory(current, field))) {
      return { exists: false };
    }
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
    return { exists: true, contents: await fs.readFile(destination) };
  } catch (error) {
    if (isMissingPathError(error)) return { exists: false };
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
