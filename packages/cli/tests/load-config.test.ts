import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, resolveConfigPath } from "../src/load-config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("loadConfig", () => {
  it("returns undefined when no config file exists", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({ name: "no-config" }),
    });

    expect(resolveConfigPath(cwd)).toBeUndefined();
    await expect(loadConfig(cwd)).resolves.toBeUndefined();
  });

  it("loads the first supported config file discovered in priority order", async () => {
    const cwd = await createFixture({
      "ev.config.js": `export default { entry: "./src/from-js.tsx" };`,
      "ev.config.ts": `
        import { defineConfig } from "@evjs/ev";
        export default defineConfig({ entry: "./src/from-ts.tsx" });
      `,
    });

    expect(path.basename(resolveConfigPath(cwd) ?? "")).toBe("ev.config.ts");
    await expect(loadConfig(cwd)).resolves.toMatchObject({
      entry: "./src/from-ts.tsx",
    });
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
