import { type WebpackConfig, webpackAdapter } from "@evjs/bundler-webpack";
import { defineConfig } from "@evjs/ev";
import type {
  DefinedPluginApplicationInput,
  DefinedPluginPageInput,
  Plugin,
} from "@evjs/ev/plugin";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  evPluginQiankunMaster,
  evPluginQiankunSlave,
  type QiankunMasterPluginOptions,
  type QiankunSlavePluginOptions,
} from "../src/index.js";
import type {
  QiankunHistoryOptions,
  QiankunRuntimePageDefinition,
} from "../src/runtime.js";

describe("qiankun plugin config types", () => {
  it("keeps the master contract application-only", () => {
    type Master = ReturnType<typeof evPluginQiankunMaster>;

    expectTypeOf<
      DefinedPluginApplicationInput<Master>
    >().toEqualTypeOf<QiankunMasterPluginOptions>();
    expectTypeOf<DefinedPluginPageInput<Master>>().toEqualTypeOf<never>();
  });

  it("keeps master configuration required and slave configuration optional", () => {
    const master = evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    });
    const slave = evPluginQiankunSlave();
    const configuredSlave = evPluginQiankunSlave({ name: "catalog" });

    expect(master.key).toBeUndefined();
    expect("forPages" in evPluginQiankunMaster).toBe(false);
    expect(slave.key).toBeUndefined();
    expect(configuredSlave.key).toBeUndefined();
    expectTypeOf<
      DefinedPluginApplicationInput<typeof slave>
    >().toEqualTypeOf<QiankunSlavePluginOptions>();

    const assertInvalidMasterAuthoring = () => {
      // @ts-expect-error The master resolver is required.
      evPluginQiankunMaster();
    };
    expect(assertInvalidMasterAuthoring).toBeTypeOf("function");
  });

  it("installs unchanged in a webpack application config", () => {
    const master = evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    });
    const slave = evPluginQiankunSlave({ name: "catalog" });
    const config = defineConfig({
      bundler: webpackAdapter,
      plugins: [master, slave],
    });

    expectTypeOf(master).toMatchTypeOf<Plugin<WebpackConfig>>();
    expectTypeOf(slave).toMatchTypeOf<Plugin<WebpackConfig>>();
    expectTypeOf(config.plugins).toEqualTypeOf<
      readonly [typeof master, typeof slave]
    >();
  });

  it("owns its public runtime route and history contracts", () => {
    expectTypeOf<QiankunHistoryOptions>().toEqualTypeOf<
      | { type: "browser" }
      | { type: "hash" }
      | {
          type: "memory";
          initialEntries?: string[];
          initialIndex?: number;
        }
    >();
    expectTypeOf<QiankunRuntimePageDefinition["kind"]>().toEqualTypeOf<
      "page" | "layout" | "group" | "redirect" | undefined
    >();
    expectTypeOf<QiankunRuntimePageDefinition["redirect"]>().toEqualTypeOf<
      { kind: "path"; path: string } | { kind: "url"; href: string } | undefined
    >();
  });
});
