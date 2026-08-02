import { describe, expect, it } from "vitest";
import {
  collectPluginHooks,
  createLatePluginContext,
  createPluginConfigView,
  runAfterBuildHooks,
  runBeforeBuildHooks,
} from "../src/_internal/build/plugin-lifecycle.js";
import { resolveConfig } from "../src/config/index.js";
import type {
  BuildResult,
  Plugin,
  PluginHooks,
  PluginSetupContext,
} from "../src/plugin/index.js";

describe("collectPluginHooks", () => {
  it("retires the setup context before disposing a partial plugin snapshot", async () => {
    const events: string[] = [];
    let retired = false;
    const context = {
      mode: "development",
      command: "dev",
      cwd: "/project",
      config: {} as PluginSetupContext["config"],
      logger: {} as PluginSetupContext["logger"],
      addWatchFile(file: string) {
        if (!retired) events.push(`watch:${file}`);
      },
    } satisfies PluginSetupContext;
    const plugins: Plugin[] = [
      {
        id: "first",
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
        id: "second",
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

  it("disposes the failing plugin when another returned hook is invalid", async () => {
    const events: string[] = [];
    const context = {
      mode: "development",
      command: "dev",
      cwd: "/project",
      config: resolveConfig(),
      logger: {} as PluginSetupContext["logger"],
      addWatchFile() {},
    } satisfies PluginSetupContext;
    const plugin: Plugin = {
      id: "invalid-hooks",
      setup() {
        return {
          unknownHook() {},
          dispose() {
            events.push("dispose");
          },
        } as never;
      },
    };

    await expect(
      collectPluginHooks([plugin], context, () => {
        events.push("beforeRollback");
      }),
    ).rejects.toThrow(
      'Plugin "invalid-hooks" setup hook returned unknown hook "unknownHook"',
    );

    expect(events).toEqual(["beforeRollback", "dispose"]);
  });

  it("does not read an accessor dispose hook while rolling back invalid setup", async () => {
    let getterWasCalled = false;
    const setupResult = {};
    Object.defineProperty(setupResult, "dispose", {
      enumerable: true,
      get() {
        getterWasCalled = true;
        return () => {};
      },
    });
    const plugin: Plugin = {
      id: "accessor-dispose",
      setup() {
        return setupResult as never;
      },
    };
    const context = {
      mode: "production",
      command: "build",
      cwd: "/project",
      config: resolveConfig(),
      logger: {} as PluginSetupContext["logger"],
      addWatchFile() {},
    } satisfies PluginSetupContext;

    await expect(collectPluginHooks([plugin], context)).rejects.toThrow(
      'setup hook returned "dispose" must be an enumerable own data property',
    );
    expect(getterWasCalled).toBe(false);
  });

  it("does not invoke a non-function dispose value while rolling back invalid setup", async () => {
    const events: string[] = [];
    const plugin: Plugin = {
      id: "invalid-dispose",
      setup() {
        return {
          dispose: {
            call() {
              events.push("invalid dispose");
            },
          },
        } as never;
      },
    };
    const context = {
      mode: "production",
      command: "build",
      cwd: "/project",
      config: resolveConfig(),
      logger: {} as PluginSetupContext["logger"],
      addWatchFile() {},
    } satisfies PluginSetupContext;

    await expect(collectPluginHooks([plugin], context)).rejects.toThrow(
      "setup hook returned dispose must be a function",
    );
    expect(events).toEqual([]);
  });

  it("exposes one isolated frozen config view to setup and lifecycle hooks", async () => {
    const observedConfigs: unknown[] = [];
    const pathRewrite = (requestPath: string) => requestPath;
    const plugin: Plugin = {
      id: "immutable-context",
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
          beforeBuild(buildContext) {
            observedConfigs.push(buildContext.config);
            expect(() => {
              (buildContext.config.plugins as Plugin[]).push({
                id: "late-plugin",
              });
            }).toThrow(TypeError);
          },
        };
      },
    };
    const dependency: Plugin = { id: "dependency" };
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
      logger: {} as PluginSetupContext["logger"],
      addWatchFile() {},
    } satisfies PluginSetupContext;

    const hooks = await collectPluginHooks(config.plugins, context);
    await runBeforeBuildHooks(hooks, context, false);
    observedConfigs.push(createLatePluginContext(context).config);

    expect(observedConfigs).toHaveLength(3);
    expect(new Set(observedConfigs).size).toBe(1);
    expect(observedConfigs[0]).not.toBe(config);
    expect(config.server.basePath).toBe("/api");
    expect(config.plugins.map((installed) => installed.id)).toEqual([
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

describe("runAfterBuildHooks", () => {
  it("invokes afterBuild as a method on its hooks object", async () => {
    let observedThis: unknown;
    const hook: PluginHooks = {
      afterBuild() {
        observedThis = this;
      },
    };

    await runAfterBuildHooks([hook], {} as BuildResult);

    expect(observedThis).toBe(hook);
  });
});
