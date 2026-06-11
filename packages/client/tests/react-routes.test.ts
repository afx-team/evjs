import { describe, expect, it } from "vitest";
import { defineReactRoutes, page, route } from "../src/routes.js";

describe("defineReactRoutes", () => {
  it("creates route graph metadata from explicit route declarations", () => {
    const routes = defineReactRoutes([
      route("/", {
        id: "home",
        page: page("./pages/Home.tsx"),
      }),
    ]);

    expect(routes.toRouteGraph()).toEqual([
      {
        id: "home",
        path: "/",
        module: "./pages/Home.tsx",
      },
    ]);
  });

  it("accepts ordinary React components as route targets", () => {
    function Home() {
      return null;
    }

    const routes = defineReactRoutes([
      route("/", Home, {
        id: "home",
      }),
    ]);

    expect(routes.routes[0]).toMatchObject({
      path: "/",
      id: "home",
      component: Home,
    });
  });
});
