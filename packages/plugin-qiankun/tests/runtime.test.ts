import { createPagesApp } from "@evjs/ev/_internal/client";
import { createBrowserHistory } from "@evjs/ev/navigation";
import { describe, expect, it, vi } from "vitest";
import {
  createQiankunMasterRoutes,
  createQiankunSlaveHistory,
  createQiankunSlaveLifecycles,
  defineQiankunMasterResolver,
  defineQiankunSlaveRuntime,
  type QiankunMasterOptions,
  type QiankunRoute,
  resolveQiankunSlaveBase,
  startQiankunMaster,
  unmountQiankunMicroAppAfterUpdates,
} from "../src/runtime.js";

const qiankun = vi.hoisted(() => ({
  loadMicroApp: vi.fn(),
  prefetchApps: vi.fn(),
}));

vi.mock("qiankun", () => qiankun);

describe("@evjs/plugin-qiankun runtime", () => {
  it("keeps master and slave runtime helpers as identity functions", () => {
    const resolver = async () => ({ apps: [] });
    const runtime = { bootstrap: vi.fn() };

    expect(defineQiankunMasterResolver(resolver)).toBe(resolver);
    expect(defineQiankunSlaveRuntime(runtime)).toBe(runtime);
  });

  it("installs runtime routes before starting the master Application", async () => {
    const calls: string[] = [];
    const updateRuntime = vi.fn(async () => calls.push("routes"));
    const configuredFetch = vi.fn();
    const resolver = vi.fn(async () => ({
      apps: [
        {
          name: "console",
          entry: "https://example.com/console/",
        },
      ],
      routes: [{ path: "/console", microApp: "console" }],
      prefetch: "all" as const,
      settings: { fetch: configuredFetch },
    }));
    qiankun.prefetchApps.mockClear();

    await startQiankunMaster({
      resolver,
      mount: "#app",
      async loadEntry() {
        calls.push("entry");
        return {
          pagesApp: { updateRuntime },
          start(container: string) {
            expect(container).toBe("#app");
            calls.push("start");
          },
        };
      },
    });

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["entry", "routes", "start"]);
    expect(updateRuntime).toHaveBeenCalledWith({
      routes: [
        expect.objectContaining({
          id: "__evjs_qiankun_app_0_console",
          path: "/console/$",
          module: { default: expect.any(Function) },
        }),
      ],
    });
    expect(qiankun.prefetchApps).toHaveBeenCalledWith(
      [{ name: "console", entry: "https://example.com/console/" }],
      configuredFetch,
    );
  });

  it("projects prepend, match, and redirect routes", () => {
    const routes = createQiankunMasterRoutes({
      apps: [
        {
          name: "catalog",
          entry: "https://example.com/catalog/",
        },
      ],
      routes: [
        { path: "/catalog", microApp: "catalog" },
        {
          path: "/catalog-exact",
          microApp: "catalog",
          mode: "match",
        },
        { path: "/legacy", redirect: "/catalog" },
      ],
    });

    expect(routes).toEqual([
      expect.objectContaining({ path: "/catalog/$" }),
      expect.objectContaining({ path: "/catalog-exact" }),
      {
        id: "__evjs_qiankun_redirect_2",
        path: "/legacy",
        kind: "redirect",
        redirect: { kind: "path", path: "/catalog" },
      },
    ]);
  });

  it("preserves valid static, dynamic, and catch-all snapshot patterns", () => {
    const routes = createQiankunMasterRoutes({
      apps: [
        {
          name: "catalog",
          entry: "https://example.com/catalog/",
        },
      ],
      routes: [
        {
          path: "/catalog/products",
          microApp: "catalog",
          mode: "match",
        },
        {
          path: "/tenants/:tenantId",
          microApp: "catalog",
          mode: "match",
        },
        {
          path: "/assets/*",
          microApp: "catalog",
          mode: "match",
        },
      ],
    });

    expect(routes.map((route) => route.path)).toEqual([
      "/catalog/products",
      "/tenants/$tenantId",
      "/assets/$",
    ]);
  });

  it("derives dynamic slave bases from the active Router pathname", () => {
    const route = {
      path: "/tenant/:tenantId",
      microApp: "catalog",
    };

    expect(
      resolveQiankunSlaveBase(
        "/workspace",
        route,
        "/workspace/tenant/acme/orders",
      ),
    ).toBe("/workspace/tenant/acme");
    expect(
      resolveQiankunSlaveBase("/workspace", route, "/tenant/acme/orders"),
    ).toBe("/workspace/tenant/acme");
    expect(
      resolveQiankunSlaveBase(
        "/workspace",
        { ...route, mode: "match" },
        "/tenant/acme",
      ),
    ).toBe("/workspace");
  });

  it("shares browser navigation without replacing the host history methods", async () => {
    const win = createHistoryWindow("/catalog");
    const nativePushState = win.history.pushState;
    const nativeReplaceState = win.history.replaceState;
    const hostHistory = createBrowserHistory({ window: win });
    const hostPushState = win.history.pushState;
    const hostReplaceState = win.history.replaceState;
    const slaveHistory = createQiankunSlaveHistory(
      "browser",
      win as unknown as Window,
    );
    const hostLocations: string[] = [];
    const slaveLocations: string[] = [];
    hostHistory.subscribe(({ location }) => hostLocations.push(location.href));
    slaveHistory.subscribe(({ location }) =>
      slaveLocations.push(location.href),
    );

    expect(win.history.pushState).toBe(hostPushState);
    expect(win.history.replaceState).toBe(hostReplaceState);
    expect(win.listenerCount("popstate")).toBe(2);

    slaveHistory.push("/catalog/details?tab=all");
    slaveHistory.flush();

    expect(win.location.pathname).toBe("/catalog/details");
    expect(win.location.search).toBe("?tab=all");
    expect(hostHistory.location.href).toBe("/catalog/details?tab=all");
    expect(slaveHistory.location.href).toBe("/catalog/details?tab=all");
    expect(hostLocations).toEqual(["/catalog/details?tab=all"]);
    expect(slaveLocations).toEqual(["/catalog/details?tab=all"]);

    win.history.back();
    await Promise.resolve();

    expect(win.location.pathname).toBe("/catalog");
    expect(hostHistory.location.href).toBe("/catalog");
    expect(slaveHistory.location.href).toBe("/catalog");
    expect(hostLocations).toEqual(["/catalog/details?tab=all", "/catalog"]);
    expect(slaveLocations).toEqual(["/catalog/details?tab=all", "/catalog"]);

    win.history.forward();
    await Promise.resolve();

    expect(win.location.pathname).toBe("/catalog/details");
    expect(hostHistory.location.href).toBe("/catalog/details?tab=all");
    expect(slaveHistory.location.href).toBe("/catalog/details?tab=all");
    expect(hostLocations).toEqual([
      "/catalog/details?tab=all",
      "/catalog",
      "/catalog/details?tab=all",
    ]);
    expect(slaveLocations).toEqual([
      "/catalog/details?tab=all",
      "/catalog",
      "/catalog/details?tab=all",
    ]);

    slaveHistory.destroy();
    expect(win.history.pushState).toBe(hostPushState);
    expect(win.history.replaceState).toBe(hostReplaceState);
    expect(win.listenerCount("popstate")).toBe(1);

    hostHistory.destroy();
    expect(win.history.pushState).toBe(nativePushState);
    expect(win.history.replaceState).toBe(nativeReplaceState);
  });

  it("does not resurrect host history hooks when the host releases them first", async () => {
    const win = createHistoryWindow("/catalog");
    const nativePushState = win.history.pushState;
    const nativeReplaceState = win.history.replaceState;
    const hostHistory = createBrowserHistory({ window: win });
    const slaveHistory = createQiankunSlaveHistory(
      "browser",
      win as unknown as Window,
    );
    const slaveLocations: string[] = [];
    slaveHistory.subscribe(({ location }) =>
      slaveLocations.push(location.href),
    );

    hostHistory.destroy();
    expect(win.history.pushState).toBe(nativePushState);
    expect(win.history.replaceState).toBe(nativeReplaceState);

    slaveHistory.push("/catalog/details");
    slaveHistory.flush();
    win.history.back();
    await Promise.resolve();

    expect(win.location.pathname).toBe("/catalog");
    expect(slaveHistory.location.href).toBe("/catalog");
    expect(slaveLocations).toEqual(["/catalog/details", "/catalog"]);

    slaveHistory.destroy();
    expect(win.history.pushState).toBe(nativePushState);
    expect(win.history.replaceState).toBe(nativeReplaceState);
  });

  it("refreshes scoped history after a host programmatic navigation", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    const win = createHistoryWindow("/catalog");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: win,
    });
    const hostHistory = createBrowserHistory({ window: win });
    let activeHistory: ReturnType<typeof createQiankunSlaveHistory> | undefined;
    const updateRuntime = vi.fn(
      (update: { history?: ReturnType<typeof createQiankunSlaveHistory> }) => {
        if (update.history) activeHistory = update.history;
      },
    );
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      async loadEntry() {
        return {
          pagesApp: { updateRuntime },
          start: vi.fn(),
          app: { unmount: vi.fn() },
        };
      },
    });

    try {
      await slave.mount({
        container: createElement(),
        base: "/catalog",
        history: "browser",
      });
      const mountedHistory = activeHistory;
      if (!mountedHistory) {
        throw new Error("Expected the mounted slave history projection.");
      }
      expect(mountedHistory.location.href).toBe("/catalog");
      const destroyMountedHistory = vi.spyOn(mountedHistory, "destroy");

      hostHistory.push("/catalog/details");
      hostHistory.flush();
      expect(win.location.pathname).toBe("/catalog/details");
      expect(mountedHistory?.location.href).toBe("/catalog");

      await slave.update({});

      expect(updateRuntime).toHaveBeenCalledTimes(2);
      expect(activeHistory).not.toBe(mountedHistory);
      expect(activeHistory?.location.href).toBe("/catalog/details");
      expect(destroyMountedHistory).toHaveBeenCalledTimes(1);

      await slave.unmount();
    } finally {
      hostHistory.destroy();
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
      } else {
        delete (globalThis as { window?: unknown }).window;
      }
    }
  });

  it("keeps hash navigation synchronized with native browser history", async () => {
    const win = createHistoryWindow("/shell#/catalog");
    const hostHistory = createBrowserHistory({ window: win });
    const hostPushState = win.history.pushState;
    const hostReplaceState = win.history.replaceState;
    const slaveHistory = createQiankunSlaveHistory(
      "hash",
      win as unknown as Window,
    );

    slaveHistory.push("/catalog/details?tab=all");
    slaveHistory.flush();

    expect(win.location.pathname).toBe("/shell");
    expect(win.location.hash).toBe("#/catalog/details?tab=all");
    expect(hostHistory.location.href).toBe("/shell#/catalog/details?tab=all");
    expect(slaveHistory.location.href).toBe("/catalog/details?tab=all");

    slaveHistory.back();
    await Promise.resolve();

    expect(hostHistory.location.href).toBe("/shell#/catalog");
    expect(slaveHistory.location.href).toBe("/catalog");

    slaveHistory.destroy();
    expect(win.history.pushState).toBe(hostPushState);
    expect(win.history.replaceState).toBe(hostReplaceState);
    hostHistory.destroy();
  });

  it("waits for a deferred route update before unmounting its micro-app", async () => {
    const calls: string[] = [];
    let finishUpdate: (() => void) | undefined;
    const updateQueue = new Promise<void>((resolve) => {
      finishUpdate = () => {
        calls.push("update");
        resolve();
      };
    });
    const microApp = {
      mountPromise: Promise.resolve(),
      unmount: vi.fn(() => {
        calls.push("unmount");
      }),
    };

    const cleanup = unmountQiankunMicroAppAfterUpdates(microApp, updateQueue);
    await Promise.resolve();

    expect(microApp.unmount).not.toHaveBeenCalled();
    finishUpdate?.();
    await cleanup;

    expect(calls).toEqual(["update", "unmount"]);
  });

  it("installs master routes into the real Pages app without removing canonical routes", async () => {
    function Home() {
      return null;
    }

    const pagesApp = createPagesApp({
      routes: [{ id: "home", path: "/", module: { default: Home } }],
      history: { type: "memory", initialEntries: ["/catalog"] },
    });
    const runtimeRoutes = createQiankunMasterRoutes({
      apps: [{ name: "catalog", entry: "https://example.com/catalog/" }],
      routes: [{ path: "/catalog", microApp: "catalog" }],
    });

    await pagesApp.updateRuntime({ routes: runtimeRoutes });

    const router = pagesApp.app.router as {
      matchRoutes(pathname: string): Array<{ routeId: string }>;
    };
    expect(router.matchRoutes("/").length).toBeGreaterThan(1);
    expect(router.matchRoutes("/catalog").length).toBeGreaterThan(1);
    expect(router.matchRoutes("/catalog/details").length).toBeGreaterThan(1);
  });

  it("does not render the master when the runtime overlay update fails", async () => {
    const start = vi.fn();
    await expect(
      startQiankunMaster({
        resolver: async () => ({ apps: [], routes: [] }),
        mount: "#app",
        async loadEntry() {
          return {
            pagesApp: {
              updateRuntime: vi.fn(async () => {
                throw new Error("runtime route update failed");
              }),
            },
            start,
          };
        },
      }),
    ).rejects.toThrow("runtime route update failed");
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects a malformed route snapshot before loading the master entry", async () => {
    const loadEntry = vi.fn();

    await expect(
      startQiankunMaster({
        resolver: async () => ({
          apps: [{ name: "catalog", entry: "https://example.com" }],
          routes: [{ path: "/:", microApp: "catalog" }],
        }),
        mount: "#app",
        loadEntry,
      }),
    ).rejects.toThrow('contains dynamic segment ":" without a param name');
    expect(loadEntry).not.toHaveBeenCalled();
  });

  it("rejects malformed, conflicting, and unresolved runtime routes", () => {
    expect(() =>
      createQiankunMasterRoutes({
        apps: [],
        routes: [{ path: "catalog", microApp: "catalog" }],
      }),
    ).toThrow('routes[0].path must start with "/"');

    expect(() =>
      createQiankunMasterRoutes({
        apps: [{ name: "catalog", entry: "https://example.com" }],
        routes: [
          { path: "/catalog", microApp: "catalog" },
          { path: "/catalog", redirect: "/" },
        ],
      }),
    ).toThrow('duplicate route path "/catalog"');

    expect(() =>
      createQiankunMasterRoutes({
        apps: [],
        routes: [{ path: "/catalog", microApp: "missing" }],
      }),
    ).toThrow('references unknown micro-app "missing"');

    expect(() =>
      createQiankunMasterRoutes({
        apps: [{ name: "catalog", entry: "https://example.com" }],
        routes: [
          {
            path: "/catalog",
            microApp: "catalog",
            microAppProps: {
              lifeCycles: "invalid" as unknown as never,
            },
          },
        ],
      }),
    ).toThrow("routes[0].microAppProps.lifeCycles must be an object");
  });

  it.each([
    ["/:", 'contains dynamic segment ":" without a param name'],
    ["/catalog/:", 'contains dynamic segment ":" without a param name'],
    ["/catalog//details", 'must not contain repeated "/" separators'],
    ["/catalog/:product-id", 'dynamic segment ":product-id" must use ":param"'],
    ["/catalog/*/details", "wildcard must be the terminal path segment"],
    ["/catalog/$", 'must use ":param" or "*" syntax'],
    ["/catalog/:id/:id", 'uses duplicate dynamic param name "id"'],
    ["/catalog/:_splat", 'uses reserved dynamic param name "_splat"'],
  ])("rejects malformed master route snapshot path %s", (path, expectedMessage) => {
    expect(() =>
      createQiankunMasterRoutes({
        apps: [{ name: "catalog", entry: "https://example.com" }],
        routes: [{ path, microApp: "catalog" }],
      }),
    ).toThrow(expectedMessage);
  });

  it("detects duplicate route paths after trailing-slash normalization", () => {
    expect(() =>
      createQiankunMasterRoutes({
        apps: [{ name: "catalog", entry: "https://example.com" }],
        routes: [
          { path: "/catalog", microApp: "catalog" },
          { path: "/catalog/", redirect: "/" },
        ],
      }),
    ).toThrow('duplicate route path "/catalog"');
  });

  it.each<[QiankunRoute[], string]>([
    [
      [
        { path: "/tenants/:tenantId", microApp: "catalog", mode: "match" },
        { path: "/tenants/:id", microApp: "catalog", mode: "match" },
      ],
      '"/tenants/:id" conflicts with routes[0].path "/tenants/:tenantId"',
    ],
    [
      [
        { path: "/catalog", microApp: "catalog" },
        { path: "/catalog/*", microApp: "catalog", mode: "match" },
      ],
      '"/catalog/*" conflicts with routes[0].path "/catalog"',
    ],
  ])("rejects routes with the same normalized runtime shape", (routes, expectedMessage) => {
    expect(() =>
      createQiankunMasterRoutes({
        apps: [{ name: "catalog", entry: "https://example.com" }],
        routes,
      }),
    ).toThrow(expectedMessage);
  });

  it("rejects unknown master, app, route, and lifecycle fields", () => {
    expect(() =>
      createQiankunMasterRoutes({
        apps: [],
        appNameKeyAlias: "externalId",
      } as unknown as QiankunMasterOptions),
    ).toThrow('options contains unknown field "appNameKeyAlias"');

    expect(() =>
      createQiankunMasterRoutes({
        apps: [
          {
            name: "catalog",
            entry: "https://example.com/catalog/",
            credentials: true,
          },
        ],
      } as unknown as QiankunMasterOptions),
    ).toThrow('apps[0] contains unknown field "credentials"');

    expect(() =>
      createQiankunMasterRoutes({
        apps: [{ name: "catalog", entry: "https://example.com/catalog/" }],
        routes: [
          {
            path: "/catalog",
            microApp: "catalog",
            activeRule: "/catalog",
          },
        ],
      } as unknown as QiankunMasterOptions),
    ).toThrow('routes[0] contains unknown field "activeRule"');

    expect(() =>
      createQiankunMasterRoutes({
        routes: [{ path: "/legacy", redirect: "/", mode: "match" }],
      } as unknown as QiankunMasterOptions),
    ).toThrow('routes[0] contains unknown field "mode"');

    expect(() =>
      createQiankunMasterRoutes({
        lifeCycles: {
          beforeMout: vi.fn(),
        },
      } as unknown as QiankunMasterOptions),
    ).toThrow('lifeCycles contains unknown field "beforeMout"');

    expect(() =>
      createQiankunMasterRoutes({
        apps: [{ name: "catalog", entry: "https://example.com/catalog/" }],
        routes: [
          {
            path: "/catalog",
            microApp: "catalog",
            microAppProps: {
              lifeCycles: {
                afterMout: vi.fn(),
              },
            },
          },
        ],
      } as unknown as QiankunMasterOptions),
    ).toThrow(
      'routes[0].microAppProps.lifeCycles contains unknown field "afterMout"',
    );
  });

  it("keeps app props and route micro-app props extensible", () => {
    expect(() =>
      createQiankunMasterRoutes({
        apps: [
          {
            name: "catalog",
            entry: "https://example.com/catalog/",
            props: {
              externalId: "catalog-reference",
              credentials: "include",
            },
          },
        ],
        routes: [
          {
            path: "/catalog",
            microApp: "catalog",
            microAppProps: {
              platformRouteId: "catalog-route",
              requestScope: "catalog:read",
            },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("loads the slave entry once and remounts its app after unmount", async () => {
    const calls: string[] = [];
    let containerHtml = "<div></div>";
    const container = {
      get innerHTML() {
        return containerHtml;
      },
      set innerHTML(value: string) {
        calls.push("clear");
        containerHtml = value;
      },
      querySelector: vi.fn(() => undefined),
    } as unknown as Element;
    const slave = createQiankunSlaveLifecycles({
      name: "console",
      mount: "#app",
      runtime: {
        bootstrap: async () => {
          calls.push("bootstrap");
        },
        mount: async () => {
          calls.push("mount");
        },
        unmount: async () => {
          calls.push("unmount");
        },
      },
      loadEntry: async () => {
        calls.push("entry");
        return {
          app: {
            render(target: Element) {
              expect(target).toBe(container);
              calls.push("entry-render");
            },
            unmount() {
              calls.push("entry-unmount");
            },
          },
        };
      },
    });

    await slave.bootstrap({ container });
    await slave.mount({ container });
    await slave.unmount({ container });
    await slave.mount({ container });
    await slave.unmount({ container });

    expect(calls).toEqual([
      "bootstrap",
      "mount",
      "entry",
      "entry-render",
      "unmount",
      "entry-unmount",
      "clear",
      "mount",
      "entry-render",
      "unmount",
      "entry-unmount",
      "clear",
    ]);
    expect(containerHtml).toBe("");
  });

  it("uses the nested slave container without patching document lookups", async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    );
    const masterRoot = createElement();
    const slaveRoot = createElement();
    const querySelector = vi.fn(() => masterRoot);
    const getElementById = vi.fn(() => masterRoot);
    const outerContainer = {
      innerHTML: '<div id="app"></div>',
      querySelector: vi.fn((selector: string) =>
        selector === "#app" ? slaveRoot : null,
      ),
    } as unknown as Element;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { querySelector, getElementById },
    });

    try {
      const slave = createQiankunSlaveLifecycles({
        name: "catalog",
        mount: "#app",
        runtime: {
          mount(_props, context) {
            expect(context.container).toBe(slaveRoot);
          },
        },
        async loadEntry() {
          expect(globalThis.document.querySelector).toBe(querySelector);
          expect(globalThis.document.getElementById).toBe(getElementById);
          return {
            start(target: Element) {
              expect(target).toBe(slaveRoot);
            },
            app: { unmount() {} },
          };
        },
      });

      await slave.mount({ container: outerContainer });
      await slave.unmount({ container: outerContainer });

      expect(outerContainer.querySelector).toHaveBeenCalledWith("#app");
      expect(querySelector).not.toHaveBeenCalled();
      expect(getElementById).not.toHaveBeenCalled();
      expect(globalThis.document.querySelector).toBe(querySelector);
      expect(globalThis.document.getElementById).toBe(getElementById);
    } finally {
      if (originalDocument) {
        Object.defineProperty(globalThis, "document", originalDocument);
      } else {
        delete (globalThis as { document?: unknown }).document;
      }
    }
  });

  it("uses the framework start export for a standalone first mount", async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    );
    const calls: string[] = [];
    const container = createElement();
    Object.defineProperty(globalThis, "document", {
      value: {
        querySelector: vi.fn((selector: string) =>
          selector === "#app" ? container : null,
        ),
      },
      configurable: true,
    });

    try {
      const slave = createQiankunSlaveLifecycles({
        name: "catalog",
        mount: "#app",
        async loadEntry() {
          return {
            start(target: Element) {
              expect(target).toBe(container);
              calls.push("entry-start");
            },
            app: {
              render(target: Element) {
                expect(target).toBe(container);
                calls.push("entry-render");
              },
              unmount() {
                calls.push("entry-unmount");
              },
            },
          };
        },
      });

      await slave.standalone();
      await slave.unmount();
      await slave.standalone();

      expect(calls).toEqual(["entry-start", "entry-unmount", "entry-render"]);
    } finally {
      if (originalDocument) {
        Object.defineProperty(globalThis, "document", originalDocument);
      } else {
        delete (globalThis as { document?: unknown }).document;
      }
    }
  });

  it("projects slave base and history before the first render", async () => {
    const calls: string[] = [];
    const container = createElement();
    const updateRuntime = vi.fn(async () => calls.push("configure"));
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      async loadEntry() {
        calls.push("entry");
        return {
          pagesApp: { updateRuntime },
          start(target: Element) {
            expect(target).toBe(container);
            calls.push("start");
          },
        };
      },
    });

    await slave.mount({
      container,
      base: "/catalog",
      history: "hash",
    });

    expect(calls).toEqual(["entry", "configure", "start"]);
    expect(updateRuntime).toHaveBeenCalledWith({
      basepath: "/catalog",
      history: { type: "hash" },
    });
  });

  it("projects and releases scoped browser history in qiankun mode", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    const win = createHistoryWindow("/catalog");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: win,
    });
    const hostHistory = createBrowserHistory({ window: win });
    const hostPushState = win.history.pushState;
    const hostReplaceState = win.history.replaceState;

    try {
      const updateRuntime = vi.fn();
      const slave = createQiankunSlaveLifecycles({
        name: "catalog",
        mount: "#app",
        async loadEntry() {
          return {
            pagesApp: { updateRuntime },
            start: vi.fn(),
            app: { unmount: vi.fn() },
          };
        },
      });

      await slave.mount({
        container: createElement(),
        base: "/catalog",
        history: "browser",
      });

      const projection = updateRuntime.mock.calls[0]?.[0] as {
        basepath?: string;
        history?: { push?: unknown; back?: unknown; destroy?: unknown };
      };
      expect(projection.basepath).toBe("/catalog");
      expect(projection.history).toEqual(
        expect.objectContaining({
          push: expect.any(Function),
          back: expect.any(Function),
          destroy: expect.any(Function),
        }),
      );
      expect(win.history.pushState).toBe(hostPushState);
      expect(win.history.replaceState).toBe(hostReplaceState);
      expect(win.listenerCount("popstate")).toBe(2);

      await slave.unmount({ container: createElement() });

      expect(win.listenerCount("popstate")).toBe(1);
      expect(win.history.pushState).toBe(hostPushState);
      expect(win.history.replaceState).toBe(hostReplaceState);
    } finally {
      hostHistory.destroy();
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
      } else {
        delete (globalThis as { window?: unknown }).window;
      }
    }
  });

  it("reuses an equivalent slave runtime projection across remounts", async () => {
    const container = createElement();
    const updateRuntime = vi.fn();
    const render = vi.fn();
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      async loadEntry() {
        return {
          pagesApp: { updateRuntime },
          start: vi.fn(),
          app: { render, unmount: vi.fn() },
        };
      },
    });

    const props = { container, base: "/catalog", history: "hash" as const };
    await slave.mount(props);
    await slave.unmount(props);
    await slave.mount(props);

    expect(updateRuntime).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("projects incremental slave base and history updates", async () => {
    const container = createElement();
    const updateRuntime = vi.fn();
    const runtimeUpdate = vi.fn();
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      runtime: { update: runtimeUpdate },
      async loadEntry() {
        return {
          pagesApp: { updateRuntime },
          start: vi.fn(),
          app: { render: vi.fn(), unmount: vi.fn() },
        };
      },
    });

    await slave.mount({
      container,
      base: "/tenant/acme",
      history: "hash",
    });
    await slave.update({ base: "/tenant/beta" });
    await slave.update({ history: "memory" });

    expect(runtimeUpdate).toHaveBeenCalledTimes(2);
    expect(updateRuntime).toHaveBeenNthCalledWith(1, {
      basepath: "/tenant/acme",
      history: { type: "hash" },
    });
    expect(updateRuntime).toHaveBeenNthCalledWith(2, {
      basepath: "/tenant/beta",
    });
    expect(updateRuntime).toHaveBeenNthCalledWith(3, {
      history: { type: "memory" },
    });
  });

  it("renders an entry that was preloaded before the first mount", async () => {
    const calls: string[] = [];
    const container = createElement();
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      runtime: {
        async bootstrap(_props, context) {
          await context.loadEntry();
        },
      },
      async loadEntry() {
        calls.push("entry");
        return {
          app: {
            render(target: Element) {
              expect(target).toBe(container);
              calls.push("entry-render");
            },
          },
        };
      },
    });

    await slave.bootstrap({ container });
    await slave.mount({ container });

    expect(calls).toEqual(["entry", "entry-render"]);
  });

  it("renders a preloaded entry once when its preload is still pending", async () => {
    const calls: string[] = [];
    let resolveEntry: ((entry: unknown) => void) | undefined;
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      runtime: {
        bootstrap(_props, context) {
          void context.loadEntry();
        },
      },
      loadEntry: () =>
        new Promise((resolve) => {
          resolveEntry = resolve;
        }),
    });

    await slave.bootstrap({ container: createElement() });
    const mounting = slave.mount({ container: createElement() });
    resolveEntry?.({
      app: {
        render() {
          calls.push("entry-render");
        },
      },
    });
    await mounting;

    expect(calls).toEqual(["entry-render"]);
  });

  it("retries a rejected slave entry load on the next mount", async () => {
    const loadError = new Error("entry load failed");
    const container = createElement();
    const runtimeMount = vi.fn();
    const runtimeUnmount = vi.fn();
    const render = vi.fn();
    let loadAttempts = 0;
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      runtime: {
        mount: runtimeMount,
        unmount: runtimeUnmount,
      },
      async loadEntry() {
        loadAttempts += 1;
        if (loadAttempts === 1) throw loadError;
        return { app: { render, unmount: vi.fn() } };
      },
    });

    await expect(slave.mount({ container })).rejects.toBe(loadError);
    await slave.mount({ container });

    expect(loadAttempts).toBe(2);
    expect(runtimeMount).toHaveBeenCalledTimes(2);
    expect(runtimeUnmount).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("preserves the original mount error when rollback also fails", async () => {
    const mountError = new Error("runtime mount failed");
    const rollbackError = new Error("runtime rollback failed");
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      runtime: {
        mount() {
          throw mountError;
        },
        unmount() {
          throw rollbackError;
        },
      },
      async loadEntry() {
        return { app: { render() {} } };
      },
    });
    let receivedError: unknown;

    try {
      await slave.mount({ container: createElement() });
    } catch (error) {
      receivedError = error;
    }

    expect(receivedError).toBeInstanceOf(AggregateError);
    expect((receivedError as AggregateError).errors).toEqual([
      mountError,
      rollbackError,
    ]);
  });

  it("rolls back entry, projection, runtime, and container state after mount fails", async () => {
    const mountError = new Error("entry start failed");
    const calls: string[] = [];
    let containerHtml = "";
    const container = {
      get innerHTML() {
        return containerHtml;
      },
      set innerHTML(value: string) {
        containerHtml = value;
        calls.push(value ? `html:${value}` : "clear");
      },
      querySelector: vi.fn(() => undefined),
    } as unknown as Element;
    let activeBase = "/";
    let activeHistory = "browser";
    let startAttempts = 0;
    const updateRuntime = vi.fn(
      async (update: { basepath?: string; history?: { type: string } }) => {
        if (update.basepath) activeBase = update.basepath;
        if (update.history) activeHistory = update.history.type;
        calls.push(`projection:${activeBase}:${activeHistory}`);
      },
    );
    const loadEntry = vi.fn(async () => ({
      pagesApp: { updateRuntime },
      start() {
        startAttempts += 1;
        calls.push("entry-start");
        if (startAttempts === 1) {
          container.innerHTML = "partial";
          throw mountError;
        }
      },
      app: {
        unmount() {
          calls.push("entry-unmount");
        },
      },
    }));
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      runtime: {
        mount() {
          calls.push("runtime-mount");
        },
        unmount() {
          calls.push("runtime-unmount");
        },
      },
      loadEntry,
    });
    const props = {
      container,
      base: "/catalog",
      history: "hash" as const,
    };

    await expect(slave.mount(props)).rejects.toBe(mountError);

    expect(activeBase).toBe("/");
    expect(activeHistory).toBe("browser");
    expect(containerHtml).toBe("");
    expect(calls).toEqual([
      "runtime-mount",
      "projection:/catalog:hash",
      "entry-start",
      "html:partial",
      "entry-unmount",
      "projection:/:browser",
      "runtime-unmount",
      "clear",
    ]);

    await slave.mount(props);

    expect(loadEntry).toHaveBeenCalledTimes(1);
    expect(startAttempts).toBe(2);
    expect(activeBase).toBe("/catalog");
    expect(activeHistory).toBe("hash");
  });

  it("keeps a live scoped history after a browser mount rolls back", async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    );
    const win = createHistoryWindow("/catalog");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: win,
    });
    Object.defineProperty(globalThis, "self", {
      configurable: true,
      value: win,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
    });
    const hostHistory = createBrowserHistory({ window: win });
    const hostPushState = win.history.pushState;
    const hostReplaceState = win.history.replaceState;
    const pagesApp = createPagesApp({
      routes: [
        { path: "/", module: { default: () => null } },
        { path: "/$", module: { default: () => null } },
      ],
    });
    const router = pagesApp.app.router as {
      history: ReturnType<typeof createQiankunSlaveHistory>;
    };
    const initialHistory = router.history;
    const mountError = new Error("entry start failed");
    const retryError = new Error("runtime mount failed");
    const runtimeMount = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(retryError);
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      runtime: { mount: runtimeMount },
      async loadEntry() {
        return {
          pagesApp,
          app: pagesApp.app,
          start() {
            throw mountError;
          },
        };
      },
    });

    try {
      await expect(
        slave.mount({
          container: createElement(),
          base: "/catalog",
          history: "browser",
        }),
      ).rejects.toBe(mountError);

      const restoredHistory = router.history;
      expect(restoredHistory).not.toBe(initialHistory);
      expect(restoredHistory.location.href).toBe("/catalog");
      expect(win.history.pushState).toBe(hostPushState);
      expect(win.history.replaceState).toBe(hostReplaceState);
      expect(win.listenerCount("popstate")).toBe(2);

      await expect(
        slave.mount({
          container: createElement(),
          base: "/catalog",
          history: "browser",
        }),
      ).rejects.toBe(retryError);
      expect(router.history).toBe(restoredHistory);
      expect(router.history.location.href).toBe("/catalog");
      expect(win.listenerCount("popstate")).toBe(2);

      await slave.unmount();
      expect(win.listenerCount("popstate")).toBe(1);
    } finally {
      hostHistory.destroy();
      restoreGlobal("window", originalWindow);
      restoreGlobal("self", originalSelf);
      restoreGlobal("document", originalDocument);
    }
  });

  it("resets mount state when multiple unmount steps fail", async () => {
    const calls: string[] = [];
    const container = createElement();
    let failUnmount = true;
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      runtime: {
        unmount() {
          calls.push("runtime-unmount");
          if (failUnmount) throw new Error("runtime cleanup failed");
        },
      },
      async loadEntry() {
        return {
          app: {
            render() {
              calls.push("entry-render");
            },
            unmount() {
              calls.push("entry-unmount");
              if (failUnmount) throw new Error("entry cleanup failed");
            },
          },
        };
      },
    });

    await slave.mount({ container });
    await expect(slave.unmount({ container })).rejects.toThrow(
      "Multiple slave unmount steps failed.",
    );
    failUnmount = false;
    await slave.mount({ container });
    await slave.unmount({ container });

    expect(calls).toEqual([
      "entry-render",
      "runtime-unmount",
      "entry-unmount",
      "entry-render",
      "runtime-unmount",
      "entry-unmount",
    ]);
  });

  it("serializes duplicate mount and interleaved unmount calls per slave instance", async () => {
    const mountStarted = createDeferred();
    const mountGate = createDeferred();
    const runtimeMount = vi.fn(async () => {
      mountStarted.resolve();
      await mountGate.promise;
    });
    const runtimeUnmount = vi.fn();
    const render = vi.fn();
    const entryUnmount = vi.fn();
    const container = createElement();
    const slave = createQiankunSlaveLifecycles({
      name: "catalog",
      mount: "#app",
      runtime: { mount: runtimeMount, unmount: runtimeUnmount },
      async loadEntry() {
        return { app: { render, unmount: entryUnmount } };
      },
    });

    const firstMount = slave.mount({ container });
    const duplicateMount = slave.mount({ container });
    const interleavedUnmount = slave.unmount({ container });
    await mountStarted.promise;
    mountGate.resolve();
    await Promise.all([firstMount, duplicateMount, interleavedUnmount]);

    expect(runtimeMount).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(runtimeUnmount).toHaveBeenCalledTimes(1);
    expect(entryUnmount).toHaveBeenCalledTimes(1);
  });
});

function createElement(): Element {
  return {
    innerHTML: "",
    querySelector: vi.fn(() => undefined),
  } as unknown as Element;
}

function createDeferred(): { promise: Promise<void>; resolve(): void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      resolvePromise?.();
    },
  };
}

function createHistoryWindow(initialHref: string) {
  type HistoryEntry = { href: string; state: Record<string, unknown> };
  const origin = "https://evjs.test";
  const listeners = new Map<string, Set<EventListener>>();
  const entries: HistoryEntry[] = [
    {
      href: initialHref,
      state: { __TSR_index: 0, key: "initial", __TSR_key: "initial" },
    },
  ];
  let index = 0;
  const location = {
    pathname: "/",
    search: "",
    hash: "",
  };

  const applyHref = (href: string | URL | null | undefined) => {
    const url = new URL(
      href?.toString() ?? entries[index]?.href ?? "/",
      origin,
    );
    location.pathname = url.pathname;
    location.search = url.search;
    location.hash = url.hash;
    return `${url.pathname}${url.search}${url.hash}`;
  };
  applyHref(initialHref);

  const dispatch = (type: string) => {
    const event = new Event(type);
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  const move = (delta: number) => {
    const nextIndex = Math.min(Math.max(index + delta, 0), entries.length - 1);
    if (nextIndex === index) return;
    index = nextIndex;
    applyHref(entries[index]?.href);
    dispatch("popstate");
  };

  const history = {
    get length() {
      return entries.length;
    },
    get state() {
      return entries[index]?.state;
    },
    pushState: vi.fn(
      (
        state: Record<string, unknown>,
        _unused: string,
        href?: string | URL | null,
      ) => {
        const nextHref = applyHref(href);
        entries.splice(index + 1, entries.length, { href: nextHref, state });
        index = entries.length - 1;
      },
    ),
    replaceState: vi.fn(
      (
        state: Record<string, unknown>,
        _unused: string,
        href?: string | URL | null,
      ) => {
        const nextHref = applyHref(href);
        entries[index] = { href: nextHref, state };
      },
    ),
    go: vi.fn((delta = 0) => move(delta)),
    back: vi.fn(() => move(-1)),
    forward: vi.fn(() => move(1)),
  };

  return {
    history,
    location,
    addEventListener(type: string, listener: EventListener) {
      const eventListeners = listeners.get(type) ?? new Set<EventListener>();
      eventListeners.add(listener);
      listeners.set(type, eventListeners);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function restoreGlobal(
  key: "window" | "self" | "document",
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
  } else {
    delete (globalThis as Record<string, unknown>)[key];
  }
}
