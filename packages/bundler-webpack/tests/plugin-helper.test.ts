import { describe, expect, it } from "vitest";
import { webpack } from "../src/plugin-helper.js";

describe("webpack() typed helper", () => {
  it("provides typed access to webpack config and passes mutations through", () => {
    const bundlerHook = webpack((config) => {
      // TypeScript knows `config` is webpack.Configuration here
      config.module ??= {};
      config.module.rules ??= [];
      config.module.rules.push({
        test: /\.scss$/,
        use: ["style-loader", "css-loader", "sass-loader"],
      });
    });

    // Simulate what the bundler adapter does: pass an unknown config
    const realConfig: Record<string, unknown> = {
      module: { rules: [] as unknown[] },
    };
    bundlerHook(realConfig, { mode: "production", config: {} as never });

    const module = realConfig.module as { rules: unknown[] };
    expect(module.rules).toHaveLength(1);
    expect(module.rules[0]).toEqual({
      test: /\.scss$/,
      use: ["style-loader", "css-loader", "sass-loader"],
    });
  });
});
