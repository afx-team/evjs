import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createBuildPlan,
  materializeFrameworkIR,
} from "@evjs/ev/_internal/build";
import type { ResolvedConfig } from "@evjs/ev/config";
import type { Plugin } from "@evjs/ev/plugin";
import type {
  CoreGraph,
  CoreRoutePattern,
  RenderMode,
  ServerRouteNode,
} from "@evjs/shared/manifest";
import { describe, expect, it } from "vitest";
import {
  createWebpackConfigs,
  type WebpackConfigs,
} from "../src/adapter/create-config.js";

describe("createWebpackConfigs", () => {
  it("uses a generated pages app entry for framework-managed pages", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

    const entry = configs[0]?.entry as Record<string, { import: string }>;
    expect(entry.main?.import).toBe("./.ev/entries/main.ts");
    expect(configs[0]?.output?.publicPath).toBe("auto");
    expect(configs[0]?.output?.crossOriginLoading).toBe("anonymous");
    expect(configs[0]?.infrastructureLogging).toEqual({ level: "warn" });
    expect(configs[0]?.stats).toEqual({
      assets: true,
      entrypoints: true,
    });
    expect(configs[0]?.resolve?.alias).toMatchObject({
      "@": path.resolve(process.cwd(), "src"),
    });
    const definePlugin = configs[0]?.plugins?.find(
      (plugin) =>
        plugin &&
        typeof plugin === "object" &&
        plugin.constructor.name === "DefinePlugin",
    ) as { definitions?: Record<string, string> } | undefined;
    expect(definePlugin?.definitions).toMatchObject({
      "process.env.EVJS_FUNCTION_ENDPOINT": JSON.stringify("__evjs/fn"),
      __EVJS_FUNCTION_ENDPOINT__: JSON.stringify("__evjs/fn"),
    });
  });

  it("uses active BuildPlan outputs and function endpoint when config differs", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config, {
      pages: [
        {
          id: "dashboard",
          path: "/dashboard",
          module: "./src/pages/dashboard.tsx",
          render: "ssr",
        },
      ],
    });
    const generatedPlan = await createGeneratedPlan(
      config,
      graph,
      "development",
    );
    const plan = {
      ...generatedPlan,
      distDir: "plan-dist",
      output: {
        clientDir: "plan-dist/browser",
        serverDir: "plan-dist/runtime",
      },
      runtime: {
        ...generatedPlan.runtime,
        server: {
          ...generatedPlan.runtime.server,
          fn: "plan-runtime/fn",
        },
      },
    };

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);
    const clientConfig = configs.find((item) => item.name === "client");
    const serverConfig = configs.find((item) => item.name === "server");
    const definePlugin = clientConfig?.plugins?.find(
      (plugin) =>
        plugin &&
        typeof plugin === "object" &&
        plugin.constructor.name === "DefinePlugin",
    ) as { definitions?: Record<string, string> } | undefined;

    expect(clientConfig?.output?.path).toBe(
      path.resolve(process.cwd(), "plan-dist/browser"),
    );
    expect(serverConfig?.output?.path).toBe(
      path.resolve(process.cwd(), "plan-dist/runtime"),
    );
    expect(definePlugin?.definitions).toMatchObject({
      "process.env.EVJS_FUNCTION_ENDPOINT": JSON.stringify("plan-runtime/fn"),
      __EVJS_FUNCTION_ENDPOINT__: JSON.stringify("plan-runtime/fn"),
    });
  });

  it("forwards configureBundler watch files to the framework collector", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");
    const watchedFiles: string[] = [];

    await createWebpackConfigs(
      config,
      plan,
      process.cwd(),
      [
        {
          configureBundler(_configs, ctx) {
            ctx.addWatchFile("./webpack-plugin.config.ts");
            expect(ctx.mode).toBe("development");
            expect(ctx).not.toHaveProperty("command");
            expect(Object.isFrozen(ctx.config)).toBe(true);
            expect(Object.isFrozen(ctx.config.plugins)).toBe(true);
            expect(() => {
              (ctx.config.plugins as unknown as unknown[]).push({
                id: "late-plugin",
              });
            }).toThrow(TypeError);
          },
        },
      ],
      {
        addWatchFile(file) {
          watchedFiles.push(file);
        },
      },
    );

    expect(watchedFiles).toEqual(["./webpack-plugin.config.ts"]);
    expect(config.plugins).toEqual([]);
  });

  it("rejects a renamed replacement that removes an expected framework role", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            const index = configs.findIndex((item) => item.name === "client");
            const [client] = configs.splice(index, 1);
            if (client) configs.push({ ...client, name: "renamed-client" });
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Webpack configureBundler hooks must preserve exactly one framework config named "client"; found 0.',
    );
  });

  it("rejects duplicate framework roles when cleaning is disabled", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            const client = configs.find((item) => item.name === "client");
            if (!client) return;
            if (client.output) client.output.clean = false;
            configs.push({
              ...client,
              output: { ...client.output, clean: false },
            });
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Webpack configureBundler hooks must preserve exactly one framework config named "client"; found 2.',
    );
  });

  it("allows a same-name replacement that preserves the exact BuildPlan output", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    const configs = await createWebpackConfigs(config, plan, process.cwd(), [
      {
        configureBundler(configs) {
          const index = configs.findIndex((item) => item.name === "client");
          const client = configs[index];
          if (client) {
            configs.splice(index, 1, {
              ...client,
              performance: { hints: false },
            });
          }
        },
      },
    ]);

    expect(configs.filter((item) => item.name === "client")).toHaveLength(1);
    expect(configs.find((item) => item.name === "client")?.performance).toEqual(
      { hints: false },
    );
  });

  it("rejects a relative spelling of the BuildPlan output path", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            const client = configs.find((item) => item.name === "client");
            if (client?.output) {
              client.output.clean = false;
              client.output.path = "dist/client";
            }
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Webpack config "client" output.path "dist/client" must remain the exact absolute BuildPlan output.client directory "dist/client".',
    );
  });

  it("rejects a plugin output override that targets the canonical server output", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            const client = configs.find((item) => item.name === "client");
            if (client?.output) {
              client.output.path = path.resolve(process.cwd(), "dist/server");
            }
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Webpack config "client" output.path "dist/server" must remain the exact absolute BuildPlan output.client directory "dist/client".',
    );
  });

  it("validates output ownership after each configureBundler hook", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");
    const events: string[] = [];

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            events.push("mutate");
            const client = configs.find((item) => item.name === "client");
            if (client?.output) {
              client.output.path = path.resolve(process.cwd(), "dist/server");
            }
          },
        },
        {
          configureBundler(configs) {
            events.push("restore");
            const client = configs.find((item) => item.name === "client");
            if (client?.output) {
              client.output.path = path.resolve(process.cwd(), "dist/client");
            }
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Webpack config "client" output.path "dist/server" must remain the exact absolute BuildPlan output.client directory "dist/client".',
    );
    expect(events).toEqual(["mutate"]);
  });

  it("validates output file templates after each configureBundler hook", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");
    const events: string[] = [];

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            events.push("mutate");
            const client = configs.find((item) => item.name === "client");
            if (client?.output) client.output.filename = "../../escape.js";
          },
        },
        {
          configureBundler(configs) {
            events.push("restore");
            const client = configs.find((item) => item.name === "client");
            if (client?.output) client.output.filename = "[name].js";
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Webpack config "client" output.filename "../../escape.js" must remain the framework-owned template "[name].js".',
    );
    expect(events).toEqual(["mutate"]);
  });

  it("preserves framework runtime identity after configureBundler hooks", async () => {
    const cases: Array<{
      expected: string;
      mutate(config: WebpackConfigs[number]): void;
    }> = [
      {
        expected:
          'Webpack config "client" mode "production" must remain the framework-owned value "development"',
        mutate(config) {
          config.mode = "production";
        },
      },
      {
        expected:
          'Webpack config "client" target "node" must remain the framework-owned value "web"',
        mutate(config) {
          config.target = "node";
        },
      },
      {
        expected:
          'Webpack config "client" output.clean false must remain the framework-owned value true',
        mutate(config) {
          if (config.output) config.output.clean = false;
        },
      },
      {
        expected:
          'Webpack config "client" output.publicPath "/plugin/" must remain the framework-owned value "auto"',
        mutate(config) {
          if (config.output) config.output.publicPath = "/plugin/";
        },
      },
      {
        expected:
          'Webpack config "client" output.crossOriginLoading "use-credentials" must remain the framework-owned value "anonymous"',
        mutate(config) {
          if (config.output) {
            config.output.crossOriginLoading = "use-credentials";
          }
        },
      },
    ];

    for (const testCase of cases) {
      const config = createResolvedConfig();
      const graph = createGraph(config);
      const plan = await createGeneratedPlan(config, graph, "development");
      await expect(
        createWebpackConfigs(config, plan, process.cwd(), [
          {
            configureBundler(configs) {
              const client = configs.find((item) => item.name === "client");
              if (client) testCase.mutate(client);
            },
          },
        ]),
      ).rejects.toThrow(testCase.expected);
    }
  });

  it("rejects portable artifact escapes in added entry names after each configureBundler hook", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");
    const events: string[] = [];

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            events.push("mutate");
            const client = configs.find((item) => item.name === "client");
            const entries = client?.entry;
            if (
              entries &&
              typeof entries === "object" &&
              !Array.isArray(entries)
            ) {
              (entries as Record<string, string>)["../../escape"] =
                "./src/plugin-entry.ts";
            }
          },
        },
        {
          configureBundler() {
            events.push("restore");
          },
        },
      ]),
    ).rejects.toThrow(
      'Webpack config "client" entry name "../../escape" must be a non-empty portable relative artifact path',
    );
    expect(events).toEqual(["mutate"]);
  });

  it("validates entry names even when no configureBundler hook runs", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");
    const [entry] = plan.entries;
    if (entry) entry.name = "../../escape";

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), []),
    ).rejects.toThrow(
      'Webpack config "client" entry name "../../escape" must be a non-empty portable relative artifact path',
    );
  });

  it("rejects portable artifact escapes in configured chunk names", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            const client = configs.find((item) => item.name === "client");
            if (!client) return;
            client.optimization = {
              ...client.optimization,
              runtimeChunk: { name: "../../escape" },
            };
          },
        },
      ]),
    ).rejects.toThrow(
      'Webpack config "client" runtime chunk name must be a non-empty portable relative artifact path',
    );
  });

  it("keeps server entrypoints self-contained after configureBundler hooks", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config, {
      pages: [
        {
          id: "dashboard",
          path: "/dashboard",
          module: "./src/pages/dashboard.tsx",
          render: "ssr",
        },
      ],
    });
    const plan = await createGeneratedPlan(config, graph, "development");

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            const server = configs.find((item) => item.name === "server");
            if (!server) return;
            server.optimization = {
              ...server.optimization,
              runtimeChunk: { name: "runtime" },
            };
          },
        },
      ]),
    ).rejects.toThrow(
      'Webpack config "server" optimization.runtimeChunk must remain false',
    );
  });

  it("preserves framework entry names across configureBundler hooks", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            const client = configs.find((item) => item.name === "client");
            const entries = client?.entry;
            if (
              entries &&
              typeof entries === "object" &&
              !Array.isArray(entries)
            ) {
              delete (entries as Record<string, unknown>).main;
            }
          },
        },
      ]),
    ).rejects.toThrow(
      'Webpack config "client" must preserve framework entry name "main"',
    );
  });

  it("validates framework entry imports after each configureBundler hook", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");
    const events: string[] = [];

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            events.push("mutate");
            const client = configs.find((item) => item.name === "client");
            const entries = client?.entry;
            if (
              entries &&
              typeof entries === "object" &&
              !Array.isArray(entries)
            ) {
              Reflect.set(entries, "main", {
                import: "./src/plugin-entry.ts",
              });
            }
          },
        },
        {
          configureBundler() {
            events.push("restore");
          },
        },
      ]),
    ).rejects.toThrow(
      'Webpack config "client" entry "main" import "./src/plugin-entry.ts" must remain the exact single framework-owned BuildPlan import',
    );
    expect(events).toEqual(["mutate"]);
  });

  it("rejects multiple imports for one framework entry", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            const client = configs.find((item) => item.name === "client");
            const entries = client?.entry;
            if (
              entries &&
              typeof entries === "object" &&
              !Array.isArray(entries)
            ) {
              Reflect.set(entries, "main", {
                import: ["./.ev/entries/main.ts", "./src/plugin-entry.ts"],
              });
            }
          },
        },
      ]),
    ).rejects.toThrow(
      'Webpack config "client" entry "main" import ["./.ev/entries/main.ts","./src/plugin-entry.ts"] must remain the exact single framework-owned BuildPlan import',
    );
  });

  it.each([
    "client",
    "server",
  ] as const)("rejects a plugin entry added to the framework %s config", async (configName) => {
    const config = createResolvedConfig();
    const graph = createGraph(config, {
      pages: [
        {
          id: "dashboard",
          path: "/dashboard",
          module: "./src/pages/dashboard.tsx",
          render: "ssr",
        },
      ],
    });
    const plan = await createGeneratedPlan(config, graph, "development");

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            const target = configs.find((item) => item.name === configName);
            const entries = target?.entry;
            if (
              entries &&
              typeof entries === "object" &&
              !Array.isArray(entries)
            ) {
              Reflect.set(entries, "plugin-entry", {
                import: "./src/plugin-entry.ts",
              });
            }
          },
        },
      ]),
    ).rejects.toThrow(
      `Webpack config "${configName}" cannot add entry "plugin-entry" because framework entries must remain the exact BuildPlan-owned set`,
    );
  });

  it("allows reordered framework entries and an independent plugin config", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config, {
      pages: [
        {
          id: "dashboard",
          path: "/dashboard",
          module: "./src/pages/dashboard.tsx",
          render: "ssr",
        },
      ],
    });
    const plan = await createGeneratedPlan(config, graph, "development");
    let reversedServerEntryNames: string[] = [];

    const configs = await createWebpackConfigs(config, plan, process.cwd(), [
      {
        configureBundler(configs) {
          const server = configs.find((item) => item.name === "server");
          const entries = server?.entry;
          if (
            entries &&
            typeof entries === "object" &&
            !Array.isArray(entries)
          ) {
            server.entry = Object.fromEntries(
              Object.entries(entries).reverse(),
            );
            reversedServerEntryNames = Object.keys(server.entry);
          }
          configs.push({
            name: "plugin-owned",
            mode: "development",
            context: process.cwd(),
            target: "web",
            entry: { "plugin-entry": "./src/plugin-entry.ts" },
            output: {
              path: path.resolve(process.cwd(), "dist/plugin-owned"),
              filename: "[name].js",
              clean: false,
            },
          });
        },
      },
    ]);

    const server = configs.find((item) => item.name === "server");
    expect(reversedServerEntryNames).toHaveLength(2);
    expect(Object.keys(server?.entry ?? {})).toEqual(reversedServerEntryNames);
    expect(configs).toContainEqual(
      expect.objectContaining({ name: "plugin-owned" }),
    );
  });

  it.each([
    ["the client directory", "dist/client", "output.client", "dist/client"],
    ["the build root", "dist", "output.client", "dist/client"],
    [
      "a case-only portable alias",
      "dist/CLIENT",
      "output.client",
      "dist/client",
    ],
  ] as const)("rejects an independent plugin config that overlaps %s", async (_label, pluginOutput, ownedField, ownedOutput) => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            configs.push({
              name: "plugin-owned",
              entry: { "plugin-entry": "./src/plugin-entry.ts" },
              output: {
                path: path.resolve(process.cwd(), pluginOutput),
                filename: "[name].js",
                clean: false,
              },
            });
          },
        },
      ]),
    ).rejects.toThrow(
      `[evjs] Independent Webpack config "plugin-owned" output "${pluginOutput}" must not overlap framework-owned ${ownedField} directory "${ownedOutput}".`,
    );
  });

  it("requires an explicit output path for an independent plugin config", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    await expect(
      createWebpackConfigs(config, plan, process.cwd(), [
        {
          configureBundler(configs) {
            configs.push({
              name: "plugin-owned",
              entry: { "plugin-entry": "./src/plugin-entry.ts" },
            });
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Independent Webpack config "plugin-owned" must define an explicit output.path outside framework-owned outputs.',
    );
  });

  it("rejects an independent output symlinked into a framework directory", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-webpack-plugin-output-"),
    );

    try {
      const clientOutput = path.join(cwd, "dist/client");
      await fs.mkdir(clientOutput, { recursive: true });
      await fs.symlink(clientOutput, path.join(cwd, "plugin-output"), "dir");

      await expect(
        createWebpackConfigs(config, plan, cwd, [
          {
            configureBundler(configs) {
              configs.push({
                name: "plugin-owned",
                entry: { "plugin-entry": "./src/plugin-entry.ts" },
                output: {
                  path: path.join(cwd, "plugin-output"),
                  filename: "[name].js",
                  clean: false,
                },
              });
            },
          },
        ]),
      ).rejects.toThrow(
        '[evjs] Independent Webpack config "plugin-owned" output "plugin-output" must not overlap framework-owned output.client directory "dist/client".',
      );
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects client and server output overrides when cleaning is disabled", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config, {
      pages: [
        {
          id: "dashboard",
          path: "/dashboard",
          module: "./src/pages/dashboard.tsx",
          render: "ssr",
        },
      ],
    });
    const plan = await createGeneratedPlan(config, graph, "development");

    for (const configName of ["client", "server"] as const) {
      await expect(
        createWebpackConfigs(config, plan, process.cwd(), [
          {
            configureBundler(configs) {
              const target = configs.find((item) => item.name === configName);
              if (target?.output) {
                target.output.clean = false;
                target.output.path = path.resolve(
                  process.cwd(),
                  `dist/plugin-${configName}`,
                );
              }
            },
          },
        ]),
      ).rejects.toThrow(
        `[evjs] Webpack config "${configName}" output.path "dist/plugin-${configName}" must remain the exact absolute BuildPlan output.${configName} directory "dist/${configName}".`,
      );
    }
  });

  it("rejects a symlinked build-only output even though cleaning is disabled", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config, {
      pages: [
        {
          id: "report",
          path: "/report",
          module: "./src/pages/report.tsx",
          render: "ssg",
        },
      ],
    });
    const plan = await createGeneratedPlan(config, graph, "production");
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-webpack-output-"),
    );
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-webpack-output-outside-"),
    );

    expect(plan.entries).toContainEqual(
      expect.objectContaining({ environment: "server", phase: "build" }),
    );
    try {
      await fs.mkdir(path.join(cwd, plan.distDir), { recursive: true });
      await fs.symlink(
        outside,
        path.join(cwd, plan.distDir, "__evjs_build_server"),
        "dir",
      );

      await expect(createWebpackConfigs(config, plan, cwd, [])).rejects.toThrow(
        '[evjs] Webpack config "server-build" output directory "dist/__evjs_build_server" must not traverse symbolic link "dist/__evjs_build_server".',
      );
    } finally {
      await Promise.all([
        fs.rm(cwd, { recursive: true, force: true }),
        fs.rm(outside, { recursive: true, force: true }),
      ]);
    }
  });

  it("resolves generated alias contributions directly to generated files", async () => {
    const plugin: Plugin<WebpackConfigs> = {
      id: "generated-alias",
      emitIR(ctx) {
        const configModule = ctx.emit.data({
          id: "config",
          scope: { kind: "application" },
          value: { enabled: true },
        });
        ctx.slot("resolve.alias").add({
          id: "config-alias",
          specifier: "@generated/config",
          replacement: configModule,
        });
      },
    };
    const config: ResolvedConfig<WebpackConfigs> = {
      ...createResolvedConfig(),
      plugins: [plugin],
    };
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

    const module = plan.generated?.modules.find((item) => item.id === "config");
    const clientConfig = configs.find((item) => item.name === "client");
    const alias = clientConfig?.resolve?.alias as Record<string, string>;

    expect(plan.generated?.slots).toContainEqual(
      expect.objectContaining({
        slot: "resolve.alias",
        specifier: "@generated/config",
        replacement: module?.file,
      }),
    );
    expect(plan.resolve?.alias?.["@generated/config"]).toBe(module?.file);
    expect(alias["@generated/config"]).toBe(
      path.resolve(process.cwd(), module?.file ?? ""),
    );
  });

  it("sets crossorigin for dynamically loaded browser chunks", async () => {
    const config: ResolvedConfig<WebpackConfigs> = {
      ...createResolvedConfig(),
      output: {
        client: "dist/client",
        server: "dist/server",
        crossOriginLoading: "use-credentials",
      },
    };
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "production");

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

    const clientConfig = configs.find((item) => item.name === "client");
    const miniCssPlugin = clientConfig?.plugins?.find(
      (plugin) =>
        plugin &&
        typeof plugin === "object" &&
        plugin.constructor.name === "MiniCssExtractPlugin",
    ) as { options?: { attributes?: Record<string, string> } } | undefined;

    expect(clientConfig?.output?.crossOriginLoading).toBe("use-credentials");
    expect(miniCssPlugin?.options?.attributes).toEqual({
      crossorigin: "use-credentials",
    });
  });

  it("filters resolve.external contributions by webpack target runtime", async () => {
    const config: ResolvedConfig<WebpackConfigs> = {
      ...createResolvedConfig(),
    };
    const graph = createGraph(config, {
      pages: [
        {
          id: "dashboard",
          path: "/dashboard",
          module: "./src/pages/dashboard.tsx",
          render: "ssr",
        },
      ],
    });
    const plan = await createGeneratedPlan(config, graph, "development");
    plan.resolve = {
      ...plan.resolve,
      external: {
        "client-only-lib": {
          source: "ClientOnlyLib",
          runtime: "client",
        },
        "server-only-lib": {
          source: "commonjs server-only-lib",
          runtime: "server",
        },
        "shared-lib": {
          source: "SharedLib",
          runtime: "all",
        },
      },
    };

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

    const clientConfig = configs.find((item) => item.name === "client");
    const serverConfig = configs.find((item) => item.name === "server");
    const serverExternalsText = JSON.stringify(serverConfig?.externals);

    expect(clientConfig?.externals).toEqual({
      "client-only-lib": "ClientOnlyLib",
      "shared-lib": "SharedLib",
    });
    expect(serverConfig?.externals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "server-only-lib": "commonjs server-only-lib",
          "shared-lib": "SharedLib",
        }),
      ]),
    );
    expect(serverExternalsText).not.toContain("ClientOnlyLib");
  });

  it("uses a generated server entry for framework-managed server routes", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config, {
      serverRoutes: [
        {
          id: "src/apis/health/api.ts:/health:GET",
          module: "src/apis/health/api.ts",
          path: "/health",
          methods: ["GET"],
        },
      ],
    });
    const plan = await createGeneratedPlan(config, graph, "development");

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

    const serverConfig = configs.find((item) => item.name === "server");
    const entry = serverConfig?.entry as Record<string, { import: string }>;
    expect(entry.server?.import).toBe("./.ev/entries/server.ts");
  });

  it("uses component page bootstrap instead of the SPA router loader for MPA page routes", async () => {
    const config: ResolvedConfig<WebpackConfigs> = {
      ...createResolvedConfig(),
      routing: {
        mode: "mpa",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/page.tsx",
          },
          {
            id: "about",
            path: "/about",
            module: "./src/pages/about/page.tsx",
          },
        ],
      },
    };
    const graph = createGraph(config, {
      pages: [
        {
          id: "index",
          path: "/",
          module: "./src/pages/page.tsx",
          render: "csr",
        },
        {
          id: "about",
          path: "/about",
          module: "./src/pages/about/page.tsx",
          render: "csr",
        },
      ],
    });
    const plan = await createGeneratedPlan(config, graph, "development");

    expect(
      plan.entries
        .filter((entry) => entry.environment === "client")
        .map((entry) => entry.metadata?.type),
    ).toEqual(["react-component-page", "react-component-page"]);
    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);
    const serializedEntries = JSON.stringify(configs[0]?.entry);

    expect(serializedEntries).toContain("./.ev/entries/page-client-index.ts");
    expect(serializedEntries).not.toContain("createReactPageModule");
    expect(serializedEntries).not.toContain(
      "@evjs/ev/_internal/client/react-page",
    );
  });

  it("keeps React and ReactDOM external in regular Node server bundles", async () => {
    const config: ResolvedConfig<WebpackConfigs> = {
      ...createResolvedConfig(),
    };
    const graph = createGraph(config, {
      pages: [
        {
          id: "dashboard",
          path: "/dashboard",
          module: "./src/pages/dashboard.tsx",
          render: "ssr",
          rsc: true,
        },
      ],
    });
    const plan = await createGeneratedPlan(config, graph, "development");

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

    const serverConfig = configs.find((item) => item.name === "server");
    expect(serverConfig?.externals).toEqual(
      expect.objectContaining({
        react: "commonjs react",
        "react-dom": "commonjs react-dom",
        "react-dom/client": "commonjs react-dom/client",
        "react-dom/server": "commonjs react-dom/server",
        "react-dom/server.node": "commonjs react-dom/server.node",
      }),
    );
    expect(serverConfig?.output).toEqual(
      expect.objectContaining({
        filename: "[name].cjs",
        chunkFilename: "chunks/server/[name].cjs",
        publicPath: "/",
      }),
    );

    const rscConfig = configs.find((item) => item.name === "server-rsc");
    expect(rscConfig?.output?.chunkFilename).toBe(
      "chunks/server-rsc/[name].cjs",
    );
    const readCssChunkFilename = (configName: string) => {
      const config = configs.find((item) => item.name === configName);
      const plugin = config?.plugins?.find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          candidate.constructor.name === "MiniCssExtractPlugin",
      ) as { options?: { chunkFilename?: string } } | undefined;
      return plugin?.options?.chunkFilename;
    };
    expect(readCssChunkFilename("server")).toBe("chunks/server/[name].css");
    expect(readCssChunkFilename("server-rsc")).toBe(
      "chunks/server-rsc/[name].css",
    );
  });
});

function createResolvedConfig(): ResolvedConfig<WebpackConfigs> {
  return {
    conventions: true,
    routing: {
      mode: "spa",
      html: "./index.html",
      mount: "#app",
      rootModule: "./src/pages/layout.tsx",
      routes: [
        {
          id: "index",
          path: "/",
          module: "./src/pages/page.tsx",
          errorModule: "./src/pages/error.tsx",
          notFoundModule: "./src/pages/not-found.tsx",
        },
      ],
    },
    dev: {
      port: 3000,
      https: false,
      proxy: [],
    },
    output: {
      client: "dist/client",
      server: "dist/server",
      crossOriginLoading: "anonymous",
    },
    server: {
      basePath: "/__evjs",
      runtime: {
        basePath: "/__evjs",
        fn: "__evjs/fn",
        ppr: "__evjs/ppr",
      },
      dev: {
        port: 3001,
        https: false,
      },
    },
    transport: {},
    plugins: [],
  };
}

async function createGeneratedPlan(
  config: ResolvedConfig<WebpackConfigs>,
  graph: CoreGraph,
  mode: "development" | "production",
) {
  const buildConfig = {
    ...config,
    server: {
      ...config.server,
      routes: graph.serverRoutes,
    },
  };
  return materializeFrameworkIR({
    cwd: process.cwd(),
    mode,
    config,
    graph,
    plugins: config.plugins,
    pluginContext: {
      cwd: process.cwd(),
      mode,
      config,
      logger: {} as never,
      addWatchFile() {},
    },
    plan: createBuildPlan(buildConfig, graph, { mode }),
    write: false,
  });
}

interface TestPage {
  id: string;
  path: string;
  module: string;
  render?: RenderMode;
  rsc?: boolean;
}

function createGraph(
  config: ResolvedConfig<WebpackConfigs>,
  options: { pages?: TestPage[]; serverRoutes?: ServerRouteNode[] } = {},
): CoreGraph {
  const documentTemplate = config.routing?.html ?? "./index.html";
  const routingMode = config.routing?.mode ?? "spa";
  const pages =
    options.pages ??
    (config.routing?.routes ?? []).flatMap<TestPage>((route) =>
      route.kind === "layout"
        ? []
        : [
            {
              id: route.id,
              path: route.path,
              module: route.module,
              render: "csr",
            },
          ],
    );
  const pageIds = pages.map((page) => page.id);
  const routeIds = pages.map((page) => `route:${page.id}`);
  const documentIds = routingMode === "spa" ? ["index"] : pageIds;
  const provenance = {
    producer: {
      kind: "provider" as const,
      id: "@evjs/provider/page-anchor",
    },
  };

  return {
    rootDir: process.cwd(),
    applications: {
      default: {
        id: "default",
        root: "./src/pages",
        routingMode,
        pageIds,
        routeIds,
        documentIds,
        plugins: {},
        provenance,
      },
    },
    pages: Object.fromEntries(
      pages.map((page) => [
        page.id,
        {
          id: page.id,
          applicationId: "default",
          source: {
            module: page.module,
            scope: {
              kind: "directory" as const,
              root: path.posix.dirname(page.module),
            },
            provider: "@evjs/provider/page-anchor",
          },
          render: page.render ?? "csr",
          ...(page.rsc
            ? {
                componentModel: "rsc" as const,
                hydrate: "none" as const,
              }
            : {}),
          ...(!page.rsc && page.render !== undefined && page.render !== "csr"
            ? { hydrate: "load" as const }
            : {}),
          plugins: {},
          provenance,
        },
      ]),
    ),
    routes: pages.map((page) => ({
      id: `route:${page.id}`,
      applicationId: "default",
      pattern: toRoutePattern(page.path),
      target: { kind: "page" as const, pageId: page.id },
      facets: { wrappers: [] },
      provenance,
    })),
    documents: Object.fromEntries(
      routingMode === "spa"
        ? [
            [
              "index",
              {
                id: "index",
                template: documentTemplate,
                output: "index.html",
                applicationId: "default",
                owner: { kind: "application" as const },
                mount: config.routing?.mount ?? "#app",
                bootstrap: { kind: "application" as const },
                provenance,
              },
            ],
          ]
        : pages.map((page) => [
            page.id,
            {
              id: page.id,
              template: documentTemplate,
              output:
                page.path === "/" ? "index.html" : `${page.id}/index.html`,
              applicationId: "default",
              owner: { kind: "page" as const, pageId: page.id },
              mount: config.routing?.mount ?? "#app",
              bootstrap: { kind: "page" as const, pageId: page.id },
              provenance,
            },
          ]),
    ),
    plugins: { entries: {} },
    serverFunctions: [],
    serverRoutes: options.serverRoutes ?? [],
  };
}

function toRoutePattern(pathname: string): CoreRoutePattern {
  return {
    segments: pathname
      .split("/")
      .filter(Boolean)
      .map((segment) =>
        segment.startsWith(":")
          ? { kind: "param" as const, name: segment.slice(1) }
          : { kind: "static" as const, value: segment },
      ),
  };
}
