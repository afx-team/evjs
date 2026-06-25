import { createRequire } from "node:module";
import path from "node:path";
import type { AppGraph, BuildPlan } from "@evjs/ev";
import { createBuildPlan } from "@evjs/ev/build-tools";
import { describe, expect, it } from "vitest";
import { createUtoopackConfig } from "../src/adapter/create-config.js";

const require = createRequire(import.meta.url);
const componentPageLoader = require("../src/adapter/component-page-loader.cjs");
const pagesEntryLoader = require("../src/adapter/pages-entry-loader.cjs");
const serverRoutesEntryLoader = require("../src/adapter/server-routes-entry-loader.cjs");

describe("createUtoopackConfig", () => {
  function createResolvedConfig(
    overrides: Partial<Parameters<typeof createUtoopackConfig>[0]> = {},
  ): Parameters<typeof createUtoopackConfig>[0] {
    return {
      entry: "./src/main.tsx",
      html: "./index.html",
      output: {
        client: "dist/client",
        server: "dist/server",
        crossOriginLoading: "anonymous",
      },
      dev: {
        port: 41234,
        https: true,
        proxy: [],
      },
      server: {
        basePath: "/__evjs",
        runtime: {
          basePath: "/__evjs",
          fn: "/__evjs/fn",
          ppr: "/__evjs/ppr",
        },
        dev: {
          port: 3001,
          https: false,
        },
      },
      transport: {},
      plugins: [],
      ...overrides,
    };
  }

  it("passes resolved dev server options and SPA fallback to Utoopack", async () => {
    const config = createResolvedConfig();
    const plan = createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.entry).toEqual([
      { import: "./src/main.tsx", name: "main" },
    ]);
    expect(utoopackConfig.output?.publicPath).toBe("auto");
    expect(utoopackConfig.output?.crossOriginLoading).toBe("anonymous");
    expect(utoopackConfig.devServer?.port).toBe(41234);
    expect(utoopackConfig.devServer?.https).toBe(true);
    expect(utoopackConfig.devServer?.proxy).toContainEqual(
      expect.objectContaining({
        context: [
          "^/(?!api(?:/|$))(?!__evjs(?:/|$))(?!__evjs/fn(?:/|$))(?!__evjs/ppr(?:/|$))(?!turbopack-hmr$)(?!.*\\.[^/]+$).+",
        ],
        target: "https://localhost:41234",
      }),
    );
  });

  it("uses configured client and server output directories", async () => {
    const config = createResolvedConfig({
      output: {
        client: "custom-dist/client",
        server: "custom-dist/server",
        crossOriginLoading: "anonymous",
      },
      server: {
        basePath: "/__evjs",
        runtime: {
          basePath: "/__evjs",
          fn: "/__evjs/fn",
          ppr: "/__evjs/ppr",
        },
        dev: {
          port: 3001,
          https: false,
        },
      },
    });
    const cwd = process.cwd();
    const plan = createPlan(config);

    const utoopackConfig = await createUtoopackConfig(config, plan, cwd, []);

    expect(utoopackConfig.output?.path).toBe(
      path.resolve(cwd, "custom-dist/client"),
    );
    expect(utoopackConfig.server?.output?.path).toBe(
      path.resolve(cwd, "custom-dist/server"),
    );
  });

  it("uses the build plan mode instead of NODE_ENV", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const config = createResolvedConfig();
      const plan = createPlan(config, { mode: "production" });

      const utoopackConfig = await createUtoopackConfig(
        config,
        plan,
        process.cwd(),
        [],
      );

      expect(utoopackConfig.mode).toBe("production");
      expect(utoopackConfig.output?.filename).toBe("[name].[contenthash:8].js");
      expect(utoopackConfig.sourceMaps).toBe(false);
      expect(utoopackConfig.define?.["process.env.NODE_ENV"]).toBe(
        '"production"',
      );
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("content-hashes client CSS output filenames in production", async () => {
    const config = createResolvedConfig();
    const plan = createPlan(config, { mode: "production" });

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.output?.cssFilename).toBe(
      "[name].[contenthash:8].css",
    );
    expect(utoopackConfig.output?.cssChunkFilename).toBe(
      "[name].[contenthash:8].css",
    );
  });

  it("uses stable client CSS output filenames in development", async () => {
    const config = createResolvedConfig();
    const plan = createPlan(config, { mode: "development" });

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.output?.cssFilename).toBe("[name].css");
    expect(utoopackConfig.output?.cssChunkFilename).toBe("[name].css");
  });

  it("sets crossorigin for dynamically loaded browser chunks", async () => {
    const config = createResolvedConfig({
      output: {
        client: "dist/client",
        server: "dist/server",
        crossOriginLoading: "use-credentials",
      },
    });
    const plan = createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.output?.crossOriginLoading).toBe("use-credentials");
  });

  it("keeps SPA history fallback away from custom framework runtime paths", async () => {
    const config = createResolvedConfig({
      server: {
        basePath: "/rpc",
        runtime: {
          basePath: "/rpc",
          fn: "/rpc/fn",
          ppr: "/rpc/ppr",
          rsc: "/rpc/rsc",
        },
        rsc: { endpoint: "/rpc/rsc" },
        dev: {
          port: 3001,
          https: false,
        },
      },
    });
    const plan = createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );
    const fallbackRule = utoopackConfig.devServer?.proxy?.find((rule) =>
      getProxyRuleContexts(rule).some((context) =>
        context.includes("turbopack-hmr"),
      ),
    );
    const fallbackContexts = fallbackRule
      ? getProxyRuleContexts(fallbackRule)
      : [];
    const fallbackPattern = new RegExp(fallbackContexts[0] ?? "");

    expect(fallbackContexts).toEqual([
      "^/(?!api(?:/|$))(?!rpc(?:/|$))(?!rpc/fn(?:/|$))(?!rpc/ppr(?:/|$))(?!rpc/rsc(?:/|$))(?!turbopack-hmr$)(?!.*\\.[^/]+$).+",
    ]);
    expect(fallbackPattern.test("/dashboard")).toBe(true);
    expect(fallbackPattern.test("/users/123")).toBe(true);
    expect(fallbackPattern.test("/api/users")).toBe(false);
    expect(fallbackPattern.test("/rpc/fn")).toBe(false);
    expect(fallbackPattern.test("/rpc/ppr/campaign/offer")).toBe(false);
    expect(fallbackPattern.test("/rpc/rsc?page=dashboard")).toBe(false);
    expect(fallbackPattern.test("/main.js")).toBe(false);
    expect(fallbackPattern.test("/turbopack-hmr")).toBe(false);
  });

  it("proxies server file routes and keeps them out of SPA fallback", async () => {
    const config = createResolvedConfig({
      server: {
        basePath: "/__evjs",
        runtime: {
          basePath: "/__evjs",
          fn: "/__evjs/fn",
          ppr: "/__evjs/ppr",
        },
        dev: {
          port: 3001,
          https: false,
        },
        routing: {
          dir: "./src/apis",
          routes: [
            {
              id: "src/apis/health.ts:/health:GET",
              module: "src/apis/health.ts",
              path: "/health",
              methods: ["GET"],
            },
            {
              id: "src/apis/users/$userId.ts:/users/:userId:GET",
              module: "src/apis/users/$userId.ts",
              path: "/users/:userId",
              methods: ["GET"],
            },
            {
              id: "src/apis/index.ts:/:GET",
              module: "src/apis/index.ts",
              path: "/",
              methods: ["GET"],
            },
          ],
        },
      },
    });
    const plan = createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );
    const serverRouteRule = utoopackConfig.devServer?.proxy?.find((rule) =>
      getProxyRuleContexts(rule).includes("/health"),
    );
    const fallbackRule = utoopackConfig.devServer?.proxy?.find((rule) =>
      getProxyRuleContexts(rule).some((context) =>
        context.includes("turbopack-hmr"),
      ),
    );
    const fallbackPattern = new RegExp(
      getProxyRuleContexts(fallbackRule as { context: string | string[] })[0] ??
        "",
    );

    expect(
      getProxyRuleContexts(serverRouteRule as { context: string | string[] }),
    ).toEqual(["/health", "/users", "^/$"]);
    expect(serverRouteRule).toMatchObject({
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
    expect(fallbackPattern.test("/dashboard")).toBe(true);
    expect(fallbackPattern.test("/health")).toBe(false);
    expect(fallbackPattern.test("/users/123")).toBe(false);
  });

  it("installs the pages entry loader for framework-managed pages", async () => {
    const config = createResolvedConfig({
      entry: "./src/pages/index.tsx",
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
    });
    const plan = createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.entry).toEqual([
      {
        import: expect.stringContaining("pages-entry-anchor.js"),
        name: "main",
      },
    ]);
    const pagesEntryRules = utoopackConfig.module?.rules?.["**/*"] as
      | { condition: { path: RegExp } }[]
      | undefined;
    const pagesEntryRule = pagesEntryRules?.[0];
    expect(
      pagesEntryRule?.condition.path.test("/project/src/pages/index.tsx"),
    ).toBe(false);
    expect(
      pagesEntryRule?.condition.path.test(
        "packages/bundler-utoopack/esm/adapter/pages-entry-anchor.js",
      ),
    ).toBe(true);
    expect(
      pagesEntryRule?.condition.path.test(
        "/workspace/node_modules/@evjs/bundler-utoopack/esm/adapter/pages-entry-anchor.js",
      ),
    ).toBe(true);
    expect(utoopackConfig.module?.rules).toMatchObject({
      "**/*": [
        {
          condition: {
            path: expect.any(RegExp),
            query: "",
          },
          loaders: [
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
        },
      ],
    });
  });

  it("installs the server routes entry loader for framework-managed server routes", async () => {
    const config = createResolvedConfig({
      server: {
        basePath: "/__evjs",
        runtime: {
          basePath: "/__evjs",
          fn: "/__evjs/fn",
          ppr: "/__evjs/ppr",
        },
        dev: {
          port: 3001,
          https: false,
        },
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
    });
    const plan = createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.server?.entry).toEqual(
      expect.stringContaining("server-routes-entry-anchor.js"),
    );
    expect(utoopackConfig.module?.rules).toMatchObject({
      "**/*": expect.arrayContaining([
        expect.objectContaining({
          condition: {
            path: expect.any(RegExp),
            query: "",
          },
          loaders: [
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
      ]),
    });
  });

  it("generates server routes entries from method and middleware exports", () => {
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
        "/workspace/node_modules/@evjs/bundler-utoopack/esm/adapter/server-routes-entry-anchor.js",
      rootContext: "/workspace",
    });

    expect(source).toContain('@evjs/ev/internal/server"');
    expect(source).toContain("@evjs/ev/internal/server/react");
    expect(source).toContain('createRoute("/health", routeDefinition0)');
    expect(source).toContain('createRoute("/secure", routeDefinition1)');
    expect(source).toContain("import middleware0 from");
    expect(source).toContain("src/middleware.ts");
    expect(source).toContain("import middleware1 from");
    expect(source).toContain("src/apis/middleware.ts");
    expect(source).toContain(
      'import "../../../../../src/api/actions.server.ts";',
    );
    expect(source.match(/actions\.server\.ts/g)).toHaveLength(1);
    expect(source).toContain("routeDefinition0.GET = routeModule0.GET");
    expect(source).not.toContain("routeDefinition0.middlewares");
    expect(source).toContain("routeDefinition1.middlewares = [middleware1]");
    expect(source).toContain("routeDefinition1.POST = routeModule1.POST");
    expect(source).toContain("const middlewares = [middleware0]");
    expect(source).toContain("createApp({ middlewares, routes");
  });

  it("does not add SPA history fallback for MPA builds", async () => {
    const config = createResolvedConfig({
      pages: {
        home: { entry: "./src/home.tsx", html: "./home.html" },
        about: {
          entry: "./src/about.tsx",
          html: "./about.html",
        },
      },
    });
    const plan = createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.entry).toEqual([
      { import: "./src/home.tsx", name: "home" },
      { import: "./src/about.tsx", name: "about" },
    ]);
    expect(utoopackConfig.devServer?.proxy).toEqual([]);
  });

  it("installs component page loaders for framework-managed page entries", async () => {
    const config = createResolvedConfig({
      pages: {
        home: {
          component: "./src/pages/Home.tsx",
          html: "./index.html",
          mount: "#app",
        },
      },
    });
    const plan = createPlan(config);

    expect(plan.entries[0]?.import).toBe("./src/pages/Home.tsx");
    expect(plan.entries[0]?.metadata).toMatchObject({
      type: "react-component-page",
      component: "./src/pages/Home.tsx",
    });
    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.module?.rules).toMatchObject({
      "**/*": [
        {
          condition: {
            path: expect.any(RegExp),
            query: "",
          },
          loaders: [
            {
              loader: expect.stringContaining("component-page-loader.cjs"),
              options: {
                type: "react-component-page",
                mount: "#app",
                hydrate: "load",
                render: "csr",
              },
            },
          ],
          type: "ecmascript",
        },
      ],
    });
  });

  it("uses component page loaders instead of the SPA router loader for MPA page routes", async () => {
    const config = createResolvedConfig({
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
    });
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
    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );
    const serializedRules = JSON.stringify(utoopackConfig.module?.rules);

    expect(serializedRules).toContain("component-page-loader.cjs");
    expect(serializedRules).not.toContain("pages-entry-loader.cjs");
  });

  it("generates router-free component page entry imports", () => {
    const source = componentPageLoader.call({
      cacheable() {},
      getOptions() {
        return {
          hydrate: "load",
          mount: "#app",
          render: "csr",
          route: { id: "about", path: "/about" },
        };
      },
      resourcePath: "/workspace/src/pages/about.tsx",
    });

    expect(source).toContain("@evjs/ev/internal/client/react-page");
    expect(source).not.toContain('from "@evjs/ev/internal/client";');
    expect(source).toContain("createGeneratedReactPageEntry");
    expect(source).toContain("import.meta.url");
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
        "/workspace/node_modules/@evjs/bundler-utoopack/esm/adapter/pages-entry-anchor.js",
      rootContext: "/workspace",
    });

    expect(source).toContain("@evjs/ev/internal/client");
    expect(source).toContain("createPagesApp");
    expect(source).toContain("src/layout/index.tsx");
    expect(source).toContain("src/pages/index.tsx");
    expect(source).not.toContain("evjs-page-route");
  });

  it("awaits async bundlerConfig hooks before returning config", async () => {
    const config = createResolvedConfig();
    const plan = createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [
        {
          async bundlerConfig(cfg, ctx) {
            await Promise.resolve();
            cfg.output ??= {};
            cfg.output.publicPath = "runtime";
            expect(ctx.bundlerName).toBe("utoopack");
            expect(ctx.environment).toBe("mixed");
          },
        },
      ],
    );

    expect(utoopackConfig.output?.publicPath).toBe("runtime");
  });

  it("fails clearly when the plan contains framework server renderer entries", async () => {
    const config = createResolvedConfig({
      server: {
        basePath: "/__evjs",
        runtime: {
          basePath: "/__evjs",
          fn: "/__evjs/fn",
          ppr: "/__evjs/ppr",
        },
        dev: {
          port: 3001,
          https: false,
        },
      },
    });
    const graph: AppGraph = {
      version: 1,
      rootDir: process.cwd(),
      apps: {
        default: {
          id: "default",
          entry: "./src/main.tsx",
          html: "./index.html",
        },
      },
      pages: {
        dashboard: {
          id: "dashboard",
          routeId: "dashboard",
          component: "./src/pages/Dashboard.tsx",
          html: "./index.html",
          render: "ssr",
        },
      },
      routes: [
        {
          id: "dashboard",
          path: "/dashboard",
          appId: "default",
          pageId: "dashboard",
          module: "./src/pages/Dashboard.tsx",
          render: "ssr",
        },
      ],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan = createBuildPlan(config, graph, { mode: "development" });

    expect(plan.entries.map((entry) => entry.name)).toEqual([
      "main",
      "dashboard-server",
      "server",
    ]);
    expect(plan.server).toMatchObject({
      entry: "@evjs/ev/internal/server/fetch",
      renderers: [
        {
          name: "dashboard-server",
          import: "./src/pages/Dashboard.tsx",
          kind: "page-server",
          owner: { pageId: "dashboard", routeId: "dashboard" },
        },
      ],
    });
    const message = await expectRejectedMessage(() =>
      createUtoopackConfig(config, plan, process.cwd(), []),
    );

    expect(message).toContain(
      "Utoopack adapter cannot build framework server page entries yet",
    );
    expect(message).toContain(
      'dashboard-server (page-server, page "dashboard", route "dashboard")',
    );
    expect(message).toContain("Unsupported entry kinds: page-server");
  });

  it("fails clearly for framework server page entries until Utoopack supports them", async () => {
    const config = createResolvedConfig({
      server: {
        basePath: "/__evjs",
        runtime: {
          basePath: "/__evjs",
          fn: "/__evjs/fn",
          ppr: "/__evjs/ppr",
        },
        dev: {
          port: 3001,
          https: false,
        },
      },
    });
    const plan = createPlan(config);
    plan.entries.push({
      name: "dashboard-server",
      import: "./src/pages/Dashboard.tsx",
      environment: "server",
      runtime: "node",
      kind: "page-server",
      owner: { pageId: "dashboard" },
    });
    plan.entries.push({
      name: "insights-rsc",
      import: "./src/pages/Insights.tsx",
      environment: "server",
      runtime: "node",
      kind: "rsc-page",
      owner: { pageId: "insights" },
    });
    plan.entries.push({
      name: "campaign-ppr-shell",
      import: "./src/pages/Campaign.tsx",
      environment: "server",
      runtime: "node",
      kind: "ppr-shell",
      owner: { pageId: "campaign" },
    });
    plan.entries.push({
      name: "campaign-offer-ppr-region",
      import: "./src/pages/CampaignOffer.tsx",
      environment: "server",
      runtime: "node",
      kind: "ppr-region",
      owner: { pageId: "campaign", regionId: "offer" },
    });

    const message = await expectRejectedMessage(() =>
      createUtoopackConfig(config, plan, process.cwd(), []),
    );

    expect(message).toContain(
      'dashboard-server (page-server, page "dashboard")',
    );
    expect(message).toContain('insights-rsc (rsc-page, page "insights")');
    expect(message).toContain(
      'campaign-ppr-shell (ppr-shell, page "campaign")',
    );
    expect(message).toContain(
      'campaign-offer-ppr-region (ppr-region, page "campaign", region "offer")',
    );
    expect(message).toContain(
      "Unsupported entry kinds: page-server, rsc-page, ppr-shell, ppr-region",
    );
    expect(message).toContain("SSR/PPR/RSC validation");
  });
});

function createPlan(
  config: Parameters<typeof createUtoopackConfig>[0],
  options: { distDir?: string; mode?: "development" | "production" } = {},
): BuildPlan {
  const graph: AppGraph = {
    version: 1,
    rootDir: process.cwd(),
    apps:
      config.pages && Object.keys(config.pages).length > 0
        ? {}
        : {
            default: {
              id: "default",
              entry: config.entry,
              html: config.html,
            },
          },
    pages: Object.fromEntries(
      Object.entries(config.pages ?? {}).map(([id, page]) => [
        id,
        {
          id,
          entry: page.entry,
          component: page.component,
          app: page.app,
          html: page.html,
          render: "csr",
          mount: page.mount,
        },
      ]),
    ),
    routes:
      config.routing?.routes.map((route) => ({
        ...route,
        appId: "default",
      })) ?? [],
    serverFunctions: [],
    serverRoutes: config.server.routing?.routes ?? [],
  };

  return createBuildPlan(config, graph, {
    mode: options.mode ?? "development",
    distDir: options.distDir,
  });
}

function getProxyRuleContexts(rule: { context: string | string[] }): string[] {
  return Array.isArray(rule.context) ? rule.context : [rule.context];
}

async function expectRejectedMessage(action: () => Promise<unknown>) {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  return (thrown as Error).message;
}
