import fs from "node:fs/promises";
import path from "node:path";

/**
 * Resolve the path that a deployment runtime must actually consume. The root
 * must be a pinned real path. Lexical containment is checked before touching
 * the candidate; its real path is then checked against the pinned root so a
 * replaced root or symbolic link cannot redirect later use outside it.
 */
export async function resolveContainedRealPath(
  realRootPath: string,
  candidatePath: string,
): Promise<string | undefined> {
  const root = path.resolve(realRootPath);
  const candidate = path.resolve(candidatePath);
  if (!isStrictDescendantPath(path.relative(root, candidate))) {
    return undefined;
  }

  const realCandidate = await fs.realpath(candidate);
  if (!isStrictDescendantPath(path.relative(root, realCandidate))) {
    return undefined;
  }
  return realCandidate;
}

function isStrictDescendantPath(relativePath: string): boolean {
  return (
    relativePath !== "" &&
    !path.isAbsolute(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`)
  );
}
