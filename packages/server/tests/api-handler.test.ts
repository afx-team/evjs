import type { Context } from "hono";
import { validator } from "hono/validator";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createApp,
  createRoute,
  getContext,
  type MiddlewareChain,
  type MiddlewareHandler,
  type RouteHandlerFn,
  withMiddlewares,
} from "../src/index.js";

function trace(name: string, events: string[]): MiddlewareHandler {
  return async (context, next) => {
    events.push(`${name}:before`);
    await next();
    events.push(`${name}:after`);
    context.header(`x-${name}`, "true");
  };
}

describe("withMiddlewares", () => {
  it("requires the handler first", () => {
    const middleware: MiddlewareHandler = async (_context, next) => next();
    const handler = () => new Response("ok");
    expect(() => {
      // @ts-expect-error The first argument is a handler, not middleware arrays.
      withMiddlewares([middleware], handler);
    }).toThrow("[evjs] withMiddlewares() handler must be a function.");
  });

  it.each([
    ["GET", 200, "read"],
    ["POST", 201, "write"],
    ["HEAD", 202, "head"],
    ["OPTIONS", 204, undefined],
    ["DELETE", 405, undefined],
  ] as const)("selects the %s chain after shared middleware", async (method, status, selected) => {
    const events: string[] = [];
    const contexts: Context[] = [];
    const scope: MiddlewareHandler = async (context, next) => {
      contexts.push(context);
      expect(context.req.param("id")).toBe("42");
      await trace("scope", events)(context, next);
      expect(context.req.param("id")).toBe("42");
    };
    const handler = (name: string, status: number): RouteHandlerFn =>
      withMiddlewares(
        (request, context) => {
          contexts.push(context);
          expect(getContext()).toBe(context);
          expect(request).toBe(context.req.raw);
          expect(request.method).toBe(method);
          expect(context.req.param("id")).toBe("42");
          return new Response(name, { status });
        },
        trace(name, events),
      );
    const app = createApp({
      middlewares: [trace("global", events)],
      routes: [
        createRoute("/api/items/:id", {
          middlewares: [scope],
          GET: handler("read", 200),
          POST: handler("write", 201),
          HEAD: handler("head", 202),
        }),
      ],
    });

    const response = await app.request("/api/items/42", { method });
    expect(response.status).toBe(status);
    expect(response.headers.get("x-scope")).toBe(
      method === "DELETE" ? null : "true",
    );
    expect(response.headers.get("x-global")).toBe("true");
    expect(events).toEqual([
      "global:before",
      ...(method === "DELETE" ? [] : ["scope:before"]),
      ...(selected ? [`${selected}:before`, `${selected}:after`] : []),
      ...(method === "DELETE" ? [] : ["scope:after"]),
      "global:after",
    ]);
    expect(new Set(contexts).size).toBe(method === "DELETE" ? 0 : 1);
    if (method === "HEAD") expect(await response.text()).toBe("");
    if (method === "OPTIONS" || method === "DELETE") {
      expect(response.headers.get("Allow")?.split(", ").sort()).toEqual([
        "GET",
        "HEAD",
        "OPTIONS",
        "POST",
      ]);
    }
  });

  it("derives HEAD from the GET chain and strips short-circuit bodies", async () => {
    const events: string[] = [];
    const app = createApp({
      routes: [
        createRoute("/api/items", {
          GET: withMiddlewares(
            () => new Response("unreachable"),
            [
              trace("read", events),
              async () => new Response("denied", { status: 401 }),
            ],
          ),
        }),
      ],
    });
    const response = await app.request("/api/items", { method: "HEAD" });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(events).toEqual(["read:before", "read:after"]);
  });

  it("supports HEAD-only and explicit OPTIONS handlers", async () => {
    const events: string[] = [];
    const app = createApp({
      routes: [
        createRoute("/api/status", {
          HEAD: withMiddlewares(
            () => new Response(null),
            trace("head", events),
          ),
          OPTIONS: withMiddlewares(
            () => new Response(null, { status: 202 }),
            trace("options", events),
          ),
        }),
      ],
    });
    expect((await app.request("/api/status", { method: "HEAD" })).status).toBe(
      200,
    );
    expect(
      (await app.request("/api/status", { method: "OPTIONS" })).status,
    ).toBe(202);
    expect((await app.request("/api/status")).status).toBe(405);
    expect(events).toEqual([
      "head:before",
      "head:after",
      "options:before",
      "options:after",
    ]);
  });

  it("keeps scoped short circuits on OPTIONS and bypasses them for 405", async () => {
    const app = createApp({
      routes: [
        createRoute("/api/private", {
          middlewares: [
            async () => new Response("unauthorized", { status: 401 }),
          ],
          GET: () => new Response("unreachable"),
        }),
      ],
    });
    for (const [method, status] of [
      ["OPTIONS", 401],
      ["DELETE", 405],
    ] as const) {
      expect((await app.request("/api/private", { method })).status).toBe(
        status,
      );
    }
  });

  it("does not run API middleware for an unmatched path or another route", async () => {
    const events: string[] = [];
    const app = createApp({
      middlewares: [trace("global", events)],
      routes: [
        createRoute("/api/items", {
          middlewares: [trace("scope", events)],
          GET: withMiddlewares(() => new Response(), trace("read", events)),
        }),
      ],
    });
    const response = await app.request("/api/missing");
    expect(response.status).toBe(404);
    expect(events).toEqual(["global:before", "global:after"]);
  });

  it.each([
    "GET",
    "HEAD",
  ])("uses the application's error handler inside the %s chain", async (method) => {
    const events: string[] = [];
    const observeError: MiddlewareHandler = async (context, next) => {
      await next();
      events.push(`after:${context.error?.message}`);
      expect(context.req.param("id")).toBe("42");
      context.header("x-recovered", "true");
    };
    const app = createApp({
      routes: [
        createRoute("/api/items/:id", {
          GET: withMiddlewares(
            () => new Response("unreachable"),
            [
              observeError,
              async () => {
                throw new Error("boom");
              },
            ],
          ),
        }),
      ],
    });
    app.onError((error, context) => {
      events.push(`error:${error.message}`);
      return context.json({ error: error.message }, 500);
    });
    const response = await app.request("/api/items/42", { method });
    expect(response.status).toBe(500);
    expect(response.headers.get("x-recovered")).toBe("true");
    expect(events).toEqual(["error:boom", "after:boom"]);
  });

  it("preserves nested order and repeated entries, with immutable chain snapshots", async () => {
    const events: string[] = [];
    const first = trace("first", events);
    const chain = [first, first] satisfies MiddlewareChain;
    const GET = withMiddlewares(
      withMiddlewares(() => new Response(), trace("inner", events)),
      chain,
    );
    chain.push(trace("later", events));
    const app = createApp({ routes: [createRoute("/api/items", { GET })] });
    expect((await app.request("/api/items")).status).toBe(200);
    expect(events).toEqual([
      "first:before",
      "first:before",
      "inner:before",
      "inner:after",
      "first:after",
      "first:after",
    ]);
  });

  it("remains directly callable with the existing route context", async () => {
    const events: string[] = [];
    const wrapped = withMiddlewares(
      (_request, context) => Response.json({ id: context.req.param("id") }),
      trace("method", events),
    );
    const app = createApp({
      middlewares: [trace("global", events)],
      routes: [
        createRoute("/api/items/:id", {
          middlewares: [trace("scope", events)],
          GET: (request, context) => wrapped(request, context),
        }),
      ],
    });
    const response = await app.request("/api/items/42");
    expect(await response.json()).toEqual({ id: "42" });
    expect(response.headers.get("x-method")).toBe("true");
    expect(events).toEqual([
      "global:before",
      "scope:before",
      "method:before",
      "method:after",
      "scope:after",
      "global:after",
    ]);
  });

  it("retains typed route params and context variables", async () => {
    type AppEnv = { Variables: { userId: string } };
    const auth: MiddlewareHandler<AppEnv, "/api/items/:id"> = async (
      context,
      next,
    ) => {
      context.set("userId", "u1");
      await next();
    };
    const GET = withMiddlewares(
      (_request, context) => {
        expectTypeOf(context.req.param()).toEqualTypeOf<{ id: string }>();
        expectTypeOf(context.get("userId")).toEqualTypeOf<string>();
        return context.json({
          id: context.req.param("id"),
          user: context.get("userId"),
        });
      },
      [auth],
    );
    const app = createApp({ routes: [createRoute("/api/items/:id", { GET })] });
    expect(await (await app.request("/api/items/42")).json()).toEqual({
      id: "42",
      user: "u1",
    });
  });

  it("infers predeclared validator input with the handler first and shares the body cache", async () => {
    type AppEnv = { Variables: { userId: string } };
    const auth: MiddlewareHandler<AppEnv> = async (context, next) => {
      context.set("userId", "u1");
      await next();
    };
    const validateBody = validator("json", (value) => ({
      title: String(value.title),
    }));
    const POST = withMiddlewares(
      async (_request, context) => {
        expectTypeOf(context.get("userId")).toEqualTypeOf<string>();
        expectTypeOf(context.req.valid("json")).toEqualTypeOf<{
          title: string;
        }>();
        return context.json({
          validated: context.req.valid("json"),
          raw: await context.req.json(),
        });
      },
      [auth, validateBody],
    );
    const app = createApp({ routes: [createRoute("/api/items", { POST })] });
    const response = await app.request("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: 42 }),
    });
    expect(await response.json()).toEqual({
      validated: { title: "42" },
      raw: { title: 42 },
    });
  });
});
