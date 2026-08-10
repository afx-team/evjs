import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { ConfigComplete } from "@utoo/pack";
import { describe, expect, it } from "vitest";
import { startUtoopackDevWorker } from "../src/adapter/dev-worker-client.js";

const fixtureUrl = new URL("./fixtures/dev-worker-client.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const { PersistentCacheLock } = require("@utoo/pack/cjs/utils/lockfile.js") as {
  PersistentCacheLock: {
    tryAcquire(
      lockPath: string,
      content: string,
    ): { unlockSync(): void } | undefined;
  };
};

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

    const oversized = startUtoopackDevWorker(
      createOptions(() => "x".repeat(300_000)),
      fixtureUrl,
    );
    try {
      await expect(oversized.ready).resolves.toMatchObject({
        rewrite: { error: expect.stringContaining("exceeds 262144 bytes") },
      });
    } finally {
      await oversized.close();
    }
  });

  it("releases worker-owned native cache locks before close resolves", async () => {
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
      expect(PersistentCacheLock.tryAcquire(lockPath, "contender")).toBe(
        undefined,
      );
      await handle.close();
      await expect(handle.done).resolves.toBeUndefined();
      const reacquired = PersistentCacheLock.tryAcquire(lockPath, "reacquired");
      expect(reacquired).toBeDefined();
      reacquired?.unlockSync();
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
      "Timed out after 25ms while waiting for the Utoopack development worker",
    );
    await expect(handle.done).rejects.toThrow(
      "before confirming graceful shutdown",
    );
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
      "exited with code 0 before confirming graceful shutdown",
    );
    await expect(handle.done).rejects.toThrow(
      "exited with code 0 before confirming graceful shutdown",
    );
  });

  it("rejects unexpected clean worker exits without duplicating cleanup errors", async () => {
    const handle = startUtoopackDevWorker(
      createOptions((path) => path, { TEST_EXIT: "true" }),
      fixtureUrl,
    );
    await handle.ready;
    await expect(handle.done).rejects.toThrow(
      "worker exited unexpectedly with code 0",
    );
    await expect(handle.close()).resolves.toBeUndefined();
  });
});
