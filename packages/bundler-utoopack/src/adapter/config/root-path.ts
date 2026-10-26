import fs from "node:fs";
import path from "node:path";

/** Resolve an explicitly trusted source scope without changing project-relative paths. */
export function resolveUtoopackRootPath(
  rootPath: string | undefined,
  cwd: string,
): string | undefined {
  if (rootPath === undefined) return undefined;
  const requestedRoot = path.resolve(cwd, rootPath);
  let root: string;
  try {
    root = fs.realpathSync(requestedRoot);
    if (!fs.statSync(root).isDirectory()) throw new Error("Not a directory");
  } catch {
    throw new Error(
      `[evjs] rootPath must reference an existing directory: ${requestedRoot}`,
    );
  }
  if (root === path.parse(root).root) {
    throw new Error("[evjs] rootPath must not be the filesystem root.");
  }
  const application = fs.realpathSync(cwd);
  const relative = path.relative(root, application);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `[evjs] rootPath "${root}" must contain the application "${application}".`,
    );
  }
  return root;
}
