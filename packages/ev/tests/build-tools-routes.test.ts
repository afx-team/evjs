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

  it("resolves nested file route paths", () => {
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

  it("supports aliased imports and named export aliases", () => {
    const source = `
      import { createRoute as route } from "@evjs/server";
      const internal = route("/api/health", {
        GET() {
          return Response.json({ ok: true });
        },
        HEAD: async () => new Response(null),
      });
      export { internal as healthHandler };
    `;

    expect(extractServerRoutes(source)).toEqual([
      {
        path: "/api/health",
        methods: ["GET", "HEAD"],
      },
    ]);
  });

  it("ignores client route helpers and dynamic server route paths", () => {
    const source = `
      import { createRoute } from "@evjs/client";
      import { createRoute as serverRoute } from "@evjs/server";

      export const homeRoute = createRoute({ path: "/" });

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
      import { createRoute } from "@evjs/client";
      import { createRoute as serverRoute } from "@evjs/server";

      export const homeRoute = createRoute({
        path: "/",
        component: () => null,
      });

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

  it("does not analyze framework-managed client routes from JavaScript", () => {
    const source = `
      import { definePage } from "@evjs/client";

      export const loader = () => "hello";
      export default definePage(function Home() {
        return null;
      });
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
});
