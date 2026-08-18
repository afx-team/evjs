import fs from "node:fs";
import path from "node:path";
import { watch } from "chokidar";

export interface UtoopackStatsWatcher {
  /** Advance the authoritative baseline after an out-of-band publication. */
  advance(version: string | undefined): void;
  close(): Promise<void>;
}

interface StartUtoopackStatsWatcherOptions {
  statsPaths: readonly string[];
  initialVersion: string | undefined;
  /** Return true only when the observed version was consumed or discarded. */
  onChange(version: string): Promise<boolean>;
  onError(error: unknown): void;
}

async function readStatsFileVersion(
  statsPath: string,
): Promise<string | undefined> {
  try {
    const stats = await fs.promises.stat(statsPath, { bigint: true });
    return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function readStatsVersion(
  statsPaths: readonly string[],
): Promise<string | undefined> {
  const versions = await Promise.all(statsPaths.map(readStatsFileVersion));
  if (versions.every((version) => version === undefined)) return undefined;
  return versions
    .map((version, index) => `${index}:${version ?? "missing"}`)
    .join("|");
}

/**
 * Track completed Utoopack client and server rebuilds.
 *
 * `@utoo/pack` invokes `onReady` for the initial build and server startup, not
 * later completed rebuilds. Watch the authoritative `stats.json` files and
 * wait for atomic writes to settle before evjs relinks build facts. A ready
 * scan closes the watcher-attachment race without a perpetual polling task.
 */
export function startUtoopackStatsWatcher(
  options: StartUtoopackStatsWatcherOptions,
): UtoopackStatsWatcher {
  let currentVersion = options.initialVersion;
  let baselineRevision = 0;
  let closed = false;
  let scheduled = false;
  let queue = Promise.resolve();
  const statsPaths = new Set(
    options.statsPaths.map((value) => path.resolve(value)),
  );
  const statsDirectories = [
    ...new Set([...statsPaths].map((value) => path.dirname(value))),
  ];
  const watcher = watch(statsDirectories, {
    atomic: true,
    awaitWriteFinish: {
      stabilityThreshold: 50,
      pollInterval: 10,
    },
    depth: 0,
    disableGlobbing: true,
    ignoreInitial: true,
  });

  function scheduleStatsChange(changedPath: string): void {
    if (statsPaths.has(path.resolve(changedPath))) scheduleChange();
  }

  function scheduleChange(): void {
    if (closed || scheduled) return;
    scheduled = true;
    queue = queue.then(processChange, processChange);
  }

  async function processChange(): Promise<void> {
    scheduled = false;
    if (closed) return;
    try {
      const nextVersion = await readStatsVersion(options.statsPaths);
      if (!nextVersion || nextVersion === currentVersion) return;
      const observedRevision = baselineRevision;
      const consumed = await options.onChange(nextVersion);
      if (consumed && observedRevision === baselineRevision) {
        currentVersion = nextVersion;
      }
    } catch (error) {
      if (!closed) options.onError(error);
    }
  }

  watcher.on("add", scheduleStatsChange);
  watcher.on("change", scheduleStatsChange);
  watcher.on("error", (error) => {
    if (!closed) options.onError(error);
  });
  watcher.on("ready", scheduleChange);

  return {
    advance(version) {
      baselineRevision += 1;
      currentVersion = version;
    },
    async close() {
      if (closed) return;
      closed = true;
      await watcher.close();
      await queue;
    },
  };
}
