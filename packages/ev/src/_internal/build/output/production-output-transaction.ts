import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { BuildPlan } from "@evjs/shared/manifest";
import { resolveBuildOutputPaths } from "./build-output-paths.js";
import {
  assertSafeBuildOutputPaths,
  type ResolvedBuildOutputPaths,
} from "./output-path-safety.js";

export interface ProductionOutputTransaction {
  /** A private BuildPlan projection that directs the bundler into staging. */
  readonly buildPlan: BuildPlan;
  /** Filesystem paths used while linking and emitting the staged output. */
  readonly outputPaths: ResolvedBuildOutputPaths;
  /** Atomically replace the canonical dist tree with the completed staging tree. */
  publish(): Promise<void>;
  /** Remove only the private staging tree. */
  rollback(): Promise<void>;
}

interface OutputRootIdentity {
  dev: number;
  ino: number;
}

/**
 * Keep production compilation and framework publication outside the canonical
 * dist tree until every pre-afterBuild phase succeeds. The public BuildPlan
 * remains canonical; only this private projection rebases owned output paths.
 */
export async function createProductionOutputTransaction(
  cwd: string,
  plan: BuildPlan,
): Promise<ProductionOutputTransaction> {
  const canonicalPaths = resolveBuildOutputPaths(cwd, plan);
  await assertSafeBuildOutputPaths(cwd, canonicalPaths);
  const originalRoot = await readOutputRootIdentity(
    canonicalPaths.rootDir,
    "plan.distDir",
  );
  const stagingRoot = path.join(
    path.dirname(canonicalPaths.rootDir),
    `.${path.basename(canonicalPaths.rootDir)}.evjs-${randomUUID()}.candidate`,
  );
  const buildPlan = rebaseBuildPlan(cwd, plan, canonicalPaths, stagingRoot);
  const outputPaths = resolveBuildOutputPaths(cwd, buildPlan);
  await assertSafeBuildOutputPaths(cwd, outputPaths);

  let settled = false;
  return {
    buildPlan,
    outputPaths,
    async publish() {
      if (settled) return;
      await assertSafeBuildOutputPaths(cwd, canonicalPaths);
      await assertSafeBuildOutputPaths(cwd, outputPaths);
      await assertOutputRootIdentity(
        canonicalPaths.rootDir,
        originalRoot,
        "plan.distDir",
      );
      await assertOutputDirectory(outputPaths.rootDir, "staged plan.distDir");

      const backupRoot = originalRoot
        ? path.join(
            path.dirname(canonicalPaths.rootDir),
            `.${path.basename(canonicalPaths.rootDir)}.evjs-${randomUUID()}.previous`,
          )
        : undefined;
      try {
        if (backupRoot) {
          await fs.rename(canonicalPaths.rootDir, backupRoot);
        }
        try {
          await fs.rename(outputPaths.rootDir, canonicalPaths.rootDir);
        } catch (publishError) {
          if (backupRoot) {
            try {
              await fs.rename(backupRoot, canonicalPaths.rootDir);
            } catch (restoreError) {
              throw new AggregateError(
                [publishError, restoreError],
                "[evjs] Failed to publish staged production output and restore the previous tree.",
                { cause: publishError },
              );
            }
          }
          throw publishError;
        }
        settled = true;
        if (backupRoot) {
          // Canonical output is already complete. Backup cleanup must not turn
          // a successful publication into a reported build failure.
          await removeOutputTree(
            cwd,
            backupRoot,
            "Previous production output",
          ).catch(() => {});
        }
      } catch (error) {
        if (!settled) {
          await removeOutputTree(
            cwd,
            outputPaths.rootDir,
            "Failed staged production output",
          );
        }
        throw error;
      }
    },
    async rollback() {
      if (settled) return;
      settled = true;
      // Canonical output is deliberately outside this transaction until the
      // final swap. If it appears or changes meanwhile, it belongs to another
      // actor and publication fails closed without deleting that tree.
      await removeOutputTree(
        cwd,
        outputPaths.rootDir,
        "Failed staged production output",
      );
    },
  };
}

function rebaseBuildPlan(
  cwd: string,
  plan: BuildPlan,
  canonicalPaths: ResolvedBuildOutputPaths,
  stagingRoot: string,
): BuildPlan {
  const rebase = (outputPath: string): string =>
    toProjectRelativePath(
      cwd,
      path.join(stagingRoot, path.relative(canonicalPaths.rootDir, outputPath)),
    );
  return {
    ...plan,
    distDir: toProjectRelativePath(cwd, stagingRoot),
    output: {
      clientDir: rebase(canonicalPaths.clientDir),
      serverDir: rebase(canonicalPaths.serverDir),
    },
  };
}

function toProjectRelativePath(cwd: string, absolutePath: string): string {
  return path.relative(path.resolve(cwd), absolutePath);
}

async function readOutputRootIdentity(
  outputRoot: string,
  field: string,
): Promise<OutputRootIdentity | undefined> {
  try {
    const stats = await fs.lstat(outputRoot);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`[evjs] ${field} output path must be a directory.`);
    }
    return { dev: stats.dev, ino: stats.ino };
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function assertOutputRootIdentity(
  outputRoot: string,
  expected: OutputRootIdentity | undefined,
  field: string,
): Promise<void> {
  const current = await readOutputRootIdentity(outputRoot, field);
  if (
    current?.dev !== expected?.dev ||
    current?.ino !== expected?.ino ||
    Boolean(current) !== Boolean(expected)
  ) {
    throw new Error(
      `[evjs] ${field} changed while production output was being staged.`,
    );
  }
}

async function assertOutputDirectory(
  outputRoot: string,
  field: string,
): Promise<void> {
  const stats = await fs.lstat(outputRoot);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`[evjs] ${field} output path must be a directory.`);
  }
}

/** Remove an owned tree without following a symbolic-link leaf or ancestor. */
async function removeOutputTree(
  cwd: string,
  outputRoot: string,
  field: string,
): Promise<void> {
  const projectRoot = path.resolve(cwd);
  const destination = path.resolve(outputRoot);
  const relative = path.relative(projectRoot, destination);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`[evjs] ${field} must stay inside the project root.`);
  }

  let current = projectRoot;
  for (const segment of path.dirname(relative).split(path.sep)) {
    if (segment === "." || segment === "") continue;
    current = path.join(current, segment);
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(
          `[evjs] ${field} must not traverse symbolic links or non-directory ancestors.`,
        );
      }
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
  }

  try {
    const stats = await fs.lstat(destination);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      await fs.unlink(destination);
      return;
    }
    await fs.rm(destination, { recursive: true, force: true });
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
