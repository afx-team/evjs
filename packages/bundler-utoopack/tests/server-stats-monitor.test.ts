import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readServerStatsVersion,
  startUtoopackServerStatsMonitor,
} from "../src/adapter/development/server-stats-monitor.js";

const fixtureDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtureDirectories
      .splice(0)
      .map((cwd) => fs.promises.rm(cwd, { recursive: true, force: true })),
  );
});

async function createFixture(assets: Array<string | { name: string }>) {
  const cwd = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "evjs-utoo-stats-monitor-"),
  );
  fixtureDirectories.push(cwd);
  const statsPath = path.join(cwd, "stats.json");
  await fs.promises.writeFile(statsPath, JSON.stringify({ assets }));
  return { cwd, statsPath };
}

describe("Utoopack server stats monitor", () => {
  it.each([
    "js",
    "cjs",
    "mjs",
  ])("reloads once for a same-size shared %s rewrite without a stats rewrite", async (extension) => {
    const { cwd, statsPath } = await createFixture([
      { name: "server.js" },
      `chunks/shared.${extension}`,
    ]);
    await fs.promises.mkdir(path.join(cwd, "chunks"));
    await fs.promises.writeFile(path.join(cwd, "server.js"), "entry");
    const sharedPath = path.join(cwd, "chunks", `shared.${extension}`);
    await fs.promises.writeFile(sharedPath, "revision-0");
    const previous = new Date(Date.now() - 1_000);
    await fs.promises.utimes(sharedPath, previous, previous);
    const initialVersion = await readServerStatsVersion(statsPath);
    const initialStats = await fs.promises.stat(statsPath, { bigint: true });
    const initialShared = await fs.promises.stat(sharedPath);
    const onChange = vi.fn(async (_version: string) => true);
    const onError = vi.fn();
    const monitor = startUtoopackServerStatsMonitor({
      statsPath,
      initialVersion,
      onChange,
      onError,
    });

    try {
      await fs.promises.writeFile(sharedPath, "revision-1", { flag: "r+" });
      expect((await fs.promises.stat(sharedPath)).size).toBe(
        initialShared.size,
      );
      await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
      expect(onChange.mock.calls[0]?.[0]).not.toBe(initialVersion);
      expect(await fs.promises.stat(statsPath, { bigint: true })).toMatchObject(
        {
          ino: initialStats.ino,
          size: initialStats.size,
          mtimeNs: initialStats.mtimeNs,
        },
      );

      // Old output is outside the current inventory, so it must not reload.
      await fs.promises.writeFile(path.join(cwd, "old-shared.js"), "unused");
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await monitor.close();
    }
  });

  it("reports a version only after all emitted JavaScript is available", async () => {
    const { cwd, statsPath } = await createFixture(["server.js", "shared.js"]);
    await fs.promises.writeFile(path.join(cwd, "server.js"), "entry");
    expect(await readServerStatsVersion(statsPath)).toBeUndefined();
    await fs.promises.writeFile(path.join(cwd, "shared.js"), "ready");
    expect(await readServerStatsVersion(statsPath)).toBeTypeOf("string");
  });

  it.each([
    "../outside.js",
    "/outside.js",
    "chunks/../../outside.js",
  ])("rejects an emitted asset path outside server output (%s)", async (name) => {
    const { statsPath } = await createFixture([name]);
    await expect(readServerStatsVersion(statsPath)).rejects.toThrow(
      "portable relative artifact path",
    );
  });

  it("does not let a deferred older observation replace an advanced baseline", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoo-stats-monitor-"),
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
    const monitor = startUtoopackServerStatsMonitor({
      statsPath,
      initialVersion: undefined,
      onChange,
      onError(error) {
        throw error;
      },
    });

    try {
      await observed;
      await fs.promises.writeFile(statsPath, '{"version":2}', "utf-8");
      monitor.advance(await readServerStatsVersion(statsPath));
      releaseObservation();

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      releaseObservation();
      await monitor.close();
      await fs.promises.rm(cwd, { recursive: true, force: true });
    }
  });
});
