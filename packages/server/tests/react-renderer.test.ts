import { usePageParams, usePageSearch } from "@evjs/client";
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
          rendering: {
            component: "server",
            html: "server",
            streaming: false,
            hydrate: "load",
          },
          mount: "#root",
        },
      },
    );

    expect(result).toEqual({
      html: [
        "<!doctype html>",
        '<html data-evjs-kind="page" data-evjs-id="dashboard" data-evjs-build="test">',
        "<head>",
        '<link rel="stylesheet" href="/assets/dashboard.css">',
        "</head>",
        "<body>",
        '<div id="root"><h1>Page <!-- -->dashboard</h1></div>',
        '<script id="__EVJS_PAGE_PROPS__" type="application/json">',
        '{"manifest":{"buildId":"test"},"pageId":"dashboard"}',
        "</script>",
        '<script defer src="/assets/dashboard.js"></script>',
        "</body>",
        "</html>",
      ].join(""),
    });
  });

  it("does not embed framework manifest internals in default hydration props", async () => {
    const adapter = createReactServerRenderAdapter();
    const manifest = createManifest();
    manifest.pages.dashboard = {
      assets: { js: ["dashboard.js"], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
      component: "./src/pages/Dashboard.tsx",
    };
    manifest.routes.push({
      id: "dashboard",
      path: "/dashboard",
      pageId: "dashboard",
      module: "./src/pages/Dashboard.tsx",
    });

    const result = await adapter(
      {
        default() {
          return createElement("h1", null, "Dashboard");
        },
      },
      {
        request: new Request("https://example.com/dashboard"),
        manifest,
        pageId: "dashboard",
        page: manifest.pages.dashboard,
        route: manifest.routes[0],
      },
    );

    if (!result || result instanceof Response || typeof result === "string") {
      throw new Error("Expected HTML result.");
    }

    expect(result.html).toContain(
      '<script id="__EVJS_PAGE_PROPS__" type="application/json">{"manifest":{"buildId":"test"},"route":{"id":"dashboard","path":"/dashboard"},"pageId":"dashboard"}</script>',
    );
    expect(result.html).not.toContain("Dashboard.tsx");
    expect(result.html).not.toContain('"assets"');
    expect(result.html).not.toContain('"pages"');
    expect(result.html).not.toContain('"routes"');
  });

  it("provides route params and search to page hooks during server render", async () => {
    const adapter = createReactServerRenderAdapter();
    const manifest = createManifest();
    manifest.pages.post = {
      assets: { js: ["post.js"], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
      component: "./src/pages/posts/$postId.tsx",
    };
    manifest.routes.push({
      id: "post",
      path: "/posts/$postId",
      pageId: "post",
      module: "./src/pages/posts/$postId.tsx",
    });
    let renderedProps: Record<string, unknown> | undefined;
    function PostPage(props: Record<string, unknown>) {
      renderedProps = props;
      const { postId } = usePageParams<{ postId: string }>();
      const search = usePageSearch<{ tab?: string; tag?: string[] }>();
      return createElement(
        "h1",
        null,
        `${postId}:${search.tab}:${search.tag?.join(",")}`,
      );
    }

    const result = await adapter(
      {
        default: PostPage,
      },
      {
        request: new Request(
          "https://example.com/posts/42?tab=comments&tag=a&tag=b",
        ),
        manifest,
        pageId: "post",
        page: manifest.pages.post,
        route: manifest.routes[0],
      },
    );

    if (!result || result instanceof Response || typeof result === "string") {
      throw new Error("Expected HTML result.");
    }

    expect(result.html).toContain("<h1>42:comments:a,b</h1>");
    expect(renderedProps).toEqual({
      manifest: { buildId: "test" },
      route: { id: "post", path: "/posts/$postId" },
      pageId: "post",
    });
  });

  it("keeps custom props but hides route data props during server render", async () => {
    const adapter = createReactServerRenderAdapter({
      createProps() {
        return {
          title: "Post",
          params: { postId: "42" },
          search: { tab: "comments" },
          loaderData: { title: "Hello" },
        };
      },
      renderDocument(appHtml) {
        return { html: appHtml };
      },
    });
    let renderedProps: Record<string, unknown> | undefined;
    function CustomPostPage(props: Record<string, unknown>) {
      renderedProps = props;
      const { postId } = usePageParams<{ postId: string }>();
      const search = usePageSearch<{ tab?: string }>();
      return createElement(
        "h1",
        null,
        `${props.title}:${postId}:${search.tab}`,
      );
    }

    const result = await adapter(
      {
        default: CustomPostPage,
      },
      {
        request: new Request("https://example.com/posts/42?tab=ignored"),
        manifest: createManifest(),
        pageId: "post",
      },
    );

    expect(result).toEqual({ html: "<h1>Post:42:comments</h1>" });
    expect(renderedProps).toEqual({ title: "Post" });
  });

  it("injects RSC client runtime assets and a public bootstrap payload", async () => {
    const adapter = createReactServerRenderAdapter();
    const manifest = createManifest();
    manifest.runtime.server = {
      basePath: "/__evjs",
      fn: "/__evjs/fn",
      rsc: "/__evjs/rsc",
    };
    manifest.rsc = {
      endpoint: "/__evjs/rsc",
      pages: {
        insights: {
          renderer: "insights-rsc",
          assets: { js: ["insights-rsc.js"], css: [] },
          component: "./src/pages/Insights.tsx",
        },
      },
    };
    manifest.pages.insights = {
      assets: { js: ["evjs-rsc-client.js"], css: ["insights.css"] },
      render: "ssr",
      componentModel: "rsc",
      rendering: {
        component: "rsc",
        html: "server",
        streaming: true,
        hydrate: "load",
      },
      component: "./src/pages/Insights.tsx",
      mount: "#app",
    };

    const result = await adapter(
      {
        default() {
          return createElement("h1", null, "Insights");
        },
      },
      {
        request: new Request("https://example.com/insights"),
        manifest,
        pageId: "insights",
        page: manifest.pages.insights,
      },
    );

    if (!result || result instanceof Response || typeof result === "string") {
      throw new Error("Expected HTML result.");
    }

    expect(result.html).toContain(
      '<link rel="stylesheet" href="/assets/insights.css">',
    );
    expect(result.html).toContain(
      '<script id="__EVJS_RSC_BOOTSTRAP__" type="application/json">',
    );
    expect(result.html).toContain('"pageId":"insights"');
    expect(result.html).toContain('"endpoint":"/__evjs/rsc"');
    expect(result.html).toContain('"mount":"#app"');
    expect(result.html).toContain(
      '<script defer src="/assets/evjs-rsc-client.js"></script>',
    );
    expect(result.html).not.toContain("Insights.tsx");
    expect(result.html).not.toContain("insights-rsc.js");
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
      render: "ssr",
      componentModel: "rsc",
      rendering: {
        component: "rsc",
        html: "server",
        streaming: true,
        hydrate: "load",
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

  it("redacts local paths from RSC error payloads", async () => {
    const manifest = createManifest();
    const adapter = createReactRscFlightAdapter({
      renderFlight() {
        throw new Error(
          "failed at file:///Users/example/repo/src/pages/Insights.tsx and /Users/example/repo/dist/server/insights-rsc.js",
        );
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      manifest,
      pageId: "dashboard",
    });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).toContain("[redacted-file-url]");
    expect(text).toContain("[redacted-path]");
    expect(text).not.toContain("file://");
    expect(text).not.toContain("/Users/");
    expect(text).not.toContain("Insights.tsx");
  });

  it("redacts local paths from successful Flight streams", async () => {
    const manifest = createManifest();
    const adapter = createReactRscFlightAdapter({
      renderFlight() {
        return new Response(
          [
            'I["./src/pages/InsightsBadge.tsx",["insights-rsc.js"],"default"]\n',
            "E/file:///Users/example/repo/src/pages/Insights.tsx\n",
            "E/Users/example/repo/dist/server/insights-rsc.js\n",
          ].join(""),
          {
            headers: {
              "Content-Type": "text/x-component; charset=utf-8",
              "Content-Length": "200",
            },
          },
        );
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      manifest,
      pageId: "dashboard",
    });
    const text = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/x-component");
    expect(response.headers.has("Content-Length")).toBe(false);
    expect(text).toContain("./src/pages/InsightsBadge.tsx");
    expect(text).toContain("[redacted-file-url]");
    expect(text).toContain("[redacted-path]");
    expect(text).not.toContain("file://");
    expect(text).not.toContain("/Users/");
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
