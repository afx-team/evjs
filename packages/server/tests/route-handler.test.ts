import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createRoute } from "../src/routes/route-handler.js";

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

  it("runs middleware in order before the handler", async () => {
    const order: string[] = [];

    const handler = createRoute("/api/items", {
      middlewares: [
        async (c, next) => {
          order.push("mw1");
          return next();
        },
        async (c, next) => {
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

  it("middleware can perform async work before proceeding", async () => {
    const handler = createRoute("/api/items", {
      middlewares: [
        async (c, next) => {
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
        async (c, next) => {
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
