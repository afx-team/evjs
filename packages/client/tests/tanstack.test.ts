import { describe, expect, it } from "vitest";
import { createTanStackDriver } from "../src/tanstack.js";

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
