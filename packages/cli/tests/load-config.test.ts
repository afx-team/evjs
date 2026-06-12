import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/load-config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("loadConfig", () => {
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
    let config: Awaited<ReturnType<typeof loadConfig>>;
    const warnings = await collectWarnings(async () => {
      config = await loadConfig(cwd);
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
    await expectTempConfigModules(cwd, []);
  });
});

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = path.resolve(process.cwd(), ".evjs", "tests");
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, "load-config-"));
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

async function expectTempConfigModules(
  cwd: string,
  expected: string[],
): Promise<void> {
  const files = await fs.readdir(cwd);
  expect(files.filter((file) => file.startsWith(".evjs.config-"))).toEqual(
    expected,
  );
}
