import path from "node:path";
import type { Config } from "@evjs/ev/config";
import type { CliFlags } from "@evjs/ev/plugin";
import { describe, expect, it, vi } from "vitest";
import type { DefaultBundlerConfig } from "../src/index.js";
import {
  type CliProgramDependencies,
  runCliProgram,
} from "../src/program/command-program.js";

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
    analysis: {
      capture: async () => ({ outputPath: "/project/.utoo/analyze" }),
      serveReport: async () => ({ url: "http://127.0.0.1:4000" }),
      async *exportReport() {},
      writeJsonLine(line) {
        stdout.push(line);
      },
    },
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

  it("forwards --no-shortcuts as cliShortcuts:false to the dev command", async () => {
    const dev = vi.fn(async () => {});
    const { dependencies } = createDependencies({ dev });

    await expect(
      runCliProgram(["node", "ev", "dev", "--no-shortcuts"], dependencies),
    ).resolves.toBe(0);

    expect(dev).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ cliShortcuts: false }),
    );
  });

  it("does not inject cliShortcuts when --no-shortcuts is absent", async () => {
    const dev = vi.fn(async () => {});
    const { dependencies } = createDependencies({ dev });

    await runCliProgram(["node", "ev", "dev"], dependencies);

    const options = (dev.mock.calls[0] as unknown[] | undefined)?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(options).not.toHaveProperty("cliShortcuts");
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

describe("CLI bundle analysis", () => {
  it("writes a static report with production plugin flags and no server", async () => {
    const { dependencies, stdout } = createDependencies();
    const capture = vi.spyOn(dependencies.analysis, "capture");
    const serveReport = vi.spyOn(dependencies.analysis, "serveReport");

    await expect(
      runCliProgram(
        [
          "node",
          "ev",
          "analyze",
          "--output",
          "--output-dir",
          "reports/before",
          "--profile",
          "export",
          "--include-mock=false",
        ],
        dependencies,
      ),
    ).resolves.toBe(0);

    expect(capture).toHaveBeenCalledWith(undefined, {
      cwd: "/project",
      flags: { profile: "export", includeMock: false },
      outputPath: "reports/before",
    });
    expect(serveReport).not.toHaveBeenCalled();
    expect(stdout).toEqual([
      "Analyzer report written to /project/.utoo/analyze\n",
    ]);
  });

  it("serves the captured report on the requested port", async () => {
    const { dependencies, stdout } = createDependencies();
    const serveReport = vi.spyOn(dependencies.analysis, "serveReport");

    await expect(
      runCliProgram(["node", "ev", "analyze", "--port", "0"], dependencies),
    ).resolves.toBe(0);

    expect(serveReport).toHaveBeenCalledWith("/project/.utoo/analyze", 0);
    expect(stdout.join("")).toContain(
      "Bundle Analyzer available at http://127.0.0.1:4000",
    );
  });

  it("streams JSONL from a saved report without loading project config", async () => {
    const loadConfig = vi.fn(async () => {
      throw new Error("Project config should not load for export");
    });
    const { dependencies, stdout } = createDependencies({ loadConfig });
    const capture = vi.spyOn(dependencies.analysis, "capture");
    const exportReport = vi
      .spyOn(dependencies.analysis, "exportReport")
      .mockImplementation(async function* () {
        yield { type: "meta", version: 1 };
        expect(stdout).toHaveLength(1);
        yield { type: "entry", name: "api" };
      });

    await expect(
      runCliProgram(
        [
          "node",
          "ev",
          "analyze",
          "export",
          "--report",
          "reports/before",
          "--entry",
          "api",
          "--environment",
          "server",
        ],
        dependencies,
      ),
    ).resolves.toBe(0);

    expect(loadConfig).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(exportReport).toHaveBeenCalledWith(
      path.resolve("/project", "reports/before"),
      { entry: "api", environment: "server" },
    );
    expect(stdout).toEqual([
      '{"type":"meta","version":1}\n',
      '{"type":"entry","name":"api"}\n',
    ]);
  });

  it.each<[string[], string]>([
    [["--port", "65536"], "Analyzer port must be an integer"],
    [
      ["export", "--environment", "browser"],
      "Allowed choices are client, server",
    ],
    [["export", "--output"], "only supported by ev analyze (capture)"],
  ])("rejects invalid analysis flags %j before starting work", async (args, diagnostic) => {
    const loadConfig = vi.fn(async () => undefined);
    const { dependencies, stderr, stdout } = createDependencies({ loadConfig });
    const exportReport = vi.spyOn(dependencies.analysis, "exportReport");

    await expect(
      runCliProgram(["node", "ev", "analyze", ...args], dependencies),
    ).resolves.toBe(1);

    expect(loadConfig).not.toHaveBeenCalled();
    expect(exportReport).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain(diagnostic);
  });
});
