import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { ConfigComplete } from "@utoo/pack";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startUtoopackDevWorker } from "../src/adapter/dev-worker-client.js";
import {
  ensureUtoopackProcessWorkerScheduler,
  markUtoopackProcessForBuild,
  __testing as schedulerTesting,
} from "../src/adapter/dev-worker-scheduler.js";

const fixtureUrl = new URL(
  "./fixtures/dev-worker-native-session.mjs",
  import.meta.url,
);
const require = createRequire(import.meta.url);
const tempDirs: string[] = [];
let previousDisablePersistentCache: string | undefined;
let previousNodeEnv: string | undefined;
let previousLoaderTestEnv: string | undefined;

beforeEach(() => {
  previousDisablePersistentCache = process.env.DISABLE_PERSISTENT_CACHE;
  previousNodeEnv = process.env.NODE_ENV;
  previousLoaderTestEnv = process.env.EVJS_LOADER_TEST_ENV;
  delete process.env.DISABLE_PERSISTENT_CACHE;
  process.env.NODE_ENV = "production";
  process.env.EVJS_LOADER_TEST_ENV = "inherited-from-host";
});

afterEach(async () => {
  if (previousDisablePersistentCache === undefined) {
    delete process.env.DISABLE_PERSISTENT_CACHE;
  } else {
    process.env.DISABLE_PERSISTENT_CACHE = previousDisablePersistentCache;
  }
  if (previousNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = previousNodeEnv;
  }
  if (previousLoaderTestEnv === undefined) {
    delete process.env.EVJS_LOADER_TEST_ENV;
  } else {
    process.env.EVJS_LOADER_TEST_ENV = previousLoaderTestEnv;
  }
  await Promise.all(
    tempDirs.splice(0).map((cwd) =>
      fs.promises.rm(cwd, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("Utoopack native dev Session replacement", () => {
  it("starts a second native project after the first Session closes", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoopack-native-session-"),
    );
    tempDirs.push(cwd);
    await fs.promises.mkdir(path.join(cwd, "src"), { recursive: true });
    await fs.promises.writeFile(
      path.join(cwd, "src/index.js"),
      'import value from "./message.foo"; console.log(value);\n',
    );
    const loaderLogPath = path.join(cwd, "loader.log");
    const loaderPath = path.join(cwd, "custom-loader.cjs");
    await fs.promises.writeFile(loaderPath, createLoaderSource(loaderLogPath));
    await fs.promises.writeFile(path.join(cwd, "src/message.foo"), "A\n");
    const config = createConfig(loaderPath);
    const scheduler = await ensureUtoopackProcessWorkerScheduler();
    const hostBinding = require(scheduler.bindingPath) as {
      registerWorkerScheduler?: unknown;
    };
    expect(hostBinding.registerWorkerScheduler).toBeUndefined();

    await runSession(cwd, config, scheduler.bindingPath);
    await fs.promises.writeFile(path.join(cwd, "src/message.foo"), "B\n");
    await fs.promises.rm(path.join(cwd, "dist"), {
      recursive: true,
      force: true,
    });
    const replacementScheduler = await ensureUtoopackProcessWorkerScheduler();
    expect(replacementScheduler.bindingPath).toBe(scheduler.bindingPath);
    await runSession(cwd, config, replacementScheduler.bindingPath);

    const loaderRuns = (await fs.promises.readFile(loaderLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => line.split(":"));
    expect(loaderRuns.map(([, , , value]) => value)).toEqual(
      expect.arrayContaining(["A", "B"]),
    );
    for (const [threadId, nodeEnv, inheritedEnv] of loaderRuns) {
      expect(Number(threadId)).toBeGreaterThan(0);
      expect(nodeEnv).toBe("development");
      expect(inheritedEnv).toBe("inherited-from-host");
    }
    expect(() => markUtoopackProcessForBuild()).toThrow(
      "build cannot run in a process that already hosted dev",
    );

    const workerCount = schedulerTesting.getLoaderWorkerCount(scheduler);
    const exitWorkerPath = path.join(cwd, "exit-worker.mjs");
    await fs.promises.writeFile(exitWorkerPath, "process.exit(0);\n");
    schedulerTesting.createLoaderWorker(scheduler, {
      cwd,
      filename: exitWorkerPath,
    });
    await expect(scheduler.failure).rejects.toThrow(
      "loader worker exited unexpectedly",
    );
    expect(schedulerTesting.getLoaderWorkerCount(scheduler)).toBe(workerCount);
  }, 30_000);
});

function createConfig(loaderPath: string): ConfigComplete {
  return {
    mode: "development",
    entry: [{ import: "./src/index.js", name: "main" }],
    output: {
      path: "./dist/client",
      filename: "[name].js",
      chunkFilename: "[name].js",
      clean: true,
      publicPath: "auto",
    },
    // Native cache-lock release is covered by dev-worker-client.test.ts. This
    // process-owned scheduler test must be able to remove its temporary
    // project before the Vitest worker itself exits.
    persistentCaching: false,
    pluginRuntimeStrategy: "workerThreads",
    module: {
      rules: {
        "*.foo": {
          loaders: [{ loader: loaderPath }],
          as: "*.js",
        },
      },
    },
    sourceMaps: true,
    stats: true,
  } as ConfigComplete;
}

function createLoaderSource(logPath: string): string {
  return `const fs = require("node:fs");
const { threadId } = require("node:worker_threads");
const logPath = ${JSON.stringify(logPath)};
module.exports = function transform(source) {
  const value = String(source).trim();
  fs.appendFileSync(logPath, threadId + ":" + process.env.NODE_ENV + ":" + process.env.EVJS_LOADER_TEST_ENV + ":" + value + "\\n");
  return "export default " + JSON.stringify(value) + ";";
};
`;
}

async function runSession(
  cwd: string,
  config: ConfigComplete,
  workerSchedulerBindingPath: string,
): Promise<void> {
  const port = await reservePort();
  const handle = startUtoopackDevWorker(
    {
      cwd,
      config,
      workerSchedulerBindingPath,
      server: {
        port,
        https: false,
        hostname: "127.0.0.1",
        logServerInfo: false,
      },
    },
    fixtureUrl,
  );

  try {
    await expect(handle.ready).resolves.toMatchObject({
      port,
      spaHistoryFallbackUpdated: false,
    });
    await expect(
      fs.promises.readFile(path.join(cwd, "dist/client/stats.json"), "utf8"),
    ).resolves.toContain("entrypoints");
    await handle.close();
    await expect(handle.done).resolves.toBeUndefined();
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function reservePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to reserve a native Utoopack test port.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}
