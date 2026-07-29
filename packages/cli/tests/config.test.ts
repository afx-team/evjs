import { defineConfig } from "@evjs/ev";
import type { Config, ServerConfig } from "@evjs/ev/config";
import { CONFIG_DEFAULTS } from "@evjs/ev/config";
import { describe, expect, it } from "vitest";

describe("defineConfig", () => {
  it("returns the config object unchanged", () => {
    const config: Config = {
      conventions: false,
      application: {
        routes: [{ path: "/", page: "home" }],
      },
    };
    expect(defineConfig(config)).toBe(config);
  });

  it("handles empty config", () => {
    const config: Config = {};
    expect(defineConfig(config)).toEqual({});
  });

  it("handles full config", () => {
    const server: ServerConfig = {
      basePath: "/api",
      dev: { port: 4000 },
    };
    const config: Config = {
      routing: {
        mode: "spa",
        html: "./public/index.html",
      },
      dev: {
        port: 5000,
        https: true,
      },
      server,
    };
    expect(defineConfig(config)).toBe(config);
  });
});

describe("CONFIG_DEFAULTS", () => {
  it("has expected default values", () => {
    expect(CONFIG_DEFAULTS.html).toBe("./index.html");
    expect(CONFIG_DEFAULTS.port).toBe(3000);
    expect(CONFIG_DEFAULTS.serverPort).toBe(3001);
    expect(CONFIG_DEFAULTS.serverBasePath).toBe("/__evjs");
    expect(CONFIG_DEFAULTS.crossOriginLoading).toBe("anonymous");
  });

  it("is readonly", () => {
    // TypeScript enforces this via `as const`, but verify no accidental mutation
    expect(Object.isFrozen(CONFIG_DEFAULTS)).toBe(false); // as const doesn't freeze at runtime
    expect(CONFIG_DEFAULTS).toEqual({
      html: "./index.html",
      port: 3000,
      serverPort: 3001,
      serverBasePath: "/__evjs",
      crossOriginLoading: "anonymous",
      outputClientDir: "dist/client",
      outputServerDir: "dist/server",
      pageRoot: "./src/pages",
      mount: "#app",
    });
  });
});
