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

  it("accepts a single app declaration", () => {
    const config = defineConfig({
      app: { entry: "./src/main.tsx" },
    });

    expect(config).toEqual({ app: { entry: "./src/main.tsx" } });
  });

  it("accepts routing configuration", () => {
    const config = defineConfig({
      routing: {
        dir: "./src/pages",
        layout: "./src/shell/AppLayout.tsx",
        mount: "#root",
      },
    });

    expect(config).toEqual({
      routing: {
        dir: "./src/pages",
        layout: "./src/shell/AppLayout.tsx",
        mount: "#root",
      },
    });
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
      rsc: "/__evjs/rsc",
    });
    expect(resolved.server.functionRuntime.endpoint).toBe("/__evjs/fn");
    expect(resolved.transport).toEqual({ baseUrl: undefined });
    expect(resolved.apps).toBeUndefined();
    expect(resolved.routing).toBeUndefined();
    expect(resolved.remotes).toEqual({});
    expect(resolved.server.dev.port).toBe(CONFIG_DEFAULTS.serverPort);
    expect(resolved.server.dev.https).toBe(false);
    expect(resolved.bundler).toBeUndefined();
    expect(resolved.plugins).toEqual([]);
  });

  it("resolves routing defaults when enabled", () => {
    const resolved = resolveConfig({
      routing: true,
    });

    expect(resolved.routing).toEqual({
      mode: "spa",
      dir: "./src/pages",
      html: "./index.html",
      mount: "#app",
      routes: [],
    });
  });

  it("respects routing overrides", () => {
    const resolved = resolveConfig({
      html: "./app.html",
      routing: {
        dir: "./app/pages",
        html: "./shell.html",
        layout: "./app/ShellLayout.tsx",
        mount: "#root",
      },
    });

    expect(resolved.routing).toEqual({
      mode: "spa",
      dir: "./app/pages",
      html: "./shell.html",
      layout: "./app/ShellLayout.tsx",
      mount: "#root",
      routes: [],
    });
  });

  it("supports disabling the SPA root layout", () => {
    const resolved = resolveConfig({
      routing: {
        mode: "spa",
        layout: false,
      },
    });

    expect(resolved.routing).toEqual({
      mode: "spa",
      dir: "./src/pages",
      html: "./index.html",
      mount: "#app",
      layout: false,
      routes: [],
    });
  });

  it("rejects routing layout configuration in MPA mode", () => {
    expect(() =>
      resolveConfig({
        routing: {
          mode: "mpa",
          layout: "./src/shell/AppLayout.tsx",
        },
      }),
    ).toThrow("[evjs] routing.layout is only supported in SPA mode.");
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
      context: ["/api/fn", "/api/rsc"],
      target: "http://localhost:4001",
      changeOrigin: true,
      secure: false,
    });
  });

  it("uses a pathname proxy context for the default framework endpoint", () => {
    const resolved = resolveConfig();

    expect(resolved.server.functionRuntime.endpoint).toBe("/__evjs/fn");
    expect(resolved.dev.proxy).toContainEqual({
      context: ["/__evjs/fn", "/__evjs/rsc"],
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
      rsc: "/_ev/rsc",
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

  it("enables the RSC endpoint with the framework server runtime", () => {
    const resolved = resolveConfig({
      server: {
        basePath: "/_ev",
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

  it("resolves app declaration sources and remotes", () => {
    const resolved = resolveConfig({
      app: {
        entry: "./src/admin/main.tsx",
        html: "./src/admin/index.html",
      },
      remotes: {
        crm: {
          manifest: "https://assets.example.com/crm/manifest.json",
          activeWhen: ["/crm/*"],
        },
      },
    });

    expect(resolved.apps).toEqual({
      default: {
        entry: "./src/admin/main.tsx",
        html: "./src/admin/index.html",
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

  it("resolves MPA page string shorthand as component modules", () => {
    const resolved = resolveConfig({
      pages: {
        home: "./src/Home.tsx",
        campaign: "./src/Campaign.tsx",
      },
    });

    expect(resolved.pages).toEqual({
      home: {
        entry: undefined,
        path: undefined,
        component: "./src/Home.tsx",
        app: undefined,
        html: "./index.html",
        mount: undefined,
      },
      campaign: {
        entry: undefined,
        path: undefined,
        component: "./src/Campaign.tsx",
        app: undefined,
        html: "./index.html",
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
        path: undefined,
        component: undefined,
        app: undefined,
        html: "./app.html",
        mount: undefined,
      },
      campaign: {
        entry: "./src/campaign/main.tsx",
        path: undefined,
        component: undefined,
        app: undefined,
        html: "./campaign.html",
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
        mount: "#root",
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
