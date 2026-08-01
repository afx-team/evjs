import { describe, expect, it } from "vitest";
import {
  collectPluginHooks,
  createLatePluginContext,
  createPluginConfigView,
  runBuildStartHooks,
} from "../src/_internal/build/plugin-lifecycle.js";
import { resolveConfig } from "../src/config/index.js";
import type { Plugin, PluginContext } from "../src/plugin/index.js";

describe("collectPluginHooks", () => {
  it("retires the setup context before disposing a partial plugin snapshot", async () => {
    const events: string[] = [];
    let retired = false;
    const context = {
      mode: "development",
      command: "dev",
      cwd: "/project",
      config: {} as PluginContext["config"],
      logger: {} as PluginContext["logger"],
      addWatchFile(file: string) {
        if (!retired) events.push(`watch:${file}`);
      },
    } satisfies PluginContext;
    const plugins: Plugin[] = [
      {
        name: "first",
        setup(setupContext) {
          events.push("setup:first");
          return {
            dispose() {
              events.push("dispose:first");
              setupContext.addWatchFile("late-watch.txt");
            },
          };
        },
      },
      {
        name: "second",
        setup() {
          events.push("setup:second");
          throw new Error("setup blocked");
        },
      },
    ];

    await expect(
      collectPluginHooks(plugins, context, () => {
        events.push("beforeRollback");
        retired = true;
      }),
    ).rejects.toThrow("setup blocked");

    expect(events).toEqual([
      "setup:first",
      "setup:second",
      "beforeRollback",
      "dispose:first",
    ]);
  });

  it("exposes one isolated frozen config view to setup and lifecycle hooks", async () => {
    const observedConfigs: unknown[] = [];
    const pathRewrite = (requestPath: string) => requestPath;
    const plugin: Plugin = {
      name: "immutable-context",
      dependencies: ["dependency"],
      setup(ctx) {
        observedConfigs.push(ctx.config);
        expect(Object.isFrozen(ctx.config)).toBe(true);
        expect(Object.isFrozen(ctx.config.server)).toBe(true);
        expect(Object.isFrozen(ctx.config.plugins)).toBe(true);
        expect(Object.isFrozen(ctx.config.plugins[1])).toBe(true);
        expect(Object.isFrozen(ctx.config.plugins[1]?.dependencies)).toBe(true);
        expect(ctx.config.dev.proxy[0]?.pathRewrite).toBe(pathRewrite);
        expect(Object.isFrozen(pathRewrite)).toBe(false);
        expect(() => {
          (ctx.config.plugins as Plugin[]).splice(0, 1);
        }).toThrow(TypeError);
        expect(() => {
          (ctx.config.server as { basePath: string }).basePath = "/mutated";
        }).toThrow(TypeError);
        return {
          buildStart(buildContext) {
            observedConfigs.push(buildContext.config);
            expect(() => {
              (buildContext.config.plugins as Plugin[]).push({
                name: "late-plugin",
              });
            }).toThrow(TypeError);
          },
        };
      },
    };
    const dependency: Plugin = { name: "dependency" };
    const config = resolveConfig({
      plugins: [dependency, plugin],
      server: { basePath: "/api" },
      dev: {
        proxy: [
          {
            context: ["/api"],
            target: "http://localhost:8080",
            pathRewrite,
          },
        ],
      },
    });
    const context = {
      mode: "production",
      command: "build",
      cwd: "/project",
      config,
      logger: {} as PluginContext["logger"],
      addWatchFile() {},
    } satisfies PluginContext;

    const hooks = await collectPluginHooks(config.plugins, context);
    await runBuildStartHooks(hooks, context);
    observedConfigs.push(createLatePluginContext(context).config);

    expect(observedConfigs).toHaveLength(3);
    expect(new Set(observedConfigs).size).toBe(1);
    expect(observedConfigs[0]).not.toBe(config);
    expect(config.server.basePath).toBe("/api");
    expect(config.plugins.map((installed) => installed.name)).toEqual([
      "dependency",
      "immutable-context",
    ]);
  });

  it("rejects accessors in a resolved plugin config snapshot", () => {
    const config = resolveConfig();
    Object.defineProperty(config.server, "basePath", {
      configurable: true,
      enumerable: true,
      get() {
        return "/api";
      },
    });

    expect(() => createPluginConfigView(config)).toThrow(
      "[evjs] Resolved plugin context config.server.basePath must be a data property, not an accessor.",
    );
  });
});
