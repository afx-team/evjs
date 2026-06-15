import { describe, expect, it } from "vitest";
import {
  analyzeRoutes,
  detectServerRouteExports,
  extractServerRoutes,
  resolveRoutes,
} from "../src/build-tools/routes.js";

describe("resolveRoutes", () => {
  it("resolves simple child paths to full paths", () => {
    const result = resolveRoutes([
      { path: "/", parentName: "rootRoute", varName: "homeRoute" },
      { path: "/about", parentName: "rootRoute", varName: "aboutRoute" },
    ]);
    expect(result).toEqual([{ path: "/" }, { path: "/about" }]);
  });

  it("resolves nested relative paths", () => {
    const result = resolveRoutes([
      { path: "/posts", parentName: "rootRoute", varName: "postsRoute" },
      {
        path: "$postId",
        parentName: "postsRoute",
        varName: "postDetailRoute",
      },
    ]);
    expect(result).toEqual([{ path: "/posts" }, { path: "/posts/$postId" }]);
  });

  it("excludes index routes under non-root parents", () => {
    const result = resolveRoutes([
      { path: "/posts", parentName: "rootRoute", varName: "postsRoute" },
      {
        path: "/",
        parentName: "postsRoute",
        varName: "postsIndexRoute",
      },
      {
        path: "$postId",
        parentName: "postsRoute",
        varName: "postDetailRoute",
      },
    ]);
    expect(result).toEqual([{ path: "/posts" }, { path: "/posts/$postId" }]);
  });

  it("keeps root index route", () => {
    const result = resolveRoutes([
      { path: "/", parentName: "rootRoute", varName: "homeRoute" },
    ]);
    expect(result).toEqual([{ path: "/" }]);
  });

  it("de-duplicates identical resolved paths", () => {
    const result = resolveRoutes([
      { path: "/about", parentName: "rootRoute", varName: "aboutRoute" },
      { path: "/about", parentName: "rootRoute", varName: "aboutRoute2" },
    ]);
    expect(result).toEqual([{ path: "/about" }]);
  });

  it("handles orphan routes", () => {
    const result = resolveRoutes([{ path: "/orphan", varName: "orphanRoute" }]);
    expect(result).toEqual([{ path: "/orphan" }]);
  });

  it("resolves nested page route paths", () => {
    const result = resolveRoutes([
      { path: "/", id: "index", module: "./src/pages/index.tsx" },
      { path: "/posts", id: "posts", module: "./src/pages/posts/index.tsx" },
      {
        path: "/posts/$postId",
        id: "posts_postId",
        module: "./src/pages/posts/$postId.tsx",
      },
    ]);
    expect(result).toEqual([
      { path: "/", id: "index", module: "./src/pages/index.tsx" },
      { path: "/posts", id: "posts", module: "./src/pages/posts/index.tsx" },
      {
        path: "/posts/$postId",
        id: "posts_postId",
        module: "./src/pages/posts/$postId.tsx",
      },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(resolveRoutes([])).toEqual([]);
  });

  it("resolves deeply nested routes", () => {
    const result = resolveRoutes([
      { path: "/a", parentName: "rootRoute", varName: "aRoute" },
      { path: "b", parentName: "aRoute", varName: "bRoute" },
      { path: "c", parentName: "bRoute", varName: "cRoute" },
    ]);
    expect(result).toEqual([
      { path: "/a" },
      { path: "/a/b" },
      { path: "/a/b/c" },
    ]);
  });
});

describe("extractServerRoutes", () => {
  it("extracts exported server route handlers", () => {
    const source = `
      import { createRoute } from "@evjs/server";
      export const postsHandler = createRoute("/api/posts", {
        GET: async () => Response.json([]),
        POST: async () => Response.json({}, { status: 201 }),
        middlewares: [],
      });
    `;

    expect(extractServerRoutes(source)).toEqual([
      {
        path: "/api/posts",
        methods: ["GET", "POST"],
      },
    ]);
    expect(detectServerRouteExports(source)).toEqual(["postsHandler"]);
  });

  it("extracts exported server route handlers from the server package", () => {
    const source = `
      import { createRoute } from "@evjs/server";
      export const postsHandler = createRoute("/api/posts", {
        GET: async () => Response.json([]),
      });
    `;

    expect(extractServerRoutes(source)).toEqual([
      {
        path: "/api/posts",
        methods: ["GET"],
      },
    ]);
    expect(detectServerRouteExports(source)).toEqual(["postsHandler"]);
  });

  it("supports aliased imports and named export aliases", () => {
    const source = `
      import { createRoute as route } from "@evjs/server";
      const internal = route("/api/health", {
        GET() {
          return Response.json({ ok: true });
        },
        HEAD: async () => new Response(null),
      });
      export { internal as "health-handler" };
      export type { internal as ignoredHandler };
      export { type internal as typedHealthHandler };
    `;

    expect(extractServerRoutes(source)).toEqual([
      {
        path: "/api/health",
        methods: ["GET", "HEAD"],
      },
    ]);
    expect(detectServerRouteExports(source)).toEqual(["health-handler"]);
  });

  it("ignores client route helpers and dynamic server route paths", () => {
    const source = `
      import { createRoute as serverRoute } from "@evjs/server";

      const routePath = "/api/dynamic";
      export const dynamicHandler = serverRoute(routePath, {
        GET: async () => Response.json({ ok: true }),
      });
    `;

    expect(extractServerRoutes(source)).toEqual([]);
    expect(detectServerRouteExports(source)).toBeNull();
  });
});

describe("analyzeRoutes", () => {
  it("collects server routes from one parsed module", () => {
    const source = `
      import { createRoute as serverRoute } from "@evjs/server";

      export const healthHandler = serverRoute("/api/health", {
        GET: async () => Response.json({ ok: true }),
      });
    `;

    expect(analyzeRoutes(source)).toEqual({
      clientRoutes: [],
      serverRoutes: [
        {
          path: "/api/health",
          methods: ["GET"],
        },
      ],
      diagnostics: [],
    });
  });

  it("reports unsupported exported server route declarations", () => {
    const source = `
      import { createRoute as serverRoute } from "@evjs/server";

      const routePath = "/api/dynamic";
      export const dynamicHandler = serverRoute(routePath, {
        GET: async () => Response.json({ ok: true }),
      });

      const fromFactory = serverRoute("/api/factory", createDefinition());
      export { fromFactory as factoryHandler };

      export const relativeHandler = serverRoute("api/relative", {
        GET: async () => Response.json({ ok: true }),
      });

      export const whitespacePathHandler = serverRoute("/api/space ", {
        GET: async () => Response.json({ ok: true }),
      });

      export const queryPathHandler = serverRoute("/api/query?filter=all", {
        GET: async () => Response.json({ ok: true }),
      });

      export const hashPathHandler = serverRoute("/api/hash#details", {
        GET: async () => Response.json({ ok: true }),
      });

      export const emptyParamHandler = serverRoute("/api/empty-param/:", {
        GET: async () => Response.json({ ok: true }),
      });

      export const reservedParamHandler = serverRoute("/api/reserved-param/:prototype", {
        GET: async () => Response.json({ ok: true }),
      });

      export const duplicateParamHandler = serverRoute("/api/users/:userId/posts/:userId", {
        GET: async () => Response.json({ ok: true }),
      });

      export const emptyMethodsHandler = serverRoute("/api/empty", {
        middlewares: [],
      });

      export const lowerCaseMethodHandler = serverRoute("/api/lowercase", {
        get: async () => Response.json({ ok: true }),
      });

      export const legacyMiddlewareHandler = serverRoute("/api/legacy-middleware", {
        middleware: [],
        GET: async () => Response.json({ ok: true }),
      });

      export const duplicateMethodHandler = serverRoute("/api/duplicate-method", {
        GET: async () => Response.json({ ok: true }),
        GET: async () => Response.json({ ok: false }),
      });

      export const duplicateMiddlewaresHandler = serverRoute("/api/duplicate-middlewares", {
        middlewares: [],
        middlewares: [],
        GET: async () => Response.json({ ok: true }),
      });

      export const literalMethodHandler = serverRoute("/api/literal-method", {
        GET: "not a function",
      });

      const localHandlerValue = "not a function";
      export const localLiteralMethodHandler = serverRoute("/api/local-literal-method", {
        GET: localHandlerValue,
      });

      export const invalidMiddlewareValueHandler = serverRoute("/api/invalid-middleware-value", {
        middlewares: null,
        GET: async () => Response.json({ ok: true }),
      });

      export const invalidMiddlewareElementHandler = serverRoute("/api/invalid-middleware-element", {
        middlewares: [null],
        GET: async () => Response.json({ ok: true }),
      });

      const invalidMiddlewareArray = [null];
      export const invalidLocalMiddlewareArrayHandler = serverRoute("/api/invalid-local-middleware-array", {
        middlewares: invalidMiddlewareArray,
        GET: async () => Response.json({ ok: true }),
      });

      const sharedMethods = {
        GET: async () => Response.json({ ok: true }),
      };
      export const spreadHandler = serverRoute("/api/spread", {
        ...sharedMethods,
      });

      const localOnly = serverRoute(routePath, {
        POST: async () => Response.json({ ok: true }),
      });
      void localOnly;
    `;

    expect(analyzeRoutes(source)).toEqual({
      clientRoutes: [],
      serverRoutes: [],
      diagnostics: [
        {
          level: "error",
          message:
            'Server route "dynamicHandler" must use a string-literal createRoute() path.',
        },
        {
          level: "error",
          message:
            'Server route "factoryHandler" must use an object-literal createRoute() definition.',
        },
        {
          level: "error",
          message:
            'Server route "relativeHandler" must use a createRoute() path that starts with "/".',
        },
        {
          level: "error",
          message:
            'Server route "whitespacePathHandler" must use a createRoute() path without whitespace.',
        },
        {
          level: "error",
          message:
            'Server route "queryPathHandler" must use a createRoute() path without query strings or hashes.',
        },
        {
          level: "error",
          message:
            'Server route "hashPathHandler" must use a createRoute() path without query strings or hashes.',
        },
        {
          level: "error",
          message:
            'Server route "emptyParamHandler" path contains dynamic segment ":" without a param name.',
        },
        {
          level: "error",
          message:
            'Server route "reservedParamHandler" path uses reserved dynamic param name "prototype" in segment ":prototype". Use a safe application-specific name.',
        },
        {
          level: "error",
          message:
            'Server route "duplicateParamHandler" path uses duplicate dynamic param name "userId" in segment ":userId". Use unique param names within one route path.',
        },
        {
          level: "error",
          message:
            'Server route "emptyMethodsHandler" must declare at least one HTTP method handler.',
        },
        {
          level: "error",
          message:
            'Server route "lowerCaseMethodHandler" definition key "get" is not supported. Use GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS or "middlewares".',
        },
        {
          level: "error",
          message:
            'Server route "legacyMiddlewareHandler" uses "middleware"; use "middlewares" for per-route middleware.',
        },
        {
          level: "error",
          message:
            'Server route "duplicateMethodHandler" definition key "GET" is declared more than once.',
        },
        {
          level: "error",
          message:
            'Server route "duplicateMiddlewaresHandler" definition key "middlewares" is declared more than once.',
        },
        {
          level: "error",
          message:
            'Server route "literalMethodHandler" GET handler must be a function.',
        },
        {
          level: "error",
          message:
            'Server route "localLiteralMethodHandler" GET handler must be a function.',
        },
        {
          level: "error",
          message:
            'Server route "invalidMiddlewareValueHandler" middlewares must be an array of functions.',
        },
        {
          level: "error",
          message:
            'Server route "invalidMiddlewareElementHandler" middlewares must be an array of functions.',
        },
        {
          level: "error",
          message:
            'Server route "invalidLocalMiddlewareArrayHandler" middlewares must be an array of functions.',
        },
        {
          level: "error",
          message:
            'Server route "spreadHandler" must not use spread properties in createRoute() definition.',
        },
      ],
    });
  });

  it("allows referenced server route handlers and middleware arrays", () => {
    const source = `
      import { createRoute as serverRoute } from "@evjs/server";

      const requireAuth = async (_c, next) => next();
      const authStack = [requireAuth];
      const listUsers = async () => Response.json([]);
      export const users = serverRoute("/api/users", {
        middlewares: authStack,
        GET: listUsers,
      });
    `;

    expect(analyzeRoutes(source)).toEqual({
      clientRoutes: [],
      serverRoutes: [
        {
          path: "/api/users",
          methods: ["GET"],
        },
      ],
      diagnostics: [],
    });
  });

  it("does not analyze framework-managed client routes from JavaScript", () => {
    const source = `
      export const loader = () => "hello";
      export default function Home() {
        return null;
      }
    `;

    expect(analyzeRoutes(source)).toEqual({
      clientRoutes: [],
      serverRoutes: [],
      diagnostics: [],
    });
  });

  it("returns an empty analysis for invalid source", () => {
    expect(analyzeRoutes("{{{{invalid")).toEqual({
      clientRoutes: [],
      serverRoutes: [],
      diagnostics: [],
    });
  });

  it("reports invalid source that looks like a server route module", () => {
    const source = `
      import { createRoute } from "@evjs/server";
      export const users = createRoute("/api/users", {
        GET: async () => Response.json([])
    `;

    expect(analyzeRoutes(source)).toEqual({
      clientRoutes: [],
      serverRoutes: [],
      diagnostics: [
        {
          level: "error",
          message: expect.stringContaining(
            "Server route module could not be parsed:",
          ),
        },
      ],
    });
  });
});
