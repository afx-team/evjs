import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  __testing,
  type UtoopackWorkerSchedulerBinding,
} from "../src/adapter/development/dev-worker-scheduler.js";

describe("Utoopack native-owner scheduler", () => {
  it("registers one owner-realm loader scheduler and hides duplicate registration", async () => {
    const registerWorkerScheduler = vi.fn();
    const binding = {
      registerWorkerScheduler,
    } as unknown as UtoopackWorkerSchedulerBinding;
    const scheduler = __testing.createScheduler("/virtual/utoopack-binding.js");

    await __testing.registerWorkerScheduler(scheduler, binding);

    expect(registerWorkerScheduler).toHaveBeenCalledOnce();
    expect(binding.registerWorkerScheduler).toBeUndefined();
  });

  it("fails the owner when a process loader Worker exits unexpectedly", async () => {
    const scheduler = __testing.createScheduler("/virtual/utoopack-binding.js");
    __testing.createLoaderWorker(scheduler, {
      cwd: process.cwd(),
      filename: fileURLToPath(
        new URL("./fixtures/loader-worker-exit.mjs", import.meta.url),
      ),
    });

    await expect(scheduler.failure).rejects.toThrow(
      "loader worker exited unexpectedly",
    );
    expect(__testing.getLoaderWorkerCount(scheduler)).toBe(0);
  });
});
