import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import type { BuildOutput } from "@evjs/shared/manifest";
import { assertFrameworkManifestShape } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it } from "vitest";
import { createBuildResult } from "../src/_internal/build/build-result.js";
import { createStaticPageDocumentOutput } from "../src/_internal/build/page-document-output.js";
import {
  createLatePluginContext,
  runAfterBuildHooks,
  runTransformOutputHooks,
} from "../src/_internal/build/plugin-lifecycle.js";
import {
  createDeploymentArtifact,
  createEdgeDeploymentFiles,
  createNodeDeploymentFiles,
  createStaticDeploymentFiles,
  edgeDeploymentAdapter,
  nodeDeploymentAdapter,
  type StaticDeploymentAdapterOptions,
  type StaticDeploymentCompatibility,
  staticDeploymentAdapter,
} from "../src/deployment/index.js";
import type { PluginHooks, PluginSetupContext } from "../src/plugin/index.js";

const tempDirs: string[] = [];
const NFC_HANGUL_SYLLABLE = "\uac00";
const NFD_HANGUL_SYLLABLE = "\u1100\u1161";

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
  it("removes analysis watch capabilities from late hook contexts", () => {
    const context = {
      mode: "development",
      command: "dev",
      cwd: "/project",
      config: {} as PluginSetupContext["config"],
      logger: {} as PluginSetupContext["logger"],
      addWatchFile() {},
    } satisfies PluginSetupContext;

    expect(createLatePluginContext(context)).not.toHaveProperty("addWatchFile");
  });

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
    if (!files.serverModule) {
      throw new Error("Expected the Node deployment server module.");
    }

    expect(files.artifactFileName).toBe("deployment.node.json");
    expect(files.serverFileName).toBe("server.mjs");
    expect(files.artifact.platform).toBe("node");
    expect(files.serverModule).toContain(
      'import { fileURLToPath, pathToFileURL } from "node:url";',
    );
    expect(files.serverModule).toContain(
      "globalThis.__EVJS_FRAMEWORK_RUNTIME__ =",
    );
    expect(evaluateGeneratedFrameworkRuntime(files.serverModule).buildId).toBe(
      "build-1",
    );
    expect(files.serverModule).not.toContain('"renderers"');
    expect(files.serverModule).not.toContain("readJsonIfExists");
    expect(files.serverModule).toContain(
      "globalThis.__EVJS_SERVER_MODULE_LOADER__",
    );
    expect(files.serverModule).toContain(
      "await import(pathToFileURL(await resolveServerArtifact(serverEntry)).href)",
    );
    expect(files.serverModule).toContain("if (!serverArtifacts.has(asset))");
    expect(files.serverModule).toContain("unwrapServerHandler");
    expect(files.serverModule).toContain(
      "const frameworkExactEndpointPaths = [",
    );
    expect(files.serverModule).not.toContain("frameworkBasePath");
    expect(files.serverModule).toContain('"/api/health"');
    expect(files.serverModule).toContain('"/insights/:id"');
    expect(files.serverModule).toContain(
      'from "@evjs/ev/_internal/server/node"',
    );
    expect(files.serverModule).not.toContain('from "hono"');
    expect(files.serverModule).not.toContain(
      'from "@hono/node-server/serve-static"',
    );
    expect(files.serverModule).toContain("PORT");
    expect(files.serverModule).toContain("8080");
  });

  it("preserves __proto__ Page ids in generated Node and Edge runtimes", () => {
    const output = createPrototypePageDeploymentOutput();
    const nodeModule = createNodeDeploymentFiles(output).serverModule;
    const edgeModule = createEdgeDeploymentFiles(output).workerModule;

    expect(nodeModule).toBeDefined();
    expect(edgeModule).toBeDefined();
    for (const source of [nodeModule, edgeModule]) {
      const runtime = evaluateGeneratedFrameworkRuntime(source ?? "");
      expect(Object.hasOwn(runtime.routing.pages, "__proto__")).toBe(true);
      expect(runtime.routing.pages.__proto__).toMatchObject({
        path: "/__proto__",
        routeId: "__proto__",
      });
    }
  });

  it("rejects deployment file paths and cross-platform file aliases", () => {
    const output = createServerDeploymentOutput({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });

    expect(() =>
      createNodeDeploymentFiles(output, {
        artifactFileName: "../../deployment.json",
      }),
    ).toThrow(
      "nodeDeploymentAdapter.artifactFileName must be a non-empty portable file name",
    );
    expect(() =>
      createNodeDeploymentFiles(output, {
        artifactFileName: "SERVER.MJS",
        serverFileName: "server.mjs",
      }),
    ).toThrow(
      "nodeDeploymentAdapter.artifactFileName and nodeDeploymentAdapter.serverFileName must name different deployment files",
    );
    expect(() =>
      createNodeDeploymentFiles(output, {
        artifactFileName: `${NFC_HANGUL_SYLLABLE}.json`,
        serverFileName: `${NFD_HANGUL_SYLLABLE}.json`,
      }),
    ).toThrow(
      "nodeDeploymentAdapter.artifactFileName and nodeDeploymentAdapter.serverFileName must name different deployment files",
    );
    expect(() =>
      createNodeDeploymentFiles(output, {
        artifactFileName: "DEPLOYMENT-METADATA.JSON",
      }),
    ).toThrow(
      'conflicts with framework-owned deployment metadata output "deployment-metadata.json"',
    );
    expect(() =>
      createNodeDeploymentFiles(output, {
        artifactFileName: "client",
      }),
    ).toThrow(
      'conflicts with framework-owned public output directory output "client"',
    );
    expect(() =>
      createStaticDeploymentFiles(output, {
        redirectsFileName: String.raw`nested\_redirects`,
      }),
    ).toThrow(
      "staticDeploymentAdapter.redirectsFileName must be a non-empty portable file name",
    );
    expect(() =>
      createStaticDeploymentFiles(output, {
        artifactFileName: "_redirects",
      }),
    ).toThrow(
      "staticDeploymentAdapter.artifactFileName and staticDeploymentAdapter.redirectsFileName must name different deployment files",
    );
    expect(() =>
      createEdgeDeploymentFiles(output, { workerFileName: "con" }),
    ).toThrow(
      "edgeDeploymentAdapter.workerFileName must be a non-empty portable file name",
    );
    expect(() =>
      createEdgeDeploymentFiles(output, {
        workerFileName: "deployment-metadata.json",
      }),
    ).toThrow(
      'conflicts with framework-owned deployment metadata output "deployment-metadata.json"',
    );

    output.apps.default = {
      assets: { js: ["main.js"], css: [] },
      document: {
        fileName: "index.html",
        aliases: [`${NFC_HANGUL_SYLLABLE}.html`],
      },
    };
    expect(() =>
      createStaticDeploymentFiles(output, {
        artifactFileName: "INDEX.HTML",
      }),
    ).toThrow(
      'conflicts with framework-owned Application "default" HTML Document output "index.html"',
    );
    expect(() =>
      createStaticDeploymentFiles(output, {
        redirectsFileName: `${NFD_HANGUL_SYLLABLE}.html`,
      }),
    ).toThrow(
      `conflicts with framework-owned Application "default" HTML Document output "${NFC_HANGUL_SYLLABLE}.html"`,
    );
    expect(() =>
      createStaticDeploymentFiles(output, {
        redirectsFileName: "MAIN.JS",
      }),
    ).toThrow(
      'conflicts with framework-owned Application "default" JavaScript asset output "main.js"',
    );
    output.apps.default.assets.js.push("assets/main.js");
    expect(() =>
      createStaticDeploymentFiles(output, {
        artifactFileName: "assets",
      }),
    ).toThrow(
      'conflicts with framework-owned Application "default" JavaScript asset output "assets/main.js"',
    );
    output.apps.default.assets.css = [`${NFC_HANGUL_SYLLABLE}.css`];
    expect(() =>
      createStaticDeploymentFiles(output, {
        artifactFileName: `${NFD_HANGUL_SYLLABLE}.css`,
      }),
    ).toThrow(
      `conflicts with framework-owned Application "default" CSS asset output "${NFC_HANGUL_SYLLABLE}.css"`,
    );

    output.apps.default.assets = {
      js: [
        "https://cdn.example.com/app.js",
        "/assets/app.js",
        "data:text/javascript,export%20default%201",
      ],
      css: ["//cdn.example.com/app.css", "/assets/app.css?v=1"],
    };
    expect(() =>
      createStaticDeploymentFiles(output, {
        artifactFileName: "app.json",
      }),
    ).not.toThrow();
  });

  it("rejects undeclared or escaping server artifacts without constraining browser URLs", () => {
    const output = createServerDeploymentOutput({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });

    output.server.entry = "../../outside.js";
    expect(() => createNodeDeploymentFiles(output)).toThrow(
      "BuildOutput.server.entry must be a non-empty portable server-relative artifact path",
    );

    output.server.entry = "other.js";
    expect(() => createEdgeDeploymentFiles(output)).toThrow(
      'BuildOutput.server.entry "other.js" must exactly match one BuildOutput.server.assets.js artifact.',
    );

    output.server.entry = "server.js";
    output.server.renderers = {
      page: {
        kind: "page-server",
        assets: { js: ["../outside.js"], css: [] },
      },
    };
    expect(() => createDeploymentArtifact(output)).toThrow(
      "BuildOutput.server.renderers.page.assets.js[0] must be a non-empty portable server-relative artifact path",
    );

    output.server.renderers = {};
    output.apps.default.assets = {
      js: ["https://cdn.example.com/app.js", "../browser-entry.js"],
      css: ["/assets/app.css"],
    };
    expect(() => createDeploymentArtifact(output)).not.toThrow();
  });

  it("keeps build-only renderer artifacts out of deployment loaders", () => {
    const output = createServerDeploymentOutput({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });
    output.server.renderers = {
      runtime: {
        kind: "page-server",
        assets: { js: ["renderers/runtime.js"], css: [] },
      },
      prerender: {
        kind: "page-server",
        phase: "build",
        assets: { js: ["RENDERERS/runtime.js"], css: [] },
      },
    };

    const nodeFiles = createNodeDeploymentFiles(output);
    const edgeFiles = createEdgeDeploymentFiles(output);

    for (const source of [
      nodeFiles.serverModule ?? "",
      edgeFiles.workerModule ?? "",
    ]) {
      expect(source).toContain('"renderers/runtime.js"');
      expect(source).not.toContain('"RENDERERS/runtime.js"');
    }
  });

  it("stops transformOutput hooks immediately after an invalid server artifact mutation", async () => {
    const output = createServerDeploymentOutput({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });
    const events: string[] = [];
    const hooks: PluginHooks[] = [
      {
        transformOutput(current) {
          current.server.assets.js = ["../../outside.js"];
        },
      },
      {
        transformOutput() {
          events.push("second-hook");
        },
      },
    ];
    const pluginContext = {
      mode: "production",
      command: "build",
      cwd: "/project",
      config: {} as PluginSetupContext["config"],
      logger: {} as PluginSetupContext["logger"],
      addWatchFile() {},
    } satisfies PluginSetupContext;

    await expect(
      runTransformOutputHooks(hooks, output, pluginContext, () => {
        assertFrameworkManifestShape(
          output,
          "BuildOutput after transformOutput hooks",
        );
      }),
    ).rejects.toThrow(
      "BuildOutput after transformOutput hooks.server.assets.js[0] must be a non-empty portable server-relative artifact path",
    );
    expect(events).toEqual([]);
  });

  it("derives generated server imports from the configured server output", () => {
    const output = createServerDeploymentOutput({
      rootDir: "dist",
      publicDir: "dist/assets",
      serverDir: "dist/backend",
    });

    const nodeFiles = createNodeDeploymentFiles(output);
    const edgeFiles = createEdgeDeploymentFiles(output);

    expect(nodeFiles.serverModule).toContain(
      "const serverDir = await resolveDeploymentDirectory(",
    );
    expect(nodeFiles.serverModule).toContain(
      'path.join(deploymentRoot, "backend"),',
    );
    expect(edgeFiles.workerModule).toContain(
      'const serverAssetPrefix = "./backend/";',
    );
    expect(edgeFiles.workerModule).toContain(
      "await import(resolveServerArtifact(asset))",
    );
    expect(edgeFiles.workerModule).toContain(
      'await import("./backend/server.js")',
    );
    expect(nodeFiles.serverModule).not.toContain(
      'path.join(deploymentRoot, "server"),',
    );
    expect(edgeFiles.workerModule).not.toContain('import("./server/');
  });

  it("encodes physical artifact names only when projecting them into URLs", () => {
    const output = createServerDeploymentOutput({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/%2e%2e#backend",
    });
    const serverEntry = "%2e%2e/server#entry.js";
    const documentFile = "pages/%2e%2e/home#shell.html";
    output.server.entry = serverEntry;
    output.server.assets = { js: [serverEntry], css: [] };
    const serverRoute = output.server.routes[0];
    if (!serverRoute) throw new Error("Expected a server route fixture.");
    serverRoute.assets = { js: [serverEntry], css: [] };
    const app = output.apps.default;
    if (!app) throw new Error("Expected an application fixture.");
    app.document = { fileName: documentFile };

    const nodeFiles = createNodeDeploymentFiles(output);
    const edgeFiles = createEdgeDeploymentFiles(output);
    const staticFiles = createStaticDeploymentFiles(output);

    expect(nodeFiles.serverModule).toContain(
      `const serverEntry = ${JSON.stringify(serverEntry)};`,
    );
    expect(nodeFiles.serverModule).toContain(
      `const staticFallback = ${JSON.stringify(documentFile)};`,
    );
    expect(edgeFiles.workerModule).toContain(
      'const serverAssetPrefix = "./%252e%252e%23backend/";',
    );
    expect(edgeFiles.workerModule).toContain(
      'await import("./%252e%252e%23backend/%252e%252e/server%23entry.js")',
    );
    expect(edgeFiles.workerModule).toContain(
      'const staticFallback = "pages/%252e%252e/home%23shell.html";',
    );
    expect(edgeFiles.workerModule).toContain(
      'asset.split("/").map(encodeURIComponent).join("/")',
    );
    expect(staticFiles.redirects).toContain(
      "/app /pages/%252e%252e/home%23shell.html 200",
    );
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
          fn: "__evjs/fn",
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
    expect(files.artifact.metadata?.static).not.toBe(files.compatibility);
    expect(
      (files.artifact.metadata?.static as StaticDeploymentCompatibility)
        .unsupportedCapabilities,
    ).not.toBe(files.compatibility.unsupportedCapabilities);
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

  it("uses one-decode route identity in generated Node and Edge matchers", () => {
    const output = createMpaStaticDeploymentOutput();
    const page = output.pages.pricing;
    const route = output.routes.find((item) => item.id === "pricing");
    if (!page?.document || !route) {
      throw new Error("Expected the static pricing fixture route.");
    }
    page.path = "/%75sers";
    const plannedFileName = createStaticPageDocumentOutput(page.path);
    if (!plannedFileName) throw new Error("Expected a static document output.");
    page.document.fileName = plannedFileName;
    expect(page.document.fileName).toBe("%75sers/index.html");
    route.path = "/%75sers";
    output.pages.unicode = {
      assets: { js: [], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "none",
      },
      path: "/%E7%94%A8%E6%88%B7",
      routeId: "unicode",
    };
    output.routes.push({
      id: "unicode",
      path: "/%E7%94%A8%E6%88%B7",
      pageId: "unicode",
    });

    const nodeFiles = createNodeDeploymentFiles(output);
    const edgeFiles = createEdgeDeploymentFiles(output);

    for (const [source, expectedFile] of [
      [nodeFiles.serverModule ?? "", "%75sers/index.html"],
      [edgeFiles.workerModule ?? "", "%2575sers/index.html"],
    ]) {
      const { pathIsAtOrBelow, routePathMatches } =
        evaluateGeneratedRouteMatcher(source);
      const frameworkRoutes = extractGeneratedFrameworkRoutes(source);
      const staticRoutes = extractGeneratedStaticRoutes(source);

      expect(
        frameworkRoutes.find((item) => routePathMatches(item, "/用户")),
      ).toBe("/%E7%94%A8%E6%88%B7");
      expect(
        staticRoutes.find((item) => routePathMatches(item.path, "/users")),
      ).toEqual({
        path: "/%75sers",
        file: expectedFile,
      });
      expect(routePathMatches("/users", "/%75sers")).toBe(true);
      expect(routePathMatches("/用户", "/%E7%94%A8%E6%88%B7")).toBe(true);
      expect(routePathMatches("/%E7%94%A8%E6%88%B7", "/用户")).toBe(true);
      expect(routePathMatches("/files/%2F", "/files/%2f")).toBe(true);
      expect(routePathMatches("/files/%2F", "/files/a/b")).toBe(false);
      expect(routePathMatches("/%2575sers", "/%2575sers")).toBe(true);
      expect(routePathMatches("/%2575sers", "/%75sers")).toBe(false);
      expect(routePathMatches("/%75sers", "/%2575sers")).toBe(false);
      expect(routePathMatches("/users/profile", "/users/profile/")).toBe(true);
      expect(routePathMatches("/users/profile", "/users//profile")).toBe(false);
      expect(routePathMatches("/users/:id", "/users//")).toBe(false);
      expect(routePathMatches("/docs/*", "/docs/a/b")).toBe(true);
      expect(routePathMatches("/docs/*", "/docs//b")).toBe(false);
      expect(routePathMatches("/", "//")).toBe(false);
      expect(pathIsAtOrBelow("/%75sers/profile", "/users")).toBe(true);
      expect(pathIsAtOrBelow("/%2575sers/profile", "/users")).toBe(false);
    }
  });

  it("routes explicit runtime endpoints outside the framework base path", () => {
    const output = createServerDeploymentOutput({
      rootDir: "dist",
      publicDir: "dist/client",
      serverDir: "dist/server",
    });
    output.runtime.server = {
      basePath: "/__evjs",
      fn: "__evjs/fn",
      ppr: "__evjs/ppr",
      rsc: "/flight",
    };

    const nodeFiles = createNodeDeploymentFiles(output);
    const edgeFiles = createEdgeDeploymentFiles(output);

    for (const source of [
      nodeFiles.serverModule ?? "",
      edgeFiles.workerModule ?? "",
    ]) {
      const exactEndpoints = extractGeneratedStringArray(
        source,
        "frameworkExactEndpointPaths",
      );
      const subtreeEndpoints = extractGeneratedStringArray(
        source,
        "frameworkSubtreeEndpointPaths",
      );
      const { pathIsAtOrBelow, routePathMatches } =
        evaluateGeneratedRouteMatcher(source);

      expect(exactEndpoints).toEqual(["/__evjs/fn", "/flight"]);
      expect(subtreeEndpoints).toEqual(["/__evjs/ppr"]);
      expect(
        exactEndpoints.some((endpoint) =>
          routePathMatches(endpoint, "/__evjs/%66n"),
        ),
      ).toBe(true);
      expect(
        exactEndpoints.some((endpoint) =>
          routePathMatches(endpoint, "/__evjs/fn/extra"),
        ),
      ).toBe(false);
      expect(
        subtreeEndpoints.some((endpoint) =>
          pathIsAtOrBelow("/__evjs/ppr/region", endpoint),
        ),
      ).toBe(true);
      expect(
        subtreeEndpoints.some((endpoint) =>
          pathIsAtOrBelow("/__evjs/ppr//region", endpoint),
        ),
      ).toBe(false);
      expect(source).not.toContain("frameworkBasePath");
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
          fn: "__evjs/fn",
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
          fn: "__evjs/fn",
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
      "const frameworkExactEndpointPaths = [",
    );
    expect(files.workerModule).not.toContain("frameworkBasePath");
    expect(files.workerModule).toContain('"/api/health"');
    expect(files.workerModule).toContain('"/insights/:id"');
    expect(files.workerModule).toContain(
      'const assetsBinding = "STATIC_ASSETS";',
    );
    expect(files.workerModule).toContain(
      "serverHandler.fetch(request, env, ctx)",
    );
  });

  it("isolates earlier afterBuild mutations from deployment adapters", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-deploy-"));
    const outsideDir = `${rootDir}-poisoned-build-end`;
    tempDirs.push(rootDir, outsideDir);
    const output = createServerDeploymentOutput({
      rootDir,
      publicDir: path.join(rootDir, "client"),
      serverDir: path.join(rootDir, "server"),
    });
    const observations: Array<{
      rootDir: string;
      routePath: string | undefined;
      serverRoutePath: string | undefined;
      functionPath: string;
    }> = [];
    const mutator: PluginHooks = {
      afterBuild(result) {
        const route = result.output.routes[0];
        if (!route) throw new Error("Expected one client Route.");
        result.output.paths.rootDir = outsideDir;
        route.path = "/poisoned";
        const serverRoute = result.output.server.routes[0];
        if (!serverRoute) throw new Error("Expected one server Route.");
        serverRoute.path = "/poisoned-api";
        result.output.runtime.server.fn = "/poisoned-fn";
      },
    };
    const observer: PluginHooks = {
      afterBuild(result) {
        observations.push({
          rootDir: result.output.paths.rootDir,
          routePath: result.output.routes[0]?.path,
          serverRoutePath: result.output.server.routes[0]?.path,
          functionPath: result.output.runtime.server.fn,
        });
      },
    };
    const adapterHooks = await nodeDeploymentAdapter().setup?.({
      cwd: rootDir,
    } as never);
    if (!adapterHooks) throw new Error("Expected deployment adapter hooks.");

    await runAfterBuildHooks(
      [mutator, observer, adapterHooks],
      createBuildResult(output, false),
    );

    expect(observations).toEqual([
      {
        rootDir,
        routePath: "/app",
        serverRoutePath: "/api/health",
        functionPath: "__evjs/fn",
      },
    ]);
    expect(output.paths.rootDir).toBe(rootDir);
    expect(output.routes[0]?.path).toBe("/app");
    expect(output.server.routes[0]?.path).toBe("/api/health");
    expect(output.runtime.server.fn).toBe("__evjs/fn");
    const artifact = await fs.readFile(
      path.join(rootDir, "deployment.node.json"),
      "utf-8",
    );
    expect(artifact).toContain('"path": "/api/health"');
    expect(artifact).not.toContain("poisoned");
    await expect(
      fs.access(path.join(outsideDir, "deployment.node.json")),
    ).rejects.toThrow();
  });

  it("preflights deployment adapter outputs before any afterBuild write", async () => {
    for (const [nodeFileName, edgeFileName] of [
      ["shared.json", "SHARED.JSON"],
      [`${NFC_HANGUL_SYLLABLE}.json`, `${NFD_HANGUL_SYLLABLE}.json`],
    ]) {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-deploy-"));
      tempDirs.push(rootDir);
      const output = createServerDeploymentOutput({
        rootDir,
        publicDir: path.join(rootDir, "client"),
        serverDir: path.join(rootDir, "server"),
      });
      const events: string[] = [];
      const observer: PluginHooks = {
        afterBuild() {
          events.push("afterBuild");
        },
      };
      const nodeHooks = await nodeDeploymentAdapter({
        artifactFileName: nodeFileName,
      }).setup?.({ cwd: rootDir } as never);
      const edgeHooks = await edgeDeploymentAdapter({
        artifactFileName: edgeFileName,
      }).setup?.({ cwd: rootDir } as never);
      if (!nodeHooks || !edgeHooks) {
        throw new Error("Expected deployment adapter hooks.");
      }

      await expect(
        runAfterBuildHooks(
          [observer, nodeHooks, edgeHooks],
          createBuildResult(output, false),
        ),
      ).rejects.toThrow(
        `edgeDeploymentAdapter.artifactFileName "${edgeFileName}" conflicts with nodeDeploymentAdapter.artifactFileName "${nodeFileName}"; both resolve to the same physical deployment output`,
      );

      expect(events).toEqual([]);
      await expect(
        fs.access(path.join(rootDir, nodeFileName)),
      ).rejects.toThrow();
      await expect(
        fs.access(path.join(rootDir, edgeFileName)),
      ).rejects.toThrow();
    }
  });

  it("preflights deployment file and output-directory overlaps", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-deploy-"));
    tempDirs.push(rootDir);
    const output = createServerDeploymentOutput({
      rootDir,
      publicDir: path.join(rootDir, "client"),
      serverDir: path.join(rootDir, "server"),
    });
    const events: string[] = [];
    const observer: PluginHooks = {
      afterBuild() {
        events.push("afterBuild");
      },
    };
    const nodeHooks = await nodeDeploymentAdapter({
      artifactFileName: "client",
    }).setup?.({ cwd: rootDir } as never);
    const staticHooks = await staticDeploymentAdapter().setup?.({
      cwd: rootDir,
    } as never);
    if (!nodeHooks || !staticHooks) {
      throw new Error("Expected deployment adapter hooks.");
    }

    await expect(
      runAfterBuildHooks(
        [observer, nodeHooks, staticHooks],
        createBuildResult(output, false),
      ),
    ).rejects.toThrow("conflicts");

    expect(events).toEqual([]);
    await expect(fs.access(path.join(rootDir, "client"))).rejects.toThrow();
  });

  it("preflights deployment files against unlinked bundler assets", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-deploy-"));
    tempDirs.push(rootDir);
    const output = createServerDeploymentOutput({
      rootDir,
      publicDir: path.join(rootDir, "client"),
      serverDir: path.join(rootDir, "server"),
    });
    const events: string[] = [];
    const observer: PluginHooks = {
      afterBuild() {
        events.push("afterBuild");
      },
    };
    const staticHooks = await staticDeploymentAdapter({
      artifactFileName: "assets",
    }).setup?.({ cwd: rootDir } as never);
    if (!staticHooks) throw new Error("Expected deployment adapter hooks.");

    await expect(
      runAfterBuildHooks(
        [observer, staticHooks],
        createBuildResult(output, false),
        {
          cwd: rootDir,
          emittedFiles: { client: ["assets/async.js"] },
        },
      ),
    ).rejects.toThrow(
      'staticDeploymentAdapter.artifactFileName "assets" conflicts with bundler-emitted client asset "assets/async.js"; their physical deployment outputs overlap as a file and directory',
    );
    expect(events).toEqual([]);
    await expect(
      fs.access(path.join(rootDir, "client/assets")),
    ).rejects.toThrow();
  });

  it("uses one immutable adapter-options snapshot for preflight and writes", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-deploy-"));
    tempDirs.push(rootDir);
    const publicDir = path.join(rootDir, "client");
    const serverDir = path.join(rootDir, "server");
    const bundlerAsset = path.join(publicDir, "bundler.js");
    await fs.mkdir(publicDir, { recursive: true });
    await fs.writeFile(bundlerAsset, "bundler-owned\n", "utf-8");
    const output = createServerDeploymentOutput({
      rootDir,
      publicDir,
      serverDir,
    });
    const options: StaticDeploymentAdapterOptions = {
      artifactFileName: "captured.static.json",
      redirectsFileName: "captured.redirects",
      includeAssets: false,
      platform: "captured-static",
    };
    const adapter = staticDeploymentAdapter(options);

    options.artifactFileName = "changed-before-setup.json";
    options.redirectsFileName = "changed-before-setup.redirects";
    options.includeAssets = true;
    options.platform = "changed-before-setup";
    const adapterHooks = await adapter.setup?.({ cwd: rootDir } as never);
    if (!adapterHooks) throw new Error("Expected deployment adapter hooks.");

    const mutator: PluginHooks = {
      afterBuild() {
        options.artifactFileName = "bundler.js";
        options.redirectsFileName = "changed-after-preflight.redirects";
        options.platform = "changed-after-preflight";
      },
    };
    await runAfterBuildHooks(
      [mutator, adapterHooks],
      createBuildResult(output, false),
      {
        cwd: rootDir,
        emittedFiles: { client: ["bundler.js"] },
      },
    );

    await expect(fs.readFile(bundlerAsset, "utf-8")).resolves.toBe(
      "bundler-owned\n",
    );
    const artifact = JSON.parse(
      await fs.readFile(path.join(publicDir, "captured.static.json"), "utf-8"),
    ) as { platform?: string };
    expect(artifact.platform).toBe("captured-static");
    await expect(
      fs.access(path.join(publicDir, "captured.redirects")),
    ).resolves.toBeUndefined();
    for (const fileName of [
      "changed-before-setup.json",
      "changed-before-setup.redirects",
      "changed-after-preflight.redirects",
    ]) {
      await expect(fs.access(path.join(publicDir, fileName))).rejects.toThrow();
    }
  });

  it("validates deployment adapter options at the factory boundary", () => {
    let getterCalled = false;
    const accessorOptions = {};
    Object.defineProperty(accessorOptions, "artifactFileName", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "deployment.json";
      },
    });

    expect(() =>
      staticDeploymentAdapter(
        accessorOptions as StaticDeploymentAdapterOptions,
      ),
    ).toThrow(
      "staticDeploymentAdapter() options.artifactFileName must be an enumerable own data property",
    );
    expect(getterCalled).toBe(false);
    expect(() => nodeDeploymentAdapter({ defaultPort: 0 } as never)).toThrow(
      "nodeDeploymentAdapter() options.defaultPort must be an integer TCP port from 1 to 65535",
    );
    expect(() =>
      edgeDeploymentAdapter({ assetsBinding: " " } as never),
    ).toThrow(
      "edgeDeploymentAdapter() options.assetsBinding must be a non-empty string",
    );
    expect(() =>
      staticDeploymentAdapter({ unsupported: true } as never),
    ).toThrow(
      'staticDeploymentAdapter() options has unknown field "unsupported"',
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

    await runDeploymentAfterBuild(
      nodeDeploymentAdapter({ includeAssets: false }),
      output,
    );
    await runDeploymentAfterBuild(
      staticDeploymentAdapter({ includeAssets: false }),
      output,
    );
    await runDeploymentAfterBuild(
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
    ).resolves.toContain('path.join(deploymentRoot, "client"),');
  });

  it("rejects deployment leaf symlinks without writing through them", async () => {
    const container = await fs.mkdtemp(
      path.join(os.tmpdir(), "evjs-deploy-symlink-"),
    );
    tempDirs.push(container);
    const rootDir = path.join(container, "dist");
    const publicDir = path.join(rootDir, "client");
    const serverDir = path.join(rootDir, "server");
    const externalFile = path.join(container, "external.json");
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(externalFile, "outside", "utf-8");
    const artifactFile = path.join(rootDir, "deployment.node.json");
    await fs.symlink(externalFile, artifactFile);
    const output = createServerDeploymentOutput({
      rootDir,
      publicDir,
      serverDir,
    });

    await expect(
      runDeploymentAfterBuild(
        nodeDeploymentAdapter({ includeAssets: false }),
        output,
      ),
    ).rejects.toThrow(
      'Deployment file "deployment.node.json" must not overwrite a symbolic-link output file',
    );

    await expect(fs.readFile(externalFile, "utf-8")).resolves.toBe("outside");
    expect((await fs.lstat(artifactFile)).isSymbolicLink()).toBe(true);
  });

  it("resolves relative adapter output paths from the active project cwd", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "evjs-deploy-cwd-"));
    tempDirs.push(cwd);
    const relativeRoot = `.evjs-deploy-${path.basename(cwd)}`;
    const unexpectedRoot = path.resolve(relativeRoot);
    tempDirs.push(unexpectedRoot);
    const output = createServerDeploymentOutput({
      rootDir: relativeRoot,
      publicDir: `${relativeRoot}/client`,
      serverDir: `${relativeRoot}/backend`,
    });

    await runDeploymentAfterBuild(nodeDeploymentAdapter(), output, cwd);
    await runDeploymentAfterBuild(staticDeploymentAdapter(), output, cwd);
    await runDeploymentAfterBuild(edgeDeploymentAdapter(), output, cwd);

    await expect(
      fs.access(path.join(cwd, relativeRoot, "deployment.node.json")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(cwd, relativeRoot, "deployment.edge.json")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(
        path.join(cwd, relativeRoot, "client", "deployment.static.json"),
      ),
    ).resolves.toBeUndefined();
    await expect(fs.access(unexpectedRoot)).rejects.toThrow();
  });
});

async function runDeploymentAfterBuild(
  plugin: ReturnType<typeof nodeDeploymentAdapter>,
  output: BuildOutput,
  cwd?: string,
) {
  const projectCwd =
    cwd ??
    (path.isAbsolute(output.paths.rootDir)
      ? output.paths.rootDir
      : process.cwd());
  const hooks = await plugin.setup?.({ cwd: projectCwd } as never);
  await hooks?.afterBuild?.(createBuildResult(output, false));
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

interface GeneratedRouteMatcher {
  routePathMatches(routePath: string, pathname: string): boolean;
  pathIsAtOrBelow(pathname: string, basePath: string): boolean;
}

function evaluateGeneratedRouteMatcher(source: string): GeneratedRouteMatcher {
  const matcher = extractGeneratedRouteMatcher(source);
  return vm.runInNewContext(
    `${matcher}\n({ routePathMatches, pathIsAtOrBelow });`,
  ) as GeneratedRouteMatcher;
}

function evaluateGeneratedFrameworkRuntime(source: string): {
  buildId: string;
  routing: { pages: Record<string, unknown> };
} {
  const prefix = "globalThis.__EVJS_FRAMEWORK_RUNTIME__ = ";
  const start = source.indexOf(prefix);
  const end = source.indexOf(";\n", start);
  if (start < 0 || end < 0) {
    throw new Error("Generated framework runtime was not found.");
  }
  return vm.runInNewContext(source.slice(start + prefix.length, end)) as {
    buildId: string;
    routing: { pages: Record<string, unknown> };
  };
}

function extractGeneratedStringArray(source: string, name: string): string[] {
  const prefix = `const ${name} = `;
  const start = source.indexOf(prefix);
  const end = source.indexOf(";\n", start);
  if (start < 0 || end < 0) {
    throw new Error(`Generated ${name} array was not found.`);
  }
  return JSON.parse(source.slice(start + prefix.length, end)) as string[];
}

function extractGeneratedStaticRoutes(
  source: string,
): Array<{ path: string; file: string }> {
  const prefix = "const staticRoutes = ";
  const start = source.indexOf(prefix);
  const end = source.indexOf(";\nconst staticFallback", start);
  if (start < 0 || end < 0) {
    throw new Error("Generated static routes were not found.");
  }
  return JSON.parse(source.slice(start + prefix.length, end)) as Array<{
    path: string;
    file: string;
  }>;
}

function extractGeneratedFrameworkRoutes(source: string): string[] {
  const prefix = "const frameworkRoutes = ";
  const start = source.indexOf(prefix);
  const end = source.indexOf(";\nconst staticRoutes", start);
  if (start < 0 || end < 0) {
    throw new Error("Generated framework routes were not found.");
  }
  return JSON.parse(source.slice(start + prefix.length, end)) as string[];
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
        fn: "__evjs/fn",
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
        fn: "__evjs/fn",
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

function createPrototypePageDeploymentOutput(): BuildOutput {
  const output = createServerDeploymentOutput({
    rootDir: "dist",
    publicDir: "dist/client",
    serverDir: "dist/server",
  });
  output.apps = {};
  output.pages = Object.fromEntries([
    [
      "__proto__",
      {
        assets: { js: [], css: [] },
        render: "ssr",
        rendering: {
          component: "server",
          html: "server",
          streaming: false,
          hydrate: "none",
        },
        path: "/__proto__",
        routeId: "__proto__",
      },
    ],
  ]);
  output.routes = [
    {
      id: "__proto__",
      path: "/__proto__",
      pageId: "__proto__",
    },
  ];
  return output;
}
