import { describe, expect, it, vi } from "vitest";
import type { ApiProcess } from "../src/_internal/build/dev-runtime.js";
import { stopApiProcess } from "../src/_internal/build/dev-runtime.js";

describe("stopApiProcess", () => {
  it("clears its shutdown timeout after a graceful exit", async () => {
    vi.useFakeTimers();
    try {
      const kill = vi.fn();
      const processToStop = Object.assign(Promise.resolve(), {
        kill,
      }) as unknown as ApiProcess;

      await stopApiProcess(processToStop, 3000);

      expect(kill).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
