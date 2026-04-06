import type { EvConfig } from "@evjs/ev";
import { CONFIG_DEFAULTS, defineConfig } from "@evjs/ev";
import { describe, expect, it } from "vitest";

describe("defineConfig", () => {
  it("returns the config object unchanged", () => {
    const config: EvConfig = {
      server: { endpoint: "/rpc" },
      entry: "./src/app.tsx",
    };
    expect(defineConfig(config)).toBe(config);
  });

  it("handles empty config", () => {
    const config: EvConfig = {};
    expect(defineConfig(config)).toEqual({});
  });

  it("handles full config", () => {
    const config: EvConfig = {
      entry: "./src/main.tsx",
      html: "./public/index.html",
      dev: {
        port: 5000,
        https: true,
      },
      server: {
        runtime: "./custom-runtime.ts",
        endpoint: "/api/v2",
        dev: { port: 4000 },
      },
    };
    expect(defineConfig(config)).toBe(config);
  });
});

describe("CONFIG_DEFAULTS", () => {
  it("has expected default values", () => {
    expect(CONFIG_DEFAULTS.entry).toBe("./src/main.tsx");
    expect(CONFIG_DEFAULTS.html).toBe("./index.html");
    expect(CONFIG_DEFAULTS.port).toBe(3000);
    expect(CONFIG_DEFAULTS.serverPort).toBe(3001);
    expect(CONFIG_DEFAULTS.endpoint).toBe("/api/fn");
  });

  it("is readonly", () => {
    // TypeScript enforces this via `as const`, but verify no accidental mutation
    expect(Object.isFrozen(CONFIG_DEFAULTS)).toBe(false); // as const doesn't freeze at runtime
    expect(CONFIG_DEFAULTS).toEqual({
      entry: "./src/main.tsx",
      html: "./index.html",
      port: 3000,
      serverPort: 3001,
      endpoint: "/api/fn",
    });
  });
});
