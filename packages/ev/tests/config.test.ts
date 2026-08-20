import { describe, expect, expectTypeOf, it } from "vitest";
import type { BundlerAdapter } from "../src/_internal/build/bundler/contracts.js";
import {
  createNoPageRoutesFoundMessage,
  withPageRoutingDefaults,
} from "../src/_internal/build/discovery/convention-config.js";
import type {
  Config,
  ExtractInstalledPlugin,
  PageFileConfig,
  PagePluginOptions,
} from "../src/config/index.js";
import {
  CONFIG_DEFAULTS,
  defineConfig,
  definePageConfig,
  resolveConfig,
} from "../src/config/index.js";
import {
  edgeDeploymentAdapter,
  nodeDeploymentAdapter,
  staticDeploymentAdapter,
} from "../src/deployment/index.js";
import {
  definePlugin,
  type Plugin,
  pluginOptions,
} from "../src/plugin/index.js";

interface TypedApplicationPluginConfig {
  endpoint: string;
  debug: boolean;
}

interface TypedPagePluginConfig {
  channel: string;
  enabled: boolean;
  options?: {
    sampleRate: number;
  };
}

interface RequiredPagePluginConfig {
  policy: "strict" | "relaxed";
}

interface RequiredApplicationPluginConfig {
  endpoint: string;
  retries?: number;
}

const analyticsPlugin = definePlugin({
  id: "analytics",
  application: pluginOptions<TypedApplicationPluginConfig>({
    defaults: {
      endpoint: "/events",
      debug: false,
    },
  }),
  page: pluginOptions<TypedPagePluginConfig>({
    defaults: {
      channel: "default",
      enabled: true,
    },
  }),
});
const installedAnalyticsPlugin = analyticsPlugin();

const accessPlugin = definePlugin({
  id: "access",
  page: pluginOptions<RequiredPagePluginConfig>(),
});
const installedAccessPlugin = accessPlugin();

const applicationOnlyPlugin = definePlugin({
  id: "application-only",
  application: pluginOptions<RequiredApplicationPluginConfig>(),
});
const installedApplicationOnlyPlugin = applicationOnlyPlugin({
  endpoint: "/events",
});

const inferredDefaultsPlugin = definePlugin({
  id: "inferred-defaults",
  application: pluginOptions({
    defaults: { channel: "web" },
  }),
});
const installedInferredDefaultsPlugin = inferredDefaultsPlugin({
  channel: "checkout",
});

const customBundlerPageConfig = pluginOptions<{ variant: "a" | "b" }>();
const customBundlerPlugin = definePlugin<
  "custom-bundler",
  undefined,
  typeof customBundlerPageConfig,
  { feature: boolean }
>({
  id: "custom-bundler",
  page: customBundlerPageConfig,
});
const installedCustomBundlerPlugin = customBundlerPlugin();

const ambientOnlyPlugin = definePlugin({
  id: "ambient-only",
  page: pluginOptions({ defaults: { enabled: true } }),
})();

const installedEvConfig = defineConfig({
  bundler: {} as BundlerAdapter<{ feature: boolean }>,
  plugins: [
    installedAnalyticsPlugin,
    installedAccessPlugin,
    installedApplicationOnlyPlugin,
    installedCustomBundlerPlugin,
  ] as const,
});

type DeterministicTuplePlugin = ExtractInstalledPlugin<
  { readonly plugins: readonly [typeof installedAnalyticsPlugin] },
  "analytics"
>;
type ConditionalConfigPlugin = ExtractInstalledPlugin<
  | { readonly plugins: readonly [typeof installedAnalyticsPlugin] }
  | { readonly plugins: readonly [typeof installedAccessPlugin] },
  "analytics"
>;
type ConditionalTuplePlugin = ExtractInstalledPlugin<
  {
    readonly plugins:
      | readonly [typeof installedAnalyticsPlugin]
      | readonly [typeof installedAccessPlugin];
  },
  "analytics"
>;
type WidenedArrayPlugin = ExtractInstalledPlugin<
  { readonly plugins: readonly (typeof installedAnalyticsPlugin)[] },
  "analytics"
>;

declare module "../src/config/index.js" {
  interface InstalledPluginRegistry {
    readonly config: typeof installedEvConfig;
    /** Must not affect Page plugin ids; generated `config` is authoritative. */
    readonly ambientOnly: typeof ambientOnlyPlugin;
  }
}

const fullBundlerCapabilities = {
  build: { server: true, rsc: true, ppr: true },
  dev: { clientMiddleware: true },
} as const;

describe("config authoring", () => {
  it("preserves Config and Page config identity", () => {
    const config = defineConfig({
      routing: { mode: "spa" },
    });
    const pageConfig = definePageConfig({
      title: "Orders",
      meta: { description: "Order history" },
      render: "ssr",
      hydrate: "none",
      rsc: true,
      plugins: {
        analytics: { channel: "orders", enabled: true },
      },
    } as const);

    expect(config).toEqual({
      routing: { mode: "spa" },
    });
    expect(pageConfig.title).toBe("Orders");
  });

  it("keeps authoring config types closed", () => {
    const unsupportedConfig = defineConfig({
      // @ts-expect-error Config rejects fields outside its public schema.
      unknown: true,
    });
    const missingMode = defineConfig({
      // @ts-expect-error routing.mode is required.
      routing: {},
    });
    const missingApplicationRoutes = defineConfig({
      // @ts-expect-error application.routes is required.
      application: {},
    });
    const emptyApplicationRoutes = defineConfig({
      application: {
        // @ts-expect-error application.routes must contain at least one route.
        routes: [],
      },
    });
    const invalidPageConfig = definePageConfig({
      // @ts-expect-error arbitrary head DSLs are not Page config.
      head: [["meta", { name: "description", content: "Home" }]],
    });
    // @ts-expect-error omitted render resolves to CSR, which cannot hydrate.
    const invalidDefaultCsrHydration = definePageConfig({ hydrate: "load" });
    const invalidCsrHydration = definePageConfig({
      render: "csr",
      // @ts-expect-error explicit CSR mounts instead of hydrating.
      hydrate: "none",
    });
    // @ts-expect-error PageFileConfig also rejects bypassing definePageConfig.
    const invalidDefaultCsrConfig: PageFileConfig = { hydrate: "none" };
    const invalidCsrConfig: PageFileConfig = {
      render: "csr",
      // @ts-expect-error explicit CSR cannot declare any hydration mode.
      hydrate: "load",
    };

    expect(unsupportedConfig).toHaveProperty("unknown");
    expect(missingMode).toHaveProperty("routing");
    expect(missingApplicationRoutes).toHaveProperty("application");
    expect(emptyApplicationRoutes).toHaveProperty("application");
    expect(invalidPageConfig).toHaveProperty("head");
    expect(invalidDefaultCsrHydration).toHaveProperty("hydrate");
    expect(invalidCsrHydration).toHaveProperty("hydrate");
    expect(invalidDefaultCsrConfig).toHaveProperty("hydrate");
    expect(invalidCsrConfig).toHaveProperty("hydrate");
  });

  it("uses the installed plugin registry for Page plugin configuration", () => {
    const configured = definePageConfig({
      plugins: {
        analytics: {
          channel: "checkout",
          enabled: true,
          options: { sampleRate: 0.5 },
        },
        access: { policy: "strict" },
        "custom-bundler": { variant: "a" },
      },
    });
    const defaultEnabled = definePageConfig({
      plugins: { analytics: true },
    });
    const disabled = definePageConfig({
      plugins: { analytics: false, access: false },
    });

    expectTypeOf(
      configured.plugins.analytics.channel,
    ).toEqualTypeOf<"checkout">();
    expectTypeOf(configured.plugins.access.policy).toEqualTypeOf<"strict">();
    expectTypeOf(
      configured.plugins["custom-bundler"].variant,
    ).toEqualTypeOf<"a">();
    expect(configured.plugins.analytics.options).toEqual({ sampleRate: 0.5 });
    expect(defaultEnabled.plugins.analytics).toBe(true);
    expect(disabled.plugins).toEqual({ analytics: false, access: false });
  });

  it("exposes Page plugin ids only from definitely installed config tuples", () => {
    expectTypeOf<DeterministicTuplePlugin>().toEqualTypeOf<
      typeof installedAnalyticsPlugin
    >();
    expectTypeOf<ConditionalConfigPlugin>().toEqualTypeOf<never>();
    expectTypeOf<ConditionalTuplePlugin>().toEqualTypeOf<never>();
    expectTypeOf<WidenedArrayPlugin>().toEqualTypeOf<never>();
  });

  it("accepts Page plugin settings widened to the public config type", () => {
    const plugins: PagePluginOptions = {
      analytics: false,
      access: { policy: "relaxed" },
    };
    const configured: PageFileConfig = { plugins };

    expect(definePageConfig({ plugins }).plugins).toBe(plugins);
    expect(definePageConfig(configured)).toBe(configured);
  });

  it("accepts explicit and unioned undefined Page plugin maps", () => {
    const explicitUndefined = definePageConfig({ plugins: undefined });
    const defineWithOptionalPlugins = (
      plugins: PagePluginOptions | undefined,
    ) => definePageConfig({ plugins });
    const unionedUndefined = defineWithOptionalPlugins(undefined);

    expect(explicitUndefined.plugins).toBeUndefined();
    expect(unionedUndefined.plugins).toBeUndefined();
  });

  it("rejects unknown plugins and invalid registered Page settings", () => {
    const unknown = definePageConfig({
      plugins: {
        // @ts-expect-error Page plugin ids come from the installed config tuple.
        missing: false,
      },
    });
    const missingRequiredConfig = definePageConfig({
      plugins: {
        // @ts-expect-error true requires Page defaults declared by the plugin.
        access: true,
      },
    });
    const ambientRegistryBypass = definePageConfig({
      plugins: {
        // @ts-expect-error Arbitrary registry fields cannot install Page plugins.
        "ambient-only": true,
      },
    });
    const invalidNestedField = definePageConfig({
      plugins: {
        analytics: {
          channel: "checkout",
          enabled: true,
          options: {
            sampleRate: 1,
            // @ts-expect-error registered Page settings are exact recursively.
            samplRate: 1,
          },
        },
      },
    });
    const nonStaticValue = definePageConfig({
      plugins: {
        analytics: {
          channel: "checkout",
          enabled: true,
          // @ts-expect-error executable values cannot cross the static boundary.
          callback: () => undefined,
        },
      },
    });

    expect(unknown.plugins).toBeDefined();
    expect(missingRequiredConfig.plugins).toBeDefined();
    expect(ambientRegistryBypass.plugins).toBeDefined();
    expect(invalidNestedField.plugins).toBeDefined();
    expect(nonStaticValue.plugins).toBeDefined();
  });

  it("keeps Application configuration on the typed plugin factory", () => {
    const plugin = analyticsPlugin({
      endpoint: "/checkout-events",
      debug: true,
    });
    const config = defineConfig({ plugins: [plugin] });
    const annotated: Config = { plugins: [plugin] };

    expectTypeOf(plugin.id).toEqualTypeOf<"analytics">();
    expect(config.plugins[0]).toBe(plugin);
    expect(defineConfig(annotated)).toBe(annotated);
    expect(installedApplicationOnlyPlugin.id).toBe("application-only");
    expect(installedInferredDefaultsPlugin).toHaveProperty(
      "id",
      "inferred-defaults",
    );
  });

  it("infers custom bundler config while preserving the plugin tuple", () => {
    const bundler: BundlerAdapter<{ feature: boolean }> = {
      name: "custom",
      capabilities: fullBundlerCapabilities,
      async build() {
        return {};
      },
      async dev() {
        return {
          origin: "http://localhost",
          done: Promise.resolve(),
          async close() {},
        };
      },
    };
    const plugin = customBundlerPlugin();
    const config = defineConfig({
      bundler,
      plugins: [
        plugin,
        nodeDeploymentAdapter(),
        staticDeploymentAdapter(),
        edgeDeploymentAdapter(),
      ],
    });
    const composedConfig: Config<{ feature: boolean }> & {
      readonly bundler: typeof bundler;
    } = { bundler, plugins: [plugin] };
    const composed = defineConfig(composedConfig);
    const widened: Config<{ feature: boolean }> = composedConfig;
    const conditionalBundler = Math.random() > 0.5 ? bundler : undefined;
    const assertUnsafeBundlerSelection = () => {
      // @ts-expect-error A custom config must retain its required adapter.
      defineConfig(widened);
      // @ts-expect-error An optional adapter could fall back to Utoopack.
      defineConfig({ bundler: conditionalBundler, plugins: [plugin] });
    };

    expectTypeOf(config.bundler).toEqualTypeOf<typeof bundler>();
    expectTypeOf(config.plugins).toEqualTypeOf<
      readonly [typeof plugin, Plugin, Plugin, Plugin]
    >();
    expect(composed).toBe(composedConfig);
    expect(assertUnsafeBundlerSelection).toBeTypeOf("function");
  });

  it("rejects invalid Application factory and Page plugin values at compile time", () => {
    const assertInvalidAuthoring = () => {
      // @ts-expect-error Application configuration is required.
      applicationOnlyPlugin();
      // @ts-expect-error endpoint is required by the Application contract.
      applicationOnlyPlugin({});
      // @ts-expect-error endpoint must be a string.
      applicationOnlyPlugin({ endpoint: 42 });
      applicationOnlyPlugin({
        endpoint: "/events",
        // @ts-expect-error Application configuration rejects unknown fields.
        debug: true,
      });
      definePageConfig({
        plugins: {
          // @ts-expect-error access Page configuration requires policy.
          access: {},
        },
      });
      definePageConfig({
        plugins: {
          access: {
            // @ts-expect-error policy must match the declared union.
            policy: "admin",
          },
        },
      });
      definePageConfig({
        plugins: {
          // @ts-expect-error Application-only plugins cannot be configured by a Page.
          "application-only": false,
        },
      });
    };

    expect(assertInvalidAuthoring).toBeTypeOf("function");
  });

  it("keeps plugin installation out of the configure hook contract", () => {
    const factory = definePlugin({
      id: "framework-config-only",
      configure(config) {
        // @ts-expect-error Configure hook inputs do not expose plugin installation.
        void config.plugins;
        // @ts-expect-error Configure hook inputs cannot assign plugin installation.
        config.plugins = undefined;
        return config;
      },
    });
    const installedConfig: Config = { plugins: [] };
    type ConfigureHook = NonNullable<Plugin["configure"]>;
    // @ts-expect-error A full Application config cannot be returned from a plugin configure hook.
    const invalidReturnHook: ConfigureHook = () => installedConfig;

    expect(invalidReturnHook).toBeTypeOf("function");
    expect(factory()).toHaveProperty("id", "framework-config-only");
  });
});

describe("resolveConfig", () => {
  it("applies framework defaults without inventing an application entry", () => {
    const resolved = resolveConfig();

    expect(resolved).not.toHaveProperty("entry");
    expect(resolved).not.toHaveProperty("html");
    expect(resolved.routing).toBeUndefined();
    expect(resolved.conventions).toBe(true);
    expect(resolved.server.runtime).toEqual({
      basePath: "/__evjs",
      fn: "__evjs/fn",
      ppr: "__evjs/ppr",
    });
    expect(resolved.server.rsc).toBeUndefined();
    expect(resolved.server.routes).toEqual([]);
    expect(resolved.output).toEqual({
      client: "dist/client",
      server: "dist/server",
      crossOriginLoading: "anonymous",
    });
    expect(resolved.dev.proxy).toEqual([]);
    expect(resolved.dev.cliShortcuts).toBe(true);
    expect(resolved.logging).toEqual({ browserToTerminal: "error" });
  });

  it("resolves dev.cliShortcuts as a boolean", () => {
    expect(
      resolveConfig({ dev: { cliShortcuts: false } }).dev.cliShortcuts,
    ).toBe(false);
    expect(
      resolveConfig({ dev: { cliShortcuts: true } }).dev.cliShortcuts,
    ).toBe(true);
    expect(resolveConfig({}).dev.cliShortcuts).toBe(true);
  });

  it("rejects non-boolean dev.cliShortcuts values", () => {
    for (const cliShortcuts of ["false", 0, null, {}, []]) {
      expect(() =>
        resolveConfig({ dev: { cliShortcuts } } as unknown as Config),
      ).toThrow("[evjs] dev.cliShortcuts must be a boolean when provided.");
    }
  });

  it("resolves logging.browserToTerminal with Next.js-compatible values", () => {
    expect(resolveConfig({}).logging.browserToTerminal).toBe("error");
    expect(
      resolveConfig({ logging: { browserToTerminal: "error" } }).logging
        .browserToTerminal,
    ).toBe("error");
    expect(
      resolveConfig({ logging: { browserToTerminal: "warn" } }).logging
        .browserToTerminal,
    ).toBe("warn");
    expect(
      resolveConfig({ logging: { browserToTerminal: true } }).logging
        .browserToTerminal,
    ).toBe(true);
    expect(
      resolveConfig({ logging: { browserToTerminal: false } }).logging
        .browserToTerminal,
    ).toBe(false);
    expect(resolveConfig({ logging: false }).logging.browserToTerminal).toBe(
      false,
    );
  });

  it("rejects invalid logging.browserToTerminal values", () => {
    for (const browserToTerminal of ["verbose", 0, null, {}, []]) {
      expect(() =>
        resolveConfig({
          logging: { browserToTerminal },
        } as unknown as Config),
      ).toThrow(
        '[evjs] logging.browserToTerminal must be a boolean, "error", or "warn" when provided.',
      );
    }
  });

  it("strictly validates the logging config boundary", () => {
    expect(() => resolveConfig({ logging: true } as unknown as Config)).toThrow(
      "[evjs] logging must be a config object.",
    );
    expect(() =>
      resolveConfig({
        logging: { browserToTerminal: "error", unknown: true },
      } as unknown as Config),
    ).toThrow(
      "[evjs] logging.unknown is not supported. Use browserToTerminal.",
    );
  });

  it("accepts only plain config records at root and nested boundaries", () => {
    class ConfigRecord {
      readonly mode = "spa";
    }

    const inheritedRoot = Object.create({
      routing: { mode: "spa" },
    }) as unknown;
    const inheritedRouting = Object.create({
      mode: "spa",
    }) as unknown;

    for (const [config, path] of [
      [new ConfigRecord(), "config"],
      [new Date(), "config"],
      [inheritedRoot, "config"],
      [{ routing: new ConfigRecord() }, "routing"],
      [{ routing: new Date() }, "routing"],
      [{ routing: inheritedRouting }, "routing"],
    ] as const) {
      expect(() => resolveConfig(config as never)).toThrow(
        `[evjs] ${path} must be`,
      );
    }

    const nullPrototypeConfig = Object.assign(Object.create(null), {
      routing: { mode: "spa" },
    });
    expect(resolveConfig(nullPrototypeConfig).routing?.mode).toBe("spa");
  });

  it("rejects the removed root extension bag", () => {
    expect(() =>
      resolveConfig({
        routing: { mode: "spa" },
        extensions: {
          "@company/feature": { enabled: true },
        },
      } as never),
    ).toThrow("config.extensions is not supported");
  });

  it("rejects accessors without executing them", () => {
    let rootGetterCalls = 0;
    const rootConfig = {};
    Object.defineProperty(rootConfig, "routing", {
      enumerable: true,
      get() {
        rootGetterCalls++;
        return { mode: "spa" };
      },
    });

    expect(() => resolveConfig(rootConfig as never)).toThrow(
      "config.routing must be an enumerable data property",
    );
    expect(rootGetterCalls).toBe(0);

    let nestedGetterCalls = 0;
    const server = {};
    Object.defineProperty(server, "dev", {
      enumerable: true,
      get() {
        nestedGetterCalls++;
        return { port: 4100 };
      },
    });

    expect(() => resolveConfig({ server } as never)).toThrow(
      "server.dev must be an enumerable data property",
    );
    expect(nestedGetterCalls).toBe(0);

    const output = {};
    Object.defineProperty(output, "client", {
      enumerable: true,
      set(_value: string) {},
    });
    expect(() => resolveConfig({ output } as never)).toThrow(
      "output.client must be an enumerable data property",
    );

    let arrayGetterCalls = 0;
    const plugins: unknown[] = [];
    Object.defineProperty(plugins, 0, {
      enumerable: true,
      get() {
        arrayGetterCalls++;
        return { id: "hidden-plugin" };
      },
    });
    expect(() => resolveConfig({ plugins } as never)).toThrow(
      "plugins[0] must be an enumerable data property",
    );
    expect(arrayGetterCalls).toBe(0);
  });

  it("rejects symbol and non-enumerable config fields", () => {
    const routingWithSymbol = { mode: "spa" };
    Object.defineProperty(routingWithSymbol, Symbol("private"), {
      enumerable: true,
      value: true,
    });
    expect(() =>
      resolveConfig({ routing: routingWithSymbol } as never),
    ).toThrow("routing must not contain symbol fields");

    const nonEnumerableOutput = {};
    Object.defineProperty(nonEnumerableOutput, "client", {
      enumerable: false,
      value: "build/client",
    });
    expect(() =>
      resolveConfig({ output: nonEnumerableOutput } as never),
    ).toThrow("output.client must be an enumerable data property");
  });

  it("requires an explicit SPA or MPA routing mode", () => {
    expect(() =>
      resolveConfig({
        routing: {} as never,
      }),
    ).toThrow('[evjs] routing.mode is required and must be "spa" or "mpa".');

    expect(resolveConfig({ routing: { mode: "spa" } }).routing).toEqual({
      mode: "spa",
      html: "./index.html",
      mount: "#app",
      routes: [],
    });
    expect(resolveConfig({ routing: { mode: "mpa" } }).routing).toEqual({
      mode: "mpa",
      html: "./index.html",
      mount: "#app",
      routes: [],
    });
  });

  it("resolves canonical routing document overrides", () => {
    const resolved = resolveConfig({
      routing: {
        mode: "spa",
        html: "./app.html",
        mount: "#root",
      },
    });

    expect(resolved.routing).toEqual({
      mode: "spa",
      html: "./app.html",
      mount: "#root",
      routes: [],
    });
    expect(resolved.routing).not.toHaveProperty("sourceReader");
    expect(resolved.routing).not.toHaveProperty("entry");
  });

  it("normalizes one explicit SPA route-tree profile", () => {
    const resolved = resolveConfig({
      application: {
        pageRoot: "./app/pages",
        document: {
          template: "./app.html",
          mount: "#root",
        },
        layout: "@/layouts/App",
        routes: [
          {
            path: "/",
            page: "home",
            wrappers: ["@/wrappers/Auth"],
          },
          {
            path: "/users",
            routes: [{ path: ":id", page: "users/detail" }],
          },
        ],
      },
    });

    expect(resolved.application).toEqual({
      pageRoot: "./app/pages",
      document: {
        template: "./app.html",
        mount: "#root",
      },
      layout: "./src/layouts/App",
      routes: [
        {
          path: "/",
          page: "home",
          wrappers: ["./src/wrappers/Auth"],
        },
        {
          path: "/users",
          routes: [{ path: ":id", page: "users/detail" }],
        },
      ],
    });
    expect(resolved.routing).toBeUndefined();
  });

  it("uses application.pageRoot for page and component references", () => {
    const resolved = resolveConfig({
      application: {
        pageRoot: "./app/pages",
        routes: [
          { path: "/", page: ".", routes: [] },
          {
            path: "/component",
            component: "@/pages/dashboard/page",
          },
        ],
      },
    });

    expect(resolved.application?.routes).toEqual([
      { path: "/", page: "." },
      {
        path: "/component",
        page: "dashboard",
        component: "./app/pages/dashboard/page",
      },
    ]);
  });

  it("treats exact as a terminal structural assertion", () => {
    const resolved = resolveConfig({
      application: {
        routes: [
          {
            path: "/home",
            page: "home",
            exact: true,
          },
        ],
      },
    });

    expect(resolved.application?.routes).toEqual([
      {
        path: "/home",
        page: "home",
      },
    ]);
  });

  it("rejects children routes and non-structural exact matching", () => {
    expect(() =>
      resolveConfig({
        application: {
          routes: [
            {
              path: "/users",
              children: [{ path: ":id", page: "users/detail" }],
            } as never,
          ],
        },
      }),
    ).toThrow("application.routes[0].children is not supported");

    expect(() =>
      resolveConfig({
        application: {
          routes: [{ path: "/prefix", page: "prefix", exact: false } as never],
        },
      }),
    ).toThrow(
      "application.routes[0].exact only accepts true because Core Routes already use exact terminal-match semantics",
    );

    expect(() =>
      resolveConfig({
        application: {
          routes: [
            {
              path: "/parent",
              page: "parent",
              exact: true,
              routes: [{ path: "child", page: "child" }],
            },
          ],
        },
      }),
    ).toThrow(
      "application.routes[0].exact: true is valid only on a terminal Route",
    );
  });

  it("keeps the explicit route-tree input SPA-only and singular", () => {
    expect(() =>
      resolveConfig({
        application: {
          routes: [{ path: "/", page: "home" }],
          topology: "mpa",
        } as never,
      }),
    ).toThrow("application.topology is not supported");

    expect(() =>
      resolveConfig({
        application: {
          routes: [{ path: "/", page: "home" }],
          mode: "mpa",
        } as never,
      }),
    ).toThrow("application.mode is not supported");

    expect(() =>
      resolveConfig({
        routing: { mode: "spa" },
        application: {
          routes: [{ path: "/", page: "home" }],
        },
      }),
    ).toThrow("application.routes cannot be combined with routing");
  });

  it("rejects unsupported application and Route fields", () => {
    for (const application of [
      {
        routes: [{ page: "home" }],
        html: "./alternate.html",
      },
      {
        routes: [{ page: "home" }],
        mount: "#alternate",
      },
      {
        routes: [{ page: "home" }],
        extensions: {},
      },
    ]) {
      expect(() =>
        resolveConfig({ application: application as never }),
      ).toThrow(/not supported/);
    }

    expect(() =>
      resolveConfig({
        application: {
          routes: [{ page: "home", document: {} } as never],
        },
      }),
    ).toThrow("application.routes[0].document is not supported");
  });

  it("rejects removed Route and Document extension bags", () => {
    expect(() =>
      resolveConfig({
        application: {
          document: {
            extensions: {
              "@company/html": { theme: "dark" },
            },
          } as never,
          routes: [{ page: "home" }],
        },
      }),
    ).toThrow("application.document.extensions is not supported");

    expect(() =>
      resolveConfig({
        application: {
          routes: [
            {
              page: "home",
              extensions: {
                "@company/navigation": () => true,
              },
            } as never,
          ],
        },
      }),
    ).toThrow("application.routes[0].extensions is not supported");
  });

  it("validates explicit Page references and route-tree targets", () => {
    expect(() =>
      resolveConfig({
        application: {} as never,
      }),
    ).toThrow("application requires a non-empty application.routes array");
    expect(() =>
      resolveConfig({
        application: {
          routes: [],
        } as never,
      }),
    ).toThrow("application.routes must be a non-empty array");
    expect(() =>
      resolveConfig({
        application: {
          routes: [{ page: "../escape" }],
        },
      }),
    ).toThrow("must be a safe Page id relative to application.pageRoot");
    expect(() =>
      resolveConfig({
        application: {
          pageRoot: "./app/pages",
          routes: [
            {
              component: "./src/pages/outside/page",
            },
          ],
        },
      }),
    ).toThrow('outside application.pageRoot "./app/pages"');
    expect(() =>
      resolveConfig({
        application: {
          routes: [{ page: "home", redirect: "/elsewhere" }],
        },
      }),
    ).toThrow("must not declare both page and redirect");
    expect(() =>
      resolveConfig({
        application: {
          routes: [{ path: "/group" }],
        },
      }),
    ).toThrow("must declare page, redirect, or nested routes");
  });

  it("supports only one global convention opt-out", () => {
    const resolved = resolveConfig({ conventions: false });
    expect(resolved.conventions).toBe(false);
    expect(resolved.routing).toBeUndefined();
    expect(resolved.server.routes).toBeUndefined();
    expect(resolved.server.conventions).toBeUndefined();

    expect(() =>
      resolveConfig({
        conventions: false,
        routing: { mode: "spa" },
      }),
    ).toThrow("conventions: false cannot be combined with routing");
    expect(
      resolveConfig({
        conventions: false,
        application: { routes: [{ page: "home" }] },
      }).application,
    ).toBeDefined();
  });

  it("rejects unknown fields at every authoring boundary", () => {
    expect(() => resolveConfig({ unknown: true } as never)).toThrow(
      "config.unknown is not supported",
    );
    expect(() =>
      resolveConfig({
        application: { routes: [{ page: "home" }], unknown: true },
      } as never),
    ).toThrow("application.unknown is not supported");
    expect(() =>
      resolveConfig({ routing: { mode: "spa", unknown: true } } as never),
    ).toThrow("routing.unknown is not supported");
    expect(() => resolveConfig({ server: { unknown: true } } as never)).toThrow(
      "server.unknown is not supported",
    );
    expect(() =>
      resolveConfig({
        target: { android: 5, ios: 8 },
        polyfill: { unknown: true },
      } as never),
    ).toThrow("polyfill.unknown is not supported");
  });

  it("uses target as the compatibility switch and resolves core-js", () => {
    expect(resolveConfig()).not.toHaveProperty("polyfill");
    expect(resolveConfig()).not.toHaveProperty("target");
    expect(resolveConfig({ target: { android: 6, ios: 10 } })).toMatchObject({
      target: { android: 6, ios: 10 },
      polyfill: { coreJs: "bundled" },
    });
    expect(
      resolveConfig({ target: { android: 5, ios: 8 }, polyfill: {} }).polyfill,
    ).toEqual({ coreJs: "bundled" });
    expect(
      resolveConfig({
        target: { android: 6, ios: 10 },
        polyfill: {
          coreJs: "https://cdn.example.com/core-js-bundle.min.js",
        },
      }).polyfill,
    ).toEqual({
      coreJs: {
        source: "umd",
        url: "https://cdn.example.com/core-js-bundle.min.js",
      },
    });

    for (const coreJs of [
      "./core-js.js",
      "/core-js.js",
      "javascript:alert(1)",
      " ",
      42,
    ]) {
      expect(() =>
        resolveConfig({
          target: { android: 5, ios: 8 },
          polyfill: { coreJs },
        } as never),
      ).toThrow("polyfill.coreJs");
    }

    for (const polyfill of [null, true, "core-js", []]) {
      expect(() =>
        resolveConfig({
          target: { android: 5, ios: 8 },
          polyfill,
        } as never),
      ).toThrow("polyfill must be a config object");
    }

    expect(() => resolveConfig({ polyfill: {} })).toThrow(
      "polyfill requires target",
    );
    for (const target of ["legacy", true, [], null]) {
      expect(() => resolveConfig({ target } as never)).toThrow(
        "target must be a browser target object",
      );
    }
    expect(() => resolveConfig({ target: { android: 4.4, ios: 8 } })).toThrow(
      "target.android must be at least 5",
    );
    expect(() => resolveConfig({ target: { android: 5, ios: 7 } })).toThrow(
      "target.ios must be at least 8",
    );
    for (const target of [
      {},
      { android: 5 },
      { android: 5, ios: Number.NaN },
      { android: "6", ios: 10 },
    ]) {
      expect(() => resolveConfig({ target } as never)).toThrow(
        /target\.(android|ios) must be a finite number/,
      );
    }
    expect(() =>
      resolveConfig({ target: { android: 5, ios: 8, chrome: 37 } } as never),
    ).toThrow("target.chrome is not supported");
  });

  it("rejects unsupported routing shapes", () => {
    expect(() => resolveConfig({ routing: true as never })).toThrow(
      "routing must be an object",
    );
  });

  it("resolves output, dev, server, and transport settings", () => {
    const resolved = resolveConfig({
      output: {
        client: "build/client",
        server: "build/server",
        crossOriginLoading: "use-credentials",
      },
      dev: {
        port: 4100,
        https: { key: "client.key", cert: "client.cert" },
        proxy: [{ context: ["/api"], target: "https://api.example.com" }],
      },
      server: {
        basePath: "/_ev",
        resolve: {
          alias: { "server-sdk": "./src/server/sdk.ts" },
        },
        externals: {
          "native-addon": "commonjs native-addon",
        },
        dev: {
          port: 4200,
          https: { key: "server.key", cert: "server.cert" },
        },
      },
      transport: {
        baseUrl: "https://runtime.example.com",
      },
    });

    expect(resolved.output).toEqual({
      client: "build/client",
      server: "build/server",
      crossOriginLoading: "use-credentials",
    });
    expect(resolved.dev.port).toBe(4100);
    expect(resolved.dev.https).toEqual({
      key: "client.key",
      cert: "client.cert",
    });
    expect(resolved.dev.proxy[0]).toEqual({
      context: ["/api"],
      target: "https://api.example.com",
    });
    expect(resolved.server.basePath).toBe("/_ev");
    expect(resolved.server.runtime).toEqual({
      basePath: "/_ev",
      fn: "_ev/fn",
      ppr: "_ev/ppr",
    });
    expect(resolved.server.routes).toEqual([]);
    expect(resolved.server.resolve).toEqual({
      alias: { "server-sdk": "./src/server/sdk.ts" },
    });
    expect(resolved.server.externals).toEqual({
      "native-addon": "commonjs native-addon",
    });
    expect(resolved.server.dev).toEqual({
      port: 4200,
      https: { key: "server.key", cert: "server.cert" },
    });
    expect(resolved.transport.baseUrl).toBe("https://runtime.example.com");
  });

  it("strictly validates server-only build settings", () => {
    expect(() =>
      resolveConfig({
        server: { resolve: { extensions: [".ts"] } },
      } as never),
    ).toThrow("server.resolve.extensions is not supported");
    expect(() =>
      resolveConfig({
        server: { resolve: { alias: { sdk: " " } } },
      }),
    ).toThrow('server.resolve.alias["sdk"] must be a non-empty string');
    expect(() =>
      resolveConfig({
        server: { externals: { native: false } },
      } as never),
    ).toThrow('server.externals["native"] must be a non-empty string');
  });

  it("rejects output directories that can escape or alias the project root", () => {
    const unsafeDirectories = [
      ".",
      "..",
      "./build",
      "build/./client",
      "build/../client",
      "build//client",
      "build/client/",
      "build\\client",
      "../outside",
      "/tmp/evjs-output",
      "C:\\temp\\evjs-output",
      "\\\\server\\share\\evjs-output",
    ];

    for (const directory of unsafeDirectories) {
      expect(() =>
        resolveConfig({
          output: { client: directory, server: "safe-server-output" },
        }),
      ).toThrow(/\[evjs\] output\.client must/);
      expect(() =>
        resolveConfig({
          output: { client: "safe-client-output", server: directory },
        }),
      ).toThrow(/\[evjs\] output\.server must/);
    }
  });

  it("rejects equal or nested client and server output directories", () => {
    for (const output of [
      { client: "build/client", server: "build/client" },
      { client: "build", server: "build/server" },
      { client: "build/client", server: "build" },
      { client: "BUILD/client", server: "build/client" },
    ]) {
      expect(() => resolveConfig({ output })).toThrow(
        "[evjs] output.client and output.server must be separate, non-nested directories.",
      );
    }
  });

  it("treats server.rsc only as an endpoint override", () => {
    expect(() =>
      resolveConfig({
        server: { rsc: true as never },
      }),
    ).toThrow("server.rsc is an endpoint override, not an enable switch");
    expect(() =>
      resolveConfig({
        server: { rsc: false as never },
      }),
    ).toThrow("server.rsc is an endpoint override, not an enable switch");

    const resolved = resolveConfig({
      server: {
        basePath: "/_ev",
        rsc: { endpoint: "/flight" },
      },
    });
    expect(resolved.server.rsc).toEqual({ endpoint: "flight" });
    expect(resolved.server.runtime.rsc).toBe("flight");
    expect(resolved.dev.proxy).toEqual([]);
  });

  it("requires concrete static framework runtime pathnames", () => {
    const invalidPaths = [
      "/runtime/:tenant",
      "/runtime/*",
      "/runtime/%66n",
      "/runtime/航班",
      "/runtime//fn",
      "/runtime/./fn",
      "/runtime/../fn",
      "/",
    ] as const;
    for (const basePath of invalidPaths) {
      expect(() => resolveConfig({ server: { basePath } })).toThrow(
        "[evjs] server.basePath must use non-empty ASCII URL-safe segments",
      );
    }
    for (const endpoint of invalidPaths) {
      expect(() => resolveConfig({ server: { rsc: { endpoint } } })).toThrow(
        "[evjs] server.rsc.endpoint must use non-empty ASCII URL-safe segments",
      );
    }
  });

  it("validates bundler build capabilities", () => {
    const adapter = {
      name: "test",
      capabilities: fullBundlerCapabilities,
      build: async () => ({}),
      dev: async () => undefined,
    } as unknown as BundlerAdapter<unknown>;

    expect(resolveConfig({ bundler: adapter }).bundler).toBe(adapter);
    expect(() =>
      resolveConfig({
        bundler: {
          name: "test",
          build: async () => ({}),
          dev: async () => undefined,
        } as never,
      }),
    ).toThrow("bundler.capabilities must be a bundler capabilities object");
    expect(() =>
      resolveConfig({
        bundler: {
          ...adapter,
          capabilities: {
            ...fullBundlerCapabilities,
            build: {
              ...fullBundlerCapabilities.build,
              rsc: "yes",
            },
          },
        } as never,
      }),
    ).toThrow("bundler.capabilities.build.rsc must be a boolean");
    expect(
      resolveConfig({
        bundler: {
          ...adapter,
          capabilities: {
            ...fullBundlerCapabilities,
            dev: { clientMiddleware: false },
          },
        },
      }).bundler?.capabilities.dev,
    ).toEqual({ clientMiddleware: false });
    expect(() =>
      resolveConfig({
        bundler: {
          ...adapter,
          capabilities: {
            ...fullBundlerCapabilities,
            dev: { clientMiddleware: "yes" },
          },
        } as never,
      }),
    ).toThrow("bundler.capabilities.dev.clientMiddleware must be a boolean");
    expect(() =>
      resolveConfig({
        bundler: {
          ...adapter,
          capabilities: {
            ...fullBundlerCapabilities,
            dev: { clientMiddleware: true, websocket: true },
          },
        } as never,
      }),
    ).toThrow("bundler.capabilities.dev.websocket is not supported");
  });

  it("accepts only the single plugin descriptor shape", () => {
    const setup = () => ({});
    const cliShortcuts = () => [{ key: "h", description: "help" }];
    const plugin = {
      id: "test-plugin",
      dependencies: ["required"],
      optionalDependencies: ["optional"],
      enforce: "pre" as const,
      cliShortcuts,
      setup,
    };
    const resolved = resolveConfig({
      plugins: [false, plugin, null, undefined],
    });

    expect(resolved.plugins).toEqual([plugin]);
    expect(resolved.plugins[0]).toMatchObject({
      id: "test-plugin",
      cliShortcuts,
    });
    expect(resolved.plugins[0]).not.toBe(plugin);
    expect(Object.isFrozen(resolved.plugins[0])).toBe(true);
    expect(Object.isFrozen(resolved.plugins[0]?.dependencies)).toBe(true);
    expect(Object.isFrozen(resolved.plugins[0]?.optionalDependencies)).toBe(
      true,
    );
    expect(Reflect.set(resolved.plugins[0] ?? {}, "id", "mutated")).toBe(false);
    expect(() =>
      resolveConfig({
        plugins: [
          {
            id: "legacy-descriptor",
            describe() {},
          } as never,
        ],
      }),
    ).toThrow("plugins[0].describe is not supported");
    expect(() =>
      resolveConfig({
        plugins: [
          {
            id: "metadata-plugin",
            description: "package-local metadata",
          } as never,
        ],
      }),
    ).toThrow("plugins[0].description is not supported");
    expect(() =>
      resolveConfig({
        plugins: [
          {
            id: "test-plugin",
            beforeBuild() {},
          } as never,
        ],
      }),
    ).toThrow("Return the hook from plugins[0].setup() instead");
    expect(() =>
      resolveConfig({
        plugins: [
          {
            id: "misplaced-dev-server-ready",
            devServerReady() {},
          } as never,
        ],
      }),
    ).toThrow("Return the hook from plugins[0].setup() instead");
    expect(() =>
      resolveConfig({
        plugins: [
          {
            id: "legacy-shortcuts-hook",
            configureShortcuts() {},
          } as never,
        ],
      }),
    ).toThrow("plugins[0].configureShortcuts is not supported");
    expect(() =>
      resolveConfig({
        plugins: [{ id: "invalid-shortcuts", cliShortcuts: true } as never],
      }),
    ).toThrow("plugins[0].cliShortcuts must be a function");
    expect(() =>
      resolveConfig({
        plugins: [
          {
            id: "removed-contribute-hook",
            contribute() {},
          } as never,
        ],
      }),
    ).toThrow("plugins[0].contribute is not supported");
    expect(() =>
      resolveConfig({
        plugins: [
          {
            id: "test-plugin",
            transformOutput() {},
          } as never,
        ],
      }),
    ).toThrow("Return the hook from plugins[0].setup() instead");
    expect(() =>
      resolveConfig({ plugins: [{ name: "legacy-name" } as never] }),
    ).toThrow("plugins[0].name is not supported");
    expect(() =>
      resolveConfig({
        plugins: [{ id: "legacy-key", key: "legacy-key" } as never],
      }),
    ).toThrow("plugins[0].key is not supported");
    expect(() =>
      resolveConfig({
        plugins: [
          { id: "legacy-settings-key", settingsKey: "legacy" } as never,
        ],
      }),
    ).toThrow("plugins[0].settingsKey is not supported");
  });

  it("does not share resolved mutable state between calls", () => {
    const first = resolveConfig({ routing: { mode: "spa" } });
    const second = resolveConfig({ routing: { mode: "spa" } });

    first.routing?.routes.push({
      id: "mutated",
      path: "/mutated",
      module: "./src/pages/mutated/page.tsx",
    });
    first.dev.proxy.push({
      context: ["/mutated"],
      target: "http://localhost:9999",
    });

    expect(second.routing?.routes).toEqual([]);
    expect(second.dev.proxy).toEqual([]);
  });

  it("keeps the empty Page tree hint anchored on page.tsx", () => {
    expect(createNoPageRoutesFoundMessage()).toContain("./src/pages/page.tsx");
  });

  it("rejects an explicit routing request missing from resolved config", async () => {
    await expect(
      withPageRoutingDefaults(
        resolveConfig(),
        { routing: { mode: "spa" } },
        process.cwd(),
        { syncRouteTypes: false },
      ),
    ).rejects.toThrow(
      "Internal invariant: explicit routing config was not preserved",
    );
  });

  it("keeps stable exported defaults for remaining config concepts", () => {
    expect(CONFIG_DEFAULTS).not.toHaveProperty("entry");
    expect(CONFIG_DEFAULTS).not.toHaveProperty("routingMode");
    expect(CONFIG_DEFAULTS.pageRoot).toBe("./src/pages");
    expect(CONFIG_DEFAULTS.mount).toBe("#app");
  });
});
