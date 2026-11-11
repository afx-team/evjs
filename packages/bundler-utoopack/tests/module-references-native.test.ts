import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const harnessPath = fileURLToPath(
  new URL("./fixtures/module-references-native-harness.mjs", import.meta.url),
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((cwd) => fs.rm(cwd, { recursive: true, force: true })),
  );
});

describe("planned module references with published native Utoopack", () => {
  it("builds shared reference exports without exposing the original module in browser JS or maps", async () => {
    const cwd = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "evjs-native-reference-")),
    );
    roots.push(cwd);
    const { stdout } = await execFileAsync(
      process.execPath,
      [harnessPath, cwd],
      {
        env: { ...process.env, UTOO_ROOT_PATH: cwd },
        maxBuffer: 4 * 1024 * 1024,
        timeout: 80_000,
        killSignal: "SIGKILL",
      },
    );
    const resultLine = stdout
      .split("\n")
      .find((line) => line.startsWith("EVJS_NATIVE_REFERENCE_RESULT="));
    expect(resultLine).toBeDefined();
    const result = JSON.parse(
      resultLine?.slice("EVJS_NATIVE_REFERENCE_RESULT=".length) ?? "null",
    ) as {
      capabilityVersion: number;
      plannedPluginId: string;
      canonicalResource: boolean;
      javascriptCount: number;
      sourceMapCount: number;
      originalSourceLeaked: boolean;
      sameIdentity: boolean;
      creations: number;
      greeting: string;
      originalEvaluations: number;
      ordinaryGreeting: string;
      ordinaryEvaluations: number;
    };
    expect(result).toMatchObject({
      capabilityVersion: 1,
      plannedPluginId: "greeting-reference",
      canonicalResource: true,
      originalSourceLeaked: false,
      sameIdentity: true,
      creations: 1,
      greeting: "Hello Ada",
      originalEvaluations: 0,
      ordinaryGreeting: "ordinary greeting",
      ordinaryEvaluations: 1,
    });
    expect(result.javascriptCount).toBeGreaterThan(0);
    expect(result.sourceMapCount).toBeGreaterThan(0);
  }, 90_000);
});
