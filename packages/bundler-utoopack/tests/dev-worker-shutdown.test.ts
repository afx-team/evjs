import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createUtoopackReusableSessionLifecycle } from "../src/adapter/development/dev-worker-shutdown.js";

class TestSessionProcess extends EventEmitter {
  readonly originalExit = vi.fn(
    (_code?: string | number | null) => undefined as never,
  );
  exit = this.originalExit as NodeJS.Process["exit"];
}

describe("Utoopack reusable Session lifecycle", () => {
  it("converts Utoopack's successful process exit into a reusable Session close", async () => {
    const target = new TestSessionProcess();
    const baselineSignalHandler = vi.fn();
    const sessionSignalHandler = vi.fn(() => {
      queueMicrotask(() => target.exit(0));
    });
    target.on("SIGTERM", baselineSignalHandler);
    const lifecycle = createUtoopackReusableSessionLifecycle(target);
    target.on("SIGTERM", sessionSignalHandler);

    await expect(lifecycle.close()).resolves.toBeUndefined();

    expect(baselineSignalHandler).not.toHaveBeenCalled();
    expect(sessionSignalHandler).toHaveBeenCalledOnce();
    expect(target.originalExit).not.toHaveBeenCalled();
    expect(target.exit).toBe(target.originalExit);
    expect(target.rawListeners("SIGTERM")).toEqual([baselineSignalHandler]);
  });

  it("rejects a nonzero Utoopack shutdown without terminating the test owner", async () => {
    const target = new TestSessionProcess();
    const lifecycle = createUtoopackReusableSessionLifecycle(target);
    target.on("SIGTERM", () => {
      queueMicrotask(() => target.exit(1));
    });

    await expect(lifecycle.close()).rejects.toThrow("reported exit code 1");
    expect(target.originalExit).not.toHaveBeenCalled();
    expect(target.exit).toBe(target.originalExit);
  });

  it("preserves unexpected process exits outside a host close request", () => {
    const target = new TestSessionProcess();
    const lifecycle = createUtoopackReusableSessionLifecycle(target);

    target.exit(7);

    expect(target.originalExit).toHaveBeenCalledWith(7);
    lifecycle.dispose();
  });

  it("rejects close when serve did not install a Session cleanup handler", async () => {
    const target = new TestSessionProcess();
    const lifecycle = createUtoopackReusableSessionLifecycle(target);

    await expect(lifecycle.close()).rejects.toThrow(
      "without installing its SIGTERM cleanup handler",
    );
    lifecycle.dispose();
  });
});
