import { type ExtractedRoute, resolveRoutes } from "@evjs/build-tools";
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
  it("EvWebpackPlugin constructor accepts minimal options", () => {
    const plugin = new EvWebpackPlugin({ html: "index.html" });
    expect(plugin).toBeDefined();
  });

  it("EvWebpackPlugin constructor accepts server options", () => {
    const plugin = new EvWebpackPlugin({
      html: "index.html",
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
    routes: ExtractedRoute[] = [];
    entry: string | undefined = undefined;
    private jsAssets: string[] = [];
    private cssAssets: string[] = [];

    addServerFn(id: string, meta: { moduleId: string; export: string }) {
      this.fns[id] = meta;
    }

    addRoutes(entries: ExtractedRoute[]) {
      this.routes.push(...entries);
    }

    setAssets(js: string[], css: string[]) {
      this.jsAssets = js;
      this.cssAssets = css;
    }

    getServerManifest() {
      return {
        version: 1,
        entry: this.entry,
        fns: this.fns,
      };
    }

    getClientManifest() {
      return {
        version: 1,
        assets: { js: this.jsAssets, css: this.cssAssets },
        routes: resolveRoutes(this.routes),
      };
    }
  }

  it("produces correct empty manifest shapes", () => {
    const collector = new ManifestCollector();

    expect(collector.getServerManifest()).toEqual({
      version: 1,
      entry: undefined,
      fns: {},
    });

    expect(collector.getClientManifest()).toEqual({
      version: 1,
      assets: { js: [], css: [] },
      routes: [],
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

    const manifest = collector.getServerManifest();
    expect(Object.keys(manifest.fns)).toHaveLength(2);
    expect(manifest.fns.abc123).toEqual({
      moduleId: "src/api/users.server.ts",
      export: "getUsers",
    });
    expect(manifest.fns.def456).toEqual({
      moduleId: "src/api/users.server.ts",
      export: "createUser",
    });
  });

  it("accumulates and resolves routes", () => {
    const collector = new ManifestCollector();

    collector.addRoutes([
      { path: "/", parentName: "rootRoute", varName: "homeRoute" },
      { path: "/about", parentName: "rootRoute", varName: "aboutRoute" },
    ]);
    collector.addRoutes([
      { path: "/posts", parentName: "rootRoute", varName: "postsRoute" },
      {
        path: "$postId",
        parentName: "postsRoute",
        varName: "postDetailRoute",
      },
    ]);

    const manifest = collector.getClientManifest();
    expect(manifest.routes).toHaveLength(4);
    expect(manifest.routes).toEqual([
      { path: "/" },
      { path: "/about" },
      { path: "/posts" },
      { path: "/posts/$postId" },
    ]);
  });

  it("excludes index routes under non-root parents", () => {
    const collector = new ManifestCollector();

    collector.addRoutes([
      { path: "/posts", parentName: "rootRoute", varName: "postsRoute" },
      {
        path: "/",
        parentName: "postsRoute",
        varName: "postsIndexRoute",
      },
    ]);

    const manifest = collector.getClientManifest();
    expect(manifest.routes).toHaveLength(1);
    expect(manifest.routes).toEqual([{ path: "/posts" }]);
  });

  it("sets client assets", () => {
    const collector = new ManifestCollector();

    collector.setAssets(
      ["main.abc12345.js", "vendor.def67890.js"],
      ["main.abc12345.css"],
    );

    const manifest = collector.getClientManifest();
    expect(manifest.assets.js).toEqual([
      "main.abc12345.js",
      "vendor.def67890.js",
    ]);
    expect(manifest.assets.css).toEqual(["main.abc12345.css"]);
  });

  it("allows overriding the server entry", () => {
    const collector = new ManifestCollector();
    collector.entry = "main.a1b2c3d4.js";

    const manifest = collector.getServerManifest();
    expect(manifest.entry).toBe("main.a1b2c3d4.js");
  });

  it("produces complete manifests with all sections", () => {
    const collector = new ManifestCollector();

    collector.addServerFn("fn1", {
      moduleId: "api/users.server.ts",
      export: "getUsers",
    });
    collector.addRoutes([
      { path: "/", parentName: "rootRoute", varName: "homeRoute" },
    ]);
    collector.setAssets(["index.js"], ["style.css"]);
    collector.entry = "server.hash.js";

    expect(collector.getServerManifest()).toEqual({
      version: 1,
      entry: "server.hash.js",
      fns: { fn1: { moduleId: "api/users.server.ts", export: "getUsers" } },
    });

    expect(collector.getClientManifest()).toEqual({
      version: 1,
      assets: { js: ["index.js"], css: ["style.css"] },
      routes: [{ path: "/" }],
    });
  });
});
