import { describe, expect, it } from "vitest";
import { extractRoutes } from "../src/routes.js";

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
    expect(extractRoutes(source)).toEqual([{ path: "/" }]);
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
    expect(extractRoutes(source)).toEqual([{ path: "/users/$username" }]);
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
    expect(routes).toEqual([{ path: "/posts" }, { path: "$postId" }]);
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
    expect(extractRoutes(source)).toEqual([{ path: "/internal" }]);
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
    expect(extractRoutes(source)).toEqual([{ path: "*" }]);
  });
});
