import { describe, expect, it } from "vitest";
import { createRouteHandler } from "../src/routes/route-handler.js";

/**
 * Helper to make a Request and feed it through the route handler's Hono app.
 */
async function fetch(
  handler: ReturnType<typeof createRouteHandler>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `http://localhost${path}`;
  const req = new Request(url, init);
  return handler.app.fetch(req);
}

describe("createRouteHandler", () => {
  it("routes GET requests to the GET handler", async () => {
    const handler = createRouteHandler("/api/items", {
      GET: async () => Response.json({ items: [1, 2, 3] }),
    });

    const res = await fetch(handler, "/api/items");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [1, 2, 3] });
  });

  it("routes POST requests to the POST handler", async () => {
    const handler = createRouteHandler("/api/items", {
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
    const handler = createRouteHandler("/api/users/:id", {
      GET: async (_req, { params }) => {
        return Response.json({ id: params.id });
      },
    });

    const res = await fetch(handler, "/api/users/42");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "42" });
  });

  it("returns 405 for undefined methods", async () => {
    const handler = createRouteHandler("/api/items", {
      GET: async () => Response.json({ ok: true }),
    });

    const res = await fetch(handler, "/api/items", { method: "DELETE" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toContain("GET");
  });

  it("auto-implements OPTIONS with Allow header", async () => {
    const handler = createRouteHandler("/api/items", {
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
    const handler = createRouteHandler("/api/items", {
      GET: async () =>
        Response.json({ data: "hello" }, {
          headers: { "X-Custom": "test" },
        }),
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

    const handler = createRouteHandler("/api/items", {
      middleware: [
        async (_req, _ctx, next) => {
          order.push("mw1");
          return next();
        },
        async (_req, _ctx, next) => {
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
    const handler = createRouteHandler("/api/items", {
      middleware: [
        async () => new Response("Unauthorized", { status: 401 }),
      ],
      GET: async () => Response.json({ ok: true }),
    });

    const res = await fetch(handler, "/api/items");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("supports multiple method handlers on the same path", async () => {
    const handler = createRouteHandler("/api/items/:id", {
      GET: async (_req, { params }) =>
        Response.json({ action: "get", id: params.id }),
      PUT: async (_req, { params }) =>
        Response.json({ action: "update", id: params.id }),
      DELETE: async (_req, { params }) =>
        new Response(null, { status: 204 }),
    });

    const getRes = await fetch(handler, "/api/items/1");
    expect(await getRes.json()).toEqual({ action: "get", id: "1" });

    const putRes = await fetch(handler, "/api/items/1", { method: "PUT" });
    expect(await putRes.json()).toEqual({ action: "update", id: "1" });

    const delRes = await fetch(handler, "/api/items/1", { method: "DELETE" });
    expect(delRes.status).toBe(204);
  });

  it("mounts on createApp via routeHandlers option", async () => {
    // This tests the integration path through createApp
    const { createApp } = await import("../src/app.js");

    const items = createRouteHandler("/items", {
      GET: async () => Response.json(["a", "b"]),
    });

    const app = createApp({ routeHandlers: [items] });
    const res = await app.fetch(new Request("http://localhost/items"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["a", "b"]);
  });
});
