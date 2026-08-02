import {
  type ConfigureBundlerContext,
  definePlugin,
  type Plugin,
  type PluginHooks,
} from "@evjs/ev/plugin";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { WebpackConfig } from "../src/index.js";
import { webpack } from "../src/plugin-helper.js";

describe("webpack plugin helper", () => {
  function createCtx(
    bundlerName: string,
  ): ConfigureBundlerContext<WebpackConfig> {
    return {
      mode: "production",
      command: "build",
      cwd: process.cwd(),
      config: {} as ConfigureBundlerContext<WebpackConfig>["config"],
      bundlerName,
      logger: {} as ConfigureBundlerContext<WebpackConfig>["logger"],
      addWatchFile() {},
    };
  }

  it("runs only for the webpack adapter", async () => {
    const events: string[] = [];
    const hook = webpack((config, ctx) => {
      events.push(`${ctx.bundlerName}:${Array.isArray(config)}`);
    });

    expectTypeOf(hook).toMatchTypeOf<
      NonNullable<PluginHooks<{ output: string }>["configureBundler"]>
    >();
    await hook([], createCtx("utoopack"));
    await hook([], createCtx("webpack"));

    expect(events).toEqual(["webpack:true"]);
  });

  it("keeps a default definePlugin factory bundler-agnostic", () => {
    const factory = definePlugin({
      id: "webpack-helper",
      setup() {
        return {
          configureBundler: webpack((config) => {
            for (const webpackConfig of Array.isArray(config)
              ? config
              : [config]) {
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
