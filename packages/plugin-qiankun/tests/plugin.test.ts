import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedConfig } from "@evjs/ev/config";
import type { Plugin, PluginContext } from "@evjs/ev/plugin";
import { describe, expect, it } from "vitest";
import { evPluginQiankunMaster, evPluginQiankunSlave } from "../src/index.js";

const qiankunRuntime = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/runtime.ts",
);
const require = createRequire(import.meta.url);
const entryLoader = require("../src/entry-loader.cjs") as (this: {
  cacheable?(): void;
  getOptions(): Record<string, string>;
  resourcePath: string;
  rootContext: string;
}) => string;

describe("@evjs/plugin-qiankun plugin", () => {
  it("wraps the master app entry with a webpack loader rule without generating temporary entries", async () => {
    const cwd = await createProject({
      "src/main.tsx": "console.log('entry');",
      "src/qiankun.master.ts": "export default async () => ({ apps: [] });",
    });
    const watched: string[] = [];
    const plugin = evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    });
    const hooks = await setupPlugin(plugin, cwd, watched, {
      app: { entry: "./src/main.tsx" },
    });
    const bundlerConfig = createWebpackConfig();

    await hooks?.buildStart?.(
      createPluginContext(cwd, [], { app: { entry: "./src/main.tsx" } }),
    );
    await hooks?.bundlerConfig?.(
      bundlerConfig as never,
      createBundlerContext(cwd, "webpack"),
    );

    expect(watched).toEqual([
      path.join(cwd, "src/main.tsx"),
      path.join(cwd, "src/qiankun.master.ts"),
      qiankunRuntime,
    ]);
    expect(await exists(path.join(cwd, ".evjs"))).toBe(false);

    const rule = firstWebpackRule(bundlerConfig);
    expect(rule.test.test(toImportPath(path.join(cwd, "src/main.tsx")))).toBe(
      true,
    );
    expect(rule.resourceQuery.not[0].test("?evjs-qiankun-original")).toBe(true);
    expect(rule.use[0].loader).toContain("entry-loader.cjs");
    expect(rule.use[0].options).toEqual({
      role: "master",
      qiankunRuntime,
      resolver: path.join(cwd, "src/qiankun.master.ts"),
      resolverExport: "default",
    });
  });

  it("wraps a master file-convention SPA pages entry without app.entry", async () => {
    const cwd = await createProject({
      "src/pages/index.tsx": "export default function Home() { return null; }",
      "src/qiankun.master.ts": "export default async () => ({ apps: [] });",
    });
    const watched: string[] = [];
    const plugin = evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    });
    const hooks = await setupPlugin(plugin, cwd, watched, {
      routing: createSpaRoutingConfig(),
    });
    const bundlerConfig = createWebpackPagesConfig();

    await hooks?.buildStart?.(
      createPluginContext(cwd, [], { routing: createSpaRoutingConfig() }),
    );
    await hooks?.bundlerConfig?.(
      bundlerConfig as never,
      createBundlerContext(cwd, "webpack"),
    );

    expect(watched).toEqual([
      path.join(cwd, "src/qiankun.master.ts"),
      qiankunRuntime,
    ]);

    const qiankunRule = firstWebpackRule(bundlerConfig);
    expect(qiankunRule.test.test(webpackPagesEntryAnchor)).toBe(true);
    expect(qiankunRule.use[0].options).toMatchObject({
      role: "master",
      qiankunRuntime,
      resolver: path.join(cwd, "src/qiankun.master.ts"),
    });

    const rules = (bundlerConfig.module as { rules: unknown[] }).rules;
    expect(
      rules.some(
        (rule) =>
          isRecord(rule) &&
          rule.resourceQuery instanceof RegExp &&
          rule.resourceQuery.test("?evjs-qiankun-original") &&
          Array.isArray(rule.use) &&
          rule.use.some(
            (item) =>
              isRecord(item) &&
              typeof item.loader === "string" &&
              item.loader.includes("pages-entry-loader.cjs"),
          ),
      ),
    ).toBe(true);
  });

  it("wraps the slave app entry with a utoopack loader rule and package-name default", async () => {
    const cwd = await createProject({
      "package.json": JSON.stringify({ name: "console" }),
      "src/main.tsx": "console.log('entry');",
      "src/qiankun.slave.ts": "export default {};",
    });
    const plugin = evPluginQiankunSlave({
      runtime: "./src/qiankun.slave.ts",
    });
    const hooks = await setupPlugin(plugin, cwd, [], {
      app: { entry: "./src/main.tsx", mount: "#root" },
    });
    const bundlerConfig: Record<string, unknown> = {
      entry: [{ name: "main", import: "./src/main.tsx" }],
    };

    await hooks?.buildStart?.(
      createPluginContext(cwd, [], {
        app: { entry: "./src/main.tsx", mount: "#root" },
      }),
    );
    await hooks?.bundlerConfig?.(
      bundlerConfig as never,
      createBundlerContext(cwd, "utoopack"),
    );

    const rule = ((
      (bundlerConfig.module as Record<string, unknown>).rules as Record<
        string,
        Record<string, unknown>[]
      >
    )["**/*"] ?? [])[0];
    expect(rule.condition).toMatchObject({ query: "" });
    expect(
      (rule.condition as { path: RegExp }).path.test(
        toImportPath(path.join(cwd, "src/main.tsx")),
      ),
    ).toBe(true);
    expect((rule.condition as { path: RegExp }).path.test("src/main.tsx")).toBe(
      true,
    );
    expect(rule.loaders).toEqual([
      {
        loader: expect.stringContaining("entry-loader.cjs"),
        options: {
          role: "slave",
          qiankunRuntime,
          runtime: path.join(cwd, "src/qiankun.slave.ts"),
          runtimeExport: "default",
          name: "console",
          mount: "#root",
        },
      },
    ]);
    expect(bundlerConfig.entry).toEqual([
      {
        name: "main",
        import: "./src/main.tsx",
        library: { name: "console" },
      },
    ]);
  });

  it("wraps a slave file-convention SPA pages entry with utoopack", async () => {
    const cwd = await createProject({
      "package.json": JSON.stringify({ name: "catalog" }),
      "src/pages/index.tsx": "export default function Home() { return null; }",
    });
    const plugin = evPluginQiankunSlave();
    const hooks = await setupPlugin(plugin, cwd, [], {
      routing: createSpaRoutingConfig(),
    });
    const bundlerConfig: Record<string, unknown> = {
      entry: [{ name: "main", import: utoopackPagesEntryAnchor }],
      module: {
        rules: {
          "**/*": [
            {
              condition: {
                path: /pages-entry-anchor\.js$/,
                query: "",
              },
              loaders: [{ loader: utoopackPagesEntryLoader, options: {} }],
            },
          ],
        },
      },
    };

    await hooks?.bundlerConfig?.(
      bundlerConfig as never,
      createBundlerContext(cwd, "utoopack"),
    );

    const rules = (
      (bundlerConfig.module as Record<string, unknown>).rules as Record<
        string,
        Record<string, unknown>[]
      >
    )["**/*"];
    const qiankunRule = rules[0];
    expect(qiankunRule.condition).toMatchObject({ query: "" });
    expect(
      (qiankunRule.condition as { path: RegExp }).path.test(
        utoopackPagesEntryAnchor,
      ),
    ).toBe(true);
    expect(qiankunRule.loaders).toEqual([
      {
        loader: expect.stringContaining("entry-loader.cjs"),
        options: {
          role: "slave",
          qiankunRuntime,
          name: "catalog",
          mount: "#app",
        },
      },
    ]);
    expect(
      rules.some(
        (rule) =>
          isRecord(rule.condition) &&
          rule.condition.query === "?evjs-qiankun-original" &&
          Array.isArray(rule.loaders) &&
          rule.loaders.some(
            (item) =>
              isRecord(item) &&
              typeof item.loader === "string" &&
              item.loader.includes("pages-entry-loader.cjs"),
          ),
      ),
    ).toBe(true);
    expect(bundlerConfig.entry).toEqual([
      {
        name: "main",
        import: utoopackPagesEntryAnchor,
        library: { name: "catalog" },
      },
    ]);
  });

  it("configures webpack slave output as a qiankun-consumable library", async () => {
    const cwd = await createProject({
      "package.json": JSON.stringify({ name: "catalog" }),
      "src/main.tsx": "console.log('entry');",
    });
    const plugin = evPluginQiankunSlave();
    const hooks = await setupPlugin(plugin, cwd, [], {
      app: { entry: "./src/main.tsx" },
    });
    const bundlerConfig = createWebpackConfig();

    await hooks?.bundlerConfig?.(
      bundlerConfig as never,
      createBundlerContext(cwd, "webpack"),
    );

    expect(bundlerConfig.entry).toEqual({
      main: {
        import: "./src/main.tsx",
        library: { name: "catalog", type: "umd" },
      },
    });
  });

  it("accepts absolute modules from upper-layer plugins", async () => {
    const cwd = await createProject({
      "src/main.tsx": "console.log('entry');",
      ".platform/generated-master.ts":
        "export const resolver = async () => ({ apps: [] });",
    });
    const generatedResolver = path.join(cwd, ".platform/generated-master.ts");
    const plugin = evPluginQiankunMaster({
      resolver: {
        module: generatedResolver,
        exportName: "resolver",
      },
    });
    const hooks = await setupPlugin(plugin, cwd, [], {});
    const bundlerConfig = createWebpackConfig();

    await hooks?.bundlerConfig?.(
      bundlerConfig as never,
      createBundlerContext(cwd, "webpack"),
    );

    const rule = firstWebpackRule(bundlerConfig);
    expect(rule.use[0].options).toMatchObject({
      resolver: generatedResolver,
      resolverExport: "resolver",
    });
  });

  it("marks qiankun as external when requested", async () => {
    const cwd = await createProject({
      "src/main.tsx": "console.log('entry');",
      "src/qiankun.master.ts": "export default async () => ({ apps: [] });",
    });
    const plugin = evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
      externalQiankun: true,
    });
    const hooks = await setupPlugin(plugin, cwd, [], {});
    const bundlerConfig = createWebpackConfig();

    await hooks?.bundlerConfig?.(
      bundlerConfig as never,
      createBundlerContext(cwd, "webpack"),
    );

    expect(bundlerConfig.externals).toEqual({ qiankun: "qiankun" });
  });

  it("generates entry loader code with the plugin-resolved qiankun runtime path", () => {
    const repoRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    const resourcePath = path.join(
      repoRoot,
      "packages/bundler-utoopack/esm/adapter/pages-entry-anchor.js",
    );
    const source = entryLoader.call({
      getOptions: () => ({
        role: "master",
        qiankunRuntime,
        resolver: path.join(
          repoRoot,
          "examples/qiankun-master/src/qiankun.master.ts",
        ),
      }),
      resourcePath,
      rootContext: repoRoot,
    });

    expect(source).not.toContain("@evjs/plugin-qiankun/runtime");
    expect(source).not.toContain(repoRoot);
    expect(source).toContain(
      "../../../../examples/qiankun-master/src/qiankun.master.ts",
    );
    expect(source).toContain("../../../plugin-qiankun/src/runtime.ts");
    expect(source).toContain("./pages-entry-anchor.js?evjs-qiankun-original");
  });

  it("rejects mpa routing and explicit pages", async () => {
    const cwd = await createProject({
      "src/main.tsx": "console.log('entry');",
      "src/qiankun.master.ts": "export default async () => ({ apps: [] });",
    });
    const plugin = evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    });

    await expect(
      setupPlugin(plugin, cwd, [], {
        routing: { ...createSpaRoutingConfig(), mode: "mpa" },
      }),
    ).rejects.toThrow("only supports SPA file routing");
    await expect(
      setupPlugin(plugin, cwd, [], {
        pages: {
          home: { entry: "./src/main.tsx" },
        } as never,
      }),
    ).rejects.toThrow("only supports a single SPA app entry");
  });
});

const webpackPagesEntryAnchor =
  "/repo/packages/bundler-webpack/src/adapter/pages-entry-anchor.js";
const webpackPagesEntryLoader =
  "/repo/packages/bundler-webpack/src/adapter/pages-entry-loader.cjs";
const utoopackPagesEntryAnchor =
  "/repo/packages/bundler-utoopack/src/adapter/pages-entry-anchor.js";
const utoopackPagesEntryLoader =
  "/repo/packages/bundler-utoopack/src/adapter/pages-entry-loader.cjs";

async function setupPlugin(
  plugin: Plugin,
  cwd: string,
  watched: string[],
  config: Partial<ResolvedConfig>,
) {
  return await plugin.setup?.(createPluginContext(cwd, watched, config));
}

async function createProject(files: Record<string, string>): Promise<string> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-qiankun-"));
  if (!files["package.json"]) {
    files["package.json"] = JSON.stringify({ name: "app" });
  }
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(cwd, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source, "utf-8");
  }
  return cwd;
}

function createPluginContext(
  cwd: string,
  watched: string[],
  config: Partial<ResolvedConfig>,
): PluginContext {
  return {
    cwd,
    command: "build",
    mode: "production",
    config: {
      entry: "./src/main.tsx",
      html: "./index.html",
      plugins: [],
      ...config,
    } as never,
    logger: {} as never,
    addWatchFile(file) {
      watched.push(file);
    },
  };
}

function createBundlerContext(cwd: string, bundlerName: string) {
  return {
    cwd,
    command: "build",
    mode: "production",
    config: {} as never,
    bundlerName,
    environment: "client",
    logger: {} as never,
    addWatchFile() {},
  } as never;
}

function createWebpackConfig(): Record<string, unknown> {
  return {
    name: "client",
    target: "web",
    entry: {
      main: {
        import: "./src/main.tsx",
      },
    },
    module: { rules: [] },
  };
}

function createWebpackPagesConfig(): Record<string, unknown> {
  return {
    name: "client",
    target: "web",
    entry: {
      main: {
        import: webpackPagesEntryAnchor,
      },
    },
    module: {
      rules: [
        {
          test: /pages-entry-anchor\.js$/,
          resourceQuery: /^$/,
          use: [{ loader: webpackPagesEntryLoader, options: {} }],
        },
      ],
    },
  };
}

function firstWebpackRule(config: Record<string, unknown>) {
  return ((config.module as { rules: unknown[] }).rules[0] ?? {}) as {
    test: RegExp;
    resourceQuery: { not: RegExp[] };
    use: [{ loader: string; options: Record<string, string> }];
  };
}

function createSpaRoutingConfig() {
  return {
    mode: "spa" as const,
    dir: "./src/pages",
    html: "./index.html",
    mount: "#app",
    routes: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function toImportPath(file: string): string {
  return file.split(path.sep).join(path.posix.sep);
}
