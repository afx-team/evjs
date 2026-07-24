import { describe, expect, it } from "vitest";
import type { BundlerAdapter } from "../src/_internal/build/bundler.js";
import {
  createNoPageRoutesFoundMessage,
  withPageRoutingDefaults,
} from "../src/_internal/build/convention-config.js";
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
      routing: { mode: "spa", dir: "./src/pages" },
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
      routing: { mode: "spa", dir: "./src/pages" },
    });
    expect(pageConfig.title).toBe("Orders");
  });

  it("keeps removed config lanes out of the authoring type", () => {
    const legacyApp = defineConfig({
      // @ts-expect-error app is not part of Core 0.3 Config.
      app: { entry: "./src/main.tsx" },
    });
    const legacyPages = defineConfig({
      // @ts-expect-error pages are authored with src/pages/**/page.*.
      pages: { home: "./src/pages/home.tsx" },
    });
    const missingMode = defineConfig({
      // @ts-expect-error routing.mode is required.
      routing: { dir: "./src/pages" },
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

    expect(legacyApp).toHaveProperty("app");
    expect(legacyPages).toHaveProperty("pages");
    expect(missingMode).toHaveProperty("routing");
    expect(missingApplicationRoutes).toHaveProperty("application");
    expect(emptyApplicationRoutes).toHaveProperty("application");
    expect(invalidPageConfig).toHaveProperty("head");
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
    expect(resolved.server.routing).toEqual({
      dir: "./src/apis",
      routes: [],
    });
    expect(resolved.output).toEqual({
      client: "dist/client",
      server: "dist/server",
      crossOriginLoading: "anonymous",
    });
    expect(resolved.dev.proxy).toContainEqual({
      context: ["/__evjs/fn", "/__evjs/ppr", "/__evjs/rsc"],
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
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
      dir: "./src/pages",
      html: "./index.html",
      mount: "#app",
      routes: [],
    });
    expect(resolveConfig({ routing: { mode: "mpa" } }).routing).toEqual({
      mode: "mpa",
      dir: "./src/pages",
      html: "./index.html",
      mount: "#app",
      routes: [],
    });
  });

  it("resolves canonical routing overrides without a source discriminator", () => {
    const resolved = resolveConfig({
      routing: {
        mode: "spa",
        dir: "./app/pages",
        html: "./app.html",
        mount: "#root",
      },
    });

    expect(resolved.routing).toEqual({
      mode: "spa",
      dir: "./app/pages",
      html: "./app.html",
      mount: "#root",
      routes: [],
    });
    expect(resolved.routing).not.toHaveProperty("sourceReader");
    expect(resolved.routing).not.toHaveProperty("entry");
  });

  it("normalizes one Bigfish SPA migration profile", () => {
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

  it("normalizes the application Page root and empty leaf routes", () => {
    const resolved = resolveConfig({
      application: {
        routes: [
          { path: "/", page: ".", routes: [] },
          { path: "/legacy", component: "@/pages/page" },
        ],
      },
    });

    expect(resolved.application?.routes).toEqual([
      { path: "/", page: "." },
      {
        path: "/legacy",
        page: ".",
        component: "./src/pages/page",
      },
    ]);
  });

  it("retains only documented Bigfish route metadata", () => {
    const resolved = resolveConfig({
      application: {
        routes: [
          {
            path: "/home",
            page: "home",
            name: "首页",
            icon: "home",
            title: "Home",
            hideInMenu: false,
            flatMenu: true,
            spmBPos: { a226: "b1", a1853: "b2" },
            access: "canReadHome",
            menuKey: { spcenter: null, merchant_b: "" },
            menuAssetOptions: {
              source: "route",
              nested: { enabled: true },
              positions: [1, "two", null],
            },
            exact: true,
          },
        ],
      },
    });

    expect(resolved.application?.routes).toEqual([
      {
        path: "/home",
        page: "home",
        metadata: {
          name: "首页",
          icon: "home",
          title: "Home",
          hideInMenu: false,
          flatMenu: true,
          spmBPos: { a226: "b1", a1853: "b2" },
          access: "canReadHome",
          menuKey: { spcenter: null, merchant_b: "" },
          menuAssetOptions: {
            source: "route",
            nested: { enabled: true },
            positions: [1, "two", null],
          },
        },
      },
    ]);
  });

  it("rejects removed children routes and non-structural exact matching", () => {
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
    ).toThrow(
      "application.routes[0].children is not supported. Current Umi/Bigfish route config uses routes",
    );

    expect(() =>
      resolveConfig({
        application: {
          routes: [
            { path: "/legacy-prefix", page: "legacy", exact: false } as never,
          ],
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

  it("validates Bigfish route metadata without accepting an open JSON bag", () => {
    for (const route of [
      { page: "home", hideInMenu: "yes" },
      { page: "home", spmBPos: {} },
      { page: "home", spmBPos: { a226: false } },
      { page: "home", menuKey: 42 },
      { page: "home", menuAssetOptions: [] },
      { page: "home", menuAssetOptions: { transform: () => undefined } },
    ]) {
      expect(() =>
        resolveConfig({
          application: { routes: [route as never] },
        }),
      ).toThrow();
    }
  });

  it("keeps the Bigfish migration input SPA-only and singular", () => {
    expect(() =>
      resolveConfig({
        application: {
          routes: [{ path: "/", page: "home" }],
          topology: "mpa",
        } as never,
      }),
    ).toThrow("Bigfish-style application.routes is always SPA");

    expect(() =>
      resolveConfig({
        application: {
          routes: [{ path: "/", page: "home" }],
          mode: "mpa",
        } as never,
      }),
    ).toThrow("Bigfish-style application.routes is always SPA");

    expect(() =>
      resolveConfig({
        routing: { mode: "spa" },
        application: {
          routes: [{ path: "/", page: "home" }],
        },
      }),
    ).toThrow("application.routes cannot be combined with routing");
  });

  it("rejects removed application and route migration fields", () => {
    for (const application of [
      {
        routes: [{ page: "home" }],
        html: "./legacy.html",
      },
      {
        routes: [{ page: "home" }],
        mount: "#legacy",
      },
      {
        routes: [{ page: "home" }],
        extensions: {},
      },
    ]) {
      expect(() =>
        resolveConfig({ application: application as never }),
      ).toThrow(/has been removed|not supported/);
    }

    expect(() =>
      resolveConfig({
        application: {
          routes: [{ page: "home", document: {} } as never],
        },
      }),
    ).toThrow("application.routes[0].document is not supported");
    expect(() =>
      resolveConfig({
        application: {
          routes: [{ page: "home", extensions: {} } as never],
        },
      }),
    ).toThrow("application.routes[0].extensions is not supported");
  });

  it("validates Bigfish Page references and route-tree targets", () => {
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
    expect(resolved.server.routing).toBeUndefined();
    expect(resolved.server.conventions).toBeUndefined();

    expect(() =>
      resolveConfig({
        conventions: false,
        routing: { mode: "spa" },
      }),
    ).toThrow("conventions: false cannot be combined with routing");
    expect(() =>
      resolveConfig({
        conventions: false,
        server: { routing: {} },
      }),
    ).toThrow("conventions: false cannot be combined with server.routing");

    expect(
      resolveConfig({
        conventions: false,
        application: { routes: [{ page: "home" }] },
      }).application,
    ).toBeDefined();
  });

  it("rejects every removed root routing and application lane", () => {
    const removed = [
      ["entry", "./src/main.tsx"],
      ["app", { entry: "./src/main.tsx" }],
      ["apps", { main: "./src/main.tsx" }],
      ["pages", { home: "./src/pages/home.tsx" }],
      ["routes", [{ page: "home" }]],
      ["html", "./legacy.html"],
    ] as const;

    for (const [key, value] of removed) {
      expect(() => resolveConfig({ [key]: value } as never)).toThrow(
        `config.${key}`,
      );
    }
  });

  it("rejects removed routing readers and manual entries", () => {
    expect(() => resolveConfig({ routing: true as never })).toThrow(
      "routing: true has been removed",
    );
    expect(() =>
      resolveConfig({
        routing: { mode: "spa", compatibility: { source: "smallfish" } },
      } as never),
    ).toThrow("routing.compatibility has been removed");
    expect(() =>
      resolveConfig({
        routing: { mode: "spa", entry: "./src/main.tsx" },
      } as never),
    ).toThrow("routing.entry has been removed");
    expect(() =>
      resolveConfig({
        routing: { mode: "spa", routes: [] },
      } as never),
    ).toThrow("routing.routes is not a public config field");
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
        basePath: "/_ev/",
        routing: { dir: "./src/http" },
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
    expect(resolved.server.routing?.dir).toBe("./src/http");
    expect(resolved.server.dev).toEqual({
      port: 4200,
      https: { key: "server.key", cert: "server.cert" },
    });
    expect(resolved.transport.baseUrl).toBe("https://runtime.example.com");
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
    expect(resolved.dev.proxy).toContainEqual({
      context: ["/_ev/fn", "/_ev/ppr", "/flight"],
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
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
    expect(() =>
      resolveConfig({
        plugins: [
          {
            name: "test-plugin",
            onBuildComplete() {},
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
    expect(second.dev.proxy).toHaveLength(1);
  });

  it("keeps the empty Page tree hint anchored on page.tsx", () => {
    expect(createNoPageRoutesFoundMessage("./src/pages")).toContain(
      "./src/pages/page.tsx",
    );
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
    expect(CONFIG_DEFAULTS.routingDir).toBe("./src/pages");
    expect(CONFIG_DEFAULTS.mount).toBe("#app");
  });
});
