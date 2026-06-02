import type { BuildOutput } from "@evjs/shared/manifest";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  createReactRscFlightAdapter,
  createReactServerRenderAdapter,
} from "../src/react-renderer.js";

describe("createReactServerRenderAdapter", () => {
  it("renders a default React component module into an HTML document", async () => {
    const adapter = createReactServerRenderAdapter();
    const result = await adapter(
      {
        default({ pageId }: { pageId?: string }) {
          return createElement("h1", null, "Page ", pageId);
        },
      },
      {
        request: new Request("https://example.com/dashboard"),
        manifest: createManifest(),
        pageId: "dashboard",
        page: {
          assets: { js: ["dashboard.js"], css: ["dashboard.css"] },
          render: "ssr",
          mount: "#root",
        },
      },
    );

    expect(result).toEqual({
      html: [
        "<!doctype html>",
        '<html data-evjs-kind="page" data-evjs-id="dashboard" data-evjs-page="dashboard" data-evjs-build="test">',
        "<head>",
        '<link rel="stylesheet" href="/assets/dashboard.css">',
        "</head>",
        "<body>",
        '<div id="root"><h1>Page <!-- -->dashboard</h1></div>',
        '<script type="module" src="/assets/dashboard.js"></script>',
        "</body>",
        "</html>",
      ].join(""),
    });
  });

  it("returns undefined for non-component modules", async () => {
    const adapter = createReactServerRenderAdapter();

    await expect(
      adapter(
        { value: "not a component" },
        {
          request: new Request("https://example.com/dashboard"),
          manifest: createManifest(),
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("supports custom props and document rendering", async () => {
    const adapter = createReactServerRenderAdapter({
      createProps(ctx) {
        return { title: ctx.pageId?.toUpperCase() };
      },
      renderDocument(appHtml) {
        return {
          html: `<main>${appHtml}</main>`,
          headers: { "x-render": "custom" },
        };
      },
    });

    const result = await adapter(
      {
        default({ title }: { title?: string }) {
          return createElement("h1", null, title);
        },
      },
      {
        request: new Request("https://example.com/dashboard"),
        manifest: createManifest(),
        pageId: "dashboard",
      },
    );

    expect(result).toEqual({
      html: "<main><h1>DASHBOARD</h1></main>",
      headers: { "x-render": "custom" },
    });
  });
});

describe("createReactRscFlightAdapter", () => {
  it("returns the matched RSC page renderer Flight response", async () => {
    const manifest = createManifest();
    manifest.runtime.server = {
      basePath: "/__evjs",
      fn: "/__evjs/fn",
      rsc: "/__evjs/rsc",
    };
    manifest.pages.dashboard = {
      assets: { js: [], css: [] },
      render: "rsc",
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
    manifest.rsc = {
      endpoint: "/__evjs/rsc",
      pages: {
        dashboard: {
          renderer: "dashboard-rsc",
          assets: { js: ["dashboard-rsc.js"], css: [] },
        },
      },
      clientReferences: {
        "src/Client.tsx#default": {
          module: "src/Client.tsx",
          exportName: "default",
        },
      },
    };

    const adapter = createReactRscFlightAdapter({
      async loadModule(asset) {
        expect(asset).toBe("dashboard-rsc.js");
        return {
          renderFlight(ctx: { pageId?: string }) {
            return new Response(`flight:${ctx.pageId}`, {
              headers: {
                "Content-Type": "text/x-component; charset=utf-8",
              },
            });
          },
        };
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      manifest,
      pageId: "dashboard",
      page: manifest.pages.dashboard,
      rscPage: manifest.rsc.pages?.dashboard,
      renderer: manifest.server.renderers?.["dashboard-rsc"],
    });

    expect(response.headers.get("Content-Type")).toContain("text/x-component");
    await expect(response.text()).resolves.toBe("flight:dashboard");
  });

  it("does not pretend JSON debug payloads are React Flight", async () => {
    const manifest = createManifest();
    manifest.runtime.server = {
      basePath: "/__evjs",
      fn: "/__evjs/fn",
      rsc: "/__evjs/rsc",
    };

    const adapter = createReactRscFlightAdapter();

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      manifest,
      pageId: "dashboard",
    });

    expect(response.status).toBe(501);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    await expect(response.text()).resolves.toContain(
      "RSC Flight renderer is not configured",
    );
  });

  it("rejects successful non-Flight responses from custom renderers", async () => {
    const manifest = createManifest();
    manifest.runtime.server = {
      basePath: "/__evjs",
      fn: "/__evjs/fn",
      rsc: "/__evjs/rsc",
    };
    const adapter = createReactRscFlightAdapter({
      renderFlight() {
        return Response.json({ ok: true });
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      manifest,
      pageId: "dashboard",
    });

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain("invalid Content-Type");
  });

  it("reports renderer exceptions through onError", async () => {
    const manifest = createManifest();
    const error = new Error("flight failed");
    const caught: unknown[] = [];
    const adapter = createReactRscFlightAdapter({
      onError(err) {
        caught.push(err);
      },
      renderFlight() {
        throw error;
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      manifest,
      pageId: "dashboard",
    });

    expect(response.status).toBe(500);
    expect(caught).toEqual([error]);
    await expect(response.text()).resolves.toContain("flight failed");
  });
});

function createManifest(): BuildOutput {
  return {
    version: 1,
    buildId: "test",
    distDir: "dist",
    publicPath: "/assets/",
    runtime: {},
    assets: {},
    apps: {},
    pages: {},
    routes: [],
  };
}
