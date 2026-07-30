import type { CoreGraph, CorePagePluginSetting } from "@evjs/shared/manifest";
import { PAGE_ANCHOR_PROVIDER_ID } from "@evjs/shared/manifest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import type { ResolvedPageFileConfig } from "../src/_internal/build/page-config-module.js";
import { runConfigHooks } from "../src/_internal/build/plugin-lifecycle.js";
import {
  applyPluginSettings,
  collectPluginSettingsRegistry,
  createPluginSettingsResolutionSession,
  resolvePluginSettingsState,
} from "../src/_internal/build/plugin-settings.js";
import { type Config, resolveConfig } from "../src/config/index.js";
import {
  type ResolvedPagePluginConfigInput,
  resolvePagePluginConfigValues,
} from "../src/config/plugins.js";
import {
  definePlugin,
  type Plugin,
  type PluginHooks,
  pluginConfig,
} from "../src/plugin/index.js";

describe("plugin settings registry", () => {
  it("collects defined plugins and snapshots independent owner contracts", () => {
    const analytics = definePlugin({
      id: "@company/analytics",
      key: "analytics",
      application: pluginConfig<{ endpoint: string }>({
        schemaVersion: "application-v1",
        defaults: { endpoint: "/events" },
      }),
      page: pluginConfig<{ channel: string }>({
        schemaVersion: "page-v2",
      }),
    });
    const plugin = analytics();
    const legacyPlugin: Plugin = { name: "legacy-plugin" };

    const registry = collectPluginSettingsRegistry([legacyPlugin, plugin]);

    expect(registry.entries).toHaveLength(1);
    expect(registry.byKey.get("analytics")?.plugin).toBe(plugin);
    expect(registry.catalog).toEqual({
      entries: {
        analytics: {
          id: "@company/analytics",
          application: { schemaVersion: "application-v1" },
          page: {
            schemaVersion: "page-v2",
            defaultable: false,
          },
        },
      },
    });
    expect(Object.isFrozen(registry.entries)).toBe(true);
    expect(Object.isFrozen(registry.catalog.entries)).toBe(true);
  });

  it("rejects duplicate plugin keys and ids", () => {
    const firstKey = definePlugin({
      id: "@company/first",
      key: "shared",
      page: pluginConfig({ defaults: {} }),
    });
    const secondKey = definePlugin({
      id: "@company/second",
      key: "shared",
      page: pluginConfig({ defaults: {} }),
    });
    expect(() =>
      collectPluginSettingsRegistry([firstKey(), secondKey()]),
    ).toThrow(
      'Plugin key "shared" is declared by both "@company/first" and "@company/second"',
    );

    const firstId = definePlugin({
      id: "@company/duplicate",
      key: "first",
      page: pluginConfig({ defaults: {} }),
    });
    const secondId = definePlugin({
      id: "@company/duplicate",
      key: "second",
      page: pluginConfig({ defaults: {} }),
    });
    expect(() =>
      collectPluginSettingsRegistry([firstId(), secondId()]),
    ).toThrow('Duplicate plugin name "@company/duplicate"');
  });

  it("does not require or publish a Page key for Application-only plugins", () => {
    const deploy = definePlugin({
      id: "@company/plugin-deploy-node",
      application: pluginConfig({ defaults: { region: "local" } }),
    });
    const plugin = deploy();
    const state = resolveInstalled(plugin);

    expect(plugin.key).toBeUndefined();
    expect("forPages" in deploy).toBe(false);
    expect(state.registry.byKey.size).toBe(0);
    expect(state.registry.catalog).toEqual({
      entries: {
        "company-deploy-node": {
          id: "@company/plugin-deploy-node",
          application: {},
        },
      },
    });
    expect(state.applicationSettings["company-deploy-node"]).toEqual({
      enabled: true,
    });
    const assertNoPageOnlyMode = () => {
      // @ts-expect-error Application-only factories do not expose forPages().
      deploy.forPages();
    };
    expect(assertNoPageOnlyMode).toBeTypeOf("function");
  });

  it("derives collision-resistant internal keys from complete plugin ids", () => {
    const first = definePlugin({ id: "@scope-a/plugin-auth" });
    const second = definePlugin({ id: "@scope-b/plugin-auth" });

    const registry = collectPluginSettingsRegistry([first(), second()]);

    expect(Object.keys(registry.catalog.entries)).toEqual([
      "scope-a-auth",
      "scope-b-auth",
    ]);
  });
});

describe("definePlugin and pluginConfig", () => {
  it("keeps default factories bundler-agnostic and explicit factories fixed", () => {
    const agnostic = definePlugin({
      id: "@company/agnostic",
      setup(ctx) {
        // @ts-expect-error Resolved framework config is read-only after config().
        ctx.config.dev.port = 4000;
        // @ts-expect-error The installed plugin list is read-only after config().
        ctx.config.plugins.push({ name: "late-plugin" });
        // @ts-expect-error Plugin dependency lists are read-only after config().
        ctx.config.plugins[0]?.dependencies?.push("late-dependency");
        return {
          bundlerConfig(_config, bundlerCtx) {
            // @ts-expect-error The framework config view stays read-only here.
            bundlerCtx.config.server.basePath = "/other";
          },
          buildOutput(_output, outputCtx) {
            // @ts-expect-error Late output hooks cannot add analysis watches.
            outputCtx.addWatchFile("late.txt");
          },
        };
      },
    });
    const fixed = definePlugin<
      "@company/fixed",
      undefined,
      undefined,
      undefined,
      { feature: boolean }
    >({
      id: "@company/fixed",
      setup() {
        return {
          bundlerConfig(config) {
            config.feature = true;
          },
        };
      },
    });

    const crossBundlerPlugin: Plugin<{ output: string }> = agnostic();
    const fixedPlugin: Plugin<{ feature: boolean }> = fixed();
    const fixedHooks: PluginHooks<{ feature: boolean }> = {};
    const assertFixedBundlerContract = () => {
      // @ts-expect-error A bundler-specific factory keeps its declared config.
      const incompatible: Plugin<{ output: string }> = fixedPlugin;
      // @ts-expect-error A bundler-specific plugin is not bundler-agnostic.
      const agnosticPlugin: Plugin = fixedPlugin;
      // @ts-expect-error Bundler-specific hooks are not bundler-agnostic.
      const agnosticHooks: PluginHooks = fixedHooks;
      return { agnosticHooks, agnosticPlugin, incompatible };
    };

    expect(crossBundlerPlugin.name).toBe("@company/agnostic");
    expect(fixedPlugin.name).toBe("@company/fixed");
    expect(assertFixedBundlerContract).toBeTypeOf("function");
  });

  it("validates descriptor identity and owner contracts", () => {
    expect(() =>
      definePlugin({
        id: "",
        key: "analytics",
        page: pluginConfig({ defaults: {} }),
      }),
    ).toThrow("definePlugin() id must be a non-empty string");
    expect(() =>
      definePlugin({
        id: " @company/analytics",
        key: "analytics",
        page: pluginConfig({ defaults: {} }),
      }),
    ).toThrow("without surrounding whitespace");
    expect(() =>
      definePlugin({
        id: "@company/analytics",
        key: "Analytics",
        page: pluginConfig({ defaults: {} }),
      }),
    ).toThrow("must be a lowercase plugin key");
    expect(() =>
      definePlugin({
        id: "@company/analytics",
        key: "analytics",
        page: {},
      } as never),
    ).toThrow("page must be declared with pluginConfig()");
    expect(() =>
      pluginConfig({
        defaults: {},
        schemaVersion: " 1",
      }),
    ).toThrow("without surrounding whitespace");
    expect(() =>
      definePlugin({
        id: "@company/missing-key",
        page: pluginConfig({ defaults: {} }),
      } as never),
    ).toThrow("key is required when Page configuration is declared");
    expect(() =>
      definePlugin({
        id: "@company/application-only",
        key: "application-only",
      } as never),
    ).toThrow("key is only supported when Page configuration is declared");
  });

  it("validates descriptor ordering and hook fields at definition time", () => {
    expect(() =>
      definePlugin({
        id: "@company/invalid-dependencies",
        dependencies: "@company/base",
      } as never),
    ).toThrow("definePlugin() dependencies must be an array of plugin names");
    expect(() =>
      definePlugin({
        id: "@company/duplicate-dependencies",
        dependencies: ["@company/base", "@company/base"],
      }),
    ).toThrow(
      'definePlugin() dependencies must not contain duplicate plugin name "@company/base"',
    );
    expect(() =>
      definePlugin({
        id: "@company/overlapping-dependencies",
        dependencies: ["@company/base"],
        optionalDependencies: ["@company/base"],
      }),
    ).toThrow(
      'definePlugin() optionalDependencies must not repeat required dependency "@company/base"',
    );
    expect(() =>
      definePlugin({
        id: "@company/invalid-enforce",
        enforce: "first",
      } as never),
    ).toThrow('definePlugin() enforce must be "pre", "normal", or "post"');
    expect(() =>
      definePlugin({
        id: "@company/invalid-setup",
        setup: true,
      } as never),
    ).toThrow("definePlugin() setup must be a function");
  });

  it("requires Application options in both installation modes", () => {
    const analytics = definePlugin({
      id: "@company/analytics",
      key: "analytics",
      application: pluginConfig<{ endpoint: string }>(),
      page: pluginConfig({ defaults: {} }),
    });

    expect(() => (analytics as unknown as () => Plugin)()).toThrow(
      'Plugin "@company/analytics" requires Application configuration',
    );

    expect(() => (analytics.forPages as unknown as () => Plugin)()).toThrow(
      'Plugin "@company/analytics" requires Application configuration',
    );
  });

  it("keeps Application and Page config independent", () => {
    const validated: string[] = [];
    const analytics = definePlugin({
      id: "@company/analytics",
      key: "analytics",
      application: pluginConfig<{ channel: string }>({
        schemaVersion: "application-v1",
        validate(value, context) {
          validated.push(`${context.owner}:${value.channel}`);
        },
      }),
      page: pluginConfig<{ channel: string }>({
        schemaVersion: "page-v1",
        validate(value, context) {
          validated.push(`${context.owner}:${value.channel}`);
        },
      }),
    });
    const state = resolveInstalled(
      analytics({ channel: "application-channel" }),
    );
    const graph = createSpaGraph();

    const resolved = applyPluginSettings(graph, state.registry, {
      applicationSettings: state.applicationSettings,
      canonicalPages: {
        home: createPageConfig({
          analytics: { channel: "page-channel" },
        }),
      },
    });

    expect(resolved.applications.default?.plugins.analytics).toEqual({
      enabled: true,
    });
    expect(resolved.pages.home?.plugins.analytics).toEqual({
      enabled: true,
      config: { channel: "page-channel" },
    });
    expect(resolved.plugins).toEqual(state.registry.catalog);
    expect(validated).toEqual([
      "application:application-channel",
      "page:page-channel",
    ]);
    expect(graph.applications.default?.plugins).toEqual({});
    expect(graph.pages.home?.plugins).toEqual({});
  });

  it("deep-merges defaults within each independent owner contract", () => {
    const setupSettings: unknown[] = [];
    const analytics = definePlugin({
      id: "@company/analytics",
      key: "analytics",
      application: pluginConfig<{
        endpoint: string;
        retry: { count: number; backoff: boolean };
      }>({
        defaults: {
          endpoint: "/events",
          retry: { count: 1, backoff: true },
        },
      }),
      page: pluginConfig<{
        channel: string;
        sampling: { rate: number; debug: boolean };
      }>({
        defaults: {
          channel: "web",
          sampling: { rate: 1, debug: false },
        },
      }),
      setup(context) {
        setupSettings.push(context.options);
      },
    });
    const plugin = analytics({ retry: { count: 3 } });
    const state = resolveInstalled(plugin);
    plugin.setup?.({} as never);
    const graph = applyPluginSettings(createSpaGraph(), state.registry, {
      applicationSettings: state.applicationSettings,
      canonicalPages: {
        home: createPageConfig({
          analytics: { sampling: { rate: 0.25 } },
        }),
      },
    });

    expect(setupSettings).toEqual([
      {
        endpoint: "/events",
        retry: { count: 3, backoff: true },
      },
    ]);
    expect(graph.pages.home?.plugins.analytics).toEqual({
      enabled: true,
      config: {
        channel: "web",
        sampling: { rate: 0.25, debug: false },
      },
    });
  });

  it("merges over frozen defaults and treats explicit undefined as omission", () => {
    const setupSettings: unknown[] = [];
    const analytics = definePlugin({
      id: "@company/analytics",
      application: pluginConfig<{
        endpoint: string;
        retry: { count: number; backoff: boolean };
      }>({
        defaults: Object.freeze({
          endpoint: "/events",
          retry: Object.freeze({ count: 1, backoff: true }),
        }),
      }),
      setup(context) {
        setupSettings.push(context.options);
      },
    });
    const plugin = analytics({
      endpoint: undefined,
      retry: { count: 3, backoff: undefined },
    });

    resolveInstalled(plugin);
    plugin.setup?.({} as never);

    expect(setupSettings).toEqual([
      {
        endpoint: "/events",
        retry: { count: 3, backoff: true },
      },
    ]);
  });

  it("keeps rich default values atomic in factory input types", () => {
    const richConfig = definePlugin({
      id: "@company/rich-config",
      application: pluginConfig<{
        createdAt: Date;
        matcher: RegExp;
        labels: Map<string, string>;
      }>({
        defaults: {
          createdAt: new Date(0),
          matcher: /checkout/,
          labels: new Map([["channel", "web"]]),
        },
      }),
    });

    const assertInvalidRichOverrides = () => {
      // @ts-expect-error Rich values are atomic, not recursively partial objects.
      richConfig({ createdAt: {}, matcher: {}, labels: {} });
    };

    expect(assertInvalidRichOverrides).toBeTypeOf("function");
  });

  it("accepts only record contracts and preserves tuple option types", () => {
    const tuplePlugin = definePlugin({
      id: "@company/tuple-config",
      application: pluginConfig<{
        pair: [label: string, priority: number];
      }>({
        defaults: { pair: ["checkout", 1] },
      }),
      setup(context) {
        const label: string = context.options.pair[0];
        const priority: number = context.options.pair[1];
        // @ts-expect-error Tuple positions keep their distinct types.
        const invalid: number = context.options.pair[0];
        // @ts-expect-error Resolved tuple options are deeply readonly.
        context.options.pair[0] = "changed";
        void label;
        void priority;
        void invalid;
      },
    });
    const assertInvalidContracts = () => {
      // @ts-expect-error Plugin configuration contracts must be objects, not arrays.
      pluginConfig<string[]>();
      // @ts-expect-error Plugin configuration contracts must be objects, not functions.
      pluginConfig<() => void>();
      const arraySchema = {} as StandardSchemaV1<string[]>;
      // @ts-expect-error Standard Schema contracts must also resolve to objects.
      pluginConfig(arraySchema);
      const functionSchema = {} as StandardSchemaV1<() => void>;
      // @ts-expect-error Standard Schema contracts must not resolve to functions.
      pluginConfig(functionSchema);
      type RecordConfig = { mode: string };
      // @ts-expect-error An invalid array branch rejects the whole contract.
      pluginConfig<RecordConfig | string[]>();
      // @ts-expect-error An invalid function branch rejects the whole contract.
      pluginConfig<RecordConfig | (() => void)>();
      const arrayInputUnionSchema = {} as StandardSchemaV1<
        RecordConfig | string[],
        RecordConfig
      >;
      // @ts-expect-error Invalid Standard Schema input branches are not filtered out.
      pluginConfig(arrayInputUnionSchema);
      const functionInputUnionSchema = {} as StandardSchemaV1<
        RecordConfig | (() => void),
        RecordConfig
      >;
      // @ts-expect-error Invalid Standard Schema input branches are not filtered out.
      pluginConfig(functionInputUnionSchema);
      const arrayOutputUnionSchema = {} as StandardSchemaV1<
        RecordConfig,
        RecordConfig | string[]
      >;
      // @ts-expect-error Invalid Standard Schema output branches are not filtered out.
      pluginConfig(arrayOutputUnionSchema);
      const functionOutputUnionSchema = {} as StandardSchemaV1<
        RecordConfig,
        RecordConfig | (() => void)
      >;
      // @ts-expect-error Invalid Standard Schema output branches are not filtered out.
      pluginConfig(functionOutputUnionSchema);
    };

    expect(tuplePlugin()).toBeTypeOf("object");
    expect(assertInvalidContracts).toBeTypeOf("function");
  });

  it("resolves one Application snapshot for config and later lifecycle phases", async () => {
    let defaultsCalls = 0;
    let validationCalls = 0;
    const seen: unknown[] = [];
    const contextual = definePlugin({
      id: "@company/contextual",
      application: pluginConfig<{
        sequence: number;
        routingMode: "spa" | "mpa";
      }>({
        defaults(context) {
          return {
            sequence: ++defaultsCalls,
            routingMode: context.routingMode,
          };
        },
        validate() {
          validationCalls++;
        },
      }),
      config(config, context) {
        seen.push(context.options);
        return { ...config, routing: { mode: "spa" } };
      },
      setup(context) {
        seen.push(context.options);
      },
    });
    const plugin = contextual();
    const configured = await runConfigHooks(
      { routing: { mode: "mpa" }, plugins: [plugin] },
      {
        command: "build",
        cwd: process.cwd(),
        mode: "production",
      },
    );
    resolvePluginSettingsState(resolveConfig(configured), undefined, {
      reusePreparedApplicationSettings: true,
    });
    plugin.setup?.({} as never);

    expect(defaultsCalls).toBe(1);
    expect(validationCalls).toBe(1);
    expect(seen).toEqual([
      { sequence: 1, routingMode: "mpa" },
      { sequence: 1, routingMode: "mpa" },
    ]);
    expect(seen[0]).toBe(seen[1]);
  });

  it("isolates in-place config hook mutations from the caller", async () => {
    const plugin: Plugin = {
      name: "isolated-config-hook",
      config(config) {
        config.server = { ...config.server, basePath: "/candidate" };
      },
    };
    const input: Config = { plugins: [plugin] };

    const configured = await runConfigHooks(input, {
      command: "dev",
      cwd: process.cwd(),
      mode: "development",
    });

    expect(configured).not.toBe(input);
    expect(configured?.server).toEqual({ basePath: "/candidate" });
    expect(input.server).toBeUndefined();
  });

  it("preserves length fields on ordinary config objects", async () => {
    const plugin: Plugin = {
      name: "observes-length-field",
      config(config) {
        return config;
      },
    };
    const input: Config = {
      dev: {
        proxy: [
          {
            context: ["/api"],
            target: "http://localhost:8080",
            pathRewrite: { length: "/preserved" },
          },
        ],
      },
      plugins: [plugin],
    };

    const configured = await runConfigHooks(input, {
      command: "dev",
      cwd: process.cwd(),
      mode: "development",
    });

    expect(configured?.dev?.proxy?.[0]?.pathRewrite).toEqual({
      length: "/preserved",
    });
  });

  it("isolates and freezes resolved Application options", () => {
    const authored = {
      endpoint: "/events",
      headers: {
        regions: ["global"],
      },
    };
    let observed:
      | Readonly<{
          endpoint: string;
          headers: Readonly<{ regions: readonly string[] }>;
        }>
      | undefined;
    const analytics = definePlugin({
      id: "@company/isolated-application-options",
      application: pluginConfig<{
        endpoint: string;
        headers: { regions: string[] };
      }>(),
      setup(context) {
        observed = context.options;
      },
    });
    const plugin = analytics(authored);

    resolveInstalled(plugin);
    authored.endpoint = "/mutated";
    authored.headers.regions.push("caller");
    plugin.setup?.({} as never);

    expect(observed).toEqual({
      endpoint: "/events",
      headers: { regions: ["global"] },
    });
    expect(Object.isFrozen(observed)).toBe(true);
    expect(Object.isFrozen(observed?.headers)).toBe(true);
    expect(Object.isFrozen(observed?.headers.regions)).toBe(true);
    expect(
      Reflect.set(observed as object, "endpoint", "/plugin-mutation"),
    ).toBe(false);
  });

  it("exposes resolved Application options to the config hook", async () => {
    const seen: unknown[] = [];
    const serverBase = definePlugin({
      id: "@company/server-base",
      application: pluginConfig<{
        basePath: string;
        headers: { trace: boolean; region: string };
      }>({
        defaults: {
          basePath: "/_framework",
          headers: { trace: false, region: "global" },
        },
      }),
      config(config, context) {
        seen.push(context.options);
        config.server = {
          ...config.server,
          basePath: context.options.basePath,
        };
        return config;
      },
    });
    const plugin = serverBase({ headers: { trace: true } });

    const result = await plugin.config?.(
      {},
      {
        command: "build",
        cwd: process.cwd(),
        mode: "production",
      },
    );

    expect(result).toMatchObject({ server: { basePath: "/_framework" } });
    expect(seen).toEqual([
      {
        basePath: "/_framework",
        headers: { trace: true, region: "global" },
      },
    ]);
  });
});

describe("Application and Page enablement", () => {
  it("uses normal installation for defaults and forPages for explicit opt-in", () => {
    const analytics = definePlugin({
      id: "@company/analytics",
      key: "analytics",
      page: pluginConfig({ defaults: { channel: "web" } }),
    });
    const normal = resolveInstalled(analytics());
    const normalGraph = applyPluginSettings(createSpaGraph(), normal.registry, {
      applicationSettings: normal.applicationSettings,
    });
    const pageOnly = resolveInstalled(analytics.forPages());
    const pageOnlyGraph = applyPluginSettings(
      createSpaGraph(),
      pageOnly.registry,
      { applicationSettings: pageOnly.applicationSettings },
    );

    expect(normalGraph.pages.home?.plugins.analytics).toEqual({
      enabled: true,
      config: { channel: "web" },
    });
    expect(pageOnlyGraph.pages.home?.plugins.analytics).toEqual({
      enabled: false,
    });
  });

  const cases: readonly {
    application: "enabled" | "for-pages";
    page: "omitted" | "false" | "true" | "object";
    configured?: ResolvedPagePluginConfigInput;
    expected: CorePagePluginSetting;
  }[] = [
    {
      application: "enabled",
      page: "omitted",
      expected: { enabled: true, config: { channel: "default" } },
    },
    {
      application: "enabled",
      page: "false",
      configured: false,
      expected: { enabled: false },
    },
    {
      application: "enabled",
      page: "true",
      configured: true,
      expected: { enabled: true, config: { channel: "default" } },
    },
    {
      application: "enabled",
      page: "object",
      configured: { channel: "checkout" },
      expected: { enabled: true, config: { channel: "checkout" } },
    },
    {
      application: "for-pages",
      page: "omitted",
      expected: { enabled: false },
    },
    {
      application: "for-pages",
      page: "false",
      configured: false,
      expected: { enabled: false },
    },
    {
      application: "for-pages",
      page: "true",
      configured: true,
      expected: { enabled: true, config: { channel: "default" } },
    },
    {
      application: "for-pages",
      page: "object",
      configured: { channel: "checkout" },
      expected: { enabled: true, config: { channel: "checkout" } },
    },
  ];

  it.each(
    cases,
  )("resolves an $application Application with Page value $page", ({
    application,
    configured,
    expected,
  }) => {
    const analytics = definePlugin({
      id: "@company/analytics",
      key: "analytics",
      application: pluginConfig<{ mode: string }>({
        defaults: { mode: "application-default" },
      }),
      page: pluginConfig<{ channel: string }>({
        defaults: { channel: "default" },
      }),
    });
    const installed =
      application === "enabled" ? analytics() : analytics.forPages();
    const state = resolveInstalled(installed);
    const configuredPlugins =
      configured === undefined ? {} : { analytics: configured };

    const resolved = applyPluginSettings(createSpaGraph(), state.registry, {
      applicationSettings: state.applicationSettings,
      canonicalPages: {
        home: createPageConfig(configuredPlugins),
      },
    });

    expect(resolved.applications.default?.plugins.analytics?.enabled).toBe(
      true,
    );
    expect(resolved.pages.home?.plugins.analytics).toEqual(expected);
  });

  it("rejects Page true when the Page contract has no defaults", () => {
    const analytics = definePlugin({
      id: "@company/analytics",
      key: "analytics",
      page: pluginConfig<{ channel: string }>(),
    });
    expect("forPages" in analytics).toBe(false);
    const assertNoRedundantForPages = () => {
      // @ts-expect-error A non-defaultable Page is already opt-in only.
      analytics.forPages();
    };
    expect(assertNoRedundantForPages).toBeTypeOf("function");
    const state = resolveInstalled(analytics());

    const omitted = applyPluginSettings(createSpaGraph(), state.registry, {
      applicationSettings: state.applicationSettings,
      canonicalPages: { home: createPageConfig() },
    });
    expect(omitted.pages.home?.plugins.analytics).toEqual({ enabled: false });

    expect(() =>
      applyPluginSettings(createSpaGraph(), state.registry, {
        applicationSettings: state.applicationSettings,
        canonicalPages: {
          home: createPageConfig({ analytics: true }),
        },
      }),
    ).toThrow(
      'enables plugin "analytics" with true, but the plugin has no Page defaults',
    );

    const configured = applyPluginSettings(createSpaGraph(), state.registry, {
      applicationSettings: state.applicationSettings,
      canonicalPages: {
        home: createPageConfig({
          analytics: { channel: "checkout" },
        }),
      },
    });
    expect(configured.pages.home?.plugins.analytics).toEqual({
      enabled: true,
      config: { channel: "checkout" },
    });
  });
});

describe("plugin setting diagnostics", () => {
  it("rejects uninstalled Page and Application setting keys", () => {
    const emptyRegistry = collectPluginSettingsRegistry([]);

    expect(() =>
      applyPluginSettings(createSpaGraph(), emptyRegistry, {
        canonicalPages: {
          home: createPageConfig({ missing: true }),
        },
      }),
    ).toThrow(
      'configures plugin "missing", but that plugin is not installed by ev.config',
    );

    expect(() =>
      applyPluginSettings(createSpaGraph(), emptyRegistry, {
        applicationSettings: {
          missing: { enabled: true },
        },
      }),
    ).toThrow(/uses plugin key "missing".*not installed/);
  });

  it("does not expose Application-only plugins as Page settings", () => {
    const analytics = definePlugin({
      id: "@company/analytics",
      application: pluginConfig({
        defaults: { endpoint: "/events" },
      }),
    });
    const state = resolveInstalled(analytics());

    expect(() =>
      applyPluginSettings(createSpaGraph(), state.registry, {
        applicationSettings: state.applicationSettings,
        canonicalPages: {
          home: createPageConfig({ analytics: false }),
        },
      }),
    ).toThrow(
      'configures plugin "analytics", but that plugin is not installed by ev.config',
    );
  });

  it("validates plugin key syntax before installation lookup", () => {
    expect(() =>
      resolvePagePluginConfigValues({ Analytics: true }, "Page config plugins"),
    ).toThrow("must be a lowercase plugin key");
  });
});

describe("static plugin settings", () => {
  it("isolates mutable Page schema coercion from authored values and defaults", () => {
    type AuthoredOptions = {
      channel: string;
      metadata: { normalized?: boolean };
    };
    type ResolvedAuthoredOptions = {
      channel: string;
      metadata: { normalized: boolean };
    };
    const authoredSchema: StandardSchemaV1<
      AuthoredOptions,
      ResolvedAuthoredOptions
    > = {
      "~standard": {
        version: 1,
        vendor: "evjs-test",
        validate(value) {
          const configured = value as AuthoredOptions;
          configured.channel = configured.channel.toUpperCase();
          configured.metadata.normalized = true;
          return { value: configured as ResolvedAuthoredOptions };
        },
      },
    };
    const authoredPlugin = definePlugin({
      id: "@company/authored-schema",
      key: "authored-schema",
      page: pluginConfig(authoredSchema),
    });
    const authoredState = resolveInstalled(authoredPlugin());
    const authored = { channel: "checkout", metadata: {} };

    const authoredGraph = applyPluginSettings(
      createSpaGraph(),
      authoredState.registry,
      {
        applicationSettings: authoredState.applicationSettings,
        canonicalPages: {
          home: createPageConfig({ "authored-schema": authored }),
        },
      },
    );

    expect(
      authoredGraph.pages.home?.plugins["authored-schema"]?.config,
    ).toEqual({
      channel: "CHECKOUT",
      metadata: { normalized: true },
    });
    expect(authored).toEqual({ channel: "checkout", metadata: {} });

    type DefaultOptions = { channel: string };
    const defaultSchema: StandardSchemaV1<DefaultOptions> = {
      "~standard": {
        version: 1,
        vendor: "evjs-test",
        validate(value) {
          const configured = value as DefaultOptions;
          configured.channel = `${configured.channel}-coerced`;
          return { value: configured };
        },
      },
    };
    const defaults = { channel: "default" };
    const defaultPlugin = definePlugin({
      id: "@company/default-schema",
      key: "default-schema",
      page: pluginConfig(defaultSchema, { defaults }),
    });
    const defaultState = resolveInstalled(defaultPlugin());
    const resolveDefaults = () =>
      applyPluginSettings(createSpaGraph(), defaultState.registry, {
        applicationSettings: defaultState.applicationSettings,
      }).pages.home?.plugins["default-schema"]?.config;

    expect(resolveDefaults()).toEqual({ channel: "default-coerced" });
    expect(resolveDefaults()).toEqual({ channel: "default-coerced" });
    expect(defaults).toEqual({ channel: "default" });
  });

  it("validates mutable Page schema output as static JSON", () => {
    type Input = { channel: string };
    type Output = Input & { callback: () => void };
    const schema: StandardSchemaV1<Input, Output> = {
      "~standard": {
        version: 1,
        vendor: "evjs-test",
        validate(value) {
          const configured = value as Input & Partial<Output>;
          configured.callback = () => {};
          return { value: configured as Output };
        },
      },
    };
    const invalidPlugin = definePlugin({
      id: "@company/non-static-schema-output",
      key: "non-static-schema-output",
      page: pluginConfig(schema),
    });
    const state = resolveInstalled(invalidPlugin());

    expect(() =>
      applyPluginSettings(createSpaGraph(), state.registry, {
        applicationSettings: state.applicationSettings,
        canonicalPages: {
          home: createPageConfig({
            "non-static-schema-output": { channel: "checkout" },
          }),
        },
      }),
    ).toThrow("must be JSON-serializable");
  });

  it("rejects non-static Page defaults during apply", () => {
    const dated = definePlugin({
      id: "@company/dated",
      key: "dated",
      page: pluginConfig({
        defaults: { createdAt: new Date() },
      }),
    });
    const datedState = resolveInstalled(dated());
    expect(() =>
      applyPluginSettings(createSpaGraph(), datedState.registry, {
        applicationSettings: datedState.applicationSettings,
      }),
    ).toThrow(/arrays and plain objects/);

    const nonFinite = definePlugin({
      id: "@company/non-finite",
      key: "non-finite",
      page: pluginConfig({
        defaults: { value: Number.NaN },
      }),
    });
    const nonFiniteState = resolveInstalled(nonFinite());
    expect(() =>
      applyPluginSettings(createSpaGraph(), nonFiniteState.registry, {
        applicationSettings: nonFiniteState.applicationSettings,
      }),
    ).toThrow("must contain finite numbers");

    let getterWasCalled = false;
    const accessor = {};
    Object.defineProperty(accessor, "computed", {
      enumerable: true,
      get() {
        getterWasCalled = true;
        return "value";
      },
    });
    const accessorPlugin = definePlugin({
      id: "@company/accessor",
      key: "accessor",
      page: pluginConfig({
        defaults: accessor,
      }),
    });
    const accessorState = resolveInstalled(accessorPlugin());
    expect(() =>
      applyPluginSettings(createSpaGraph(), accessorState.registry, {
        applicationSettings: accessorState.applicationSettings,
      }),
    ).toThrow("must be an enumerable own data property");
    expect(getterWasCalled).toBe(false);
  });

  it("keeps rich Application config private while rejecting lazy non-static Page defaults", () => {
    const applicationSettings: unknown[] = [];
    const configuredPlugin = definePlugin({
      id: "@company/configured",
      application: pluginConfig<{ createdAt: Date }>(),
      setup(context) {
        applicationSettings.push(context.options);
      },
    });
    const configured = configuredPlugin({
      createdAt: new Date(0),
    });
    const configuredState = resolveInstalled(configured);
    configured.setup?.({} as never);
    expect(configuredState.applicationSettings["company-configured"]).toEqual({
      enabled: true,
    });
    expect(applicationSettings).toEqual([{ createdAt: new Date(0) }]);

    const lazyPlugin = definePlugin({
      id: "@company/lazy",
      key: "lazy",
      page: pluginConfig<{ value: string }>({
        defaults: () => ({ value: undefined }) as never,
      }),
    });
    const lazyState = resolveInstalled(lazyPlugin());
    expect(() =>
      applyPluginSettings(createSpaGraph(), lazyState.registry, {
        applicationSettings: lazyState.applicationSettings,
      }),
    ).toThrow("must be JSON-serializable");
  });

  it("rejects unsafe nested Page config fields", () => {
    const configured = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(configured, "__proto__", {
      enumerable: true,
      value: true,
    });

    expect(() =>
      resolvePagePluginConfigValues(
        { analytics: configured },
        "Page config plugins",
      ),
    ).toThrow(
      "Page config plugins.analytics.__proto__ is not a safe config field",
    );
  });
});

describe("plugin setting lifecycle", () => {
  it("runs a Page-scoped plugin and contributes only for enabled Pages", async () => {
    const calls: string[] = [];
    const analytics = definePlugin({
      id: "@company/analytics",
      key: "analytics",
      application: pluginConfig({ defaults: { endpoint: "/events" } }),
      page: pluginConfig({ defaults: { channel: "default" } }),
      setup(context) {
        calls.push(`setup:${context.options.endpoint}`);
      },
      contributions(context) {
        calls.push(`contributions:${context.pages.length}`);
      },
      contributePage(context) {
        calls.push(`page:${context.page.id}`);
      },
    });
    const plugin = analytics.forPages();
    const state = resolveInstalled(plugin);

    await plugin.setup?.({} as never);
    await plugin.contributions?.({
      framework: {
        pages: [{ id: "home", plugins: { analytics: { enabled: false } } }],
      },
    } as never);
    expect(calls).toEqual(["setup:/events", "contributions:0"]);

    const graph = applyPluginSettings(createSpaGraph(), state.registry, {
      applicationSettings: state.applicationSettings,
      canonicalPages: {
        home: createPageConfig({ analytics: true }),
      },
    });
    await plugin.contributions?.({
      framework: { pages: Object.values(graph.pages) },
    } as never);

    expect(calls).toEqual([
      "setup:/events",
      "contributions:0",
      "contributions:1",
      "page:home",
    ]);
  });

  it("requires and exposes resolved Application settings before setup", () => {
    const setupSettings: unknown[] = [];
    const analytics = definePlugin({
      id: "@company/analytics",
      key: "analytics",
      application: pluginConfig({
        defaults: { endpoint: "/events" },
      }),
      page: pluginConfig({ defaults: {} }),
      setup(context) {
        setupSettings.push(context.options);
      },
    });
    const plugin = analytics();
    const config = resolveConfig({ plugins: [plugin] });
    const registry = collectPluginSettingsRegistry(config.plugins);

    expect(() => plugin.setup?.({} as never)).toThrow(
      "Application settings were not resolved before setup()",
    );
    expect(() => applyPluginSettings(createSpaGraph(), registry)).toThrow(
      "were not resolved before graph analysis",
    );

    const state = resolvePluginSettingsState(config, registry);
    plugin.setup?.({} as never);
    expect(state.applicationSettings.analytics).toEqual({ enabled: true });
    expect(setupSettings).toEqual([{ endpoint: "/events" }]);

    const graph = applyPluginSettings(createSpaGraph(), registry, {
      applicationSettings: state.applicationSettings,
    });
    expect(graph.applications.default?.plugins.analytics).toEqual(
      state.applicationSettings.analytics,
    );
  });

  it("reuses equivalent Page resolutions in an alias-analysis session", () => {
    let validationCalls = 0;
    const analytics = definePlugin({
      id: "@company/analytics",
      key: "analytics",
      page: pluginConfig<{ channel: string }>({
        defaults: { channel: "default" },
        validate() {
          validationCalls += 1;
        },
      }),
    });
    const state = resolveInstalled(analytics());
    const session = createPluginSettingsResolutionSession(state.registry);
    const canonicalPages = {
      home: createPageConfig({ analytics: true }),
    };

    const first = applyPluginSettings(createSpaGraph(), state.registry, {
      applicationSettings: state.applicationSettings,
      canonicalPages,
      session,
    });
    const aliasGraph = createSpaGraph();
    aliasGraph.rootDir = "./aliased-project";
    const second = applyPluginSettings(aliasGraph, state.registry, {
      applicationSettings: state.applicationSettings,
      canonicalPages: {
        home: createPageConfig({ analytics: true }),
      },
      session,
    });

    expect(validationCalls).toBe(1);
    expect(session.pageResolutions.size).toBe(1);
    expect(second.pages.home?.plugins.analytics).toEqual(
      first.pages.home?.plugins.analytics,
    );
    expect(second.pages.home?.plugins.analytics).not.toBe(
      first.pages.home?.plugins.analytics,
    );

    applyPluginSettings(createSpaGraph(), state.registry, {
      applicationSettings: state.applicationSettings,
      canonicalPages: {
        home: createPageConfig({
          analytics: { channel: "changed" },
        }),
      },
      session,
    });
    expect(validationCalls).toBe(2);

    const otherRegistry = collectPluginSettingsRegistry([analytics()]);
    expect(() =>
      applyPluginSettings(createSpaGraph(), otherRegistry, {
        applicationSettings: state.applicationSettings,
        session,
      }),
    ).toThrow(
      "Plugin settings resolution session must use the registry that created it",
    );
  });
});

function resolveInstalled(plugin: Plugin) {
  const config = resolveConfig({ plugins: [plugin] });
  const registry = collectPluginSettingsRegistry(config.plugins);
  return resolvePluginSettingsState(config, registry);
}

function createPageConfig(plugins: unknown = {}): ResolvedPageFileConfig {
  const source = "./src/pages/home/page.config.ts";
  return {
    source,
    plugins: resolvePagePluginConfigValues(plugins, `${source} plugins`),
  };
}

function createSpaGraph(): CoreGraph {
  const provenance = {
    producer: {
      kind: "provider" as const,
      id: PAGE_ANCHOR_PROVIDER_ID,
    },
  };
  return {
    rootDir: ".",
    applications: {
      default: {
        id: "default",
        root: ".",
        routingMode: "spa",
        pageIds: ["home"],
        routeIds: ["home"],
        documentIds: ["app:default"],
        plugins: {},
        provenance,
      },
    },
    pages: {
      home: {
        id: "home",
        applicationId: "default",
        render: "csr",
        source: {
          module: "./src/pages/home/page.tsx",
          scope: { kind: "directory", root: "./src/pages/home" },
          provider: PAGE_ANCHOR_PROVIDER_ID,
        },
        plugins: {},
        provenance,
      },
    },
    routes: [
      {
        id: "home",
        applicationId: "default",
        pattern: { segments: [] },
        target: { kind: "page", pageId: "home" },
        facets: { wrappers: [] },
        provenance,
      },
    ],
    documents: {
      "app:default": {
        id: "app:default",
        template: "./index.html",
        output: "index.html",
        applicationId: "default",
        owner: { kind: "application" },
        bootstrap: { kind: "application" },
        provenance,
      },
    },
    plugins: { entries: {} },
    serverFunctions: [],
    serverRoutes: [],
  };
}
