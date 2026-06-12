import { describe, expect, it } from "vitest";
import * as client from "../src/index";
import {
  usePageContext,
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "../src/index";
import { createPagesApp } from "../src/internal";

describe("page route hooks", () => {
  it("exports framework-managed route data hooks", () => {
    expect(usePageContext).toBeTypeOf("function");
    expect(usePageParams).toBeTypeOf("function");
    expect(usePageSearch).toBeTypeOf("function");
    expect(usePageLoaderData).toBeTypeOf("function");
  });

  it("does not expose generated SPA bootstrap APIs from the public client entry", () => {
    expect("createPagesApp" in client).toBe(false);
    expect("PageProvider" in client).toBe(false);
    expect("createReactPageModule" in client).toBe(false);
    expect("mountReactPage" in client).toBe(false);
    expect("createRemoteReactModule" in client).toBe(false);
    expect("createShell" in client).toBe(false);
    expect("createPageDriver" in client).toBe(false);
    expect("createHistoryDriver" in client).toBe(false);
    expect("registerSharedDependency" in client).toBe(false);
    expect("loadSharedDependency" in client).toBe(false);
    expect("registerShellModule" in client).toBe(false);
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
