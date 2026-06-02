import { describe, expect, it } from "vitest";
import { defineReactRoutes, page, route } from "../src/routes.js";

describe("defineReactRoutes", () => {
  it("creates route graph metadata from explicit route declarations", () => {
    const routes = defineReactRoutes([
      route("/", {
        id: "home",
        page: page("./pages/Home.tsx"),
        render: "ssr",
        hydrate: "load",
        runtime: "node",
      }),
    ]);

    expect(routes.toRouteGraph()).toEqual([
      {
        id: "home",
        path: "/",
        module: "./pages/Home.tsx",
        render: "ssr",
        hydrate: "load",
        runtime: "node",
      },
    ]);
  });
});
