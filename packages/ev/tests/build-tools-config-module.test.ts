import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfigFile } from "../src/build-tools/index.js";

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
          entry: "./src/app.tsx",
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
      entry: "./src/app.tsx",
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
      "settings.ts": `export const entry = "./src/first.tsx";`,
      "ev.config.ts": `
        import { defineConfig } from "@evjs/ev";
        import { entry } from "./settings";

        export default defineConfig({ entry });
      `,
    });
    const configPath = path.join(cwd, "ev.config.ts");

    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      entry: "./src/first.tsx",
    });

    await fs.writeFile(
      path.join(cwd, "settings.ts"),
      `export const entry = "./src/second.tsx";`,
    );

    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      entry: "./src/second.tsx",
    });
  });

  it("loads isolated configs that import the framework package", async () => {
    const cwd = await createFixture(
      {
        "ev.config.ts": `
          import { defineConfig } from "@evjs/ev";
          export default defineConfig({ entry: "./src/isolated.tsx" });
        `,
      },
      os.tmpdir(),
    );

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.ts")),
    ).resolves.toMatchObject({
      entry: "./src/isolated.tsx",
    });
  });

  it("reloads JavaScript ESM config files without native ESM cache staleness", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({ type: "module" }),
      "ev.config.mjs": `export default { entry: "./src/first.tsx" };`,
    });
    const configPath = path.join(cwd, "ev.config.mjs");

    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      entry: "./src/first.tsx",
    });

    await fs.writeFile(
      configPath,
      `export default { entry: "./src/second.tsx" };`,
    );

    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      entry: "./src/second.tsx",
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
