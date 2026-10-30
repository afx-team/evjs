import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ClientStatsWatcher,
  readClientStatsVersion,
  watchClientStats,
} from "../src/adapter/client-stats-watcher.js";

const directories: string[] = [];
const watchers: ClientStatsWatcher[] = [];
const releasePending: Array<() => void> = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  releasePending.push(resolve);
  return { promise, resolve };
}

function statsFor(asset: string): string {
  return JSON.stringify({
    entrypoints: { main: { assets: [`${asset}.js`] } },
  });
}

async function createStats(asset = "initial") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-stats-"));
  directories.push(directory);
  const statsPath = path.join(directory, "stats.json");
  await fs.writeFile(statsPath, statsFor(asset));
  return statsPath;
}

function observe(options: Parameters<typeof watchClientStats>[0]) {
  const watcher = watchClientStats(options);
  watchers.push(watcher);
  return watcher;
}

async function waitForPublication(assertion: () => void) {
  await vi.waitFor(assertion, { timeout: 5_000, interval: 10 });
}

afterEach(async () => {
  for (const release of releasePending.splice(0)) release();
  await Promise.all(watchers.splice(0).map((watcher) => watcher.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("client stats watcher", () => {
  it("publishes a change made before the watcher attaches", async () => {
    const statsPath = await createStats();
    const initialVersion = await readClientStatsVersion(statsPath);
    await fs.writeFile(statsPath, statsFor("changed-before-attachment"));
    const published: string[] = [];
    const onError = vi.fn();
    const watcher = observe({
      statsPath,
      initialVersion,
      async onChange() {
        const contents = await fs.readFile(statsPath, "utf8");
        watcher.advance(await readClientStatsVersion(statsPath));
        published.push(contents);
      },
      onError,
    });

    await waitForPublication(() => {
      expect(published).toEqual([statsFor("changed-before-attachment")]);
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps observing stats after an atomic file replacement", async () => {
    const statsPath = await createStats();
    const published: string[] = [];
    const onError = vi.fn();
    const watcher = observe({
      statsPath,
      initialVersion: undefined,
      async onChange() {
        const contents = await fs.readFile(statsPath, "utf8");
        watcher.advance(await readClientStatsVersion(statsPath));
        published.push(contents);
      },
      onError,
    });
    await waitForPublication(() => {
      expect(published).toEqual([statsFor("initial")]);
    });

    const replacement = path.join(path.dirname(statsPath), "stats.next");
    await fs.writeFile(replacement, statsFor("atomic-replacement"));
    await fs.rename(replacement, statsPath);
    await waitForPublication(() => {
      expect(published).toEqual([
        statsFor("initial"),
        statsFor("atomic-replacement"),
      ]);
    });

    await fs.writeFile(statsPath, statsFor("written-after-replacement"));
    await waitForPublication(() => {
      expect(published).toEqual([
        statsFor("initial"),
        statsFor("atomic-replacement"),
        statsFor("written-after-replacement"),
      ]);
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("preserves a newer acknowledged version while publication is pending", async () => {
    const statsPath = await createStats();
    const firstPublication = deferred();
    const releasePublication = deferred();
    const published: string[] = [];
    const onError = vi.fn();
    const watcher = observe({
      statsPath,
      initialVersion: undefined,
      async onChange() {
        published.push(await fs.readFile(statsPath, "utf8"));
        if (published.length === 1) {
          firstPublication.resolve();
          await releasePublication.promise;
        } else {
          watcher.advance(await readClientStatsVersion(statsPath));
        }
      },
      onError,
    });
    await firstPublication.promise;

    await fs.writeFile(statsPath, statsFor("already-published-newer-version"));
    watcher.advance(await readClientStatsVersion(statsPath));
    // Allow the real filesystem event to arrive while the first publication
    // remains blocked, then let the queued observation inspect its baseline.
    await delay(200);
    releasePublication.resolve();
    await delay(200);
    expect(published).toEqual([statsFor("initial")]);

    await fs.writeFile(statsPath, statsFor("next-unpublished-version"));
    await waitForPublication(() => {
      expect(published).toEqual([
        statsFor("initial"),
        statsFor("next-unpublished-version"),
      ]);
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("closes idempotently after an in-flight publication finishes", async () => {
    const statsPath = await createStats();
    const publicationStarted = deferred();
    const releasePublication = deferred();
    const onChange = vi.fn(async () => {
      publicationStarted.resolve();
      await releasePublication.promise;
    });
    const onError = vi.fn();
    const watcher = observe({
      statsPath,
      initialVersion: undefined,
      onChange,
      onError,
    });
    await publicationStarted.promise;

    const closing = watcher.close();
    expect(watcher.close()).toBe(closing);
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await fs.writeFile(statsPath, statsFor("changed-during-close"));
    expect(closed).toBe(false);

    releasePublication.resolve();
    await closing;
    expect(closed).toBe(true);
    expect(watcher.close()).toBe(closing);
    await fs.writeFile(statsPath, statsFor("changed-after-close"));
    await delay(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
