import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STEP_TIMEOUT_MS = 5_000;

function killOwnedProcessGroup(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  description: string,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${description}`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function nextMessage<T>(child: ChildProcess, description: string): Promise<T> {
  let detach = () => {};
  const pending = new Promise<T>((resolve, reject) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      reject(new Error(`Dev exited before ${description}: ${signal ?? code}`));
    };
    child.once("message", resolve);
    child.once("exit", onExit);
    child.once("error", reject);
    detach = () => {
      child.off("message", resolve);
      child.off("exit", onExit);
      child.off("error", reject);
    };
  });
  return withTimeout(pending, description).finally(detach);
}

function didProcessExit(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return true;
  }
}

type FixtureExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

function waitForExit(child: ChildProcess): Promise<FixtureExit> {
  return new Promise((resolve, reject) => {
    // `close` also waits for the captured stderr to finish draining.
    child.once("close", (code, signal) => resolve({ code, signal }));
    child.once("error", reject);
  });
}

// Windows child.kill() terminates the process without delivering a JS signal event.
describe.skipIf(process.platform === "win32")("dev signal disposal", () => {
  it.each([
    { signal: "SIGINT", repeatedSignal: null, scenario: "single-interrupt" },
    { signal: "SIGTERM", repeatedSignal: "SIGTERM", scenario: "repeated-term" },
    { signal: "SIGTERM", repeatedSignal: "SIGTERM", scenario: "dispose-error" },
    {
      signal: "SIGINT",
      repeatedSignal: "SIGINT",
      scenario: "forced-interrupt",
    },
    { signal: "SIGINT", repeatedSignal: "SIGINT", scenario: "host-interrupt" },
    {
      signal: "SIGTERM",
      repeatedSignal: null,
      scenario: "watcher-close-error",
    },
    { signal: "SIGTERM", repeatedSignal: null, scenario: "unref-dispose" },
    { signal: null, repeatedSignal: null, scenario: "watcher-start-error" },
  ] as const)("finishes shutdown for $scenario", async ({
    signal,
    repeatedSignal,
    scenario,
  }) => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-dev-signal-"));
    let child: ChildProcess | undefined;
    let exited: Promise<FixtureExit> | undefined;
    let completed = false;
    try {
      await fs.writeFile(path.join(cwd, "package.json"), '{"private":true}');
      await fs.writeFile(path.join(cwd, "index.html"), '<div id="app"></div>');
      const fixture = fileURLToPath(
        new URL("./fixtures/dev-signal-cleanup.mjs", import.meta.url),
      );
      // Use a private group so timeout cleanup can reach subprocesses even if
      // the fixture never sends their PIDs.
      child = spawn(
        process.execPath,
        ["--unhandled-rejections=strict", fixture, cwd, scenario],
        {
          detached: true,
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
      exited = waitForExit(child);
      void exited.catch(() => {});
      if (signal === null) {
        expect(await withTimeout(exited, "startup failure"), stderr).toEqual({
          code: 1,
          signal: null,
        });
        expect(stderr).toContain("watcher startup failed");
        expect(stderr).not.toContain("Uncaught watcher failure");
        completed = true;
        return;
      }
      const ready = await nextMessage<{ type: string; resourcePid?: number }>(
        child,
        "dev readiness",
      );
      expect(ready.type, stderr).toBe("ready");
      const resourcePid = ready.resourcePid;
      const disposing = nextMessage<{ type: string }>(child, "disposal start");
      child.kill(signal);
      expect((await disposing).type).toBe("disposing");

      const hostInterrupted =
        scenario === "host-interrupt"
          ? nextMessage<{ type: string }>(child, "host's second interrupt")
          : undefined;
      if (repeatedSignal) child.kill(repeatedSignal);
      if (hostInterrupted) {
        expect((await hostInterrupted).type, stderr).toBe("host-interrupted");
      }
      if (scenario === "forced-interrupt") {
        expect(await withTimeout(exited, "forced exit"), stderr).toEqual({
          code: 130,
          signal: null,
        });
        await expect(
          fs.readFile(path.join(cwd, "disposed"), "utf8"),
        ).rejects.toMatchObject({ code: "ENOENT" });
        // Forced exit still invokes execa's process-exit child cleanup.
        if (resourcePid === undefined) throw new Error("Expected resource PID");
        await expect.poll(() => didProcessExit(resourcePid)).toBe(true);
        completed = true;
        return;
      }

      // Leave disposal pending long enough to observe a repeated OS signal.
      if (repeatedSignal === "SIGTERM") await delay(100);
      if (scenario !== "unref-dispose") {
        expect(child.exitCode, stderr).toBeNull();
        expect(child.signalCode, stderr).toBeNull();
        child.send("release");
      }
      const expectedError =
        scenario === "dispose-error"
          ? "resource close failed"
          : scenario === "watcher-close-error"
            ? "watcher close failed"
            : undefined;
      expect(await withTimeout(exited, "graceful exit"), stderr).toEqual({
        code: expectedError ? 1 : 0,
        signal: null,
      });
      if (expectedError) expect(stderr).toContain(expectedError);
      expect(await fs.readFile(path.join(cwd, "disposed"), "utf8")).toBe(
        "complete",
      );
      const closed = JSON.parse(
        await fs.readFile(path.join(cwd, "closed.json"), "utf8"),
      );
      expect(closed.disposed).toBe(1);
      expect(closed.bundlerClosed).toBe(true);
      expect(closed.finalListeners).toEqual(closed.initialListeners);
      if (resourcePid !== undefined)
        expect(didProcessExit(resourcePid)).toBe(true);
      completed = true;
    } finally {
      try {
        if (child && !completed) killOwnedProcessGroup(child);
        if (exited) {
          await withTimeout(
            exited.catch(() => {}),
            "fixture termination",
            2_000,
          );
        }
      } finally {
        await fs.rm(cwd, { recursive: true, force: true });
      }
    }
  }, 25_000);
});
