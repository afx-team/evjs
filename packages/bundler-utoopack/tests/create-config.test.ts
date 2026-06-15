import { createRequire } from "node:module";
import type { AppGraph, BuildPlan } from "@evjs/ev";
import { createBuildPlan } from "@evjs/ev/build-tools";
import { describe, expect, it } from "vitest";
import { createUtoopackConfig } from "../src/adapter/create-config.js";

const require = createRequire(import.meta.url);
const componentPageLoader = require("../src/adapter/component-page-loader.cjs");
const remoteClientLoader = require("../src/adapter/remote-client-loader.cjs");

describe("createUtoopackConfig", () => {
  function createResolvedConfig(
    overrides: Partial<Parameters<typeof createUtoopackConfig>[0]> = {},
  ): Parameters<typeof createUtoopackConfig>[0] {
    return {
      entry: "./src/main.tsx",
      html: "./index.html",
      dev: {
        port: 41234,
        https: true,
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
    expect(utoopackConfig.devServer?.port).toBe(41234);
    expect(utoopackConfig.devServer?.https).toBe(true);
    expect(utoopackConfig.devServer?.proxy).toContainEqual(
      expect.objectContaining({
        context: ["^/(?!api(?:/|$))(?!turbopack-hmr$)(?!.*\\.[^/]+$).+"],
        target: "https://localhost:41234",
      }),
    );
  });

  it("keeps SPA history fallback away from custom framework runtime paths", async () => {
    const config = createResolvedConfig({
      serverEnabled: true,
      server: {
        entry: "@evjs/server/fetch",
        basePath: "/rpc",
        runtime: {
          basePath: "/rpc",
          fn: "/rpc/fn",
          ppr: "/rpc/ppr",
          rsc: "/rpc/rsc",
        },
        rsc: { endpoint: "/rpc/rsc" },
        functionRuntime: {
          endpoint: "/rpc/fn",
          clientProxy: "@evjs/client/internal",
          serverRegister: "@evjs/server/register",
        },
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
        import: "./src/pages/index.tsx",
        name: "main",
      },
    ]);
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
      remotes: {},
    };
    const plan = createBuildPlan(config, graph, { mode: "development" });

    expect(plan.entries.map((entry) => entry.metadata?.type)).toEqual([
      "react-component-page",
      "react-component-page",
    ]);
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

    expect(source).toContain("@evjs/client/internal/react-page");
    expect(source).not.toContain('from "@evjs/client/internal";');
    expect(source).toContain("createReactPageModule");
  });

  it("installs remote client loaders for framework-managed remote entries", async () => {
    const config = createResolvedConfig({
      remote: {
        name: "crm",
        baseUrl: "https://assets.example.com/crm/",
        entries: {
          customers: {
            app: "./src/remote.tsx",
            activeWhen: ["/customers/*"],
            mount: "#remote-root",
          },
        },
      },
    });
    const graph: AppGraph = {
      version: 1,
      rootDir: process.cwd(),
      apps: {},
      pages: {},
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
      remotes: {},
      remote: {
        name: "crm",
        baseUrl: "https://assets.example.com/crm/",
        entries: {
          customers: {
            id: "customers",
            app: "./src/remote.tsx",
            activeWhen: ["/customers/*"],
            mount: "#remote-root",
          },
        },
      },
    };
    const plan = createBuildPlan(config, graph, { mode: "development" });

    expect(plan.entries).toContainEqual(
      expect.objectContaining({
        name: "crm-customers",
        import: "./src/remote.tsx",
        kind: "remote-client",
        metadata: {
          type: "remote-client",
          app: "./src/remote.tsx",
        },
      }),
    );

    const utoopackConfig = await createUtoopackConfig(
      config,
      plan,
      process.cwd(),
      [],
    );

    expect(utoopackConfig.entry).toEqual([
      { import: "./src/remote.tsx", name: "crm-customers" },
    ]);
    expect(utoopackConfig.module?.rules).toMatchObject({
      "**/*": [
        {
          condition: {
            path: expect.any(RegExp),
            query: "",
          },
          loaders: [
            {
              loader: expect.stringContaining("remote-client-loader.cjs"),
              options: {
                type: "remote-client",
                app: "./src/remote.tsx",
              },
            },
          ],
          type: "ecmascript",
        },
      ],
    });
  });

  it("generates remote lifecycle entry imports", () => {
    const source = remoteClientLoader.call({
      cacheable() {},
      resourcePath: "/workspace/src/remote.tsx",
    });

    expect(source).toContain("@evjs/client/internal/react-page");
    expect(source).toContain("createRemoteReactModule");
    expect(source).toContain("registerShellModule");
    expect(source).toContain("?evjs-remote-client-source");
    expect(source).not.toContain('from "@evjs/client/internal";');
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
            expect(ctx.plan.entries.map((entry) => entry.name)).toEqual([
              "main",
            ]);
          },
        },
      ],
    );

    expect(utoopackConfig.output?.publicPath).toBe("runtime");
  });

  it("fails clearly when the plan contains framework server renderer entries", async () => {
    const config = createResolvedConfig({
      serverEnabled: true,
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
      remotes: {},
    };
    const plan = createBuildPlan(config, graph, { mode: "development" });

    expect(plan.entries.map((entry) => entry.name)).toEqual([
      "main",
      "dashboard-server",
      "server",
    ]);
    expect(plan.server).toMatchObject({
      entry: "@evjs/server/fetch",
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
      serverEnabled: true,
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
    serverRoutes: [],
    remotes: {},
  };

  return createBuildPlan(config, graph, { mode: "development" });
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
