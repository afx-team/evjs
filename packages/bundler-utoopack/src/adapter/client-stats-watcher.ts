import fs from "node:fs";
import path from "node:path";
import { watch } from "chokidar";

export async function readClientStatsVersion(
  statsPath: string,
): Promise<string | undefined> {
  try {
    const stats = await fs.promises.stat(statsPath, { bigint: true });
    return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export interface ClientStatsWatcher {
  advance(version: string | undefined): void;
  close(): Promise<void>;
}

/** Watch the directory so atomic replacement does not detach the listener. */
export function watchClientStats(options: {
  statsPath: string;
  initialVersion: string | undefined;
  onChange(): Promise<void>;
  onError(error: unknown): void;
}): ClientStatsWatcher {
  const statsPath = path.resolve(options.statsPath);
  let version = options.initialVersion;
  let closed = false;
  let scheduled = false;
  let queue = Promise.resolve();
  let closePromise: Promise<void> | undefined;
  const watcher = watch(path.dirname(statsPath), {
    atomic: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
    depth: 0,
    disableGlobbing: true,
    ignoreInitial: true,
  });

  function schedule(): void {
    if (closed || scheduled) return;
    scheduled = true;
    queue = queue.then(async () => {
      scheduled = false;
      if (closed) return;
      try {
        const nextVersion = await readClientStatsVersion(statsPath);
        if (!nextVersion || nextVersion === version || closed) return;
        // Only a successful publication advances the baseline. Incomplete
        // stats can then recover on the next real write without losing it.
        await options.onChange();
      } catch (error) {
        if (!closed) options.onError(error);
      }
    });
  }

  const onFileChange = (file: string) => {
    if (path.resolve(file) === statsPath) schedule();
  };
  watcher.on("add", onFileChange);
  watcher.on("change", onFileChange);
  watcher.on("error", (error) => {
    if (!closed) options.onError(error);
  });
  // Catch writes between the initial publication and watcher attachment.
  watcher.on("ready", schedule);

  return {
    advance(nextVersion) {
      version = nextVersion;
    },
    close() {
      closePromise ??= (async () => {
        closed = true;
        await watcher.close();
        await queue;
      })();
      return closePromise;
    },
  };
}
