import { type WebpackConfig, webpackAdapter } from "@evjs/bundler-webpack";
import { defineConfig } from "@evjs/ev";
import type { Plugin } from "@evjs/ev/plugin";
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
    expectTypeOf<
      Parameters<typeof evPluginQiankunMaster>[0]
    >().toEqualTypeOf<QiankunMasterPluginOptions>();
    const assertNoPageContract = () => {
      // @ts-expect-error Application-only factories do not expose forPages().
      evPluginQiankunMaster.forPages({
        resolver: "./src/qiankun.master.ts",
      });
    };
    expect(assertNoPageContract).toBeTypeOf("function");
  });

  it("keeps master configuration required and slave configuration optional", () => {
    const master = evPluginQiankunMaster({
      resolver: "./src/qiankun.master.ts",
    });
    const slave = evPluginQiankunSlave();
    const configuredSlave = evPluginQiankunSlave({ name: "catalog" });

    expect(master.id).toBe("qiankun-master");
    expect("forPages" in evPluginQiankunMaster).toBe(false);
    expect(slave.id).toBe("qiankun-slave");
    expect(configuredSlave.id).toBe("qiankun-slave");
    expectTypeOf<
      Exclude<Parameters<typeof evPluginQiankunSlave>[0], undefined>
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
