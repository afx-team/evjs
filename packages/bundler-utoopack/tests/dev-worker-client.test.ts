import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConfigComplete } from "@utoo/pack";
import { afterEach, describe, expect, it } from "vitest";
import { __testing as modeTesting } from "../src/adapter/development/dev-process-mode.js";
import {
  __testing as ownerTesting,
  startUtoopackDevWorker,
} from "../src/adapter/development/dev-worker-client.js";

const fixtureUrl = new URL("./fixtures/dev-worker-client.mjs", import.meta.url);

afterEach(async () => {
  await ownerTesting.disposeNativeOwner();
  modeTesting.reset();
});

function createOptions(
  rewrite: (path: string) => string,
  define: Record<string, string> = {},
) {
  const config: ConfigComplete = {
    entry: [],
    define,
    devServer: {
      proxy: [
        {
          context: ["/proxy"],
          target: "http://localhost:3001",
          pathRewrite: rewrite,
        },
        {
          context: ["/fallback"],
          target: "http://localhost:3000",
        },
      ],
    },
  };
  return {
    cwd: process.cwd(),
    config,
    spaHistoryFallbackRuleIndex: 1,
    server: {
      port: 3000,
      https: false,
      hostname: "0.0.0.0",
      logServerInfo: false,
    },
  };
}

describe("Utoopack dev worker client", () => {
  it("bridges closure-backed path rewrites and updates the worker-owned fallback", async () => {
    const prefix = "/closed";
    const handle = startUtoopackDevWorker(
      createOptions((path) => `${prefix}${path}`, { TEST_PATH: "/request" }),
      fixtureUrl,
    );
    try {
      const ready = (await handle.ready) as typeof handle extends {
        ready: Promise<infer T>;
      }
        ? T & {
            rewrite: { value?: string; error?: string };
            fallbackTarget?: string;
          }
        : never;
      expect(ready.rewrite).toEqual({ value: "/closed/request" });
      expect(ready.fallbackTarget).toBe("http://localhost:4321");
      expect(ready.spaHistoryFallbackUpdated).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it("returns rewrite exceptions and oversized results to the worker", async () => {
    const throwing = startUtoopackDevWorker(
      createOptions(() => {
        throw new Error("rewrite failed");
      }),
      fixtureUrl,
    );
    try {
      await expect(throwing.ready).resolves.toMatchObject({
        rewrite: { error: "rewrite failed" },
      });
    } finally {
      await throwing.close();
    }
    const ownerThreadId = ownerTesting.getNativeOwnerThreadId();

    const oversized = startUtoopackDevWorker(
      createOptions(() => "x".repeat(300_000)),
      fixtureUrl,
    );
    try {
      await expect(oversized.ready).resolves.toMatchObject({
        rewrite: { error: expect.stringContaining("exceeds 262144 bytes") },
      });
      expect(ownerTesting.getNativeOwnerThreadId()).toBe(ownerThreadId);
    } finally {
      await oversized.close();
    }
  });

  it("releases owner-Worker resources before Session close resolves", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoopack-worker-close-"),
    );
    const lockPath = path.join(cwd, "lock");
    const handle = startUtoopackDevWorker(
      createOptions((requestPath) => requestPath, {
        TEST_CACHE_LOCK_PATH: lockPath,
      }),
      fixtureUrl,
    );

    try {
      await handle.ready;
      await expect(fs.promises.open(lockPath, "wx")).rejects.toMatchObject({
        code: "EEXIST",
      });
      await handle.close();
      await expect(handle.done).resolves.toBeUndefined();
      const reacquired = await fs.promises.open(lockPath, "wx");
      await reacquired.close();
      await fs.promises.unlink(lockPath);
    } finally {
      try {
        await handle.close();
      } finally {
        await fs.promises.rm(cwd, { recursive: true, force: true });
      }
    }
  });

  it("fails close instead of overlapping a worker that cannot shut down", async () => {
    const handle = startUtoopackDevWorker(
      createOptions((requestPath) => requestPath, {
        TEST_IGNORE_CLOSE: "true",
      }),
      fixtureUrl,
      25,
    );

    await handle.ready;
    await expect(handle.close()).rejects.toThrow(
      "Timed out after 25ms while waiting for the Utoopack native owner",
    );
    await expect(handle.done).rejects.toThrow("Timed out after 25ms");
  });

  it("rejects a clean exit that did not accept graceful shutdown", async () => {
    const handle = startUtoopackDevWorker(
      createOptions((requestPath) => requestPath, {
        TEST_SKIP_CLOSE_ACK: "true",
      }),
      fixtureUrl,
    );

    await handle.ready;
    await expect(handle.close()).rejects.toThrow(
      "exited with code 0 before confirming Session",
    );
    await expect(handle.done).rejects.toThrow(
      "exited with code 0 before confirming Session",
    );
  });

  it("rejects unexpected clean worker exits without duplicating cleanup errors", async () => {
    const handle = startUtoopackDevWorker(
      createOptions((path) => path, { TEST_EXIT: "true" }),
      fixtureUrl,
    );
    await handle.ready;
    await expect(handle.done).rejects.toThrow(
      "native-owner Worker exited unexpectedly with code 0",
    );
    await expect(handle.close()).resolves.toBeUndefined();
  });
});
