import fs from "node:fs";
import path from "node:path";
import { watch } from "chokidar";

export async function readClientStatsVersion(
  statsPath: string | undefined,
): Promise<string | undefined> {
  if (!statsPath) return undefined;
  try {
    const stats = await fs.promises.stat(statsPath, { bigint: true });
    return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Notify the host queue when settled client stats change, including startup. */
export function watchClientStats(
  statsPath: string,
  onChange: () => void,
  onError: (error: unknown) => void,
) {
  const resolvedPath = path.resolve(statsPath);
  const watcher = watch(path.dirname(resolvedPath), {
    atomic: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    depth: 0,
    disableGlobbing: true,
    ignoreInitial: true,
  });
  const onFile = (file: string) => {
    if (path.resolve(file) === resolvedPath) onChange();
  };
  watcher.on("add", onFile);
  watcher.on("change", onFile);
  watcher.on("ready", onChange);
  watcher.on("error", onError);
  return watcher;
}
