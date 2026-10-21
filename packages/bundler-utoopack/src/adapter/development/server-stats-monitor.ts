import fs from "node:fs";
import path from "node:path";
import { assertPortableRelativeArtifactPath } from "@evjs/shared/manifest";

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
    const source: unknown = JSON.parse(
      await fs.promises.readFile(statsPath, "utf-8"),
    );
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("[evjs] Utoopack server stats must be an object.");
    }
    const assets = (source as { assets?: unknown }).assets;
    if (assets !== undefined && !Array.isArray(assets)) {
      throw new Error("[evjs] Utoopack server stats assets must be an array.");
    }
    const names = new Set<string>();
    for (const asset of assets ?? []) {
      const rawName =
        typeof asset === "string"
          ? asset
          : asset && typeof asset === "object"
            ? (asset as { name?: unknown }).name
            : undefined;
      const name = assertPortableRelativeArtifactPath(
        typeof rawName === "string" ? rawName.replace(/^\.\//, "") : rawName,
        `Utoopack server stats asset ${JSON.stringify(rawName)}`,
      );
      if (/\.(?:cjs|mjs|js)$/.test(name)) names.add(name);
    }
    // Shared chunks can change without Utoopack rewriting stats.json. Track
    // only its current inventory so stale output files cannot trigger reloads.
    const versions = await Promise.all(
      [...names].sort().map(async (name) => {
        const asset = await fs.promises.stat(
          path.join(path.dirname(statsPath), name),
          { bigint: true },
        );
        return [name, fileVersion(asset)];
      }),
    );
    return JSON.stringify([fileVersion(stats), versions]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function fileVersion(stats: fs.BigIntStats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`;
}

/**
 * Track completed Utoopack server rebuilds.
 *
 * `@utoo/pack` invokes `onReady` for the initial build and server startup, not
 * later completed server rebuilds. Poll the authoritative server `stats.json`
 * and its emitted JavaScript so evjs can relink build facts and refresh its
 * server runtime even when only a shared chunk was rewritten.
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
