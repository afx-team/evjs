import { afterEach, describe, expect, it } from "vitest";
import {
  __testing,
  markUtoopackProcessForBuild,
  markUtoopackProcessForDev,
} from "../src/adapter/development/dev-process-mode.js";

afterEach(() => __testing.reset());

describe("Utoopack process mode", () => {
  it("rejects dev after the process has hosted build", async () => {
    markUtoopackProcessForBuild();

    expect(() => markUtoopackProcessForDev()).toThrow(
      "dev cannot run in a process that already hosted build",
    );
  });

  it("rejects build after the process has hosted a native dev owner", () => {
    markUtoopackProcessForDev();

    expect(() => markUtoopackProcessForBuild()).toThrow(
      "build cannot run in a process that already hosted dev",
    );
  });
});
