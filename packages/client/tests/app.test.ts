import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAppRootRoute } from "../src/context";

function createRouteTree() {
  return createAppRootRoute({
    component: () => null,
  });
}

describe("createApp", () => {
  it("keeps TanStack Router global catch boundary by default", () => {
    const app = createApp({ routeTree: createRouteTree() });

    expect(app.router.options.disableGlobalCatchBoundary).toBeUndefined();
  });

  it("can disable TanStack Router global catch boundary from app options", () => {
    const app = createApp({
      routeTree: createRouteTree(),
      router: { disableGlobalCatchBoundary: true },
    });

    expect(app.router.options.disableGlobalCatchBoundary).toBe(true);
  });

  it("passes TanStack Router options through", () => {
    const app = createApp({
      routeTree: createRouteTree(),
      router: {
        basepath: "/app",
        caseSensitive: true,
        defaultPreload: false,
      },
    });

    expect(app.router.options.basepath).toBe("/app");
    expect(app.router.options.caseSensitive).toBe(true);
    expect(app.router.options.defaultPreload).toBe(false);
  });
});
