import { describe, expect, it } from "vitest";
import {
  createTanStackDriver,
  defineTanStackRoutes,
  getRouteMeta,
  tanstackRoutes,
  withRouteMeta,
} from "../src/tanstack.js";

describe("defineTanStackRoutes", () => {
  it("keeps the route source path as app-owned config input", () => {
    expect(tanstackRoutes("./src/routes.tsx")).toBe("./src/routes.tsx");
  });

  it("preserves the original route tree generic and returns graph metadata", () => {
    const routeTree = { id: "root" };
    const routes = defineTanStackRoutes({
      routeTree,
      routes: [{ id: "home", path: "/" }],
    });

    expect(routes.routeTree).toBe(routeTree);
    expect(routes.toRouteGraph()).toEqual([{ id: "home", path: "/" }]);
  });

  it("attaches route metadata without changing the route object", () => {
    const route = { id: "user" };

    expect(withRouteMeta(route, { module: "./pages/User.tsx" })).toBe(route);
    expect(getRouteMeta(route)).toEqual({ module: "./pages/User.tsx" });
  });
});

describe("createTanStackDriver", () => {
  it("creates shell activation requests from TanStack router state", () => {
    const router = {
      state: {
        location: {
          href: "https://example.com/dashboard",
        },
      },
    };
    const driver = createTanStackDriver({
      router,
      manifest: {
        version: 1,
        buildId: "test",
        distDir: "dist",
        publicPath: "/",
        runtime: {},
        assets: {},
        apps: {},
        pages: {},
        routes: [{ id: "dashboard", path: "/dashboard", pageId: "dashboard" }],
      },
    });

    expect(driver.current()).toEqual({
      appId: undefined,
      pageId: "dashboard",
      url: "https://example.com/dashboard",
    });
  });

  it("subscribes to TanStack resolved navigation events", () => {
    let listener: (() => void) | undefined;
    const events: string[] = [];
    const calls: unknown[] = [];
    const router = {
      state: {
        location: {
          href: "https://example.com/orders/1",
        },
      },
      subscribe(event: string, callback: () => void) {
        events.push(event);
        listener = callback;
        return () => events.push("unsubscribe");
      },
    };
    const driver = createTanStackDriver({
      router,
      manifest: {
        version: 1,
        buildId: "test",
        distDir: "dist",
        publicPath: "/",
        runtime: {},
        assets: {},
        apps: {},
        pages: {},
        routes: [{ id: "orders", path: "/orders/$id", appId: "default" }],
      },
    });

    const unsubscribe = driver.subscribe?.((request) => calls.push(request));
    router.state.location.href = "https://example.com/orders/2";
    listener?.();
    unsubscribe?.();

    expect(events).toEqual(["onResolved", "unsubscribe"]);
    expect(calls).toEqual([
      {
        appId: "default",
        pageId: undefined,
        url: "https://example.com/orders/2",
      },
    ]);
  });
});
