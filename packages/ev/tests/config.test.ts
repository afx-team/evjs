import { describe, expect, it } from "vitest";
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
    expect(resolved.assetPrefix).toBe(CONFIG_DEFAULTS.assetPrefix);
    expect(resolved.entry).toBe(CONFIG_DEFAULTS.entry);
    expect(resolved.html).toBe(CONFIG_DEFAULTS.html);
    expect(resolved.dev.port).toBe(CONFIG_DEFAULTS.port);
    expect(resolved.dev.https).toBe(false);
    expect(resolved.serverEnabled).toBe(true);
    expect(resolved.server.runtime).toBe("node");
    expect(resolved.server.endpoint).toBe(CONFIG_DEFAULTS.endpoint);
    expect(resolved.server.dev.port).toBe(CONFIG_DEFAULTS.serverPort);
    expect(resolved.server.dev.https).toBe(false);
    expect(resolved.bundler.name).toBe("utoopack");
    expect(resolved.plugins).toEqual([]);
  });

  it("applies all defaults when called with empty config", () => {
    const resolved = resolveConfig({});
    expect(resolved.assetPrefix).toBe("/");
    expect(resolved.entry).toBe("./src/main.tsx");
    expect(resolved.html).toBe("./index.html");
    expect(resolved.server.endpoint).toBe("/api/fn");
  });

  it("respects user overrides for top-level fields", () => {
    const resolved = resolveConfig({
      entry: "./src/custom.tsx",
      html: "./public/index.html",
    });
    expect(resolved.entry).toBe("./src/custom.tsx");
    expect(resolved.html).toBe("./public/index.html");
  });

  it("normalizes assetPrefix by adding a trailing slash if missing", () => {
    const resolved = resolveConfig({
      assetPrefix: "https://cdn.example.com/assets",
    });
    expect(resolved.assetPrefix).toBe("https://cdn.example.com/assets/");

    const resolvedWithSlash = resolveConfig({
      assetPrefix: "https://cdn.example.com/assets/",
    });
    expect(resolvedWithSlash.assetPrefix).toBe(
      "https://cdn.example.com/assets/",
    );
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
    expect(resolved.server.runtime).toBe("node");
    expect(resolved.server.endpoint).toBe(CONFIG_DEFAULTS.endpoint);
  });

  it("respects server overrides", () => {
    const resolved = resolveConfig({
      server: {
        entry: "./server.ts",
        runtime: "bun",
        endpoint: "/rpc",
        dev: { port: 4000 },
      },
    });
    expect(resolved.serverEnabled).toBe(true);
    expect(resolved.server.entry).toBe("./server.ts");
    expect(resolved.server.runtime).toBe("bun");
    expect(resolved.server.endpoint).toBe("/rpc");
    expect(resolved.server.dev.port).toBe(4000);
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

  it("respects bundler name override", () => {
    const resolved = resolveConfig({
      bundler: { name: "utoopack" },
    });
    expect(resolved.bundler.name).toBe("utoopack");
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
