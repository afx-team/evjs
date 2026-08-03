import { createRequire } from "node:module";
import path from "node:path";
import {
  createBuildPlan,
  materializeFrameworkIR,
} from "@evjs/ev/_internal/build";
import type { Plugin } from "@evjs/ev/plugin";
import type {
  BuildPlan,
  CoreGraph,
  CoreRoutePattern,
  RenderMode,
  ServerRouteNode,
} from "@evjs/shared/manifest";
import type { ConfigComplete } from "@utoo/pack";
import { describe, expect, it } from "vitest";
import { createUtoopackConfig } from "../src/adapter/create-config.js";

const require = createRequire(import.meta.url);

describe("createUtoopackConfig", () => {
  function createResolvedConfig(
    overrides: Partial<Parameters<typeof createUtoopackConfig>[0]> = {},
  ): Parameters<typeof createUtoopackConfig>[0] {
    const config: Parameters<typeof createUtoopackConfig>[0] = {
      conventions: true,
      routing: {
        mode: "spa",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "index",
            path: "/",
            module: "./src/pages/page.tsx",
          },
        ],
      },
      output: {
        client: "dist/client",
        server: "dist/server",
        crossOriginLoading: "anonymous",
      },
      dev: {
        port: 41234,
        https: true,
        proxy: [],
        cliShortcuts: true,
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
      ...overrides,
    };
    return config;
  }

  it("passes resolved dev server options and SPA fallback to Utoopack", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.entry).toEqual([
      { import: "./.ev/entries/main.ts", name: "main" },
    ]);
    expect(utoopackConfig.output?.publicPath).toBe("auto");
    expect(utoopackConfig.output?.crossOriginLoading).toBe("anonymous");
    expect(utoopackConfig.resolve?.alias?.["@"]).toBe(
      path.resolve(process.cwd(), "src"),
    );
    expect(utoopackConfig.define).toMatchObject({
      "process.env.EVJS_FUNCTION_ENDPOINT": JSON.stringify("__evjs/fn"),
      __EVJS_FUNCTION_ENDPOINT__: JSON.stringify("__evjs/fn"),
    });
    expect(utoopackConfig.devServer?.port).toBe(41234);
    expect(utoopackConfig.devServer?.https).toBe(true);
    const runtimeRule = utoopackConfig.devServer?.proxy?.find((rule) =>
      proxyRuleMatchesPath(rule, "/__evjs/fn"),
    );
    const fallbackRule = utoopackConfig.devServer?.proxy?.find((rule) =>
      getProxyRuleContexts(rule).some((context) =>
        context.includes("turbopack-hmr"),
      ),
    );

    expect(runtimeRule).toMatchObject({
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
    expect(proxyRuleMatchesPath(runtimeRule, "/__evjs/fn/child")).toBe(false);
    expect(fallbackRule).toMatchObject({
      target: "https://localhost:41234",
      pathRewrite: { "^/.*$": "/" },
    });
    expect(proxyRuleMatchesPath(fallbackRule, "/__evjs/fn")).toBe(false);
    expect(proxyRuleMatchesPath(fallbackRule, "/__evjs/fn/child")).toBe(true);
    expect(proxyRuleMatchesPath(fallbackRule, "/__evjs/unclaimed")).toBe(true);
  });

  it("rejects custom client certificates in development", async () => {
    const config = createResolvedConfig({
      dev: {
        port: 41234,
        https: { key: "./certs/dev.key", cert: "./certs/dev.crt" },
        proxy: [],
        cliShortcuts: true,
      },
    });
    const plan = await createPlan(config);

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), []),
    ).rejects.toThrow(
      "The Utoopack dev server accepts dev.https only as a boolean",
    );
  });

  it("allows development-only certificate config for a production plan", async () => {
    const config = createResolvedConfig({
      dev: {
        port: 41234,
        https: { key: "./certs/dev.key", cert: "./certs/dev.crt" },
        proxy: [],
        cliShortcuts: true,
      },
    });
    const plan = await createPlan(config, { mode: "production" });

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), []),
    ).resolves.toMatchObject({ mode: "production" });
  });

  it("enables production optimizations for client-only builds", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, { mode: "production" });

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.optimization).toMatchObject({
      concatenateModules: true,
      removeUnusedExports: true,
      removeUnusedImports: true,
    });
  });

  it("disables module concatenation for mixed production builds", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, {
      mode: "production",
      serverRoutes: [
        {
          id: "src/apis/health/api.ts:/health:GET",
          module: "src/apis/health/api.ts",
          path: "/health",
          methods: ["GET"],
        },
      ],
    });

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.server?.entry).toBeDefined();
    expect(utoopackConfig.optimization).toMatchObject({
      concatenateModules: false,
      removeUnusedExports: true,
      removeUnusedImports: true,
    });
  });

  it("does not enable production optimizations for development", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, { mode: "development" });

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.optimization).toBeUndefined();
  });

  it("lets configureBundler hooks override production module concatenation", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, { mode: "production" });

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [
        {
          configureBundler(config) {
            config.optimization ??= {};
            config.optimization.concatenateModules = false;
          },
        },
      ],
    );

    expect(utoopackConfig.optimization?.concatenateModules).toBe(false);
  });

  it("resolves generated alias contributions directly to generated files", async () => {
    const plugin: Plugin<ConfigComplete> = {
      id: "generated-alias",
      emitIR(ctx) {
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
    const config = createResolvedConfig({
      plugins: [plugin],
    });
    const plan = await createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    const module = plan.generated?.modules.find((item) => item.id === "config");

    expect(plan.generated?.slots).toContainEqual(
      expect.objectContaining({
        slot: "resolve.alias",
        specifier: "@generated/config",
        replacement: module?.file,
      }),
    );
    expect(plan.resolve?.alias?.["@generated/config"]).toBe(module?.file);
    expect(utoopackConfig.resolve?.alias?.["@generated/config"]).toBe(
      path.resolve(process.cwd(), module?.file ?? ""),
    );
  });

  it("maps client and shared resolve.external contributions to Utoopack externals", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);
    plan.resolve = {
      ...plan.resolve,
      external: {
        react: { source: "React", runtime: "client" },
        lodash: { source: "_", runtime: "all" },
      },
    };

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.externals).toEqual({
      react: "React",
      lodash: "_",
    });
  });

  it("rejects server-only resolve.external contributions for mixed Utoopack plans", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, {
      serverRoutes: [
        {
          id: "src/apis/health/api.ts:/health:GET",
          module: "src/apis/health/api.ts",
          path: "/health",
          methods: ["GET"],
        },
      ],
    });
    plan.resolve = {
      ...plan.resolve,
      external: {
        "server-only-lib": {
          source: "server-only-lib",
          runtime: "server",
        },
      },
    };

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), []),
    ).rejects.toThrow(
      "cannot map server-only resolve.external contributions while client entries are present: server-only-lib",
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
          fn: "__evjs/fn",
          ppr: "__evjs/ppr",
        },
        dev: {
          port: 3001,
          https: false,
        },
      },
    });
    const cwd = process.cwd();
    const plan = await createPlan(config, { distDir: "custom-dist" });

    const utoopackConfig = await createUtoopackConfig(config, plan, cwd, []);

    expect(utoopackConfig.output?.path).toBe(
      path.resolve(cwd, "custom-dist/client"),
    );
    expect(utoopackConfig.server).toBeUndefined();
  });

  it("uses active BuildPlan outputs and function endpoint when config differs", async () => {
    const config = createResolvedConfig();
    const generatedPlan = await createPlan(config, {
      serverRoutes: [
        {
          id: "src/apis/health/api.ts:/health:GET",
          module: "src/apis/health/api.ts",
          path: "/health",
          methods: ["GET"],
        },
      ],
    });
    const plan: BuildPlan = {
      ...generatedPlan,
      distDir: "plan-dist",
      output: {
        clientDir: "plan-dist/browser",
        serverDir: "plan-dist/runtime",
      },
      runtime: {
        ...generatedPlan.runtime,
        server: {
          ...generatedPlan.runtime.server,
          fn: "plan-runtime/fn",
        },
      },
    };

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.output?.path).toBe(
      path.resolve(process.cwd(), "plan-dist/browser"),
    );
    expect(utoopackConfig.server?.output?.path).toBe(
      path.resolve(process.cwd(), "plan-dist/runtime"),
    );
    expect(utoopackConfig.define).toMatchObject({
      "process.env.EVJS_FUNCTION_ENDPOINT": JSON.stringify("plan-runtime/fn"),
      __EVJS_FUNCTION_ENDPOINT__: JSON.stringify("plan-runtime/fn"),
    });
  });

  it("uses the build plan mode instead of NODE_ENV", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const config = createResolvedConfig();
      const plan = await createPlan(config, { mode: "production" });

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
    const plan = await createPlan(config, { mode: "production" });

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
    const plan = await createPlan(config, { mode: "development" });

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.output?.cssFilename).toBe("[name].css");
    expect(utoopackConfig.output?.cssChunkFilename).toBe("[name].css");
  });

  it("uses framework-owned Less tooling paths", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.styles?.less).toEqual({
      loader: require.resolve("less-loader"),
      implementation: require.resolve("less"),
    });
  });

  it("sets crossorigin for dynamically loaded browser chunks", async () => {
    const config = createResolvedConfig({
      output: {
        client: "dist/client",
        server: "dist/server",
        crossOriginLoading: "use-credentials",
      },
    });
    const plan = await createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.output?.crossOriginLoading).toBe("use-credentials");
  });

  it("keeps SPA history fallback away from BuildPlan runtime paths", async () => {
    const config = createResolvedConfig({
      server: {
        basePath: "/rpc",
        runtime: {
          basePath: "/rpc",
          fn: "rpc/fn",
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
    const plan = await createPlan(config);
    const activeRuntimePlan: BuildPlan = {
      ...plan,
      runtime: {
        ...plan.runtime,
        server: {
          ...plan.runtime.server,
          ppr: "rpc/ppr",
          rsc: "rpc/rsc",
        },
      },
      dev: {
        ...plan.dev,
        hasPpr: true,
      },
    };

    const utoopackConfig = await createUtoopackConfig(
      config,
      activeRuntimePlan,
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
    const runtimeRule = utoopackConfig.devServer?.proxy?.find((rule) =>
      proxyRuleMatchesPath(rule, "/rpc/fn"),
    );

    expect(runtimeRule && getProxyRuleContexts(runtimeRule)).toHaveLength(3);
    expect(proxyRuleMatchesPath(runtimeRule, "/rpc")).toBe(false);
    expect(proxyRuleMatchesPath(runtimeRule, "/rpc/fn")).toBe(true);
    expect(proxyRuleMatchesPath(runtimeRule, "/%72%70%63/%66%6E")).toBe(true);
    expect(proxyRuleMatchesPath(runtimeRule, "/rpc/fn/child")).toBe(false);
    expect(proxyRuleMatchesPath(runtimeRule, "/rpc/ppr/campaign")).toBe(true);
    expect(
      proxyRuleMatchesPath(runtimeRule, "/%72%70%63/%70%70%72/campaign"),
    ).toBe(true);
    expect(proxyRuleMatchesPath(runtimeRule, "/rpc/rsc")).toBe(true);
    expect(proxyRuleMatchesPath(runtimeRule, "/%72%70%63/%72%73%63")).toBe(
      true,
    );
    expect(proxyRuleMatchesPath(runtimeRule, "/rpc/rsc/child")).toBe(false);
    expect(fallbackPattern.test("/dashboard")).toBe(true);
    expect(fallbackPattern.test("/users/123")).toBe(true);
    expect(fallbackPattern.test("/rpc")).toBe(true);
    expect(fallbackPattern.test("/rpc/fn")).toBe(false);
    expect(fallbackPattern.test("/%72%70%63/%66%6E")).toBe(false);
    expect(fallbackPattern.test("/rpc/fn/child")).toBe(true);
    expect(fallbackPattern.test("/rpc/ppr/campaign/offer")).toBe(false);
    expect(fallbackPattern.test("/%72%70%63/%70%70%72/campaign/offer")).toBe(
      false,
    );
    expect(fallbackPattern.test("/rpc/rsc")).toBe(false);
    expect(fallbackPattern.test("/%72%70%63/%72%73%63")).toBe(false);
    expect(fallbackPattern.test("/rpc/rsc/child")).toBe(true);
    expect(fallbackPattern.test("/main.js")).toBe(false);
    expect(fallbackPattern.test("/turbopack-hmr")).toBe(false);
  });

  it("allows unclaimed /api paths through SPA history fallback", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);

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
    const fallbackPattern = new RegExp(
      getProxyRuleContexts(fallbackRule as { context: string | string[] })[0] ??
        "",
    );

    expect(plan.dev.serverRequestRoutePaths).toEqual([]);
    expect(plan.dev.serverRenderedPagePaths).toEqual([]);
    expect(fallbackPattern.test("/api")).toBe(true);
    expect(fallbackPattern.test("/api/users")).toBe(true);
  });

  it("proxies server file routes and keeps them out of SPA fallback", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, {
      serverRoutes: [
        {
          id: "src/apis/health/api.ts:/health:GET",
          module: "src/apis/health/api.ts",
          path: "/health",
          methods: ["GET"],
        },
        {
          id: "src/apis/users/$userId/api.ts:/users/:userId:GET",
          module: "src/apis/users/$userId/api.ts",
          path: "/users/:userId",
          methods: ["GET"],
        },
        {
          id: "src/apis/$tenantId/api.ts:/:tenantId:GET",
          module: "src/apis/$tenantId/api.ts",
          path: "/:tenantId",
          methods: ["GET"],
        },
      ],
    });

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );
    const serverRouteRule = utoopackConfig.devServer?.proxy?.find((rule) =>
      proxyRuleMatchesPath(rule, "/health"),
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

    expect(serverRouteRule).toMatchObject({
      target: "http://localhost:3001",
      changeOrigin: true,
      secure: false,
    });
    expect(proxyRuleMatchesPath(serverRouteRule, "/health")).toBe(true);
    expect(proxyRuleMatchesPath(serverRouteRule, "/health/details")).toBe(
      false,
    );
    expect(proxyRuleMatchesPath(serverRouteRule, "/users/123")).toBe(true);
    expect(proxyRuleMatchesPath(serverRouteRule, "/users/123/details")).toBe(
      false,
    );
    expect(proxyRuleMatchesPath(serverRouteRule, "/")).toBe(false);
    expect(proxyRuleMatchesPath(serverRouteRule, "/acme")).toBe(true);
    expect(proxyRuleMatchesPath(serverRouteRule, "/acme/settings")).toBe(false);
    expect(fallbackPattern.test("/dashboard/settings")).toBe(true);
    expect(fallbackPattern.test("/health")).toBe(false);
    expect(fallbackPattern.test("/health/details")).toBe(true);
    expect(fallbackPattern.test("/users/123")).toBe(false);
    expect(fallbackPattern.test("/users/123/details")).toBe(true);
    expect(fallbackPattern.test("/acme")).toBe(false);
    expect(fallbackPattern.test("/acme/settings")).toBe(true);
  });

  it("uses a generated pages app entry for framework-managed pages", async () => {
    const config = createResolvedConfig({
      routing: {
        mode: "spa",
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
    });
    const plan = await createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.entry).toEqual([
      {
        import: "./.ev/entries/main.ts",
        name: "main",
      },
    ]);
  });

  it("uses a generated server entry for framework-managed server routes", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, {
      serverRoutes: [
        {
          id: "src/apis/health/api.ts:/health:GET",
          module: "src/apis/health/api.ts",
          path: "/health",
          methods: ["GET"],
        },
      ],
    });

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.server?.entry).toBe("./.ev/entries/server.ts");
    expect(utoopackConfig.server?.function).toEqual({
      clientProxy: "@evjs/ev/_internal/client/server-functions",
      serverRegister: "@evjs/ev/_internal/server/server-reference",
    });
  });

  it("configures both transform runtimes for discovered server functions", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, {
      serverFunctions: [
        {
          id: "canonical-id",
          module: "src/apis/actions.server.ts",
          exportName: "runAction",
        },
      ],
    });

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.server?.function).toEqual({
      clientProxy: "@evjs/ev/_internal/client/server-functions",
      serverRegister: "@evjs/ev/_internal/server/server-reference",
    });
  });

  it("does not add SPA history fallback for MPA builds", async () => {
    const config = createResolvedConfig({
      routing: {
        mode: "mpa",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "home",
            path: "/home",
            module: "./src/pages/home/page.tsx",
          },
          {
            id: "about",
            path: "/about",
            module: "./src/pages/about/page.tsx",
          },
        ],
      },
    });
    const plan = await createPlan(config);

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.entry).toEqual([
      {
        import: "./.ev/entries/page-client-home.ts",
        name: "page-client-home",
      },
      {
        import: "./.ev/entries/page-client-about.ts",
        name: "page-client-about",
      },
    ]);
    expect(utoopackConfig.devServer?.proxy).toHaveLength(1);
    expect(
      proxyRuleMatchesPath(utoopackConfig.devServer?.proxy?.[0], "/__evjs/fn"),
    ).toBe(true);
  });

  it("uses generated component page entries for framework-managed page entries", async () => {
    const config = createResolvedConfig({
      routing: {
        mode: "mpa",
        html: "./index.html",
        mount: "#app",
        routes: [
          {
            id: "home",
            path: "/home",
            module: "./src/pages/home/page.tsx",
          },
        ],
      },
    });
    const plan = await createPlan(config);

    expect(plan.entries[0]?.import).toBe("./.ev/entries/page-client-home.ts");
    expect(plan.entries[0]?.metadata).toMatchObject({
      type: "react-component-page",
      component: "./src/pages/home/page.tsx",
    });
    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.entry).toEqual([
      {
        import: "./.ev/entries/page-client-home.ts",
        name: "page-client-home",
      },
    ]);
  });

  it("uses generated component page entries instead of SPA router entries for MPA page routes", async () => {
    const config = createResolvedConfig({
      routing: {
        mode: "mpa",
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
    });
    const graph = createGraph(config);
    const plan = await materializeFrameworkIR({
      cwd: process.cwd(),
      mode: "development",
      config,
      graph,
      plugins: [],
      pluginContext: {
        cwd: process.cwd(),
        mode: "development",
        config,
        logger: {} as never,
        addWatchFile() {},
      },
      plan: createBuildPlan(config, graph, { mode: "development" }),
      write: false,
    });

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

    expect(
      plan.entries
        .filter((entry) => entry.environment === "client")
        .map((entry) => entry.import),
    ).toEqual([
      "./.ev/entries/page-client-index.ts",
      "./.ev/entries/page-client-about.ts",
    ]);
    expect(utoopackConfig.entry).toEqual([
      {
        import: "./.ev/entries/page-client-index.ts",
        name: "page-client-index",
      },
      {
        import: "./.ev/entries/page-client-about.ts",
        name: "page-client-about",
      },
    ]);
  });

  it("awaits async configureBundler hooks before returning config", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);
    const watchedFiles: string[] = [];

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [
        {
          async configureBundler(cfg, ctx) {
            await Promise.resolve();
            cfg.define = { ...cfg.define, __PLUGIN_ASYNC__: "true" };
            ctx.addWatchFile("./utoopack-plugin.config.ts");
            expect(ctx.mode).toBe("development");
            expect(ctx).not.toHaveProperty("command");
            expect(ctx.bundlerName).toBe("utoopack");
            expect(ctx.environment).toBe("client");
            expect(Object.isFrozen(ctx.config)).toBe(true);
            expect(Object.isFrozen(ctx.config.plugins)).toBe(true);
            expect(() => {
              (ctx.config.plugins as unknown as unknown[]).push({
                name: "late-plugin",
              });
            }).toThrow(TypeError);
          },
        },
      ],
      (file) => watchedFiles.push(file),
    );

    expect(utoopackConfig.define?.__PLUGIN_ASYNC__).toBe("true");
    expect(watchedFiles).toEqual(["./utoopack-plugin.config.ts"]);
    expect(config.plugins).toEqual([]);
  });

  it("rejects a plugin output override that targets the canonical server output", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            if (utoopackConfig.output) {
              utoopackConfig.output.path = path.resolve(
                process.cwd(),
                "dist/server",
              );
            }
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Utoopack output.path "dist/server" must remain the exact absolute BuildPlan output.client directory "dist/client".',
    );
  });

  it("validates output ownership after each configureBundler hook", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);
    const events: string[] = [];

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            events.push("mutate");
            if (utoopackConfig.output) {
              utoopackConfig.output.path = path.resolve(
                process.cwd(),
                "dist/server",
              );
            }
          },
        },
        {
          configureBundler(utoopackConfig) {
            events.push("restore");
            if (utoopackConfig.output) {
              utoopackConfig.output.path = path.resolve(
                process.cwd(),
                "dist/client",
              );
            }
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Utoopack output.path "dist/server" must remain the exact absolute BuildPlan output.client directory "dist/client".',
    );
    expect(events).toEqual(["mutate"]);
  });

  it("validates output file templates after each configureBundler hook", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);
    const events: string[] = [];

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            events.push("mutate");
            if (utoopackConfig.output) {
              utoopackConfig.output.filename = "../../escape.js";
            }
          },
        },
        {
          configureBundler(utoopackConfig) {
            events.push("restore");
            if (utoopackConfig.output) {
              utoopackConfig.output.filename = "[name].js";
            }
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Utoopack output.filename "../../escape.js" must remain the framework-owned template "[name].js".',
    );
    expect(events).toEqual(["mutate"]);
  });

  it("preserves framework runtime identity after configureBundler hooks", async () => {
    const cases: Array<{
      expected: string;
      mutate(config: ConfigComplete): void;
    }> = [
      {
        expected:
          'Utoopack mode "production" must remain the framework-owned value "development"',
        mutate(config) {
          config.mode = "production";
        },
      },
      {
        expected:
          "Utoopack output.clean false must remain the framework-owned value true",
        mutate(config) {
          if (config.output) config.output.clean = false;
        },
      },
      {
        expected:
          'Utoopack output.publicPath "/plugin/" must remain the framework-owned value "auto"',
        mutate(config) {
          if (config.output) config.output.publicPath = "/plugin/";
        },
      },
      {
        expected:
          'Utoopack output.crossOriginLoading "use-credentials" must remain the framework-owned value "anonymous"',
        mutate(config) {
          if (config.output) {
            config.output.crossOriginLoading = "use-credentials";
          }
        },
      },
    ];

    for (const testCase of cases) {
      const config = createResolvedConfig();
      const plan = await createPlan(config);
      await expect(
        createUtoopackConfig(config, plan, process.cwd(), [
          {
            configureBundler(utoopackConfig) {
              testCase.mutate(utoopackConfig);
            },
          },
        ]),
      ).rejects.toThrow(testCase.expected);
    }
  });

  it("rejects portable artifact escapes in added entry names after each configureBundler hook", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);
    const events: string[] = [];

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            events.push("mutate");
            utoopackConfig.entry.push({
              import: "./src/plugin-entry.ts",
              name: "../../escape",
            });
          },
        },
        {
          configureBundler() {
            events.push("restore");
          },
        },
      ]),
    ).rejects.toThrow(
      'Utoopack entry name "../../escape" must be a non-empty portable relative artifact path',
    );
    expect(events).toEqual(["mutate"]);
  });

  it("validates entry names even when no configureBundler hook runs", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);
    const [entry] = plan.entries;
    if (entry) entry.name = "../../escape";

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), []),
    ).rejects.toThrow(
      'Utoopack entry name "../../escape" must be a non-empty portable relative artifact path',
    );
  });

  it("rejects portable artifact escapes in configured split chunk names", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);
    const splitChunks: NonNullable<
      NonNullable<ConfigComplete["optimization"]>["splitChunks"]
    > = {
      js: {},
      css: {},
    };
    Object.assign(splitChunks, { "../../escape": {} });

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            utoopackConfig.optimization = {
              ...utoopackConfig.optimization,
              splitChunks,
            };
          },
        },
      ]),
    ).rejects.toThrow(
      'Utoopack split chunk name "../../escape" must be a non-empty portable relative artifact path',
    );
  });

  it("preserves framework entry names across configureBundler hooks", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            utoopackConfig.entry = utoopackConfig.entry.filter(
              (entry) => entry.name !== "main",
            );
          },
        },
      ]),
    ).rejects.toThrow(
      'Utoopack configureBundler hooks must preserve framework entry name "main" exactly once; found 0',
    );
  });

  it("preserves framework entry imports after each configureBundler hook", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);
    const events: string[] = [];

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            events.push("mutate");
            const entry = utoopackConfig.entry.find(
              (candidate) => candidate.name === "main",
            );
            if (entry) entry.import = "./src/plugin-entry.ts";
          },
        },
        {
          configureBundler(utoopackConfig) {
            events.push("restore");
            const entry = utoopackConfig.entry.find(
              (candidate) => candidate.name === "main",
            );
            if (entry) entry.import = "./.ev/entries/main.ts";
          },
        },
      ]),
    ).rejects.toThrow(
      'Utoopack entry "main" import "./src/plugin-entry.ts" must remain the exact framework-owned BuildPlan import "./.ev/entries/main.ts"',
    );
    expect(events).toEqual(["mutate"]);
  });

  it("rejects client entries that are not in the BuildPlan", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            utoopackConfig.entry.push({
              import: "./src/plugin-entry.ts",
              name: "plugin-entry",
            });
          },
        },
      ]),
    ).rejects.toThrow(
      'Utoopack configureBundler hooks cannot add unplanned client entries: "plugin-entry"',
    );
  });

  it("preserves the exact framework server entry after each configureBundler hook", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, {
      serverRoutes: [
        {
          id: "src/apis/health/api.ts:/health:GET",
          module: "src/apis/health/api.ts",
          path: "/health",
          methods: ["GET"],
        },
      ],
    });
    const baseline = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );
    const expectedServerEntry = baseline.server?.entry;
    if (!expectedServerEntry) throw new Error("Expected a server entry.");
    const events: string[] = [];

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            events.push("mutate");
            if (utoopackConfig.server) {
              utoopackConfig.server.entry = "./src/plugin-server.ts";
            }
          },
        },
        {
          configureBundler(utoopackConfig) {
            events.push("restore");
            if (utoopackConfig.server) {
              utoopackConfig.server.entry = expectedServerEntry;
            }
          },
        },
      ]),
    ).rejects.toThrow(
      `[evjs] Utoopack server.entry "./src/plugin-server.ts" must remain the exact framework-owned BuildPlan server.entry ${JSON.stringify(expectedServerEntry)}. configureBundler hooks cannot override the framework server entry.`,
    );
    expect(events).toEqual(["mutate"]);
  });

  it("rejects in-place mutation of framework-owned server entries", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, {
      serverRoutes: [
        {
          id: "src/apis/health/api.ts:/health:GET",
          module: "src/apis/health/api.ts",
          path: "/health",
          methods: ["GET"],
        },
      ],
    });
    plan.entries.push({
      name: "page-server-dashboard",
      import: "./src/pages/Dashboard.tsx",
      environment: "server",
      runtime: "node",
      kind: "page-server",
      owner: { pageId: "dashboard", routeId: "dashboard" },
    });

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            const entry = utoopackConfig.server?.entry;
            if (Array.isArray(entry)) entry.splice(0, 1);
          },
        },
      ]),
    ).rejects.toThrow(
      "configureBundler hooks cannot override the framework server entry",
    );
  });

  it("preserves framework-owned server function runtimes", async () => {
    const cases: Array<{
      expected: string;
      mutate(config: ConfigComplete): void;
    }> = [
      {
        expected:
          'Utoopack server.function.clientProxy "./plugin-client-proxy" must remain the framework-owned value "@evjs/ev/_internal/client/server-functions"',
        mutate(config) {
          if (config.server?.function) {
            config.server.function.clientProxy = "./plugin-client-proxy";
          }
        },
      },
      {
        expected:
          'Utoopack server.function.serverRegister <unset> must remain the framework-owned value "@evjs/ev/_internal/server/server-reference"',
        mutate(config) {
          if (config.server?.function) {
            delete config.server.function.serverRegister;
          }
        },
      },
    ];

    for (const testCase of cases) {
      const config = createResolvedConfig();
      const plan = await createPlan(config, {
        serverFunctions: [
          {
            id: "canonical-id",
            module: "src/apis/actions.server.ts",
            exportName: "runAction",
          },
        ],
      });

      await expect(
        createUtoopackConfig(config, plan, process.cwd(), [
          {
            configureBundler(utoopackConfig) {
              testCase.mutate(utoopackConfig);
            },
          },
        ]),
      ).rejects.toThrow(testCase.expected);
    }
  });

  it("rejects a relative spelling of the BuildPlan output path", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config);

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            if (utoopackConfig.output) {
              utoopackConfig.output.clean = false;
              utoopackConfig.output.path = "dist/client";
            }
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Utoopack output.path "dist/client" must remain the exact absolute BuildPlan output.client directory "dist/client".',
    );
  });

  it("rejects client and server output overrides when client cleaning is disabled", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, {
      serverRoutes: [
        {
          id: "src/apis/health/api.ts:/health:GET",
          module: "src/apis/health/api.ts",
          path: "/health",
          methods: ["GET"],
        },
      ],
    });

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            if (utoopackConfig.output) {
              utoopackConfig.output.clean = false;
              utoopackConfig.output.path = path.resolve(
                process.cwd(),
                "dist/plugin-client",
              );
            }
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Utoopack output.path "dist/plugin-client" must remain the exact absolute BuildPlan output.client directory "dist/client".',
    );

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), [
        {
          configureBundler(utoopackConfig) {
            if (utoopackConfig.output) utoopackConfig.output.clean = false;
            if (utoopackConfig.server?.output) {
              utoopackConfig.server.output.path = path.resolve(
                process.cwd(),
                "dist/plugin-server",
              );
            }
          },
        },
      ]),
    ).rejects.toThrow(
      '[evjs] Utoopack server.output.path "dist/plugin-server" must remain the exact absolute BuildPlan output.server directory "dist/server".',
    );
  });

  it("maps server-runtime and page-server entries to named Utoopack server entries", async () => {
    const config = createResolvedConfig({
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
    });
    const graph = createGraph(config, {
      pages: [
        {
          id: "dashboard",
          path: "/dashboard",
          module: "./src/pages/Dashboard.tsx",
          render: "ssr",
        },
      ],
    });
    const plan = createBuildPlan(config, graph, { mode: "development" });

    expect(plan.entries.map((entry) => entry.name)).toEqual([
      "main",
      "page-server-dashboard",
      "server",
    ]);
    expect(plan.server).toMatchObject({
      entry: "@evjs/ev/_internal/server/fetch",
      renderers: [
        {
          name: "page-server-dashboard",
          import: "./src/pages/Dashboard.tsx",
          kind: "page-server",
          owner: { pageId: "dashboard", routeId: "dashboard" },
        },
      ],
    });
    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.server?.entry).toEqual([
      {
        name: "server",
        import: require.resolve("@evjs/ev/_internal/server/fetch"),
      },
      {
        name: "page-server-dashboard",
        import: "./src/pages/Dashboard.tsx",
      },
    ]);
  });

  it("continues to reject unsupported RSC and PPR server entries", async () => {
    const config = createResolvedConfig({
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
    });
    const plan = await createPlan(config);
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

    expect(message).not.toContain("dashboard-server");
    expect(message).toContain('insights-rsc (rsc-page, page "insights")');
    expect(message).toContain(
      'campaign-ppr-shell (ppr-shell, page "campaign")',
    );
    expect(message).toContain(
      'campaign-offer-ppr-region (ppr-region, page "campaign", region "offer")',
    );
    expect(message).toContain(
      "Unsupported entry kinds: rsc-page, ppr-shell, ppr-region",
    );
    expect(message).toContain("PPR/RSC validation");
  });

  it("rejects multiple server-runtime entries", async () => {
    const config = createResolvedConfig();
    const plan = await createPlan(config, {
      serverRoutes: [
        {
          id: "src/apis/health/api.ts:/health:GET",
          module: "src/apis/health/api.ts",
          path: "/health",
          methods: ["GET"],
        },
      ],
    });
    plan.entries.push({
      name: "server-secondary",
      import: "./src/server-secondary.ts",
      environment: "server",
      runtime: "node",
      kind: "server-runtime",
    });

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), []),
    ).rejects.toThrow(
      'Utoopack adapter supports exactly one server-runtime entry; found 2: "server", "server-secondary"',
    );
  });
});

function createPlan(
  config: Parameters<typeof createUtoopackConfig>[0],
  options: {
    distDir?: string;
    mode?: "development" | "production";
    serverRoutes?: ServerRouteNode[];
    serverFunctions?: CoreGraph["serverFunctions"];
  } = {},
): Promise<BuildPlan> {
  const graph = createGraph(config, {
    serverRoutes: options.serverRoutes,
    serverFunctions: options.serverFunctions,
  });
  const buildConfig = {
    ...config,
    server: {
      ...config.server,
      routes: options.serverRoutes,
    },
  };

  const mode = options.mode ?? "development";
  return materializeFrameworkIR({
    cwd: process.cwd(),
    mode,
    config,
    graph,
    plugins: config.plugins,
    pluginContext: {
      cwd: process.cwd(),
      mode,
      config,
      logger: {} as never,
      addWatchFile() {},
    },
    plan: createBuildPlan(buildConfig, graph, {
      mode,
      distDir: options.distDir,
    }),
    write: false,
  });
}

interface TestPage {
  id: string;
  path: string;
  module: string;
  render?: RenderMode;
  template?: string;
  mount?: string;
}

function createGraph(
  config: Parameters<typeof createUtoopackConfig>[0],
  options: {
    pages?: TestPage[];
    serverRoutes?: ServerRouteNode[];
    serverFunctions?: CoreGraph["serverFunctions"];
  } = {},
): CoreGraph {
  const documentTemplate = config.routing?.html ?? "./index.html";
  const routingPages = (config.routing?.routes ?? []).flatMap<TestPage>(
    (route) =>
      route.kind === "layout" || !route.module
        ? []
        : [
            {
              id: route.id,
              path: route.path,
              module: route.module,
              render: "csr",
              template: documentTemplate,
              mount: config.routing?.mount,
            },
          ],
  );
  const pages = options.pages ?? routingPages;
  const routingMode = config.routing?.mode ?? "spa";
  const pageIds = pages.map((page) => page.id);
  const routeIds = pages.map((page) => page.id);
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
        root: "./src/pages",
        routingMode,
        pageIds,
        routeIds,
        documentIds,
        plugins: {},
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
          plugins: {},
          provenance,
        },
      ]),
    ),
    routes: pages.map((page) => ({
      id: page.id,
      applicationId: "default",
      pattern: toRoutePattern(page.path),
      target: { kind: "page" as const, pageId: page.id },
      facets: { wrappers: [] },
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
                provenance,
              },
            ],
          ]
        : pages.map((page) => [
            page.id,
            {
              id: page.id,
              template: page.template ?? documentTemplate,
              output:
                page.path === "/" ? "index.html" : `${page.id}/index.html`,
              applicationId: "default",
              owner: { kind: "page" as const, pageId: page.id },
              mount: page.mount ?? "#app",
              bootstrap: { kind: "page" as const, pageId: page.id },
              provenance,
            },
          ]),
    ),
    plugins: { entries: {} },
    serverFunctions: options.serverFunctions ?? [],
    serverRoutes: options.serverRoutes ?? [],
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

function getProxyRuleContexts(rule: { context: string | string[] }): string[] {
  return Array.isArray(rule.context) ? rule.context : [rule.context];
}

function proxyRuleMatchesPath(
  rule: { context: string | string[] } | undefined,
  pathname: string,
): boolean {
  if (!rule) return false;
  return getProxyRuleContexts(rule).some((context) =>
    context.startsWith("^")
      ? new RegExp(context).test(pathname)
      : pathname === context || pathname.startsWith(`${context}/`),
  );
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
