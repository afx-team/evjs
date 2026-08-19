import { describe, expect, it } from "vitest";
import {
  ensureUtoopackProcessWorkerScheduler,
  markUtoopackProcessForBuild,
} from "../src/adapter/development/dev-worker-scheduler.js";

describe("Utoopack process mode", () => {
  it("rejects dev after the process has hosted build", async () => {
    markUtoopackProcessForBuild();

    await expect(ensureUtoopackProcessWorkerScheduler()).rejects.toThrow(
      "dev cannot run in a process that already hosted build",
    );
  });
});
