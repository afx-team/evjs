import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadConfigFile,
  resolvePluginSettingsState,
} from "../src/_internal/build/index.js";
import { resolveConfig } from "../src/config/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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

  it("fails closed when a config dependency cannot be read", async () => {
    const cwd = await createFixture({
      "settings.ts": 'export const html = "./index.html";',
      "ev.config.ts": `
        import { html } from "./settings.js";
        export default { html };
      `,
    });
    const settingsPath = path.join(cwd, "settings.ts");
    const originalReadFile = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementation(async (...args) => {
      if (path.resolve(String(args[0])) === settingsPath) {
        throw Object.assign(new Error("permission denied"), {
          code: "EACCES",
        });
      }
      return originalReadFile(...args);
    });

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.ts")),
    ).rejects.toMatchObject({ cause: { code: "EACCES" } });
  });

  it("observes TypeScript import-equals config dependencies", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({ name: "import-equals-config" }),
      "settings.ts": `export const html = "./first.html";`,
      "ev.config.ts": `
        import settings = require("./settings.js");
        export default { html: settings.html };
      `,
    });
    const configPath = path.join(cwd, "ev.config.ts");
    const settingsPath = path.join(cwd, "settings.ts");
    const dependencies = new Set<string>();

    await expect(
      loadConfigFile(configPath, {
        onDependency(file) {
          dependencies.add(path.resolve(file));
        },
      }),
    ).resolves.toMatchObject({ html: "./first.html" });
    expect(dependencies).toContain(settingsPath);

    await fs.writeFile(settingsPath, `export const html = "./second.html";`);
    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      html: "./second.html",
    });
  });

  it("observes require.resolve targets without traversing them", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({ name: "resolved-config-helper" }),
      "nested.ts": 'export const value = "nested";',
      "settings.ts": `
        import { value } from "./nested.js";
        export { value };
      `,
      "ev.config.ts": `
        const settingsPath = require.resolve("./settings.js");
        export default {
          html: settingsPath.endsWith("settings.ts")
            ? "./resolved.html"
            : "./unexpected.html",
        };
      `,
    });
    const dependencies = new Set<string>();

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.ts"), {
        onDependency(file) {
          dependencies.add(path.resolve(file));
        },
      }),
    ).resolves.toMatchObject({ html: "./resolved.html" });
    expect(dependencies).toContain(path.join(cwd, "settings.ts"));
    expect(dependencies).not.toContain(path.join(cwd, "nested.ts"));
  });

  it("does not parse JSON string values as module references", async () => {
    const cwd = await createFixture({
      "settings.json": JSON.stringify({
        html: "./json.html",
        note: "import '../../outside' and require.resolve('../elsewhere')",
      }),
      "ev.config.ts": `
        import settings from "./settings.json";
        export default { html: settings.html };
      `,
    });

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.ts")),
    ).resolves.toMatchObject({ html: "./json.html" });
  });

  it("observes a missing project-local file URL before it is created", async () => {
    const cwd = await createFixture({});
    const settingsPath = path.join(cwd, "settings.ts");
    const configPath = path.join(cwd, "ev.config.ts");
    await fs.writeFile(
      configPath,
      `
        import { html } from ${JSON.stringify(pathToFileURL(settingsPath).href)};
        export default { html };
      `,
      "utf-8",
    );
    const dependencies = new Set<string>();

    await expect(
      loadConfigFile(configPath, {
        onDependency(file) {
          dependencies.add(path.resolve(file));
        },
      }),
    ).rejects.toThrow("Failed to load evjs config");
    expect(dependencies).toContain(settingsPath);

    await fs.writeFile(
      settingsPath,
      'export const html = "./recovered.html";',
      "utf-8",
    );
    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      html: "./recovered.html",
    });
  });

  it("reloads package self-reference mappings from the current manifest", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({
        name: "self-referenced-config",
        exports: { "./settings": "./first.ts" },
      }),
      "first.ts": 'export const html = "./first.html";',
      "second.ts": 'export const html = "./second.html";',
      "ev.config.ts": `
        import { html } from "self-referenced-config/settings";
        export default { html };
      `,
    });
    const configPath = path.join(cwd, "ev.config.ts");

    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      html: "./first.html",
    });
    await fs.writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        name: "self-referenced-config",
        exports: { "./settings": "./second.ts" },
      }),
    );

    await expect(loadConfigFile(configPath)).resolves.toMatchObject({
      html: "./second.html",
    });
  });

  it("delegates a same-name package without exports to node_modules", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({ name: "same-name-config" }),
      "node_modules/same-name-config/package.json": JSON.stringify({
        name: "same-name-config",
        main: "index.js",
      }),
      "node_modules/same-name-config/index.js":
        'module.exports = { html: "./installed.html" };',
      "ev.config.ts": `
        import { html } from "same-name-config";
        export default { html };
      `,
    });

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.ts")),
    ).resolves.toMatchObject({ html: "./installed.html" });
  });

  it("rejects mixed subpath and condition keys in package exports", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({
        name: "mixed-exports-config",
        exports: {
          ".": "./index.ts",
          node: "./node.ts",
        },
      }),
      "index.ts": 'export const html = "./index.html";',
      "node.ts": 'export const html = "./node.html";',
      "ev.config.ts": `
        import { html } from "mixed-exports-config";
        export default { html };
      `,
    });

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.ts")),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "cannot mix subpath and condition keys",
        ),
      },
    });
  });

  it("does not add extension or index probing to package targets", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({
        name: "exact-package-targets",
        imports: { "#settings": "./settings" },
      }),
      "settings/index.ts": 'export const html = "./unexpected.html";',
      "ev.config.ts": `
        import { html } from "#settings";
        export default { html };
      `,
    });

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.ts")),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "has no matching static config target",
        ),
      },
    });
  });

  it.each([
    ["direct", { import: "./import.ts" }],
    ["nested", { node: { import: "./import.ts" } }],
  ])("uses an import-only %s package condition", async (_label, target) => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({
        name: "import-only-config",
        exports: target,
      }),
      "import.ts": 'export const html = "./import.html";',
      "ev.config.ts": `
        import { html } from "import-only-config";
        export default { html };
      `,
    });

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.ts")),
    ).resolves.toMatchObject({ html: "./import.html" });
  });

  it("rejects conflicting package aliases from nested scopes", async () => {
    const cwd = await createFixture({
      "package.json": JSON.stringify({
        imports: { "#settings": "./root-settings.ts" },
      }),
      "root-settings.ts": 'export const root = "root";',
      "nested/package.json": JSON.stringify({
        imports: { "#settings": "./nested-settings.ts" },
      }),
      "nested/nested-settings.ts": 'export const nested = "nested";',
      "nested/helper.ts": `
        import { nested } from "#settings";
        export { nested };
      `,
      "ev.config.ts": `
        import { root } from "#settings";
        import { nested } from "./nested/helper";
        export default { html: String(root + nested) };
      `,
    });

    await expect(
      loadConfigFile(path.join(cwd, "ev.config.ts")),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "Nested package scopes must not map the same specifier",
        ),
      },
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
      plugins: [{ id: "node-deployment-adapter" }],
    });
  });

  it("preserves defined plugin settings across the config loader boundary", async () => {
    const setupResultKey = Symbol.for(
      "@evjs/test/config-loader-plugin-setting",
    );
    const globalValues = globalThis as Record<PropertyKey, unknown>;
    const cwd = await createFixture({
      "ev.config.ts": `
        import { defineConfig } from "@evjs/ev";
        import { definePlugin, pluginConfig } from "@evjs/ev/plugin";

        const analytics = definePlugin({
          id: "analytics",
          application: pluginConfig({
            defaults: { channel: "web" },
          }),
          page: pluginConfig({
            defaults: { channel: "page" },
          }),
          setup(context) {
            globalThis[Symbol.for("@evjs/test/config-loader-plugin-setting")] =
              context.options;
          },
        });

        export default defineConfig({ plugins: [analytics()] });
      `,
    });

    try {
      const loaded = await loadConfigFile(path.join(cwd, "ev.config.ts"));
      const resolved = resolveConfig(loaded);
      const state = resolvePluginSettingsState(resolved);

      expect(state.applicationSettings.analytics).toEqual({ enabled: true });
      await resolved.plugins[0]?.setup?.({} as never);
      expect(globalValues[setupResultKey]).toEqual({ channel: "web" });
    } finally {
      delete globalValues[setupResultKey];
    }
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
