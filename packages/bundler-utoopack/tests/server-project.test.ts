import path from "node:path";
import type { ConfigComplete } from "@utoo/pack";
import { describe, expect, it } from "vitest";
import { createUtoopackClientDevConfig } from "../src/adapter/development/server-project.js";

describe("Utoopack client and server Project separation", () => {
  it("preserves client-only configurations", () => {
    const config: ConfigComplete = {
      entry: [{ name: "main", import: "./client.ts" }],
    };
    expect(createUtoopackClientDevConfig(config, process.cwd())).toBe(config);
  });

  it("keeps client Server Function transforms and isolates all implicit server writes", () => {
    const cwd = process.cwd();
    const config: ConfigComplete = {
      entry: [{ name: "main", import: "./client.ts" }],
      cacheDirectory: ".cache/custom",
      output: { path: path.join(cwd, "dist/client") },
      server: {
        entry: [{ name: "server", import: "./server.ts" }],
        function: {
          clientProxy: "client-transport",
          serverRegister: "server-register",
        },
        externals: { dependency: "commonjs dependency" },
        resolve: { alias: { backend: "./backend.ts" } },
        output: { path: path.join(cwd, "dist/server"), filename: "[name].js" },
      },
    };
    const result = createUtoopackClientDevConfig(config, cwd);

    expect(result.entry).toBe(config.entry);
    expect(result.output).toBe(config.output);
    expect(result.server?.entry).toBeUndefined();
    expect(result.server?.function).toBe(config.server?.function);
    expect(result.server?.externals).toBe(config.server?.externals);
    expect(result.server?.resolve).toBe(config.server?.resolve);
    expect(result.cacheDirectory).toBe(path.join(".cache/custom", "client"));
    expect(result.server?.output?.path).not.toBe(config.server?.output?.path);
    expect(path.relative(cwd, result.server?.output?.path ?? "")).toMatch(
      /^\.turbopack[/\\]/,
    );
    expect(result.server?.output?.filename).toBe("[name].js");
    expect(config.server?.entry).toEqual([
      { name: "server", import: "./server.ts" },
    ]);
    expect(config.cacheDirectory).toBe(".cache/custom");
  });

  it("keeps private output relative to an application outside the host cwd", () => {
    const cwd = path.resolve(process.cwd(), "../other-application");
    const config: ConfigComplete = {
      entry: [{ name: "main", import: "./client.ts" }],
      server: { entry: "./server.ts", output: { path: "./dist/server" } },
    };
    const output = createUtoopackClientDevConfig(config, cwd).server?.output
      ?.path;
    expect(output).toBeDefined();
    expect(path.isAbsolute(output ?? "")).toBe(false);
    expect(path.resolve(cwd, output ?? "")).toBe(
      path.join(cwd, ".turbopack/evjs/development/client-server"),
    );
  });
});
