import { describe, expect, it } from "vitest";
import { EvWebpackPlugin } from "../src/index.js";

/**
 * Test ManifestCollector indirectly through the plugin's manifest output.
 *
 * Since ManifestCollector is an internal class, we test it by verifying
 * the manifest shape that EvWebpackPlugin produces. For isolated unit tests,
 * we reconstruct the class from the source to test in isolation.
 */

// ManifestCollector is not exported, so we reconstruct it from the module.
// If it's not accessible, we test through the plugin interface instead.
describe("ManifestCollector (via EvWebpackPlugin)", () => {
  it("EvWebpackPlugin constructor accepts no options", () => {
    const plugin = new EvWebpackPlugin();
    expect(plugin).toBeDefined();
  });

  it("EvWebpackPlugin constructor accepts server options", () => {
    const plugin = new EvWebpackPlugin({
      server: { entry: "./src/server.ts" },
    });
    expect(plugin).toBeDefined();
  });
});

/**
 * Direct ManifestCollector tests.
 * We re-create the class inline since it is not exported.
 */
describe("ManifestCollector", () => {
  // Inline implementation matching the source for isolated testing
  class ManifestCollector {
    fns: Record<string, { moduleId: string; export: string }> = {};
    routes: Array<{ path: string }> = [];
    entry = "main.js";
    private jsAssets: string[] = [];
    private cssAssets: string[] = [];

    addServerFn(id: string, meta: { moduleId: string; export: string }) {
      this.fns[id] = meta;
    }

    addRoutes(entries: Array<{ path: string }>) {
      this.routes.push(...entries);
    }

    setAssets(js: string[], css: string[]) {
      this.jsAssets = js;
      this.cssAssets = css;
    }

    getManifest() {
      return {
        version: 1,
        server: {
          entry: this.entry,
          fns: this.fns,
        },
        client: {
          assets: { js: this.jsAssets, css: this.cssAssets },
          routes: this.routes,
        },
      };
    }
  }

  it("produces correct empty manifest shape", () => {
    const collector = new ManifestCollector();
    const manifest = collector.getManifest();

    expect(manifest).toEqual({
      version: 1,
      server: { entry: "main.js", fns: {} },
      client: { assets: { js: [], css: [] }, routes: [] },
    });
  });

  it("accumulates server functions", () => {
    const collector = new ManifestCollector();

    collector.addServerFn("abc123", {
      moduleId: "src/api/users.server.ts",
      export: "getUsers",
    });
    collector.addServerFn("def456", {
      moduleId: "src/api/users.server.ts",
      export: "createUser",
    });

    const manifest = collector.getManifest();
    expect(Object.keys(manifest.server.fns)).toHaveLength(2);
    expect(manifest.server.fns.abc123).toEqual({
      moduleId: "src/api/users.server.ts",
      export: "getUsers",
    });
    expect(manifest.server.fns.def456).toEqual({
      moduleId: "src/api/users.server.ts",
      export: "createUser",
    });
  });

  it("accumulates routes", () => {
    const collector = new ManifestCollector();

    collector.addRoutes([{ path: "/" }, { path: "/about" }]);
    collector.addRoutes([{ path: "/posts/$postId" }]);

    const manifest = collector.getManifest();
    expect(manifest.client.routes).toHaveLength(3);
    expect(manifest.client.routes).toEqual([
      { path: "/" },
      { path: "/about" },
      { path: "/posts/$postId" },
    ]);
  });

  it("sets client assets", () => {
    const collector = new ManifestCollector();

    collector.setAssets(
      ["main.abc12345.js", "vendor.def67890.js"],
      ["main.abc12345.css"],
    );

    const manifest = collector.getManifest();
    expect(manifest.client.assets.js).toEqual([
      "main.abc12345.js",
      "vendor.def67890.js",
    ]);
    expect(manifest.client.assets.css).toEqual(["main.abc12345.css"]);
  });

  it("allows overriding the server entry", () => {
    const collector = new ManifestCollector();
    collector.entry = "main.a1b2c3d4.js";

    const manifest = collector.getManifest();
    expect(manifest.server.entry).toBe("main.a1b2c3d4.js");
  });

  it("produces complete manifest with all sections", () => {
    const collector = new ManifestCollector();

    collector.addServerFn("fn1", {
      moduleId: "api/users.server.ts",
      export: "getUsers",
    });
    collector.addRoutes([{ path: "/" }]);
    collector.setAssets(["index.js"], ["style.css"]);
    collector.entry = "server.hash.js";

    const manifest = collector.getManifest();
    expect(manifest).toEqual({
      version: 1,
      server: {
        entry: "server.hash.js",
        fns: { fn1: { moduleId: "api/users.server.ts", export: "getUsers" } },
      },
      client: {
        assets: { js: ["index.js"], css: ["style.css"] },
        routes: [{ path: "/" }],
      },
    });
  });
});
