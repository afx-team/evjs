import { ServerError } from "@evjs/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/app.js";
import type {
  FrameworkPageRuntime,
  FrameworkRouteRuntime,
  FrameworkRuntime,
  PprRegionCacheEntry,
  ServerRenderContext,
} from "../src/framework-rendering/framework.js";
import {
  createFrameworkRenderCoordinator,
  createModuleRenderCoordinator,
} from "../src/framework-rendering/framework.js";
import { createReactFrameworkServer } from "../src/framework-rendering/react.js";
import { requestLogger } from "../src/index.js";
import {
  registerServerReference,
  registry,
} from "../src/server-functions/register.js";

type LegacyFrameworkRuntime = FrameworkRuntime & {
  pages: Record<string, FrameworkPageRuntime>;
  routes: FrameworkRouteRuntime[];
};

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

  it("uses the framework runtime server function endpoint when available", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/stale/rpc");
    registerServerReference(async () => "ok", "fn1");
    const manifest = createManifest();
    manifest.runtime.server = {
      basePath: "/framework",
      fn: "framework/fn",
    };

    const app = createApp({
      framework: {
        runtime: manifest,
      },
    });
    const stale = await app.request("/stale/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "fn1", args: [] }),
    });
    const res = await app.request("/framework/fn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "fn1", args: [] }),
    });

    expect(stale.status).toBe(404);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "ok" });
  });

  it("defaults omitted server function RPC args to an empty array", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    registerServerReference((...args: unknown[]) => args, "fn1");

    const app = createApp();
    const res = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "fn1" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: [] });
  });

  it("accepts server function RPC requests with JSON content type parameters", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    registerServerReference(async () => "ok", "fn1");

    const app = createApp();
    const res = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "Application/JSON; charset=utf-8" },
      body: JSON.stringify({ fnId: "fn1", args: [] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "ok" });
  });

  it("rejects server function RPC requests without a JSON content type", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    registerServerReference(async () => "ok", "fn1");

    const app = createApp();
    const unsupported = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ fnId: "fn1", args: [] }),
    });
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toEqual({
      error:
        'Server function requests must use Content-Type "application/json".',
      fnId: "",
      status: 415,
    });

    const missing = await app.request("/api/rpc", {
      method: "POST",
      body: new TextEncoder().encode(JSON.stringify({ fnId: "fn1", args: [] })),
    });
    expect(missing.status).toBe(415);
    expect(await missing.json()).toEqual({
      error:
        'Server function requests must use Content-Type "application/json".',
      fnId: "",
      status: 415,
    });
  });

  it("returns structured success JSON for undefined server function results", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    registerServerReference(async () => undefined, "void-fn");

    const app = createApp();
    const res = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "void-fn", args: [] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("rejects malformed server function RPC request bodies", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    registerServerReference(async () => "ok", "fn1");
    const app = createApp();

    const invalidJson = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({
      error: "Malformed request body",
      fnId: "",
      status: 400,
    });

    const emptyBody = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(emptyBody.status).toBe(400);
    expect(await emptyBody.json()).toEqual({
      error: "Malformed request body",
      fnId: "",
      status: 400,
    });
  });

  it("rejects malformed server function RPC payloads", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    registerServerReference(async () => "ok", "fn1");
    const app = createApp();

    const missingFn = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    });
    expect(missingFn.status).toBe(400);
    expect(await missingFn.json()).toEqual({
      error: "Missing or invalid 'fnId' in request body",
      fnId: "",
      status: 400,
    });

    const whitespaceFn = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: " fn1 ", args: [] }),
    });
    expect(whitespaceFn.status).toBe(400);
    expect(await whitespaceFn.json()).toEqual({
      error: "Missing or invalid 'fnId' in request body",
      fnId: " fn1 ",
      status: 400,
    });

    const invalidArgs = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "fn1", args: { name: "Alice" } }),
    });
    expect(invalidArgs.status).toBe(400);
    expect(await invalidArgs.json()).toEqual({
      error: "'args' must be an array",
      fnId: "fn1",
      status: 400,
    });

    const nullArgs = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "fn1", args: null }),
    });
    expect(nullArgs.status).toBe(400);
    expect(await nullArgs.json()).toEqual({
      error: "'args' must be an array",
      fnId: "fn1",
      status: 400,
    });
  });

  it("returns structured JSON for malformed server function registry entries", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    registry.set("fn1", "not a function" as never);
    const app = createApp();

    const res = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "fn1", args: [] }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: '[evjs] Server function "fn1" registry entry must be a function.',
      fnId: "fn1",
      status: 500,
    });
  });

  it("returns structured JSON for oversized server function RPC payloads", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    registerServerReference(async () => "ok", "fn1");
    const app = createApp();

    const res = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fnId: "fn1",
        args: ["x".repeat(1024 * 1024)],
      }),
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: "Server function request body exceeds the 1 MiB limit.",
      fnId: "",
      status: 413,
    });
  });

  it("returns structured JSON when server function results are not serializable", async () => {
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/api/rpc");
    registerServerReference(async () => 1n, "big-result");
    registerServerReference(async () => {
      throw new ServerError("Invalid data", {
        status: 400,
        data: { value: 1n },
      });
    }, "big-error-data");
    const app = createApp();

    const result = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "big-result", args: [] }),
    });
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({
      error: "Server function response is not JSON serializable.",
      fnId: "big-result",
      status: 500,
    });

    const errorData = await app.request("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fnId: "big-error-data", args: [] }),
    });
    expect(errorData.status).toBe(500);
    expect(await errorData.json()).toEqual({
      error: "Server function response is not JSON serializable.",
      fnId: "big-error-data",
      status: 500,
    });
  });

  it("returns 405 for non-POST server function RPC requests before framework rendering", async () => {
    const manifest = createManifest();
    manifest.runtime.server = {
      basePath: "/api",
      fn: "api/rpc",
    };
    manifest.routes.push({
      id: "rpc-page",
      path: "/api/rpc",
      pageId: "dashboard",
    });
    const app = createApp({
      framework: {
        runtime: manifest,
        render() {
          return "<h1>framework fallback</h1>";
        },
      },
    });

    const get = await app.request("/api/rpc", { method: "GET" });
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST");
    expect(await get.json()).toEqual({
      error: "Method Not Allowed",
      fnId: "",
      status: 405,
    });

    const head = await app.request("/api/rpc", { method: "HEAD" });
    expect(head.status).toBe(405);
    expect(head.headers.get("Allow")).toBe("POST");
    expect(await head.text()).toBe("");
  });

  it("rejects invalid app option shapes", () => {
    const manifest = createManifest();

    expect(() => createApp(null as never)).toThrow(
      "[evjs] createApp() options must be an object.",
    );
    expect(() => createApp([] as never)).toThrow(
      "[evjs] createApp() options must be an object.",
    );

    expect(() => createApp({ routes: {} as never })).toThrow(
      "[evjs] createApp() routes must be an array of route handlers.",
    );
    expect(() => createApp({ middlewares: [null as never] })).toThrow(
      "[evjs] createApp() middlewares must be an array of middleware functions.",
    );
    expect(() => createApp({ framework: [] as never })).toThrow(
      "[evjs] createApp() framework must be a framework server object.",
    );
    expect(() => createApp({ framework: { runtime: null } as never })).toThrow(
      "[evjs] createApp() framework.runtime must be a framework runtime object.",
    );
    expect(() =>
      createApp({
        framework: { runtime: { ...manifest, version: 2 } } as never,
      }),
    ).toThrow("[evjs] createApp() framework.runtime.version must be 1.");
    expect(() =>
      createApp({
        framework: { runtime: { ...manifest, buildId: "build.1" } } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.runtime.buildId must contain only letters, numbers, underscores, or hyphens.",
    );
    expect(() =>
      createApp({
        framework: { runtime: { ...manifest, runtime: null } } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.runtime.runtime must be an object.",
    );
    expect(() =>
      createApp({
        framework: { runtime: { ...manifest, pages: null } } as never,
      }),
    ).toThrow("[evjs] createApp() framework.runtime.pages must be an object.");

    const renderingManifest = createManifest();
    renderingManifest.pages.dashboard.rendering = {
      component: "server",
      html: "server",
      streaming: "yes",
      hydrate: "load",
    } as never;
    expect(() =>
      createApp({ framework: { runtime: renderingManifest } }),
    ).toThrow(
      "[evjs] createApp() framework.runtime.pages.dashboard.rendering.streaming must be a boolean.",
    );

    const pprManifest = createManifest();
    pprManifest.pages.dashboard.ppr = {
      delivery: "stream",
      shell: { js: "dashboard-ppr-shell.js", css: [] } as never,
      regions: {},
    };
    expect(() => createApp({ framework: { runtime: pprManifest } })).toThrow(
      "[evjs] createApp() framework.runtime.pages.dashboard.ppr.shell.js must be an array.",
    );

    expect(() =>
      createApp({
        framework: { runtime: { ...manifest, routes: {} } } as never,
      }),
    ).toThrow("[evjs] createApp() framework.runtime.routes must be an array.");
    expect(() =>
      createApp({
        framework: {
          runtime: {
            ...manifest,
            routes: [{ id: "dashboard", path: "dashboard" }],
          },
        } as never,
      }),
    ).toThrow(
      '[evjs] createApp() framework.runtime.routes[0].path must start with "/".',
    );
    expect(() =>
      createApp({
        framework: {
          runtime: {
            ...manifest,
            routes: [{ id: "missing", path: "/missing", pageId: "missing" }],
          },
        } as never,
      }),
    ).toThrow(
      '[evjs] createApp() framework.runtime.routes[0].pageId "missing" does not match any runtime.pages entry.',
    );
    expect(() =>
      createApp({
        framework: {
          runtime: {
            ...manifest,
            runtime: { server: "runtime" },
          },
        } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.runtime.runtime.server must be an object.",
    );
    expect(() =>
      createApp({
        framework: {
          runtime: {
            ...manifest,
            runtime: { ...manifest.runtime, transport: [] },
          },
        } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.runtime.runtime.transport must be an object.",
    );
    expect(() =>
      createApp({
        framework: {
          runtime: {
            ...manifest,
            runtime: { server: { fn: "__evjs/fn" } },
          },
        } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.runtime.runtime.server.basePath must be a non-empty pathname.",
    );
    expect(() =>
      createApp({
        framework: {
          runtime: {
            ...manifest,
            runtime: {
              server: {
                basePath: "/__evjs",
                fn: "__evjs/fn?debug=1",
              },
            },
          },
        } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.runtime.runtime.server.fn must not include a query string or hash.",
    );
    expect(() =>
      createApp({
        framework: {
          runtime: {
            ...manifest,
            runtime: {
              server: {
                basePath: "/__evjs",
                fn: "__evjs/fn",
                ppr: " /__evjs/ppr ",
              },
            },
          },
        } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.runtime.runtime.server.ppr must not contain leading or trailing whitespace.",
    );
    expect(() =>
      createApp({
        framework: {
          runtime: {
            ...manifest,
            runtime: {
              server: {
                basePath: "/__evjs",
                fn: "__evjs/fn",
                rsc: "__evjs/rsc?flight=1",
              },
            },
          },
        } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.runtime.runtime.server.rsc must not include a query string or hash.",
    );
    expect(() =>
      createApp({
        framework: {
          runtime: {
            ...manifest,
            server: { renderers: [] },
          },
        } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.runtime.server.renderers must be an object.",
    );
    expect(() =>
      createApp({
        framework: {
          runtime: {
            ...manifest,
            server: {
              assets: { js: [], css: [] },
              renderers: {
                "dashboard.server": {
                  kind: "page-server",
                  assets: { js: [], css: [] },
                },
              },
            },
          },
        } as never,
      }),
    ).toThrow(
      '[evjs] createApp() framework.runtime.server.renderers key "dashboard.server" must contain only letters, numbers, underscores, or hyphens.',
    );
    expect(() =>
      createApp({
        framework: { runtime: { ...manifest, rsc: "rsc" } } as never,
      }),
    ).toThrow("[evjs] createApp() framework.runtime.rsc must be an object.");
    const rscManifest = createManifest();
    rscManifest.rsc = {
      pages: {
        dashboard: {
          renderer: "dashboard-rsc",
          assets: { js: [], css: [""] } as never,
        },
      },
    };
    expect(() => createApp({ framework: { runtime: rscManifest } })).toThrow(
      "[evjs] createApp() framework.runtime.rsc.pages.dashboard.assets.css must contain only non-empty strings.",
    );

    const publicRscManifest = createManifest();
    configureRscPage(publicRscManifest);
    publicRscManifest.rsc = {
      pages: {
        dashboard: {
          renderer: "dashboard-rsc",
          assets: { js: ["dashboard-rsc.js"], css: [] },
        },
      },
    };
    expect(() =>
      createApp({
        framework: {
          runtime: publicRscManifest,
          render: () => new Response("ok"),
        },
      }),
    ).not.toThrow();

    expect(() =>
      createApp({
        framework: { runtime: manifest, render: "render" } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.render must be a render function or coordinator object.",
    );
    expect(() =>
      createApp({
        framework: { runtime: manifest, rsc: { match: () => true } } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.rsc must be an RSC Flight function or coordinator object.",
    );
    expect(() =>
      createApp({ framework: { runtime: manifest, ppr: [] } as never }),
    ).toThrow("[evjs] createApp() framework.ppr must be an object.");
    expect(() =>
      createApp({
        framework: {
          runtime: manifest,
          ppr: { regionCache: { get: () => undefined } },
        } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.ppr.regionCache must provide get() and set() methods.",
    );
    expect(() =>
      createApp({
        framework: {
          runtime: manifest,
          ppr: {
            regionCache: {
              get: () => undefined,
              set: () => {},
              delete: "delete",
            },
          },
        } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.ppr.regionCache.delete must be a function when provided.",
    );
    expect(() =>
      createApp({
        framework: {
          runtime: manifest,
          ppr: { staleWhileRevalidate: 1.5 },
        } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.ppr.staleWhileRevalidate must be a positive integer number of seconds.",
    );
    expect(() =>
      createApp({
        framework: {
          runtime: manifest,
          allowPageRenderRequest: "allow",
        } as never,
      }),
    ).toThrow(
      "[evjs] createApp() framework.allowPageRenderRequest must be a function.",
    );
  });

  it("rejects invalid app route handler shapes", () => {
    expect(() => createApp({ routes: [null as never] })).toThrow(
      "[evjs] createApp() routes[0] must be a route handler object.",
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET"],
          },
        ],
      }),
    ).toThrow("[evjs] createApp() routes[0].path must be a non-empty string.");
    expect(() =>
      createApp({
        routes: [
          {
            path: "api/items",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET"],
          } as never,
        ],
      }),
    ).toThrow('[evjs] createApp() routes[0].path must start with "/".');
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items ",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET"],
          } as never,
        ],
      }),
    ).toThrow("[evjs] createApp() routes[0].path must not contain whitespace.");
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items?filter=all",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET"],
          } as never,
        ],
      }),
    ).toThrow(
      "[evjs] createApp() routes[0].path must not include a query string or hash.",
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items/:",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET"],
          } as never,
        ],
      }),
    ).toThrow(
      '[evjs] createApp() routes[0].path contains dynamic segment ":" without a param name.',
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items/:constructor",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET"],
          } as never,
        ],
      }),
    ).toThrow(
      '[evjs] createApp() routes[0].path uses reserved dynamic param name "constructor" in segment ":constructor". Use a safe application-specific name.',
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/users/:userId/posts/:userId",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET"],
          } as never,
        ],
      }),
    ).toThrow(
      '[evjs] createApp() routes[0].path uses duplicate dynamic param name "userId" in segment ":userId". Use unique param names within one route path.',
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items",
            methods: null,
            middlewares: [],
            allowedMethods: ["GET"],
          } as never,
        ],
      }),
    ).toThrow("[evjs] createApp() routes[0].methods must be an object map.");
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items",
            methods: { get: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET"],
          } as never,
        ],
      }),
    ).toThrow(
      "[evjs] createApp() routes[0].methods.get is not a supported HTTP method.",
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items",
            methods: { GET: "not a function" },
            middlewares: [],
            allowedMethods: ["GET"],
          } as never,
        ],
      }),
    ).toThrow("[evjs] createApp() routes[0].methods.GET must be a function.");
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items",
            methods: {},
            middlewares: [],
            allowedMethods: ["GET"],
          } as never,
        ],
      }),
    ).toThrow(
      "[evjs] createApp() routes[0].methods must include at least one HTTP method handler.",
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items",
            methods: { GET: async () => new Response("ok") },
            middlewares: [null],
            allowedMethods: ["GET"],
          } as never,
        ],
      }),
    ).toThrow(
      "[evjs] createApp() routes[0].middlewares must be an array of middleware functions.",
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["CONNECT"],
          } as never,
        ],
      }),
    ).toThrow(
      "[evjs] createApp() routes[0].allowedMethods must be a non-empty array of supported HTTP methods.",
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["POST"],
          } as never,
        ],
      }),
    ).toThrow(
      '[evjs] createApp() routes[0].allowedMethods must include method handler "GET".',
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET", "GET"],
          } as never,
        ],
      }),
    ).toThrow(
      '[evjs] createApp() routes[0].allowedMethods must not contain duplicate method "GET".',
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET", "POST"],
          } as never,
        ],
      }),
    ).toThrow(
      '[evjs] createApp() routes[0].allowedMethods includes method "POST" without a handler.',
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET"],
          },
          {
            path: "/api/items",
            methods: { POST: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["POST"],
          },
        ],
      }),
    ).toThrow(
      '[evjs] createApp() routes[1].path duplicates route path "/api/items".',
    );
    expect(() =>
      createApp({
        routes: [
          {
            path: "/api/items/:id",
            methods: { GET: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["GET"],
          },
          {
            path: "/api/items/:itemId",
            methods: { POST: async () => new Response("ok") },
            middlewares: [],
            allowedMethods: ["POST"],
          },
        ],
      }),
    ).toThrow(
      '[evjs] createApp() routes[1].path has the same route shape as routes[0].path "/api/items/:id". Use one route handler per URL shape.',
    );
  });

  it("logs server requests through the request logger middleware", async () => {
    const manifest = createManifest();
    const clockValues = [10, 22.345];
    const logs: Array<{ message: string; status: number; path: string }> = [];
    const app = createApp({
      middlewares: [
        requestLogger({
          includeSearch: true,
          clock: () => clockValues.shift() ?? 22.345,
          logger(message, entry) {
            logs.push({
              message,
              status: entry.status,
              path: entry.path,
            });
          },
        }),
      ],
      framework: {
        runtime: manifest,
        render(ctx) {
          return `<h1>${ctx.pageId}</h1>`;
        },
      },
    });

    const res = await app.request("/dashboard?trace=1");

    expect(res.status).toBe(200);
    expect(logs).toEqual([
      {
        message: "[evjs:server] GET /dashboard?trace=1 200 12.35ms",
        status: 200,
        path: "/dashboard?trace=1",
      },
    ]);
  });

  it("routes framework page requests through the server render coordinator", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
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

  it("reports page render request guard exceptions with evjs context", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
        allowPageRenderRequest() {
          throw new Error("guard exploded");
        },
        render() {
          return "<h1>unreachable</h1>";
        },
      },
    });

    const res = await app.request("/dashboard");
    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toContain(
      "[evjs] framework.allowPageRenderRequest failed: guard exploded",
    );

    const head = await app.request("/dashboard", { method: "HEAD" });
    expect(head.status).toBe(500);
    expect(await head.text()).toBe("");
  });

  it("uses explicit page render guard responses", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
        allowPageRenderRequest() {
          return new Response("blocked by guard", {
            status: 403,
            headers: { "x-evjs-guard": "blocked" },
          });
        },
        render() {
          return "<h1>unreachable</h1>";
        },
      },
    });

    const res = await app.request("/dashboard");
    expect(res.status).toBe(403);
    expect(res.headers.get("x-evjs-guard")).toBe("blocked");
    await expect(res.text()).resolves.toBe("blocked by guard");

    const head = await app.request("/dashboard", { method: "HEAD" });
    expect(head.status).toBe(403);
    expect(head.headers.get("x-evjs-guard")).toBe("blocked");
    expect(await head.text()).toBe("");
  });

  it("awaits async page render request guard results", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
        async allowPageRenderRequest(request) {
          return request.headers.get("x-evjs-render") === "1";
        },
        render(ctx) {
          return `<h1>${ctx.pageId}</h1>`;
        },
      },
    });

    const skipped = await app.request("/dashboard");
    const allowed = await app.request("/dashboard", {
      headers: { "x-evjs-render": "1" },
    });

    expect(skipped.status).toBe(404);
    expect(allowed.status).toBe(200);
    await expect(allowed.text()).resolves.toBe("<h1>dashboard</h1>");
  });

  it("awaits async page render request guard responses", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
        async allowPageRenderRequest() {
          return new Response("async guard blocked", {
            status: 401,
            headers: { "x-evjs-guard": "async" },
          });
        },
        render() {
          return "<h1>unreachable</h1>";
        },
      },
    });

    const res = await app.request("/dashboard");
    expect(res.status).toBe(401);
    expect(res.headers.get("x-evjs-guard")).toBe("async");
    await expect(res.text()).resolves.toBe("async guard blocked");

    const head = await app.request("/dashboard", { method: "HEAD" });
    expect(head.status).toBe(401);
    expect(head.headers.get("x-evjs-guard")).toBe("async");
    expect(await head.text()).toBe("");
  });

  it("reports invalid page render request guard results", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
        allowPageRenderRequest() {
          return "yes" as never;
        },
        render() {
          return "<h1>unreachable</h1>";
        },
      },
    });

    const res = await app.request("/dashboard");
    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toContain(
      "[evjs] framework.allowPageRenderRequest must return a boolean or Response.",
    );

    const head = await app.request("/dashboard", { method: "HEAD" });
    expect(head.status).toBe(500);
    expect(await head.text()).toBe("");
  });

  it("reports invalid framework render results", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
        render() {
          return null as never;
        },
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(501);
    await expect(res.text()).resolves.toContain(
      "[evjs] Framework render coordinator returned an invalid result. Expected Response, string, or { html, status?, headers? }.",
    );
  });

  it("reports invalid framework render result metadata", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
        render() {
          return { html: "no body status", status: 204 } as never;
        },
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(501);
    await expect(res.text()).resolves.toContain(
      "[evjs] Framework render coordinator status must be an integer HTTP status between 200 and 599 that can include an HTML body.",
    );
  });

  it("serves framework page HEAD requests without a response body", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
        render(ctx) {
          return {
            html: `<h1>${ctx.pageId}:${ctx.page?.render}</h1>`,
            headers: { "x-render": "framework" },
          };
        },
      },
    });

    const res = await app.request("/dashboard", { method: "HEAD" });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("x-render")).toBe("framework");
    expect(await res.text()).toBe("");
  });

  it("matches page renderers for RSC page document requests", async () => {
    const manifest = createManifest();
    configureRscPage(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-server": {
              kind: "page-server",
              owner: { pageId: "dashboard" },
              load: async () => ({
                render(ctx: ServerRenderContext) {
                  return `<h1>${ctx.pageId}:${ctx.page?.render}:${ctx.page?.componentModel}</h1>`;
                },
              }),
            },
          },
        }),
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>dashboard:ssr:rsc</h1>");
  });

  it("matches dynamic runtime routes for framework rendering", async () => {
    const manifest = createManifest();
    manifest.pages.orderDetail = {
      assets: { js: [], css: [] },
      render: "ssr",
      rendering: {
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
        runtime: manifest,
        render(ctx) {
          return `<h1>${ctx.route?.id}:${ctx.pageId}</h1>`;
        },
      },
    });

    const res = await app.request("/orders/123");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>order.detail:orderDetail</h1>");
  });

  it("prefers the most specific runtime route for framework rendering", async () => {
    const manifest = createManifest();
    manifest.pages.user = {
      assets: { js: [], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
    };
    manifest.pages.userSettings = {
      assets: { js: [], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "server",
        streaming: false,
        hydrate: "load",
      },
    };
    manifest.routes.push(
      {
        id: "user",
        path: "/users/$userId",
        pageId: "user",
      },
      {
        id: "user.settings",
        path: "/users/settings",
        pageId: "userSettings",
      },
    );
    const app = createApp({
      framework: {
        runtime: manifest,
        render(ctx) {
          return `<h1>${ctx.route?.id}:${ctx.pageId}</h1>`;
        },
      },
    });

    const res = await app.request("/users/settings");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>user.settings:userSettings</h1>");
  });

  it("accepts a server render coordinator", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
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

  it("reports invalid framework render coordinator matches", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
        render: {
          match() {
            return true as never;
          },
          render() {
            return "<h1>unreachable</h1>";
          },
        },
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(501);
    await expect(res.text()).resolves.toContain(
      "[evjs] Framework render coordinator match() must return a render context or undefined.",
    );
  });

  it("reports framework render coordinator match exceptions with evjs context", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
        render: {
          match() {
            throw new Error("match exploded");
          },
          render() {
            return "<h1>unreachable</h1>";
          },
        },
      },
    });

    const res = await app.request("/dashboard");
    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toContain(
      "[evjs] Framework render coordinator match failed: match exploded",
    );

    const head = await app.request("/dashboard", { method: "HEAD" });
    expect(head.status).toBe(500);
    expect(await head.text()).toBe("");
  });

  it("reports framework render coordinator render exceptions with evjs context", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
        render: {
          render() {
            throw new Error("render exploded");
          },
        },
      },
    });

    const res = await app.request("/dashboard");
    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toContain(
      "[evjs] Framework render coordinator render failed: render exploded",
    );

    const head = await app.request("/dashboard", { method: "HEAD" });
    expect(head.status).toBe(500);
    expect(await head.text()).toBe("");
  });

  it("loads framework render modules from explicit renderer entries", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
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

  it("retries framework render module loads after transient failures", async () => {
    const manifest = createManifest();
    let loadCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-server": {
              kind: "page-server",
              owner: { pageId: "dashboard" },
              async load() {
                loadCount += 1;
                if (loadCount === 1) {
                  throw new Error("temporary module load failure");
                }
                const loadedAt = loadCount;
                return {
                  render(ctx: ServerRenderContext) {
                    return `<h1>${ctx.pageId}:loaded-${loadedAt}</h1>`;
                  },
                };
              },
            },
          },
        }),
      },
    });

    const first = await app.request("/dashboard");
    const second = await app.request("/dashboard");
    const third = await app.request("/dashboard");

    expect(first.status).toBe(500);
    await expect(first.text()).resolves.toContain(
      "[evjs] Framework render coordinator render failed: temporary module load failure",
    );
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("<h1>dashboard:loaded-2</h1>");
    expect(third.status).toBe(200);
    expect(await third.text()).toBe("<h1>dashboard:loaded-2</h1>");
    expect(loadCount).toBe(2);
  });

  it("uses the PPR shell renderer for PPR pages", async () => {
    const manifest = createManifest();
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
    configurePprRendering(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
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
      "<main><h1>ssr:dashboard</h1><p>dashboard:hero</p></main>",
    );

    const region = await app.request("/__evjs/ppr/dashboard/hero");

    expect(region.status).toBe(200);
    expect(await region.text()).toBe("<p>dashboard:hero</p>");

    const regionHead = await app.request("/__evjs/ppr/dashboard/hero", {
      method: "HEAD",
    });

    expect(regionHead.status).toBe(200);
    expect(regionHead.headers.get("x-evjs-page")).toBe("dashboard");
    expect(regionHead.headers.get("x-evjs-ppr-region")).toBe("hero");
    expect(await regionHead.text()).toBe("");
  });

  it("passes and validates the source page URL for direct PPR region requests", async () => {
    const manifest = createManifest();
    manifest.pages.order = {
      assets: { js: [], css: [] },
      render: "ssr",
      rendering: {
        component: "server",
        html: "partial",
        prerender: "partial",
        streaming: false,
        hydrate: "none",
      },
      ppr: {
        delivery: "merge",
        shell: { js: ["order-ppr-shell.js"], css: [] },
        regions: {
          details: {
            id: "details",
            assets: { js: ["order-details-ppr-region.js"], css: [] },
            cache: { revalidate: 60 },
          },
        },
      },
    };
    manifest.routes.push({
      id: "order",
      path: "/orders/$orderId",
      pageId: "order",
    });
    let renderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "order-details-region": {
              kind: "ppr-region",
              owner: { pageId: "order", regionId: "details" },
              load: async () => ({
                default(ctx: ServerRenderContext) {
                  const pageUrl = ctx.pageUrl
                    ? new URL(ctx.pageUrl)
                    : undefined;
                  return `<p>${++renderCount}:${pageUrl?.pathname}${pageUrl?.search}</p>`;
                },
              }),
            },
          },
        }),
      },
    });

    const first = await app.request(
      "/__evjs/ppr/order/details?url=%2Forders%2F42%3Ftab%3Dopen",
    );
    const second = await app.request(
      "/__evjs/ppr/order/details?url=%2Forders%2F42%3Ftab%3Dopen",
    );
    const third = await app.request(
      "/__evjs/ppr/order/details?url=%2Forders%2F43%3Ftab%3Dopen",
    );
    const invalid = await app.request(
      "/__evjs/ppr/order/details?url=%2Fdashboard",
    );
    const missingUrl = await app.request("/__evjs/ppr/order/details");

    expect(first.status).toBe(200);
    expect(first.headers.get("x-evjs-cache")).toBe("MISS");
    expect(await first.text()).toBe("<p>1:/orders/42?tab=open</p>");
    expect(second.headers.get("x-evjs-cache")).toBe("HIT");
    expect(await second.text()).toBe("<p>1:/orders/42?tab=open</p>");
    expect(third.headers.get("x-evjs-cache")).toBe("MISS");
    expect(await third.text()).toBe("<p>2:/orders/43?tab=open</p>");
    expect(invalid.status).toBe(400);
    await expect(invalid.text()).resolves.toContain(
      'PPR region request url does not match page "order"',
    );
    expect(missingUrl.status).toBe(400);
    await expect(missingUrl.text()).resolves.toContain(
      'PPR region request url is required for page "order"',
    );
    expect(renderCount).toBe(2);
  });

  it("leaves PPR page responses with non-html media types unchanged", async () => {
    const manifest = createManifest();
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
    configurePprRendering(manifest);
    let regionRenderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-ppr-shell": {
              kind: "ppr-shell",
              owner: { pageId: "dashboard" },
              load: async () => ({
                default() {
                  return new Response(
                    '<main><div data-evjs-ppr-region="hero">fallback</div></main>',
                    {
                      headers: {
                        "Content-Type": "application/text/html",
                      },
                    },
                  );
                },
              }),
            },
            "dashboard-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () => `<p>${++regionRenderCount}</p>`,
              }),
            },
          },
        }),
      },
    });

    const res = await app.request("/dashboard");
    const head = await app.request("/dashboard", { method: "HEAD" });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/text/html");
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(res.headers.get("x-evjs-ppr")).toBeNull();
    expect(await res.text()).toBe(
      '<main><div data-evjs-ppr-region="hero">fallback</div></main>',
    );
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Type")).toBe("application/text/html");
    expect(head.headers.get("Cache-Control")).toBeNull();
    expect(head.headers.get("x-evjs-ppr")).toBeNull();
    expect(await head.text()).toBe("");
    expect(regionRenderCount).toBe(0);
  });

  it("merges PPR regions into React Suspense fallback boundaries", async () => {
    const manifest = createManifest();
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
    configurePprRendering(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-ppr-shell": {
              kind: "ppr-shell",
              owner: { pageId: "dashboard" },
              load: async () => ({
                default() {
                  return [
                    "<main>",
                    "<h1>dashboard</h1>",
                    '<!--$!--><template data-msg="lazy"></template>',
                    "<div>fallback</div><!--/$-->",
                    "</main>",
                  ].join("");
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
      "<main><h1>dashboard</h1><p>dashboard:hero</p></main>",
    );
  });

  it("streams PPR page shells and patches Suspense fallback boundaries", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "stream",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
        },
      },
    };
    configurePprRendering(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-ppr-shell": {
              kind: "ppr-shell",
              owner: { pageId: "dashboard" },
              load: async () => ({
                default() {
                  return [
                    "<!doctype html><html><body><main>",
                    "<h1>dashboard</h1>",
                    '<!--$!--><template data-msg="lazy"></template>',
                    "<div>fallback</div><!--/$-->",
                    "</main></body></html>",
                  ].join("");
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
    expect(res.headers.get("x-evjs-ppr")).toBe("stream");
    const html = await res.text();
    expect(html).toContain("<div>fallback</div>");
    expect(html).toContain('data-evjs-ppr-stream-region="hero"');
    expect(html).toContain("dashboard:hero");
    expect(html).toContain("</body></html>");
  });

  it("derives merged PPR page cache headers from region revalidate policies", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          cache: { revalidate: 60 },
        },
        inventory: {
          id: "inventory",
          assets: { js: ["dashboard-inventory-ppr-region.js"], css: [] },
          cache: { revalidate: 15 },
        },
      },
    };
    configurePprRendering(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-ppr-shell": {
              kind: "ppr-shell",
              owner: { pageId: "dashboard" },
              load: async () => ({
                default() {
                  return [
                    "<main>",
                    '<div data-evjs-ppr-region="hero">hero fallback</div>',
                    '<div data-evjs-ppr-region="inventory">inventory fallback</div>',
                    "</main>",
                  ].join("");
                },
              }),
            },
            "dashboard-hero-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () => "<p>hero</p>",
              }),
            },
            "dashboard-inventory-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "inventory" },
              load: async () => ({
                default: () => "<p>inventory</p>",
              }),
            },
          },
        }),
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("s-maxage=15");
    expect(res.headers.get("x-evjs-ppr")).toBe("merged");
    expect(await res.text()).toBe("<main><p>hero</p><p>inventory</p></main>");
  });

  it("sets no-store cache headers on PPR pages with dynamic regions", async () => {
    const manifest = createManifest();
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
    configurePprRendering(manifest);
    let regionRenderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-ppr-shell": {
              kind: "ppr-shell",
              owner: { pageId: "dashboard" },
              load: async () => ({
                default() {
                  return '<main><div data-evjs-ppr-region="hero">fallback</div></main>';
                },
              }),
            },
            "dashboard-hero-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () => `<p>${++regionRenderCount}</p>`,
              }),
            },
          },
        }),
      },
    });

    const page = await app.request("/dashboard");
    const head = await app.request("/dashboard", { method: "HEAD" });

    expect(page.status).toBe(200);
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    expect(page.headers.get("x-evjs-ppr")).toBe("merged");
    expect(await page.text()).toBe("<main><p>1</p></main>");
    expect(head.status).toBe(200);
    expect(head.headers.get("Cache-Control")).toBe("no-store");
    expect(await head.text()).toBe("");
    expect(regionRenderCount).toBe(1);
  });

  it("preserves explicit PPR shell cache headers", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          cache: { revalidate: 60 },
        },
      },
    };
    configurePprRendering(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-ppr-shell": {
              kind: "ppr-shell",
              owner: { pageId: "dashboard" },
              load: async () => ({
                default() {
                  return new Response(
                    '<main><div data-evjs-ppr-region="hero">fallback</div></main>',
                    {
                      headers: {
                        "Cache-Control": "private, max-age=5",
                        "Content-Type": "text/html; charset=utf-8",
                      },
                    },
                  );
                },
              }),
            },
            "dashboard-hero-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () => "<p>hero</p>",
              }),
            },
          },
        }),
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=5");
    expect(await res.text()).toBe("<main><p>hero</p></main>");
  });

  it("derives streamed PPR page cache headers from region revalidate policies", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "stream",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          cache: { revalidate: 30 },
        },
      },
    };
    configurePprRendering(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-ppr-shell": {
              kind: "ppr-shell",
              owner: { pageId: "dashboard" },
              load: async () => ({
                default() {
                  return [
                    "<!doctype html><html><body><main>",
                    '<div data-evjs-ppr-region="hero">fallback</div>',
                    "</main></body></html>",
                  ].join("");
                },
              }),
            },
            "dashboard-hero-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () => "hero patch",
              }),
            },
          },
        }),
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("s-maxage=30");
    expect(res.headers.get("x-evjs-ppr")).toBe("stream");
    const html = await res.text();
    expect(html).toContain('data-evjs-ppr-stream-region="hero"');
    expect(html).toContain("hero patch");
  });

  it("adds stale-while-revalidate to PPR page cache headers when configured", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          cache: { revalidate: 45 },
        },
      },
    };
    configurePprRendering(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        ppr: { staleWhileRevalidate: 10 },
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-ppr-shell": {
              kind: "ppr-shell",
              owner: { pageId: "dashboard" },
              load: async () => ({
                default() {
                  return '<main><div data-evjs-ppr-region="hero">fallback</div></main>';
                },
              }),
            },
            "dashboard-hero-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () => "<p>hero</p>",
              }),
            },
          },
        }),
      },
    });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "s-maxage=45, stale-while-revalidate=10",
    );
    expect(await res.text()).toBe("<main><p>hero</p></main>");
  });

  it("normalizes PPR region document responses into fragments", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          cache: "no-store",
        },
      },
    };
    configurePprRendering(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
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

  it("leaves PPR region responses with non-html media types unchanged", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          cache: "no-store",
        },
      },
    };
    configurePprRendering(manifest);
    const body = [
      "<!doctype html>",
      "<html><body>",
      '<div id="app"><section><div>Hero fragment</div></section></div>',
      "</body></html>",
    ].join("");
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-hero-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () =>
                  new Response(body, {
                    headers: {
                      "Content-Type": "application/text/html",
                    },
                  }),
              }),
            },
          },
        }),
      },
    });

    const region = await app.request("/__evjs/ppr/dashboard/hero");

    expect(region.status).toBe(200);
    expect(region.headers.get("Content-Type")).toBe("application/text/html");
    expect(region.headers.get("x-evjs-page")).toBe("dashboard");
    expect(region.headers.get("x-evjs-ppr-region")).toBe("hero");
    expect(await region.text()).toBe(body);
  });

  it("skips non-html PPR regions during merged page composition", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          cache: "no-store",
        },
      },
    };
    configurePprRendering(manifest);
    let regionRenderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-ppr-shell": {
              kind: "ppr-shell",
              owner: { pageId: "dashboard" },
              load: async () => ({
                default() {
                  return '<main><div data-evjs-ppr-region="hero">fallback</div></main>';
                },
              }),
            },
            "dashboard-hero-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () => Response.json({ region: ++regionRenderCount }),
              }),
            },
          },
        }),
      },
    });

    const page = await app.request("/dashboard");
    const region = await app.request("/__evjs/ppr/dashboard/hero");

    expect(page.status).toBe(200);
    expect(page.headers.get("x-evjs-ppr")).toBeNull();
    expect(await page.text()).toBe(
      '<main><div data-evjs-ppr-region="hero">fallback</div></main>',
    );
    expect(region.status).toBe(200);
    expect(region.headers.get("Content-Type")).toContain("application/json");
    expect(await region.json()).toEqual({ region: 2 });
    expect(regionRenderCount).toBe(2);
  });

  it("skips non-html PPR regions during streamed page composition", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "stream",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          cache: "no-store",
        },
      },
    };
    configurePprRendering(manifest);
    let regionRenderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-ppr-shell": {
              kind: "ppr-shell",
              owner: { pageId: "dashboard" },
              load: async () => ({
                default() {
                  return [
                    "<!doctype html><html><body><main>",
                    '<div data-evjs-ppr-region="hero">fallback</div>',
                    "</main></body></html>",
                  ].join("");
                },
              }),
            },
            "dashboard-hero-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () => Response.json({ region: ++regionRenderCount }),
              }),
            },
          },
        }),
      },
    });

    const page = await app.request("/dashboard");

    expect(page.status).toBe(200);
    expect(page.headers.get("x-evjs-ppr")).toBe("stream");
    const html = await page.text();
    expect(html).toContain('<div data-evjs-ppr-region="hero">fallback</div>');
    expect(html).not.toContain('data-evjs-ppr-stream-region="hero"');
    expect(html).not.toContain('"region"');
    expect(html).toContain("</body></html>");
    expect(regionRenderCount).toBe(1);
  });

  it("requires exact PPR region endpoint paths", async () => {
    const manifest = createManifest();
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
    configurePprRendering(manifest);
    let renderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-hero-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "hero" },
              load: async () => ({
                default: () => {
                  renderCount += 1;
                  return "<p>hero</p>";
                },
              }),
            },
          },
        }),
      },
    });

    const extraSegment = await app.request("/__evjs/ppr/dashboard/hero/extra");
    expect(extraSegment.status).toBe(404);
    expect(renderCount).toBe(0);

    const invalidEncoding = await app.request("/__evjs/ppr/dashboard/%E0%A4%A");
    expect(invalidEncoding.status).toBe(400);
    await expect(invalidEncoding.text()).resolves.toContain(
      "PPR region request path contains invalid URL encoding",
    );
    expect(renderCount).toBe(0);

    const encodedSeparator = await app.request(
      "/__evjs/ppr/dashboard/hero%2Fextra",
    );
    expect(encodedSeparator.status).toBe(400);
    await expect(encodedSeparator.text()).resolves.toContain(
      "PPR region request region path segment must not contain separators",
    );
    expect(renderCount).toBe(0);

    const encodedWhitespace = await app.request(
      "/__evjs/ppr/dash%20board/hero",
    );
    expect(encodedWhitespace.status).toBe(400);
    await expect(encodedWhitespace.text()).resolves.toContain(
      "PPR region request page path segment must not contain separators",
    );
    expect(renderCount).toBe(0);

    const invalidPageId = await app.request("/__evjs/ppr/dash.board/hero");
    expect(invalidPageId.status).toBe(400);
    await expect(invalidPageId.text()).resolves.toContain(
      "PPR region request page path segment must contain only letters, numbers, underscores, or hyphens",
    );
    expect(renderCount).toBe(0);

    const invalidRegionId = await app.request("/__evjs/ppr/dashboard/hero.v1");
    expect(invalidRegionId.status).toBe(400);
    await expect(invalidRegionId.text()).resolves.toContain(
      "PPR region request region path segment must contain only letters, numbers, underscores, or hyphens",
    );
    expect(renderCount).toBe(0);
  });

  it("returns 405 for unsupported PPR region methods", async () => {
    const manifest = createManifest();
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
    configurePprRendering(manifest);
    let renderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
        render() {
          renderCount += 1;
          return "<p>should not render</p>";
        },
      },
    });

    const res = await app.request("/__evjs/ppr/dashboard/hero", {
      method: "POST",
    });

    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toBe("Method Not Allowed");
    expect(renderCount).toBe(0);
  });

  it("reports PPR region render coordinator match exceptions with evjs context", async () => {
    const manifest = createManifest();
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
    configurePprRendering(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        render: {
          match() {
            throw new Error("region match exploded");
          },
          render() {
            return "<p>unreachable</p>";
          },
        },
      },
    });

    const res = await app.request("/__evjs/ppr/dashboard/hero");
    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toContain(
      "[evjs] PPR region render coordinator match failed: region match exploded",
    );

    const head = await app.request("/__evjs/ppr/dashboard/hero", {
      method: "HEAD",
    });
    expect(head.status).toBe(500);
    expect(await head.text()).toBe("");
  });

  it("reports PPR region render coordinator render exceptions with evjs context", async () => {
    const manifest = createManifest();
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
    configurePprRendering(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        render: {
          render() {
            throw new Error("region render exploded");
          },
        },
      },
    });

    const res = await app.request("/__evjs/ppr/dashboard/hero");
    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toContain(
      "[evjs] PPR region render coordinator render failed: region render exploded",
    );

    const head = await app.request("/__evjs/ppr/dashboard/hero", {
      method: "HEAD",
    });
    expect(head.status).toBe(500);
    expect(await head.text()).toBe("");
  });

  it("caches PPR regions with revalidate policy", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        inventory: {
          id: "inventory",
          assets: { js: ["dashboard-inventory-ppr-region.js"], css: [] },
          cache: { revalidate: 60 },
        },
      },
    };
    configurePprRendering(manifest);
    let renderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
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

  it("uses a custom PPR region cache when provided", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        inventory: {
          id: "inventory",
          assets: { js: ["dashboard-inventory-ppr-region.js"], css: [] },
          cache: { revalidate: 60 },
        },
      },
    };
    configurePprRendering(manifest);
    const entries = new Map<string, PprRegionCacheEntry>();
    const regionCache = {
      get: vi.fn((key: string) => entries.get(key)),
      set: vi.fn((key: string, entry: PprRegionCacheEntry) => {
        entries.set(key, entry);
      }),
    };
    let renderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
        ppr: { regionCache },
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

    expect(first.headers.get("x-evjs-cache")).toBe("MISS");
    expect(await first.text()).toBe("<p>1</p>");
    expect(second.headers.get("x-evjs-cache")).toBe("HIT");
    expect(await second.text()).toBe("<p>1</p>");
    expect(renderCount).toBe(1);
    expect(regionCache.get).toHaveBeenCalledTimes(2);
    expect(regionCache.set).toHaveBeenCalledTimes(1);
  });

  it("serves stale PPR regions while refreshing the cache", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        inventory: {
          id: "inventory",
          assets: { js: ["dashboard-inventory-ppr-region.js"], css: [] },
          cache: { revalidate: 60 },
        },
      },
    };
    configurePprRendering(manifest);
    const encoder = new TextEncoder();
    let entry: PprRegionCacheEntry | undefined = {
      expiresAt: Date.now() - 1_000,
      staleUntil: Date.now() + 60_000,
      status: 200,
      statusText: "",
      headers: [
        ["cache-control", "s-maxage=60, stale-while-revalidate=30"],
        ["content-type", "text/html; charset=utf-8"],
      ],
      body: encoder.encode("<p>stale</p>").buffer,
    };
    let resolveUpdated!: (entry: PprRegionCacheEntry) => void;
    const updated = new Promise<PprRegionCacheEntry>((resolve) => {
      resolveUpdated = resolve;
    });
    const regionCache = {
      get: vi.fn(() => entry),
      set: vi.fn((_key: string, nextEntry: PprRegionCacheEntry) => {
        entry = nextEntry;
        resolveUpdated(nextEntry);
      }),
      delete: vi.fn(() => {
        entry = undefined;
      }),
    };
    let renderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
        ppr: { regionCache, staleWhileRevalidate: 30 },
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-inventory-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "inventory" },
              load: async () => ({
                default: () => `<p>fresh-${++renderCount}</p>`,
              }),
            },
          },
        }),
      },
    });

    const stale = await app.request("/__evjs/ppr/dashboard/inventory");

    expect(stale.headers.get("x-evjs-cache")).toBe("STALE");
    expect(await stale.text()).toBe("<p>stale</p>");
    const refreshed = await updated;
    expect(new TextDecoder().decode(refreshed.body)).toBe("<p>fresh-1</p>");

    const fresh = await app.request("/__evjs/ppr/dashboard/inventory");

    expect(fresh.headers.get("x-evjs-cache")).toBe("HIT");
    expect(await fresh.text()).toBe("<p>fresh-1</p>");
    expect(regionCache.delete).not.toHaveBeenCalled();
    expect(regionCache.set).toHaveBeenCalledTimes(1);
    expect(renderCount).toBe(1);
  });

  it("renders PPR regions when the custom cache provider fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        inventory: {
          id: "inventory",
          assets: { js: ["dashboard-inventory-ppr-region.js"], css: [] },
          cache: { revalidate: 60 },
        },
      },
    };
    configurePprRendering(manifest);
    const regionCache = {
      get: vi.fn(() => {
        throw new Error("read unavailable");
      }),
      set: vi.fn(() => {
        throw new Error("write unavailable");
      }),
    };
    const app = createApp({
      framework: {
        runtime: manifest,
        ppr: { regionCache },
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-inventory-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "inventory" },
              load: async () => ({
                default: () => "<p>fresh</p>",
              }),
            },
          },
        }),
      },
    });

    try {
      const response = await app.request("/__evjs/ppr/dashboard/inventory");

      expect(response.headers.get("x-evjs-cache")).toBe("MISS");
      expect(await response.text()).toBe("<p>fresh</p>");
      expect(regionCache.get).toHaveBeenCalledTimes(1);
      expect(regionCache.set).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not populate PPR region cache from HEAD misses", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        inventory: {
          id: "inventory",
          assets: { js: ["dashboard-inventory-ppr-region.js"], css: [] },
          cache: { revalidate: 60 },
        },
      },
    };
    configurePprRendering(manifest);
    let renderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createModuleRenderCoordinator({
          renderers: {
            "dashboard-inventory-region": {
              kind: "ppr-region",
              owner: { pageId: "dashboard", regionId: "inventory" },
              load: async () => ({
                default: (ctx: ServerRenderContext) =>
                  `<p>${ctx.request.method}:${++renderCount}</p>`,
              }),
            },
          },
        }),
      },
    });

    const head = await app.request("/__evjs/ppr/dashboard/inventory", {
      method: "HEAD",
    });
    const firstGet = await app.request("/__evjs/ppr/dashboard/inventory");
    const secondGet = await app.request("/__evjs/ppr/dashboard/inventory");

    expect(head.status).toBe(200);
    expect(head.headers.get("Cache-Control")).toBe("s-maxage=60");
    expect(head.headers.get("x-evjs-cache")).toBe("MISS");
    expect(await head.text()).toBe("");
    expect(firstGet.headers.get("x-evjs-cache")).toBe("MISS");
    expect(await firstGet.text()).toBe("<p>GET:2</p>");
    expect(secondGet.headers.get("x-evjs-cache")).toBe("HIT");
    expect(await secondGet.text()).toBe("<p>GET:2</p>");
    expect(renderCount).toBe(2);
  });

  it("serves cached PPR region HEAD requests without rerendering", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        inventory: {
          id: "inventory",
          assets: { js: ["dashboard-inventory-ppr-region.js"], css: [] },
          cache: { revalidate: 60 },
        },
      },
    };
    configurePprRendering(manifest);
    let renderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
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

    const warm = await app.request("/__evjs/ppr/dashboard/inventory");
    const head = await app.request("/__evjs/ppr/dashboard/inventory", {
      method: "HEAD",
    });
    const cached = await app.request("/__evjs/ppr/dashboard/inventory");

    expect(warm.headers.get("x-evjs-cache")).toBe("MISS");
    expect(await warm.text()).toBe("<p>1</p>");
    expect(head.headers.get("Cache-Control")).toBe("s-maxage=60");
    expect(head.headers.get("x-evjs-cache")).toBe("HIT");
    expect(await head.text()).toBe("");
    expect(cached.headers.get("x-evjs-cache")).toBe("HIT");
    expect(await cached.text()).toBe("<p>1</p>");
    expect(renderCount).toBe(1);
  });

  it("does not cache no-store PPR regions", async () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        hero: {
          id: "hero",
          assets: { js: ["dashboard-hero-ppr-region.js"], css: [] },
          cache: "no-store",
        },
      },
    };
    configurePprRendering(manifest);
    let renderCount = 0;
    const app = createApp({
      framework: {
        runtime: manifest,
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

  it("rejects invalid PPR region revalidate policies", () => {
    const manifest = createManifest();
    manifest.pages.dashboard.ppr = {
      delivery: "merge",
      shell: { js: ["dashboard-ppr-shell.js"], css: [] },
      regions: {
        zero: {
          id: "zero",
          assets: { js: ["dashboard-zero-ppr-region.js"], css: [] },
          cache: { revalidate: 0 } as never,
        },
        fractional: {
          id: "fractional",
          assets: { js: ["dashboard-fractional-ppr-region.js"], css: [] },
          cache: { revalidate: 1.5 } as never,
        },
      },
    };
    configurePprRendering(manifest);

    expect(() => createApp({ framework: { runtime: manifest } })).toThrow(
      "[evjs] createApp() framework.runtime.pages.dashboard.ppr.regions.zero.cache.revalidate must be a positive integer number of seconds.",
    );
  });

  it("reports renderer modules that are not server render handlers", async () => {
    const manifest = createManifest();
    const app = createApp({
      framework: {
        runtime: manifest,
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
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toContain(
      'Server renderer "dashboard-server" must export render(ctx) or default(ctx)',
    );
  });

  it("reports unmatched module render coordinators as plain text", async () => {
    const manifest = createManifest();
    const coordinator = createModuleRenderCoordinator({
      renderers: {},
    });
    const ctx: ServerRenderContext = {
      request: new Request("https://example.com/dashboard"),
      runtime: manifest,
      route: manifest.routes[0],
      page: manifest.pages.dashboard,
      pageId: "dashboard",
    };

    const res = await coordinator.render(ctx);

    expect(res).toBeInstanceOf(Response);
    if (!(res instanceof Response)) return;
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toBe(
      "No framework server renderer matched request",
    );
  });

  it("rejects invalid framework render coordinator options", () => {
    const manifest = createManifest();

    expect(() => createModuleRenderCoordinator(null as never)).toThrow(
      "[evjs] createModuleRenderCoordinator() options must be an object.",
    );
    expect(() =>
      createModuleRenderCoordinator({ renderers: [] as never }),
    ).toThrow(
      "[evjs] createModuleRenderCoordinator() renderers must be an object.",
    );
    expect(() =>
      createModuleRenderCoordinator({
        renderers: {
          dashboard: null,
        },
      } as never),
    ).toThrow(
      "[evjs] createModuleRenderCoordinator() renderers.dashboard must be a renderer entry.",
    );
    expect(() =>
      createModuleRenderCoordinator({
        renderers: {
          dashboard: { kind: "page-server", load: "load" },
        },
      } as never),
    ).toThrow(
      "[evjs] createModuleRenderCoordinator() renderers.dashboard.load must be a function.",
    );
    expect(() =>
      createModuleRenderCoordinator({
        renderers: {},
        renderModule: "render",
      } as never),
    ).toThrow(
      "[evjs] createModuleRenderCoordinator() renderModule must be a function.",
    );
    expect(() =>
      createModuleRenderCoordinator({
        renderers: {},
        fallback: "render",
      } as never),
    ).toThrow(
      "[evjs] createModuleRenderCoordinator() fallback must be a render function or coordinator object.",
    );

    expect(() => createFrameworkRenderCoordinator(null as never)).toThrow(
      "[evjs] createFrameworkRenderCoordinator() options must be an object.",
    );
    expect(() =>
      createFrameworkRenderCoordinator({ runtime: null } as never),
    ).toThrow(
      "[evjs] createFrameworkRenderCoordinator() runtime must be an object.",
    );
    expect(() =>
      createFrameworkRenderCoordinator({
        runtime: { ...manifest, version: 2 },
        loadModule: async () => ({}),
      } as never),
    ).toThrow(
      "[evjs] createFrameworkRenderCoordinator() runtime.version must be 1.",
    );
    expect(() =>
      createFrameworkRenderCoordinator({
        runtime: { ...manifest, routes: {} },
        loadModule: async () => ({}),
      } as never),
    ).toThrow(
      "[evjs] createFrameworkRenderCoordinator() runtime.routes must be an array.",
    );
    expect(() =>
      createFrameworkRenderCoordinator({
        runtime: {
          ...manifest,
          server: { renderers: [] },
        },
        loadModule: async () => ({}),
      } as never),
    ).toThrow(
      "[evjs] createFrameworkRenderCoordinator() runtime.server.renderers must be an object.",
    );
    expect(() =>
      createFrameworkRenderCoordinator({
        runtime: manifest,
        loadModule: "load",
      } as never),
    ).toThrow(
      "[evjs] createFrameworkRenderCoordinator() loadModule must be a function.",
    );
    expect(() =>
      createFrameworkRenderCoordinator({
        runtime: manifest,
        loadModule: async () => ({}),
        fallback: "render",
      } as never),
    ).toThrow(
      "[evjs] createFrameworkRenderCoordinator() fallback must be a render function or coordinator object.",
    );
  });

  it("loads renderer modules from runtime assets", async () => {
    const manifest = createManifest();
    manifest.server = {
      renderers: {
        "dashboard-server": {
          kind: "page-server",
          owner: { pageId: "dashboard" },
          assets: { js: ["dashboard-server.js"], css: [] },
        },
      },
    };
    const app = createApp({
      framework: {
        runtime: manifest,
        render: createFrameworkRenderCoordinator({
          runtime: manifest,
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

  it("creates an explicit React framework server from runtime runtime globals", async () => {
    const manifest = createManifest();
    manifest.server = {
      renderers: {
        "dashboard-server": {
          kind: "page-server",
          owner: { pageId: "dashboard" },
          assets: { js: ["dashboard-server.js"], css: [] },
        },
      },
    };
    vi.stubGlobal("__EVJS_FRAMEWORK_RUNTIME__", manifest);
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

  it("reports missing React framework module loaders as plain text", async () => {
    const manifest = createManifest();
    vi.stubGlobal("__EVJS_FRAMEWORK_RUNTIME__", manifest);

    const framework = createReactFrameworkServer();
    if (!framework) throw new Error("Expected framework options");
    const app = createApp({ framework });

    const res = await app.request("/dashboard");

    expect(res.status).toBe(501);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    await expect(res.text()).resolves.toBe(
      "[evjs] Server renderer module loader is not configured.",
    );
  });

  it("rejects invalid React framework server options", () => {
    const manifest = createManifest();

    expect(() => createReactFrameworkServer(null as never)).toThrow(
      "[evjs] createReactFrameworkServer() options must be an object.",
    );
    expect(() =>
      createReactFrameworkServer({ runtime: null as never }),
    ).toThrow("[evjs] createReactFrameworkServer() runtime must be an object.");
    expect(() =>
      createReactFrameworkServer({
        runtime: { ...manifest, runtime: null } as never,
      }),
    ).toThrow(
      "[evjs] createReactFrameworkServer() runtime.runtime must be an object.",
    );
    expect(() =>
      createReactFrameworkServer({
        runtime: { ...manifest, version: 2 } as never,
      }),
    ).toThrow("[evjs] createReactFrameworkServer() runtime.version must be 1.");
    expect(() =>
      createReactFrameworkServer({
        runtime: { ...manifest, pages: null } as never,
      }),
    ).toThrow(
      "[evjs] createReactFrameworkServer() runtime.pages must be an object.",
    );
    expect(() =>
      createReactFrameworkServer({
        runtime: { ...manifest, routes: {} } as never,
      }),
    ).toThrow(
      "[evjs] createReactFrameworkServer() runtime.routes must be an array.",
    );
    expect(() =>
      createReactFrameworkServer({
        runtime: {
          ...manifest,
          runtime: {
            ...manifest.runtime,
            transport: { baseUrl: "https://api.example.com " },
          },
        } as never,
      }),
    ).toThrow(
      "[evjs] createReactFrameworkServer() runtime.runtime.transport.baseUrl must not contain leading or trailing whitespace.",
    );
    expect(() =>
      createReactFrameworkServer({
        runtime: {
          ...manifest,
          server: { renderers: [] },
        } as never,
      }),
    ).toThrow(
      "[evjs] createReactFrameworkServer() runtime.server.renderers must be an object.",
    );
    expect(() =>
      createReactFrameworkServer({
        runtime: { ...manifest, rsc: "rsc" } as never,
      }),
    ).toThrow(
      "[evjs] createReactFrameworkServer() runtime.rsc must be an object.",
    );
    expect(() =>
      createReactFrameworkServer({
        runtime: manifest,
        loadModule: "load",
      } as never),
    ).toThrow(
      "[evjs] createReactFrameworkServer() loadModule must be a function.",
    );
    expect(() =>
      createReactFrameworkServer({
        runtime: manifest,
        renderModule: "render",
      } as never),
    ).toThrow(
      "[evjs] createReactFrameworkServer() renderModule must be a function.",
    );
    expect(() =>
      createReactFrameworkServer({ runtime: manifest, react: null as never }),
    ).toThrow("[evjs] createReactFrameworkServer() react must be an object.");
    expect(() =>
      createReactFrameworkServer({ runtime: manifest, rsc: [] as never }),
    ).toThrow("[evjs] createReactFrameworkServer() rsc must be an object.");
    expect(() =>
      createReactFrameworkServer({
        runtime: manifest,
        fallback: "render",
      } as never),
    ).toThrow(
      "[evjs] createReactFrameworkServer() fallback must be a render function or coordinator object.",
    );
    expect(() =>
      createReactFrameworkServer({
        runtime: manifest,
        rscCoordinator: { match: () => true } as never,
      }),
    ).toThrow(
      "[evjs] createReactFrameworkServer() rscCoordinator must be an RSC Flight function or coordinator object.",
    );
  });

  it("can restrict React framework page rendering to dev proxy requests", async () => {
    const manifest = createManifest();
    manifest.server = {
      renderers: {
        "dashboard-server": {
          kind: "page-server",
          owner: { pageId: "dashboard" },
          assets: { js: ["dashboard-server.js"], css: [] },
        },
      },
    };
    vi.stubGlobal("__EVJS_FRAMEWORK_RUNTIME__", manifest);
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
        runtime: manifest,
        rsc(ctx) {
          const pageUrl = ctx.pageUrl ? new URL(ctx.pageUrl) : undefined;
          return new Response(
            pageUrl ? `${pageUrl.pathname}${pageUrl.search}` : "missing-url",
            {
              headers: { "Content-Type": "text/x-component" },
            },
          );
        },
      },
    });

    const res = await app.request(
      "/__evjs/rsc?page=dashboard&url=%2Fdashboard%3Ftab%3Dstats",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toBe("text/x-component");
    expect(await res.text()).toBe("/dashboard?tab=stats");
  });

  it("does not mount RSC flight handling without a server runtime endpoint", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    if (manifest.runtime.server) {
      delete manifest.runtime.server.rsc;
    }
    const rsc = vi.fn(
      () =>
        new Response("flight", {
          headers: { "Content-Type": "text/x-component" },
        }),
    );

    const app = createApp({
      framework: {
        runtime: manifest,
        rsc,
      },
    });

    const frameworkEndpoint = await app.request("/__evjs/rsc?page=dashboard");
    const customEndpoint = await app.request("/__custom/rsc?page=dashboard");

    expect(frameworkEndpoint.status).toBe(404);
    expect(customEndpoint.status).toBe(404);
    expect(rsc).not.toHaveBeenCalled();
  });

  it("serves RSC flight HEAD requests without a response body", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        rsc() {
          return new Response("flight", {
            headers: {
              "Content-Type": "text/x-component",
              "x-flight": "ok",
            },
          });
        },
      },
    });

    const res = await app.request("/__evjs/rsc?page=dashboard", {
      method: "HEAD",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toBe("text/x-component");
    expect(res.headers.get("x-flight")).toBe("ok");
    expect(await res.text()).toBe("");
  });

  it("preserves explicit RSC flight cache headers", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        rsc() {
          return new Response("flight", {
            headers: {
              "Cache-Control": "s-maxage=30",
              "Content-Type": "text/x-component",
            },
          });
        },
      },
    });

    const res = await app.request("/__evjs/rsc?page=dashboard");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("s-maxage=30");
    expect(res.headers.get("Content-Type")).toBe("text/x-component");
    expect(await res.text()).toBe("flight");
  });

  it("returns 405 for unsupported RSC flight methods", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        rsc() {
          return new Response("flight", {
            headers: { "Content-Type": "text/x-component" },
          });
        },
      },
    });

    const res = await app.request("/__evjs/rsc?page=dashboard", {
      method: "POST",
    });

    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    await expect(res.text()).resolves.toBe("Method Not Allowed");
  });

  it("accepts an RSC coordinator", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
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

  it("reports invalid RSC coordinator match results", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const invalidMatchApp = createApp({
      framework: {
        runtime: manifest,
        rsc: {
          match() {
            return "yes" as never;
          },
          renderFlight() {
            throw new Error("renderFlight should not run");
          },
        },
      },
    });

    const invalidMatch = await invalidMatchApp.request(
      "/__evjs/rsc?page=dashboard",
    );

    expect(invalidMatch.status).toBe(500);
    await expect(invalidMatch.text()).resolves.toContain(
      "[evjs] RSC Flight match failed: [evjs] RSC Flight coordinator match() must return a boolean.",
    );

    const throwingMatchApp = createApp({
      framework: {
        runtime: manifest,
        rsc: {
          match() {
            throw new Error("match exploded");
          },
          renderFlight() {
            throw new Error("renderFlight should not run");
          },
        },
      },
    });

    const throwingMatch = await throwingMatchApp.request(
      "/__evjs/rsc?page=dashboard",
    );

    expect(throwingMatch.status).toBe(500);
    await expect(throwingMatch.text()).resolves.toContain(
      "[evjs] RSC Flight match failed: match exploded",
    );
  });

  it("reports non-Response RSC coordinator results", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        rsc() {
          return null as never;
        },
      },
    });

    const res = await app.request("/__evjs/rsc?page=dashboard");

    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toContain(
      "[evjs] RSC Flight coordinator renderFlight() must return a Response.",
    );
  });

  it("preserves non-success RSC coordinator responses without Flight media type", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        rsc() {
          return new Response("not ready", {
            status: 404,
            headers: { "Content-Type": "text/plain" },
          });
        },
      },
    });

    const res = await app.request("/__evjs/rsc?page=dashboard");

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("text/plain");
    await expect(res.text()).resolves.toBe("not ready");
  });

  it("reports non-Flight RSC coordinator response media types", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        rsc() {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    });

    const res = await app.request("/__evjs/rsc?page=dashboard");

    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toContain(
      '[evjs] RSC Flight coordinator renderFlight() must return Content-Type "text/x-component"; received "application/json".',
    );
  });

  it("reports missing RSC coordinator response media types", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        rsc() {
          return new Response(null);
        },
      },
    });

    const res = await app.request("/__evjs/rsc?page=dashboard");

    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toContain(
      '[evjs] RSC Flight coordinator renderFlight() must return Content-Type "text/x-component"; received missing Content-Type.',
    );
  });

  it("returns explicit RSC request validation errors", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
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

    const unsafePage = await app.request("/__evjs/rsc?page=../dashboard");
    expect(unsafePage.status).toBe(400);
    await expect(unsafePage.text()).resolves.toContain(
      "page query parameter must contain only letters, numbers, underscores, or hyphens",
    );

    const whitespacePage = await app.request("/__evjs/rsc?page=%20dashboard");
    expect(whitespacePage.status).toBe(400);
    await expect(whitespacePage.text()).resolves.toContain(
      "page query parameter must contain only letters, numbers, underscores, or hyphens",
    );

    const unknownPage = await app.request("/__evjs/rsc?page=unknown");
    expect(unknownPage.status).toBe(404);
    await expect(unknownPage.text()).resolves.toContain(
      'RSC page "unknown" is not in the runtime',
    );

    manifest.pages.dashboard.render = "ssr";
    manifest.pages.dashboard.componentModel = "client";
    const nonRscPage = await app.request("/__evjs/rsc?page=dashboard");
    expect(nonRscPage.status).toBe(404);
    await expect(nonRscPage.text()).resolves.toContain(
      'not configured with componentModel: "rsc"',
    );
  });

  it("rejects invalid RSC Flight page url values", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    const app = createApp({
      framework: {
        runtime: manifest,
        rsc() {
          return new Response("flight", {
            headers: { "Content-Type": "text/x-component" },
          });
        },
      },
    });

    const relative = await app.request(
      "/__evjs/rsc?page=dashboard&url=dashboard",
    );
    expect(relative.status).toBe(400);
    await expect(relative.text()).resolves.toContain(
      'url must be an absolute path starting with "/"',
    );

    const crossOrigin = await app.request(
      "/__evjs/rsc?page=dashboard&url=https%3A%2F%2Fevil.example%2Fdashboard",
    );
    expect(crossOrigin.status).toBe(400);
    await expect(crossOrigin.text()).resolves.toContain(
      'url must be an absolute path starting with "/"',
    );

    const hash = await app.request(
      "/__evjs/rsc?page=dashboard&url=%2Fdashboard%23details",
    );
    expect(hash.status).toBe(400);
    await expect(hash.text()).resolves.toContain(
      "url must stay on the same origin and must not include a hash",
    );
  });

  it("rejects RSC Flight page urls that do not match the requested page", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    addRscManifestPage(manifest, {
      pageId: "settings",
      path: "/settings",
      renderer: "settings-rsc",
    });
    const app = createApp({
      framework: {
        runtime: manifest,
        rsc() {
          return new Response("flight", {
            headers: { "Content-Type": "text/x-component" },
          });
        },
      },
    });

    const res = await app.request("/__evjs/rsc?page=dashboard&url=%2Fsettings");

    expect(res.status).toBe(400);
    await expect(res.text()).resolves.toContain(
      'url does not match page "dashboard"',
    );
  });

  it("accepts RSC Flight page urls that match dynamic page routes", async () => {
    const manifest = createManifest();
    configureRscManifest(manifest);
    addRscManifestPage(manifest, {
      pageId: "user",
      path: "/users/$userId",
      renderer: "user-rsc",
    });
    const app = createApp({
      framework: {
        runtime: manifest,
        rsc(ctx) {
          const pageUrl = ctx.pageUrl ? new URL(ctx.pageUrl) : undefined;
          return new Response(pageUrl?.pathname ?? "missing-url", {
            headers: { "Content-Type": "text/x-component" },
          });
        },
      },
    });

    const res = await app.request(
      "/__evjs/rsc?page=user&url=%2Fusers%2F42%3Ftab%3Dprofile",
    );

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("/users/42");
  });

  it("creates a default RSC coordinator from a React framework runtime", async () => {
    const manifest = createManifest();
    configureRscPage(manifest);
    manifest.rsc = {
      pages: {
        dashboard: {
          renderer: "dashboard-rsc",
          assets: { js: ["dashboard-rsc.js"], css: [] },
        },
      },
    };
    manifest.server = {
      renderers: {
        "dashboard-rsc": {
          kind: "rsc-page",
          owner: { pageId: "dashboard" },
          assets: { js: ["dashboard-rsc.js"], css: [] },
        },
        "dashboard-server": {
          kind: "page-server",
          owner: { pageId: "dashboard" },
          assets: { js: ["dashboard-server.js"], css: [] },
        },
      },
    };
    vi.stubGlobal("__EVJS_FRAMEWORK_RUNTIME__", manifest);
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

  it("does not create a default RSC coordinator without a server runtime endpoint", async () => {
    const manifest = createManifest();
    configureRscPage(manifest);
    if (manifest.runtime.server) {
      delete manifest.runtime.server.rsc;
    }
    manifest.rsc = {
      pages: {
        dashboard: {
          renderer: "dashboard-rsc",
          assets: { js: ["dashboard-rsc.js"], css: [] },
        },
      },
    };
    manifest.server = {
      renderers: {
        "dashboard-rsc": {
          kind: "rsc-page",
          owner: { pageId: "dashboard" },
          assets: { js: ["dashboard-rsc.js"], css: [] },
        },
        "dashboard-server": {
          kind: "page-server",
          owner: { pageId: "dashboard" },
          assets: { js: ["dashboard-server.js"], css: [] },
        },
      },
    };
    vi.stubGlobal("__EVJS_FRAMEWORK_RUNTIME__", manifest);
    vi.stubGlobal("__EVJS_SERVER_MODULE_LOADER__", async () => ({
      renderFlight(ctx: { pageId?: string }) {
        return new Response(`manifest-flight:${ctx.pageId}`, {
          headers: {
            "Content-Type": "text/x-component; charset=utf-8",
          },
        });
      },
    }));

    const framework = createReactFrameworkServer();
    if (!framework) throw new Error("Expected framework options");
    expect(framework.rsc).toBeUndefined();
    const app = createApp({ framework });

    const staleEndpoint = await app.request("/__evjs/rsc?page=dashboard");
    const customEndpoint = await app.request("/__custom/rsc?page=dashboard");

    expect(staleEndpoint.status).toBe(404);
    expect(customEndpoint.status).toBe(404);
  });
});

function createManifest(): LegacyFrameworkRuntime {
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

function configureRscManifest(manifest: LegacyFrameworkRuntime): void {
  configureRscPage(manifest);
  manifest.rsc = {
    pages: {
      dashboard: {
        renderer: "dashboard-rsc",
        assets: { js: ["dashboard-rsc.js"], css: [] },
      },
    },
  };
  manifest.server = {
    renderers: {
      "dashboard-rsc": {
        kind: "rsc-page",
        owner: { pageId: "dashboard" },
        assets: { js: ["dashboard-rsc.js"], css: [] },
      },
      "dashboard-server": {
        kind: "page-server",
        owner: { pageId: "dashboard" },
        assets: { js: ["dashboard-server.js"], css: [] },
      },
    },
  };
}

function addRscManifestPage(
  manifest: LegacyFrameworkRuntime,
  options: {
    pageId: string;
    path: string;
    renderer: string;
  },
): void {
  const rscPages = manifest.rsc?.pages;
  const serverRenderers = manifest.server?.renderers;
  if (!rscPages || !serverRenderers) {
    throw new Error("configureRscManifest() must run before adding RSC pages.");
  }

  const rendererAssets = { js: [`${options.renderer}.js`], css: [] };
  manifest.pages[options.pageId] = {
    assets: { js: [], css: [] },
    render: "ssr",
    rendering: {
      component: "rsc",
      html: "server",
      streaming: true,
      hydrate: "none",
    },
    componentModel: "rsc",
  };
  manifest.routes.push({
    id: options.pageId,
    path: options.path,
    pageId: options.pageId,
  });
  rscPages[options.pageId] = {
    renderer: options.renderer,
    assets: rendererAssets,
  };
  serverRenderers[options.renderer] = {
    kind: "rsc-page",
    owner: { pageId: options.pageId },
    assets: rendererAssets,
  };
  serverRenderers[`${options.pageId}-server`] = {
    kind: "page-server",
    owner: { pageId: options.pageId },
    assets: { js: [`${options.pageId}-server.js`], css: [] },
  };
}

function configureRscPage(manifest: LegacyFrameworkRuntime): void {
  manifest.pages.dashboard.render = "ssr";
  manifest.pages.dashboard.componentModel = "rsc";
  manifest.pages.dashboard.rendering = {
    component: "rsc",
    html: "server",
    streaming: true,
    hydrate: "none",
  };
}

function configurePprRendering(manifest: LegacyFrameworkRuntime): void {
  const delivery = manifest.pages.dashboard.ppr?.delivery ?? "merge";
  manifest.pages.dashboard.rendering = {
    component: "server",
    html: "partial",
    prerender: "partial",
    streaming: delivery === "stream",
    hydrate: "none",
  };
}
