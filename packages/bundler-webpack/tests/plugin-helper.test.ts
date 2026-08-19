import {
  type ConfigureBundlerContext,
  definePlugin,
  type Plugin,
  type PluginHooks,
} from "@evjs/ev/plugin";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { WebpackConfigs } from "../src/index.js";
import { webpack } from "../src/plugin/configure.js";

describe("webpack plugin helper", () => {
  function createCtx(
    bundlerName: string,
  ): ConfigureBundlerContext<WebpackConfigs> {
    return {
      mode: "production",
      cwd: process.cwd(),
      config: {} as ConfigureBundlerContext<WebpackConfigs>["config"],
      bundlerName,
      logger: {} as ConfigureBundlerContext<WebpackConfigs>["logger"],
      addWatchFile() {},
    };
  }

  it("runs only for the webpack adapter", async () => {
    const events: string[] = [];
    const hook = webpack((configs, ctx) => {
      expectTypeOf(configs).toEqualTypeOf<WebpackConfigs>();
      events.push(`${ctx.bundlerName}:${configs.length}`);
    });

    expectTypeOf(hook).toMatchTypeOf<
      NonNullable<PluginHooks<{ output: string }>["configureBundler"]>
    >();
    await hook([], createCtx("utoopack"));
    await hook([], createCtx("webpack"));

    expect(events).toEqual(["webpack:0"]);
  });

  it("keeps a default definePlugin factory bundler-agnostic", () => {
    const factory = definePlugin({
      id: "webpack-helper",
      setup() {
        return {
          configureBundler: webpack((configs) => {
            for (const webpackConfig of configs) {
              webpackConfig.resolve ??= {};
            }
          }),
        };
      },
    });

    const plugin: Plugin<{ output: string }> = factory();
    expect(plugin.id).toBe("webpack-helper");
  });
});
