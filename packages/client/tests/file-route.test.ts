import { describe, expect, it } from "vitest";
import {
  createFileRouteApp,
  useFileRouteContext,
  useFileRouteLoaderData,
  useFileRouteParams,
  useFileRouteSearch,
} from "../src/index";

describe("file route hooks", () => {
  it("exports framework-managed route data hooks", () => {
    expect(useFileRouteContext).toBeTypeOf("function");
    expect(useFileRouteParams).toBeTypeOf("function");
    expect(useFileRouteSearch).toBeTypeOf("function");
    expect(useFileRouteLoaderData).toBeTypeOf("function");
  });
});

describe("createFileRouteApp", () => {
  it("creates an app from page modules without exposing route tree setup", () => {
    function Home() {
      return null;
    }

    const { app, routeTree } = createFileRouteApp({
      routes: [{ path: "/", module: { default: Home } }],
    });

    expect(
      (app.router as { options: { routeTree: unknown } }).options.routeTree,
    ).toBe(routeTree);
  });
});
