import { describe, expect, it, vi } from "vitest";
import { orderPluginsByDependencies } from "../src/_internal/build/plugin-lifecycle.js";
import {
  collectPluginSettingsRegistry,
  resolvePluginSettingsState,
} from "../src/_internal/build/plugin-settings.js";
import { resolveConfig } from "../src/config/index.js";
import { definePlugin, pluginOptions } from "../src/plugin/index.js";

describe("defined plugin activation", () => {
  it("keeps contracts installed while when(false) removes executable hooks", () => {
    const configure = vi.fn();
    const setup = vi.fn();
    const emitIR = vi.fn();
    const analytics = definePlugin({
      name: "@company/analytics",
      key: "analytics",
      application: pluginOptions({
        defaults: { endpoint: "/events" },
      }),
      page: pluginOptions({
        defaults: { channel: "default" },
      }),
      configure,
      setup,
      emitIR,
    });

    const authored = analytics({ endpoint: "/custom" }).when(
      false,
      "disabled outside production",
    );
    expect(Object.keys(authored)).not.toContain("when");
    expect(authored.configure).toBeUndefined();
    expect(authored.setup).toBeUndefined();
    expect(authored.emitIR).toBeUndefined();

    const config = resolveConfig({ plugins: [authored] });
    expect(config.plugins[0]?.active).toBe(false);
    const registry = collectPluginSettingsRegistry(config.plugins);
    const settings = resolvePluginSettingsState(config, registry);

    expect(registry.entries[0]).toMatchObject({
      name: "@company/analytics",
      key: "analytics",
      active: false,
      inactiveReason: "disabled outside production",
      stages: ["configure", "setup", "emitIR"],
    });
    expect(registry.catalog.entries.analytics).toMatchObject({
      name: "@company/analytics",
      application: {},
      page: { defaultable: true },
    });
    expect(settings.applicationSettings).toEqual({
      analytics: { enabled: false },
    });
    expect(configure).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
    expect(emitIR).not.toHaveBeenCalled();
  });

  it("keeps the same precise plugin type when the condition is true", () => {
    const analytics = definePlugin({
      name: "@company/analytics",
      key: "analytics",
      page: pluginOptions({
        defaults: { channel: "default" },
      }),
      setup() {},
    });

    const plugin = analytics().when(true);
    const key: "analytics" = plugin.key;

    expect(key).toBe("analytics");
    expect(plugin.setup).toBeTypeOf("function");
  });

  it("validates the condition and diagnostic reason", () => {
    const analytics = definePlugin({ name: "@company/analytics" });
    const plugin = analytics();

    expect(() => plugin.when("yes" as unknown as boolean)).toThrow(
      "when() expects a boolean condition",
    );
    expect(() => plugin.when(false, " disabled ")).toThrow(
      "when() reason must be a non-empty string",
    );
  });

  it("does not let an inactive plugin satisfy a required dependency", () => {
    const base = definePlugin({ name: "@company/base" });
    const inactiveBase = base().when(false, "not available in this target");
    const required = {
      name: "@company/required",
      dependencies: ["@company/base"],
    };

    expect(() => orderPluginsByDependencies([required, inactiveBase])).toThrow(
      'Plugin "@company/required" depends on inactive plugin "@company/base": not available in this target',
    );

    const optional = {
      name: "@company/optional",
      optionalDependencies: ["@company/base"],
    };
    expect(
      orderPluginsByDependencies([optional, inactiveBase]).map(
        (plugin) => plugin.name,
      ),
    ).toEqual(["@company/optional", "@company/base"]);
  });
});
