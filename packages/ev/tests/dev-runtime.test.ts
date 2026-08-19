import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ApiProcess,
  acquireDevSessionLock,
  acquireProjectOperationLock,
  assertNoActiveDevDistLock,
  assertNoActiveDevSessionLock,
  findDevServerBundlePath,
  reserveDevPorts,
  stopApiProcess,
  writeDevDistLock,
} from "../src/_internal/build/dev/runtime.js";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function createProject(): Promise<string> {
  const cwd = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "evjs-dev-runtime-"),
  );
  cleanups.push(() => fs.promises.rm(cwd, { recursive: true, force: true }));
  return cwd;
}

async function createRuntimeSandbox(): Promise<{
  operations: string;
  ports: string;
  root: string;
  sessions: string;
}> {
  const previousTemporaryDirectory = process.env.TMPDIR;
  const sandbox = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "evjs-dev-runtime-root-"),
  );
  await fs.promises.chmod(sandbox, 0o700);
  process.env.TMPDIR = sandbox;
  const root = path.join(
    await fs.promises.realpath(sandbox),
    `evjs-dev-${typeof process.getuid === "function" ? process.getuid() : "user"}`,
  );
  cleanups.push(async () => {
    if (previousTemporaryDirectory === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTemporaryDirectory;
    await fs.promises.rm(sandbox, { recursive: true, force: true });
  });
  return {
    operations: path.join(root, "operations"),
    ports: path.join(root, "ports"),
    root,
    sessions: path.join(root, "sessions"),
  };
}

async function getSessionLockPath(
  cwd: string,
  sessionsDirectory: string,
): Promise<string> {
  const normalizedCwd = await fs.promises.realpath(cwd);
  const key = createHash("sha256").update(normalizedCwd).digest("hex");
  return path.join(sessionsDirectory, `${key}.lock`);
}

async function getProjectOperationLockPath(
  cwd: string,
  operationsDirectory: string,
): Promise<string> {
  const normalizedCwd = await fs.promises.realpath(cwd);
  const key = createHash("sha256").update(normalizedCwd).digest("hex");
  return path.join(operationsDirectory, `${key}.lock`);
}

function waitForChildMessage<T extends { type: string }>(
  child: ChildProcess,
  type: T["type"],
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for child message ${type}.`));
    }, 5_000);
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Lock contender exited early with code ${code}.`));
    };
    const onMessage = (message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        message.type !== type
      ) {
        return;
      }
      cleanup();
      resolve(message as T);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      child.off("message", onMessage);
    };
    child.on("error", onError);
    child.on("exit", onExit);
    child.on("message", onMessage);
  });
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  server.unref();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected a TCP server address."));
        return;
      }
      server.close((err) => {
        if (err) reject(err);
        else resolve(address.port);
      });
    });
  });
}

describe("dev runtime coordination", () => {
  it("rejects a second dev session for the same project", async () => {
    const cwd = await createProject();
    const realCwd = await fs.promises.realpath(cwd);
    const release = await acquireDevSessionLock(cwd);
    cleanups.push(release);

    await expect(acquireDevSessionLock(cwd)).rejects.toThrow(
      `Dev is already running for "${realCwd}" in process ${process.pid}`,
    );
    await expect(assertNoActiveDevSessionLock(cwd)).rejects.toThrow(
      `Cannot build "${realCwd}" because ev dev is running in process ${process.pid}`,
    );

    release.sync();
    const releaseNextSession = await acquireDevSessionLock(cwd);
    await releaseNextSession();
  });

  it("serializes different project operations for the same project", async () => {
    const cwd = await createProject();
    const realCwd = await fs.promises.realpath(cwd);
    const releaseBuild = await acquireProjectOperationLock(cwd, "build");
    cleanups.push(releaseBuild);

    await expect(acquireProjectOperationLock(cwd, "dev")).rejects.toThrow(
      `Cannot start dev for "${realCwd}" because build is already running in process ${process.pid}`,
    );

    await releaseBuild();
    const releasePrepare = await acquireProjectOperationLock(cwd, "prepare");
    await releasePrepare();
  });

  it("recovers a stale project operation lock", async () => {
    const cwd = await createProject();
    const runtime = await createRuntimeSandbox();
    const lockPath = await getProjectOperationLockPath(cwd, runtime.operations);
    await fs.promises.mkdir(lockPath, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({
        cwd: await fs.promises.realpath(cwd),
        operation: "build",
        pid: 999_999_999,
        startedAt: new Date(0).toISOString(),
        token: randomUUID(),
      }),
      { mode: 0o600 },
    );

    const releasePrepare = await acquireProjectOperationLock(cwd, "prepare");
    await expect(
      fs.promises.readFile(path.join(lockPath, "owner.json"), "utf-8"),
    ).resolves.toContain('"operation": "prepare"');
    await releasePrepare();
  });

  it.each([
    "EACCES",
    "EPERM",
  ])("retries a runtime lock read after a transient %s error", async (code) => {
    const cwd = await createProject();
    const release = await acquireDevSessionLock(cwd);
    cleanups.push(release);
    const readFile = vi
      .spyOn(fs.promises, "readFile")
      .mockRejectedValueOnce(Object.assign(new Error(code), { code }));

    try {
      await expect(acquireDevSessionLock(cwd)).rejects.toThrow(
        "Dev is already running",
      );
      expect(readFile).toHaveBeenCalled();
    } finally {
      readFile.mockRestore();
    }
  });

  it("does not delete a live lock replaced by another process during stale cleanup", async () => {
    const cwd = await createProject();
    const runtime = await createRuntimeSandbox();
    const lockPath = await getSessionLockPath(cwd, runtime.sessions);
    const staleToken = randomUUID();
    const replacementToken = randomUUID();
    await fs.promises.mkdir(lockPath, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({
        cwd: await fs.promises.realpath(cwd),
        pid: 999_999_999,
        startedAt: new Date(0).toISOString(),
        token: staleToken,
      }),
      { mode: 0o600 },
    );

    const contender = spawn(
      process.execPath,
      [
        "-e",
        `
          const fs = require("node:fs");
          const path = require("node:path");
          const [lockPath, token, cwd] = process.argv.slice(1);
          process.on("message", async (message) => {
            if (message !== "replace") return;
            try {
              const candidate = lockPath + ".candidate-" + process.pid + "-" + token;
              await fs.promises.rm(lockPath, { recursive: true, force: true });
              await fs.promises.mkdir(candidate, { mode: 0o700 });
              await fs.promises.writeFile(
                path.join(candidate, "owner.json"),
                JSON.stringify({
                  cwd,
                  pid: process.pid,
                  startedAt: new Date().toISOString(),
                  token,
                }),
                { mode: 0o600 },
              );
              await fs.promises.rename(candidate, lockPath);
              process.send?.({ type: "replaced", pid: process.pid });
            } catch (error) {
              process.send?.({ type: "failed", error: String(error) });
            }
          });
          process.send?.({ type: "ready" });
          setInterval(() => {}, 1_000);
        `,
        lockPath,
        replacementToken,
        await fs.promises.realpath(cwd),
      ],
      { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    cleanups.push(() => {
      contender.kill();
    });
    await waitForChildMessage<{ type: "ready" }>(contender, "ready");

    const renameReached = Promise.withResolvers<void>();
    const continueRename = Promise.withResolvers<void>();
    const originalRename = fs.promises.rename.bind(fs.promises);
    let intercepted = false;
    const rename = vi
      .spyOn(fs.promises, "rename")
      .mockImplementation(async (source, destination) => {
        if (!intercepted && String(source) === lockPath) {
          intercepted = true;
          renameReached.resolve();
          await continueRename.promise;
        }
        await originalRename(source, destination);
      });

    try {
      const acquisition = acquireDevSessionLock(cwd);
      await renameReached.promise;
      contender.send("replace");
      const replacement = await waitForChildMessage<{
        pid: number;
        type: "replaced";
      }>(contender, "replaced");
      continueRename.resolve();

      await expect(acquisition).rejects.toThrow(
        `Dev is already running for "${await fs.promises.realpath(cwd)}" in process ${replacement.pid}`,
      );
      await expect(
        fs.promises.readFile(path.join(lockPath, "owner.json"), "utf-8"),
      ).resolves.toContain(replacementToken);
    } finally {
      continueRename.resolve();
      rename.mockRestore();
    }
  });

  it("does not restore a lock after its token-authorized release begins", async () => {
    const cwd = await createProject();
    const runtime = await createRuntimeSandbox();
    const lockPath = await getSessionLockPath(cwd, runtime.sessions);
    const release = await acquireDevSessionLock(cwd);
    const renameCompleted = Promise.withResolvers<void>();
    const continueRelease = Promise.withResolvers<void>();
    const originalRename = fs.promises.rename.bind(fs.promises);
    let intercepted = false;
    const rename = vi
      .spyOn(fs.promises, "rename")
      .mockImplementation(async (source, destination) => {
        await originalRename(source, destination);
        if (!intercepted && String(source) === lockPath) {
          intercepted = true;
          renameCompleted.resolve();
          await continueRelease.promise;
        }
      });

    let replacement:
      | Awaited<ReturnType<typeof acquireDevSessionLock>>
      | undefined;
    try {
      const releasing = release();
      await renameCompleted.promise;
      replacement = await acquireDevSessionLock(cwd);
      continueRelease.resolve();
      await releasing;

      await expect(assertNoActiveDevSessionLock(cwd)).rejects.toThrow(
        `because ev dev is running in process ${process.pid}`,
      );
    } finally {
      continueRelease.resolve();
      rename.mockRestore();
      await replacement?.();
    }
  });

  it("rejects a symbolic-link dev runtime root", async () => {
    const cwd = await createProject();
    const runtime = await createRuntimeSandbox();
    const target = path.join(path.dirname(runtime.root), "attacker-root");
    await fs.promises.mkdir(target, { mode: 0o700 });
    await fs.promises.symlink(target, runtime.root, "dir");

    await expect(acquireDevSessionLock(cwd)).rejects.toThrow(
      "must be a real directory, not a symbolic link",
    );
  });

  it.each([
    "operations",
    "sessions",
    "ports",
  ] as const)("rejects a symbolic-link %s runtime lock ancestor", async (kind) => {
    const cwd = await createProject();
    const runtime = await createRuntimeSandbox();
    const target = path.join(path.dirname(runtime.root), `attacker-${kind}`);
    await fs.promises.mkdir(runtime.root, { mode: 0o700 });
    await fs.promises.mkdir(target, { mode: 0o700 });
    await fs.promises.symlink(target, runtime[kind], "dir");

    const operation =
      kind === "operations"
        ? acquireProjectOperationLock(cwd, "build")
        : kind === "sessions"
          ? acquireDevSessionLock(cwd)
          : reserveDevPorts(cwd, 31_001, 31_002);
    await expect(operation).rejects.toThrow(
      "must be a real directory, not a symbolic link",
    );
  });

  it("rejects shared-writable dev runtime directories", async () => {
    if (process.platform === "win32") return;

    const cwd = await createProject();
    const runtime = await createRuntimeSandbox();
    await fs.promises.mkdir(runtime.root, { mode: 0o700 });
    await fs.promises.chmod(runtime.root, 0o777);

    await expect(acquireDevSessionLock(cwd)).rejects.toThrow(
      "must not be writable by group or other users",
    );
  });

  it("fails closed on writable runtime paths when uid checks are unavailable", async () => {
    if (process.platform === "win32") return;

    const cwd = await createProject();
    const runtime = await createRuntimeSandbox();
    await fs.promises.mkdir(runtime.root, { mode: 0o700 });
    await fs.promises.chmod(runtime.root, 0o777);
    const getuid = Object.getOwnPropertyDescriptor(process, "getuid");
    Object.defineProperty(process, "getuid", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    try {
      await expect(acquireDevSessionLock(cwd)).rejects.toThrow(
        /must not (?:be writable by group or other users|traverse an untrusted writable ancestor)/,
      );
    } finally {
      if (getuid) Object.defineProperty(process, "getuid", getuid);
    }
  });

  it("rejects runtime ancestors owned by a different uid", async () => {
    if (typeof process.getuid !== "function") return;

    const cwd = await createProject();
    await createRuntimeSandbox();
    const getuid = vi
      .spyOn(process, "getuid")
      .mockReturnValue(process.getuid() + 1);
    try {
      await expect(acquireDevSessionLock(cwd)).rejects.toThrow(
        "not owned by root or the current user",
      );
    } finally {
      getuid.mockRestore();
    }
  });

  it("reserves distinct client and server ports across projects", async () => {
    const firstCwd = await createProject();
    const secondCwd = await createProject();
    const requestedClientPort = await getAvailablePort();
    let requestedServerPort = await getAvailablePort();
    while (requestedServerPort === requestedClientPort) {
      requestedServerPort = await getAvailablePort();
    }

    const first = await reserveDevPorts(
      firstCwd,
      requestedClientPort,
      requestedServerPort,
    );
    cleanups.push(() => first.release());
    const second = await reserveDevPorts(
      secondCwd,
      requestedClientPort,
      requestedServerPort,
    );
    cleanups.push(() => second.release());

    expect(first.client.port).toBe(requestedClientPort);
    expect(first.server.port).toBe(requestedServerPort);
    expect(
      new Set([
        first.client.port,
        first.server.port,
        second.client.port,
        second.server.port,
      ]).size,
    ).toBe(4);

    first.releaseSync();
    const replacement = await reserveDevPorts(
      firstCwd,
      requestedClientPort,
      requestedServerPort,
    );
    expect(replacement.client.port).toBe(requestedClientPort);
    expect(replacement.server.port).toBe(requestedServerPort);
    await replacement.release();
  });

  it("skips an externally occupied port", async () => {
    const cwd = await createProject();
    const occupiedServer = createServer();
    occupiedServer.unref();
    await new Promise<void>((resolve, reject) => {
      occupiedServer.once("error", reject);
      occupiedServer.listen(0, resolve);
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) => {
          occupiedServer.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        }),
    );
    const address = occupiedServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP server address.");
    }

    const requestedServerPort = await getAvailablePort();
    const reservation = await reserveDevPorts(
      cwd,
      address.port,
      requestedServerPort,
    );
    cleanups.push(() => reservation.release());

    expect(reservation.client.port).not.toBe(address.port);
    expect(reservation.server.port).toBe(requestedServerPort);
  });

  it("cleans the dist lock synchronously during process exit", async () => {
    const cwd = await createProject();
    const release = await writeDevDistLock(cwd, "dist");
    const lockPath = path.join(cwd, "dist/.evjs-dev.lock");

    expect(fs.existsSync(lockPath)).toBe(true);
    release.sync();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("does not follow an existing dev dist lock symlink", async () => {
    const cwd = await createProject();
    const distDir = path.join(cwd, "dist");
    const sentinel = path.join(cwd, "sentinel.txt");
    const lockPath = path.join(distDir, ".evjs-dev.lock");
    await fs.promises.mkdir(distDir, { recursive: true });
    await fs.promises.writeFile(sentinel, "outside", "utf-8");
    await fs.promises.symlink(sentinel, lockPath);

    await expect(writeDevDistLock(cwd, "dist")).rejects.toThrow(
      "Dev dist lock output must not overwrite a symbolic-link output file",
    );
    await expect(fs.promises.readFile(sentinel, "utf-8")).resolves.toBe(
      "outside",
    );
  });

  it("does not remove a stale dist lock through a symbolic-link ancestor", async () => {
    const cwd = await createProject();
    const outside = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-dev-lock-outside-"),
    );
    cleanups.push(() =>
      fs.promises.rm(outside, { recursive: true, force: true }),
    );
    const externalLock = path.join(outside, ".evjs-dev.lock");
    const lockContents = JSON.stringify({
      command: "dev",
      distDir: "dist",
      pid: 999_999_999,
      startedAt: new Date(0).toISOString(),
    });
    await fs.promises.writeFile(externalLock, lockContents, "utf-8");
    await fs.promises.symlink(outside, path.join(cwd, "dist"), "dir");

    await expect(assertNoActiveDevDistLock(cwd, "dist")).rejects.toThrow(
      "Stale dev dist lock output must not traverse symbolic links or non-directory output ancestors",
    );
    await expect(fs.promises.readFile(externalLock, "utf-8")).resolves.toBe(
      lockContents,
    );
  });
});

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

describe("findDevServerBundlePath", () => {
  it("resolves the exact linked server entry in the configured output directory", async () => {
    const cwd = await createProject();
    const serverDir = path.join(cwd, "dist/custom-server");
    const defaultServerDir = path.join(cwd, "dist/server");
    await fs.promises.mkdir(serverDir, { recursive: true });
    await fs.promises.mkdir(defaultServerDir, { recursive: true });
    await Promise.all([
      fs.promises.writeFile(path.join(serverDir, "server.cjs"), ""),
      fs.promises.writeFile(path.join(serverDir, "stale.cjs"), ""),
      fs.promises.writeFile(path.join(defaultServerDir, "server.cjs"), ""),
      fs.promises.writeFile(
        path.join(serverDir, "stats.json"),
        JSON.stringify({
          entrypoints: {
            server: {
              assets: [{ name: "server.cjs" }],
            },
          },
        }),
      ),
      fs.promises.writeFile(
        path.join(serverDir, "manifest.json"),
        JSON.stringify({ entry: "stale.cjs" }),
      ),
    ]);

    await expect(
      findDevServerBundlePath(cwd, "dist/custom-server", "server.cjs"),
    ).resolves.toBe(path.join(serverDir, "server.cjs"));
  });

  it("does not fall back to stale conventional or stats-derived entries", async () => {
    const cwd = await createProject();
    const serverDir = path.join(cwd, "dist/custom-server");
    const outsideBundle = path.join(cwd, "dist/outside.cjs");
    await fs.promises.mkdir(serverDir, { recursive: true });
    await Promise.all([
      fs.promises.writeFile(path.join(serverDir, "server.cjs"), ""),
      fs.promises.writeFile(outsideBundle, ""),
      fs.promises.writeFile(
        path.join(serverDir, "stats.json"),
        JSON.stringify({
          entrypoints: {
            server: { assets: [{ name: "../outside.cjs" }] },
          },
        }),
      ),
    ]);

    await expect(
      findDevServerBundlePath(cwd, "dist/custom-server", "fresh.cjs"),
    ).rejects.toThrow(
      'Development server entry "fresh.cjs" was not emitted under "dist/custom-server"',
    );
  });

  it("rejects server entries outside the configured output directory", async () => {
    const cwd = await createProject();
    const serverDir = path.join(cwd, "dist/custom-server");
    await fs.promises.mkdir(serverDir, { recursive: true });
    await fs.promises.writeFile(path.join(cwd, "dist/outside.cjs"), "");

    await expect(
      findDevServerBundlePath(cwd, "dist/custom-server", "../outside.cjs"),
    ).rejects.toThrow('without empty, "." or ".." path segments');
  });
});
