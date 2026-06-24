import type { Config, ServerConfig } from "@evjs/ev";
import { CONFIG_DEFAULTS, defineConfig } from "@evjs/ev";
import { describe, expect, it } from "vitest";

describe("defineConfig", () => {
  it("returns the config object unchanged", () => {
    const config: Config = {
      server: { entry: "./src/server.ts" },
      entry: "./src/app.tsx",
    };
    expect(defineConfig(config)).toBe(config);
  });

  it("handles empty config", () => {
    const config: Config = {};
    expect(defineConfig(config)).toEqual({});
  });

  it("handles full config", () => {
    const server: ServerConfig = {
      entry: "./custom-server.ts",
      basePath: "/api",
      dev: { port: 4000 },
    };
    const config: Config = {
      entry: "./src/main.tsx",
      html: "./public/index.html",
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
    expect(CONFIG_DEFAULTS.entry).toBe("./src/main.tsx");
    expect(CONFIG_DEFAULTS.html).toBe("./index.html");
    expect(CONFIG_DEFAULTS.port).toBe(3000);
    expect(CONFIG_DEFAULTS.serverPort).toBe(3001);
    expect(CONFIG_DEFAULTS.serverBasePath).toBe("/__evjs");
    expect(CONFIG_DEFAULTS.clientProxy).toBe("@evjs/client/internal");
    expect(CONFIG_DEFAULTS.serverRegister).toBe("@evjs/server/register");
    expect(CONFIG_DEFAULTS.crossOriginLoading).toBe("anonymous");
  });

  it("is readonly", () => {
    // TypeScript enforces this via `as const`, but verify no accidental mutation
    expect(Object.isFrozen(CONFIG_DEFAULTS)).toBe(false); // as const doesn't freeze at runtime
    expect(CONFIG_DEFAULTS).toEqual({
      entry: "./src/main.tsx",
      html: "./index.html",
      port: 3000,
      serverPort: 3001,
      serverBasePath: "/__evjs",
      clientProxy: "@evjs/client/internal",
      serverRegister: "@evjs/server/register",
      crossOriginLoading: "anonymous",
      routingDir: "./src/pages",
      routingMode: "spa",
      mount: "#app",
    });
  });
});
