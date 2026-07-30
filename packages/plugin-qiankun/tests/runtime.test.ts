import { createPagesApp } from "@evjs/ev/_internal/client";
import { describe, expect, it, vi } from "vitest";
import {
  createQiankunMasterRoutes,
  createQiankunSlaveLifecycles,
  defineQiankunMasterResolver,
  defineQiankunSlaveRuntime,
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
    const resolver = vi.fn(async () => ({
      apps: [
        {
          name: "console",
          entry: "https://example.com/console/",
          platformId: "platform-console",
        },
      ],
      routes: [{ path: "/console", microApp: "platform-console" }],
      appNameKeyAlias: "platformId",
      prefetch: "all" as const,
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
      undefined,
    );
  });

  it("projects prepend, match, alias, and redirect routes", () => {
    const routes = createQiankunMasterRoutes({
      apps: [
        {
          name: "catalog",
          entry: "https://example.com/catalog/",
          platformId: "catalog-id",
        },
      ],
      appNameKeyAlias: "platformId",
      routes: [
        { path: "/catalog", microApp: "catalog-id" },
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

  it("scopes slave document mount lookups to the qiankun container while loading entry", async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    );
    const masterRoot = { name: "master" };
    const slaveRoot = { name: "slave" };
    const querySelector = vi.fn(() => masterRoot);
    const getElementById = vi.fn(() => masterRoot);
    const fakeDocument = { querySelector, getElementById };
    const container = {
      innerHTML: '<div id="app"></div>',
      querySelector: vi.fn((selector: string) =>
        selector === "#app" ? slaveRoot : null,
      ),
    } as unknown as Element;
    let queryResult: unknown;
    let idResult: unknown;

    Object.defineProperty(globalThis, "document", {
      value: fakeDocument,
      configurable: true,
    });

    try {
      const slave = createQiankunSlaveLifecycles({
        name: "catalog",
        mount: "#app",
        runtime: {
          async mount(_props, context) {
            await context.loadEntry();
          },
        },
        loadEntry: async () => {
          queryResult = globalThis.document.querySelector("#app");
          idResult = globalThis.document.getElementById("app");
          return { app: { render() {} } };
        },
      });

      await slave.mount({ container });

      expect(queryResult).toBe(slaveRoot);
      expect(idResult).toBe(slaveRoot);
      expect(querySelector).not.toHaveBeenCalledWith("#app");
      expect(getElementById).not.toHaveBeenCalledWith("app");
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
});

function createElement(): Element {
  return {
    innerHTML: "",
    querySelector: vi.fn(() => undefined),
  } as unknown as Element;
}
