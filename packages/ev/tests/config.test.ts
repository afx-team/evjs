import { describe, expect, it } from "vitest";
import type { BundlerAdapter } from "../src/_internal/build/bundler.js";
import {
  createNoPageRoutesFoundMessage,
  withPageRoutingDefaults,
} from "../src/_internal/build/convention-config.js";
import type { PageFileConfig } from "../src/config/index.js";
import {
  CONFIG_DEFAULTS,
  defineConfig,
  definePageConfig,
  resolveConfig,
} from "../src/config/index.js";

const fullBundlerCapabilities = {
  build: { server: true, rsc: true, ppr: true },
  dev: {
    html: true,
    entries: true,
    routes: true,
    server: true,
    resolution: true,
  },
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
      extensions: {
        "@company/feature": { enabled: true },
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

  it("isolates strictly static namespaced Application extension config", () => {
    const configured = {
      enabled: true,
      nested: { channel: "web" },
      values: [1, null, "two"],
    };
    const resolved = resolveConfig({
      routing: { mode: "spa" },
      extensions: {
        "@company/feature": configured,
      },
    });

    expect(resolved.extensions).toEqual({
      "@company/feature": configured,
    });
    expect(resolved.extensions["@company/feature"]).not.toBe(configured);
    expect(Object.isFrozen(resolved.extensions)).toBe(true);
    expect(Object.isFrozen(resolved.extensions["@company/feature"])).toBe(true);

    for (const extensions of [
      { feature: true },
      { "@company/date": new Date() },
      { "@company/function": () => undefined },
      { "@company/number": Number.NaN },
      { "@company/sparse": new Array(1) },
      { "@company/extra-array": Object.assign(["value"], { extra: true }) },
    ]) {
      expect(() =>
        resolveConfig({
          routing: { mode: "spa" },
          extensions: extensions as never,
        }),
      ).toThrow();
    }

    let getterCalls = 0;
    const accessorValue = {};
    Object.defineProperty(accessorValue, "enabled", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });
    expect(() =>
      resolveConfig({
        routing: { mode: "spa" },
        extensions: {
          "@company/accessor": accessorValue,
        },
      } as never),
    ).toThrow("must be an enumerable own data property");
    expect(getterCalls).toBe(0);
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
        return { name: "hidden-plugin" };
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

  it("accepts only static namespaced Route and Document extensions", () => {
    const resolved = resolveConfig({
      application: {
        document: {
          extensions: {
            "@company/html": { theme: "dark" },
          },
        },
        routes: [
          {
            page: "home",
            extensions: {
              "@company/navigation": { label: "Home" },
            },
          },
        ],
      },
    });

    expect(resolved.application?.document.extensions).toEqual({
      "@company/html": { theme: "dark" },
    });
    expect(resolved.application?.routes[0]?.extensions).toEqual({
      "@company/navigation": { label: "Home" },
    });
    expect(
      Object.isFrozen(
        resolved.application?.routes[0]?.extensions?.["@company/navigation"],
      ),
    ).toBe(true);

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
    ).toThrow("must be JSON-serializable");
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
    expect(resolved.server.dev).toEqual({
      port: 4200,
      https: { key: "server.key", cert: "server.cert" },
    });
    expect(resolved.transport.baseUrl).toBe("https://runtime.example.com");
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

  it("validates the full bundler capability matrix", () => {
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
  });

  it("accepts only the single plugin descriptor shape", () => {
    const setup = () => ({});
    const describePlugin = () => {};
    const plugin = {
      name: "test-plugin",
      dependencies: ["required"],
      optionalDependencies: ["optional"],
      enforce: "pre" as const,
      describe: describePlugin,
      setup,
    };

    expect(resolveConfig({ plugins: [plugin] }).plugins).toEqual([plugin]);
    expect(() =>
      resolveConfig({
        plugins: [
          {
            name: "metadata-plugin",
            description: "package-local metadata",
          } as never,
        ],
      }),
    ).toThrow("plugins[0].description is not supported");
    expect(() =>
      resolveConfig({
        plugins: [
          {
            name: "test-plugin",
            buildStart() {},
          } as never,
        ],
      }),
    ).toThrow("Return the hook from plugins[0].setup() instead");
    expect(() =>
      resolveConfig({
        plugins: [
          {
            name: "test-plugin",
            buildOutput() {},
          } as never,
        ],
      }),
    ).toThrow("Return the hook from plugins[0].setup() instead");
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
