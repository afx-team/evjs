import type { CoreGraph, CorePagePluginSetting } from "@evjs/shared/manifest";
import { PAGE_ANCHOR_PROVIDER_ID } from "@evjs/shared/manifest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import type { ResolvedPageFileConfig } from "../src/_internal/build/page-config-module.js";
import { runConfigureHooks } from "../src/_internal/build/plugin-lifecycle.js";
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
  PLUGIN_HOOK_ERROR_CODE,
  type Plugin,
  PluginHookError,
  type PluginHooks,
  pluginOptions,
} from "../src/plugin/index.js";

describe("plugin settings registry", () => {
  it("collects defined plugins and snapshots independent owner contracts", () => {
    const analytics = definePlugin({
      name: "@company/analytics",
      key: "analytics",
      application: pluginOptions<{ endpoint: string }>({
        schemaVersion: "application-v1",
        defaults: { endpoint: "/events" },
      }),
      page: pluginOptions<{ channel: string }>({
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
          name: "@company/analytics",
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

  it("rejects duplicate plugin keys and plugin names", () => {
    const firstKey = definePlugin({
      name: "@company/first",
      key: "shared",
      page: pluginOptions({ defaults: {} }),
    });
    const secondKey = definePlugin({
      name: "@company/second",
      key: "shared",
      page: pluginOptions({ defaults: {} }),
    });
    expect(() =>
      collectPluginSettingsRegistry([firstKey(), secondKey()]),
    ).toThrow(
      'Plugin key "shared" is declared by both "@company/first" and "@company/second"',
    );
    const applicationKey = definePlugin({
      name: "@company/application",
      key: "shared",
      application: pluginOptions({ defaults: {} }),
    });
    expect(() =>
      collectPluginSettingsRegistry([firstKey(), applicationKey()]),
    ).toThrow(
      'Plugin key "shared" is declared by both "@company/first" and "@company/application"',
    );

    const firstId = definePlugin({
      name: "@company/duplicate",
      key: "first",
      page: pluginOptions({ defaults: {} }),
    });
    const secondId = definePlugin({
      name: "@company/duplicate",
      key: "second",
      page: pluginOptions({ defaults: {} }),
    });
    expect(() =>
      collectPluginSettingsRegistry([firstId(), secondId()]),
    ).toThrow('Duplicate plugin name "@company/duplicate"');
  });

  it("uses one public key for Application-only settings", () => {
    const deploy = definePlugin({
      name: "@company/plugin-deploy-node",
      key: "deploy",
      application: pluginOptions({ defaults: { region: "local" } }),
    });
    const plugin = deploy();
    const state = resolveInstalled(plugin);

    expect(plugin.key).toBe("deploy");
    expect("withPageOptIn" in deploy).toBe(false);
    expect(state.registry.byKey.get("deploy")?.plugin).toMatchObject({
      name: "@company/plugin-deploy-node",
      key: "deploy",
    });
    expect(state.registry.catalog).toEqual({
      entries: {
        deploy: {
          name: "@company/plugin-deploy-node",
          application: {},
        },
      },
    });
    expect(state.applicationSettings.deploy).toEqual({
      enabled: true,
    });
    const assertNoPageOnlyMode = () => {
      // @ts-expect-error Application-only factories do not expose withPageOptIn().
      deploy.withPageOptIn();
    };
    expect(assertNoPageOnlyMode).toBeTypeOf("function");
  });

  it("does not publish catalog or settings entries for hooks-only plugins", () => {
    const hooksOnly = definePlugin({
      name: "@scope/hooks-only",
      setup() {},
    });
    const plugin = hooksOnly();
    const state = resolveInstalled(plugin);

    expect(plugin.key).toBeUndefined();
    expect(state.registry.entries).toHaveLength(1);
    expect(state.registry.byKey.size).toBe(0);
    expect(state.registry.catalog).toEqual({ entries: {} });
    expect(state.applicationSettings).toEqual({});
  });
});

describe("definePlugin and pluginOptions", () => {
  it("keeps default factories bundler-agnostic and explicit factories fixed", () => {
    const agnostic = definePlugin({
      name: "@company/agnostic",
      setup(ctx) {
        // @ts-expect-error Resolved framework config is read-only after configure().
        ctx.config.dev.port = 4000;
        // @ts-expect-error The installed plugin list is read-only after configure().
        ctx.config.plugins.push({ name: "late-plugin" });
        // @ts-expect-error Plugin dependency lists are read-only after configure().
        ctx.config.plugins[0]?.dependencies?.push("late-dependency");
        return {
          configureBundler(_config, bundlerCtx) {
            // @ts-expect-error The framework config view stays read-only here.
            bundlerCtx.config.server.basePath = "/other";
          },
          transformOutput(_output, outputCtx) {
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
      name: "@company/fixed",
      setup() {
        return {
          configureBundler(config) {
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
    const widenedKey: string = "analytics";
    const assertStaticKey = () => {
      definePlugin({
        name: "@company/widened-key",
        // @ts-expect-error Page keys must remain one statically known literal.
        key: widenedKey,
        page: pluginOptions({ defaults: {} }),
      });
    };
    expect(() =>
      definePlugin({
        name: "",
        key: "analytics",
        page: pluginOptions({ defaults: {} }),
      }),
    ).toThrow("definePlugin() name must be a non-empty string");
    expect(() =>
      definePlugin({
        name: " @company/analytics",
        key: "analytics",
        page: pluginOptions({ defaults: {} }),
      }),
    ).toThrow("without surrounding whitespace");
    expect(() =>
      definePlugin({
        name: "@company/analytics",
        key: "Analytics",
        page: pluginOptions({ defaults: {} }),
      }),
    ).toThrow("must be a lowercase plugin key");
    expect(() =>
      definePlugin({
        name: "@company/analytics",
        key: "analytics",
        page: {},
      } as never),
    ).toThrow("page must be declared with pluginOptions()");
    expect(() =>
      pluginOptions({
        defaults: {},
        schemaVersion: " 1",
      }),
    ).toThrow("without surrounding whitespace");
    expect(() =>
      definePlugin({
        name: "@company/missing-key",
        page: pluginOptions({ defaults: {} }),
      } as never),
    ).toThrow("key is required when Application or Page options are declared");
    expect(() =>
      definePlugin({
        name: "@company/missing-application-key",
        application: pluginOptions({ defaults: {} }),
      } as never),
    ).toThrow("key is required when Application or Page options are declared");
    expect(() =>
      definePlugin({
        name: "@company/hooks-only",
        key: "hooks-only",
      } as never),
    ).toThrow(
      "key is only supported when Application or Page options are declared",
    );
    expect(assertStaticKey).toBeTypeOf("function");
  });

  it("validates descriptor ordering and hook fields at definition time", () => {
    expect(() =>
      definePlugin({
        name: "@company/invalid-dependencies",
        dependencies: "@company/base",
      } as never),
    ).toThrow("definePlugin() dependencies must be an array of plugin names");
    expect(() =>
      definePlugin({
        name: "@company/duplicate-dependencies",
        dependencies: ["@company/base", "@company/base"],
      }),
    ).toThrow(
      'definePlugin() dependencies must not contain duplicate plugin name "@company/base"',
    );
    expect(() =>
      definePlugin({
        name: "@company/overlapping-dependencies",
        dependencies: ["@company/base"],
        optionalDependencies: ["@company/base"],
      }),
    ).toThrow(
      'definePlugin() optionalDependencies must not repeat required dependency "@company/base"',
    );
    expect(() =>
      definePlugin({
        name: "@company/invalid-enforce",
        enforce: "first",
      } as never),
    ).toThrow('definePlugin() enforce must be "pre", "normal", or "post"');
    expect(() =>
      definePlugin({
        name: "@company/invalid-setup",
        setup: true,
      } as never),
    ).toThrow("definePlugin() setup must be a function");
  });

  it("requires Application options in both installation modes", () => {
    const analytics = definePlugin({
      name: "@company/analytics",
      key: "analytics",
      application: pluginOptions<{ endpoint: string }>(),
      page: pluginOptions({ defaults: {} }),
    });

    expect(() => (analytics as unknown as () => Plugin)()).toThrow(
      'Plugin "@company/analytics" requires Application options',
    );

    expect(() =>
      (analytics.withPageOptIn as unknown as () => Plugin)(),
    ).toThrow('Plugin "@company/analytics" requires Application options');
  });

  it("keeps Application and Page options independent", () => {
    const validated: string[] = [];
    const analytics = definePlugin({
      name: "@company/analytics",
      key: "analytics",
      application: pluginOptions<{ channel: string }>({
        schemaVersion: "application-v1",
        validate(value, context) {
          validated.push(`${context.owner}:${value.channel}`);
        },
      }),
      page: pluginOptions<{ channel: string }>({
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
      name: "@company/analytics",
      key: "analytics",
      application: pluginOptions<{
        endpoint: string;
        retry: { count: number; backoff: boolean };
      }>({
        defaults: {
          endpoint: "/events",
          retry: { count: 1, backoff: true },
        },
      }),
      page: pluginOptions<{
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
      name: "@company/analytics",
      key: "analytics",
      application: pluginOptions<{
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
      name: "@company/rich-config",
      key: "rich-config",
      application: pluginOptions<{
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
      name: "@company/tuple-config",
      key: "tuple-config",
      application: pluginOptions<{
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
      // @ts-expect-error Plugin options contracts must be objects, not arrays.
      pluginOptions<string[]>();
      // @ts-expect-error Plugin options contracts must be objects, not functions.
      pluginOptions<() => void>();
      const arraySchema = {} as StandardSchemaV1<string[]>;
      // @ts-expect-error Standard Schema contracts must also resolve to objects.
      pluginOptions(arraySchema);
      const functionSchema = {} as StandardSchemaV1<() => void>;
      // @ts-expect-error Standard Schema contracts must not resolve to functions.
      pluginOptions(functionSchema);
      type RecordConfig = { mode: string };
      // @ts-expect-error An invalid array branch rejects the whole contract.
      pluginOptions<RecordConfig | string[]>();
      // @ts-expect-error An invalid function branch rejects the whole contract.
      pluginOptions<RecordConfig | (() => void)>();
      const arrayInputUnionSchema = {} as StandardSchemaV1<
        RecordConfig | string[],
        RecordConfig
      >;
      // @ts-expect-error Invalid Standard Schema input branches are not filtered out.
      pluginOptions(arrayInputUnionSchema);
      const functionInputUnionSchema = {} as StandardSchemaV1<
        RecordConfig | (() => void),
        RecordConfig
      >;
      // @ts-expect-error Invalid Standard Schema input branches are not filtered out.
      pluginOptions(functionInputUnionSchema);
      const arrayOutputUnionSchema = {} as StandardSchemaV1<
        RecordConfig,
        RecordConfig | string[]
      >;
      // @ts-expect-error Invalid Standard Schema output branches are not filtered out.
      pluginOptions(arrayOutputUnionSchema);
      const functionOutputUnionSchema = {} as StandardSchemaV1<
        RecordConfig,
        RecordConfig | (() => void)
      >;
      // @ts-expect-error Invalid Standard Schema output branches are not filtered out.
      pluginOptions(functionOutputUnionSchema);
    };

    expect(tuplePlugin()).toBeTypeOf("object");
    expect(assertInvalidContracts).toBeTypeOf("function");
  });

  it("keeps Page hooks and Application option inputs type-safe", () => {
    const emptyOptionsPlugin = definePlugin({
      name: "@company/empty-options",
      key: "empty-options",
      application: pluginOptions({ defaults: {} }),
    });
    const assertInvalidPageHook = () => {
      definePlugin({
        name: "@company/missing-page-options",
        // @ts-expect-error emitPageIR requires a declared Page options contract.
        emitPageIR() {},
      });
    };
    const assertObjectFactoryInput = () => {
      // @ts-expect-error Empty options still require an object when provided.
      emptyOptionsPlugin(42);
      // @ts-expect-error Empty options do not accept primitive strings.
      emptyOptionsPlugin("invalid");
    };
    const assertSchemaContractTypes = () => {
      type SchemaInput = { raw: string };
      type SchemaOutput = { parsed: number };
      const schema = {} as StandardSchemaV1<SchemaInput, SchemaOutput>;
      const contract = pluginOptions(schema, {
        defaults: { raw: "1" },
      });
      const defaults = contract.defaults;
      if (defaults && typeof defaults !== "function") {
        const raw: string = defaults.raw;
        // @ts-expect-error Schema defaults are input values, not parsed outputs.
        const parsed: number = defaults.parsed;
        void raw;
        void parsed;
      }
    };

    expect(assertInvalidPageHook).toBeTypeOf("function");
    expect(assertObjectFactoryInput).toBeTypeOf("function");
    expect(assertSchemaContractTypes).toBeTypeOf("function");
  });

  it("resolves one Application snapshot for configure and later lifecycle phases", async () => {
    let defaultsCalls = 0;
    let validationCalls = 0;
    const seen: unknown[] = [];
    const contextual = definePlugin({
      name: "@company/contextual",
      key: "contextual",
      application: pluginOptions<{
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
      configure(config, context) {
        seen.push(context.options);
        return { ...config, routing: { mode: "spa" } };
      },
      setup(context) {
        seen.push(context.options);
      },
    });
    const plugin = contextual();
    const configured = await runConfigureHooks(
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

  it("isolates in-place configure hook mutations from the caller", async () => {
    const plugin: Plugin = {
      name: "isolated-config-hook",
      configure(config) {
        config.server = { ...config.server, basePath: "/candidate" };
      },
    };
    const input: Config = { plugins: [plugin] };

    const configured = await runConfigureHooks(input, {
      command: "dev",
      cwd: process.cwd(),
      mode: "development",
    });

    expect(configured).not.toBe(input);
    expect(configured?.server).toEqual({ basePath: "/candidate" });
    expect(input.server).toBeUndefined();
  });

  it("rejects configure hooks that change the installed plugin list", async () => {
    const plugin: Plugin = {
      name: "changes-plugin-list",
      configure(config) {
        (config.plugins as Plugin[] | undefined)?.push({
          name: "late-plugin",
        });
      },
    };

    const configuring = runConfigureHooks(
      { plugins: [plugin] },
      {
        command: "dev",
        cwd: process.cwd(),
        mode: "development",
      },
    );
    await expect(configuring).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "changes-plugin-list",
      hook: "configure",
      cause: expect.any(Error),
    });
    await expect(configuring).rejects.toBeInstanceOf(PluginHookError);
    await expect(configuring).rejects.toThrow(
      'Plugin "changes-plugin-list" configure hook must not add, remove, replace, or reorder config.plugins',
    );
  });

  it("attributes invalid core config mutations to configure", async () => {
    const configuring = runConfigureHooks(
      {
        plugins: [
          {
            name: "invalid-routing-mode",
            configure(config) {
              config.routing = { mode: "invalid" } as never;
            },
          },
        ],
      },
      {
        command: "dev",
        cwd: process.cwd(),
        mode: "development",
      },
    );

    await expect(configuring).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "invalid-routing-mode",
      hook: "configure",
      cause: expect.any(Error),
    });
    await expect(configuring).rejects.toThrow(
      'routing.mode must be "spa" or "mpa"',
    );
  });

  it("does not attribute invalid author config to a configure hook", async () => {
    let configureCalled = false;
    let thrown: unknown;
    try {
      await runConfigureHooks(
        {
          routing: { mode: "invalid" } as never,
          plugins: [
            {
              name: "unrelated-configure",
              configure() {
                configureCalled = true;
              },
            },
          ],
        },
        {
          command: "dev",
          cwd: process.cwd(),
          mode: "development",
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(configureCalled).toBe(false);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(PluginHookError);
    expect((thrown as Error).message).toContain(
      'routing.mode must be "spa" or "mpa"',
    );
  });

  it("attributes invalid configure return values to configure", async () => {
    const configuring = runConfigureHooks(
      {
        plugins: [
          {
            name: "invalid-configure-result",
            configure() {
              return [] as never;
            },
          },
        ],
      },
      {
        command: "build",
        cwd: process.cwd(),
        mode: "production",
      },
    );

    await expect(configuring).rejects.toMatchObject({
      code: PLUGIN_HOOK_ERROR_CODE,
      plugin: "invalid-configure-result",
      hook: "configure",
      cause: expect.any(Error),
    });
    await expect(configuring).rejects.toBeInstanceOf(PluginHookError);
    await expect(configuring).rejects.toThrow(
      'Plugin "invalid-configure-result" configure hook must return a config object or undefined',
    );
  });

  it("preserves length fields on ordinary config objects", async () => {
    const plugin: Plugin = {
      name: "observes-length-field",
      configure(config) {
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

    const configured = await runConfigureHooks(input, {
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
      name: "@company/isolated-application-options",
      key: "isolated-application-options",
      application: pluginOptions<{
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

  it("exposes resolved Application options to the configure hook", async () => {
    const seen: unknown[] = [];
    const serverBase = definePlugin({
      name: "@company/server-base",
      key: "server-base",
      application: pluginOptions<{
        basePath: string;
        headers: { trace: boolean; region: string };
      }>({
        defaults: {
          basePath: "/_framework",
          headers: { trace: false, region: "global" },
        },
      }),
      configure(config, context) {
        seen.push(context.options);
        config.server = {
          ...config.server,
          basePath: context.options.basePath,
        };
        return config;
      },
    });
    const plugin = serverBase({ headers: { trace: true } });

    const result = await plugin.configure?.(
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
  it("uses normal installation for defaults and withPageOptIn for explicit opt-in", () => {
    const analytics = definePlugin({
      name: "@company/analytics",
      key: "analytics",
      page: pluginOptions({ defaults: { channel: "web" } }),
    });
    const normal = resolveInstalled(analytics());
    const normalGraph = applyPluginSettings(createSpaGraph(), normal.registry, {
      applicationSettings: normal.applicationSettings,
    });
    const pageOnly = resolveInstalled(analytics.withPageOptIn());
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
    application: "enabled" | "page-opt-in";
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
      application: "page-opt-in",
      page: "omitted",
      expected: { enabled: false },
    },
    {
      application: "page-opt-in",
      page: "false",
      configured: false,
      expected: { enabled: false },
    },
    {
      application: "page-opt-in",
      page: "true",
      configured: true,
      expected: { enabled: true, config: { channel: "default" } },
    },
    {
      application: "page-opt-in",
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
      name: "@company/analytics",
      key: "analytics",
      application: pluginOptions<{ mode: string }>({
        defaults: { mode: "application-default" },
      }),
      page: pluginOptions<{ channel: string }>({
        defaults: { channel: "default" },
      }),
    });
    const installed =
      application === "enabled" ? analytics() : analytics.withPageOptIn();
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
      name: "@company/analytics",
      key: "analytics",
      page: pluginOptions<{ channel: string }>(),
    });
    expect("withPageOptIn" in analytics).toBe(false);
    const assertNoRedundantForPages = () => {
      // @ts-expect-error A non-defaultable Page is already opt-in only.
      analytics.withPageOptIn();
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
  it("identifies the Page config source and plugin key in option errors", () => {
    const analytics = definePlugin({
      name: "@company/analytics",
      key: "analytics",
      page: pluginOptions<{ channel: string }>({
        validate() {
          return "channel is not available";
        },
      }),
    });
    const state = resolveInstalled(analytics());

    expect(() =>
      applyPluginSettings(createSpaGraph(), state.registry, {
        applicationSettings: state.applicationSettings,
        canonicalPages: {
          home: createPageConfig({ analytics: { channel: "checkout" } }),
        },
      }),
    ).toThrow(
      'Plugin "@company/analytics" Page options at ./src/pages/home/page.config.ts plugins.analytics is invalid: channel is not available',
    );
  });

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
      name: "@company/analytics",
      key: "analytics",
      application: pluginOptions({
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
      'configures plugin "analytics", but plugin "@company/analytics" does not declare Page options',
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
      name: "@company/authored-schema",
      key: "authored-schema",
      page: pluginOptions(authoredSchema),
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
      name: "@company/default-schema",
      key: "default-schema",
      page: pluginOptions(defaultSchema, { defaults }),
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
      name: "@company/non-static-schema-output",
      key: "non-static-schema-output",
      page: pluginOptions(schema),
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
      name: "@company/dated",
      key: "dated",
      page: pluginOptions({
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
      name: "@company/non-finite",
      key: "non-finite",
      page: pluginOptions({
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
      name: "@company/accessor",
      key: "accessor",
      page: pluginOptions({
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
      name: "@company/configured",
      key: "configured",
      application: pluginOptions<{ createdAt: Date }>(),
      setup(context) {
        applicationSettings.push(context.options);
      },
    });
    const configured = configuredPlugin({
      createdAt: new Date(0),
    });
    const configuredState = resolveInstalled(configured);
    configured.setup?.({} as never);
    expect(Object.values(configuredState.applicationSettings)).toEqual([
      { enabled: true },
    ]);
    expect(applicationSettings).toEqual([{ createdAt: new Date(0) }]);

    const lazyPlugin = definePlugin({
      name: "@company/lazy",
      key: "lazy",
      page: pluginOptions<{ value: string }>({
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
      name: "@company/analytics",
      key: "analytics",
      application: pluginOptions({ defaults: { endpoint: "/events" } }),
      page: pluginOptions({ defaults: { channel: "default" } }),
      setup(context) {
        calls.push(`setup:${context.options.endpoint}`);
      },
      emitIR(context) {
        calls.push(`emitIR:${context.pages.length}`);
      },
      emitPageIR(context) {
        calls.push(`page:${context.page.id}`);
      },
    });
    const plugin = analytics.withPageOptIn();
    const state = resolveInstalled(plugin);

    await plugin.setup?.({} as never);
    await plugin.emitIR?.({
      framework: {
        pages: [{ id: "home", plugins: { analytics: { enabled: false } } }],
      },
    } as never);
    expect(calls).toEqual(["setup:/events", "emitIR:0"]);

    const graph = applyPluginSettings(createSpaGraph(), state.registry, {
      applicationSettings: state.applicationSettings,
      canonicalPages: {
        home: createPageConfig({ analytics: true }),
      },
    });
    await plugin.emitIR?.({
      framework: { pages: Object.values(graph.pages) },
    } as never);

    expect(calls).toEqual([
      "setup:/events",
      "emitIR:0",
      "emitIR:1",
      "page:home",
    ]);
  });

  it("requires and exposes resolved Application options before setup", () => {
    const setupSettings: unknown[] = [];
    const analytics = definePlugin({
      name: "@company/analytics",
      key: "analytics",
      application: pluginOptions({
        defaults: { endpoint: "/events" },
      }),
      page: pluginOptions({ defaults: {} }),
      setup(context) {
        setupSettings.push(context.options);
      },
    });
    const plugin = analytics();
    const config = resolveConfig({ plugins: [plugin] });
    const registry = collectPluginSettingsRegistry(config.plugins);

    expect(() => plugin.setup?.({} as never)).toThrow(
      "Application options were not resolved before setup()",
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
      name: "@company/analytics",
      key: "analytics",
      page: pluginOptions<{ channel: string }>({
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
