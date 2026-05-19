import { type QueryClient, useQuery } from "@tanstack/react-query";
import {
  createRoute as createClientRoute,
  createRootRouteWithContext,
  Outlet,
} from "@tanstack/react-router";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createRoute as createServerRoute } from "../src/routes/route-handler.js";
import {
  AssetLinks,
  AssetScripts,
  createSsrHandler,
  isDocumentRequest,
} from "../src/ssr.js";

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => createElement(Outlet),
});

const homeRoute = createClientRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => createElement("h1", null, "Home"),
});

const aboutRoute = createClientRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: () => createElement("h1", null, "About"),
});

const routeTree = rootRoute.addChildren([homeRoute, aboutRoute]);

const dataQuery = {
  queryKey: ["ssr-data"],
  queryFn: async () => "query data from loader",
};

const dataRootRoute = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: () => createElement(Outlet),
});

const dataRoute = createClientRoute({
  getParentRoute: () => dataRootRoute,
  path: "/data",
  loader: ({ context }) => context.queryClient.ensureQueryData(dataQuery),
  component: () => {
    const { data } = useQuery(dataQuery);
    return createElement("p", { "data-testid": "loader-data" }, data);
  },
});

const dataRouteTree = dataRootRoute.addChildren([dataRoute]);

const REQUEST_CONTEXT_KEY = Symbol.for("evjs.transport.requestContext");

interface StoredTransportContext {
  baseUrl?: string;
  headers?: Record<string, string>;
}

function readStoredTransportContext(): StoredTransportContext | undefined {
  const store = (globalThis as unknown as Record<symbol, unknown>)[
    REQUEST_CONTEXT_KEY
  ] as { getStore?: () => StoredTransportContext | undefined } | undefined;
  return store?.getStore?.();
}

describe("SSR document handling", () => {
  it("detects navigational document requests", () => {
    expect(
      isDocumentRequest(
        new Request("http://localhost/users", {
          headers: { Accept: "text/html" },
        }),
      ),
    ).toBe(true);
    expect(
      isDocumentRequest(
        new Request("http://localhost/users", {
          headers: { Accept: "*/*" },
        }),
      ),
    ).toBe(true);
    expect(isDocumentRequest(new Request("http://localhost/users"))).toBe(true);
    expect(isDocumentRequest(new Request("http://localhost/main.js"))).toBe(
      false,
    );
    expect(
      isDocumentRequest(
        new Request("http://localhost/users", {
          headers: { Accept: "application/json" },
        }),
      ),
    ).toBe(false);
    expect(
      isDocumentRequest(
        new Request("http://localhost/users", {
          method: "POST",
          headers: { Accept: "text/html" },
        }),
      ),
    ).toBe(false);
  });

  it("mounts document fallback after server routes and functions", async () => {
    const app = createApp({
      routes: [
        createServerRoute("/api/health", {
          GET: () => Response.json({ ok: true }),
        }),
      ],
      document: createSsrHandler(({ url }) => `<h1>${url.pathname}</h1>`),
    });

    const apiRes = await app.fetch(new Request("http://localhost/api/health"));
    expect(apiRes.status).toBe(200);
    expect(await apiRes.json()).toEqual({ ok: true });

    const docRes = await app.fetch(
      new Request("http://localhost/dashboard", {
        headers: { Accept: "text/html" },
      }),
    );
    expect(docRes.status).toBe(200);
    expect(docRes.headers.get("Content-Type")).toContain("text/html");
    expect(await docRes.text()).toBe("<h1>/dashboard</h1>");
  });

  it("lets the document handler decline non-document requests", async () => {
    const app = createApp({
      document: createSsrHandler(({ url }) => `<h1>${url.pathname}</h1>`),
    });

    const res = await app.fetch(
      new Request("http://localhost/assets/app.js", {
        headers: { Accept: "application/javascript" },
      }),
    );

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });

  it("preserves status and headers from custom document responses", async () => {
    const app = createApp({
      document: createSsrHandler(() => {
        return new Response("<h1>missing</h1>", {
          status: 404,
          headers: { "X-Route": "not-found" },
        });
      }),
    });

    const res = await app.fetch(
      new Request("http://localhost/missing", {
        headers: { Accept: "text/html" },
      }),
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("X-Route")).toBe("not-found");
    expect(await res.text()).toBe("<h1>missing</h1>");
  });

  it("normalizes Uint8Array and stream render results into HTML responses", async () => {
    const text = new TextEncoder().encode("<h1>stream</h1>");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(text);
        controller.close();
      },
    });

    const app = createApp({
      document: createSsrHandler(() => stream),
    });

    const res = await app.fetch(
      new Request("http://localhost/stream", {
        headers: { Accept: "text/html" },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toBe("<h1>stream</h1>");
  });

  it("returns a header-only response for HEAD document requests", async () => {
    const app = createApp({
      document: createSsrHandler(() => "<h1>head</h1>"),
    });

    const res = await app.fetch(
      new Request("http://localhost/head", {
        method: "HEAD",
        headers: { Accept: "text/html" },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toBe("");
  });

  it("passes resolved asset manifests to custom render handlers", async () => {
    const app = createApp({
      document: createSsrHandler({
        assets: {
          js: ["main.123.js"],
          css: ["app.123.css"],
          publicPath: "/assets/",
        },
        render: ({ assets }) =>
          renderToStaticMarkup(
            createElement(
              "html",
              null,
              createElement(
                "head",
                null,
                createElement(AssetLinks, { assets }),
              ),
              createElement(
                "body",
                null,
                createElement(AssetScripts, { assets }),
              ),
            ),
          ),
      }),
    });

    const res = await app.fetch(
      new Request("http://localhost/assets-test", {
        headers: { Accept: "text/html" },
      }),
    );
    const html = await res.text();

    expect(html).toContain('href="/assets/app.123.css"');
    expect(html).toContain('src="/assets/main.123.js"');
  });

  it("preloads active lazy route assets without executing them as entry scripts", async () => {
    const app = createApp({
      document: createSsrHandler({
        routeTree,
        mode: "string",
        assets: {
          js: ["main.js"],
          css: ["app.css"],
          routes: [
            {
              path: "/",
              assets: { js: ["home.lazy.js"], css: ["home.lazy.css"] },
            },
            {
              path: "/about",
              assets: { js: ["about.lazy.js"], css: ["about.lazy.css"] },
            },
          ],
        },
        renderDocument: ({ assets, children }) =>
          createElement(
            "html",
            null,
            createElement("head", null, createElement(AssetLinks, { assets })),
            createElement(
              "body",
              null,
              createElement("div", { id: "app" }, children),
              createElement(AssetScripts, { assets }),
            ),
          ),
      }),
    });

    const res = await app.fetch(
      new Request("http://localhost/about", {
        headers: { Accept: "text/html" },
      }),
    );
    const html = await res.text();

    expect(html).toContain('href="/about.lazy.js"');
    expect(html).toContain('href="/about.lazy.css"');
    expect(html).toContain('href="/app.css"');
    expect(html).not.toContain('href="/home.lazy.js"');
    expect(html).not.toContain('href="/home.lazy.css"');
    expect(html).toContain('src="/main.js"');
    expect(html).not.toContain('src="/about.lazy.js"');
  });

  it("uses a cookie-only header allowlist for SSR transport context by default", async () => {
    let capturedContext: StoredTransportContext | undefined;
    const app = createApp({
      document: createSsrHandler(() => {
        capturedContext = readStoredTransportContext();
        return "<h1>headers</h1>";
      }),
    });

    await app.fetch(
      new Request("http://localhost/headers", {
        headers: {
          Accept: "text/html",
          Authorization: "Bearer secret",
          Cookie: "sid=1",
          "x-public": "ok",
        },
      }),
    );

    expect(capturedContext).toEqual({
      baseUrl: "http://localhost/",
      headers: { cookie: "sid=1" },
    });
  });

  it("lets SSR handlers explicitly allow additional forwarded headers", async () => {
    let capturedContext: StoredTransportContext | undefined;
    const app = createApp({
      document: createSsrHandler({
        forwardHeaders: ["cookie", "x-public"],
        render: () => {
          capturedContext = readStoredTransportContext();
          return "<h1>headers</h1>";
        },
      }),
    });

    await app.fetch(
      new Request("http://localhost/headers", {
        headers: {
          Accept: "text/html",
          Authorization: "Bearer secret",
          Cookie: "sid=1",
          "x-public": "ok",
        },
      }),
    );

    expect(capturedContext).toEqual({
      baseUrl: "http://localhost/",
      headers: { cookie: "sid=1", "x-public": "ok" },
    });
  });

  it("reuses an existing global SSR transport context store", async () => {
    const globalRecord = globalThis as unknown as Record<symbol, unknown>;
    const previousStore = globalRecord[REQUEST_CONTEXT_KEY];
    const previousInit =
      globalRecord[Symbol.for("evjs.transport.requestContext.init")];
    let capturedStore: StoredTransportContext | undefined;
    const fakeStore = {
      getStore: () => capturedStore,
      run: vi.fn((store: StoredTransportContext, callback: () => Response) => {
        capturedStore = store;
        return callback();
      }),
    };

    globalRecord[REQUEST_CONTEXT_KEY] = fakeStore;
    delete globalRecord[Symbol.for("evjs.transport.requestContext.init")];

    try {
      const app = createApp({
        document: createSsrHandler(() => "<h1>singleton</h1>"),
      });

      await app.fetch(
        new Request("http://localhost/singleton", {
          headers: { Accept: "text/html", Cookie: "sid=1" },
        }),
      );

      expect(fakeStore.run).toHaveBeenCalledOnce();
      expect(globalRecord[REQUEST_CONTEXT_KEY]).toBe(fakeStore);
      expect(capturedStore).toEqual({
        baseUrl: "http://localhost/",
        headers: { cookie: "sid=1" },
      });
    } finally {
      if (previousStore === undefined) {
        delete globalRecord[REQUEST_CONTEXT_KEY];
      } else {
        globalRecord[REQUEST_CONTEXT_KEY] = previousStore;
      }
      if (previousInit === undefined) {
        delete globalRecord[Symbol.for("evjs.transport.requestContext.init")];
      } else {
        globalRecord[Symbol.for("evjs.transport.requestContext.init")] =
          previousInit;
      }
    }
  });

  it("renders a route tree document through createSsrHandler", async () => {
    const app = createApp({
      document: createSsrHandler({
        routeTree,
        renderDocument: ({ children, responseHeaders }) => {
          responseHeaders.set("x-evjs-ssr", "1");

          return createElement(
            "html",
            { lang: "en" },
            createElement(
              "body",
              null,
              createElement("div", { id: "app" }, children),
            ),
          );
        },
      }),
    });

    const res = await app.fetch(
      new Request("http://localhost/about", {
        headers: { Accept: "text/html" },
      }),
    );
    const html = await res.text();

    expect(res.headers.get("x-evjs-ssr")).toBe("1");
    expect(html).toContain('<div id="app">');
    expect(html).toContain("<h1>About</h1>");
  });

  it("dehydrates route loader query data for client hydration", async () => {
    const app = createApp({
      document: createSsrHandler({
        routeTree: dataRouteTree,
        mode: "string",
        renderDocument: ({ children }) =>
          createElement(
            "html",
            null,
            createElement(
              "body",
              null,
              createElement("div", { id: "app" }, children),
              createElement(AssetScripts),
            ),
          ),
      }),
    });

    const res = await app.fetch(
      new Request("http://localhost/data", {
        headers: { Accept: "text/html" },
      }),
    );
    const html = await res.text();

    expect(html).toContain("query data from loader");
    expect(html).toContain("__evjsQueryClient");
  });

  it("lets the route tree SSR overload decline non-document requests", async () => {
    const app = createApp({
      document: createSsrHandler({
        routeTree,
        renderDocument: ({ children }) =>
          createElement("html", null, createElement("body", null, children)),
      }),
    });

    const res = await app.fetch(
      new Request("http://localhost/assets/main.js", {
        headers: { Accept: "text/javascript" },
      }),
    );

    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });

  it("returns header-only responses for HEAD router SSR requests", async () => {
    const app = createApp({
      document: createSsrHandler({
        routeTree,
        renderDocument: ({ children, responseHeaders }) => {
          responseHeaders.set("x-evjs-ssr", "1");

          return createElement(
            "html",
            null,
            createElement("body", null, children),
          );
        },
      }),
    });

    const res = await app.fetch(
      new Request("http://localhost/about", {
        method: "HEAD",
        headers: { Accept: "text/html" },
      }),
    );

    expect(res.headers.get("x-evjs-ssr")).toBe("1");
    expect(await res.text()).toBe("");
  });
});
