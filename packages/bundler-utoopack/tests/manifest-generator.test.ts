import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BundlerBuildFacts } from "@evjs/ev/_internal/build";
import type {
  BuildPlan,
  CoreGraph,
  CoreRoutePattern,
  HydrationMode,
  PprConfig,
  PrerenderConfig,
  RenderMode,
} from "@evjs/shared/manifest";
import { linkBuildOutput } from "@evjs/shared/manifest";
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
  await fs.promises.writeFile(
    path.join(cwd, "dist/client/stats.json"),
    JSON.stringify({
      entrypoints: {
        main: { assets: [{ name: "main.js" }] },
      },
    }),
  );
  await fs.promises.writeFile(path.join(cwd, "dist/server/server.js"), "");
  await fs.promises.writeFile(
    path.join(cwd, "dist/server/stats.json"),
    JSON.stringify({
      entrypoints: {
        server: { assets: [{ name: "server.js" }] },
      },
    }),
  );
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
  graph: CoreGraph,
  plan: BuildPlan,
  facts: BundlerBuildFacts,
) {
  return linkBuildOutput({
    graph,
    plan,
    clientEntryAssets: facts.clientEntryAssets,
    serverEntryAssets: facts.serverEntryAssets,
    serverEntry: facts.serverEntry,
    serverAssets: facts.serverAssets,
    serverModules: facts.serverModules,
  });
}

describe("UtoopackManifestGenerator", () => {
  it("fails when client stats are missing for a client BuildPlan entry", async () => {
    const cwd = await makeProject();
    await fs.promises.rm(path.join(cwd, "dist/client/stats.json"));
    const graph = createSpaClientGraph(cwd);

    await expect(
      new UtoopackManifestGenerator(cwd, createPlan(graph)).build(),
    ).rejects.toThrow(
      'Utoopack did not emit client stats for BuildPlan entry "main"',
    );
  });

  it("fails when client stats contain malformed JSON", async () => {
    const cwd = await makeProject();
    await fs.promises.writeFile(path.join(cwd, "dist/client/stats.json"), "{");
    const graph = createSpaClientGraph(cwd);

    await expect(
      new UtoopackManifestGenerator(cwd, createPlan(graph)).build(),
    ).rejects.toThrow("Failed to read Utoopack client stats");
  });

  it("rejects ambiguous client stats when the planned name is absent", async () => {
    const cwd = await makeProject();
    await fs.promises.writeFile(
      path.join(cwd, "dist/client/stats.json"),
      JSON.stringify({
        entrypoints: {
          renderer: { assets: [{ name: "renderer.js" }] },
          vendor: { assets: [{ name: "vendor.js" }] },
        },
      }),
    );
    const graph = createSpaClientGraph(cwd);

    await expect(
      new UtoopackManifestGenerator(cwd, createPlan(graph)).build(),
    ).rejects.toThrow(
      'Utoopack client stats do not identify client BuildPlan entrypoint "main" uniquely',
    );
  });

  it("does not infer the server entry from arbitrary JavaScript files", async () => {
    const cwd = await makeProject();
    await fs.promises.rm(path.join(cwd, "dist/server/stats.json"));
    await fs.promises.writeFile(path.join(cwd, "dist/server/unrelated.js"), "");
    const graph = createGraph({
      cwd,
      routingMode: "spa",
      pages: [],
    });
    const plan = createPlan(graph);

    await expect(
      new UtoopackManifestGenerator(cwd, plan).build(),
    ).rejects.toThrow(
      'Utoopack did not emit server stats for BuildPlan entry "server"',
    );
  });

  it("rejects ambiguous stats entrypoints when the BuildPlan name is absent", async () => {
    const cwd = await makeProject();
    await fs.promises.writeFile(
      path.join(cwd, "dist/server/stats.json"),
      JSON.stringify({
        entrypoints: {
          first: { assets: [{ name: "first.js" }] },
          second: { assets: [{ name: "second.js" }] },
        },
      }),
    );
    const graph = createGraph({
      cwd,
      routingMode: "spa",
      pages: [],
    });
    const plan = createPlan(graph);

    await expect(
      new UtoopackManifestGenerator(cwd, plan).build(),
    ).rejects.toThrow(
      'Utoopack server stats do not identify BuildPlan entrypoint "server" uniquely',
    );
  });

  it("uses the only server stats entrypoint when its name differs", async () => {
    const cwd = await makeProject();
    await fs.promises.writeFile(
      path.join(cwd, "dist/server/stats.json"),
      JSON.stringify({
        entrypoints: {
          runtime: { assets: [{ name: "runtime.js" }] },
        },
      }),
    );
    const graph = createGraph({
      cwd,
      routingMode: "spa",
      pages: [],
    });

    const output = await new UtoopackManifestGenerator(
      cwd,
      createPlan(graph),
    ).build();

    expect(output.serverEntry).toBe("runtime.js");
  });

  it("rejects a server entrypoint without a JavaScript asset", async () => {
    const cwd = await makeProject();
    await fs.promises.writeFile(
      path.join(cwd, "dist/server/stats.json"),
      JSON.stringify({
        entrypoints: {
          server: { assets: [{ name: "server.css" }] },
        },
      }),
    );
    const graph = createGraph({
      cwd,
      routingMode: "spa",
      pages: [],
    });
    const plan = createPlan(graph);

    await expect(
      new UtoopackManifestGenerator(cwd, plan).build(),
    ).rejects.toThrow(
      'Utoopack server entrypoint "server" must emit exactly one self-contained JavaScript entry asset',
    );
  });

  it("does not choose the first of multiple unidentifiable JavaScript assets", async () => {
    const cwd = await makeProject();
    await fs.promises.writeFile(
      path.join(cwd, "dist/server/stats.json"),
      JSON.stringify({
        entrypoints: {
          server: {
            assets: [{ name: "runtime.js" }, { name: "vendor.js" }],
          },
        },
      }),
    );
    const graph = createGraph({
      cwd,
      routingMode: "spa",
      pages: [],
    });

    await expect(
      new UtoopackManifestGenerator(cwd, createPlan(graph)).build(),
    ).rejects.toThrow(
      'Utoopack server entrypoint "server" must emit exactly one self-contained JavaScript entry asset; found 2',
    );
  });

  it("rejects non-portable emitted asset inventory paths", async () => {
    const cwd = await makeProject();
    await fs.promises.writeFile(
      path.join(cwd, "dist/client/stats.json"),
      JSON.stringify({
        assets: [{ name: "../escape.js" }],
        entrypoints: {
          main: { assets: [{ name: "main.js" }] },
        },
      }),
    );
    const graph = createGraph({
      cwd,
      routingMode: "spa",
      pages: [],
    });

    await expect(
      new UtoopackManifestGenerator(cwd, createPlan(graph)).build(),
    ).rejects.toThrow(
      'Utoopack emitted asset "../escape.js" must be a non-empty portable relative artifact path',
    );
  });

  it("rejects portable aliases and file-directory overlaps in inventories", async () => {
    const cwd = await makeProject();
    const graph = createGraph({
      cwd,
      routingMode: "spa",
      pages: [],
    });
    const plan = createPlan(graph);
    const conflicts = [
      {
        assets: ["main.js", "assets", "assets-extra.js", "assets/main.js"],
        message:
          'Bundler emittedFiles.client asset "assets/main.js" conflicts with "assets"',
      },
      {
        assets: ["main.js", "chunks/Foo.js", "chunks/foo.js"],
        message:
          'Bundler emittedFiles.client asset "chunks/foo.js" conflicts with "chunks/Foo.js"',
      },
    ];

    for (const conflict of conflicts) {
      await fs.promises.writeFile(
        path.join(cwd, "dist/client/stats.json"),
        JSON.stringify({
          assets: conflict.assets.map((name) => ({ name })),
          entrypoints: {
            main: { assets: [{ name: "main.js" }] },
          },
        }),
      );
      await expect(
        new UtoopackManifestGenerator(cwd, plan).build(),
      ).rejects.toThrow(conflict.message);
    }
  });

  it("collects build facts that can be linked into BuildOutput", async () => {
    const cwd = await makeProject();
    await fs.promises.writeFile(
      path.join(cwd, "dist/client/stats.json"),
      JSON.stringify({
        assets: [
          { name: "./main.js" },
          { name: "main.css" },
          { name: "chunks/lazy.js" },
          { name: "assets/logo.svg" },
        ],
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
        assets: [
          { name: "./server.js" },
          { name: "server.css" },
          { name: "chunks/server-lazy.js" },
        ],
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

    const graph = createGraph({
      cwd,
      routingMode: "spa",
      pages: [
        {
          id: "home",
          routeId: "home",
          path: "/",
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
    });
    const plan = createPlan(graph);

    const generator = new UtoopackManifestGenerator(cwd, plan);
    const output = await generator.build();
    const manifest = linkTestManifest(graph, plan, output);

    expect(output.clientEntryAssets?.main).toEqual({
      js: ["main.js"],
      css: ["main.css"],
    });
    expect(output.emittedFiles).toEqual({
      client: [
        "main.js",
        "main.css",
        "chunks/lazy.js",
        "assets/logo.svg",
        "stats.json",
      ],
      server: [
        "server.js",
        "server.css",
        "chunks/server-lazy.js",
        "stats.json",
      ],
    });
    expect(manifest.apps.default.assets).toEqual({
      js: ["main.js"],
      css: ["main.css"],
    });
    expect(manifest.apps.default.module).toEqual({
      type: "entry",
      href: "main.js",
    });
    expect(manifest.routes).toEqual([
      {
        id: "home",
        path: "/",
        appId: "default",
        pageId: "home",
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

    const graph = createGraph({
      cwd,
      routingMode: "spa",
      pages: [
        {
          id: "index",
          routeId: "index",
          path: "/",
          module: "./src/pages/page.tsx",
          render: "csr",
        },
      ],
    });
    const plan = createPlan(graph, { distDir: "custom-dist" });

    const generator = new UtoopackManifestGenerator(cwd, plan);
    const output = await generator.build();
    const manifest = linkTestManifest(graph, plan, output);

    expect(output.clientEntryAssets?.main).toEqual({
      js: ["main.js"],
      css: [],
    });
    expect(output.serverEntry).toBe("server.js");
    expect(output.emittedFiles).toBeUndefined();
    expect(manifest.paths.rootDir).toBe("custom-dist");
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

    const graph = createGraph({
      cwd,
      routingMode: "mpa",
      pages: [
        {
          id: "home",
          routeId: "home",
          path: "/home",
          module: "./src/home.tsx",
          render: "csr",
        },
        {
          id: "about",
          routeId: "about",
          path: "/about",
          module: "./src/about.tsx",
          render: "csr",
        },
      ],
    });
    const plan = createPlan(graph, { clientDir: "dist" });

    const generator = new UtoopackManifestGenerator(cwd, plan);
    const output = await generator.build();
    const manifest = linkTestManifest(graph, plan, output);

    expect(manifest.apps).toEqual({});
    expect(manifest.pages.home).toMatchObject({
      assets: { js: ["home.js"], css: [] },
      render: "csr",
      module: {
        type: "react-component",
        href: "home.js",
      },
    });
    expect(manifest.pages.about).toMatchObject({
      assets: { js: ["about.js"], css: [] },
      render: "csr",
      module: {
        type: "react-component",
        href: "about.js",
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

    const graph = createGraph({
      cwd,
      routingMode: "mpa",
      pages: [
        {
          id: "campaign",
          routeId: "campaign-route",
          path: "/campaign",
          module: "./src/campaign/Page.tsx",
          render: "ssr",
          prerender: { partial: true },
          hydrate: "load",
          ppr: {
            regions: {
              offer: {
                component: "./src/campaign/Offer.region.tsx",
                fallback: "./src/campaign/OfferSkeleton.tsx",
                cache: "no-store",
              },
            },
          },
        },
      ],
    });
    const plan = createPlan(graph);

    const generator = new UtoopackManifestGenerator(cwd, plan);
    const output = await generator.build();
    const manifest = linkTestManifest(graph, plan, output);

    expect(manifest.pages.campaign).toMatchObject({
      assets: { js: ["campaign.client.js"], css: [] },
      render: "ssr",
      prerender: { partial: true },
      ppr: {
        delivery: "merge",
        shell: { js: ["campaign.shell.js"], css: [] },
        regions: {
          offer: {
            id: "offer",
            assets: { js: ["campaign.offer.js"], css: [] },
            cache: "no-store",
          },
        },
      },
    });
  });
});

interface TestPage {
  id: string;
  routeId: string;
  path: string;
  module: string;
  render: RenderMode;
  hydrate?: HydrationMode;
  prerender?: PrerenderConfig;
  ppr?: PprConfig;
}

function createSpaClientGraph(cwd: string): CoreGraph {
  return createGraph({
    cwd,
    routingMode: "spa",
    pages: [
      {
        id: "home",
        routeId: "home",
        path: "/",
        module: "./src/pages/page.tsx",
        render: "csr",
      },
    ],
  });
}

function createGraph(options: {
  cwd: string;
  routingMode: "spa" | "mpa";
  pages?: TestPage[];
  serverFunctions?: CoreGraph["serverFunctions"];
  serverRoutes?: CoreGraph["serverRoutes"];
}): CoreGraph {
  const pages = options.pages ?? [];
  const pageIds = pages.map((page) => page.id);
  const routeIds = pages.map((page) => page.routeId);
  const documentIds = options.routingMode === "spa" ? ["index"] : pageIds;
  const provenance = {
    producer: {
      kind: "provider" as const,
      id: "@evjs/provider/page-anchor",
    },
  };

  return {
    rootDir: options.cwd,
    applications: {
      default: {
        id: "default",
        root: "./src/pages",
        routingMode: options.routingMode,
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
          render: page.render,
          ...(page.hydrate ? { hydrate: page.hydrate } : {}),
          ...(page.prerender ? { prerender: page.prerender } : {}),
          ...(page.ppr ? { ppr: page.ppr } : {}),
          plugins: {},
          provenance,
        },
      ]),
    ),
    routes: pages.map((page) => ({
      id: page.routeId,
      applicationId: "default",
      pattern: toRoutePattern(page.path),
      target: { kind: "page" as const, pageId: page.id },
      facets: { wrappers: [] },
      provenance,
    })),
    documents: Object.fromEntries(
      options.routingMode === "spa"
        ? [
            [
              "index",
              {
                id: "index",
                template: "./index.html",
                output: "index.html",
                applicationId: "default",
                owner: { kind: "application" as const },
                mount: "#app",
                bootstrap: { kind: "application" as const },
                provenance,
              },
            ],
          ]
        : pages.map((page) => [
            page.id,
            {
              id: page.id,
              template: "./index.html",
              output: `${page.id}.html`,
              applicationId: "default",
              owner: { kind: "page" as const, pageId: page.id },
              mount: "#app",
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

function createPlan(
  graph: CoreGraph,
  options: { clientDir?: string; distDir?: string; serverDir?: string } = {},
): BuildPlan {
  const pageEntries = Object.values(graph.pages)
    .filter(
      (page) => graph.applications[page.applicationId]?.routingMode === "mpa",
    )
    .map((page) => ({
      name: page.id,
      import: page.source.module,
      environment: "client" as const,
      runtime: "browser" as const,
      kind: "page-client" as const,
      owner: {
        pageId: page.id,
        ...(findPageRouteId(graph, page.id)
          ? { routeId: findPageRouteId(graph, page.id) }
          : {}),
      },
      metadata: {
        type: "react-component-page" as const,
        component: page.source.module,
        mount: findPageDocument(graph, page.id)?.mount ?? "#app",
        hydrate: page.hydrate ?? "load",
        render: page.render,
      },
    }));
  const pprEntries = Object.values(graph.pages).flatMap((page) => [
    ...(page.prerender &&
    typeof page.prerender === "object" &&
    page.prerender.partial &&
    page.source.module
      ? [
          {
            name: `${page.id}-ppr-shell`,
            import: page.source.module,
            environment: "server" as const,
            runtime: "node" as const,
            kind: "ppr-shell" as const,
            owner: {
              pageId: page.id,
              ...(findPageRouteId(graph, page.id)
                ? { routeId: findPageRouteId(graph, page.id) }
                : {}),
            },
          },
        ]
      : []),
    ...Object.entries(page.ppr?.regions ?? {}).map(([regionId, region]) => ({
      name: `${page.id}-${regionId}-ppr-region`,
      import: region.component,
      environment: "server" as const,
      runtime: "node" as const,
      kind: "ppr-region" as const,
      owner: {
        pageId: page.id,
        ...(findPageRouteId(graph, page.id)
          ? { routeId: findPageRouteId(graph, page.id) }
          : {}),
        regionId,
      },
    })),
  ]);
  const appEntries = Object.values(graph.applications).flatMap((app) =>
    app.routingMode === "spa" &&
    graph.routes.some((route) => route.applicationId === app.id)
      ? [
          {
            name: app.id === "default" ? "main" : app.id,
            import: `./.ev/entries/${app.id === "default" ? "main" : app.id}.ts`,
            environment: "client" as const,
            runtime: "browser" as const,
            kind: "app-client" as const,
            owner: { appId: app.id },
          },
        ]
      : [],
  );

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
        import: "@evjs/ev/_internal/server/fetch",
        environment: "server" as const,
        runtime: "node" as const,
        kind: "server-runtime" as const,
      },
    ],
    html: Object.values(graph.documents).map((document) => ({
      id: document.id,
      template: document.template,
      fileName: document.output,
      owner:
        document.owner.kind === "page"
          ? {
              appId: document.applicationId,
              pageId: document.owner.pageId,
            }
          : { appId: document.applicationId },
    })),
    server: {
      entry: "@evjs/ev/_internal/server/fetch",
    },
    dev: {
      clientRoutes: graph.routes.flatMap((route) =>
        route.target.kind === "page"
          ? [
              {
                path: formatRoutePattern(route.pattern),
                target: {
                  kind: "app" as const,
                  appId: route.applicationId,
                },
              },
            ]
          : [],
      ),
      serverRequestRoutePaths: graph.serverRoutes.map((route) => route.path),
      serverRenderedPagePaths: graph.routes.flatMap((route) => {
        if (route.target.kind !== "page") return [];
        const page = graph.pages[route.target.pageId];
        return page?.render !== "csr"
          ? [formatRoutePattern(route.pattern)]
          : [];
      }),
      hasPpr: Object.values(graph.pages).some(
        (page) =>
          Boolean(page.ppr) ||
          (typeof page.prerender === "object" &&
            page.prerender.partial === true),
      ),
    },
    runtime: {
      publicPath: "/",
      server: {
        basePath: "/__evjs",
        fn: "__evjs/fn",
      },
    },
  };
}

function findPageRouteId(graph: CoreGraph, pageId: string): string | undefined {
  return graph.routes.find(
    (route) => route.target.kind === "page" && route.target.pageId === pageId,
  )?.id;
}

function findPageDocument(graph: CoreGraph, pageId: string) {
  return Object.values(graph.documents).find(
    (document) =>
      document.owner.kind === "page" && document.owner.pageId === pageId,
  );
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

function formatRoutePattern(pattern: CoreRoutePattern): string {
  if (pattern.segments.length === 0) return "/";
  return `/${pattern.segments
    .map((segment) => {
      if (segment.kind === "static") return segment.value;
      if (segment.kind === "param") return `:${segment.name}`;
      return `*${segment.name}`;
    })
    .join("/")}`;
}
