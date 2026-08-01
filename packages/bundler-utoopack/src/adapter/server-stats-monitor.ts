import fs from "node:fs";

export interface UtoopackServerStatsMonitor {
  /** Advance the authoritative baseline after an out-of-band publication. */
  advance(version: string | undefined): void;
  close(): Promise<void>;
}

interface StartUtoopackServerStatsMonitorOptions {
  statsPath: string;
  initialVersion: string | undefined;
  /** Return true only when the observed version was consumed or discarded. */
  onChange(version: string): Promise<boolean>;
  onError(error: unknown): void;
}

const POLL_INTERVAL_MS = 100;

export async function readServerStatsVersion(
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

/**
 * Track completed Utoopack server rebuilds.
 *
 * `@utoo/pack` invokes `onReady` for the initial build and server startup, not
 * later completed server rebuilds. Poll the authoritative server `stats.json`
 * so evjs can relink build facts and refresh its server runtime.
 */
export function startUtoopackServerStatsMonitor(
  options: StartUtoopackServerStatsMonitorOptions,
): UtoopackServerStatsMonitor {
  let currentVersion = options.initialVersion;
  let baselineRevision = 0;
  let closed = false;
  let queue = Promise.resolve();
  const poll = () => {
    queue = queue.then(processChange, processChange);
  };
  const interval = setInterval(poll, POLL_INTERVAL_MS);
  interval.unref();

  async function processChange(): Promise<void> {
    if (closed) return;
    try {
      const nextVersion = await readServerStatsVersion(options.statsPath);
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

  // Close the attach/read race after the initial facts were consumed. Polling
  // also avoids fs.watch descriptor exhaustion and atomic-replacement gaps.
  poll();

  return {
    advance(version) {
      baselineRevision += 1;
      currentVersion = version;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(interval);
      await queue;
    },
  };
}
