import type { BuildOutput } from "@evjs/shared/manifest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { ServerRenderContext } from "../src/framework.js";
import {
  createManifestRenderCoordinator,
  createModuleRenderCoordinator,
} from "../src/framework.js";
import {
  registerServerReference,
  registry,
} from "../src/functions/register.js";
import { createReactFrameworkServer } from "../src/react.js";

describe("createApp", () => {
  beforeEach(() => {
    registry.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the build-time endpoint define by default", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    registerServerReference(async () => "ok", "fn1");

    const app = createApp();
    const res = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "fn1", args: [] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "ok" });
  });

  it("routes framework page requests through the server render coordinator", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        manifest,
        render(ctx) {
          return `<h1>${ctx.pageId}:${ctx.page?.render}</h1>`;
        },
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toBe("<h1>dashboard:ssr</h1>");
  });

  it("matches page renderers for RSC page document requests", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.render = "rsc";
    const app = createApp({
      framework: {
        manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-server": {
              kind: "page-server",
              owner: { pageId: "dashboard" },
              load: async () => ({
                render(ctx: ServerRenderContext) {
                  return `<h1>${ctx.pageId}:${ctx.page?.render}</h1>`;
                },
              }),
            },
          },
        }),
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>dashboard:rsc</h1>");
  });

  it("matches dynamic manifest routes for framework rendering", async () => {
    const manifest = createManifest();
    manifest.pages.orderDetail = {
      assets: { js: [], css: [] },
      render: "ssr",
      rendering: {
        mode: "ssr",
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
    };
    manifest.routes.push({
      id: "order.detail",
      path: "/orders/$orderId",
      pageId: "orderDetail",
    });
    const app = createApp({
      framework: {
        manifest,
        render(ctx) {
          return `<h1>${ctx.route?.id}:${ctx.pageId}</h1>`;
        },
      },
    });

    const res = await app.request("/orders/123");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>order.detail:orderDetail</h1>");
  });

  it("accepts a server render coordinator", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        manifest,
        render: {
          match(ctx) {
            if (ctx.pageId !== "dashboard") return undefined;
            return ctx;
          },
          render(ctx) {
            return {
              html: `<h1>${ctx.route?.path}</h1>`,
              headers: { "x-evjs-render": "coordinator" },
            };
          },
        },
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-evjs-render")).toBe("coordinator");
    expect(await res.text()).toBe("<h1>/dashboard</h1>");
  });

  it("loads framework render modules from explicit renderer entries", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-server": {
              kind: "page-server",
              owner: { pageId: "dashboard" },
              load: async () => ({
                render(ctx: ServerRenderContext) {
                  return {
                    html: `<h1>${ctx.pageId}:${ctx.route?.id}</h1>`,
                    headers: { "x-evjs-renderer": "dashboard-server" },
                  };
                },
              }),
            },
          },
        }),
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-evjs-renderer")).toBe("dashboard-server");
    expect(await res.text()).toBe("<h1>dashboard:dashboard</h1>");
  });

  it("uses the PPR shell renderer for PPR pages", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.render = "ppr";
    manifest.pages.dashboard.ppr = {
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          component: "./src/pages/Hero.region.tsx",
        },
      },
    };
    const app = createApp({
      framework: {
        manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-ppr-shell": {
              kind: "ppr-shell",
              owner: { pageId: "dashboard" },
              load: async () => ({
                default(ctx: ServerRenderContext) {
                  return `<main><h1>${ctx.page?.render}:${ctx.pageId}</h1><div data-evjs-ppr-region="hero">fallback</div></main>`;
                },
              }),
            },
            "dashboard-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: (ctx: ServerRenderContext) =>
                  `<p>${ctx.pageId}:${ctx.regionId}</p>`,
              }),
            },
          },
        }),
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-evjs-ppr")).toBe("merged");
    expect(await res.text()).toBe(
      "<main><h1>ppr:dashboard</h1><p>dashboard:hero</p></main>",
    );

    const region = await app.request("/__evjs/ppr/dashboard/hero");

    expect(region.status).toBe(200);
    expect(await region.text()).toBe("<p>dashboard:hero</p>");
  });

  it("normalizes PPR region document responses into fragments", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.render = "ppr";
    manifest.pages.dashboard.ppr = {
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          component: "./src/pages/Hero.region.tsx",
          cache: "no-store",
        },
      },
    };
    const app = createApp({
      framework: {
        manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-hero-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () => ({
                  html: [
                    "<!doctype html>",
                    "<html><body>",
                    '<div id="app"><section><div>Hero fragment</div></section></div>',
                    '<script src="/region.js"></script>',
                    "</body></html>",
                  ].join(""),
                }),
              }),
            },
          },
        }),
      },
    });

    const region = await app.request("/__evjs/ppr/dashboard/hero");

    expect(region.status).toBe(200);
    expect(region.headers.get("x-evjs-page")).toBe("dashboard");
    expect(region.headers.get("x-evjs-ppr-region")).toBe("hero");
    expect(await region.text()).toBe(
      "<section><div>Hero fragment</div></section>",
    );
  });

  it("caches PPR regions with revalidate policy", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.render = "ppr";
    manifest.pages.dashboard.ppr = {
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        inventory: {
          id: "inventory",
          assets: { js: ["dashboard-inventory-ppr-region.js"], css: [] },
          component: "./src/pages/Inventory.region.tsx",
          cache: { revalidate: 60 },
        },
      },
    };
    let renderCount = 0;
    const app = createApp({
      framework: {
        manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-inventory-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "inventory" },
              load: async () => ({
                default: () => `<p>${++renderCount}</p>`,
              }),
            },
          },
        }),
      },
    });

    const first = await app.request("/__evjs/ppr/dashboard/inventory");
    const second = await app.request("/__evjs/ppr/dashboard/inventory");

    expect(first.headers.get("Cache-Control")).toBe("s-maxage=60");
    expect(first.headers.get("x-evjs-cache")).toBe("MISS");
    expect(await first.text()).toBe("<p>1</p>");
    expect(second.headers.get("x-evjs-cache")).toBe("HIT");
    expect(await second.text()).toBe("<p>1</p>");
    expect(renderCount).toBe(1);
  });

  it("does not cache no-store PPR regions", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.render = "ppr";
    manifest.pages.dashboard.ppr = {
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          component: "./src/pages/Hero.region.tsx",
          cache: "no-store",
        },
      },
    };
    let renderCount = 0;
    const app = createApp({
      framework: {
        manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-hero-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () => `<p>${++renderCount}</p>`,
              }),
            },
          },
        }),
      },
    });

    const first = await app.request("/__evjs/ppr/dashboard/hero");
    const second = await app.request("/__evjs/ppr/dashboard/hero");

    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(await first.text()).toBe("<p>1</p>");
    expect(await second.text()).toBe("<p>2</p>");
    expect(renderCount).toBe(2);
  });

  it("reports renderer modules that are not server render handlers", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-server": {
              kind: "page-server",
              owner: { pageId: "dashboard" },
              load: async () => ({ default: "not-callable" }),
            },
          },
        }),
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(501);
    expect(await res.text()).toContain(
      'Server renderer "dashboard-server" must export render(ctx) or default(ctx)',
    );
  });

  it("loads renderer modules from manifest assets", async () => {
    const manifest = createManifest();
    manifest.server = {
      entry: "server.js",
      assets: { js: ["server.js"], css: [] },
      renderers: {
        "dashboard-server": {
          kind: "page-server",
          owner: { pageId: "dashboard" },
          module: "./src/pages/Dashboard.tsx",
          assets: { js: ["dashboard-server.js"], css: [] },
        },
      },
      functions: {},
      routes: [],
    };
    const app = createApp({
      framework: {
        manifest,
        render: createManifestRenderCoordinator({
          manifest,
          async loadModule(asset) {
            expect(asset).toBe("dashboard-server.js");
            return {
              render(ctx: ServerRenderContext) {
                return `<h1>${ctx.pageId}:manifest</h1>`;
              },
            };
          },
        }),
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>dashboard:manifest</h1>");
  });

  it("creates an explicit React framework server from runtime manifest globals", async () => {
    const manifest = createManifest();
    manifest.server = {
      entry: "server.js",
      assets: { js: ["server.js"], css: [] },
      renderers: {
        "dashboard-server": {
          kind: "page-server",
          owner: { pageId: "dashboard" },
          module: "./src/pages/Dashboard.tsx",
          assets: { js: ["dashboard-server.js"], css: [] },
        },
      },
      functions: {},
      routes: [],
    };
    vi.stubGlobal("__EVJS_MANIFEST__", manifest);
    vi.stubGlobal("__EVJS_SERVER_MODULE_LOADER__", async (asset: string) => {
      expect(asset).toBe("dashboard-server.js");
      return {
        default({ pageId }: { pageId?: string }) {
          return `Page ${pageId}`;
        },
      };
    });

    const framework = createReactFrameworkServer();
    if (!framework) throw new Error("Expected framework options");
    const app = createApp({ framework });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="app">Page dashboard</div>');
  });

  it("can restrict React framework page rendering to dev proxy requests", async () => {
    const manifest = createManifest();
    manifest.server = {
      entry: "server.js",
      assets: { js: ["server.js"], css: [] },
      renderers: {
        "dashboard-server": {
          kind: "page-server",
          owner: { pageId: "dashboard" },
          module: "./src/pages/Dashboard.tsx",
          assets: { js: ["dashboard-server.js"], css: [] },
        },
      },
      functions: {},
      routes: [],
    };
    vi.stubGlobal("__EVJS_MANIFEST__", manifest);
    vi.stubGlobal(
      "__EVJS_DEV_PAGE_RENDER_PROXY_HEADER__",
      "x-evjs-dev-page-render",
    );
    vi.stubGlobal("__EVJS_SERVER_MODULE_LOADER__", async () => ({
      default({ pageId }: { pageId?: string }) {
        return `Page ${pageId}`;
      },
    }));

    const framework = createReactFrameworkServer();
    if (!framework) throw new Error("Expected framework options");
    const app = createApp({ framework });

    const direct = await app.request("/dashboard");
    const proxied = await app.request("/dashboard", {
      headers: { "x-evjs-dev-page-render": "1" },
    });

    expect(direct.status).toBe(404);
    expect(proxied.status).toBe(200);
    expect(await proxied.text()).toContain(
      '<div id="app">Page dashboard</div>',
    );
  });

  it("mounts RSC flight handling on the framework server path", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        manifest,
        rsc() {
          return new Response("flight", {
            headers: { "Content-Type": "text/x-component" },
          });
        },
      },
    });

    const res = await app.request("/__evjs/rsc?page=dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/x-component");
    expect(await res.text()).toBe("flight");
  });

  it("accepts an RSC coordinator", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        manifest,
        rsc: {
          match(ctx) {
            return new URL(ctx.request.url).searchParams.get("flight") === "1";
          },
          renderFlight() {
            return new Response("coordinator-flight", {
              headers: { "Content-Type": "text/x-component" },
            });
          },
        },
      },
    });

    const skipped = await app.request("/__evjs/rsc?page=dashboard");
    const matched = await app.request("/__evjs/rsc?page=dashboard&flight=1");

    expect(skipped.status).toBe(404);
    expect(matched.status).toBe(200);
    expect(await matched.text()).toBe("coordinator-flight");
  });

  it("returns explicit RSC request validation errors", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        manifest,
        rsc() {
          return new Response("flight", {
            headers: { "Content-Type": "text/x-component" },
          });
        },
      },
    });

    const missingPage = await app.request("/__evjs/rsc");
    expect(missingPage.status).toBe(400);
    await expect(missingPage.text()).resolves.toContain(
      "missing the page query parameter",
    );

    const unknownPage = await app.request("/__evjs/rsc?page=unknown");
    expect(unknownPage.status).toBe(404);
    await expect(unknownPage.text()).resolves.toContain(
      'RSC page "unknown" is not in the manifest',
    );

    manifest.pages.dashboard.render = "ssr";
    const nonRscPage = await app.request("/__evjs/rsc?page=dashboard");
    expect(nonRscPage.status).toBe(404);
    await expect(nonRscPage.text()).resolves.toContain(
      'not configured with render: "rsc"',
    );
  });

  it("creates a default RSC coordinator from a React framework manifest", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.render = "rsc";
    manifest.rsc = {
      endpoint: "/__evjs/rsc",
      pages: {
        dashboard: {
          renderer: "dashboard-rsc",
          assets: { js: ["dashboard-rsc.js"], css: [] },
          component: "./src/pages/Dashboard.tsx",
        },
      },
    };
    manifest.server = {
      assets: { js: ["server.js"], css: [] },
      functions: {},
      routes: [],
      renderers: {
        "dashboard-rsc": {
          kind: "rsc-page",
          module: "./src/pages/Dashboard.tsx",
          assets: { js: ["dashboard-rsc.js"], css: [] },
        },
      },
    };
    vi.stubGlobal("__EVJS_MANIFEST__", manifest);
    vi.stubGlobal("__EVJS_SERVER_MODULE_LOADER__", async () => ({
      renderFlight(ctx: { pageId?: string }) {
        return new Response(`flight:${ctx.pageId}`, {
          headers: {
            "Content-Type": "text/x-component; charset=utf-8",
          },
        });
      },
    }));

    const framework = createReactFrameworkServer();
    if (!framework) throw new Error("Expected framework options");
    const app = createApp({ framework });

    const res = await app.request("/__evjs/rsc?page=dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/x-component");
    await expect(res.text()).resolves.toBe("flight:dashboard");
  });
});

function createManifest(): BuildOutput {
  return {
    version: 1,
    buildId: "test",
    distDir: "dist",
    publicPath: "/",
    runtime: {
      server: {
        basePath: "/__evjs",
        fn: "/__evjs/fn",
        rsc: "/__evjs/rsc",
      },
    },
    assets: {},
    apps: {},
    pages: {
      dashboard: {
        assets: { js: [], css: [] },
        render: "ssr",
        rendering: {
          mode: "ssr",
          component: "server",
          html: "server",
          streaming: false,
          hydrate: "load",
        },
      },
    },
    routes: [
      {
        id: "dashboard",
        path: "/dashboard",
        pageId: "dashboard",
      },
    ],
  };
}

function configureRscManifest(manifest: BuildOutput): void {
  manifest.pages.dashboard.render = "rsc";
  manifest.pages.dashboard.rendering = {
    mode: "rsc",
    component: "rsc",
    html: "server",
    streaming: true,
    hydrate: "load",
  };
  manifest.rsc = {
    endpoint: "/__evjs/rsc",
    pages: {
      dashboard: {
        renderer: "dashboard-rsc",
        assets: { js: ["dashboard-rsc.js"], css: [] },
      },
    },
  };
  manifest.server = {
    assets: { js: ["server.js"], css: [] },
    functions: {},
    routes: [],
    renderers: {
      "dashboard-rsc": {
        kind: "rsc-page",
        module: "./src/pages/Dashboard.tsx",
        assets: { js: ["dashboard-rsc.js"], css: [] },
      },
    },
  };
}
