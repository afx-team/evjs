import {
  createContext,
  createElement,
  lazy,
  type ReactNode,
  Suspense,
  useContext,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertFrameworkRuntime,
  type FrameworkRuntime,
} from "../src/framework-rendering/framework.js";
import {
  createReactRscFlightAdapter,
  createReactServerRenderAdapter,
  renderReactPageMetadata,
} from "../src/framework-rendering/react-renderer.js";

interface PageProps {
  params: Record<string, string>;
  search: Record<string, unknown>;
  loaderData: unknown;
}

type SpaFrameworkRuntime = FrameworkRuntime & {
  routing: Extract<FrameworkRuntime["routing"], { kind: "spa" }>;
};

interface PageProviderProps {
  value: PageProps;
  children?: ReactNode;
}

const PageContext = createContext<PageProps | undefined>(undefined);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function PageProvider({ value, children }: PageProviderProps) {
  return createElement(PageContext.Provider, { value }, children);
}

function usePageContext(): PageProps {
  const ctx = useContext(PageContext);
  if (!ctx) {
    throw new Error("Expected page context.");
  }
  return ctx;
}

function usePageParams<TParams extends Record<string, string>>(): TParams {
  return usePageContext().params as TParams;
}

function usePageSearch<TSearch extends Record<string, unknown>>(): TSearch {
  return usePageContext().search as TSearch;
}

function readHtml(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    result instanceof Response ||
    !("html" in result) ||
    typeof result.html !== "string"
  ) {
    throw new Error("Expected HTML render result.");
  }
  return result.html;
}

describe("createReactServerRenderAdapter", () => {
  it("rejects invalid server render adapter options", () => {
    expect(() => createReactServerRenderAdapter(null as never)).toThrow(
      "[evjs] createReactServerRenderAdapter() options must be an object.",
    );
    expect(() =>
      createReactServerRenderAdapter({ createProps: "props" } as never),
    ).toThrow(
      "[evjs] createReactServerRenderAdapter() createProps must be a function.",
    );
    expect(() =>
      createReactServerRenderAdapter({
        renderDocument: "render",
      } as never),
    ).toThrow(
      "[evjs] createReactServerRenderAdapter() renderDocument must be a function.",
    );
  });

  it.each([
    "visible",
    "idle",
  ])("rejects the unsupported %s framework hydration mode", (hydrate) => {
    const runtime = createManifest();
    runtime.routing.pages.home = {
      assets: { js: ["home.js"], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
    };
    Reflect.set(runtime.routing.pages.home.rendering, "hydrate", hydrate);

    expect(() => assertRendererTestManifestShape(runtime)).toThrow(
      '[evjs] react renderer test runtime.routing.pages.home.rendering.hydrate must be "none" or "load".',
    );
  });

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
        runtime: createManifest(),
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
        '<div id="root" data-evjs-hydrate="load"><h1>Page <!-- -->dashboard</h1></div>',
        '<script id="__EVJS_PAGE_PROPS__" type="application/json">',
        '{"runtime":{"buildId":"test"},"pageId":"dashboard"}',
        "</script>",
        '<script defer src="/assets/dashboard.js"></script>',
        "</body>",
        "</html>",
      ].join(""),
    });
  });

  it("renders request data and Page HTML into a compiled framework document shell", async () => {
    const adapter = createReactServerRenderAdapter();
    const result = await adapter(
      {
        default({ pageId }: { pageId?: string }) {
          return createElement("h1", null, "Shell ", pageId);
        },
      },
      {
        request: new Request("https://example.com/dashboard"),
        runtime: createManifest(),
        pageId: "dashboard",
        page: {
          assets: { js: ["dashboard.js"], css: ["dashboard.css"] },
          document: {
            beforeContent: [
              "<!DOCTYPE html>",
              '<html lang="zh-CN" data-template="custom">',
              "<head>",
              '<meta name="viewport" content="width=device-width">',
              '<link rel="stylesheet" href="/dashboard.css">',
              "</head>",
              '<body class="shell"><header>Header</header>',
              '<main id="root" data-evjs-hydrate="load">',
            ].join(""),
            betweenContentAndData: "</main><footer>Footer</footer>",
            afterData:
              '<script defer src="/dashboard.js"></script></body></html>',
          },
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

    expect(readHtml(result)).toBe(
      [
        "<!DOCTYPE html>",
        '<html lang="zh-CN" data-template="custom">',
        "<head>",
        '<meta name="viewport" content="width=device-width">',
        '<link rel="stylesheet" href="/dashboard.css">',
        "</head>",
        '<body class="shell"><header>Header</header>',
        '<main id="root" data-evjs-hydrate="load">',
        "<h1>Shell <!-- -->dashboard</h1>",
        "</main><footer>Footer</footer>",
        '<script id="__EVJS_PAGE_PROPS__" type="application/json">',
        '{"runtime":{"buildId":"test"},"pageId":"dashboard"}',
        "</script>",
        '<script defer src="/dashboard.js"></script></body></html>',
      ].join(""),
    );
  });

  it("only marks server HTML when browser assets can hydrate it", async () => {
    const adapter = createReactServerRenderAdapter();
    const render = (hydrate: "none" | "load", js: string[]) =>
      adapter(
        {
          default() {
            return createElement("h1", null, "Page");
          },
        },
        {
          request: new Request("https://example.com/dashboard"),
          runtime: createManifest(),
          pageId: "dashboard",
          page: {
            assets: { js, css: [] },
            render: "ssr",
            rendering: {
              component: "server",
              html: "server",
              streaming: false,
              hydrate,
            },
          },
        },
      );

    const withoutHydration = await render("none", ["dashboard.js"]);
    const withoutJavaScript = await render("load", []);
    const withHydration = await render("load", ["dashboard.js"]);

    expect(readHtml(withoutHydration)).not.toContain("data-evjs-hydrate");
    expect(readHtml(withoutJavaScript)).not.toContain("data-evjs-hydrate");
    expect(readHtml(withHydration)).toContain('data-evjs-hydrate="load"');
  });

  it("renders escaped Page metadata into the default HTML document", async () => {
    const adapter = createReactServerRenderAdapter();
    const result = await adapter(
      {
        default() {
          return createElement("h1", null, "Metadata");
        },
      },
      {
        request: new Request("https://example.com/metadata"),
        runtime: createManifest(),
        pageId: "metadata",
        page: {
          assets: { js: [], css: [] },
          metadata: {
            title: 'Risk </title><script>alert("x")</script> & review',
            meta: {
              description: 'Final </meta> & "description"',
              'custom"name': '<unsafe> & "quoted"',
            },
          },
          render: "ssr",
          rendering: {
            component: "server",
            html: "server",
            streaming: false,
            hydrate: "none",
          },
        },
      },
    );

    if (!result || result instanceof Response || typeof result === "string") {
      throw new Error("Expected HTML result.");
    }

    expect(result.html).toContain(
      '<title data-evjs-page-metadata="title" data-evjs-page-metadata-created="">Risk &lt;/title&gt;&lt;script&gt;alert("x")&lt;/script&gt; &amp; review</title>',
    );
    expect(result.html).toContain(
      '<meta name="description" content="Final &lt;/meta&gt; &amp; &quot;description&quot;" data-evjs-page-metadata="meta" data-evjs-page-metadata-created="">',
    );
    expect(result.html).toContain(
      '<meta name="custom&quot;name" content="&lt;unsafe&gt; &amp; &quot;quoted&quot;" data-evjs-page-metadata="meta" data-evjs-page-metadata-created="">',
    );
    expect(result.html).not.toContain("<script>alert");
    expect(result.html).not.toContain("</meta>");
  });

  it("marks default SPA metadata so client navigation can restore an empty baseline", async () => {
    const runtime = createManifest();
    runtime.routing = {
      kind: "spa",
      pages: runtime.routing.pages,
      routes: [{ id: "metadata", path: "/metadata", pageId: "metadata" }],
    };
    const adapter = createReactServerRenderAdapter();
    const result = await adapter(
      {
        default() {
          return createElement("h1", null, "Metadata");
        },
      },
      {
        request: new Request("https://example.com/metadata"),
        runtime,
        pageId: "metadata",
        page: {
          assets: { js: [], css: [] },
          metadata: {
            title: "Metadata",
            meta: { description: "Metadata description" },
          },
          render: "ssr",
          rendering: {
            component: "server",
            html: "server",
            streaming: false,
            hydrate: "load",
          },
        },
      },
    );

    if (!result || result instanceof Response || typeof result === "string") {
      throw new Error("Expected HTML result.");
    }
    expect(result.html).toContain(
      '<title data-evjs-page-metadata="title" data-evjs-page-metadata-created="">Metadata</title>',
    );
    expect(result.html).toContain(
      '<meta name="description" content="Metadata description" data-evjs-page-metadata="meta" data-evjs-page-metadata-created="">',
    );
  });

  it("exposes Page metadata to a custom document renderer", async () => {
    const adapter = createReactServerRenderAdapter({
      renderDocument(appHtml, ctx) {
        return {
          html: `<!doctype html><html><head>${renderReactPageMetadata(ctx)}</head><body><main>${appHtml}</main></body></html>`,
        };
      },
    });
    const runtime = createManifest();
    runtime.routing = { kind: "spa", pages: {}, routes: [] };
    const result = await adapter(
      {
        default() {
          return createElement("h1", null, "Custom");
        },
      },
      {
        request: new Request("https://example.com/custom"),
        runtime,
        pageId: "custom",
        page: {
          assets: { js: [], css: [] },
          metadata: {
            title: "Custom <title>",
            meta: { description: 'Custom "description"' },
          },
          render: "ssr",
          rendering: {
            component: "server",
            html: "server",
            streaming: false,
            hydrate: "none",
          },
        },
      },
    );

    expect(result).toEqual({
      html: [
        "<!doctype html><html><head>",
        '<title data-evjs-page-metadata="title" data-evjs-page-metadata-created="">Custom &lt;title&gt;</title>',
        '<meta name="description" content="Custom &quot;description&quot;" data-evjs-page-metadata="meta" data-evjs-page-metadata-created="">',
        "</head><body><main><h1>Custom</h1></main></body></html>",
      ].join(""),
    });
  });

  it("renders root-relative assets for auto public paths", async () => {
    const adapter = createReactServerRenderAdapter();
    const result = await adapter(
      {
        default() {
          return createElement("h1", null, "Dashboard");
        },
      },
      {
        request: new Request("https://example.com/dashboard"),
        runtime: {
          ...createManifest(),
          publicPath: "auto",
        },
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
        },
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        html: expect.stringContaining(
          '<link rel="stylesheet" href="/dashboard.css">',
        ),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        html: expect.stringContaining(
          '<script defer src="/dashboard.js"></script>',
        ),
      }),
    );
  });

  it("waits for Suspense content during complete server rendering", async () => {
    const adapter = createReactServerRenderAdapter();
    const LazyContent = lazy(async () => ({
      default() {
        return createElement("strong", null, "ready");
      },
    }));

    const result = await adapter(
      {
        default() {
          return createElement(
            Suspense,
            { fallback: createElement("span", null, "loading") },
            createElement(LazyContent),
          );
        },
      },
      {
        request: new Request("https://example.com/dashboard"),
        runtime: createManifest(),
        pageId: "dashboard",
        page: {
          assets: { js: ["dashboard.js"], css: [] },
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

    if (!result || result instanceof Response || typeof result === "string") {
      throw new Error("Expected HTML result.");
    }

    expect(result.html).toContain("<strong>ready</strong>");
    expect(result.html).not.toContain("loading");
  });

  it("does not embed framework runtime internals in default hydration props", async () => {
    const adapter = createReactServerRenderAdapter();
    const manifest = createManifest();
    manifest.routing.pages.dashboard = {
      assets: { js: ["dashboard.js"], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
    };
    manifest.routing.routes.push({
      id: "dashboard",
      path: "/dashboard",
      pageId: "dashboard",
    });

    const result = await adapter(
      {
        default() {
          return createElement("h1", null, "Dashboard");
        },
      },
      {
        request: new Request("https://example.com/dashboard"),
        runtime: manifest,
        pageId: "dashboard",
        page: manifest.routing.pages.dashboard,
        route: manifest.routing.routes[0],
      },
    );

    if (!result || result instanceof Response || typeof result === "string") {
      throw new Error("Expected HTML result.");
    }

    expect(result.html).toContain(
      '<script id="__EVJS_PAGE_PROPS__" type="application/json">{"runtime":{"buildId":"test"},"route":{"id":"dashboard","path":"/dashboard"},"pageId":"dashboard"}</script>',
    );
    expect(result.html).not.toContain("Dashboard.tsx");
    expect(result.html).not.toContain('"assets"');
    expect(result.html).not.toContain('"pages"');
    expect(result.html).not.toContain('"routes"');
  });

  it("rejects non-object custom server render props", async () => {
    const adapter = createReactServerRenderAdapter({
      createProps() {
        return [] as never;
      },
    });

    await expect(
      adapter(
        {
          default() {
            return createElement("h1", null, "Dashboard");
          },
        },
        {
          request: new Request("https://example.com/dashboard"),
          runtime: createManifest(),
          pageId: "dashboard",
        },
      ),
    ).rejects.toThrow(
      "[evjs] createReactServerRenderAdapter() createProps() must return an object.",
    );
  });

  it("provides route params and search to page hooks during server render", async () => {
    const adapter = createReactServerRenderAdapter();
    const manifest = createManifest();
    manifest.routing.pages.post = {
      assets: { js: ["post.js"], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
    };
    manifest.routing.routes.push({
      id: "post",
      path: "/posts/$postId",
      pageId: "post",
    });
    let renderedProps: Record<string, unknown> | undefined;
    function PostPage(props: Record<string, unknown>) {
      renderedProps = props;
      const { postId } = usePageParams<{ postId: string }>();
      const search = usePageSearch<{ tab?: string; tag?: string }>();
      return createElement("h1", null, `${postId}:${search.tab}:${search.tag}`);
    }

    const result = await adapter(
      {
        default: PostPage,
        PageProvider,
      },
      {
        request: new Request(
          "https://example.com/posts/42?tab=comments&tag=a&tag=b",
        ),
        runtime: manifest,
        pageId: "post",
        page: manifest.routing.pages.post,
        route: manifest.routing.routes[0],
      },
    );

    if (!result || result instanceof Response || typeof result === "string") {
      throw new Error("Expected HTML result.");
    }

    expect(result.html).toContain("<h1>42:comments:b</h1>");
    expect(renderedProps).toEqual({
      runtime: { buildId: "test" },
      route: { id: "post", path: "/posts/$postId" },
      pageId: "post",
    });
  });

  it("uses the most specific runtime route for server page hooks", async () => {
    const adapter = createReactServerRenderAdapter();
    const manifest = createManifest();
    manifest.routing.pages.profile = {
      assets: { js: ["profile.js"], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
    };
    manifest.routing.routes.push(
      {
        id: "user",
        path: "/users/$userId",
        pageId: "profile",
      },
      {
        id: "settings",
        path: "/users/settings",
        pageId: "profile",
      },
    );
    function ProfilePage() {
      const params = usePageParams<{ userId?: string }>();
      const search = usePageSearch<{ tab?: string }>();
      return createElement(
        "h1",
        null,
        `${params.userId ?? "static"}:${search.tab}`,
      );
    }

    const result = await adapter(
      {
        default: ProfilePage,
        PageProvider,
      },
      {
        request: new Request("https://example.com/users/settings?tab=account"),
        runtime: manifest,
        pageId: "profile",
        page: manifest.routing.pages.profile,
      },
    );

    if (!result || result instanceof Response || typeof result === "string") {
      throw new Error("Expected HTML result.");
    }

    expect(result.html).toContain("<h1>static:account</h1>");
  });

  it("provides colon-style route params during server render", async () => {
    const adapter = createReactServerRenderAdapter();
    const manifest = createManifest();
    manifest.routing.pages.post = {
      assets: { js: ["post.js"], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
    };
    manifest.routing.routes.push({
      id: "post",
      path: "/posts/:postId",
      pageId: "post",
    });
    function PostPage() {
      const { postId } = usePageParams<{ postId: string }>();
      return createElement("h1", null, postId);
    }

    const result = await adapter(
      {
        default: PostPage,
        PageProvider,
      },
      {
        request: new Request("https://example.com/posts/42"),
        runtime: manifest,
        pageId: "post",
        page: manifest.routing.pages.post,
        route: manifest.routing.routes[0],
      },
    );

    if (!result || result instanceof Response || typeof result === "string") {
      throw new Error("Expected HTML result.");
    }

    expect(result.html).toContain("<h1>42</h1>");
  });

  it("provides wildcard route params during server render", async () => {
    const adapter = createReactServerRenderAdapter();
    const manifest = createManifest();
    manifest.routing.pages.docs = {
      assets: { js: ["docs.js"], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
    };
    manifest.routing.routes.push({
      id: "docs-fallback",
      path: "/docs/$",
      pageId: "docs",
    });
    function DocsPage() {
      const { _splat } = usePageParams<{ _splat: string }>();
      return createElement("h1", null, _splat);
    }

    const result = await adapter(
      {
        default: DocsPage,
        PageProvider,
      },
      {
        request: new Request("https://example.com/docs/guides/install"),
        runtime: manifest,
        pageId: "docs",
        page: manifest.routing.pages.docs,
        route: manifest.routing.routes[0],
      },
    );

    if (!result || result instanceof Response || typeof result === "string") {
      throw new Error("Expected HTML result.");
    }

    expect(result.html).toContain("<h1>guides/install</h1>");
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
        PageProvider,
      },
      {
        request: new Request("https://example.com/posts/42?tab=ignored"),
        runtime: createManifest(),
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
      fn: "__evjs/fn",
      rsc: "__evjs/rsc",
    };
    manifest.rsc = {
      pages: {
        insights: {
          renderer: "insights-rsc",
          assets: { js: ["insights-rsc.js"], css: [] },
        },
      },
    };
    manifest.routing.pages.insights = {
      assets: { js: ["evjs-rsc-client.js"], css: ["insights.css"] },
      render: "ssr",
      componentModel: "rsc",
      rendering: {
        component: "rsc",
        html: "server",
        streaming: true,
        hydrate: "none",
      },
      mount: "#app",
    };
    assertRendererTestManifestShape(manifest);

    const result = await adapter(
      {
        default() {
          return createElement("h1", null, "Insights");
        },
      },
      {
        request: new Request("https://example.com/insights"),
        runtime: manifest,
        pageId: "insights",
        page: manifest.routing.pages.insights,
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
    expect(result.html).toContain('"endpoint":"__evjs/rsc"');
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
          runtime: createManifest(),
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects invalid server renderer modules", async () => {
    const adapter = createReactServerRenderAdapter();

    await expect(
      adapter(null as never, {
        request: new Request("https://example.com/dashboard"),
        runtime: createManifest(),
      }),
    ).rejects.toThrow(
      "[evjs] createReactServerRenderAdapter() module must be a renderer module object.",
    );
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
        runtime: createManifest(),
        pageId: "dashboard",
      },
    );

    expect(result).toEqual({
      html: "<main><h1>DASHBOARD</h1></main>",
      headers: { "x-render": "custom" },
    });
  });

  it("rejects invalid custom document rendering results", async () => {
    const adapter = createReactServerRenderAdapter({
      renderDocument() {
        return { body: "<main />" } as never;
      },
    });

    await expect(
      adapter(
        {
          default() {
            return createElement("h1", null, "Dashboard");
          },
        },
        {
          request: new Request("https://example.com/dashboard"),
          runtime: createManifest(),
          pageId: "dashboard",
        },
      ),
    ).rejects.toThrow(
      "[evjs] createReactServerRenderAdapter() renderDocument() must return a Response, string, or { html, status?, headers? }.",
    );
  });

  it("rejects invalid custom document status metadata", async () => {
    const adapter = createReactServerRenderAdapter({
      renderDocument() {
        return { html: "<main />", status: 99 } as never;
      },
    });

    await expect(
      adapter(
        {
          default() {
            return createElement("h1", null, "Dashboard");
          },
        },
        {
          request: new Request("https://example.com/dashboard"),
          runtime: createManifest(),
          pageId: "dashboard",
        },
      ),
    ).rejects.toThrow(
      "[evjs] createReactServerRenderAdapter() renderDocument() status must be an integer HTTP status between 200 and 599 that can include an HTML body.",
    );
  });

  it("rejects invalid custom document headers metadata", async () => {
    const adapter = createReactServerRenderAdapter({
      renderDocument() {
        return { html: "<main />", headers: [["x-render"]] } as never;
      },
    });

    await expect(
      adapter(
        {
          default() {
            return createElement("h1", null, "Dashboard");
          },
        },
        {
          request: new Request("https://example.com/dashboard"),
          runtime: createManifest(),
          pageId: "dashboard",
        },
      ),
    ).rejects.toThrow(
      "[evjs] createReactServerRenderAdapter() renderDocument() headers must be valid HeadersInit.",
    );
  });
});

describe("createReactRscFlightAdapter", () => {
  it("rejects invalid RSC Flight adapter options", () => {
    expect(() => createReactRscFlightAdapter(null as never)).toThrow(
      "[evjs] createReactRscFlightAdapter() options must be an object.",
    );
    expect(() =>
      createReactRscFlightAdapter({ loadModule: "load" } as never),
    ).toThrow(
      "[evjs] createReactRscFlightAdapter() loadModule must be a function.",
    );
    expect(() =>
      createReactRscFlightAdapter({ createProps: "props" } as never),
    ).toThrow(
      "[evjs] createReactRscFlightAdapter() createProps must be a function.",
    );
    expect(() =>
      createReactRscFlightAdapter({ renderFlight: "render" } as never),
    ).toThrow(
      "[evjs] createReactRscFlightAdapter() renderFlight must be a function.",
    );
    expect(() =>
      createReactRscFlightAdapter({ onError: "handle" } as never),
    ).toThrow(
      "[evjs] createReactRscFlightAdapter() onError must be a function.",
    );
    expect(() =>
      createReactRscFlightAdapter({ validateContentType: "yes" } as never),
    ).toThrow(
      "[evjs] createReactRscFlightAdapter() validateContentType must be a boolean.",
    );
  });

  it("returns the matched RSC page renderer Flight response", async () => {
    const manifest = createManifest();
    manifest.runtime.server = {
      basePath: "/__evjs",
      fn: "__evjs/fn",
      rsc: "__evjs/rsc",
    };
    manifest.routing.pages.dashboard = {
      assets: { js: [], css: [] },
      render: "ssr",
      componentModel: "rsc",
      rendering: {
        component: "rsc",
        html: "server",
        streaming: true,
        hydrate: "none",
      },
    };
    manifest.server = {
      renderers: {
        "dashboard-rsc": {
          kind: "rsc-page",
          owner: { pageId: "dashboard" },
          assets: { js: ["dashboard-rsc.js"], css: [] },
        },
      },
    };
    manifest.rsc = {
      pages: {
        dashboard: {
          renderer: "dashboard-rsc",
          assets: { js: ["dashboard-rsc.js"], css: [] },
        },
      },
    };
    assertRendererTestManifestShape(manifest);

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
      runtime: manifest,
      pageId: "dashboard",
      page: manifest.routing.pages.dashboard,
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
      fn: "__evjs/fn",
      rsc: "__evjs/rsc",
    };

    const adapter = createReactRscFlightAdapter();

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: manifest,
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
      fn: "__evjs/fn",
      rsc: "__evjs/rsc",
    };
    const adapter = createReactRscFlightAdapter({
      renderFlight() {
        return Response.json({ ok: true });
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: manifest,
      pageId: "dashboard",
    });

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain("invalid Content-Type");
  });

  it("reports missing RSC Flight content type from custom renderers", async () => {
    const manifest = createManifest();
    const adapter = createReactRscFlightAdapter({
      renderFlight() {
        return new Response(null);
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: manifest,
      pageId: "dashboard",
    });

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain(
      "invalid Content-Type missing Content-Type",
    );
  });

  it("validates RSC Flight content types as exact media types", async () => {
    const manifest = createManifest();
    const adapter = createReactRscFlightAdapter({
      renderFlight() {
        return new Response("flight", {
          headers: {
            "Content-Type": "Text/X-Component; charset=utf-8",
          },
        });
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: manifest,
      pageId: "dashboard",
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("flight");

    const lookalikeAdapter = createReactRscFlightAdapter({
      renderFlight() {
        return new Response("not flight", {
          headers: {
            "Content-Type": "application/text/x-component",
          },
        });
      },
    });

    const lookalikeResponse = await lookalikeAdapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: manifest,
      pageId: "dashboard",
    });

    expect(lookalikeResponse.status).toBe(500);
    await expect(lookalikeResponse.text()).resolves.toContain(
      'invalid Content-Type "application/text/x-component"',
    );
  });

  it("reports non-Response custom Flight renderer results", async () => {
    const manifest = createManifest();
    const adapter = createReactRscFlightAdapter({
      renderFlight() {
        return null as never;
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: manifest,
      pageId: "dashboard",
    });

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain(
      "[evjs] createReactRscFlightAdapter() renderFlight() must return a Response.",
    );
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
      runtime: manifest,
      pageId: "dashboard",
    });

    expect(response.status).toBe(500);
    expect(caught).toEqual([error]);
    await expect(response.text()).resolves.toContain("flight failed");
  });

  it("redacts renderer exceptions in production while retaining diagnostics", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const manifest = createManifest();
    const error = new Error("RSC adapter credential leaked");
    const onError = vi.fn();
    const adapter = createReactRscFlightAdapter({
      onError,
      renderFlight() {
        throw error;
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: manifest,
      pageId: "dashboard",
    });

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("Internal server error");
    expect(onError).toHaveBeenCalledWith(error, {
      request: expect.any(Request),
      runtime: manifest,
      pageId: "dashboard",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[evjs] RSC Flight render failed:",
      error,
    );
  });

  it("fails closed when the runtime does not expose a Node environment", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("edge runtime credential leaked");
    const adapter = createReactRscFlightAdapter({
      renderFlight() {
        throw error;
      },
    });

    vi.stubGlobal("process", undefined);
    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: createManifest(),
      pageId: "dashboard",
    });
    vi.unstubAllGlobals();

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("Internal server error");
    expect(consoleError).toHaveBeenCalledWith(
      "[evjs] RSC Flight render failed:",
      error,
    );
  });

  it("reports non-object custom RSC render props", async () => {
    const manifest = createManifest();
    const renderer = {
      kind: "rsc-page" as const,
      owner: { pageId: "dashboard" },
      assets: { js: ["dashboard-rsc.js"], css: [] },
    };
    const adapter = createReactRscFlightAdapter({
      createProps() {
        return null as never;
      },
      async loadModule() {
        return {
          default() {
            return createElement("h1", null, "Dashboard");
          },
        };
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: manifest,
      pageId: "dashboard",
      rscPage: {
        renderer: "dashboard-rsc",
        assets: { js: ["dashboard-rsc.js"], css: [] },
      },
      renderer,
    });

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain(
      "[evjs] createReactRscFlightAdapter() createProps() must return an object.",
    );
  });

  it("reports invalid loaded RSC renderer modules", async () => {
    const manifest = createManifest();
    const renderer = {
      kind: "rsc-page" as const,
      owner: { pageId: "dashboard" },
      assets: { js: ["dashboard-rsc.js"], css: [] },
    };
    const adapter = createReactRscFlightAdapter({
      async loadModule() {
        return null as never;
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: manifest,
      pageId: "dashboard",
      rscPage: {
        renderer: "dashboard-rsc",
        assets: { js: ["dashboard-rsc.js"], css: [] },
      },
      renderer,
    });

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain(
      "[evjs] createReactRscFlightAdapter() loadModule() must be a renderer module object.",
    );
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
      runtime: manifest,
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

  it("passes successful Flight payloads through without rewriting business strings", async () => {
    const manifest = createManifest();
    const body = [
      'I["./src/pages/InsightsBadge.tsx",["insights-rsc.js"],"default"]\n',
      'R0:{"address":"/home/customer/orders"}\n',
      "E/file:///Users/example/repo/src/pages/Insights.tsx\n",
    ].join("");
    const upstreamResponse = new Response(body, {
      headers: {
        "Content-Type": "text/x-component; charset=utf-8",
        "Content-Length": String(new TextEncoder().encode(body).byteLength),
      },
    });
    const adapter = createReactRscFlightAdapter({
      renderFlight() {
        return upstreamResponse;
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: manifest,
      pageId: "dashboard",
    });
    expect(response.headers.get("Content-Type")).toContain("text/x-component");
    expect(response.headers.get("Content-Length")).toBe(
      String(new TextEncoder().encode(body).byteLength),
    );
    await expect(response.text()).resolves.toBe(body);
  });

  it("preserves exact bytes from streamed Flight typed-array chunks", async () => {
    const manifest = createManifest();
    const expected = Uint8Array.from([
      0x52, 0x30, 0x3a, 0xff, 0x00, 0x2f, 0x68, 0x6f, 0x6d, 0x65, 0xfe, 0x0a,
    ]);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(expected.slice(0, 5));
        controller.enqueue(expected.slice(5));
        controller.close();
      },
    });
    const upstreamResponse = new Response(body, {
      headers: { "Content-Type": "text/x-component" },
    });
    const adapter = createReactRscFlightAdapter({
      renderFlight() {
        return upstreamResponse;
      },
    });

    const response = await adapter.renderFlight({
      request: new Request("https://example.com/__evjs/rsc?page=dashboard"),
      runtime: manifest,
      pageId: "dashboard",
    });

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);
  });
});

function createManifest(): SpaFrameworkRuntime {
  return {
    version: 1,
    buildId: "test",
    publicPath: "/assets/",
    runtime: {
      server: {
        basePath: "/__evjs",
        fn: "__evjs/fn",
      },
    },
    routing: {
      kind: "spa",
      pages: {},
      routes: [],
    },
    server: {},
  };
}

function assertRendererTestManifestShape(manifest: FrameworkRuntime): void {
  assertFrameworkRuntime(manifest, "react renderer test runtime");
}
