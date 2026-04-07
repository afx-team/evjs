import { describe, expect, it } from "vitest";
import { extractRoutes, resolveRoutes } from "../src/routes.js";

describe("extractRoutes", () => {
  it("extracts path from a static route", () => {
    const source = `
      import { createRoute } from "@evjs/client";
      export const homeRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/",
        component: () => null,
      });
    `;
    expect(extractRoutes(source)).toEqual([
      { path: "/", parentName: "rootRoute", varName: "homeRoute" },
    ]);
  });

  it("extracts path with dynamic params", () => {
    const source = `
      import { createRoute } from "@evjs/client";
      export const userRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/users/$username",
        component: UserProfile,
      });
    `;
    expect(extractRoutes(source)).toEqual([
      {
        path: "/users/$username",
        parentName: "rootRoute",
        varName: "userRoute",
      },
    ]);
  });

  it("skips pathless layouts (id-only routes)", () => {
    const source = `
      import { createRoute } from "@evjs/client";
      export const dashboardLayout = createRoute({
        getParentRoute: () => rootRoute,
        id: "dashboard-layout",
        component: () => null,
      });
    `;
    expect(extractRoutes(source)).toEqual([]);
  });

  it("extracts multiple routes from a single file", () => {
    const source = `
      import { createRoute } from "@evjs/client";
      export const postsRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/posts",
        component: PostsList,
      });
      export const postDetailRoute = createRoute({
        getParentRoute: () => postsRoute,
        path: "$postId",
        component: PostDetail,
      });
    `;
    const routes = extractRoutes(source);
    expect(routes).toEqual([
      { path: "/posts", parentName: "rootRoute", varName: "postsRoute" },
      { path: "$postId", parentName: "postsRoute", varName: "postDetailRoute" },
    ]);
  });

  it("handles non-exported route declarations", () => {
    const source = `
      import { createRoute } from "@evjs/client";
      const internalRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "/internal",
        component: () => null,
      });
    `;
    expect(extractRoutes(source)).toEqual([
      { path: "/internal", parentName: "rootRoute", varName: "internalRoute" },
    ]);
  });

  it("returns empty array for files without createRoute", () => {
    const source = `
      export function hello() { return "world"; }
    `;
    expect(extractRoutes(source)).toEqual([]);
  });

  it("returns empty array for empty source", () => {
    expect(extractRoutes("")).toEqual([]);
  });

  it("returns empty array for invalid source", () => {
    expect(extractRoutes("{{{{invalid")).toEqual([]);
  });

  it("ignores createRoute calls without path", () => {
    const source = `
      import { createRoute } from "@evjs/client";
      const route = createRoute({
        getParentRoute: () => rootRoute,
        component: () => null,
      });
    `;
    expect(extractRoutes(source)).toEqual([]);
  });

  it("handles catch-all routes", () => {
    const source = `
      import { createRoute } from "@evjs/client";
      export const notFoundRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: "*",
        component: () => null,
      });
    `;
    expect(extractRoutes(source)).toEqual([
      { path: "*", parentName: "rootRoute", varName: "notFoundRoute" },
    ]);
  });

  it("extracts parentName from block-body arrow functions", () => {
    const source = `
      import { createRoute } from "@evjs/client";
      export const fooRoute = createRoute({
        getParentRoute: () => { return rootRoute; },
        path: "/foo",
        component: () => null,
      });
    `;
    expect(extractRoutes(source)).toEqual([
      { path: "/foo", parentName: "rootRoute", varName: "fooRoute" },
    ]);
  });

  it("sets parentName and varName to undefined when absent", () => {
    const source = `
      import { createRoute } from "@evjs/client";
      export const simpleRoute = createRoute({
        path: "/simple",
        component: () => null,
      });
    `;
    const routes = extractRoutes(source);
    expect(routes).toEqual([{ path: "/simple", varName: "simpleRoute" }]);
    expect(routes[0].parentName).toBeUndefined();
  });
});

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
    // postsIndexRoute is excluded — it duplicates "/posts"
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

  it("handles orphan routes (no parent found)", () => {
    const result = resolveRoutes([{ path: "/orphan", varName: "orphanRoute" }]);
    expect(result).toEqual([{ path: "/orphan" }]);
  });

  it("matches basic-csr example route tree", () => {
    // Simulates the full route extraction from basic-csr example
    const result = resolveRoutes([
      { path: "/about", parentName: "rootRoute", varName: "aboutRoute" },
      { path: "/", parentName: "rootRoute", varName: "homeRoute" },
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
    expect(result).toEqual([
      { path: "/about" },
      { path: "/" },
      { path: "/posts" },
      { path: "/posts/$postId" },
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
