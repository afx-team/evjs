import type { BundlerCtx } from "@evjs/ev/plugin";
import { describe, expect, it } from "vitest";
import type { WebpackConfig } from "../src/index.js";
import { webpack } from "../src/plugin-helper.js";

describe("webpack", () => {
  function createCtx(bundlerName: string): BundlerCtx<WebpackConfig> {
    return {
      mode: "production",
      command: "build",
      cwd: process.cwd(),
      config: {} as BundlerCtx<WebpackConfig>["config"],
      bundlerName,
      logger: {} as BundlerCtx<WebpackConfig>["logger"],
      addWatchFile() {},
    };
  }

  it("runs only for the webpack adapter", async () => {
    const events: string[] = [];
    const hook = webpack((config, ctx) => {
      events.push(`${ctx.bundlerName}:${Array.isArray(config)}`);
    });

    await hook([], createCtx("utoopack"));
    await hook([], createCtx("webpack"));

    expect(events).toEqual(["webpack:true"]);
  });
});
