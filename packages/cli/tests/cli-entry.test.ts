import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProgramDependencies } from "../src/program/command-program.js";

const entryMocks = vi.hoisted(() => ({
  build: vi.fn(async () => {}),
  runDev: vi.fn(
    async (
      ..._args: [...Parameters<CliProgramDependencies["dev"]>, boolean]
    ) => {},
  ),
  loadConfig: vi.fn(async () => undefined),
  prepare: vi.fn(async () => {}),
}));

vi.mock("../src/api/framework-commands.js", () => ({
  build: entryMocks.build,
  runDev: entryMocks.runDev,
  prepare: entryMocks.prepare,
}));

vi.mock("../src/config/load.js", () => ({
  loadConfig: entryMocks.loadConfig,
}));

import { runCli } from "../src/cli.js";

describe("CLI entry", () => {
  beforeEach(() => {
    entryMocks.build.mockClear();
    entryMocks.runDev.mockClear();
    entryMocks.loadConfig.mockClear();
    entryMocks.prepare.mockClear();
  });

  it("forwards config dependencies and opts the dev executable into forced exit", async () => {
    const onDependency = vi.fn();
    entryMocks.runDev.mockImplementationOnce(async (_config, options) => {
      await options.loadConfig(options.cwd, { onDependency });
    });

    await expect(runCli(["node", "ev", "dev"])).resolves.toBe(0);

    expect(entryMocks.runDev).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ cwd: process.cwd() }),
      true,
    );
    expect(entryMocks.loadConfig).toHaveBeenCalledWith(process.cwd(), {
      onDependency,
    });
  });
});
