import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { watchClientStats } from "../src/adapter/development/stats-watcher.js";

it("scans stats on ready, filters unrelated files, and stops on close", async () => {
  const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "evjs-stats-"));
  const statsPath = path.join(cwd, "stats.json");
  await fs.promises.writeFile(statsPath, "{}");
  const onChange = vi.fn();
  const onError = vi.fn();
  const watcher = watchClientStats(statsPath, onChange, onError);
  try {
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    await fs.promises.writeFile(path.join(cwd, "other.json"), "{}");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onChange).toHaveBeenCalledTimes(1);
    await fs.promises.writeFile(statsPath, '{"updated":true}');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    await watcher.close();
    await fs.promises.writeFile(statsPath, "{}");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    await watcher.close();
    await fs.promises.rm(cwd, { recursive: true, force: true });
  }
});
