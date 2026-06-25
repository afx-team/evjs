import { createRequire } from "node:module";
import type { AppGraph, ResolvedConfig } from "@evjs/ev";
import { createBuildPlan } from "@evjs/ev/build-tools";
import { describe, expect, it } from "vitest";
import {
  createWebpackConfigs,
  type WebpackConfig,
} from "../src/adapter/create-config.js";

const require = createRequire(import.meta.url);
const frameworkEntryLoader = require("../src/adapter/framework-entry-loader.cjs");
const pagesEntryLoader = require("../src/adapter/pages-entry-loader.cjs");
const serverRoutesEntryLoader = require("../src/adapter/server-routes-entry-loader.cjs");

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
    expect(configs[0]?.output?.publicPath).toBe("auto");
    expect(configs[0]?.output?.crossOriginLoading).toBe("anonymous");
  });

  it("sets crossorigin for dynamically loaded browser chunks", async () => {
    const config: ResolvedConfig<WebpackConfig> = {
      ...createResolvedConfig(),
      output: {
        client: "dist/client",
        server: "dist/server",
        crossOriginLoading: "use-credentials",
      },
    };
    const graph = createGraph(config);
    const plan = createBuildPlan(config, graph, { mode: "production" });

    const configs = await createWebpackConfigs(
      config,
      plan,
      graph,
      process.cwd(),
      [],
    );

    const clientConfig = configs.find((item) => item.name === "client");
    const miniCssPlugin = clientConfig?.plugins?.find(
      (plugin) =>
        plugin &&
        typeof plugin === "object" &&
        plugin.constructor.name === "MiniCssExtractPlugin",
    ) as { options?: { attributes?: Record<string, string> } } | undefined;

    expect(clientConfig?.output?.crossOriginLoading).toBe("use-credentials");
    expect(miniCssPlugin?.options?.attributes).toEqual({
      crossorigin: "use-credentials",
    });
  });

  it("installs the server routes entry loader for framework-managed server routes", async () => {
    const base = createResolvedConfig();
    const config: ResolvedConfig<WebpackConfig> = {
      ...base,
      server: {
        ...base.server,
        routing: {
          dir: "./src/apis",
          routes: [
            {
              id: "src/apis/health.ts:/health:GET",
              module: "src/apis/health.ts",
              path: "/health",
              methods: ["GET"],
            },
          ],
        },
      },
    };
    const graph = createGraph(config);
    const plan = createBuildPlan(config, graph, { mode: "development" });

    const configs = await createWebpackConfigs(
      config,
      plan,
      graph,
      process.cwd(),
      [],
    );

    const serverConfig = configs.find((item) => item.name === "server");
    const entry = serverConfig?.entry as Record<string, { import: string }>;
    expect(entry.server?.import).toContain("server-routes-entry-anchor.js");
    expect(serverConfig?.module?.rules).toContainEqual(
      expect.objectContaining({
        test: expect.any(RegExp),
        resourceQuery: /^$/,
        use: [
          {
            loader: expect.stringContaining("server-routes-entry-loader.cjs"),
            options: {
              type: "server-app",
              routes: [
                {
                  id: "src/apis/health.ts:/health:GET",
                  module: "src/apis/health.ts",
                  path: "/health",
                  methods: ["GET"],
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
    };
    const plan = createBuildPlan(config, graph, { mode: "development" });

    expect(
      plan.entries
        .filter((entry) => entry.environment === "client")
        .map((entry) => entry.metadata?.type),
    ).toEqual(["react-component-page", "react-component-page"]);
    const configs = await createWebpackConfigs(
      config,
      plan,
      graph,
      process.cwd(),
      [],
    );
    const serializedRules = JSON.stringify(configs[0]?.module?.rules);
    const serializedEntries = JSON.stringify(configs[0]?.entry);

    expect(serializedRules).not.toContain("pages-entry-loader.cjs");
    expect(serializedRules).toContain("framework-entry-loader.cjs");
    expect(serializedEntries).toContain("framework-entry-anchor.js");
    expect(serializedEntries).not.toContain("createReactPageModule");
    expect(serializedEntries).not.toContain("@evjs/client/internal/react-page");
  });

  it("generates thin component page entries in the framework entry loader", () => {
    const source = frameworkEntryLoader.call({
      cacheable() {},
      getOptions() {
        return {
          type: "react-component-page",
          module: "/workspace/src/pages/about.tsx",
          hydrate: "load",
          mount: "#app",
          render: "csr",
          route: { id: "about", path: "/about" },
        };
      },
    });

    expect(source).toContain("@evjs/client/internal/react-page");
    expect(source).toContain("createGeneratedReactPageEntry");
    expect(source).toContain("import.meta.url");
    expect(source).not.toContain("createReactPageModule");
    expect(source).not.toContain("currentScriptHref");
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

  it("generates server routes entries from method exports", () => {
    const source = serverRoutesEntryLoader.call({
      cacheable() {},
      getOptions() {
        return {
          routes: [
            {
              path: "/health",
              module: "src/apis/health.ts",
              methods: ["GET"],
            },
            {
              path: "/secure",
              module: "src/apis/secure.ts",
              methods: ["POST"],
              middlewares: [
                {
                  module: "src/apis/middleware.ts",
                },
              ],
            },
          ],
          middlewares: [
            {
              module: "src/middleware.ts",
            },
          ],
          serverFunctions: [
            {
              id: "save",
              module: "src/api/actions.server.ts",
              exportName: "saveOrder",
            },
            {
              id: "load",
              module: "src/api/actions.server.ts",
              exportName: "loadOrders",
            },
          ],
        };
      },
      resourcePath:
        "/workspace/node_modules/@evjs/bundler-webpack/esm/adapter/server-routes-entry-anchor.js",
      rootContext: "/workspace",
    });

    expect(source).toContain('@evjs/server"');
    expect(source).toContain("@evjs/server/react");
    expect(source).toContain('createRoute("/health", routeDefinition0)');
    expect(source).toContain('createRoute("/secure", routeDefinition1)');
    expect(source).toContain("import middleware0 from");
    expect(source).toContain("src/middleware.ts");
    expect(source).toContain("import middleware1 from");
    expect(source).toContain("src/apis/middleware.ts");
    expect(source).toContain(
      'import "file:///workspace/src/api/actions.server.ts";',
    );
    expect(source.match(/actions\.server\.ts/g)).toHaveLength(1);
    expect(source).toContain("routeDefinition0.GET = routeModule0.GET");
    expect(source).not.toContain("routeDefinition0.middlewares");
    expect(source).toContain("routeDefinition1.middlewares = [middleware1]");
    expect(source).toContain("routeDefinition1.POST = routeModule1.POST");
    expect(source).toContain("const middlewares = [middleware0]");
    expect(source).toContain("createApp({ middlewares, routes");
  });

  it("keeps React and ReactDOM external in regular Node server bundles", async () => {
    const config: ResolvedConfig<WebpackConfig> = {
      ...createResolvedConfig(),
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

    const serverConfig = configs.find((item) => item.name === "server");
    expect(serverConfig?.externals).toEqual(
      expect.objectContaining({
        react: "commonjs react",
        "react-dom": "commonjs react-dom",
        "react-dom/client": "commonjs react-dom/client",
        "react-dom/server": "commonjs react-dom/server",
        "react-dom/server.node": "commonjs react-dom/server.node",
      }),
    );
    expect(serverConfig?.output).toEqual(
      expect.objectContaining({
        filename: "[name].cjs",
        chunkFilename: "[name].cjs",
        publicPath: "/",
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
    output: {
      client: "dist/client",
      server: "dist/server",
      crossOriginLoading: "anonymous",
    },
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
    serverRoutes: config.server.routing?.routes ?? [],
  };
}
