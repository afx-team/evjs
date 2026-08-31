import { describe, expect, it } from "vitest";
import type { Config } from "../src/config/index.js";
import { merge } from "../src/config/merge.js";

describe("merge", () => {
  it("merges nested config sections", () => {
    const config: Config = {
      server: {
        basepath: "/api",
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
        basepath: "/api",
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
      routing: { mode: "spa" },
    });

    expect(result).toBe(config);
    expect(config.routing).toEqual({ mode: "spa" });
  });

  it.each([
    "__proto__",
    "constructor",
    "prototype",
  ])('rejects unsafe nested patch field "%s" without polluting prototypes', (key) => {
    const objectPrototype = Object.prototype as Record<string, unknown>;
    const patch = JSON.parse(
      `{"safe":{"${key}":{"pollutedByMerge":true}}}`,
    ) as object;

    try {
      expect(() =>
        merge({ safe: {} }, patch as { safe?: Record<string, unknown> }),
      ).toThrow(`patch field "${key}" is not safe`);
      expect(objectPrototype.pollutedByMerge).toBeUndefined();
      expect(({} as Record<string, unknown>).pollutedByMerge).toBeUndefined();
    } finally {
      Reflect.deleteProperty(objectPrototype, "pollutedByMerge");
    }
  });

  it("only reads own data properties while merging", () => {
    const inherited = { server: { basepath: "/inherited" } };
    const inheritedTarget = Object.create(inherited) as {
      server: { basepath?: string; dev?: { port: number } };
    };

    merge(inheritedTarget, {
      server: { dev: { port: 3001 } },
    });

    expect(inherited.server).toEqual({ basepath: "/inherited" });
    expect(Object.hasOwn(inheritedTarget, "server")).toBe(true);
    expect(inheritedTarget.server).toEqual({ dev: { port: 3001 } });

    let targetGetterWasCalled = false;
    const accessorTarget = {} as {
      routing: { mode: "spa" | "mpa" };
    };
    Object.defineProperty(accessorTarget, "routing", {
      configurable: true,
      enumerable: true,
      get() {
        targetGetterWasCalled = true;
        return { mode: "mpa" };
      },
    });

    merge(accessorTarget, { routing: { mode: "spa" } });

    expect(targetGetterWasCalled).toBe(false);
    expect(accessorTarget.routing).toEqual({ mode: "spa" });
  });

  it("rejects accessor patch fields without invoking them", () => {
    let patchGetterWasCalled = false;
    const patch = {};
    Object.defineProperty(patch, "routing", {
      enumerable: true,
      get() {
        patchGetterWasCalled = true;
        return { mode: "spa" };
      },
    });

    expect(() => merge({}, patch)).toThrow(
      "must be an enumerable own data property",
    );
    expect(patchGetterWasCalled).toBe(false);
  });

  it("type-checks Config patches", () => {
    const config: Config = {};

    merge(config, {
      server: {
        basepath: "/api",
      },
    });

    merge(config, {
      dev: {
        https: { key: "key.pem", cert: "cert.pem" },
      },
    });

    const applicationConfig: Config = {};
    merge(applicationConfig, {
      application: {
        routes: [
          { path: "/", component: "@/pages/home/page" },
          { path: "/about", component: "@/pages/about/page" },
        ],
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
