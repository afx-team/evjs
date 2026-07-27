import path from "node:path";
import {
  createBuildPlan,
  materializeFrameworkIR,
} from "@evjs/ev/_internal/build";
import type { ResolvedConfig } from "@evjs/ev/config";
import type { Plugin } from "@evjs/ev/plugin";
import type {
  CoreGraph,
  CoreRoutePattern,
  RenderMode,
} from "@evjs/shared/manifest";
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

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

    const entry = configs[0]?.entry as Record<string, { import: string }>;
    expect(entry.main?.import).toBe("./.ev/entries/main.ts");
    expect(configs[0]?.output?.publicPath).toBe("auto");
    expect(configs[0]?.output?.crossOriginLoading).toBe("anonymous");
    expect(configs[0]?.infrastructureLogging).toEqual({ level: "warn" });
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

  it("forwards bundlerConfig watch files to the framework collector", async () => {
    const config = createResolvedConfig();
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");
    const watchedFiles: string[] = [];

    await createWebpackConfigs(
      config,
      plan,
      process.cwd(),
      [
        {
          bundlerConfig(_configs, ctx) {
            ctx.addWatchFile("./webpack-plugin.config.ts");
          },
        },
      ],
      {
        addWatchFile(file) {
          watchedFiles.push(file);
        },
      },
    );

    expect(watchedFiles).toEqual(["./webpack-plugin.config.ts"]);
  });

  it("resolves generated alias contributions directly to generated files", async () => {
    const plugin: Plugin<WebpackConfig> = {
      name: "generated-alias",
      contributions(ctx) {
        const configModule = ctx.emit.data({
          id: "config",
          scope: { kind: "application" },
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

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

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

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

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
    const graph = createGraph(config, {
      pages: [
        {
          id: "dashboard",
          path: "/dashboard",
          module: "./src/pages/dashboard.tsx",
          render: "ssr",
        },
      ],
    });
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

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

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
              id: "src/apis/health/api.ts:/health:GET",
              module: "src/apis/health/api.ts",
              path: "/health",
              methods: ["GET"],
            },
          ],
        },
      },
    };
    const graph = createGraph(config);
    const plan = await createGeneratedPlan(config, graph, "development");

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

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
            module: "./src/pages/page.tsx",
          },
          {
            id: "about",
            path: "/about",
            module: "./src/pages/about/page.tsx",
          },
        ],
      },
    };
    const graph = createGraph(config, {
      pages: [
        {
          id: "index",
          path: "/",
          module: "./src/pages/page.tsx",
          render: "csr",
        },
        {
          id: "about",
          path: "/about",
          module: "./src/pages/about/page.tsx",
          render: "csr",
        },
      ],
    });
    const plan = await createGeneratedPlan(config, graph, "development");

    expect(
      plan.entries
        .filter((entry) => entry.environment === "client")
        .map((entry) => entry.metadata?.type),
    ).toEqual(["react-component-page", "react-component-page"]);
    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);
    const serializedEntries = JSON.stringify(configs[0]?.entry);

    expect(serializedEntries).toContain("./.ev/entries/page-client-index.ts");
    expect(serializedEntries).not.toContain("createReactPageModule");
    expect(serializedEntries).not.toContain(
      "@evjs/ev/_internal/client/react-page",
    );
  });

  it("keeps React and ReactDOM external in regular Node server bundles", async () => {
    const config: ResolvedConfig<WebpackConfig> = {
      ...createResolvedConfig(),
    };
    const graph = createGraph(config, {
      pages: [
        {
          id: "dashboard",
          path: "/dashboard",
          module: "./src/pages/dashboard.tsx",
          render: "ssr",
        },
      ],
    });
    const plan = await createGeneratedPlan(config, graph, "development");

    const configs = await createWebpackConfigs(config, plan, process.cwd(), []);

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
    conventions: true,
    routing: {
      mode: "spa",
      dir: "./src/pages",
      html: "./index.html",
      mount: "#app",
      rootModule: "./src/pages/layout.tsx",
      routes: [
        {
          id: "index",
          path: "/",
          module: "./src/pages/page.tsx",
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
    extensions: {},
    plugins: [],
  };
}

async function createGeneratedPlan(
  config: ResolvedConfig<WebpackConfig>,
  graph: CoreGraph,
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

interface TestPage {
  id: string;
  path: string;
  module: string;
  render?: RenderMode;
}

function createGraph(
  config: ResolvedConfig<WebpackConfig>,
  options: { pages?: TestPage[] } = {},
): CoreGraph {
  const documentTemplate = config.routing?.html ?? "./index.html";
  const routingMode = config.routing?.mode ?? "spa";
  const pages =
    options.pages ??
    (config.routing?.routes ?? []).flatMap<TestPage>((route) =>
      route.kind === "layout"
        ? []
        : [
            {
              id: route.id,
              path: route.path,
              module: route.module,
              render: "csr",
            },
          ],
    );
  const pageIds = pages.map((page) => page.id);
  const routeIds = pages.map((page) => `route:${page.id}`);
  const documentIds = routingMode === "spa" ? ["index"] : pageIds;
  const provenance = {
    producer: {
      kind: "provider" as const,
      id: "@evjs/provider/page-anchor",
    },
  };

  return {
    rootDir: process.cwd(),
    applications: {
      default: {
        id: "default",
        root: config.routing?.dir ?? "./src/pages",
        routingMode,
        pageIds,
        routeIds,
        documentIds,
        extensions: {},
        provenance,
      },
    },
    pages: Object.fromEntries(
      pages.map((page) => [
        page.id,
        {
          id: page.id,
          applicationId: "default",
          source: {
            module: page.module,
            scope: {
              kind: "directory" as const,
              root: path.posix.dirname(page.module),
            },
            provider: "@evjs/provider/page-anchor",
          },
          render: page.render ?? "csr",
          hydrate: "load" as const,
          extensions: {},
          provenance,
        },
      ]),
    ),
    routes: pages.map((page) => ({
      id: `route:${page.id}`,
      applicationId: "default",
      pattern: toRoutePattern(page.path),
      target: { kind: "page" as const, pageId: page.id },
      facets: { wrappers: [] },
      extensions: {},
      provenance,
    })),
    documents: Object.fromEntries(
      routingMode === "spa"
        ? [
            [
              "index",
              {
                id: "index",
                template: documentTemplate,
                output: "index.html",
                applicationId: "default",
                owner: { kind: "application" as const },
                mount: config.routing?.mount ?? "#app",
                bootstrap: { kind: "application" as const },
                extensions: {},
                provenance,
              },
            ],
          ]
        : pages.map((page) => [
            page.id,
            {
              id: page.id,
              template: documentTemplate,
              output:
                page.path === "/" ? "index.html" : `${page.id}/index.html`,
              applicationId: "default",
              owner: { kind: "page" as const, pageId: page.id },
              mount: config.routing?.mount ?? "#app",
              bootstrap: { kind: "page" as const, pageId: page.id },
              extensions: {},
              provenance,
            },
          ]),
    ),
    extensions: { namespaces: {} },
    serverFunctions: [],
    serverRoutes: config.server.routing?.routes ?? [],
  };
}

function toRoutePattern(pathname: string): CoreRoutePattern {
  return {
    segments: pathname
      .split("/")
      .filter(Boolean)
      .map((segment) =>
        segment.startsWith(":")
          ? { kind: "param" as const, name: segment.slice(1) }
          : { kind: "static" as const, value: segment },
      ),
  };
}
