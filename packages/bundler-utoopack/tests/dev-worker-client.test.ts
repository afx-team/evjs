import type { ConfigComplete } from "@utoo/pack";
import { describe, expect, it } from "vitest";
import { startUtoopackDevWorker } from "../src/adapter/dev-worker-client.js";

const fixtureUrl = new URL("./fixtures/dev-worker-client.mjs", import.meta.url);

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
