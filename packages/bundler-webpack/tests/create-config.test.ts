import path from "node:path";
import {
  createBuildPlan,
  materializeFrameworkIR,
} from "@evjs/ev/_internal/build";
import type { AppGraph } from "@evjs/ev/_internal/manifest";
import type { ResolvedConfig } from "@evjs/ev/config";
import type { Plugin } from "@evjs/ev/plugin";
import { describe, expect, it } from "vitest";
import {
  createWebpackConfigs,
  type WebpackConfig,
} from "../src/adapter/create-config.js";

describe("createWebpackConfigs", () => {
  it("uses a generated pages app entry for framework-managed pages", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    const configs = await createWebpackConfigs(
      config,
      plan,
      graph,
      process.cwd(),
      [],
    );

    const entry = configs[0]?.entry as Record<string, { import: string }>;
    expect(entry.main?.import).toBe("./.ev/entries/main.ts");
    expect(configs[0]?.output?.publicPath).toBe("auto");
    expect(configs[0]?.output?.crossOriginLoading).toBe("anonymous");
    expect(configs[0]?.resolve?.alias).toMatchObject({
      "@": path.resolve(process.cwd(), "src"),
    });
    const definePlugin = configs[0]?.plugins?.find(
      (plugin) =>
        plugin &&
        typeof plugin === "object" &&
        plugin.constructor.name === "DefinePlugin",
    ) as { definitions?: Record<string, string> } | undefined;
    expect(definePlugin?.definitions).toMatchObject({
      "process.env.EVJS_FUNCTION_ENDPOINT": JSON.stringify("__evjs/fn"),
      __EVJS_FUNCTION_ENDPOINT__: JSON.stringify("__evjs/fn"),
    });
  });

  it("resolves generated alias contributions directly to generated files", async () => {
    const plugin: Plugin<WebpackConfig> = {
      name: "generated-alias",
      contributions(ctx) {
        const configModule = ctx.emit.data({
          id: "config",
          scope: { kind: "app" },
          value: { enabled: true },
        });
        ctx.slot("resolve.alias").add({
          id: "config-alias",
          specifier: "@generated/config",
          replacement: configModule,
        });
      },
    };
    const config: ResolvedConfig<WebpackConfig> = {
      ...createResolvedConfig(),
      plugins: [plugin],
    };
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    const configs = await createWebpackConfigs(
      config,
      plan,
      graph,
      process.cwd(),
      [],
    );

    const module = plan.generated?.modules.find((item) => item.id === "config");
    const clientConfig = configs.find((item) => item.name === "client");
    const alias = clientConfig?.resolve?.alias as Record<string, string>;

    expect(plan.generated?.slots).toContainEqual(
      expect.objectContaining({
        slot: "resolve.alias",
        specifier: "@generated/config",
        replacement: module?.file,
      }),
    );
    expect(plan.resolve?.alias?.["@generated/config"]).toBe(module?.file);
    expect(alias["@generated/config"]).toBe(
      path.resolve(process.cwd(), module?.file ?? ""),
    );
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
    const plan = await createGeneratedPlan(config, graph, "production");

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

  it("filters resolve.external contributions by webpack target runtime", async () => {
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
    const plan = await createGeneratedPlan(config, graph, "development");
    plan.resolve = {
      ...plan.resolve,
      external: {
        "client-only-lib": {
          source: "ClientOnlyLib",
          runtime: "client",
        },
        "server-only-lib": {
          source: "commonjs server-only-lib",
          runtime: "server",
        },
        "shared-lib": {
          source: "SharedLib",
          runtime: "all",
        },
      },
    };

    const configs = await createWebpackConfigs(
      config,
      plan,
      graph,
      process.cwd(),
      [],
    );

    const clientConfig = configs.find((item) => item.name === "client");
    const serverConfig = configs.find((item) => item.name === "server");
    const serverExternalsText = JSON.stringify(serverConfig?.externals);

    expect(clientConfig?.externals).toEqual({
      "client-only-lib": "ClientOnlyLib",
      "shared-lib": "SharedLib",
    });
    expect(serverConfig?.externals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          "server-only-lib": "commonjs server-only-lib",
          "shared-lib": "SharedLib",
        }),
      ]),
    );
    expect(serverExternalsText).not.toContain("ClientOnlyLib");
  });

  it("uses a generated server entry for framework-managed server routes", async () => {
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
    const plan = await createGeneratedPlan(config, graph, "development");

    const configs = await createWebpackConfigs(
      config,
      plan,
      graph,
      process.cwd(),
      [],
    );

    const serverConfig = configs.find((item) => item.name === "server");
    const entry = serverConfig?.entry as Record<string, { import: string }>;
    expect(entry.server?.import).toBe("./.ev/entries/server.ts");
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
    const plan = await createGeneratedPlan(config, graph, "development");

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
    const serializedEntries = JSON.stringify(configs[0]?.entry);

    expect(serializedEntries).toContain("./.ev/entries/index.ts");
    expect(serializedEntries).not.toContain("createReactPageModule");
    expect(serializedEntries).not.toContain(
      "@evjs/ev/_internal/client/react-page",
    );
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
    const plan = await createGeneratedPlan(config, graph, "development");

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
          errorModule: "./src/pages/error.tsx",
          notFoundModule: "./src/pages/not-found.tsx",
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
        fn: "__evjs/fn",
        ppr: "__evjs/ppr",
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

async function createGeneratedPlan(
  config: ResolvedConfig<WebpackConfig>,
  graph: AppGraph,
  mode: "development" | "production",
) {
  return materializeFrameworkIR({
    cwd: process.cwd(),
    mode,
    command: mode === "development" ? "dev" : "build",
    config,
    graph,
    plugins: config.plugins,
    pluginContext: {
      cwd: process.cwd(),
      mode,
      command: mode === "development" ? "dev" : "build",
      config,
      logger: {} as never,
      addWatchFile() {},
    },
    plan: createBuildPlan(config, graph, { mode }),
    write: false,
  });
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
