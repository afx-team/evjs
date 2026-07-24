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
            children: [{ path: ":id", page: "users/detail" }],
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
            name: "test-plugin",
            description: "legacy metadata",
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
