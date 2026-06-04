import type { BuildOutput } from "@evjs/shared/manifest";
import { describe, expect, it } from "vitest";
import {
  createDeploymentArtifact,
  createEdgeDeploymentFiles,
  createNodeDeploymentFiles,
  createStaticDeploymentFiles,
} from "../src/deployment.js";

describe("createDeploymentArtifact", () => {
  it("creates a platform-neutral deployment artifact from BuildOutput", () => {
    const output: BuildOutput = {
      version: 1,
      buildId: "build-1",
      distDir: "dist",
      publicPath: { mode: "runtime" },
      runtime: {
        server: {
          basePath: "/framework",
          fn: "/framework/fn",
          ppr: "/framework/ppr",
          rsc: "/framework/rsc",
        },
      },
      assets: {
        main: { js: ["main.js"], css: ["main.css"] },
      },
      apps: {
        default: {
          assets: { js: ["main.js"], css: ["main.css"] },
          entry: "./src/main.tsx",
          mount: "#app",
        },
      },
      pages: {
        insights: {
          assets: { js: [], css: [] },
          render: "rsc",
          rendering: {
            mode: "rsc",
            component: "rsc",
            html: "server",
            streaming: true,
            hydrate: "load",
          },
          path: "/insights",
          routeId: "insights",
          component: "./src/pages/Insights.tsx",
          hydrate: "none",
          mount: "#app",
        },
      },
      routes: [
        {
          id: "insights",
          path: "/insights",
          pageId: "insights",
          render: "rsc",
        },
      ],
      server: {
        entry: "server.js",
        assets: { js: ["server.js"], css: [] },
        renderers: {
          "insights-rsc": {
            kind: "rsc-page",
            module: "./src/pages/Insights.tsx",
            assets: { js: ["insights-rsc.js"], css: [] },
          },
        },
        functions: {
          search: {
            module: "src/actions.ts",
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
      remotes: {
        crm: {
          manifest: "https://assets.example.com/crm/evjs-remote.json",
          activeWhen: ["/crm/*"],
        },
      },
      rsc: {
        endpoint: "/framework/rsc",
        pages: {
          insights: {
            renderer: "insights-rsc",
            assets: { js: ["insights-rsc.js"], css: [] },
          },
        },
        clientReferences: {
          "src/Client.tsx#default": {
            module: "src/Client.tsx",
            exportName: "default",
          },
        },
        serverReferences: {
          ref: {
            module: "src/actions.ts",
            exportName: "search",
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
      distDir: "dist",
      publicPath: { mode: "runtime" },
      runtime: output.runtime,
      apps: {
        default: {
          entry: "./src/main.tsx",
          routes: undefined,
          mount: "#app",
        },
      },
      pages: {
        insights: {
          path: "/insights",
          routeId: "insights",
          render: "rsc",
          hydrate: "none",
          mount: "#app",
        },
      },
      routes: [
        {
          id: "insights",
          path: "/insights",
          appId: undefined,
          pageId: "insights",
          render: "rsc",
          runtime: undefined,
        },
      ],
      server: {
        entry: "server.js",
        basePath: "/framework",
        fn: "/framework/fn",
        ppr: "/framework/ppr",
        rsc: "/framework/rsc",
        renderers: ["insights-rsc"],
        functions: ["search"],
        routes: [
          {
            path: "/api/webhooks/payment",
            methods: ["POST"],
          },
        ],
      },
      remotes: output.remotes,
      rsc: {
        endpoint: "/framework/rsc",
        pages: ["insights"],
        clientReferences: ["src/Client.tsx#default"],
        serverReferences: ["ref"],
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
      distDir: "dist",
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
          entry: "./src/main.tsx",
        },
      },
      pages: {
        insights: {
          assets: { js: [], css: [] },
          render: "rsc",
          rendering: {
            mode: "rsc",
            component: "rsc",
            html: "server",
            streaming: true,
            hydrate: "load",
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
          render: "rsc",
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
      'import serverHandler from "./server/server.js";',
    );
    expect(files.serverModule).toContain(
      'const frameworkBasePath = "/framework";',
    );
    expect(files.serverModule).toContain('"/api/health"');
    expect(files.serverModule).toContain('"/insights/:id"');
    expect(files.serverModule).toContain('from "@evjs/server/node"');
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
      distDir: "dist",
      publicPath: "/",
      runtime: {},
      assets: {},
      apps: {
        default: {
          assets: { js: ["main.js"], css: [] },
          entry: "./src/main.tsx",
        },
      },
      pages: {
        pricing: {
          assets: { js: [], css: [] },
          render: "ssg",
          rendering: {
            mode: "ssg",
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
          render: "csr",
        },
        {
          id: "pricing",
          path: "/pricing",
          pageId: "pricing",
          render: "ssg",
        },
      ],
    };

    const files = createStaticDeploymentFiles(output, {
      includeAssets: false,
    });

    expect(files.artifactFileName).toBe("deployment.static.json");
    expect(files.redirectsFileName).toBe("_redirects");
    expect(files.artifact.platform).toBe("static");
    expect(files.redirects).toBe(
      [
        "/orders/:orderId /index.html 200",
        "/pricing /pricing.html 200",
        "/* /index.html 200",
        "",
      ].join("\n"),
    );
  });

  it("creates Edge deployment files from BuildOutput", () => {
    const output: BuildOutput = {
      version: 1,
      buildId: "build-1",
      distDir: "dist",
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
          entry: "./src/main.tsx",
        },
      },
      pages: {
        insights: {
          assets: { js: [], css: [] },
          render: "rsc",
          rendering: {
            mode: "rsc",
            component: "rsc",
            html: "server",
            streaming: true,
            hydrate: "load",
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
          render: "rsc",
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
      'import serverHandler from "./server/server.js";',
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
});
