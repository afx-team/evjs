import { describe, expect, it } from "vitest";
import {
  createFileRouteApp,
  definePage,
  type FileRoutePageProps,
} from "../src/index";

describe("definePage", () => {
  it("returns the page component unchanged", () => {
    function Page(
      _props: FileRoutePageProps<{ userId: string }, { tab: string }, string>,
    ) {
      return null;
    }

    expect(definePage(Page)).toBe(Page);
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
