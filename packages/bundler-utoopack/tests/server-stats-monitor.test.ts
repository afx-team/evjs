import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  readServerStatsVersion,
  startUtoopackServerStatsMonitor,
} from "../src/adapter/development/server-stats-monitor.js";

describe("Utoopack server stats monitor", () => {
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
