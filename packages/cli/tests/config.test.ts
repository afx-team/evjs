import { describe, expect, it } from "vitest";
import type { EvConfig } from "../src/config.js";
import { CONFIG_DEFAULTS, defineConfig } from "../src/config.js";

describe("defineConfig", () => {
  it("returns the config object unchanged", () => {
    const config: EvConfig = {
      server: { endpoint: "/rpc" },
      client: { entry: "./src/app.tsx" },
    };
    expect(defineConfig(config)).toBe(config);
  });

  it("handles empty config", () => {
    const config: EvConfig = {};
    expect(defineConfig(config)).toEqual({});
  });

  it("handles full config", () => {
    const config: EvConfig = {
      server: {
        runner: "./custom-runner.ts",
        endpoint: "/api/v2",
        middleware: ['import "dotenv/config";'],
        dev: { port: 4000 },
      },
      client: {
        entry: "./src/main.tsx",
        html: "./public/index.html",
        dev: {
          port: 5000,
          https: true,
          open: false,
          historyApiFallback: true,
        },
        transport: {
          baseUrl: "https://api.example.com",
          endpoint: "/api/v2",
        },
      },
    };
    expect(defineConfig(config)).toBe(config);
  });

  it("handles server-only (FaaS) config", () => {
    const config: EvConfig = {
      mode: "serverOnly",
      server: {
        endpoint: "/api/fn",
        entry: "src/**/*.server.ts",
      },
    };
    expect(defineConfig(config)).toBe(config);
  });

  it("handles server mode with array entry patterns", () => {
    const config: EvConfig = {
      mode: "serverOnly",
      server: {
        entry: ["src/api/**/*.server.ts", "src/rpc/**/*.server.ts"],
        middleware: ['import "dotenv/config";'],
      },
    };
    expect(defineConfig(config)).toBe(config);
    expect(config.mode).toBe("serverOnly");
  });
});

describe("CONFIG_DEFAULTS", () => {
  it("has expected default values", () => {
    expect(CONFIG_DEFAULTS.mode).toBe("fullstack");
    expect(CONFIG_DEFAULTS.entry).toBe("./src/main.tsx");
    expect(CONFIG_DEFAULTS.html).toBe("./index.html");
    expect(CONFIG_DEFAULTS.clientPort).toBe(3000);
    expect(CONFIG_DEFAULTS.serverPort).toBe(3001);
    expect(CONFIG_DEFAULTS.endpoint).toBe("/api/fn");
    expect(CONFIG_DEFAULTS.serverEntry).toBe("src/**/*.server.{ts,tsx,js,jsx}");
  });

  it("is readonly", () => {
    // TypeScript enforces this via `as const`, but verify no accidental mutation
    expect(Object.isFrozen(CONFIG_DEFAULTS)).toBe(false); // as const doesn't freeze at runtime
    expect(CONFIG_DEFAULTS).toEqual({
      mode: "fullstack",
      entry: "./src/main.tsx",
      html: "./index.html",
      clientPort: 3000,
      serverPort: 3001,
      endpoint: "/api/fn",
      serverEntry: "src/**/*.server.{ts,tsx,js,jsx}",
    });
  });
});
