import type { AppGraph, ResolvedConfig } from "@evjs/ev";
import { createBuildPlan } from "@evjs/ev/build-tools";
import { describe, expect, it } from "vitest";
import {
  createWebpackConfigs,
  type WebpackConfig,
} from "../src/adapter/create-config.js";

describe("createWebpackConfigs", () => {
  it("installs the file-route entry loader for framework-managed file routes", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = createBuildPlan(config, graph, { mode: "development" });

    const configs = await createWebpackConfigs(
      config,
      plan,
      graph,
      process.cwd(),
      [],
    );

    const rules = configs[0]?.module?.rules ?? [];
    expect(rules).toContainEqual(
      expect.objectContaining({
        test: expect.any(RegExp),
        resourceQuery: /^$/,
        use: [
          {
            loader: expect.stringContaining("file-route-entry-loader.cjs"),
            options: {
              type: "file-route-app",
              mount: "#app",
              rootModule: "./src/pages/__root.tsx",
              routes: [
                {
                  id: "index",
                  path: "/",
                  module: "./src/pages/index.tsx",
                },
              ],
            },
          },
        ],
      }),
    );
  });
});

function createResolvedConfig(): ResolvedConfig<WebpackConfig> {
  return {
    entry: "./src/pages/index.tsx",
    html: "./index.html",
    fileRoutes: {
      mode: "spa",
      dir: "./src/pages",
      entry: "./src/pages/index.tsx",
      html: "./index.html",
      mount: "#app",
      rootModule: "./src/pages/__root.tsx",
      routes: [
        {
          id: "index",
          path: "/",
          module: "./src/pages/index.tsx",
        },
      ],
    },
    dev: {
      port: 3000,
      https: false,
      proxy: [],
    },
    serverEnabled: false,
    server: {
      basePath: "/__evjs",
      runtime: {
        basePath: "/__evjs",
        fn: "/__evjs/fn",
      },
      functionRuntime: {
        endpoint: "/__evjs/fn",
        clientProxy: "@evjs/client",
        serverRegister: "@evjs/server/register",
      },
      dev: {
        port: 3001,
        https: false,
      },
    },
    transport: {},
    remotes: {},
    plugins: [],
  };
}

function createGraph(config: ResolvedConfig<WebpackConfig>): AppGraph {
  return {
    version: 1,
    rootDir: process.cwd(),
    apps: {
      default: {
        id: "default",
        entry: config.entry,
        html: config.html,
      },
    },
    pages: {},
    routes: [],
    serverFunctions: [],
    serverRoutes: [],
    remotes: {},
  };
}
