import fs from "node:fs";

export interface UtoopackStatsMonitor {
  ready: Promise<void>;
  close(): Promise<void>;
}

interface StartUtoopackStatsMonitorOptions {
  statsPaths: readonly string[];
  initialVersion: string | undefined;
  initialActivationVersion?: string;
  activateInitial?: boolean;
  failInitialErrors?: boolean;
  publish(): Promise<{
    published: boolean;
    statsVersion: string | undefined;
    activationVersion: string | undefined;
  }>;
  activate?(): Promise<void>;
  onError(error: unknown, phase: "publish" | "activate"): void;
}

const POLL_INTERVAL_MS = 100;

export async function readUtoopackStatsVersion(
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

export async function readUtoopackStatsSetVersion(
  statsPaths: readonly string[],
): Promise<string | undefined> {
  const versions = await Promise.all(statsPaths.map(readUtoopackStatsVersion));
  return versions.every((version) => version === undefined)
    ? undefined
    : JSON.stringify(versions);
}

/**
 * Track completed Utoopack rebuilds.
 *
 * `@utoo/pack` invokes `onReady` for the initial build and server startup, not
 * later completed rebuilds. Poll the authoritative `stats.json` so evjs can
 * relink build facts. Server builds also provide `activate` to refresh their
 * runtime after a successful publication; client-only builds stop at publish.
 */
export function startUtoopackStatsMonitor(
  options: StartUtoopackStatsMonitorOptions,
): UtoopackStatsMonitor {
  let currentVersion = options.initialVersion;
  let currentActivationVersion = options.initialActivationVersion;
  let activationPending =
    options.activateInitial === true && options.activate !== undefined;
  let pollPending = false;
  let running: Promise<void> | undefined;
  let closed = false;
  let initialFailure: { error: unknown } | undefined;

  async function processChange(
    failOnError: boolean,
  ): Promise<"complete" | "failed"> {
    if (closed) return "complete";
    let nextVersion: string | undefined;
    try {
      nextVersion = await readUtoopackStatsSetVersion(options.statsPaths);
    } catch (error) {
      options.onError(error, "publish");
      if (failOnError) initialFailure = { error };
      return "failed";
    }
    if (closed) return "complete";

    let publishedSnapshot = false;
    if (nextVersion && nextVersion !== currentVersion) {
      try {
        const publication = await options.publish();
        if (closed) return "complete";
        // Do not activate an older publication while admission for a newer
        // authoritative snapshot is suspended.
        if (!publication.published) return "complete";
        // Publication is the commit boundary. Activation failures retry only
        // activation for the stats snapshot that was actually linked.
        currentVersion = publication.statsVersion;
        publishedSnapshot = true;
        activationPending ||=
          options.activate !== undefined &&
          publication.activationVersion !== currentActivationVersion;
        currentActivationVersion = publication.activationVersion;
      } catch (error) {
        options.onError(error, "publish");
        if (failOnError) initialFailure = { error };
        return "failed";
      }
    }

    if (!publishedSnapshot && !activationPending) return "complete";

    // A compilation can finish while facts are being linked. Recheck the
    // complete stats set after every publication so its newer version remains
    // dirty even for client-only builds, and before activation so a newer
    // server bundle is never paired with an older framework snapshot.
    let latestVersion: string | undefined;
    try {
      latestVersion = await readUtoopackStatsSetVersion(options.statsPaths);
    } catch (error) {
      options.onError(error, "publish");
      if (failOnError) initialFailure = { error };
      return "failed";
    }
    if (closed) return "complete";
    if (latestVersion !== currentVersion) {
      // A defined version is a completed rebuild and can be consumed
      // immediately. An absent version can be an atomic-replacement gap; the
      // next interval retries it without spinning.
      if (latestVersion !== undefined) pollPending = true;
      return "complete";
    }

    if (!activationPending) return "complete";
    if (closed) return "complete";
    try {
      await options.activate?.();
      activationPending = false;
    } catch (error) {
      options.onError(error, "activate");
      if (failOnError) initialFailure = { error };
      return "failed";
    }
    return "complete";
  }

  async function drainPolls(failOnError: boolean): Promise<void> {
    while (pollPending && !closed) {
      pollPending = false;
      const result = await processChange(failOnError);
      if (result === "failed" && failOnError) {
        pollPending = false;
        return;
      }
    }
  }

  function finishRun(task: Promise<void>): void {
    if (running !== task) return;
    running = undefined;
    if (pollPending && !closed) {
      void schedulePoll();
    }
  }

  function schedulePoll(failOnError = false): Promise<void> {
    if (closed) return Promise.resolve();
    pollPending = true;
    if (running) return running;

    const task = drainPolls(failOnError);
    running = task;
    void task.then(
      () => finishRun(task),
      () => finishRun(task),
    );
    return task;
  }

  // Close the attach/read race after the initial facts were consumed. Polling
  // also avoids fs.watch descriptor exhaustion and atomic-replacement gaps.
  const initialRun = schedulePoll(options.failInitialErrors === true);
  const ready = initialRun.then(() => {
    if (initialFailure) throw initialFailure.error;
  });
  const interval = setInterval(() => {
    void schedulePoll();
  }, POLL_INTERVAL_MS);

  return {
    ready,
    async close() {
      if (closed) return;
      closed = true;
      pollPending = false;
      clearInterval(interval);
      await running;
    },
  };
}
