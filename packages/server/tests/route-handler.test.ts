import { serve } from "@hono/node-server";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  createRoute,
  type RouteHandlerDefinition,
} from "../src/routes/route-handler.js";

/**
 * Helper to make a Request and feed it through the route handler's Hono app.
 */
async function fetch(
  handler: ReturnType<typeof createRoute>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `http://localhost${path}`;
  const req = new Request(url, init);
  const app = createApp({ routes: [handler] });
  return app.fetch(req);
}

function invalidRouteDefinition(
  definition: unknown,
): RouteHandlerDefinition<"/api/items"> {
  return definition as RouteHandlerDefinition<"/api/items">;
}

describe("createRoute", () => {
  it("routes GET requests to the GET handler", async () => {
    const handler = createRoute("/api/items", {
      GET: async () => Response.json({ items: [1, 2, 3] }),
    });

    const res = await fetch(handler, "/api/items");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [1, 2, 3] });
  });

  it("routes POST requests to the POST handler", async () => {
    const handler = createRoute("/api/items", {
      POST: async (req) => {
        const body = await req.json();
        return Response.json({ created: body }, { status: 201 });
      },
    });

    const res = await fetch(handler, "/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: { name: "test" } });
  });

  it("rejects invalid route declarations", () => {
    expect(() =>
      createRoute("", {
        GET: async () => Response.json({ ok: true }),
      }),
    ).toThrow("[evjs] createRoute() path must be a non-empty string.");

    expect(() =>
      createRoute(42 as never, {
        GET: async () => Response.json({ ok: true }),
      }),
    ).toThrow("[evjs] createRoute() path must be a non-empty string.");

    expect(() =>
      createRoute("api/items", {
        GET: async () => Response.json({ ok: true }),
      }),
    ).toThrow('[evjs] createRoute() path must start with "/".');

    expect(() =>
      createRoute("/api/items ", {
        GET: async () => Response.json({ ok: true }),
      }),
    ).toThrow("[evjs] createRoute() path must not contain whitespace.");

    expect(() =>
      createRoute("/api/items?filter=all", {
        GET: async () => Response.json({ ok: true }),
      }),
    ).toThrow(
      "[evjs] createRoute() path must not include a query string or hash.",
    );

    expect(() =>
      createRoute("/api/items#details", {
        GET: async () => Response.json({ ok: true }),
      }),
    ).toThrow(
      "[evjs] createRoute() path must not include a query string or hash.",
    );

    expect(() =>
      createRoute("/api/items/:", {
        GET: async () => Response.json({ ok: true }),
      }),
    ).toThrow(
      '[evjs] createRoute() path contains dynamic segment ":" without a param name.',
    );

    expect(() =>
      createRoute("/api/items/:__proto__{[0-9]+}", {
        GET: async () => Response.json({ ok: true }),
      }),
    ).toThrow(
      '[evjs] createRoute() path uses reserved dynamic param name "__proto__" in segment ":__proto__{[0-9]+}". Use a safe application-specific name.',
    );

    expect(() =>
      createRoute("/api/users/:userId/posts/:userId", {
        GET: async () => Response.json({ ok: true }),
      }),
    ).toThrow(
      '[evjs] createRoute() path uses duplicate dynamic param name "userId" in segment ":userId". Use unique param names within one route path.',
    );

    expect(() =>
      createRoute("/api/items", {
        middlewares: [],
      }),
    ).toThrow(
      "[evjs] createRoute() must declare at least one HTTP method handler.",
    );

    expect(() =>
      createRoute(
        "/api/items",
        invalidRouteDefinition({
          get: async () => Response.json({ ok: true }),
        }),
      ),
    ).toThrow(
      '[evjs] createRoute() definition key "get" is not supported. Use GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS or "middlewares".',
    );

    expect(() =>
      createRoute(
        "/api/items",
        invalidRouteDefinition({
          middleware: [],
          GET: async () => Response.json({ ok: true }),
        }),
      ),
    ).toThrow(
      '[evjs] createRoute() definition uses "middleware"; use "middlewares" for per-route middleware.',
    );

    expect(() =>
      createRoute(
        "/api/items",
        invalidRouteDefinition({
          GET: "not a function",
        }),
      ),
    ).toThrow("[evjs] createRoute() GET handler must be a function.");

    expect(() =>
      createRoute(
        "/api/items",
        invalidRouteDefinition({
          middlewares: [null],
          GET: async () => Response.json({ ok: true }),
        }),
      ),
    ).toThrow(
      "[evjs] createRoute() middlewares must be an array of functions.",
    );
  });

  it("resolves dynamic params", async () => {
    const handler = createRoute("/api/users/:id", {
      GET: async (_req, ctx) => {
        return Response.json({ id: ctx.req.param("id") });
      },
    });

    const res = await fetch(handler, "/api/users/42");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "42" });
  });

  it("returns 405 for undefined methods", async () => {
    const handler = createRoute("/api/items", {
      GET: async () => Response.json({ ok: true }),
    });

    const res = await fetch(handler, "/api/items", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toContain("GET");
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toBe("Method Not Allowed");
  });

  it("auto-implements OPTIONS with Allow header", async () => {
    const handler = createRoute("/api/items", {
      GET: async () => Response.json([]),
      POST: async () => Response.json({}, { status: 201 }),
    });

    const res = await fetch(handler, "/api/items", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    const allow = res.headers.get("Allow") ?? "";
    expect(allow).toContain("GET");
    expect(allow).toContain("POST");
    expect(allow).toContain("OPTIONS");
  });

  it("auto-derives HEAD from GET", async () => {
    const handler = createRoute("/api/items", {
      GET: async () =>
        Response.json(
          { data: "hello" },
          {
            headers: { "X-Custom": "test" },
          },
        ),
    });

    const res = await fetch(handler, "/api/items", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Custom")).toBe("test");
    // HEAD should have empty body
    const body = await res.text();
    expect(body).toBe("");
  });

  it("reports non-Response handler results", async () => {
    const handler = createRoute(
      "/api/items",
      invalidRouteDefinition({
        GET: async () => undefined,
      }),
    );

    const res = await fetch(handler, "/api/items");
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toBe(
      "[evjs] createApp() routes[0].methods.GET must return a Response.",
    );
  });

  it("accepts route Responses through the Node server adapter", async () => {
    const handler = createRoute("/api/items", {
      GET: async () => Response.json({ ok: true }),
    });
    const app = createApp({ routes: [handler] });

    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const nextServer = serve({ fetch: app.fetch, port: 0 }, () => {
        resolve(nextServer);
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Expected Node server to listen on an assigned port.");
    }

    try {
      const res = await globalThis.fetch(
        `http://localhost:${address.port}/api/items`,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("runs middleware in order before the handler", async () => {
    const order: string[] = [];

    const handler = createRoute("/api/items", {
      middlewares: [
        async (_c, next) => {
          order.push("mw1");
          return next();
        },
        async (_c, next) => {
          order.push("mw2");
          return next();
        },
      ],
      GET: async () => {
        order.push("handler");
        return Response.json({ ok: true });
      },
    });

    const res = await fetch(handler, "/api/items");
    expect(res.status).toBe(200);
    expect(order).toEqual(["mw1", "mw2", "handler"]);
  });

  it("runs app middleware before route middleware and supports after-next response updates", async () => {
    const { createApp } = await import("../src/app.js");
    const order: string[] = [];
    const handler = createRoute("/api/items/:id", {
      middlewares: [
        async (ctx, next) => {
          order.push(`route-before:${ctx.req.param("id")}`);
          await next();
          order.push("route-after");
          ctx.header("x-route-middleware", "done");
        },
      ],
      GET: async (_req, ctx) => {
        order.push(`handler:${ctx.req.param("id")}`);
        return Response.json({ id: ctx.req.param("id") });
      },
    });
    const app = createApp({
      middlewares: [
        async (ctx, next) => {
          order.push("global-before");
          await next();
          order.push("global-after");
          ctx.header("x-global-middleware", "done");
        },
      ],
      routes: [handler],
    });

    const res = await app.request("/api/items/42");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "42" });
    expect(res.headers.get("x-route-middleware")).toBe("done");
    expect(res.headers.get("x-global-middleware")).toBe("done");
    expect(order).toEqual([
      "global-before",
      "route-before:42",
      "handler:42",
      "route-after",
      "global-after",
    ]);
  });

  it("middleware can short-circuit the request", async () => {
    const handler = createRoute("/api/items", {
      middlewares: [async () => new Response("Unauthorized", { status: 401 })],
      GET: async () => Response.json({ ok: true }),
    });

    const res = await fetch(handler, "/api/items");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("supports multiple method handlers on the same path", async () => {
    const handler = createRoute("/api/items/:id", {
      GET: async (_req, ctx) =>
        Response.json({ action: "get", id: ctx.req.param("id") }),
      PUT: async (_req, ctx) =>
        Response.json({ action: "update", id: ctx.req.param("id") }),
      DELETE: async () => new Response(null, { status: 204 }),
    });

    const getRes = await fetch(handler, "/api/items/1");
    expect(await getRes.json()).toEqual({ action: "get", id: "1" });

    const putRes = await fetch(handler, "/api/items/1", { method: "PUT" });
    expect(await putRes.json()).toEqual({ action: "update", id: "1" });

    const delRes = await fetch(handler, "/api/items/1", { method: "DELETE" });
    expect(delRes.status).toBe(204);
  });

  it("mounts on createApp via routes option", async () => {
    // This tests the integration path through createApp
    const { createApp } = await import("../src/app.js");

    const items = createRoute("/items", {
      GET: async () => Response.json(["a", "b"]),
    });

    const app = createApp({ routes: [items] });
    const res = await app.fetch(new Request("http://localhost/items"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["a", "b"]);
  });

  it("rejects legacy route option names (type check)", async () => {
    const items = createRoute("/items", {
      GET: async () => Response.json(["a", "b"]),
    });

    // @ts-expect-error - route handlers mount via routes, not routeHandlers
    createApp({ routeHandlers: [items] });

    expect(() =>
      createRoute("/api/private", {
        // @ts-expect-error - per-route middleware uses middlewares, not middleware
        middleware: [],
        GET: async () => Response.json({ ok: true }),
      }),
    ).toThrow(
      '[evjs] createRoute() definition uses "middleware"; use "middlewares" for per-route middleware.',
    );
  });

  it("middleware can perform async work before proceeding", async () => {
    const handler = createRoute("/api/items", {
      middlewares: [
        async (_c, next) => {
          // Simulate async work (e.g. DB lookup, auth check)
          await new Promise((r) => setTimeout(r, 5));
          return next();
        },
      ],
      GET: async () => Response.json({ delayed: true }),
    });

    const res = await fetch(handler, "/api/items");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delayed: true });
  });

  it("provides access to query params and headers via request", async () => {
    const handler = createRoute("/api/search", {
      GET: async (req) => {
        const url = new URL(req.url);
        return Response.json({
          q: url.searchParams.get("q"),
          auth: req.headers.get("Authorization"),
        });
      },
    });

    const res = await fetch(handler, "/api/search?q=hello", {
      headers: { Authorization: "Bearer tok123" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      q: "hello",
      auth: "Bearer tok123",
    });
  });

  it("middleware runs independently per HTTP method", async () => {
    let mwCount = 0;

    const handler = createRoute("/api/items", {
      middlewares: [
        async (_c, next) => {
          mwCount++;
          return next();
        },
      ],
      GET: async () => Response.json({ ok: true }),
      POST: async () => Response.json({ ok: true }, { status: 201 }),
    });

    await fetch(handler, "/api/items");
    expect(mwCount).toBe(1);

    await fetch(handler, "/api/items", { method: "POST" });
    expect(mwCount).toBe(2);
  });

  it("infers route parameters correctly (type check)", async () => {
    // This is purely a type-level test, but we run it to ensure the syntax is valid
    const _route = createRoute("/api/users/:id/posts/:postId", {
      GET: async (_req, ctx) => {
        const params = ctx.req.param();

        // params should be exactly { id: string, postId: string }
        const _test: { id: string; postId: string } = params;

        // @ts-expect-error - invalid params should fail typecheck
        const _test2: { invalid: string } = params;

        return new Response(`User`);
      },
    });
  });
});
