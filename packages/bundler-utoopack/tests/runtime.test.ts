import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ConfigComplete } from "@utoo/pack";
import { describe, expect, it, vi } from "vitest";
import {
  runUtoopackBuild,
  runUtoopackDevServer,
} from "../src/adapter/execution/utoopack.js";

const PROJECT_PATH = "/workspace/apps/example";
const config = {} as ConfigComplete;

describe("Utoopack runtime invocation", () => {
  it("anchors builds to the project and lets Utoopack discover the workspace root", async () => {
    const build = vi.fn(
      async (..._args: Parameters<typeof import("@utoo/pack")["build"]>) => {},
    );

    await runUtoopackBuild({ build }, config, PROJECT_PATH);

    expect(build).toHaveBeenCalledWith({ config }, PROJECT_PATH);
  });

  it.each([
    false,
    true,
  ])("cleans the private server-only anchor after build, failure=%s", async (fails) => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-server-only-"));
    const serverConfig = {
      entry: [],
      output: { path: path.join(cwd, "public") },
      server: { entry: "server.ts" },
    } as ConfigComplete;
    let anchor = "";
    const build = vi.fn(
      async (options: Parameters<typeof import("@utoo/pack")["build"]>[0]) => {
        const actual = (options as { config: ConfigComplete }).config;
        anchor = actual.entry?.[0].import ?? "";
        expect(await fs.readFile(anchor, "utf8")).toBe("export {};\n");
        expect(actual.output?.path).toBe(
          path.join(path.dirname(anchor), "client"),
        );
        expect(actual.server).toBe(serverConfig.server);
        if (fails) throw new Error("native compilation failed");
      },
    );
    try {
      const result = runUtoopackBuild({ build }, serverConfig, cwd);
      if (fails)
        await expect(result).rejects.toThrow("native compilation failed");
      else await result;
      expect(serverConfig.entry).toEqual([]);
      expect(await fs.readdir(cwd)).toEqual([]);
      expect(anchor).not.toBe("");
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("retains a server-only dev anchor until the session closes", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-server-only-dev-"),
    );
    const config = {
      entry: [],
      server: { entry: "server.ts" },
    } as ConfigComplete;
    const serve = vi.fn(
      async (..._args: Parameters<typeof import("@utoo/pack")["serve"]>) => {},
    );
    try {
      const dispose = await runUtoopackDevServer({ serve }, config, cwd, {
        port: 3000,
      });
      expect(await fs.readdir(cwd)).toHaveLength(1);
      await dispose();
      expect(await fs.readdir(cwd)).toEqual([]);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("anchors dev to the project and lets Utoopack discover the workspace root", async () => {
    const serve = vi.fn(
      async (..._args: Parameters<typeof import("@utoo/pack")["serve"]>) => {},
    );
    const serverOptions = {
      port: 3000,
      https: false,
      hostname: "0.0.0.0",
      logServerInfo: false,
    };

    await runUtoopackDevServer({ serve }, config, PROJECT_PATH, serverOptions);

    expect(serve).toHaveBeenCalledWith(
      { config },
      PROJECT_PATH,
      undefined,
      serverOptions,
    );
  });
});
