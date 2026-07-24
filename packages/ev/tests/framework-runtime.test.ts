import type { BuildOutput } from "@evjs/shared/manifest";
import { describe, expect, it } from "vitest";
import { createFrameworkRuntime } from "../src/_internal/build/framework-runtime.js";

describe("createFrameworkRuntime", () => {
  it("keeps SPA Pages inside the routing union", () => {
    const runtime = createFrameworkRuntime(createOutput(true));

    expect(runtime.routing).toMatchObject({
      kind: "spa",
      pages: {
        dashboard: {
          path: "/dashboard",
          routeId: "dashboard",
          render: "ssr",
        },
      },
      routes: [
        {
          id: "dashboard",
          path: "/dashboard",
          pageId: "dashboard",
        },
      ],
    });
    expect("pages" in runtime).toBe(false);
    expect("routes" in runtime).toBe(false);
  });

  it("keeps MPA Pages inside the same routing union", () => {
    const runtime = createFrameworkRuntime(createOutput(false));

    expect(runtime.routing).toMatchObject({
      kind: "mpa",
      pages: {
        dashboard: {
          path: "/dashboard",
          routeId: "dashboard",
          render: "ssr",
        },
      },
    });
    expect("pages" in runtime).toBe(false);
    expect("routes" in runtime).toBe(false);
  });
});

function createOutput(spa: boolean): BuildOutput {
  return {
    version: 1,
    buildId: "build",
    paths: {
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    },
    publicPath: "/",
    runtime: {
      server: {
        basePath: "/__evjs",
        fn: "__evjs/fn",
      },
    },
    assets: {},
    apps: spa
      ? {
          default: {
            assets: { js: ["main.js"], css: [] },
          },
        }
      : {},
    pages: {
      dashboard: {
        assets: { js: [], css: [] },
        render: "ssr",
        rendering: {
          component: "server",
          html: "server",
          streaming: false,
          hydrate: "load",
        },
        path: "/dashboard",
        routeId: "dashboard",
      },
    },
    routes: [
      {
        id: "dashboard",
        path: "/dashboard",
        ...(spa ? { appId: "default" } : {}),
        pageId: "dashboard",
      },
    ],
    server: {
      assets: { js: [], css: [] },
      functions: {},
      routes: [],
    },
  };
}
