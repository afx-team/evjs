import { describe, expect, it } from "vitest";
import type { BundlerAdapter } from "../src/bundler.js";
import { CONFIG_DEFAULTS, defineConfig, resolveConfig } from "../src/config.js";

describe("defineConfig", () => {
  it("returns the config object unchanged", () => {
    const config = { entry: "./src/custom.tsx" };
    expect(defineConfig(config)).toBe(config);
  });

  it("accepts an empty config", () => {
    const config = {};
    expect(defineConfig(config)).toBe(config);
  });

  it("does not expose a server.functions endpoint config", () => {
    const config = defineConfig({
      server: {
        // @ts-expect-error server function URLs are derived from server.basePath.
        functions: { endpoint: "/api/rpc" },
      },
    });

    expect(config.server).toEqual({
      functions: { endpoint: "/api/rpc" },
    });
  });

  it("keeps route source paths under apps instead of a top-level app field", () => {
    const config = defineConfig({
      // @ts-expect-error app routes belong in apps.*.routes.
      app: { routes: "./src/routes.tsx" },
    });

    expect(config).toEqual({ app: { routes: "./src/routes.tsx" } });
  });
});

describe("resolveConfig", () => {
  it("applies all defaults when called with no arguments", () => {
    const resolved = resolveConfig();
    expect(resolved.entry).toBe(CONFIG_DEFAULTS.entry);
    expect(resolved.html).toBe(CONFIG_DEFAULTS.html);
    expect(resolved.dev.port).toBe(CONFIG_DEFAULTS.port);
    expect(resolved.dev.https).toBe(false);
    expect(resolved.serverEnabled).toBe(true);
    expect(resolved.server.basePath).toBe("/__evjs");
    expect(resolved.server.runtime).toEqual({
      basePath: "/__evjs",
      fn: "/__evjs/fn",
    });
    expect(resolved.server.functionRuntime.endpoint).toBe("/__evjs/fn");
    expect(resolved.transport).toEqual({ baseUrl: undefined });
    expect(resolved.apps).toBeUndefined();
    expect(resolved.remotes).toEqual({});
    expect(resolved.server.dev.port).toBe(CONFIG_DEFAULTS.serverPort);
    expect(resolved.server.dev.https).toBe(false);
    expect(resolved.bundler).toBeUndefined();
    expect(resolved.plugins).toEqual([]);
  });

  it("applies all defaults when called with empty config", () => {
    const resolved = resolveConfig({});
    expect(resolved.entry).toBe("./src/main.tsx");
    expect(resolved.html).toBe("./index.html");
    expect(resolved.dev.proxy).toBeDefined();
  });

  it("respects user overrides for top-level fields", () => {
    const resolved = resolveConfig({
      entry: "./src/custom.tsx",
      html: "./public/index.html",
    });
    expect(resolved.entry).toBe("./src/custom.tsx");
    expect(resolved.html).toBe("./public/index.html");
  });

  it("respects dev port and https overrides", () => {
    const resolved = resolveConfig({
      dev: { port: 8080, https: true },
    });
    expect(resolved.dev.port).toBe(8080);
    expect(resolved.dev.https).toBe(true);
  });

  it("respects dev https with key/cert object", () => {
    const resolved = resolveConfig({
      dev: { https: { key: "key.pem", cert: "cert.pem" } },
    });
    expect(resolved.dev.https).toEqual({ key: "key.pem", cert: "cert.pem" });
  });

  it("sets serverEnabled=false when server is false", () => {
    const resolved = resolveConfig({ server: false });
    expect(resolved.serverEnabled).toBe(false);
    expect(resolved.server.runtime.fn).toBe("/__evjs/fn");
  });

  it("respects server overrides", () => {
    const resolved = resolveConfig({
      server: {
        entry: "./server.ts",
        basePath: "/api",
        dev: { port: 4000 },
      },
    });
    expect(resolved.serverEnabled).toBe(true);
    expect(resolved.server.entry).toBe("./server.ts");
    expect(resolved.server.runtime.fn).toBe("/api/fn");
    expect(resolved.server.functionRuntime.endpoint).toBe("/api/fn");
    expect(resolved.server.dev.port).toBe(4000);
  });

  it("proxies the server function path derived from basePath in dev", () => {
    const resolved = resolveConfig({
      server: {
        basePath: "/api",
        dev: { port: 4001 },
      },
    });

    expect(resolved.dev.proxy).toContainEqual({
      context: ["/api/fn"],
      target: "http://localhost:4001",
      changeOrigin: true,
      secure: false,
    });
  });

  it("uses a pathname proxy context for the default framework endpoint", () => {
    const resolved = resolveConfig();

    expect(resolved.server.functionRuntime.endpoint).toBe("/__evjs/fn");
    expect(resolved.dev.proxy).toContainEqual({
      context: ["/__evjs/fn"],
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
  });

  it("derives framework server paths from basePath", () => {
    const resolved = resolveConfig({
      server: {
        basePath: "/_ev",
      },
      transport: {
        baseUrl: "https://api.example.com",
      },
    });

    expect(resolved.server.runtime).toEqual({
      basePath: "/_ev",
      fn: "/_ev/fn",
    });
    expect(resolved.transport.baseUrl).toBe("https://api.example.com");
  });

  it("derives the RSC endpoint from the framework server base path", () => {
    const resolved = resolveConfig({
      server: {
        basePath: "/_ev",
        rsc: true,
      },
    });

    expect(resolved.server.runtime).toEqual({
      basePath: "/_ev",
      fn: "/_ev/fn",
      rsc: "/_ev/rsc",
    });
    expect(resolved.server.rsc).toEqual({
      endpoint: "/_ev/rsc",
    });
    expect(resolved.dev.proxy).toContainEqual({
      context: ["/_ev/fn", "/_ev/rsc"],
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
  });

  it("respects explicit RSC endpoint override", () => {
    const resolved = resolveConfig({
      server: {
        rsc: {
          endpoint: "/flight",
        },
      },
    });

    expect(resolved.server.runtime.rsc).toBe("/flight");
    expect(resolved.server.rsc?.endpoint).toBe("/flight");
  });

  it("enables the RSC endpoint when a configured page uses RSC rendering", () => {
    const resolved = resolveConfig({
      server: {
        basePath: "/_ev",
      },
      pages: {
        product: {
          component: "./src/pages/Product.tsx",
          render: "rsc",
        },
      },
    });

    expect(resolved.server.runtime.rsc).toBe("/_ev/rsc");
    expect(resolved.server.rsc?.endpoint).toBe("/_ev/rsc");
    expect(resolved.dev.proxy).toContainEqual({
      context: ["/_ev/fn", "/_ev/rsc"],
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
  });

  it("resolves explicit app route and remote declarations", () => {
    const resolved = resolveConfig({
      apps: {
        console: {
          entry: "./src/console/main.tsx",
          html: "./src/console/index.html",
          routes: "./src/routes.tsx",
        },
      },
      remotes: {
        crm: {
          manifest: "https://assets.example.com/crm/manifest.json",
          activeWhen: ["/crm/*"],
        },
      },
    });

    expect(resolved.apps).toEqual({
      console: {
        entry: "./src/console/main.tsx",
        html: "./src/console/index.html",
        routes: "./src/routes.tsx",
        mount: undefined,
      },
    });
    expect(resolved.remotes).toEqual({
      crm: {
        manifest: "https://assets.example.com/crm/manifest.json",
        activeWhen: ["/crm/*"],
      },
    });
  });

  it("resolves remote build declarations separately from host remotes", () => {
    const resolved = resolveConfig({
      server: false,
      remote: {
        name: "crm",
        baseUrl: "https://assets.example.com/crm/",
        shared: {
          "remote-react": {
            shareKey: "react",
            requiredVersion: ">=19 <20",
            singleton: true,
            strictVersion: true,
            eager: true,
          },
        },
        entries: {
          customers: {
            app: "./src/remote.ts",
            activeWhen: ["/crm/*"],
            mount: "#remote-root",
          },
        },
      },
    });

    expect(resolved.remotes).toEqual({});
    expect(resolved.remote).toEqual({
      name: "crm",
      baseUrl: "https://assets.example.com/crm/",
      shared: {
        "remote-react": {
          shareKey: "react",
          requiredVersion: ">=19 <20",
          singleton: true,
          strictVersion: true,
          eager: true,
        },
      },
      entries: {
        customers: {
          app: "./src/remote.ts",
          activeWhen: ["/crm/*"],
          mount: "#remote-root",
        },
      },
    });
  });

  it("respects server dev https override", () => {
    const resolved = resolveConfig({
      server: {
        dev: { https: { key: "server.key", cert: "server.cert" } },
      },
    });
    expect(resolved.server.dev.https).toEqual({
      key: "server.key",
      cert: "server.cert",
    });
  });

  it("passes bundler adapter through", () => {
    const mockAdapter = {
      name: "test",
      build: async () => {},
      dev: async () => {},
    };
    const resolved = resolveConfig({
      bundler: mockAdapter as unknown as BundlerAdapter<unknown>,
    });
    expect(resolved.bundler).toBe(mockAdapter);
  });

  it("passes plugins through", () => {
    const plugin = { name: "test-plugin" };
    const resolved = resolveConfig({ plugins: [plugin] });
    expect(resolved.plugins).toEqual([plugin]);
  });

  it("does not share state between calls", () => {
    const a = resolveConfig({ entry: "./a.tsx" });
    const b = resolveConfig({ entry: "./b.tsx" });
    expect(a.entry).toBe("./a.tsx");
    expect(b.entry).toBe("./b.tsx");
  });

  it("resolves MPA pages from entry strings", () => {
    const resolved = resolveConfig({
      pages: {
        home: "./src/home/main.tsx",
        campaign: "./src/campaign/main.tsx",
      },
    });

    expect(resolved.pages).toEqual({
      home: {
        entry: "./src/home/main.tsx",
        component: undefined,
        app: undefined,
        html: "./index.html",
        render: "csr",
        hydrate: undefined,
        mount: undefined,
      },
      campaign: {
        entry: "./src/campaign/main.tsx",
        component: undefined,
        app: undefined,
        html: "./index.html",
        render: "csr",
        hydrate: undefined,
        mount: undefined,
      },
    });
  });

  it("resolves MPA pages from entry objects", () => {
    const resolved = resolveConfig({
      html: "./app.html",
      pages: {
        home: { entry: "./src/home/main.tsx" },
        campaign: {
          entry: "./src/campaign/main.tsx",
          html: "./campaign.html",
        },
      },
    });

    expect(resolved.pages).toEqual({
      home: {
        entry: "./src/home/main.tsx",
        component: undefined,
        app: undefined,
        html: "./app.html",
        render: "csr",
        hydrate: undefined,
        mount: undefined,
      },
      campaign: {
        entry: "./src/campaign/main.tsx",
        component: undefined,
        app: undefined,
        html: "./campaign.html",
        render: "csr",
        hydrate: undefined,
        mount: undefined,
      },
    });
  });

  it("resolves framework-managed component pages", () => {
    const resolved = resolveConfig({
      pages: {
        home: {
          path: "/home",
          component: "./src/home/Page.tsx",
          render: "ssg",
          hydrate: "none",
          mount: "#root",
        },
      },
    });

    expect(resolved.pages).toEqual({
      home: {
        path: "/home",
        entry: undefined,
        component: "./src/home/Page.tsx",
        app: undefined,
        html: "./index.html",
        render: "ssg",
        hydrate: "none",
        mount: "#root",
      },
    });
  });

  it("resolves PPR region configuration on component pages", () => {
    const resolved = resolveConfig({
      pages: {
        campaign: {
          component: "./src/campaign/Page.tsx",
          render: "ppr",
          ppr: {
            regions: {
              offer: {
                component: "./src/campaign/Offer.region.tsx",
                fallback: "./src/campaign/OfferSkeleton.tsx",
                cache: "no-store",
                hydrate: "visible",
              },
              inventory: {
                component: "./src/campaign/Inventory.region.tsx",
                cache: { revalidate: 60 },
              },
            },
          },
        },
      },
    });

    expect(resolved.pages?.campaign.ppr).toEqual({
      regions: {
        offer: {
          component: "./src/campaign/Offer.region.tsx",
          fallback: "./src/campaign/OfferSkeleton.tsx",
          cache: "no-store",
          hydrate: "visible",
        },
        inventory: {
          component: "./src/campaign/Inventory.region.tsx",
          cache: { revalidate: 60 },
        },
      },
    });
  });

  it("rejects pages with more than one module contract", () => {
    expect(() =>
      resolveConfig({
        pages: {
          home: {
            entry: "./src/home/main.tsx",
            component: "./src/home/Page.tsx",
          },
        },
      }),
    ).toThrow(
      'Page "home" must specify exactly one of entry, component, or app',
    );
  });
});
