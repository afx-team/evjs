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
  type ResolvedPagePluginOptionsInput,
  resolvePagePluginOptions,
} from "../src/config/plugins.js";
import {
  definePlugin,
  type Plugin,
  type PluginHooks,
  type PluginOptionsContract,
  pluginOptions,
} from "../src/plugin/index.js";
import { pluginEmitIRScopeFactory } from "../src/plugin/internal.js";

describe("plugin settings registry", () => {
  it("shares the hidden Page IR scope factory across package copies", () => {
    expect(pluginEmitIRScopeFactory).toBe(
      Symbol.for("@evjs/ev/plugin-emit-ir-scope-factory"),
    );
  });

  it("collects every plugin and snapshots independent owner contracts", () => {
    const analytics = definePlugin({
      id: "analytics",
      application: pluginOptions<{ endpoint: string }>({
        schemaVersion: "application-v1",
        defaults: { endpoint: "/events" },
      }),
      page: pluginOptions<{ channel: string }>({
        schemaVersion: "page-v2",
      }),
    });
    const plugin = analytics();
    const barePlugin: Plugin = { id: "bare-plugin" };

    const registry = collectPluginSettingsRegistry([barePlugin, plugin]);

    expect(registry.entries.map((entry) => entry.id)).toEqual([
      "bare-plugin",
      "analytics",
    ]);
    expect(registry.byId.get("bare-plugin")?.plugin).toBe(barePlugin);
    expect(registry.byId.get("analytics")?.plugin).toBe(plugin);
    expect(registry.catalog).toEqual({
      entries: {
        "bare-plugin": {},
        analytics: {
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

  it("records a bare installed plugin as enabled only at Application scope", () => {
    const plugin: Plugin = { id: "runtime-only" };
    const config = resolveConfig({ plugins: [plugin] });
    const state = resolvePluginSettingsState(config);

    expect(state.registry.catalog).toEqual({
      entries: { "runtime-only": {} },
    });
    expect(state.applicationSettings).toEqual({
      "runtime-only": { enabled: true },
    });

    const graph = applyPluginSettings(createSpaGraph(), state.registry, {
      applicationSettings: state.applicationSettings,
    });
    expect(graph.applications.default?.plugins).toEqual({
      "runtime-only": { enabled: true },
    });
    expect(graph.pages.home?.plugins).toEqual({});
    expect(() =>
      applyPluginSettings(createSpaGraph(), state.registry, {
        applicationSettings: state.applicationSettings,
        canonicalPages: {
          home: createPageConfig({ "runtime-only": true }),
        },
      }),
    ).toThrow(
      'configures plugin "runtime-only", but plugin "runtime-only" does not declare Page options',
    );
  });

  it("rejects duplicate plugin ids", () => {
    const first = definePlugin({
      id: "shared",
      page: pluginOptions({ defaults: {} }),
    });
    const second = definePlugin({
      id: "shared",
      page: pluginOptions({ defaults: {} }),
    });
    expect(() => collectPluginSettingsRegistry([first(), second()])).toThrow(
      'Duplicate plugin id "shared"',
    );
  });

  it("uses the same id for Application settings and the catalog", () => {
    const deploy = definePlugin({
      id: "deploy-node",
      application: pluginOptions({ defaults: { region: "local" } }),
    });
    const plugin = deploy();
    const state = resolveInstalled(plugin);

    expect(plugin.id).toBe("deploy-node");
    expect("forPages" in deploy).toBe(false);
    expect((state.registry.byId.get("deploy-node")?.plugin as Plugin).id).toBe(
      plugin.id,
    );
    expect(state.registry.catalog).toEqual({
      entries: {
        "deploy-node": {
          application: {},
        },
      },
    });
    expect(state.applicationSettings["deploy-node"]).toEqual({
      enabled: true,
    });
    const assertNoPageOnlyMode = () => {
      // @ts-expect-error Application-only factories do not expose forPages().
      deploy.forPages();
    };
    expect(assertNoPageOnlyMode).toBeTypeOf("function");
  });

  it("carries defined-plugin state across package copies", () => {
    const plugin = definePlugin({
      id: "identity-guard",
      page: pluginOptions({ defaults: {} }),
    })();
    const metadataSymbol = Symbol.for("@evjs/ev/defined-plugin-runtime");
    const metadata = Reflect.get(plugin, metadataSymbol) as {
      readonly runtime: { readonly id: string };
      binding: { applicationSetting: unknown };
    };
    const { runtime } = metadata;

    expect(Reflect.set(plugin, "id", "mutated-identity")).toBe(false);
    expect(Reflect.set(runtime, "id", "mutated-runtime")).toBe(false);
    expect(plugin.id).toBe("identity-guard");
    expect(runtime.id).toBe("identity-guard");
    expect(
      Object.getOwnPropertyDescriptor(plugin, metadataSymbol)?.enumerable,
    ).toBe(false);
    expect(Object.isSealed(metadata)).toBe(true);
    expect(Object.isFrozen(runtime)).toBe(true);

    // A second @evjs/ev module instance observes the same symbol-keyed metadata.
    const transported: Plugin = { id: "identity-guard" };
    Object.defineProperty(transported, metadataSymbol, {
      value: Object.seal({
        runtime,
        binding: { applicationSetting: undefined },
      }),
    });
    expect(collectPluginSettingsRegistry([transported]).catalog).toEqual({
      entries: {
        "identity-guard": { page: { defaultable: true } },
      },
    });

    const divergent: Plugin = { id: "public-identity" };
    Object.defineProperty(divergent, metadataSymbol, {
      value: Object.seal({
        runtime,
        binding: { applicationSetting: undefined },
      }),
    });
    expect(() => collectPluginSettingsRegistry([divergent])).toThrow(
      'Defined plugin runtime id "identity-guard" does not match its public plugin id',
    );
  });

  it("rejects non-canonical and reserved plugin ids at definition time", () => {
    expect(() =>
      definePlugin({
        // @ts-expect-error Scoped package names are not canonical short plugin ids.
        id: "@scope/plugin-auth",
      }),
    ).toThrow("must be a lowercase plugin id");
    expect(() =>
      definePlugin({
        // @ts-expect-error Windows device basenames are reserved plugin ids.
        id: "con",
      }),
    ).toThrow("reserved object key or Windows device basename");
  });
});

describe("definePlugin and pluginOptions", () => {
  it("narrows plugin option context by owner", () => {
    const contract = pluginOptions({
      defaults(context) {
        if (context.owner === "page") {
          const pageId: string = context.pageId;
          const pageModule: string = context.pageModule;
          return { owner: context.owner, pageId, pageModule };
        }
        // @ts-expect-error Application option contexts do not expose Page fields.
        void context.pageId;
        return { owner: context.owner, pageId: "", pageModule: "" };
      },
    });

    expect(contract.defaultable).toBe(true);
  });

  it("keeps default factories bundler-agnostic and explicit factories fixed", () => {
    const agnostic = definePlugin({
      id: "agnostic",
      setup(ctx) {
        // @ts-expect-error Resolved framework config is read-only after configure().
        ctx.config.dev.port = 4000;
        // @ts-expect-error The installed plugin list is read-only after configure().
        ctx.config.plugins.push({ id: "late-plugin" });
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
      "fixed",
      undefined,
      undefined,
      { feature: boolean }
    >({
      id: "fixed",
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

    expect(crossBundlerPlugin.id).toBe("agnostic");
    expect(fixedPlugin.id).toBe("fixed");
    expect(assertFixedBundlerContract).toBeTypeOf("function");
  });

  it("validates descriptor identity and owner contracts", () => {
    expect(() =>
      definePlugin({
        // @ts-expect-error Empty plugin ids are rejected statically and at runtime.
        id: "",
        page: pluginOptions({ defaults: {} }),
      }),
    ).toThrow("must be a lowercase plugin id");
    expect(() =>
      definePlugin({
        // @ts-expect-error Plugin ids cannot start with whitespace.
        id: " analytics",
        page: pluginOptions({ defaults: {} }),
      }),
    ).toThrow("must be a lowercase plugin id");
    expect(() =>
      definePlugin({
        // @ts-expect-error Plugin ids must be lowercase.
        id: "Analytics",
        page: pluginOptions({ defaults: {} }),
      }),
    ).toThrow("must be a lowercase plugin id");
    expect(() =>
      definePlugin({
        id: "analytics",
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
        id: "analytics",
        key: "analytics",
      } as never),
    ).toThrow("descriptor contains unsupported field key");
    expect(() =>
      definePlugin({
        id: "removed-contribute-hook",
        contribute() {},
      } as never),
    ).toThrow("descriptor contains unsupported field contribute");
    expect(() =>
      definePlugin({
        id: "removed-page-contribute-hook",
        page: pluginOptions({ defaults: {} }),
        contributePage() {},
      } as never),
    ).toThrow("descriptor contains unsupported field contributePage");
  });

  it("keeps descriptor identity and owner contracts statically definite", () => {
    const condition = Math.random() > 0.5;
    const widenedId: string = "widened-id";
    const unionId = condition ? ("union-a" as const) : ("union-b" as const);
    const openId = "plugin-open" as `plugin-${string}`;
    const numericId = "plugin-1" as `plugin-${number}`;
    const brandedId = "branded-id" as string & {
      readonly __pluginIdBrand: unique symbol;
    };
    const applicationA = pluginOptions<{ mode: "a" }>();
    const applicationB = pluginOptions<{ mode: "b" }>({
      defaults: { mode: "b" },
    });
    const pageA = pluginOptions<{ channel: "a" }>();
    const pageB = pluginOptions<{ channel: "b" }>({
      defaults: { channel: "b" },
    });
    const optionalApplication = condition ? applicationA : undefined;
    const optionalPage = condition ? pageA : undefined;
    const unionApplication = condition ? applicationA : applicationB;
    const unionPage = condition ? pageA : pageB;
    const widenedDefaultability: PluginOptionsContract<
      { channel?: "b" },
      { channel: "b" },
      boolean
    > = pageB;

    const assertInvalidDescriptors = () => {
      definePlugin({
        // @ts-expect-error Plugin ids must be one statically known literal.
        id: widenedId,
      });
      definePlugin({
        // @ts-expect-error Plugin id unions do not provide one stable identity.
        id: unionId,
      });
      definePlugin({
        // @ts-expect-error Open string templates do not provide one stable identity.
        id: openId,
      });
      definePlugin({
        // @ts-expect-error Open numeric templates do not provide one stable identity.
        id: numericId,
      });
      definePlugin({
        // @ts-expect-error Branded strings are not complete literal identities.
        id: brandedId,
      });
      definePlugin({
        // @ts-expect-error Plugin ids must start with a lowercase letter.
        id: "1analytics",
      });
      definePlugin({
        // @ts-expect-error Plugin ids cannot start with a hyphen.
        id: "-analytics",
      });
      definePlugin({
        // @ts-expect-error Plugin ids cannot end with a hyphen.
        id: "analytics-",
      });
      definePlugin({
        // @ts-expect-error Plugin id segments cannot be empty.
        id: "analytics--reporting",
      });
      definePlugin({
        // @ts-expect-error Plugin ids accept lowercase letters, digits, and hyphens only.
        id: "analytics.reporting",
      });
      definePlugin({
        // @ts-expect-error Plugin ids accept lowercase letters, digits, and hyphens only.
        id: "analytics_plugin",
      });
      definePlugin({
        // @ts-expect-error Object prototype keys are reserved plugin ids.
        id: "__proto__",
      });
      definePlugin({
        // @ts-expect-error Object prototype keys are reserved plugin ids.
        id: "constructor",
      });
      definePlugin({
        // @ts-expect-error Object prototype keys are reserved plugin ids.
        id: "prototype",
      });
      definePlugin({
        // @ts-expect-error Windows device basenames are reserved plugin ids.
        id: "aux",
      });
      definePlugin({
        // @ts-expect-error Windows device basenames are reserved plugin ids.
        id: "con",
      });
      definePlugin({
        // @ts-expect-error Windows device basenames are reserved plugin ids.
        id: "prn",
      });
      definePlugin({
        // @ts-expect-error Windows device basenames are reserved plugin ids.
        id: "nul",
      });
      definePlugin({
        // @ts-expect-error Numbered Windows COM device basenames are reserved.
        id: "com1",
      });
      definePlugin({
        // @ts-expect-error Numbered Windows COM device basenames are reserved.
        id: "com9",
      });
      definePlugin({
        // @ts-expect-error Numbered Windows LPT device basenames are reserved.
        id: "lpt1",
      });
      definePlugin({
        // @ts-expect-error Numbered Windows LPT device basenames are reserved.
        id: "lpt9",
      });
      definePlugin({ id: "com0" });
      definePlugin({ id: "com10" });
      definePlugin({ id: "com1-tools" });
      definePlugin({ id: "con-tools" });
      definePlugin({ id: "a" });
      definePlugin({ id: "plugin-1" });
      definePlugin({
        id: "optional-application",
        // @ts-expect-error Application contract presence must be statically definite.
        application: optionalApplication,
      });
      definePlugin({
        id: "optional-page",
        // @ts-expect-error Page contract presence must be statically definite.
        page: optionalPage,
      });
      definePlugin({
        id: "union-application",
        // @ts-expect-error Differing Application contract unions are unsafe.
        application: unionApplication,
      });
      definePlugin({
        id: "union-page",
        // @ts-expect-error Differing Page contract unions are unsafe.
        page: unionPage,
      });
      definePlugin({
        id: "removed-contribute-hook",
        // @ts-expect-error The former contribute hook is not part of the descriptor.
        contribute() {},
      });
      definePlugin({
        id: "page-emitter-without-page-contract",
        // @ts-expect-error emitPageIR requires a Page options contract.
        emitPageIR() {},
      });
      // @ts-expect-error Defaultability must remain the literal true or false contract.
      definePlugin({
        id: "widened-defaultability",
        page: widenedDefaultability,
      });
    };

    expect(widenedId).toBe("widened-id");
    expect(assertInvalidDescriptors).toBeTypeOf("function");
  });

  it("validates descriptor ordering and hook fields at definition time", () => {
    expect(() =>
      definePlugin({
        id: "invalid-dependencies",
        dependencies: "base",
      } as never),
    ).toThrow("definePlugin() dependencies must be an array of plugin ids");
    expect(() =>
      definePlugin({
        id: "duplicate-dependencies",
        dependencies: ["base", "base"],
      }),
    ).toThrow(
      'definePlugin() dependencies must not contain duplicate plugin id "base"',
    );
    expect(() =>
      definePlugin({
        id: "overlapping-dependencies",
        dependencies: ["base"],
        optionalDependencies: ["base"],
      }),
    ).toThrow(
      'definePlugin() optionalDependencies must not repeat required dependency "base"',
    );
    expect(() =>
      definePlugin({
        id: "self-required",
        dependencies: ["self-required"],
      }),
    ).toThrow("dependencies must not contain the plugin's own id");
    expect(() =>
      definePlugin({
        id: "self-optional",
        optionalDependencies: ["self-optional"],
      }),
    ).toThrow("optionalDependencies must not contain the plugin's own id");
    expect(() =>
      definePlugin({
        id: "invalid-enforce",
        enforce: "first",
      } as never),
    ).toThrow('definePlugin() enforce must be "pre", "normal", or "post"');
    expect(() =>
      definePlugin({
        id: "invalid-setup",
        setup: true,
      } as never),
    ).toThrow("definePlugin() setup must be a function");
  });

  it("captures an immutable descriptor snapshot without executing accessors", () => {
    const dependencies = ["base-plugin"];
    const page = pluginOptions({ defaults: { channel: "initial" } });
    const descriptor = {
      id: "snapshot-plugin" as const,
      dependencies,
      page,
      setup() {
        return {};
      },
    };
    const factory = definePlugin(descriptor);

    dependencies[0] = "mutated-dependency";
    Reflect.set(descriptor, "id", "mutated-plugin");
    Reflect.set(descriptor, "page", undefined);
    Reflect.set(descriptor, "setup", undefined);

    const plugin = factory();
    const registry = collectPluginSettingsRegistry([
      { id: "base-plugin" },
      plugin,
    ]);
    expect(plugin.id).toBe("snapshot-plugin");
    expect(plugin.dependencies).toEqual(["base-plugin"]);
    expect(Object.isFrozen(plugin.dependencies)).toBe(true);
    expect(plugin.setup).toBeTypeOf("function");
    expect(registry.catalog.entries["snapshot-plugin"]?.page).toEqual({
      defaultable: true,
    });

    let getterCalled = false;
    const accessorDescriptor = { id: "accessor-descriptor" };
    Object.defineProperty(accessorDescriptor, "setup", {
      enumerable: true,
      get() {
        getterCalled = true;
        return () => undefined;
      },
    });
    expect(() => definePlugin(accessorDescriptor as never)).toThrow(
      "descriptor field setup must be an enumerable own data property",
    );
    expect(getterCalled).toBe(false);

    let dependencyGetterCalled = false;
    const accessorDependencies: string[] = [];
    Object.defineProperty(accessorDependencies, 0, {
      enumerable: true,
      get() {
        dependencyGetterCalled = true;
        return "base-plugin";
      },
    });
    expect(() =>
      definePlugin({
        id: "accessor-dependency",
        dependencies: accessorDependencies,
      }),
    ).toThrow("dependencies[0] must be an enumerable own data property");
    expect(dependencyGetterCalled).toBe(false);

    expect(() =>
      definePlugin({
        id: "sparse-dependency",
        dependencies: new Array<string>(1),
      }),
    ).toThrow("dependencies[0] must be an enumerable own data property");
  });

  it("requires Application options in both installation modes", () => {
    const analytics = definePlugin({
      id: "analytics",
      application: pluginOptions<{ endpoint: string }>(),
      page: pluginOptions({ defaults: {} }),
    });

    expect(() => (analytics as unknown as () => Plugin)()).toThrow(
      'Plugin "analytics" requires Application options.',
    );

    expect(() => (analytics.forPages as unknown as () => Plugin)()).toThrow(
      'Plugin "analytics" requires Application options.',
    );
  });

  it("keeps Application and Page options independent", () => {
    const validated: string[] = [];
    const analytics = definePlugin({
      id: "analytics",
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
      options: { channel: "page-channel" },
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
      id: "analytics",
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
    state.plugin.setup?.({} as never);
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
      options: {
        channel: "web",
        sampling: { rate: 0.25, debug: false },
      },
    });
  });

  it("merges over frozen defaults and treats explicit undefined as omission", () => {
    const setupSettings: unknown[] = [];
    const analytics = definePlugin({
      id: "analytics",
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

    const state = resolveInstalled(plugin);
    state.plugin.setup?.({} as never);

    expect(setupSettings).toEqual([
      {
        endpoint: "/events",
        retry: { count: 3, backoff: true },
      },
    ]);
  });

  it("keeps callback fields atomic while partializing their containing defaults", () => {
    const setupSettings: unknown[] = [];
    const callbacks = definePlugin({
      id: "callback-options",
      application: pluginOptions<{
        endpoint: string;
        transform: (value: string) => string;
        retry: {
          count: number;
          onRetry: (attempt: number) => void;
        };
      }>({
        defaults: {
          endpoint: "/events",
          transform: (value) => value,
          retry: {
            count: 1,
            onRetry: () => {},
          },
        },
      }),
      setup(context) {
        setupSettings.push(context.options);
      },
    });
    const plugin = callbacks({
      endpoint: "/checkout-events",
      retry: { count: 3 },
    });
    const assertInvalidCallbackOverrides = () => {
      // @ts-expect-error Callback values remain atomic factory inputs.
      callbacks({ transform: {} });
      // @ts-expect-error Nested callback values remain atomic factory inputs.
      callbacks({ retry: { onRetry: {} } });
    };

    const state = resolveInstalled(plugin);
    state.plugin.setup?.({} as never);

    expect(assertInvalidCallbackOverrides).toBeTypeOf("function");
    expect(setupSettings).toEqual([
      {
        endpoint: "/checkout-events",
        transform: expect.any(Function),
        retry: {
          count: 3,
          onRetry: expect.any(Function),
        },
      },
    ]);
  });

  it("keeps rich default values atomic in factory input types", () => {
    const richConfig = definePlugin({
      id: "rich-config",
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

  it("requires Page contracts to be recursively static JSON", () => {
    const callback = pluginOptions<{
      nested: { onEvent?: () => void };
    }>();
    const date = pluginOptions<{ createdAt: Date }>();
    const collections = pluginOptions<{
      metadata: Map<string, string>;
      labels: Set<string>;
    }>();
    const primitiveKinds = pluginOptions<{
      sequence: bigint;
      token: symbol;
    }>();
    const requiredUndefined = pluginOptions<{
      channel: string | undefined;
    }>();
    const optionalJson = definePlugin({
      id: "optional-json",
      page: pluginOptions<{
        channel?: string;
        metadata?: {
          flags?: readonly boolean[];
          sampling: null | number;
        };
      }>(),
    });
    const assertInvalidPageContracts = () => {
      definePlugin({
        id: "callback-page",
        // @ts-expect-error Page contract fields must be static JSON recursively.
        page: callback,
      });
      definePlugin({
        id: "date-page",
        // @ts-expect-error Date values cannot cross the Page static-JSON boundary.
        page: date,
      });
      definePlugin({
        id: "collection-page",
        // @ts-expect-error Map and Set values are not Page static JSON.
        page: collections,
      });
      definePlugin({
        id: "primitive-kind-page",
        // @ts-expect-error BigInt and symbol values are not JSON-serializable.
        page: primitiveKinds,
      });
      definePlugin({
        id: "required-undefined-page",
        // @ts-expect-error Only optional object fields may include undefined.
        page: requiredUndefined,
      });
      const schema = {} as StandardSchemaV1<
        { callback: () => void },
        { channel: string }
      >;
      definePlugin({
        id: "schema-input-page",
        // @ts-expect-error Page schema inputs must also be static JSON.
        page: pluginOptions(schema),
      });
    };

    expect(optionalJson()).toBeTypeOf("object");
    expect(assertInvalidPageContracts).toBeTypeOf("function");
  });

  it("accepts only record contracts and preserves tuple option types", () => {
    const tuplePlugin = definePlugin({
      id: "tuple-config",
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
      // @ts-expect-error Plugin configuration contracts must be objects, not arrays.
      pluginOptions<string[]>();
      // @ts-expect-error Plugin configuration contracts must be objects, not functions.
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

  it("resolves one Application snapshot for config and later lifecycle phases", async () => {
    let defaultsCalls = 0;
    let validationCalls = 0;
    const seen: unknown[] = [];
    const contextual = definePlugin({
      id: "contextual",
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
        expect(Object.isFrozen(context)).toBe(true);
        seen.push(context.options);
        return { ...config, routing: { mode: "spa" } };
      },
      setup(context) {
        expect(Object.isFrozen(context)).toBe(true);
        seen.push(context.options);
      },
    });
    const plugin = contextual();
    const configured = await runConfigureHooks(
      { routing: { mode: "mpa" }, plugins: [plugin] },
      {
        cwd: process.cwd(),
        mode: "production",
      },
    );
    const resolved = resolveConfig(configured);
    resolvePluginSettingsState(resolved);
    resolved.plugins[0]?.setup?.({} as never);

    expect(defaultsCalls).toBe(1);
    expect(validationCalls).toBe(1);
    expect(seen).toEqual([
      { sequence: 1, routingMode: "mpa" },
      { sequence: 1, routingMode: "mpa" },
    ]);
    expect(seen[0]).toBe(seen[1]);
  });

  it("isolates Application snapshots across concurrent config sessions", async () => {
    type RoutingMode = "spa" | "mpa";
    const configuredOptions = new Map<RoutingMode, object>();
    const setupOptions = new Map<RoutingMode, object>();
    let configureArrivals = 0;
    let releaseConfigureHooks: (() => void) | undefined;
    const configureHooksReady = new Promise<void>((resolve) => {
      releaseConfigureHooks = resolve;
    });
    const contextual = definePlugin({
      id: "concurrent-contextual",
      application: pluginOptions<{
        routingMode: RoutingMode;
      }>({
        defaults(context) {
          return { routingMode: context.routingMode };
        },
      }),
      async configure(_config, context) {
        configuredOptions.set(context.options.routingMode, context.options);
        configureArrivals++;
        if (configureArrivals === 2) releaseConfigureHooks?.();
        await configureHooksReady;
      },
      setup(context) {
        setupOptions.set(context.options.routingMode, context.options);
      },
    });
    const plugin = contextual();
    const configureContext = {
      cwd: process.cwd(),
      mode: "production",
    } as const;

    const [spaConfigured, mpaConfigured] = await Promise.all([
      runConfigureHooks(
        { routing: { mode: "spa" }, plugins: [plugin] },
        configureContext,
      ),
      runConfigureHooks(
        { routing: { mode: "mpa" }, plugins: [plugin] },
        configureContext,
      ),
    ]);
    const spaResolved = resolveConfig(spaConfigured);
    const mpaResolved = resolveConfig(mpaConfigured);
    resolvePluginSettingsState(spaResolved);
    resolvePluginSettingsState(mpaResolved);
    await spaResolved.plugins[0]?.setup?.({} as never);
    await mpaResolved.plugins[0]?.setup?.({} as never);

    expect([...configuredOptions.keys()].sort()).toEqual(["mpa", "spa"]);
    expect(setupOptions.get("spa")).toBe(configuredOptions.get("spa"));
    expect(setupOptions.get("mpa")).toBe(configuredOptions.get("mpa"));
    expect(setupOptions.get("spa")).not.toBe(setupOptions.get("mpa"));
  });

  it("isolates in-place configure hook mutations from the caller", async () => {
    const plugin: Plugin = {
      id: "isolated-config-hook",
      configure(config) {
        config.server = { ...config.server, basePath: "/candidate" };
      },
    };
    const input: Config = { plugins: [plugin] };

    const configured = await runConfigureHooks(input, {
      cwd: process.cwd(),
      mode: "development",
    });

    expect(configured).not.toBe(input);
    expect(configured?.server).toEqual({ basePath: "/candidate" });
    expect(input.server).toBeUndefined();
  });

  it.each([
    "add",
    "remove",
    "reorder",
    "replace",
  ] as const)("rejects configure hooks that %s the plugin installation", async (mutation) => {
    const events: string[] = [];
    const latePlugin: Plugin = {
      id: "late-plugin",
      configure() {
        events.push("late:configure");
      },
    };
    const replacementPlugin: Plugin = {
      id: "second-plugin",
      configure() {
        events.push("replacement:configure");
      },
    };
    const secondPlugin: Plugin = {
      id: "second-plugin",
      configure() {
        events.push("second:configure");
      },
    };
    const firstPlugin: Plugin = {
      id: "first-plugin",
      configure(config) {
        events.push("first:configure");
        let plugins: NonNullable<Config["plugins"]>;
        if (mutation === "add") {
          plugins = [firstPlugin, secondPlugin, latePlugin];
        } else if (mutation === "remove") {
          plugins = [firstPlugin];
        } else if (mutation === "reorder") {
          plugins = [secondPlugin, firstPlugin];
        } else {
          plugins = [firstPlugin, replacementPlugin];
        }
        if (mutation === "replace") {
          return { ...config, plugins } as unknown as typeof config;
        }
        (config as Config).plugins = plugins;
      },
    };

    await expect(
      runConfigureHooks(
        { plugins: [firstPlugin, secondPlugin] },
        {
          cwd: process.cwd(),
          mode: "production",
        },
      ),
    ).rejects.toThrow(
      '[evjs] Plugin "first-plugin" configure hook cannot change config.plugins. Install plugins only in the Application config.',
    );
    expect(events).toEqual(["first:configure"]);
  });

  it("preserves the Application plugin installation across configure hooks", async () => {
    const events: string[] = [];
    const firstPlugin: Plugin = {
      id: "first-plugin",
      configure() {
        events.push("first:configure");
        return { routing: { mode: "mpa" } };
      },
    };
    const secondPlugin: Plugin = {
      id: "second-plugin",
      configure(config) {
        events.push("second:configure");
        config.server = { basePath: "/api" };
      },
    };

    const configured = await runConfigureHooks(
      {
        plugins: [firstPlugin, false, secondPlugin, null, undefined],
        routing: { mode: "spa" },
      },
      {
        cwd: process.cwd(),
        mode: "production",
      },
    );

    expect(events).toEqual(["first:configure", "second:configure"]);
    expect(
      configured?.plugins?.map((plugin) =>
        plugin && typeof plugin === "object" ? plugin.id : plugin,
      ),
    ).toEqual(["first-plugin", false, "second-plugin", null, undefined]);
    expect(
      resolveConfig(configured).plugins.map((plugin) => plugin.id),
    ).toEqual(["first-plugin", "second-plugin"]);
    expect(configured?.routing).toEqual({ mode: "mpa" });
    expect(configured?.server).toEqual({ basePath: "/api" });
  });

  it("isolates the Application plugin installation from raw config aliases", async () => {
    const events: string[] = [];
    const replacementPlugin: Plugin = { id: "replacement-plugin" };
    const secondPlugin: Plugin = {
      id: "second-plugin",
      configure() {
        events.push("second:configure");
      },
    };
    const firstPlugin: Plugin = {
      id: "first-plugin",
      configure(config) {
        events.push("first:configure");
        const aliasedPlugins = (
          config as typeof config & { pluginAlias: Plugin[] }
        ).pluginAlias;
        aliasedPlugins.splice(1, 1, replacementPlugin);
        Reflect.deleteProperty(config, "pluginAlias");
      },
    };
    const installedPlugins = [firstPlugin, secondPlugin];

    const configured = await runConfigureHooks(
      {
        plugins: installedPlugins,
        pluginAlias: installedPlugins,
      } as Config & { pluginAlias: Plugin[] },
      {
        cwd: process.cwd(),
        mode: "production",
      },
    );

    expect(events).toEqual(["first:configure", "second:configure"]);
    expect(
      configured?.plugins?.map((plugin) =>
        plugin && typeof plugin === "object" ? plugin.id : plugin,
      ),
    ).toEqual(["first-plugin", "second-plugin"]);
    expect(configured).not.toHaveProperty("pluginAlias");
  });

  it("rejects an own undefined plugins field from a configure hook result", async () => {
    const plugin: Plugin = {
      id: "undefined-plugin-installation",
      configure(config) {
        return {
          ...config,
          plugins: undefined,
        } as unknown as typeof config;
      },
    };

    await expect(
      runConfigureHooks(
        { plugins: [plugin] },
        {
          cwd: process.cwd(),
          mode: "production",
        },
      ),
    ).rejects.toThrow(
      '[evjs] Plugin "undefined-plugin-installation" configure hook cannot change config.plugins. Install plugins only in the Application config.',
    );
  });

  it("rejects an accessor named plugins from a configure hook", async () => {
    const plugin: Plugin = {
      id: "accessor-plugin",
      configure(config) {
        Object.defineProperty(config, "plugins", {
          configurable: true,
          enumerable: true,
          get() {
            return undefined;
          },
        });
      },
    };

    await expect(
      runConfigureHooks(
        { plugins: [plugin] },
        {
          cwd: process.cwd(),
          mode: "production",
        },
      ),
    ).rejects.toThrow(
      '[evjs] Plugin "accessor-plugin" configure hook cannot change config.plugins. Install plugins only in the Application config.',
    );
  });

  it("preserves length fields on ordinary config objects", async () => {
    const plugin: Plugin = {
      id: "observes-length-field",
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
      id: "isolated-application-options",
      application: pluginOptions<{
        endpoint: string;
        headers: { regions: string[] };
      }>(),
      setup(context) {
        observed = context.options;
      },
    });
    const plugin = analytics(authored);

    const state = resolveInstalled(plugin);
    authored.endpoint = "/mutated";
    authored.headers.regions.push("caller");
    state.plugin.setup?.({} as never);

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
      id: "server-base",
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

  it.each([
    "Application",
    "Page",
  ] as const)("fails closed for invalid %s validation results", async (owner) => {
    expect(() => resolveValidationResult(owner, () => undefined)).not.toThrow();
    expect(() => resolveValidationResult(owner, () => true)).not.toThrow();
    expect(() => resolveValidationResult(owner, () => false)).toThrow(
      "was rejected by the plugin",
    );
    expect(() => resolveValidationResult(owner, () => "blocked")).toThrow(
      "is invalid: blocked",
    );

    for (const invalid of [null, 1, { rejected: true }]) {
      expect(() => resolveValidationResult(owner, () => invalid)).toThrow(
        "validate() must return true, false, a string message, or undefined",
      );
    }

    expect(() => resolveValidationResult(owner, async () => false)).toThrow(
      "validate() must complete synchronously",
    );
    expect(() =>
      resolveValidationResult(owner, async () => {
        throw new Error("asynchronous validation failed");
      }),
    ).toThrow("validate() must complete synchronously");

    // Let both async functions settle. The resolver must already have attached
    // rejection handling to the rejected result above.
    await Promise.resolve();
  });
});

describe("Application and Page enablement", () => {
  it("uses normal installation for defaults and forPages for explicit opt-in", () => {
    const analytics = definePlugin({
      id: "analytics",
      page: pluginOptions({ defaults: { channel: "web" } }),
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
      options: { channel: "web" },
    });
    expect(pageOnlyGraph.pages.home?.plugins.analytics).toEqual({
      enabled: false,
    });
  });

  const cases: readonly {
    application: "enabled" | "for-pages";
    page: "omitted" | "false" | "true" | "object";
    configured?: ResolvedPagePluginOptionsInput;
    expected: CorePagePluginSetting;
  }[] = [
    {
      application: "enabled",
      page: "omitted",
      expected: { enabled: true, options: { channel: "default" } },
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
      expected: { enabled: true, options: { channel: "default" } },
    },
    {
      application: "enabled",
      page: "object",
      configured: { channel: "checkout" },
      expected: { enabled: true, options: { channel: "checkout" } },
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
      expected: { enabled: true, options: { channel: "default" } },
    },
    {
      application: "for-pages",
      page: "object",
      configured: { channel: "checkout" },
      expected: { enabled: true, options: { channel: "checkout" } },
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
      id: "analytics",
      application: pluginOptions<{ mode: string }>({
        defaults: { mode: "application-default" },
      }),
      page: pluginOptions<{ channel: string }>({
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
      id: "analytics",
      page: pluginOptions<{ channel: string }>(),
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
      options: { channel: "checkout" },
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
    ).toThrow(/uses plugin id "missing".*not installed/);
  });

  it("does not expose Application-only plugins as Page settings", () => {
    const analytics = definePlugin({
      id: "analytics",
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
      'configures plugin "analytics", but plugin "analytics" does not declare Page options.',
    );
  });

  it("validates plugin id syntax before installation lookup", () => {
    expect(() =>
      resolvePagePluginOptions({ Analytics: true }, "Page config plugins"),
    ).toThrow("must be a lowercase plugin id");
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
      id: "authored-schema",
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
      authoredGraph.pages.home?.plugins["authored-schema"]?.options,
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
      id: "default-schema",
      page: pluginOptions(defaultSchema, { defaults }),
    });
    const defaultState = resolveInstalled(defaultPlugin());
    const resolveDefaults = () =>
      applyPluginSettings(createSpaGraph(), defaultState.registry, {
        applicationSettings: defaultState.applicationSettings,
      }).pages.home?.plugins["default-schema"]?.options;

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
      id: "non-static-schema-output",
      // @ts-expect-error Page schema outputs must remain static JSON.
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
      id: "dated",
      // @ts-expect-error Date defaults cannot cross the Page static-JSON boundary.
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
      id: "non-finite",
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
      id: "accessor",
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

  it("keeps rich Application options private while rejecting lazy non-static Page defaults", () => {
    const applicationSettings: unknown[] = [];
    const configuredPlugin = definePlugin({
      id: "configured",
      application: pluginOptions<{ createdAt: Date }>(),
      setup(context) {
        applicationSettings.push(context.options);
      },
    });
    const configured = configuredPlugin({
      createdAt: new Date(0),
    });
    const configuredState = resolveInstalled(configured);
    configuredState.plugin.setup?.({} as never);
    expect(configuredState.applicationSettings.configured).toEqual({
      enabled: true,
    });
    expect(applicationSettings).toEqual([{ createdAt: new Date(0) }]);

    const lazyPlugin = definePlugin({
      id: "lazy",
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
      resolvePagePluginOptions(
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
      id: "analytics",
      application: pluginOptions({ defaults: { endpoint: "/events" } }),
      page: pluginOptions({ defaults: { channel: "default" } }),
      setup(context) {
        expect(Object.isFrozen(context)).toBe(true);
        calls.push(`setup:${context.options.endpoint}`);
      },
      emitIR(context) {
        expect(Object.isFrozen(context)).toBe(true);
        expect(Object.isFrozen(context.pages)).toBe(true);
        expect(context.pages.every(Object.isFrozen)).toBe(true);
        expect(() => {
          (context.pages as unknown as unknown[]).splice(0);
        }).toThrow(TypeError);
        calls.push(`emitIR:${context.pages.length}`);
      },
      emitPageIR(context) {
        expect(Object.isFrozen(context)).toBe(true);
        calls.push(`page:${context.page.id}`);
      },
    });
    const plugin = analytics.forPages();
    const state = resolveInstalled(plugin);

    await state.plugin.setup?.({} as never);
    await state.plugin.emitIR?.({
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
    const pageOptions = graph.pages.home?.plugins.analytics?.options;
    expect(pageOptions).toEqual({ channel: "default" });
    await state.plugin.emitIR?.({
      framework: {
        pages: [
          {
            id: "home",
            plugins: {
              analytics: { enabled: true, options: pageOptions },
            },
          },
        ],
      },
      [Symbol.for("@evjs/ev/plugin-emit-ir-scope-factory")]: () => ({
        emit: {} as never,
        slot: () => ({ add() {} }) as never,
      }),
    } as never);

    expect(calls).toEqual([
      "setup:/events",
      "emitIR:0",
      "emitIR:1",
      "page:home",
    ]);
  });

  it("requires and exposes resolved Application settings before setup", () => {
    const setupSettings: unknown[] = [];
    const analytics = definePlugin({
      id: "analytics",
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
      "Application settings were not resolved before setup()",
    );
    expect(() => applyPluginSettings(createSpaGraph(), registry)).toThrow(
      "were not resolved before graph analysis",
    );

    const state = resolvePluginSettingsState(config, registry);
    config.plugins[0]?.setup?.({} as never);
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
      id: "analytics",
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
  return {
    ...resolvePluginSettingsState(config, registry),
    plugin: config.plugins[0] as Plugin,
  };
}

function resolveValidationResult(
  owner: "Application" | "Page",
  validate: () => unknown,
): void {
  const contract = pluginOptions({
    defaults: { value: 1 },
    validate: validate as never,
  });
  if (owner === "Application") {
    resolveInstalled(
      definePlugin({
        id: "application-validation-result",
        application: contract,
      })(),
    );
    return;
  }

  const installed = resolveInstalled(
    definePlugin({
      id: "page-validation-result",
      page: contract,
    })(),
  );
  applyPluginSettings(createSpaGraph(), installed.registry, {
    applicationSettings: installed.applicationSettings,
  });
}

function createPageConfig(plugins: unknown = {}): ResolvedPageFileConfig {
  const source = "./src/pages/home/page.config.ts";
  return {
    source,
    plugins: resolvePagePluginOptions(plugins, `${source} plugins`),
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
