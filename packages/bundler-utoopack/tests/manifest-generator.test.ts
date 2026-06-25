import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppGraph, BuildPlan, BundlerBuildFacts } from "@evjs/ev";
import { linkBuildOutput } from "@evjs/ev";
import { afterEach, describe, expect, it } from "vitest";
import { UtoopackManifestGenerator } from "../src/manifest-generator.js";

const tempDirs: string[] = [];

async function makeProject() {
  const cwd = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "evjs-manifest-"),
  );
  tempDirs.push(cwd);
  await fs.promises.mkdir(path.join(cwd, "dist/client"), { recursive: true });
  await fs.promises.mkdir(path.join(cwd, "dist/server"), { recursive: true });
  await fs.promises.writeFile(path.join(cwd, "dist/server/server.js"), "");
  return cwd;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.promises.rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function linkTestManifest(
  graph: AppGraph,
  plan: BuildPlan,
  facts: BundlerBuildFacts,
) {
  return linkBuildOutput({
    graph,
    plan,
    clientEntryAssets: facts.clientEntryAssets,
    firstClientEntryAssets: facts.firstClientEntryAssets,
    serverEntryAssets: facts.serverEntryAssets,
    serverEntry: facts.serverEntry,
    serverAssets: facts.serverAssets,
    serverModules: facts.serverModules,
  });
}

describe("UtoopackManifestGenerator", () => {
  it("collects build facts that can be linked into BuildOutput", async () => {
    const cwd = await makeProject();
    await fs.promises.writeFile(
      path.join(cwd, "dist/client/stats.json"),
      JSON.stringify({
        entrypoints: {
          main: {
            assets: [{ name: "main.js" }, { name: "main.css" }],
          },
        },
      }),
    );
    await fs.promises.writeFile(
      path.join(cwd, "dist/server/stats.json"),
      JSON.stringify({
        entrypoints: {
          server: { assets: [{ name: "server.js" }, { name: "server.css" }] },
        },
        modules: [
          {
            name: "app/src/actions.ts",
            chunks: ["server.js"],
          },
          {
            name: "app/src/routes.ts",
            chunks: ["server.js"],
          },
        ],
      }),
    );

    const graph: AppGraph = {
      version: 1,
      rootDir: cwd,
      apps: {
        default: {
          id: "default",
          entry: "./src/main.tsx",
          html: "./index.html",
        },
      },
      pages: {},
      routes: [
        {
          id: "home",
          path: "/",
          appId: "default",
          module: "./pages/Home.tsx",
          render: "ssr",
        },
      ],
      serverFunctions: [
        {
          id: "function-id",
          module: "src/actions.ts",
          exportName: "save",
        },
      ],
      serverRoutes: [
        {
          id: "health",
          module: "src/routes.ts",
          path: "/api/health",
          methods: ["GET"],
        },
      ],
    };
    const plan = createPlan(graph);

    const generator = new UtoopackManifestGenerator(cwd, plan);
    const output = await generator.build();
    const manifest = linkTestManifest(graph, plan, output);

    expect(output.clientEntryAssets?.main).toEqual({
      js: ["main.js"],
      css: ["main.css"],
    });
    expect(manifest.apps.default.assets).toEqual({
      js: ["main.js"],
      css: ["main.css"],
    });
    expect(manifest.apps.default.module).toEqual({
      type: "entry",
      href: "main.js",
      source: "./src/main.tsx",
    });
    expect(manifest.routes).toEqual([
      {
        id: "home",
        path: "/",
        appId: "default",
        module: "./pages/Home.tsx",
        render: "ssr",
      },
    ]);
    expect(manifest.server?.entry).toBe("server.js");
    expect(manifest.server?.assets).toEqual({
      js: ["server.js"],
      css: ["server.css"],
    });
    expect(manifest.server?.functions).toEqual({
      "function-id": {
        assets: { js: ["server.js"], css: [] },
        module: "src/actions.ts",
        exportName: "save",
      },
    });
    expect(manifest.server?.routes).toEqual([
      {
        path: "/api/health",
        methods: ["GET"],
        assets: { js: ["server.js"], css: [] },
      },
    ]);
  });

  it("reads stats from the build plan distDir", async () => {
    const cwd = await makeProject();
    await fs.promises.mkdir(path.join(cwd, "custom-dist/client"), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(cwd, "custom-dist/server"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(cwd, "custom-dist/client/stats.json"),
      JSON.stringify({
        entrypoints: {
          main: { assets: ["./main.js"] },
        },
      }),
    );
    await fs.promises.writeFile(
      path.join(cwd, "custom-dist/server/stats.json"),
      JSON.stringify({
        entrypoints: {
          server: { assets: ["./server.js"] },
        },
      }),
    );

    const graph: AppGraph = {
      version: 1,
      rootDir: cwd,
      apps: {
        default: {
          id: "default",
          entry: "./src/main.tsx",
          html: "./index.html",
        },
      },
      pages: {},
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan = createPlan(graph, { distDir: "custom-dist" });

    const generator = new UtoopackManifestGenerator(cwd, plan);
    const output = await generator.build();
    const manifest = linkTestManifest(graph, plan, output);

    expect(output.clientEntryAssets?.main).toEqual({
      js: ["main.js"],
      css: [],
    });
    expect(output.serverEntry).toBe("server.js");
    expect(manifest.distDir).toBe("custom-dist");
  });

  it("links page assets for MPA output", async () => {
    const cwd = await makeProject();
    await fs.promises.rm(path.join(cwd, "dist/client"), {
      recursive: true,
      force: true,
    });
    await fs.promises.writeFile(
      path.join(cwd, "dist/stats.json"),
      JSON.stringify({
        entrypoints: {
          home: { assets: [{ name: "home.js" }] },
          about: { assets: [{ name: "about.js" }] },
        },
      }),
    );

    const graph: AppGraph = {
      version: 1,
      rootDir: cwd,
      apps: {},
      pages: {
        home: {
          id: "home",
          entry: "./src/home.tsx",
          html: "./index.html",
          render: "csr",
        },
        about: {
          id: "about",
          entry: "./src/about.tsx",
          html: "./index.html",
          render: "csr",
        },
      },
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan = createPlan(graph, { clientDir: "dist" });

    const generator = new UtoopackManifestGenerator(cwd, plan);
    const output = await generator.build();
    const manifest = linkTestManifest(graph, plan, output);

    expect(manifest.apps).toEqual({});
    expect(manifest.pages.home).toMatchObject({
      assets: { js: ["home.js"], css: [] },
      render: "csr",
      entry: "./src/home.tsx",
      module: {
        type: "entry",
        href: "home.js",
        source: "./src/home.tsx",
      },
    });
    expect(manifest.pages.about).toMatchObject({
      assets: { js: ["about.js"], css: [] },
      render: "csr",
      entry: "./src/about.tsx",
      module: {
        type: "entry",
        href: "about.js",
        source: "./src/about.tsx",
      },
    });
  });

  it("links PPR shell and region metadata from server entries", async () => {
    const cwd = await makeProject();
    await fs.promises.writeFile(
      path.join(cwd, "dist/client/stats.json"),
      JSON.stringify({
        entrypoints: {
          campaign: { assets: [{ name: "campaign.client.js" }] },
        },
      }),
    );
    await fs.promises.writeFile(
      path.join(cwd, "dist/server/stats.json"),
      JSON.stringify({
        entrypoints: {
          server: { assets: [{ name: "server.js" }] },
          "campaign-ppr-shell": {
            assets: [{ name: "campaign.shell.js" }],
          },
          "campaign-offer-ppr-region": {
            assets: [{ name: "campaign.offer.js" }],
          },
        },
      }),
    );

    const graph: AppGraph = {
      version: 1,
      rootDir: cwd,
      apps: {},
      pages: {
        campaign: {
          id: "campaign",
          routeId: "campaign-route",
          component: "./src/campaign/Page.tsx",
          html: "./index.html",
          render: "ssr",
          prerender: { partial: true },
          hydrate: "visible",
          ppr: {
            regions: {
              offer: {
                component: "./src/campaign/Offer.region.tsx",
                fallback: "./src/campaign/OfferSkeleton.tsx",
                cache: "no-store",
                hydrate: "visible",
              },
            },
          },
        },
      },
      routes: [],
      serverFunctions: [],
      serverRoutes: [],
    };
    const plan = createPlan(graph);

    const generator = new UtoopackManifestGenerator(cwd, plan);
    const output = await generator.build();
    const manifest = linkTestManifest(graph, plan, output);

    expect(manifest.pages.campaign).toMatchObject({
      assets: { js: ["campaign.client.js"], css: [] },
      render: "ssr",
      prerender: { partial: true },
      routeId: "campaign-route",
      component: "./src/campaign/Page.tsx",
      ppr: {
        delivery: "merge",
        shell: { js: ["campaign.shell.js"], css: [] },
        regions: {
          offer: {
            id: "offer",
            assets: { js: ["campaign.offer.js"], css: [] },
            component: "./src/campaign/Offer.region.tsx",
            fallback: "./src/campaign/OfferSkeleton.tsx",
            cache: "no-store",
            hydrate: "visible",
          },
        },
      },
    });
  });
});

function createPlan(
  graph: AppGraph,
  options: { clientDir?: string; distDir?: string; serverDir?: string } = {},
): BuildPlan {
  const pageEntries = Object.values(graph.pages).map((page) => ({
    name: page.id,
    import: page.entry ?? page.app ?? page.component ?? "",
    environment: "client" as const,
    runtime: "browser" as const,
    kind: "page-client" as const,
    owner: { pageId: page.id },
    ...(page.component && !page.entry && !page.app
      ? {
          metadata: {
            type: "react-component-page" as const,
            component: page.component,
            mount: page.mount ?? "#app",
            hydrate: page.hydrate ?? "load",
            render: page.render,
          },
        }
      : {}),
  }));
  const pprEntries = Object.values(graph.pages).flatMap((page) => [
    ...(page.prerender &&
    typeof page.prerender === "object" &&
    page.prerender.partial &&
    page.component
      ? [
          {
            name: `${page.id}-ppr-shell`,
            import: page.component,
            environment: "server" as const,
            runtime: "node" as const,
            kind: "ppr-shell" as const,
            owner: { pageId: page.id },
          },
        ]
      : []),
    ...Object.entries(page.ppr?.regions ?? {}).map(([regionId, region]) => ({
      name: `${page.id}-${regionId}-ppr-region`,
      import: region.component,
      environment: "server" as const,
      runtime: "node" as const,
      kind: "ppr-region" as const,
      owner: { pageId: page.id, regionId },
    })),
  ]);
  const appEntries = Object.values(graph.apps).map((app) => ({
    name: app.id === "default" ? "main" : app.id,
    import: app.entry,
    environment: "client" as const,
    runtime: "browser" as const,
    kind: "app-client" as const,
    owner: { appId: app.id },
  }));

  return {
    version: 1,
    buildId: "test",
    mode: "production",
    distDir: options.distDir ?? "dist",
    output: {
      clientDir: options.clientDir ?? `${options.distDir ?? "dist"}/client`,
      serverDir: options.serverDir ?? `${options.distDir ?? "dist"}/server`,
    },
    entries: [
      ...appEntries,
      ...pageEntries,
      ...pprEntries,
      {
        name: "server",
        import: "@evjs/server/fetch",
        environment: "server" as const,
        runtime: "node" as const,
        kind: "server-runtime" as const,
      },
    ],
    html: [
      ...Object.values(graph.apps).map((app) => ({
        id: app.id === "default" ? "index" : app.id,
        template: app.html,
        fileName: app.id === "default" ? "index.html" : `${app.id}.html`,
        owner: { appId: app.id },
      })),
      ...Object.values(graph.pages).map((page) => ({
        id: page.id,
        template: page.html,
        fileName: `${page.id}.html`,
        owner: { pageId: page.id },
      })),
    ],
    server: {
      entry: "@evjs/server/fetch",
      functionRuntime: {
        endpoint: "/__evjs/fn",
        clientProxy: "@evjs/client/internal",
        serverRegister: "@evjs/server/register",
      },
    },
    runtime: {
      publicPath: "/",
      server: {
        basePath: "/__evjs",
        fn: "/__evjs/fn",
      },
    },
  };
}
