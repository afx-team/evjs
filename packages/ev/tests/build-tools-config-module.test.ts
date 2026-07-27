import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfigFile } from "../src/_internal/build/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("loadConfigFile", () => {
  it("loads ev.config.ts without Node typeless package warnings", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({ name: "typeless-app" }),
      "ev.config.ts": `
        import { defineConfig, type Config } from "@evjs/ev";

        const config: Config = {
          routing: { mode: "spa" },
        };

        export default defineConfig(config);
      `,
    });
    let config: Awaited<ReturnType<typeof loadConfigFile>> | undefined;
    const warnings = await collectWarnings(async () => {
      config = await loadConfigFile(path.join(cwd, "ev.config.ts"));
    });

    expect(config).toMatchObject({
      routing: { mode: "spa" },
    });
    expect(
      warnings.some((warning) =>
        warning.includes("MODULE_TYPELESS_PACKAGE_JSON"),
      ),
    ).toBe(false);
    await expectNoTempConfigModules(cwd);
  });

  it("loads TypeScript config helper imports and observes helper edits", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({ name: "typed-config-helpers" }),
      "settings.ts": `export const html = "./first.html";`,
      "ev.config.ts": `
        import { defineConfig } from "@evjs/ev";
        import { html } from "./settings";

        export default defineConfig({ html });
      `,
    });
    const configPath = path.join(cwd, "ev.config.ts");

    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      html: "./first.html",
    });

    await fs.writeFile(
      path.join(cwd, "settings.ts"),
      `export const html = "./second.html";`,
    );

    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      html: "./second.html",
    });
  });

  it("supports ESM default imports throughout the config dependency closure", async () => {
    const cwd = await createFixture({
      "settings.ts": `
        import path from "node:path";

        export const html = path.join("pages", "index.html");
      `,
      "ev.config.ts": `
        import { html } from "./settings";

        export const marker = "named export";
        export default { html };
      `,
    });

    const config = await loadConfigFile(path.join(cwd, "ev.config.ts"));

    expect(config).toEqual({
      html: path.join("pages", "index.html"),
    });
  });

  it("loads isolated configs through exact framework package exports", async () => {
    const cwd = await createFixture(
      {
        "ev.config.ts": `
          import { defineConfig } from "@evjs/ev";
          import { nodeDeploymentAdapter } from "@evjs/ev/deployment";
          import { serve } from "@evjs/ev/_internal/server/node";

          export default defineConfig({
            html: typeof serve === "function" ? "./index.html" : "./missing.html",
            routing: { mode: "spa" },
            plugins: [nodeDeploymentAdapter()],
          });
        `,
      },
      os.tmpdir(),
    );

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.ts")),
    ).resolves.toMatchObject({
      html: "./index.html",
      routing: { mode: "spa" },
      plugins: [{ name: "node-deployment-adapter" }],
    });
  });

  it("does not expose unpublished framework source paths through aliases", async () => {
    const cwd = await createFixture({
      "ev.config.ts": `
        import { PLUGIN_HOOK_NAMES } from "@evjs/ev/plugin/hook-names";

        export default { html: String(PLUGIN_HOOK_NAMES.length) };
      `,
    });

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.ts")),
    ).rejects.toThrow("Failed to load evjs config");
  });

  it("preserves CommonJS config exports with default interop enabled", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({ type: "commonjs" }),
      "ev.config.js": `
        module.exports = {
          routing: { mode: "mpa" },
        };
      `,
    });

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.js")),
    ).resolves.toEqual({
      routing: { mode: "mpa" },
    });
  });

  it("reloads JavaScript ESM config files without native ESM cache staleness", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({ type: "module" }),
      "settings.mjs": `export const html = "./first.html";`,
      "ev.config.mjs": `
        import { html } from "./settings.mjs";
        export default { html };
      `,
    });
    const configPath = path.join(cwd, "ev.config.mjs");

    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      html: "./first.html",
    });

    await fs.writeFile(
      path.join(cwd, "settings.mjs"),
      `export const html = "./second.html";`,
    );

    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      html: "./second.html",
    });
  });
});

async function createFixture(
  files: Record<string, string>,
  root = path.resolve(process.cwd(), ".evjs", "tests"),
): Promise<string> {
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, "load-config-file-"));
  tempDirs.push(dir);

  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(dir, file);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
  }

  return dir;
}

async function collectWarnings(run: () => Promise<unknown>): Promise<string[]> {
  const originalEmitWarning = process.emitWarning;
  const warnings: string[] = [];
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    warnings.push(
      [
        warning instanceof Error ? warning.message : warning,
        ...args.map(String),
      ].join("\n"),
    );
    return true;
  }) as typeof process.emitWarning;

  try {
    await run();
  } finally {
    process.emitWarning = originalEmitWarning;
  }

  return warnings;
}

async function expectNoTempConfigModules(cwd: string): Promise<void> {
  const files = await fs.readdir(cwd);
  expect(files.filter((file) => file.startsWith(".evjs.config-"))).toEqual([]);
}
