import type { Config } from "@evjs/ev/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

const devMocks = vi.hoisted(() => ({
  defaultLoadConfig: vi.fn(async () => undefined),
  frameworkDev: vi.fn(async () => {}),
}));

vi.mock("@evjs/ev/_internal/build", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@evjs/ev/_internal/build")>();
  return { ...actual, dev: devMocks.frameworkDev };
});

vi.mock("../src/load-config.js", () => ({
  loadConfig: devMocks.defaultLoadConfig,
}));

import { dev } from "../src/index.js";

const userConfig: Config = { routing: { mode: "spa" } };

describe("programmatic dev config loading", () => {
  beforeEach(() => {
    devMocks.defaultLoadConfig.mockClear();
    devMocks.frameworkDev.mockClear();
  });

  it("loads the initial config by default when none was supplied", async () => {
    await dev();

    expect(devMocks.frameworkDev).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        loadConfig: devMocks.defaultLoadConfig,
        reloadInitialConfig: true,
      }),
    );
  });

  it("keeps a supplied config authoritative by default", async () => {
    await dev(userConfig);

    expect(devMocks.frameworkDev).toHaveBeenCalledWith(
      userConfig,
      expect.objectContaining({
        loadConfig: undefined,
        reloadInitialConfig: false,
      }),
    );
  });

  it("uses a custom loader only for later reloads when explicitly requested", async () => {
    const loadConfig = vi.fn(async () => userConfig);

    await dev(userConfig, { loadConfig, reloadInitialConfig: false });

    expect(devMocks.frameworkDev).toHaveBeenCalledWith(
      userConfig,
      expect.objectContaining({ loadConfig, reloadInitialConfig: false }),
    );
  });

  it("uses the default loader when an initial reload is explicitly requested", async () => {
    await dev(userConfig, { reloadInitialConfig: true });

    expect(devMocks.frameworkDev).toHaveBeenCalledWith(
      userConfig,
      expect.objectContaining({
        loadConfig: devMocks.defaultLoadConfig,
        reloadInitialConfig: true,
      }),
    );
  });

  it("honors an explicit opt-out even when no config was supplied", async () => {
    await dev(undefined, { reloadInitialConfig: false });

    expect(devMocks.frameworkDev).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        loadConfig: undefined,
        reloadInitialConfig: false,
      }),
    );
  });

  it("forwards cliShortcuts:false to the framework dev entrypoint", async () => {
    await dev(userConfig, { cliShortcuts: false });

    expect(devMocks.frameworkDev).toHaveBeenCalledWith(
      userConfig,
      expect.objectContaining({ cliShortcuts: false }),
    );
  });

  it("omits cliShortcuts when no override is supplied", async () => {
    await dev(userConfig);

    const [, options] = devMocks.frameworkDev.mock.calls[0];
    expect(options).not.toHaveProperty("cliShortcuts");
  });
});
