import syncFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, resolveConfigPath } from "../src/load-config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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
      "ev.config.js": `export default { routing: { mode: "mpa" } };`,
      "ev.config.ts": `
        const mount: string = "#root";
        export default { routing: { mode: "spa", mount } };
      `,
    });

    expect(path.basename(resolveConfigPath(cwd) ?? "")).toBe("ev.config.ts");
    await expect(loadConfig(cwd)).resolves.toMatchObject({
      routing: { mode: "spa", mount: "#root" },
    });
  });

  it("does not skip an unreadable higher-priority config candidate", async () => {
    const cwd = await createFixture({
      "ev.config.js": `export default { routing: { mode: "mpa" } };`,
    });
    const typescriptConfig = path.join(cwd, "ev.config.ts");
    const originalLstat = syncFs.lstatSync.bind(syncFs);
    vi.spyOn(syncFs, "lstatSync").mockImplementation((file, options) => {
      if (path.resolve(String(file)) === typescriptConfig) {
        throw Object.assign(new Error("permission denied"), {
          code: "EACCES",
        });
      }
      return originalLstat(file, options as never);
    });

    expect(() => resolveConfigPath(cwd)).toThrow("permission denied");
    await expect(loadConfig(cwd)).rejects.toThrow("permission denied");
  });

  it("reports imported config dependencies before evaluation", async () => {
    const cwd = await createFixture({
      "ev.config.ts": `
        import { mount } from "./config/settings.js";
        export default { routing: { mode: "spa", mount } };
      `,
      "config/settings.ts": 'export const mount = "#root";',
    });
    const dependencies = new Set<string>();

    await expect(
      loadConfig(cwd, {
        onDependency(file) {
          dependencies.add(path.resolve(file));
        },
      }),
    ).resolves.toMatchObject({
      routing: { mode: "spa", mount: "#root" },
    });
    expect(dependencies).toContain(path.resolve(cwd, "config/settings.js"));
    expect(
      new Set(
        (
          await Promise.all(
            [...dependencies]
              .filter((file) => path.extname(file) !== ".json")
              .map((file) => fs.realpath(file).catch(() => undefined)),
          )
        ).filter((file): file is string => file !== undefined),
      ),
    ).toEqual(
      new Set([
        await fs.realpath(path.join(cwd, "ev.config.ts")),
        await fs.realpath(path.join(cwd, "config/settings.ts")),
      ]),
    );
  });

  it("rejects a config root symlink that escapes the project", async () => {
    const externalDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-config-external-"),
    );
    tempDirs.push(externalDirectory);
    const externalConfig = path.join(externalDirectory, "ev.config.ts");
    await fs.writeFile(
      externalConfig,
      'export default { routing: { mode: "spa" } };',
      "utf-8",
    );
    const cwd = await createFixture({
      "package.json": JSON.stringify({ name: "escaped-config" }),
    });
    await fs.symlink(externalConfig, path.join(cwd, "ev.config.ts"));

    await expect(loadConfig(cwd)).rejects.toThrow("Failed to load evjs config");
  });

  it("rejects an external file URL imported by project config", async () => {
    const externalDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-config-file-url-"),
    );
    tempDirs.push(externalDirectory);
    const externalHelper = path.join(externalDirectory, "settings.ts");
    await fs.writeFile(
      externalHelper,
      'export const mount = "#external";',
      "utf-8",
    );
    const cwd = await createFixture({
      "ev.config.ts": `
        import { mount } from ${JSON.stringify(pathToFileURL(externalHelper).href)};
        export default { routing: { mode: "spa", mount } };
      `,
    });

    await expect(loadConfig(cwd)).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining("resolves outside project root"),
      },
    });
  });

  it("resolves an in-project config symlink from its physical location", async () => {
    const cwd = await createFixture({
      "config/ev.config.ts": `
        import { mount } from "./settings.js";
        export default { routing: { mode: "spa", mount } };
      `,
      "config/settings.ts": 'export const mount = "#inside";',
    });
    const configLink = path.join(cwd, "ev.config.ts");
    await fs.symlink(path.join(cwd, "config/ev.config.ts"), configLink);
    const dependencies = new Set<string>();

    await expect(
      loadConfig(cwd, {
        onDependency(file) {
          dependencies.add(path.resolve(file));
        },
      }),
    ).resolves.toMatchObject({
      routing: { mode: "spa", mount: "#inside" },
    });
    expect(dependencies).toContain(configLink);
    expect(dependencies).toContain(path.join(cwd, "config/ev.config.ts"));
    expect(
      [...dependencies].some((file) => file.endsWith("config/settings.ts")),
    ).toBe(true);
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
