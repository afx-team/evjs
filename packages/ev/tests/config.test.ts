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
});

describe("resolveConfig", () => {
  it("applies all defaults when called with no arguments", () => {
    const resolved = resolveConfig();
    expect(resolved.entry).toBe(CONFIG_DEFAULTS.entry);
    expect(resolved.html).toBe(CONFIG_DEFAULTS.html);
    expect(resolved.dev.port).toBe(CONFIG_DEFAULTS.port);
    expect(resolved.dev.https).toBe(false);
    expect(resolved.serverEnabled).toBe(true);
    expect(resolved.server.functions.clientProxy).toBe(
      "@evjs/client/transport",
    );
    expect(resolved.server.functions.serverRegister).toBe(
      "@evjs/server/register",
    );
    expect(resolved.server.endpoint).toBe("/api/fn");
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
    // Server config should still exist with defaults (for safety)
    expect(resolved.server.functions).toBeDefined();
  });

  it("respects server overrides", () => {
    const resolved = resolveConfig({
      server: {
        entry: "./server.ts",
        endpoint: "/api/rpc",
        functions: {
          clientProxy: "custom/client",
          serverRegister: "custom/server",
        },
        dev: { port: 4000 },
      },
    });
    expect(resolved.serverEnabled).toBe(true);
    expect(resolved.server.entry).toBe("./server.ts");
    expect(resolved.server.endpoint).toBe("/api/rpc");
    expect(resolved.server.functions.clientProxy).toBe("custom/client");
    expect(resolved.server.dev.port).toBe(4000);
  });

  it("proxies the configured server function endpoint in dev", () => {
    const resolved = resolveConfig({
      server: {
        endpoint: "/api/rpc",
        dev: { port: 4001 },
      },
    });

    expect(resolved.dev.proxy).toContainEqual({
      context: ["/api/rpc"],
      target: "http://localhost:4001",
      changeOrigin: true,
      secure: false,
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
});
