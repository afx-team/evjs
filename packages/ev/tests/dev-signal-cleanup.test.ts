import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function killOwnedProcess(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function nextMessage<T>(child: ChildProcess): Promise<T> {
  return new Promise((resolve, reject) => {
    const message = (value: T) => {
      child.off("exit", exited);
      resolve(value);
    };
    const exited = (code: number | null, signal: NodeJS.Signals | null) => {
      child.off("message", message);
      reject(
        new Error(`Dev exited before completing disposal: ${signal ?? code}`),
      );
    };
    child.once("message", message);
    child.once("exit", exited);
  });
}

// Windows child.kill() terminates the process without delivering a JS signal event.
describe.skipIf(process.platform === "win32")("dev signal disposal", () => {
  it.each([
    { signal: "SIGTERM", failDispose: false },
    { signal: "SIGINT", failDispose: true },
  ] as const)("awaits disposal with execa on $signal (failure: $failDispose)", async ({
    signal,
    failDispose,
  }) => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-dev-signal-"));
    await fs.writeFile(path.join(cwd, "package.json"), '{"private":true}');
    await fs.writeFile(path.join(cwd, "index.html"), '<div id="app"></div>');
    const fixture = fileURLToPath(
      new URL("./fixtures/dev-signal-cleanup.mjs", import.meta.url),
    );
    const child = spawn(
      process.execPath,
      [fixture, cwd, signal, String(failDispose)],
      {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    const exited = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) =>
      child.once("exit", (code, exitSignal) =>
        resolve({ code, signal: exitSignal }),
      ),
    );
    let resourcePid: number | undefined;
    try {
      const ready = await nextMessage<{ type: string; resourcePid: number }>(
        child,
      );
      expect(ready.type, stderr).toBe("ready");
      resourcePid = ready.resourcePid;
      const disposing = nextMessage<{ type: string }>(child);
      child.kill(signal);
      expect((await disposing).type).toBe("disposing");

      // A repeated signal must share the in-flight cleanup, not interrupt it.
      const repeated = nextMessage<{ type: string }>(child);
      child.send("repeat");
      expect((await repeated).type).toBe("repeated");
      child.send("release");
      expect(await exited, stderr).toEqual({
        code: failDispose ? 1 : 0,
        signal: null,
      });
      expect(await fs.readFile(path.join(cwd, "disposed"), "utf8")).toBe(
        "complete",
      );
      const closed = JSON.parse(
        await fs.readFile(path.join(cwd, "closed.json"), "utf8"),
      );
      expect(closed.disposed).toBe(1);
      expect(closed.finalListeners).toEqual(closed.initialListeners);
      expect(() => process.kill(ready.resourcePid, 0)).toThrow();
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      if (resourcePid) killOwnedProcess(resourcePid);
      await exited;
      await fs.rm(cwd, { recursive: true, force: true });
    }
  }, 15_000);
});
