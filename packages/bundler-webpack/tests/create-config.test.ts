import { createRequire } from "node:module";
import type { AppGraph, ResolvedConfig } from "@evjs/ev";
import { createBuildPlan } from "@evjs/ev/build-tools";
import { describe, expect, it } from "vitest";
import {
  createWebpackConfigs,
  type WebpackConfig,
} from "../src/adapter/create-config.js";

const require = createRequire(import.meta.url);
const pagesEntryLoader = require("../src/adapter/pages-entry-loader.cjs");

describe("createWebpackConfigs", () => {
  it("installs the pages entry loader for framework-managed pages", async () => {
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

    const entry = configs[0]?.entry as Record<string, { import: string }>;
    expect(entry.main?.import).toContain("pages-entry-anchor.js");
    const rules = configs[0]?.module?.rules ?? [];
    const pagesEntryRule = rules.find((rule) =>
      JSON.stringify(rule).includes("pages-entry-loader.cjs"),
    ) as { test: RegExp } | undefined;
    expect(pagesEntryRule?.test.test("/project/src/pages/index.tsx")).toBe(
      false,
    );
    expect(rules).toContainEqual(
      expect.objectContaining({
        test: expect.any(RegExp),
        resourceQuery: /^$/,
        use: [
          {
            loader: expect.stringContaining("pages-entry-loader.cjs"),
            options: {
              type: "pages-app",
              mount: "#app",
              rootModule: "./src/layout/index.tsx",
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

  it("uses component page bootstrap instead of the SPA router loader for MPA page routes", async () => {
    const config: ResolvedConfig<WebpackConfig> = {
      ...createResolvedConfig(),
      routing: {
        mode: "mpa",
        dir: "./src/pages",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/index.tsx",
          },
          {
            id: "about",
            path: "/about",
            module: "./src/pages/about.tsx",
          },
        ],
      },
    };
    const graph: AppGraph = {
      version: 1,
      rootDir: process.cwd(),
      apps: {},
      pages: {
        index: {
          id: "index",
          path: "/",
          component: "./src/pages/index.tsx",
          html: "./index.html",
          render: "csr",
          mount: "#app",
        },
        about: {
          id: "about",
          path: "/about",
          component: "./src/pages/about.tsx",
          html: "./index.html",
          render: "csr",
          mount: "#app",
        },
      },
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
      remotes: {},
    };
    const plan = createBuildPlan(config, graph, { mode: "development" });

    expect(plan.entries.map((entry) => entry.metadata?.type)).toEqual([
      "react-component-page",
      "react-component-page",
    ]);
    const configs = await createWebpackConfigs(
      config,
      plan,
      graph,
      process.cwd(),
      [],
    );
    const serializedRules = JSON.stringify(configs[0]?.module?.rules);
    const serializedEntries = JSON.stringify(configs[0]?.entry);
    const decodedEntries = decodeURIComponent(serializedEntries);

    expect(serializedRules).not.toContain("pages-entry-loader.cjs");
    expect(serializedEntries).toContain("createReactPageModule");
    expect(decodedEntries).toContain("@evjs/client/internal/react-page");
    expect(decodedEntries).not.toContain('from "@evjs/client/internal";');
  });

  it("generates pages app imports without module queries", () => {
    const source = pagesEntryLoader.call({
      cacheable() {},
      getOptions() {
        return {
          mount: "#app",
          rootModule: "./src/layout/index.tsx",
          routes: [
            {
              id: "index",
              path: "/",
              module: "./src/pages/index.tsx",
            },
          ],
        };
      },
      resourcePath:
        "/workspace/node_modules/@evjs/bundler-webpack/esm/adapter/pages-entry-anchor.js",
      rootContext: "/workspace",
    });

    expect(source).toContain("@evjs/client/internal");
    expect(source).toContain("createPagesApp");
    expect(source).toContain("src/layout/index.tsx");
    expect(source).toContain("src/pages/index.tsx");
    expect(source).not.toContain("evjs-page-route");
  });

  it("keeps React and ReactDOM external in regular Node server bundles", async () => {
    const config: ResolvedConfig<WebpackConfig> = {
      ...createResolvedConfig(),
      serverEnabled: true,
    };
    const graph: AppGraph = {
      ...createGraph(config),
      pages: {
        dashboard: {
          id: "dashboard",
          path: "/dashboard",
          component: "./src/pages/dashboard.tsx",
          html: "./index.html",
          render: "ssr",
          mount: "#app",
        },
      },
      routes: [
        {
          id: "dashboard",
          path: "/dashboard",
          pageId: "dashboard",
          render: "ssr",
        },
      ],
    };
    const plan = createBuildPlan(config, graph, { mode: "development" });

    const configs = await createWebpackConfigs(
      config,
      plan,
      graph,
      process.cwd(),
      [],
    );

    expect(configs.find((item) => item.name === "server")?.externals).toEqual(
      expect.objectContaining({
        react: "commonjs react",
        "react-dom": "commonjs react-dom",
        "react-dom/client": "commonjs react-dom/client",
        "react-dom/server": "commonjs react-dom/server",
        "react-dom/server.node": "commonjs react-dom/server.node",
      }),
    );
  });
});

function createResolvedConfig(): ResolvedConfig<WebpackConfig> {
  return {
    entry: "./src/pages/index.tsx",
    html: "./index.html",
    routing: {
      mode: "spa",
      dir: "./src/pages",
      entry: "./src/pages/index.tsx",
      html: "./index.html",
      mount: "#app",
      rootModule: "./src/layout/index.tsx",
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
        ppr: "/__evjs/ppr",
      },
      functionRuntime: {
        endpoint: "/__evjs/fn",
        clientProxy: "@evjs/client/internal",
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
    routes:
      config.routing?.routes.map((route) => ({
        ...route,
        appId: "default",
      })) ?? [],
    serverFunctions: [],
    serverRoutes: [],
    remotes: {},
  };
}
