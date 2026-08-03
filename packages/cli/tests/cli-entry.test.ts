import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliProgramDependencies } from "../src/cli-program.js";

const entryMocks = vi.hoisted(() => ({
  build: vi.fn(async () => {}),
  dev: vi.fn(async (..._args: Parameters<CliProgramDependencies["dev"]>) => {}),
  loadConfig: vi.fn(async () => undefined),
  prepare: vi.fn(async () => {}),
}));

vi.mock("../src/index.js", () => ({
  build: entryMocks.build,
  dev: entryMocks.dev,
  prepare: entryMocks.prepare,
}));

vi.mock("../src/load-config.js", () => ({
  loadConfig: entryMocks.loadConfig,
}));

import { runCli } from "../src/cli.js";

describe("CLI entry", () => {
  beforeEach(() => {
    entryMocks.build.mockClear();
    entryMocks.dev.mockClear();
    entryMocks.loadConfig.mockClear();
    entryMocks.prepare.mockClear();
  });

  it("forwards the dev dependency observer to config loading", async () => {
    const onDependency = vi.fn();
    entryMocks.dev.mockImplementationOnce(async (_config, options) => {
      await options.loadConfig(options.cwd, { onDependency });
    });

    await expect(runCli(["node", "ev", "dev"])).resolves.toBe(0);

    expect(entryMocks.loadConfig).toHaveBeenCalledWith(process.cwd(), {
      onDependency,
    });
  });
});
