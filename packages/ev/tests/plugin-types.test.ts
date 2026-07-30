import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectGeneratedPluginTypeFiles,
  generatePluginTypes,
  getPluginTypesPath,
  isGeneratedPluginTypesFile,
  PLUGIN_TYPES_FILE,
  PLUGIN_TYPES_MARKER,
  PLUGIN_TYPES_USAGE_HINT,
  removeGeneratedPluginTypes,
  syncPluginTypes,
  writePluginTypesIfChanged,
} from "../src/_internal/build/plugin-types.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("generatePluginTypes", () => {
  it("augments one registry hook with the exact static config type", () => {
    const source = generatePluginTypes({});

    expect(source).toContain(PLUGIN_TYPES_MARKER);
    expect(source).toContain(PLUGIN_TYPES_USAGE_HINT);
    expect(source).toContain(
      'readonly config: typeof import("../ev.config").default;',
    );
    expect(source).not.toContain("ExtractInstalledPlugin");
  });

  it("does not import JavaScript config as an unsafe any type", () => {
    const source = generatePluginTypes({ configModule: false });

    expect(source).not.toContain("typeof import(");
    expect(source).toContain("Exact Page plugin types require ev.config.ts");
  });

  it("resolves the config import relative to src/plugin-types.d.ts", () => {
    const cwd = path.resolve("/workspace/app");

    expect(getPluginTypesPath(cwd)).toEqual({
      dir: path.join(cwd, "src"),
      file: path.join(cwd, "src", PLUGIN_TYPES_FILE),
      configModule: "../ev.config",
    });
    expect(getPluginTypesPath(cwd, "config/ev.config.mjs").configModule).toBe(
      "../config/ev.config.mjs",
    );
  });

  it("does not duplicate a relative project cwd in the config import", () => {
    expect(getPluginTypesPath("fixtures/app").configModule).toBe(
      "../ev.config",
    );
  });
});

describe("plugin type output", () => {
  it("writes stable content and reports only the owned canonical file", async () => {
    const cwd = await createTempDir();

    await syncPluginTypes({
      cwd,
      configSource: path.join(cwd, "ev.config.ts"),
    });

    const file = path.join(cwd, "src", PLUGIN_TYPES_FILE);
    const firstSource = await fs.readFile(file, "utf-8");
    const firstStat = await fs.stat(file, { bigint: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await syncPluginTypes({
      cwd,
      configSource: path.join(cwd, "ev.config.ts"),
    });
    const secondStat = await fs.stat(file, { bigint: true });

    expect(firstSource).toContain(
      'readonly config: typeof import("../ev.config").default;',
    );
    expect(secondStat.mtimeNs).toBe(firstStat.mtimeNs);
    await expect(isGeneratedPluginTypesFile(file)).resolves.toBe(true);
    await expect(collectGeneratedPluginTypeFiles(cwd)).resolves.toEqual([file]);
  });

  it("keeps the static config bridge when no runtime plugins are active", async () => {
    const cwd = await createTempDir();
    await writeFixtureFiles(cwd, {
      "ev.config.ts": "export default {};\n",
    });
    await syncPluginTypes({ cwd });
    const file = path.join(cwd, "src", PLUGIN_TYPES_FILE);

    await syncPluginTypes({ cwd });

    await expect(fs.readFile(file, "utf-8")).resolves.toContain(
      'readonly config: typeof import("../ev.config").default;',
    );
    await expect(removeGeneratedPluginTypes(cwd)).resolves.toBe(true);
  });

  it("discovers the root config from a relative project cwd", async () => {
    const cwd = await createTempDir();
    const relativeCwd = path.relative(process.cwd(), cwd);
    await writeFixtureFiles(cwd, {
      "ev.config.ts": "export default {};\n",
    });

    await syncPluginTypes({ cwd: relativeCwd });

    await expect(
      fs.readFile(path.join(cwd, "src", PLUGIN_TYPES_FILE), "utf-8"),
    ).resolves.toContain(
      'readonly config: typeof import("../ev.config").default;',
    );
  });

  it("never overwrites a user-owned declaration with the canonical name", async () => {
    const cwd = await createTempDir();
    const file = path.join(cwd, "src", PLUGIN_TYPES_FILE);
    await writeFixtureFiles(cwd, {
      "ev.config.ts": "export default {};\n",
      "src/plugin-types.d.ts": "declare const userOwned: true;\n",
    });

    await expect(removeGeneratedPluginTypes(cwd)).resolves.toBe(false);
    await expect(syncPluginTypes({ cwd })).rejects.toThrow(
      "Plugin types output must not overwrite a user-owned output file",
    );

    await expect(fs.readFile(file, "utf-8")).resolves.toBe(
      "declare const userOwned: true;\n",
    );
  });

  it("discovers the actual config extension and removes a stale bridge when no config exists", async () => {
    const cwd = await createTempDir();
    await writeFixtureFiles(cwd, {
      "ev.config.mjs": "export default {};\n",
    });
    const file = path.join(cwd, "src", PLUGIN_TYPES_FILE);

    await syncPluginTypes({ cwd });
    const source = await fs.readFile(file, "utf-8");
    expect(source).not.toContain("typeof import(");
    expect(source).toContain("Exact Page plugin types require ev.config.ts");

    await fs.rm(path.join(cwd, "ev.config.mjs"));
    await syncPluginTypes({ cwd });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not claim a user file that merely mentions the generated marker", async () => {
    const cwd = await createTempDir();
    const file = path.join(cwd, "src", PLUGIN_TYPES_FILE);
    const userSource = `// ${PLUGIN_TYPES_MARKER}\ndeclare const userOwned: true;\n`;
    await writeFixtureFiles(cwd, {
      "ev.config.ts": "export default {};\n",
      "src/plugin-types.d.ts": userSource,
    });

    await expect(isGeneratedPluginTypesFile(file)).resolves.toBe(false);
    await expect(syncPluginTypes({ cwd })).rejects.toThrow(
      "Plugin types output must not overwrite a user-owned output file",
    );
    await expect(fs.readFile(file, "utf-8")).resolves.toBe(userSource);
  });

  it("does not claim declarations from the removed legacy generator", async () => {
    const cwd = await createTempDir();
    const file = path.join(cwd, "src", PLUGIN_TYPES_FILE);
    const legacySource = [
      "/* eslint-disable */",
      "// This file is generated by evjs. Do not edit it directly.",
      PLUGIN_TYPES_USAGE_HINT,
      'declare module "@evjs/ev/config" {',
      "  interface InstalledPluginRegistry {}",
      "}",
      "",
    ].join("\n");
    await writeFixtureFiles(cwd, {
      "ev.config.ts": "export default {};\n",
      "src/plugin-types.d.ts": legacySource,
    });

    await expect(isGeneratedPluginTypesFile(file)).resolves.toBe(false);
    await expect(syncPluginTypes({ cwd })).rejects.toThrow(
      "Plugin types output must not overwrite a user-owned output file",
    );
    await expect(fs.readFile(file, "utf-8")).resolves.toBe(legacySource);
  });

  it("does not follow a plugin declaration output symlink", async () => {
    const cwd = await createTempDir();
    const file = path.join(cwd, "src", PLUGIN_TYPES_FILE);
    const sentinel = path.join(cwd, "sentinel.d.ts");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(sentinel, "declare const sentinel: true;", "utf-8");
    await fs.symlink(sentinel, file);

    await expect(isGeneratedPluginTypesFile(file)).resolves.toBe(false);

    await expect(
      writePluginTypesIfChanged(file, PLUGIN_TYPES_MARKER, cwd),
    ).rejects.toThrow(
      "Plugin types output must not overwrite a symbolic-link output file",
    );
    await expect(fs.readFile(sentinel, "utf-8")).resolves.toBe(
      "declare const sentinel: true;",
    );
  });

  it("type-checks the generated config import with a src rootDir", async () => {
    const cwd = await createTempDir();
    await writeFixtureFiles(cwd, {
      "ev.config.ts": `
        interface AnalyticsPlugin {
          readonly key: "analytics";
          readonly pageOptions: true;
          readonly channel: "checkout";
        }
        interface ConditionalPlugin {
          readonly key: "conditional-analytics";
          readonly pageOptions: true;
        }
        interface BranchAPlugin {
          readonly key: "branch-a";
          readonly pageOptions: true;
        }
        interface BranchBPlugin {
          readonly key: "branch-b";
          readonly pageOptions: true;
        }
        declare const condition: boolean;
        declare const enabled: AnalyticsPlugin;
        declare const disabled: AnalyticsPlugin;
        declare const conditional: ConditionalPlugin;
        declare const branchA: BranchAPlugin;
        declare const branchB: BranchBPlugin;
        declare const applicationOnly: {
          readonly name: "@test/application-only";
          readonly key: "application-only";
        };
        export default {
          plugins: [
            condition ? enabled : disabled,
            condition && conditional,
            condition ? branchA : branchB,
            condition ? false : null,
            undefined,
            applicationOnly,
          ] as const,
        };
      `,
      "src/framework-config.ts": `
        export interface InstalledPluginRegistry {}
        type InactivePluginEntry = false | null | undefined;
        type IsUnion<TValue, TCandidate = TValue> =
          TValue extends TCandidate
            ? [TCandidate] extends [TValue]
              ? false
              : true
            : never;
        type TupleIndex<TTuple extends readonly unknown[]> = Exclude<
          keyof TTuple,
          keyof unknown[]
        >;
        type DefinitelyInstalledPluginEntries<
          TPlugins extends readonly unknown[]
        > = IsUnion<TPlugins> extends true
          ? never
          : {
              [TIndex in TupleIndex<TPlugins>]: [
                Extract<TPlugins[TIndex], InactivePluginEntry>
              ] extends [never]
                ? IsUnion<TPlugins[TIndex]> extends true
                  ? never
                  : Exclude<TPlugins[TIndex], InactivePluginEntry>
                : never;
            }[TupleIndex<TPlugins>];
        export type ConfiguredPlugin<TConfig> =
          [TConfig] extends [
            Readonly<{
              plugins: infer TPlugins extends readonly unknown[]
            }>
          ]
            ? DefinitelyInstalledPluginEntries<TPlugins>
            : never;
        export type ExtractInstalledPlugin<TConfig, TKey extends string> =
          Extract<ConfiguredPlugin<TConfig>, { readonly key: TKey }>;
        type InstalledConfig =
          InstalledPluginRegistry extends { readonly config: infer TConfig }
            ? TConfig
            : never;
        export type InstalledPlugin = ConfiguredPlugin<InstalledConfig>;
        type PluginPageKey<TPlugin> =
          TPlugin extends {
            readonly key: infer TKey extends string;
            readonly pageOptions: true;
          }
            ? TKey
            : never;
        export type InstalledPagePluginKey =
          PluginPageKey<InstalledPlugin>;
        export type DeterministicTupleKey = PluginPageKey<
          ConfiguredPlugin<{
            readonly plugins: readonly [
              {
                readonly key: "tuple-analytics";
                readonly pageOptions: true;
              }
            ]
          }>
        >;
        export type ConditionalConfigKey = PluginPageKey<
          ConfiguredPlugin<
            | {
                readonly plugins: readonly [
                  {
                    readonly key: "conditional-config-a";
                    readonly pageOptions: true;
                  }
                ]
              }
            | {
                readonly plugins: readonly [
                  {
                    readonly key: "conditional-config-b";
                    readonly pageOptions: true;
                  }
                ]
              }
          >
        >;
        export type ConditionalPluginArrayKey = PluginPageKey<
          ConfiguredPlugin<{
            readonly plugins:
              | readonly [{
                  readonly key: "conditional-array-a";
                  readonly pageOptions: true;
                }]
              | readonly [{
                  readonly key: "conditional-array-b";
                  readonly pageOptions: true;
                }]
          }>
        >;
        export type WidenedPluginArrayKey = PluginPageKey<
          ConfiguredPlugin<{
            readonly plugins: readonly {
              readonly key: "widened-analytics";
              readonly pageOptions: true;
            }[]
          }>
        >;
      `,
      "src/page.config.ts": `
        import type {
          ConditionalConfigKey,
          ConditionalPluginArrayKey,
          DeterministicTupleKey,
          ExtractInstalledPlugin,
          InstalledPagePluginKey,
          InstalledPlugin,
          InstalledPluginRegistry,
          WidenedPluginArrayKey,
        } from "@evjs/ev/config";
        type Plugin = ExtractInstalledPlugin<
          InstalledPluginRegistry["config"],
          "analytics"
        >;
        const key: InstalledPagePluginKey = "analytics";
        const plugin: Plugin = {
          key: "analytics",
          pageOptions: true,
          channel: "checkout",
        };
        const deterministicTupleKey: DeterministicTupleKey =
          "tuple-analytics";
        // @ts-expect-error A conditional config does not guarantee either plugin.
        const conditionalConfigKey: ConditionalConfigKey =
          "conditional-config-a";
        // @ts-expect-error A conditional plugin array does not guarantee either plugin.
        const conditionalPluginArrayKey: ConditionalPluginArrayKey =
          "conditional-array-a";
        // @ts-expect-error A widened array may be empty at runtime.
        const widenedPluginArrayKey: WidenedPluginArrayKey =
          "widened-analytics";
        // @ts-expect-error Application-only plugins have no Page key.
        const applicationOnlyKey: InstalledPagePluginKey = "application-only";
        // @ts-expect-error Runtime false/null/undefined branches are excluded.
        const inactiveKey: InstalledPagePluginKey = "inactive";
        // @ts-expect-error A conditionally omitted plugin is not definitely installed.
        const conditionalKey: InstalledPagePluginKey = "conditional-analytics";
        // @ts-expect-error Neither side of a conditional plugin branch is guaranteed.
        const branchAKey: InstalledPagePluginKey = "branch-a";
        // @ts-expect-error Neither side of a conditional plugin branch is guaranteed.
        const branchBKey: InstalledPagePluginKey = "branch-b";
        type InactivePlugin = Extract<
          InstalledPlugin,
          false | null | undefined
        >;
        // @ts-expect-error Inactive config sentinels are not plugin instances.
        const inactivePlugin: InactivePlugin = false;
        void key;
        void plugin;
        void deterministicTupleKey;
        void conditionalConfigKey;
        void conditionalPluginArrayKey;
        void widenedPluginArrayKey;
        void applicationOnlyKey;
        void inactiveKey;
        void conditionalKey;
        void branchAKey;
        void branchBKey;
        void inactivePlugin;
      `,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          ignoreDeprecations: "6.0",
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          paths: {
            "@evjs/ev/config": ["./src/framework-config.ts"],
          },
          rootDir: "src",
          strict: true,
          target: "ESNext",
        },
        include: ["src"],
      }),
    });
    await syncPluginTypes({ cwd });

    const tsc = require.resolve("typescript/bin/tsc");
    await expect(
      execFileAsync(process.execPath, [tsc, "--project", "tsconfig.json"], {
        cwd,
      }),
    ).resolves.toMatchObject({ stderr: "" });
  });

  it("type-checks unified keys against the public plugin API", async () => {
    const cwd = await createTempDir();
    const packageRoot = path.resolve(import.meta.dirname, "..");
    await writeFixtureFiles(cwd, {
      "ev.config.ts": `
        import { defineConfig } from "@evjs/ev";
        import { definePlugin, pluginOptions } from "@evjs/ev/plugin";

        const analytics = definePlugin({
          name: "@test/analytics",
          key: "analytics",
          page: pluginOptions<{ channel: string }>(),
        });
        const deploy = definePlugin({
          name: "@test/deploy",
          key: "deploy",
          application: pluginOptions({ defaults: { region: "local" } }),
        });
        const hooksOnly = definePlugin({
          name: "@test/hooks-only",
          setup() {},
        });
        const assertInvalidDescriptors = () => {
          // @ts-expect-error Options contracts require one public key.
          definePlugin({
            name: "@test/missing-key",
            application: pluginOptions({ defaults: {} }),
          });
          definePlugin({
            name: "@test/invalid-hooks-key",
            // @ts-expect-error Hooks-only plugins cannot claim a settings key.
            key: "invalid-hooks-key",
            setup() {},
          });
        };
        void assertInvalidDescriptors;

        export default defineConfig({
          plugins: [analytics(), deploy(), hooksOnly()],
        });
      `,
      "src/page.config.ts": `
        import { definePageConfig } from "@evjs/ev";

        definePageConfig({
          plugins: {
            analytics: { channel: "checkout" },
          },
        });
        definePageConfig({
          plugins: {
            // @ts-expect-error Application-only keys are not Page config keys.
            deploy: false,
          },
        });
      `,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          ignoreDeprecations: "6.0",
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          paths: {
            "@evjs/ev": [path.join(packageRoot, "src/index.ts")],
            "@evjs/ev/config": [path.join(packageRoot, "src/config/index.ts")],
            "@evjs/ev/plugin": [path.join(packageRoot, "src/plugin/index.ts")],
          },
          skipLibCheck: true,
          strict: true,
          target: "ESNext",
          typeRoots: [path.resolve(packageRoot, "../../node_modules/@types")],
          types: ["node"],
        },
        include: ["ev.config.ts", "src"],
      }),
    });
    await syncPluginTypes({ cwd });

    const tsc = require.resolve("typescript/bin/tsc");
    await expect(
      execFileAsync(process.execPath, [tsc, "--project", "tsconfig.json"], {
        cwd,
      }),
    ).resolves.toMatchObject({ stderr: "" });
  });

  it("keeps JavaScript configs from widening the Page registry to any", async () => {
    const cwd = await createTempDir();
    await writeFixtureFiles(cwd, {
      "ev.config.mjs": `
        export default { plugins: [{ key: "analytics" }] };
      `,
      "src/framework-config.ts": `
        export interface InstalledPluginRegistry {}
      `,
      "src/page.config.ts": `
        import type { InstalledPluginRegistry } from "@evjs/ev/config";
        type InstalledConfig =
          InstalledPluginRegistry extends { readonly config: infer TConfig }
            ? TConfig
            : never;
        type IsAny<TValue> = 0 extends (1 & TValue) ? true : false;
        const configIsNotAny: IsAny<InstalledConfig> = false;
        void configIsNotAny;
      `,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          ignoreDeprecations: "6.0",
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          paths: {
            "@evjs/ev/config": ["./src/framework-config.ts"],
          },
          rootDir: "src",
          strict: true,
          target: "ESNext",
        },
        include: ["src"],
      }),
    });
    await syncPluginTypes({ cwd });

    const tsc = require.resolve("typescript/bin/tsc");
    await expect(
      execFileAsync(process.execPath, [tsc, "--project", "tsconfig.json"], {
        cwd,
      }),
    ).resolves.toMatchObject({ stderr: "" });
  });
});

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ev-plugin-types-"));
  tempDirs.push(dir);
  return dir;
}

async function writeFixtureFiles(
  cwd: string,
  files: Record<string, string>,
): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, source]) => {
      const file = path.join(cwd, relativePath);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, source, "utf-8");
    }),
  );
}
