import type { AppGraph, BuildPlan } from "@evjs/ev";
import { createBuildPlan } from "@evjs/ev/build-tools";
import { describe, expect, it } from "vitest";
import { createUtoopackConfig } from "../src/adapter/create-config.js";

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

  it("installs the file-route entry loader for framework-managed file routes", async () => {
    const config = createResolvedConfig({
      entry: "./src/pages/index.tsx",
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
    await expect(
      createUtoopackConfig(config, plan, process.cwd(), []),
    ).rejects.toThrow(
      "Utoopack adapter cannot build framework server page entries yet",
    );
  });

  it("fails clearly for framework server page entries until Utoopack supports them", async () => {
    const config = createResolvedConfig({
      serverEnabled: true,
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

    await expect(
      createUtoopackConfig(config, plan, process.cwd(), []),
    ).rejects.toThrow(
      "Utoopack adapter cannot build framework server page entries yet",
    );
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
    routes: [],
    serverFunctions: [],
    serverRoutes: [],
    remotes: {},
  };

  return createBuildPlan(config, graph, { mode: "development" });
}
