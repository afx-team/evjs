import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  readStatsVersion,
  startUtoopackStatsWatcher,
} from "../src/adapter/development/stats-watcher.js";

async function deferNextStatsRead(statsPath: string) {
  const stats = await fs.promises.stat(statsPath, { bigint: true });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi.spyOn(fs.promises, "stat").mockImplementationOnce(async () => {
    markStarted();
    await gate;
    return stats;
  });
  return { started, release, restore: () => spy.mockRestore() };
}

describe("Utoopack stats watcher", () => {
  it("preserves an advanced baseline while an older stats read is pending", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoo-stats-watcher-"),
    );
    const statsPath = path.join(cwd, "stats.json");
    await fs.promises.writeFile(statsPath, '{"version":1}', "utf-8");
    const olderVersion = await readStatsVersion([statsPath]);
    const pendingRead = await deferNextStatsRead(statsPath);
    const onChange = vi.fn(async () => true);
    const onError = vi.fn();
    const watcher = startUtoopackStatsWatcher({
      statsPaths: [statsPath],
      initialVersion: undefined,
      onChange,
      onError,
    });

    try {
      await pendingRead.started;
      await fs.promises.writeFile(statsPath, '{"version":22}', "utf-8");
      watcher.advance(await readStatsVersion([statsPath]));
      pendingRead.release();
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(onChange).toHaveBeenCalledExactlyOnceWith(olderVersion);

      await fs.promises.writeFile(statsPath, '{"version":333}', "utf-8");
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
      expect(onError).not.toHaveBeenCalled();
    } finally {
      pendingRead.release();
      await watcher.close();
      pendingRead.restore();
      await fs.promises.rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not begin publication when closing interrupts a stats read", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoo-stats-watcher-"),
    );
    const statsPath = path.join(cwd, "stats.json");
    await fs.promises.writeFile(statsPath, '{"version":1}', "utf-8");
    const pendingRead = await deferNextStatsRead(statsPath);
    const onChange = vi.fn(async () => true);
    const onError = vi.fn();
    const watcher = startUtoopackStatsWatcher({
      statsPaths: [statsPath],
      initialVersion: undefined,
      onChange,
      onError,
    });

    try {
      await pendingRead.started;
      const closing = watcher.close();
      pendingRead.release();
      await closing;
      expect(onChange).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      pendingRead.release();
      await watcher.close();
      pendingRead.restore();
      await fs.promises.rm(cwd, { recursive: true, force: true });
    }
  });

  it("makes every close wait for an in-flight publication", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoo-stats-watcher-"),
    );
    const statsPath = path.join(cwd, "stats.json");
    await fs.promises.writeFile(statsPath, '{"version":1}', "utf-8");

    let markObserved!: () => void;
    const observed = new Promise<void>((resolve) => {
      markObserved = resolve;
    });
    let releasePublication!: () => void;
    const publicationGate = new Promise<void>((resolve) => {
      releasePublication = resolve;
    });
    const onChange = vi.fn(async () => {
      markObserved();
      await publicationGate;
      return true;
    });
    const onError = vi.fn();
    const watcher = startUtoopackStatsWatcher({
      statsPaths: [statsPath],
      initialVersion: undefined,
      onChange,
      onError,
    });

    try {
      await observed;
      const closing = watcher.close();
      const repeatedClose = watcher.close();
      let firstClosed = false;
      let secondClosed = false;
      void closing.then(() => {
        firstClosed = true;
      });
      void repeatedClose.then(() => {
        secondClosed = true;
      });

      await fs.promises.writeFile(statsPath, '{"version":22}', "utf-8");
      expect(firstClosed).toBe(false);
      expect(secondClosed).toBe(false);
      expect(repeatedClose).toBe(closing);

      releasePublication();
      await Promise.all([closing, repeatedClose]);
      expect(firstClosed).toBe(true);
      expect(secondClosed).toBe(true);
      expect(watcher.close()).toBe(closing);
      await fs.promises.writeFile(statsPath, '{"version":333}', "utf-8");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      releasePublication();
      await watcher.close();
      await fs.promises.rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not let a deferred older observation replace an advanced baseline", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoo-stats-watcher-"),
    );
    const statsPath = path.join(cwd, "stats.json");
    await fs.promises.writeFile(statsPath, '{"version":1}', "utf-8");

    let markObserved!: () => void;
    const observed = new Promise<void>((resolve) => {
      markObserved = resolve;
    });
    let releaseObservation!: () => void;
    const observationGate = new Promise<void>((resolve) => {
      releaseObservation = resolve;
    });
    const onChange = vi.fn(async () => {
      markObserved();
      await observationGate;
      return true;
    });
    const watcher = startUtoopackStatsWatcher({
      statsPaths: [statsPath],
      initialVersion: undefined,
      onChange,
      onError(error) {
        throw error;
      },
    });

    try {
      await observed;
      await fs.promises.writeFile(statsPath, '{"version":2}', "utf-8");
      watcher.advance(await readStatsVersion([statsPath]));
      releaseObservation();

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      releaseObservation();
      await watcher.close();
      await fs.promises.rm(cwd, { recursive: true, force: true });
    }
  });

  it("coalesces client and server stats changed before the ready scan", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoo-stats-watcher-"),
    );
    const clientStatsPath = path.join(cwd, "client-stats.json");
    const serverStatsPath = path.join(cwd, "server-stats.json");
    const statsPaths = [clientStatsPath, serverStatsPath];
    await Promise.all([
      fs.promises.writeFile(clientStatsPath, '{"version":1}', "utf-8"),
      fs.promises.writeFile(serverStatsPath, '{"version":1}', "utf-8"),
    ]);
    const initialVersion = await readStatsVersion(statsPaths);
    await Promise.all([
      fs.promises.writeFile(clientStatsPath, '{"version":22}', "utf-8"),
      fs.promises.writeFile(serverStatsPath, '{"version":22}', "utf-8"),
    ]);
    const onChange = vi.fn(async () => true);
    const watcher = startUtoopackStatsWatcher({
      statsPaths,
      initialVersion,
      onChange,
      onError(error) {
        throw error;
      },
    });

    try {
      const deadline = Date.now() + 1_000;
      while (onChange.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      await watcher.close();
      await fs.promises.rm(cwd, { recursive: true, force: true });
    }
  });

  it("observes a stats file created after the watcher starts", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoo-stats-watcher-"),
    );
    const statsPath = path.join(cwd, "stats.json");
    const onChange = vi.fn(async () => true);
    const watcher = startUtoopackStatsWatcher({
      statsPaths: [statsPath],
      initialVersion: undefined,
      onChange,
      onError(error) {
        throw error;
      },
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fs.promises.writeFile(statsPath, '{"version":1}', "utf-8");
      const deadline = Date.now() + 1_000;
      while (onChange.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      await watcher.close();
      await fs.promises.rm(cwd, { recursive: true, force: true });
    }
  });
});
