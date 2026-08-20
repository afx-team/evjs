import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const harnessPath = fileURLToPath(
  new URL("./fixtures/dev-worker-native-owner-harness.mjs", import.meta.url),
);
const hostPreloadHarnessPath = fileURLToPath(
  new URL("./fixtures/dev-worker-host-preload-harness.mjs", import.meta.url),
);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((cwd) =>
      fs.promises.rm(cwd, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("Utoopack single native-owner Session replacement", () => {
  it("replaces Projects in one Worker without loading the addon in the host", async () => {
    const cwd = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "evjs-utoopack-native-owner-"),
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
    const port = await reservePort();

    const { stdout } = await execFileAsync(
      process.execPath,
      [harnessPath, cwd, loaderPath, String(port)],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          EVJS_LOADER_TEST_ENV: "inherited-from-host",
        },
        maxBuffer: 4 * 1024 * 1024,
        timeout: 30_000,
      },
    );
    const resultLine = stdout
      .split("\n")
      .find((line) => line.startsWith("EVJS_NATIVE_OWNER_RESULT="));
    expect(resultLine).toBeDefined();
    const result = JSON.parse(
      resultLine?.slice("EVJS_NATIVE_OWNER_RESULT=".length) ?? "null",
    ) as {
      firstOwnerThreadId: number;
      secondOwnerThreadId: number;
      hostLoadedBinding: boolean;
      buildModeRejected: boolean;
    };
    expect(result).toMatchObject({
      hostLoadedBinding: false,
      buildModeRejected: true,
    });
    expect(result.firstOwnerThreadId).toBeGreaterThan(0);
    expect(result.secondOwnerThreadId).toBe(result.firstOwnerThreadId);

    const { stdout: hostPreloadStdout } = await execFileAsync(
      process.execPath,
      [hostPreloadHarnessPath],
      {
        env: process.env,
        timeout: 10_000,
      },
    );
    expect(hostPreloadStdout).toContain(
      "host process already loaded @utoo/pack's native binding",
    );

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
  }, 30_000);
});

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
