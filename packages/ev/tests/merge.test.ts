import { describe, expect, it } from "vitest";
import type { Config } from "../src/config/index.js";
import { merge } from "../src/config/merge.js";

describe("merge", () => {
  it("merges nested config sections", () => {
    const config: Config = {
      server: {
        basePath: "/api",
        dev: { port: 3001 },
      },
    };

    merge(config, {
      server: {
        dev: { https: false },
      },
    });

    expect(config).toEqual({
      server: {
        basePath: "/api",
        dev: { port: 3001, https: false },
      },
    });
  });

  it("replaces arrays instead of merging them by index", () => {
    const config: Config = {
      dev: {
        proxy: [{ context: ["/api"], target: "http://localhost:3001" }],
      },
    };

    merge(config, {
      dev: {
        proxy: [{ context: ["/rpc"], target: "http://localhost:4001" }],
      },
    });

    expect(config.dev?.proxy).toEqual([
      { context: ["/rpc"], target: "http://localhost:4001" },
    ]);
  });

  it("returns the target object", () => {
    const config: Config = {};

    const result = merge(config, {
      html: "./index.html",
    });

    expect(result).toBe(config);
    expect(config.html).toBe("./index.html");
  });

  it("type-checks Config patches", () => {
    const config: Config = {};

    merge(config, {
      server: {
        basePath: "/api",
      },
    });

    merge(config, {
      dev: {
        https: { key: "key.pem", cert: "cert.pem" },
      },
    });

    merge(config, {
      pages: {
        home: "./src/Home.tsx",
        about: { entry: "./src/about/main.tsx" },
      },
    });

    merge(config, {
      // @ts-expect-error unknown framework config property
      unknown: true,
    });

    merge(config, {
      dev: {
        // @ts-expect-error dev.port must be a number
        port: "3000",
      },
    });
  });
});
