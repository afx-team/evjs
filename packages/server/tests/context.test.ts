import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app/app.js";
import type {
  FrameworkPageRuntime,
  FrameworkRouteRuntime,
  FrameworkRuntime,
} from "../src/framework-rendering/framework.js";
import {
  deleteCookie,
  getContext,
  getCookie,
  headers,
  request,
  setCookie,
  waitUntil,
} from "../src/request-context/context.js";
import { createRoute } from "../src/routes/index.js";
import {
  registerServerReference,
  registry,
} from "../src/server-functions/register.js";

type LegacyFrameworkRuntime = FrameworkRuntime & {
  pages: Record<string, FrameworkPageRuntime>;
  routes: FrameworkRouteRuntime[];
};

describe("Server Request Context", () => {
  beforeEach(() => {
    registry.clear();
  });

  it("should throw when used outside a request lifecycle", () => {
    const message = [
      "[evjs] Server context helpers (request(), headers(), cookie helpers, waitUntil()) must be called during a request lifecycle.",
      "Call them inside a server function, route handler, middleware, or framework render.",
    ].join(" ");

    expect(() => getContext()).toThrow(message);
    expect(() => request()).toThrow(message);
    expect(() => headers()).toThrow(message);
    expect(() => getCookie()).toThrow(message);
    expect(() => waitUntil(Promise.resolve())).toThrow(message);
  });

  it("should provide context inside a server function", async () => {
    // 1. Create a server function that uses the context
    async function myServerFn() {
      const req = request();
      const hdrs = headers();
      const ctx = getContext();

      expect(req).toBe(ctx.req.raw);

      waitUntil(new Promise((resolve) => setTimeout(resolve, 0)));
      setCookie("newcookie", "tasty", { maxAge: 1000 });
      deleteCookie("oldcookie");

      // Return a value derived from headers and cookies to verify it works
      return {
        hdr: hdrs.get("x-custom-test"),
        cookie: getCookie("testcookie"),
      };
    }

    // 2. Register it so dispatch() can find it
    registerServerReference(myServerFn, "myServerFn");

    // 3. Create the app and perform a test request
    const app = createApp();

    const reqbody = JSON.stringify({ fnId: "myServerFn", args: [] });
    const response = await app.request("/__evjs/fn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-custom-test": "it-works",
        cookie: "testcookie=yummy; othercookie=chocolate",
      },
      body: reqbody,
    });

    // Check outgoing cookies
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^newcookie=tasty; Max-Age=1000/),
        expect.stringMatching(/^oldcookie=; Max-Age=0/),
      ]),
    );

    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      result: { hdr: string; cookie: string };
    };
    expect(json.result.hdr).toBe("it-works");
    expect(json.result.cookie).toBe("yummy");
  });

  it("reports invalid waitUntil tasks with a framework error", async () => {
    registerServerReference(() => {
      waitUntil("not-a-promise" as never);
    }, "invalidWaitUntil");
    const app = createApp();

    const response = await app.request("/__evjs/fn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "invalidWaitUntil", args: [] }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "[evjs] waitUntil() requires a Promise.",
      fnId: "invalidWaitUntil",
      status: 500,
    });
  });

  it("should provide context inside middleware, route handlers, and framework render", async () => {
    const observed: string[] = [];
    const route = createRoute("/api/context", {
      GET() {
        observed.push(`route:${headers().get("x-context-test")}`);
        return Response.json({
          header: headers().get("x-context-test"),
          path: new URL(request().url).pathname,
        });
      },
    });
    const app = createApp({
      middlewares: [
        async (_c, next) => {
          observed.push(`middleware-before:${headers().get("x-context-test")}`);
          await next();
          observed.push(`middleware-after:${headers().get("x-context-test")}`);
        },
      ],
      routes: [route],
      framework: {
        runtime: createFrameworkManifest(),
        render(ctx) {
          observed.push(
            `framework-render:${headers().get("x-context-test")}:${ctx.pageId}`,
          );
          return Response.json({
            header: headers().get("x-context-test"),
            path: new URL(request().url).pathname,
          });
        },
      },
    });

    const routeResponse = await app.request("/api/context", {
      headers: { "x-context-test": "route" },
    });
    const renderResponse = await app.request("/dashboard", {
      headers: { "x-context-test": "render" },
    });

    expect(routeResponse.status).toBe(200);
    expect(await routeResponse.json()).toEqual({
      header: "route",
      path: "/api/context",
    });
    expect(renderResponse.status).toBe(200);
    expect(await renderResponse.json()).toEqual({
      header: "render",
      path: "/dashboard",
    });
    expect(observed).toEqual([
      "middleware-before:route",
      "route:route",
      "middleware-after:route",
      "middleware-before:render",
      "framework-render:render:dashboard",
      "middleware-after:render",
    ]);
  });

  it("should provide context inside PPR and RSC framework handlers", async () => {
    const observed: string[] = [];
    const pprManifest = createFrameworkManifest();
    configurePprManifest(pprManifest);
    const pprApp = createApp({
      framework: {
        runtime: pprManifest,
        render(ctx) {
          if (ctx.regionId) {
            observed.push(`ppr-region:${headers().get("x-context-test")}`);
            return `<p>${headers().get("x-context-test")}</p>`;
          }
          observed.push(`ppr-shell:${headers().get("x-context-test")}`);
          return '<main><div data-evjs-ppr-region="hero">fallback</div></main>';
        },
      },
    });

    const pprResponse = await pprApp.request("/dashboard", {
      headers: { "x-context-test": "ppr" },
    });

    const rscManifest = createFrameworkManifest();
    configureRscManifest(rscManifest);
    const rscApp = createApp({
      framework: {
        runtime: rscManifest,
        rsc(ctx) {
          observed.push(
            `rsc-flight:${headers().get("x-context-test")}:${ctx.pageId}`,
          );
          return new Response(headers().get("x-context-test"), {
            headers: { "Content-Type": "text/x-component" },
          });
        },
      },
    });

    const rscResponse = await rscApp.request("/__evjs/rsc?page=dashboard", {
      headers: { "x-context-test": "rsc" },
    });

    expect(pprResponse.status).toBe(200);
    expect(await pprResponse.text()).toBe("<main><p>ppr</p></main>");
    expect(rscResponse.status).toBe(200);
    expect(rscResponse.headers.get("Content-Type")).toBe("text/x-component");
    expect(await rscResponse.text()).toBe("rsc");
    expect(observed).toEqual([
      "ppr-shell:ppr",
      "ppr-region:ppr",
      "rsc-flight:rsc:dashboard",
    ]);
  });
});

function createFrameworkManifest(): LegacyFrameworkRuntime {
  return {
    version: 1,
    buildId: "test",
    publicPath: "/",
    runtime: {
      server: {
        basePath: "/__evjs",
        fn: "__evjs/fn",
        rsc: "__evjs/rsc",
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
      },
    },
    routes: [
      {
        id: "dashboard",
        path: "/dashboard",
        pageId: "dashboard",
      },
    ],
    server: {
      renderers: {
        "dashboard-server": {
          kind: "page-server",
          owner: { pageId: "dashboard" },
          assets: { js: ["dashboard-server.js"], css: [] },
        },
      },
    },
  };
}

function configurePprManifest(manifest: LegacyFrameworkRuntime): void {
  manifest.pages.dashboard.ppr = {
    delivery: "merge",
    shell: { js: ["dashboard-ppr-shell.js"], css: [] },
    regions: {
      hero: {
        id: "hero",
        assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
      },
    },
  };
  manifest.pages.dashboard.rendering = {
    component: "server",
    html: "partial",
    prerender: "partial",
    streaming: false,
    hydrate: "none",
  };
}

function configureRscManifest(manifest: LegacyFrameworkRuntime): void {
  manifest.pages.dashboard.componentModel = "rsc";
  manifest.pages.dashboard.rendering = {
    component: "rsc",
    html: "server",
    streaming: true,
    hydrate: "none",
  };
  manifest.rsc = {
    pages: {
      dashboard: {
        renderer: "dashboard-rsc",
        assets: { js: ["dashboard-rsc.js"], css: [] },
      },
    },
  };
  if (!manifest.server) {
    throw new Error("Expected server manifest");
  }
  const renderers = manifest.server.renderers;
  if (!renderers) {
    throw new Error("Expected server renderers manifest");
  }
  renderers["dashboard-rsc"] = {
    kind: "rsc-page",
    owner: { pageId: "dashboard" },
    assets: { js: ["dashboard-rsc.js"], css: [] },
  };
}
