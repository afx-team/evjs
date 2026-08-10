import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { delegateUtoopackWorkerSchedulerToHost } from "../src/adapter/dev-worker-scheduler.js";

const require = createRequire(import.meta.url);

describe("Utoopack process worker scheduler", () => {
  it("hides the matching Session realm registration entry point", () => {
    const bindingPath = require.resolve("@utoo/pack/cjs/binding.js");
    const binding = require(bindingPath) as {
      registerWorkerScheduler?: unknown;
    };
    const original = binding.registerWorkerScheduler;

    try {
      delegateUtoopackWorkerSchedulerToHost(bindingPath);
      expect(binding.registerWorkerScheduler).toBeUndefined();
    } finally {
      binding.registerWorkerScheduler = original;
    }
  });

  it("rejects a Session realm backed by a different native binding", () => {
    expect(() =>
      delegateUtoopackWorkerSchedulerToHost("/other/@utoo/pack/binding.js"),
    ).toThrow("resolved a different native binding");
  });
});
