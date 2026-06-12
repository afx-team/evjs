import { describe, expect, it } from "vitest";
import {
  createPagesApp,
  usePageContext,
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "../src/index";

describe("page route hooks", () => {
  it("exports framework-managed route data hooks", () => {
    expect(usePageContext).toBeTypeOf("function");
    expect(usePageParams).toBeTypeOf("function");
    expect(usePageSearch).toBeTypeOf("function");
    expect(usePageLoaderData).toBeTypeOf("function");
  });
});

describe("createPagesApp", () => {
  it("creates an app from page modules without exposing route tree setup", () => {
    function Home() {
      return null;
    }

    const { app, routeTree } = createPagesApp({
      routes: [{ path: "/", module: { default: Home } }],
    });

    expect(
      (app.router as { options: { routeTree: unknown } }).options.routeTree,
    ).toBe(routeTree);
  });
});
