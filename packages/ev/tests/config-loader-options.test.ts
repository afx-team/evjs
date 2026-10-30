import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const jitiMocks = vi.hoisted(() => ({
  createJiti: vi.fn((_filename: string, _options: Record<string, unknown>) =>
    Object.assign(() => ({}), {
      cache: Object.create(null),
      esmResolve: vi.fn(),
      evalModule: vi.fn(() => ({ default: { html: "./index.html" } })),
      resolve: vi.fn(() => {
        throw Object.assign(new Error("not found"), {
          code: "MODULE_NOT_FOUND",
        });
      }),
    }),
  ),
}));

vi.mock("jiti", () => jitiMocks);

import { loadConfigFile } from "../src/_internal/build/config-loading/config-module.js";

const tempDirs: string[] = [];

afterEach(async () => {
  jitiMocks.createJiti.mockClear();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("config loader options", () => {
  it("tries native module loading before transforming config dependencies", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-config-loader-"));
    tempDirs.push(cwd);
    const configPath = path.join(cwd, "ev.config.ts");
    await fs.writeFile(
      configPath,
      'import "example-package"; export default {};',
    );

    await expect(loadConfigFile(configPath)).resolves.toEqual({
      html: "./index.html",
    });

    expect(jitiMocks.createJiti).toHaveBeenCalledTimes(2);
    for (const [, options] of jitiMocks.createJiti.mock.calls) {
      expect(options).toMatchObject({
        fsCache: false,
        interopDefault: true,
        moduleCache: false,
        transformOptions: {},
        tryNative: true,
      });
    }
    expect(jitiMocks.createJiti.mock.calls[1]?.[1]).toMatchObject({
      nativeModules: ["example-package"],
    });
  });
});
