import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ApiProcess,
  acquireDevSessionLock,
  assertNoActiveDevSessionLock,
  reserveDevPorts,
  stopApiProcess,
  writeDevDistLock,
} from "../src/_internal/build/dev-runtime.js";

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
