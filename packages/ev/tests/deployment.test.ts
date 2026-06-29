import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BuildOutput } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDeploymentArtifact,
  createEdgeDeploymentFiles,
  createNodeDeploymentFiles,
  createStaticDeploymentFiles,
  edgeDeploymentAdapter,
  nodeDeploymentAdapter,
  staticDeploymentAdapter,
} from "../src/deployment.js";
import { createBuildResult } from "../src/plugin.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      }),
    ),
  );
});

describe("createDeploymentArtifact", () => {
  it("creates a platform-neutral deployment artifact from BuildOutput", () => {
    const output: BuildOutput = {
      version: 1,
      buildId: "build-1",
      paths: {
        rootDir: "dist",
        publicDir: "dist/client",
        serverDir: "dist/server",
      },
      publicPath: "auto",
      runtime: {
        server: {
          basePath: "/framework",
          fn: "/framework/fn",
          ppr: "/framework/ppr",
          rsc: "/framework/rsc",
        },
        transport: {
          baseUrl: "https://api.example.com",
        },
      },
      assets: {
        main: { js: ["main.js"], css: ["main.css"] },
      },
      apps: {
        default: {
          assets: { js: ["main.js"], css: ["main.css"] },
          mount: "#app",
        },
      },
      pages: {
        insights: {
          assets: { js: [], css: [] },
          render: "ssr",
          componentModel: "rsc",
          rendering: {
            component: "rsc",
            html: "server",
            streaming: true,
            hydrate: "none",
          },
          path: "/insights",
          routeId: "insights",
          hydrate: "none",
          mount: "#app",
        },
      },
      routes: [
        {
          id: "insights",
          path: "/insights",
          pageId: "insights",
        },
      ],
      server: {
        entry: "server.js",
        assets: { js: ["server.js"], css: [] },
        renderers: {
          "insights-rsc": {
            kind: "rsc-page",
            owner: { pageId: "insights" },
            assets: { js: ["insights-rsc.js"], css: [] },
          },
        },
        functions: {
          search: {
            exportName: "search",
            assets: { js: ["server.js"], css: [] },
          },
        },
        routes: [
          {
            path: "/api/webhooks/payment",
            methods: ["POST"],
            assets: { js: ["server.js"], css: [] },
          },
        ],
      },
      rsc: {
        pages: {
          insights: {
            renderer: "insights-rsc",
            assets: { js: ["insights-rsc.js"], css: [] },
          },
        },
      },
      deployment: {
        extra: true,
      },
    };

    expect(
      createDeploymentArtifact(output, {
        platform: "node-example",
        includeAssets: false,
      }),
    ).toEqual({
      version: 1,
      platform: "node-example",
      buildId: "build-1",
      paths: {
        rootDir: "dist",
        publicDir: "dist/client",
        serverDir: "dist/server",
      },
      publicPath: "auto",
      documents: [],
      routes: [
        {
          kind: "server-page",
          path: "/insights",
          pageId: "insights",
          render: "ssr",
          rsc: true,
          methods: ["GET", "HEAD"],
        },
        {
          kind: "server-function",
          path: "/framework/fn",
          methods: ["POST"],
        },
        {
          kind: "rsc-endpoint",
          path: "/framework/rsc",
          methods: ["GET", "HEAD"],
        },
        {
          kind: "api-route",
          path: "/api/webhooks/payment",
          methods: ["POST"],
        },
      ],
      server: {
        entry: "server.js",
      },
      metadata: {
        extra: true,
      },
    });
  });

  it("creates Node deployment files from BuildOutput", () => {
    const output: BuildOutput = {
      version: 1,
      buildId: "build-1",
      paths: {
        rootDir: "dist",
        publicDir: "dist/client",
        serverDir: "dist/server",
      },
      publicPath: "/",
      runtime: {
        server: {
          basePath: "/framework",
          fn: "/framework/fn",
          rsc: "/framework/rsc",
        },
      },
      assets: {},
      apps: {
        default: {
          assets: { js: ["main.js"], css: [] },
        },
      },
      pages: {
        insights: {
          assets: { js: [], css: [] },
          render: "ssr",
          componentModel: "rsc",
          rendering: {
            component: "rsc",
            html: "server",
            streaming: true,
            hydrate: "none",
          },
          path: "/insights/$id",
          routeId: "insights",
        },
      },
      routes: [
        {
          id: "insights",
          path: "/insights/$id",
          pageId: "insights",
        },
      ],
      server: {
        entry: "server.js",
        assets: { js: ["server.js"], css: [] },
        renderers: {},
        functions: {},
        routes: [
          {
            path: "/api/health",
            methods: ["GET"],
            assets: { js: ["server.js"], css: [] },
          },
        ],
      },
    };

    const files = createNodeDeploymentFiles(output, {
      defaultPort: 8080,
      includeAssets: false,
    });

    expect(files.artifactFileName).toBe("deployment.node.json");
    expect(files.serverFileName).toBe("server.mjs");
    expect(files.artifact.platform).toBe("node");
    expect(files.serverModule).toContain(
      'import { fileURLToPath, pathToFileURL } from "node:url";',
    );
    expect(files.serverModule).toContain(
      "globalThis.__EVJS_FRAMEWORK_RUNTIME__ =",
    );
    expect(files.serverModule).toContain('"buildId": "build-1"');
    expect(files.serverModule).toContain('"renderers": {}');
    expect(files.serverModule).not.toContain("readJsonIfExists");
    expect(files.serverModule).toContain(
      "globalThis.__EVJS_SERVER_MODULE_LOADER__",
    );
    expect(files.serverModule).toContain(
      "await import(pathToFileURL(path.join(serverDir, serverEntry)).href)",
    );
    expect(files.serverModule).toContain("unwrapServerHandler");
    expect(files.serverModule).toContain(
      'const frameworkBasePath = "/framework";',
    );
    expect(files.serverModule).toContain('"/api/health"');
    expect(files.serverModule).toContain('"/insights/:id"');
    expect(files.serverModule).toContain(
      'from "@evjs/ev/internal/server/node"',
    );
    expect(files.serverModule).not.toContain('from "hono"');
    expect(files.serverModule).not.toContain(
      'from "@hono/node-server/serve-static"',
    );
    expect(files.serverModule).toContain("PORT");
    expect(files.serverModule).toContain("8080");
  });

  it("creates static deployment files from BuildOutput", () => {
    const output: BuildOutput = {
      version: 1,
      buildId: "build-1",
      paths: {
        rootDir: "dist",
        publicDir: "dist/client",
        serverDir: "dist/server",
      },
      publicPath: "/",
      runtime: {
        server: {
          basePath: "/__evjs",
          fn: "/__evjs/fn",
        },
      },
      assets: {},
      apps: {
        default: {
          assets: { js: ["main.js"], css: [] },
          document: { fileName: "index.html" },
        },
      },
      pages: {
        pricing: {
          assets: { js: [], css: [] },
          document: { fileName: "pricing.html" },
          render: "ssg",
          rendering: {
            component: "server",
            html: "static",
            prerender: "full",
            streaming: false,
            hydrate: "none",
          },
          path: "/pricing",
          routeId: "pricing",
        },
      },
      routes: [
        {
          id: "orders",
          path: "/orders/$orderId",
          appId: "default",
        },
        {
          id: "pricing",
          path: "/pricing",
          pageId: "pricing",
        },
      ],
      server: {
        entry: "server.js",
        assets: { js: ["server.js"], css: [] },
        functions: {},
        routes: [],
      },
    };

    const files = createStaticDeploymentFiles(output, {
      includeAssets: false,
    });

    expect(files.artifactFileName).toBe("deployment.static.json");
    expect(files.redirectsFileName).toBe("_redirects");
    expect(files.artifact.platform).toBe("static");
    expect(files.compatibility).toEqual({
      complete: true,
      unsupportedCapabilities: [],
    });
    expect(files.artifact.metadata?.static).toEqual(files.compatibility);
    expect(files.redirects).toBe(
      [
        "/orders/:orderId /index.html 200",
        "/pricing /pricing.html 200",
        "/* /index.html 200",
        "",
      ].join("\n"),
    );
  });

  it("keeps router-free MPA static routes exact without a global fallback", () => {
    const output = createMpaStaticDeploymentOutput();

    const files = createStaticDeploymentFiles(output, {
      includeAssets: false,
    });

    expect(files.compatibility).toEqual({
      complete: true,
      unsupportedCapabilities: [],
    });
    expect(files.redirects).toBe(
      [
        "/ /index.html 200",
        "/pricing /pricing.html 200",
        "/users/:userId /users_userId.html 200",
        "",
      ].join("\n"),
    );
  });

  it("routes static page documents in generated server modules without an MPA catch-all", () => {
    const output = createMpaStaticDeploymentOutput();

    const nodeFiles = createNodeDeploymentFiles(output);
    const edgeFiles = createEdgeDeploymentFiles(output);

    expect(nodeFiles.serverModule).toContain('"path": "/pricing"');
    expect(nodeFiles.serverModule).toContain('"file": "pricing.html"');
    expect(nodeFiles.serverModule).toContain('"path": "/users/:userId"');
    expect(nodeFiles.serverModule).toContain('const staticFallback = "";');
    expect(edgeFiles.workerModule).toContain('"path": "/pricing"');
    expect(edgeFiles.workerModule).toContain('"file": "pricing.html"');
    expect(edgeFiles.workerModule).toContain('"path": "/users/:userId"');
    expect(edgeFiles.workerModule).toContain('const staticFallback = "";');
    const nodeRouteMatcher = extractGeneratedRouteMatcher(
      nodeFiles.serverModule ?? "",
    );
    const edgeRouteMatcher = extractGeneratedRouteMatcher(
      edgeFiles.workerModule ?? "",
    );

    expect(nodeRouteMatcher).toBe(edgeRouteMatcher);
    expect(edgeRouteMatcher).toContain(
      'return segment.startsWith(":") || segment.startsWith("$");',
    );
  });

  it("routes explicit runtime endpoints outside the framework base path", () => {
    const output = createServerDeploymentOutput({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });
    output.runtime.server = {
      basePath: "/__evjs",
      fn: "/__evjs/fn",
      ppr: "/__evjs/ppr",
      rsc: "/flight",
    };

    const nodeFiles = createNodeDeploymentFiles(output);
    const edgeFiles = createEdgeDeploymentFiles(output);

    for (const source of [
      nodeFiles.serverModule ?? "",
      edgeFiles.workerModule ?? "",
    ]) {
      expect(source).toContain("const frameworkEndpointPaths = [");
      expect(source).toContain('"/flight"');
      expect(source).toContain("frameworkEndpointPaths.some((endpointPath) =>");
      expect(source).toContain("pathIsAtOrBelow(pathname, endpointPath)");
    }
  });

  it("strips root-relative publicPath prefixes for generated asset serving", () => {
    const output = createServerDeploymentOutput({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });
    output.publicPath = "/assets/";

    const nodeFiles = createNodeDeploymentFiles(output);
    const edgeFiles = createEdgeDeploymentFiles(output);

    expect(nodeFiles.serverModule).toContain(
      'const staticAssetPrefix = "/assets";',
    );
    expect(nodeFiles.serverModule).toContain(
      "const assetPathname = stripStaticAssetPrefix(pathname);",
    );
    expect(nodeFiles.serverModule).toContain(
      "const suffix = normalizedPathname.slice(normalizedPrefix.length);",
    );
    expect(edgeFiles.workerModule).toContain(
      'const staticAssetPrefix = "/assets";',
    );
    expect(edgeFiles.workerModule).toContain(
      "function createStaticAssetRequest(request)",
    );
    expect(edgeFiles.workerModule).toContain("url.pathname = assetPathname;");
  });

  it("does not rewrite absolute publicPath asset URLs in generated deployment modules", () => {
    const output = createServerDeploymentOutput({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });
    output.publicPath = "https://cdn.example.com/assets/";

    const nodeFiles = createNodeDeploymentFiles(output);
    const edgeFiles = createEdgeDeploymentFiles(output);

    expect(nodeFiles.serverModule).toContain('const staticAssetPrefix = "";');
    expect(edgeFiles.workerModule).toContain('const staticAssetPrefix = "";');
  });

  it("marks server-required capabilities in static deployment files", () => {
    const output: BuildOutput = {
      version: 1,
      buildId: "build-1",
      paths: {
        rootDir: "dist",
        publicDir: "dist/client",
        serverDir: "dist/server",
      },
      publicPath: "/",
      runtime: {
        server: {
          basePath: "/framework",
          fn: "/framework/fn",
          ppr: "/framework/ppr",
          rsc: "/framework/rsc",
        },
      },
      assets: {},
      apps: {
        default: {
          assets: { js: ["main.js"], css: [] },
          document: { fileName: "index.html" },
        },
      },
      pages: {
        dashboard: {
          assets: { js: [], css: [] },
          render: "ssr",
          rendering: {
            component: "server",
            html: "server",
            streaming: false,
            hydrate: "load",
          },
          path: "/dashboard",
          routeId: "dashboard",
        },
        campaign: {
          assets: { js: [], css: [] },
          render: "ssr",
          rendering: {
            component: "server",
            html: "partial",
            prerender: "partial",
            streaming: false,
            hydrate: "none",
          },
          path: "/campaign",
          routeId: "campaign",
          ppr: {
            delivery: "merge",
            shell: { js: ["campaign-shell.js"], css: [] },
            regions: {},
          },
        },
        insights: {
          assets: { js: [], css: [] },
          render: "ssr",
          componentModel: "rsc",
          rendering: {
            component: "rsc",
            html: "server",
            streaming: true,
            hydrate: "none",
          },
          path: "/insights",
          routeId: "insights",
        },
      },
      routes: [
        {
          id: "orders",
          path: "/orders/$orderId",
          appId: "default",
        },
        {
          id: "dashboard",
          path: "/dashboard",
          pageId: "dashboard",
        },
        {
          id: "campaign",
          path: "/campaign",
          pageId: "campaign",
        },
        {
          id: "insights",
          path: "/insights",
          pageId: "insights",
        },
      ],
      server: {
        entry: "server.js",
        assets: { js: ["server.js"], css: [] },
        renderers: {},
        functions: {
          search: {
            exportName: "search",
            assets: { js: ["server.js"], css: [] },
          },
        },
        routes: [
          {
            path: "/api/health",
            methods: ["GET"],
            assets: { js: ["server.js"], css: [] },
          },
        ],
      },
      rsc: {
        pages: {
          insights: {
            renderer: "insights-rsc",
            assets: { js: ["insights-rsc.js"], css: [] },
          },
        },
      },
    };

    const files = createStaticDeploymentFiles(output, {
      includeAssets: false,
    });

    expect(files.compatibility).toEqual({
      complete: false,
      unsupportedCapabilities: [
        "ppr-pages",
        "rsc-pages",
        "server-functions",
        "server-routes",
        "ssr-pages",
      ],
    });
    expect(files.artifact.metadata?.static).toEqual(files.compatibility);
    expect(files.redirects).toBe(
      ["/orders/:orderId /index.html 200", ""].join("\n"),
    );
  });

  it("does not treat full-prerendered SSR pages as static-only output", () => {
    const output: BuildOutput = {
      version: 1,
      buildId: "build-1",
      paths: {
        rootDir: "dist",
        publicDir: "dist/client",
        serverDir: "dist/server",
      },
      publicPath: "/",
      runtime: {
        server: {
          basePath: "/__evjs",
          fn: "/__evjs/fn",
        },
      },
      assets: {},
      apps: {},
      pages: {
        article: {
          assets: { js: [], css: [] },
          render: "ssr",
          rendering: {
            component: "server",
            html: "server",
            prerender: "full",
            streaming: false,
            hydrate: "none",
          },
          path: "/article",
          routeId: "article",
        },
      },
      routes: [
        {
          id: "article",
          path: "/article",
          pageId: "article",
        },
      ],
      server: {
        entry: "server.js",
        assets: { js: ["server.js"], css: [] },
        functions: {},
        routes: [],
      },
    };

    const files = createStaticDeploymentFiles(output, {
      includeAssets: false,
    });

    expect(files.compatibility).toEqual({
      complete: false,
      unsupportedCapabilities: ["ssr-pages"],
    });
    expect(files.redirects).toBe("\n");
  });

  it("creates static redirects for route-owned SSG pages with emitted documents", () => {
    const output: BuildOutput = {
      version: 1,
      buildId: "build-1",
      paths: {
        rootDir: "dist",
        publicDir: "dist/client",
        serverDir: "dist/server",
      },
      publicPath: "/",
      runtime: {
        server: {
          basePath: "/__evjs",
          fn: "/__evjs/fn",
        },
      },
      assets: {},
      apps: {
        default: {
          assets: { js: ["main.js"], css: [] },
          document: { fileName: "index.html" },
        },
      },
      pages: {
        pricing: {
          assets: { js: [], css: [] },
          document: { fileName: "pricing.html" },
          render: "ssg",
          rendering: {
            component: "server",
            html: "static",
            prerender: "full",
            streaming: false,
            hydrate: "none",
          },
          path: "/pricing",
          routeId: "pricing",
        },
      },
      routes: [
        {
          id: "pricing",
          path: "/pricing",
          pageId: "pricing",
        },
      ],
      server: {
        entry: "server.js",
        assets: { js: ["server.js"], css: [] },
        functions: {},
        routes: [],
      },
    };

    const files = createStaticDeploymentFiles(output, {
      includeAssets: false,
    });

    expect(files.redirects).toBe(
      ["/pricing /pricing.html 200", "/* /index.html 200", ""].join("\n"),
    );
  });

  it("creates Edge deployment files from BuildOutput", () => {
    const output: BuildOutput = {
      version: 1,
      buildId: "build-1",
      paths: {
        rootDir: "dist",
        publicDir: "dist/client",
        serverDir: "dist/server",
      },
      publicPath: "/",
      runtime: {
        server: {
          basePath: "/framework",
          fn: "/framework/fn",
          rsc: "/framework/rsc",
        },
      },
      assets: {},
      apps: {
        default: {
          assets: { js: ["main.js"], css: [] },
        },
      },
      pages: {
        insights: {
          assets: { js: [], css: [] },
          render: "ssr",
          componentModel: "rsc",
          rendering: {
            component: "rsc",
            html: "server",
            streaming: true,
            hydrate: "none",
          },
          path: "/insights/$id",
          routeId: "insights",
        },
      },
      routes: [
        {
          id: "insights",
          path: "/insights/$id",
          pageId: "insights",
        },
      ],
      server: {
        entry: "server.js",
        assets: { js: ["server.js"], css: [] },
        renderers: {},
        functions: {},
        routes: [
          {
            path: "/api/health",
            methods: ["GET"],
            assets: { js: ["server.js"], css: [] },
          },
        ],
      },
    };

    const files = createEdgeDeploymentFiles(output, {
      assetsBinding: "STATIC_ASSETS",
      includeAssets: false,
    });

    expect(files.artifactFileName).toBe("deployment.edge.json");
    expect(files.workerFileName).toBe("worker.mjs");
    expect(files.artifact.platform).toBe("edge");
    expect(files.workerModule).toContain(
      "globalThis.__EVJS_FRAMEWORK_RUNTIME__",
    );
    expect(files.workerModule).toContain(
      "globalThis.__EVJS_SERVER_MODULE_LOADER__",
    );
    expect(files.workerModule).toContain(
      'const serverHandler = unwrapServerHandler(await import("./server/server.js"));',
    );
    expect(files.workerModule).toContain("export default");
    expect(files.workerModule).toContain(
      'const frameworkBasePath = "/framework";',
    );
    expect(files.workerModule).toContain('"/api/health"');
    expect(files.workerModule).toContain('"/insights/:id"');
    expect(files.workerModule).toContain(
      'const assetsBinding = "STATIC_ASSETS";',
    );
    expect(files.workerModule).toContain(
      "serverHandler.fetch(request, env, ctx)",
    );
  });

  it("writes deployment adapter artifacts to explicit root and public output dirs", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-deploy-"));
    tempDirs.push(rootDir);
    const publicDir = path.join(rootDir, "client");
    const serverDir = path.join(rootDir, "server");
    const output = createServerDeploymentOutput({
      rootDir,
      publicDir,
      serverDir,
    });

    await runDeploymentBuildEnd(
      nodeDeploymentAdapter({ includeAssets: false }),
      output,
    );
    await runDeploymentBuildEnd(
      staticDeploymentAdapter({ includeAssets: false }),
      output,
    );
    await runDeploymentBuildEnd(
      edgeDeploymentAdapter({ includeAssets: false }),
      output,
    );

    await expect(
      fs.access(path.join(rootDir, "deployment.node.json")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(rootDir, "server.mjs")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(rootDir, "deployment.edge.json")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(rootDir, "worker.mjs")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(publicDir, "deployment.static.json")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(publicDir, "_redirects")),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(rootDir, "_redirects"))).rejects.toThrow();

    await expect(
      fs.readFile(path.join(rootDir, "server.mjs"), "utf-8"),
    ).resolves.toContain('const clientRoot = path.join(__dirname, "client");');
  });
});

async function runDeploymentBuildEnd(
  plugin: ReturnType<typeof nodeDeploymentAdapter>,
  output: BuildOutput,
) {
  const hooks = await plugin.setup?.({} as never);
  await hooks?.buildEnd?.(createBuildResult(output, false));
}

function extractGeneratedRouteMatcher(source: string): string {
  const start = source.indexOf("function routePathMatches");
  const normalizeStart = source.indexOf("function normalizePathname", start);
  const end = source.indexOf("\n}", normalizeStart);

  if (start < 0 || normalizeStart < 0 || end < 0) {
    throw new Error("Generated route matcher block was not found.");
  }

  return source.slice(start, end + 2);
}

function createMpaStaticDeploymentOutput(): BuildOutput {
  return {
    version: 1,
    buildId: "build-1",
    paths: {
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    },
    publicPath: "/",
    runtime: {
      server: {
        basePath: "/__evjs",
        fn: "/__evjs/fn",
      },
    },
    assets: {},
    apps: {},
    pages: {
      index: {
        assets: { js: ["index.js"], css: [] },
        document: { fileName: "index.html" },
        render: "csr",
        rendering: {
          component: "client",
          html: "client",
          streaming: false,
          hydrate: "load",
        },
        path: "/",
        routeId: "index",
      },
      pricing: {
        assets: { js: [], css: [] },
        document: { fileName: "pricing.html" },
        render: "ssg",
        rendering: {
          component: "server",
          html: "static",
          prerender: "full",
          streaming: false,
          hydrate: "none",
        },
        path: "/pricing",
        routeId: "pricing",
      },
      users_userId: {
        assets: { js: ["users_userId.js"], css: [] },
        document: { fileName: "users_userId.html" },
        render: "csr",
        rendering: {
          component: "client",
          html: "client",
          streaming: false,
          hydrate: "load",
        },
        path: "/users/$userId",
        routeId: "users_userId",
      },
    },
    routes: [
      {
        id: "index",
        path: "/",
        pageId: "index",
      },
      {
        id: "pricing",
        path: "/pricing",
        pageId: "pricing",
      },
      {
        id: "users_userId",
        path: "/users/$userId",
        pageId: "users_userId",
      },
    ],
    server: {
      entry: "server.js",
      assets: { js: ["server.js"], css: [] },
      renderers: {},
      functions: {},
      routes: [],
    },
  };
}

function createServerDeploymentOutput(paths: {
  rootDir: string;
  publicDir: string;
  serverDir: string;
}): BuildOutput {
  return {
    version: 1,
    buildId: "build-1",
    paths,
    publicPath: "/",
    runtime: {
      server: {
        basePath: "/__evjs",
        fn: "/__evjs/fn",
      },
    },
    assets: {},
    apps: {
      default: {
        assets: { js: ["main.js"], css: [] },
      },
    },
    pages: {},
    routes: [
      {
        id: "app",
        path: "/app",
        appId: "default",
      },
    ],
    server: {
      entry: "server.js",
      assets: { js: ["server.js"], css: [] },
      renderers: {},
      functions: {},
      routes: [
        {
          path: "/api/health",
          methods: ["GET"],
          assets: { js: ["server.js"], css: [] },
        },
      ],
    },
  };
}
