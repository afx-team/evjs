import fs from "node:fs";
import path from "node:path";
import type { ResolvedConfig } from "../../config/index.js";
import { CANONICAL_SERVER_ROUTE_ROOT } from "./server-route-conventions.js";
import { isInsideCwd, isRealPathInsideCwd } from "./utils.js";

export interface ServerRouteWatchState {
  dependencies: string[];
  unsafeBoundary?: string;
}

export function listConfigDependencyFiles(cwd: string): string[] {
  return ["ev.config.ts", "ev.config.js", "ev.config.mjs"]
    .map((file) => path.resolve(cwd, file))
    .filter((file) => fs.existsSync(file));
}

export function watchFiles(
  files: string[],
  onChange: (file: string) => void,
  recoverableMissingTargets: ReadonlySet<string> = new Set(),
): () => void {
  const watchers: fs.FSWatcher[] = [];

  for (const file of [...new Set(files)]) {
    const targetExists = fs.existsSync(file);
    const recoverMissingTarget = recoverableMissingTargets.has(file);
    const watchTarget =
      targetExists || !recoverMissingTarget
        ? file
        : findNearestExistingAncestor(file);
    if (!watchTarget) continue;
    try {
      watchers.push(
        fs.watch(watchTarget, (_eventType, filename) => {
          if (
            !targetExists &&
            recoverMissingTarget &&
            !watchEventCanCreateTarget(watchTarget, file, filename)
          ) {
            return;
          }
          onChange(file);
        }),
      );
    } catch {
      // The file may have been removed between graph analysis and watcher
      // setup. The next config or graph change will rebuild the watch list.
    }
  }

  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}

export async function collectServerRouteWatchState<TBundlerCfg>(
  cwd: string,
  config: ResolvedConfig<TBundlerCfg>,
): Promise<ServerRouteWatchState> {
  if (!config.conventions) return { dependencies: [] };
  const root = path.resolve(cwd, CANONICAL_SERVER_ROUTE_ROOT);
  if (!isInsideCwd(cwd, root)) return { dependencies: [] };

  const directories = new Set([root]);
  try {
    if (!(await isRealPathInsideCwd(cwd, root))) {
      const fallback = await findSafeLexicalWatchFallback(cwd, root);
      return {
        dependencies: fallback ? [fallback.ancestor] : [],
        ...(fallback ? { unsafeBoundary: fallback.boundary } : {}),
      };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    return { dependencies: [...directories] };
  }

  async function visit(current: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      directories.add(absolute);
      await visit(absolute);
    }
  }

  await visit(root);
  return { dependencies: [...directories].sort() };
}

function findNearestExistingAncestor(target: string): string | undefined {
  let current = path.dirname(target);
  while (current !== path.dirname(current)) {
    if (fs.existsSync(current)) return current;
    current = path.dirname(current);
  }
  return fs.existsSync(current) ? current : undefined;
}

function watchEventCanCreateTarget(
  watchedAncestor: string,
  target: string,
  filename: string | Buffer | null,
): boolean {
  if (filename === null) return true;
  const changed = path.resolve(watchedAncestor, filename.toString());
  return isInsideCwd(target, changed) || isInsideCwd(changed, target);
}

async function findSafeLexicalWatchFallback(
  cwd: string,
  target: string,
): Promise<{ ancestor: string; boundary: string } | undefined> {
  let boundary = target;
  let current = path.dirname(target);
  while (isInsideCwd(cwd, current)) {
    try {
      if (await isRealPathInsideCwd(cwd, current)) {
        return { ancestor: current, boundary };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    if (current === cwd) return undefined;
    boundary = current;
    current = path.dirname(current);
  }
  return undefined;
}
