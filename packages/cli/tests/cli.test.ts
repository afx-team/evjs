import type { Config } from "@evjs/ev/config";
import type { CliFlags } from "@evjs/ev/plugin";
import { describe, expect, it, vi } from "vitest";
import {
  type CliProgramDependencies,
  runCliProgram,
} from "../src/cli-program.js";
import type { DefaultBundlerConfig } from "../src/index.js";

function createDependencies(overrides: Partial<CliProgramDependencies> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const errors: Array<{ summary: string; error: unknown }> = [];
  const command = async (
    _config: Config<DefaultBundlerConfig> | undefined,
    _options: { cwd: string; flags: CliFlags },
  ) => {};
  const dependencies: CliProgramDependencies = {
    version: "0.0.0-test",
    cwd: () => "/project",
    loadConfig: async () => undefined,
    dev: command,
    build: command,
    prepare: command,
    inspect: async () => ({ exitCode: 0, output: "inspect output\n" }),
    writeStdout: (output) => stdout.push(output),
    writeStderr: (output) => stderr.push(output),
    reportError: (summary, error) => errors.push({ summary, error }),
    ...overrides,
  };
  return { dependencies, stdout, stderr, errors };
}

describe("CLI execution", () => {
  it("delegates dev config loading to the framework watcher handshake", async () => {
    const loadConfig = vi.fn(async () => undefined);
    const dev = vi.fn(async () => {});
    const { dependencies } = createDependencies({ dev, loadConfig });

    await expect(
      runCliProgram(["node", "ev", "dev"], dependencies),
    ).resolves.toBe(0);

    expect(loadConfig).not.toHaveBeenCalled();
    expect(dev).toHaveBeenCalledWith(undefined, {
      cwd: "/project",
      flags: {},
      loadConfig,
    });
  });

  it("awaits an asynchronous command before resolving", async () => {
    let finishBuild: (() => void) | undefined;
    let markBuildStarted: (() => void) | undefined;
    const buildStarted = new Promise<void>((resolve) => {
      markBuildStarted = resolve;
    });
    const buildFinished = new Promise<void>((resolve) => {
      finishBuild = resolve;
    });
    const build = vi.fn(async () => {
      markBuildStarted?.();
      await buildFinished;
    });
    const { dependencies } = createDependencies({ build });

    let resolved = false;
    const execution = runCliProgram(["node", "ev", "build"], dependencies);
    void execution.then(() => {
      resolved = true;
    });
    await buildStarted;
    await Promise.resolve();

    expect(resolved).toBe(false);
    finishBuild?.();
    await expect(execution).resolves.toBe(0);
    expect(build).toHaveBeenCalledOnce();
  });

  it("reports config-load failures once and resolves with failure", async () => {
    const configError = new Error("invalid ev.config.ts");
    const build = vi.fn(async () => {});
    const { dependencies, errors } = createDependencies({
      loadConfig: async () => {
        throw configError;
      },
      build,
    });

    await expect(
      runCliProgram(["node", "ev", "build"], dependencies),
    ).resolves.toBe(1);
    expect(build).not.toHaveBeenCalled();
    expect(errors).toEqual([{ summary: "Build failed", error: configError }]);
  });

  it("reports command failures once and resolves with failure", async () => {
    const buildError = new Error("bundler failed");
    const { dependencies, errors } = createDependencies({
      build: async () => {
        throw buildError;
      },
    });

    await expect(
      runCliProgram(["node", "ev", "build"], dependencies),
    ).resolves.toBe(1);
    expect(errors).toEqual([{ summary: "Build failed", error: buildError }]);
  });

  it("returns inspect diagnostics as a failure without duplicate reporting", async () => {
    const { dependencies, stdout, errors } = createDependencies({
      inspect: async () => ({ exitCode: 1, output: "invalid project\n" }),
    });

    await expect(
      runCliProgram(["node", "ev", "inspect"], dependencies),
    ).resolves.toBe(1);
    expect(stdout).toEqual(["invalid project\n"]);
    expect(errors).toEqual([]);
  });

  it("keeps JSON inspect failures machine-readable", async () => {
    const { dependencies, stdout, errors } = createDependencies({
      inspect: async () => {
        throw new Error("invalid config");
      },
    });

    await expect(
      runCliProgram(["node", "ev", "inspect", "--json"], dependencies),
    ).resolves.toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      diagnostics: [{ level: "error", message: "invalid config" }],
    });
    expect(errors).toEqual([]);
  });

  it("maps Commander parse failures to an exit code without re-reporting", async () => {
    const { dependencies, stderr, errors } = createDependencies();

    await expect(
      runCliProgram(["node", "ev", "unknown"], dependencies),
    ).resolves.toBe(1);
    expect(stderr.join("")).toContain("unknown command 'unknown'");
    expect(errors).toEqual([]);
  });
});
