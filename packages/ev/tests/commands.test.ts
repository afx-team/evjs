import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BuildOutput } from "@evjs/shared/manifest";
import { describe, expect, it } from "vitest";
import type { BundlerAdapter } from "../src/bundler.js";
import { build, type Config, dev, type Plugin } from "../src/index.js";

async function createProject() {
  const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), "evjs-"));
  await fs.promises.writeFile(
    path.join(cwd, "index.html"),
    '<div id="app"></div>',
    "utf-8",
  );
  return cwd;
}

function createMockBundler(
  events: string[],
): BundlerAdapter<Record<string, never>> {
  return {
    name: "mock",
    async build({ callbacks, config, cwd, plan }) {
      events.push("bundler.build");
      events.push(
        `bundler.entries:${plan.entries.map((entry) => entry.name).join(",")}`,
      );
      const output: BuildOutput = {
        version: 1,
        buildId: plan.buildId,
        distDir: plan.distDir,
        publicPath: plan.runtime.publicPath,
        runtime: {
          server: plan.runtime.server,
          transport: plan.runtime.transport,
        },
        assets: {
          main: { js: ["main.js"], css: [] },
        },
        apps: {
          default: {
            assets: { js: ["main.js"], css: [] },
            entry: "./src/main.tsx",
          },
        },
        pages: {},
        routes: [],
      };
      await callbacks.onBuildOutput(output);
      const dist = path.join(cwd, "dist");
      await fs.promises.mkdir(dist, { recursive: true });
      await fs.promises.writeFile(
        path.join(dist, "manifest.json"),
        JSON.stringify(output),
        "utf-8",
      );
      if (config.serverEnabled) {
        events.push(
          `bundler.endpoint:${config.server.functionRuntime.endpoint}`,
        );
      }
    },
    async dev() {
      events.push("bundler.dev");
    },
  };
}

describe("build", () => {
  it("requires a bundler from config or options", async () => {
    const cwd = await createProject();
    await expect(build({ server: false }, { cwd })).rejects.toThrow(
      "No bundler configured",
    );
  });

  it("runs framework orchestration around the injected bundler", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      name: "records-lifecycle",
      setup(ctx) {
        expect(ctx.config.bundler?.name).toBe("mock");
        events.push(`setup:${ctx.mode}`);
        return {
          commandStart(ctx) {
            events.push(`commandStart:${ctx.command}`);
          },
          buildStart() {
            events.push("buildStart");
          },
          appGraph(graph) {
            events.push(`appGraph:${Object.keys(graph.apps).join(",")}`);
          },
          buildPlan(plan) {
            events.push(
              `buildPlan:${plan.entries.map((entry) => entry.name).join(",")}`,
            );
          },
          buildOutput(output) {
            events.push(`buildOutput:${Object.keys(output.assets).join(",")}`);
            output.apps.default.assets.js = ["main.patched.js"];
          },
          buildEnd(result) {
            events.push(`buildEnd:${result.output.apps.default.assets.js[0]}`);
          },
          dispose(ctx) {
            events.push(`dispose:${ctx.mode}`);
          },
        };
      },
    };

    await build(
      { server: false, plugins: [plugin] },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "setup:production",
      "commandStart:build",
      "buildStart",
      "appGraph:default",
      "buildPlan:main",
      "bundler.build",
      "bundler.entries:main",
      "buildOutput:main",
      "buildEnd:main.patched.js",
      "dispose:production",
    ]);
  });

  it("passes callback BuildOutput to buildEnd without requiring a disk manifest", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const output: BuildOutput = {
      version: 1,
      buildId: "memory",
      distDir: "dist",
      publicPath: "/",
      runtime: {},
      assets: {},
      apps: {},
      pages: {},
      routes: [],
    };
    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "memory-output",
      async build({ callbacks }) {
        await callbacks.onBuildOutput(output);
      },
      async dev() {},
    };

    await build(
      {
        server: false,
        plugins: [
          {
            name: "reads-memory-output",
            setup() {
              return {
                buildEnd(result) {
                  events.push(result.output.buildId);
                },
              };
            },
          },
        ],
      },
      { cwd, bundler },
    );

    expect(events).toEqual(["memory"]);
    expect(fs.existsSync(path.join(cwd, "dist/manifest.json"))).toBe(false);
  });

  it("runs plugin config hooks before resolving config", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const plugin: Plugin<Record<string, never>> = {
      name: "sets-server-base-path",
      config(config, ctx) {
        events.push(`config:${ctx.mode}`);
        config.server = {
          ...(typeof config.server === "object" ? config.server : {}),
          basePath: "/api",
        };
        return config;
      },
      setup(ctx) {
        events.push(`setup:${ctx.config.server.functionRuntime.endpoint}`);
      },
    };

    await build(
      { plugins: [plugin] },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "config:production",
      "setup:/api/fn",
      "bundler.build",
      "bundler.entries:main,server",
      "bundler.endpoint:/api/fn",
    ]);
  });

  it("fails on graph analysis errors before running the bundler", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src"), { recursive: true });
    await fs.promises.writeFile(
      path.join(cwd, "src/main.tsx"),
      "console.log('main');",
      "utf-8",
    );
    await fs.promises.writeFile(
      path.join(cwd, "src/routes.tsx"),
      [
        'import { defineReactRoutes, page, route } from "@evjs/client";',
        'const modulePath = "./pages/Home.tsx";',
        "export default defineReactRoutes([",
        '  route("/", {',
        '    id: "home",',
        "    page: page(modulePath),",
        '    render: "ssr",',
        "  }),",
        "]);",
      ].join("\n"),
      "utf-8",
    );

    const events: string[] = [];
    const bundler = createMockBundler(events);
    let error: unknown;

    try {
      await build(
        {
          apps: {
            default: {
              entry: "./src/main.tsx",
              html: "./index.html",
              routes: "./src/routes.tsx",
            },
          },
        },
        {
          cwd,
          bundler,
        },
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "[evjs] App graph analysis failed.",
    );
    expect((error as Error).message).toContain("src/routes.tsx");
    expect((error as Error).message).toContain(
      '@evjs/client route() with render: "ssr" must declare page(componentPath) with a string literal component module path.',
    );
    expect(events).not.toContain("bundler.build");
  });

  it("orders plugin config and lifecycle hooks by dependencies", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    const pluginA: Plugin<Record<string, never>> = {
      name: "plugin-a",
      config(config) {
        events.push("config:a");
        return config;
      },
      setup() {
        events.push("setup:a");
        return {
          buildStart() {
            events.push("buildStart:a");
          },
          buildEnd() {
            events.push("buildEnd:a");
          },
        };
      },
    };
    const pluginB: Plugin<Record<string, never>> = {
      name: "plugin-b",
      dependencies: ["plugin-a"],
      config(config) {
        events.push("config:b");
        return config;
      },
      setup() {
        events.push("setup:b");
        return {
          buildStart() {
            events.push("buildStart:b");
          },
          buildEnd() {
            events.push("buildEnd:b");
          },
        };
      },
    };

    await build(
      { server: false, plugins: [pluginB, pluginA] },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "config:a",
      "config:b",
      "setup:a",
      "setup:b",
      "buildStart:a",
      "buildStart:b",
      "bundler.build",
      "bundler.entries:main",
      "buildEnd:a",
      "buildEnd:b",
    ]);
  });

  it("preserves user order for plugins unrelated to a dependency", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    function plugin(
      name: string,
      dependencies?: string[],
    ): Plugin<Record<string, never>> {
      return {
        name,
        dependencies,
        setup() {
          events.push(`setup:${name}`);
        },
      };
    }

    await build(
      {
        server: false,
        plugins: [
          plugin("plugin-a", ["plugin-c"]),
          plugin("plugin-b"),
          plugin("plugin-c"),
        ],
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "setup:plugin-b",
      "setup:plugin-c",
      "setup:plugin-a",
      "bundler.build",
      "bundler.entries:main",
    ]);
  });

  it("orders unrelated plugins by enforce tier", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await build(
      {
        server: false,
        plugins: [
          {
            name: "post",
            enforce: "post",
            setup() {
              events.push("setup:post");
            },
          },
          {
            name: "normal",
            setup() {
              events.push("setup:normal");
            },
          },
          {
            name: "pre",
            enforce: "pre",
            setup() {
              events.push("setup:pre");
            },
          },
        ],
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "setup:pre",
      "setup:normal",
      "setup:post",
      "bundler.build",
      "bundler.entries:main",
    ]);
  });

  it("orders plugins by optional dependencies when they are present", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    function plugin(
      name: string,
      options: Pick<
        Plugin<Record<string, never>>,
        "dependencies" | "optionalDependencies"
      > = {},
    ): Plugin<Record<string, never>> {
      return {
        name,
        ...options,
        setup() {
          events.push(`setup:${name}`);
        },
      };
    }

    await build(
      {
        server: false,
        plugins: [
          plugin("plugin-b", {
            dependencies: ["plugin-c"],
            optionalDependencies: ["plugin-a"],
          }),
          plugin("plugin-c"),
          plugin("plugin-a"),
        ],
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "setup:plugin-c",
      "setup:plugin-a",
      "setup:plugin-b",
      "bundler.build",
      "bundler.entries:main",
    ]);
  });

  it("ignores optional dependencies when they are missing", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await build(
      {
        server: false,
        plugins: [
          {
            name: "plugin-b",
            dependencies: ["plugin-c"],
            optionalDependencies: ["plugin-a"],
            setup() {
              events.push("setup:plugin-b");
            },
          },
          {
            name: "plugin-c",
            setup() {
              events.push("setup:plugin-c");
            },
          },
        ],
      },
      {
        cwd,
        bundler,
      },
    );

    expect(events).toEqual([
      "setup:plugin-c",
      "setup:plugin-b",
      "bundler.build",
      "bundler.entries:main",
    ]);
  });

  it("throws when a plugin dependency is missing", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          server: false,
          plugins: [{ name: "plugin-b", dependencies: ["plugin-a"] }],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow('Plugin "plugin-b" depends on missing plugin "plugin-a"');
  });

  it("throws on circular plugin dependencies", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          server: false,
          plugins: [
            { name: "plugin-a", dependencies: ["plugin-b"] },
            { name: "plugin-b", dependencies: ["plugin-a"] },
          ],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow(
      "Circular plugin dependency detected: plugin-a -> plugin-b -> plugin-a",
    );
  });

  it("throws when optional dependencies create a cycle", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          server: false,
          plugins: [
            { name: "plugin-a", optionalDependencies: ["plugin-b"] },
            { name: "plugin-b", dependencies: ["plugin-a"] },
          ],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow(
      "Circular plugin dependency detected: plugin-a -> plugin-b -> plugin-a",
    );
  });

  it("throws on duplicate plugin names", async () => {
    const cwd = await createProject();
    const events: string[] = [];
    const bundler = createMockBundler(events);

    await expect(
      build(
        {
          server: false,
          plugins: [{ name: "plugin-a" }, { name: "plugin-a" }],
        },
        { cwd, bundler },
      ),
    ).rejects.toThrow('Duplicate plugin name "plugin-a"');
  });
});

describe("dev", () => {
  it("runs dev plan update hooks when config changes add an MPA page", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/home"), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(cwd, "src/pages/orders"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(cwd, "src/pages/home/main.tsx"),
      "console.log('home');",
      "utf-8",
    );
    await fs.promises.writeFile(
      path.join(cwd, "src/pages/orders/main.tsx"),
      "console.log('orders');",
      "utf-8",
    );
    await fs.promises.writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default {};",
      "utf-8",
    );

    const events: string[] = [];
    const plugin: Plugin<Record<string, never>> = {
      name: "dev-plan-recorder",
      setup() {
        return {
          devPlanUpdate(update) {
            events.push(
              `hook:${update.entries.added.map((entry) => entry.name).join(",")}`,
            );
          },
        };
      },
    };
    let currentConfig: Config<Record<string, never>> = {
      server: false,
      pages: {
        home: "./src/pages/home/main.tsx",
      },
      plugins: [plugin],
    };

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      async build() {},
      async dev() {
        events.push("bundler.dev");
        return {
          async updatePlan(update) {
            events.push(
              `update:${update.entries.added.map((entry) => entry.name).join(",")}`,
            );
            process.emit("SIGINT");
          },
        };
      },
    };

    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    currentConfig = {
      ...currentConfig,
      pages: {
        ...currentConfig.pages,
        orders: "./src/pages/orders/main.tsx",
      },
    };
    await fs.promises.writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default { pages: { home: './src/pages/home/main.tsx', orders: './src/pages/orders/main.tsx' } };",
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("dev update timed out")), 2000),
      ),
    ]);

    expect(events).toEqual(["bundler.dev", "hook:orders", "update:orders"]);
  });

  it("recreates same-name plugin hooks when dev config changes", async () => {
    const cwd = await createProject();
    await fs.promises.mkdir(path.join(cwd, "src/pages/home"), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(cwd, "src/pages/orders"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(cwd, "src/pages/home/main.tsx"),
      "console.log('home');",
      "utf-8",
    );
    await fs.promises.writeFile(
      path.join(cwd, "src/pages/orders/main.tsx"),
      "console.log('orders');",
      "utf-8",
    );
    await fs.promises.writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default {};",
      "utf-8",
    );

    const events: string[] = [];
    function createPlugin(label: string): Plugin<Record<string, never>> {
      return {
        name: "same-name-plugin",
        setup() {
          return {
            devPlanUpdate(update) {
              events.push(
                `hook:${label}:${update.entries.added.map((entry) => entry.name).join(",")}`,
              );
            },
          };
        },
      };
    }

    let currentConfig: Config<Record<string, never>> = {
      server: false,
      pages: {
        home: "./src/pages/home/main.tsx",
      },
      plugins: [createPlugin("v1")],
    };

    const bundler: BundlerAdapter<Record<string, never>> = {
      name: "mock",
      async build() {},
      async dev() {
        events.push("bundler.dev");
        return {
          async updatePlan(update) {
            events.push(
              `update:${update.entries.added.map((entry) => entry.name).join(",")}`,
            );
            process.emit("SIGINT");
          },
        };
      },
    };

    const running = dev(currentConfig, {
      cwd,
      bundler,
      loadConfig() {
        return currentConfig;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    currentConfig = {
      ...currentConfig,
      pages: {
        ...currentConfig.pages,
        orders: "./src/pages/orders/main.tsx",
      },
      plugins: [createPlugin("v2")],
    };
    await fs.promises.writeFile(
      path.join(cwd, "ev.config.ts"),
      "export default { pages: { home: './src/pages/home/main.tsx', orders: './src/pages/orders/main.tsx' } };",
      "utf-8",
    );

    await Promise.race([
      running,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("dev update timed out")), 2000),
      ),
    ]);

    expect(events).toEqual(["bundler.dev", "hook:v2:orders", "update:orders"]);
  });
});
