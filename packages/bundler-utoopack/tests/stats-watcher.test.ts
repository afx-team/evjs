import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  readStatsVersion,
  startUtoopackStatsWatcher,
} from "../src/adapter/stats-watcher.js";

describe("Utoopack stats watcher", () => {
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
