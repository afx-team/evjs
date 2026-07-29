import { describe, expect, it, vi } from "vitest";
import {
  createQiankunSlaveLifecycles,
  defineQiankunMasterResolver,
  defineQiankunSlaveRuntime,
  startQiankunMaster,
} from "../src/runtime.js";

const qiankun = vi.hoisted(() => ({
  registerMicroApps: vi.fn(),
  start: vi.fn(),
}));

vi.mock("qiankun", () => qiankun);

describe("@evjs/plugin-qiankun runtime", () => {
  it("keeps master and slave runtime helpers as identity functions", () => {
    const resolver = async () => ({ apps: [] });
    const runtime = { bootstrap: vi.fn() };

    expect(defineQiankunMasterResolver(resolver)).toBe(resolver);
    expect(defineQiankunSlaveRuntime(runtime)).toBe(runtime);
  });

  it("starts qiankun master with route-derived active rules", async () => {
    qiankun.registerMicroApps.mockClear();
    qiankun.start.mockClear();
    const container = createElement();

    await startQiankunMaster(async () => ({
      appNameKeyAlias: "yuyanId",
      apps: [
        {
          name: "console",
          entry: "https://example.com/console/",
          container,
          yuyanId: "yyy",
        },
      ],
      routes: [
        {
          path: "/console",
          microApp: "yyy",
        },
      ],
      sandbox: true,
      prefetch: true,
    }));

    expect(qiankun.registerMicroApps).toHaveBeenCalledWith([
      {
        name: "console",
        entry: "https://example.com/console/",
        container,
        yuyanId: "yyy",
        activeRule: "/console",
      },
    ]);
    expect(qiankun.start).toHaveBeenCalledWith({
      sandbox: true,
      prefetch: true,
    });
  });

  it("merges CoreGraph route mappings with resolver-declared routes", async () => {
    qiankun.registerMicroApps.mockClear();
    qiankun.start.mockClear();
    const container = createElement();

    const options = await startQiankunMaster(
      async () => ({
        apps: [
          {
            name: "catalog",
            entry: "https://example.com/catalog/",
            container,
          },
        ],
        routes: [{ path: "/resolver-catalog", microApp: "catalog" }],
      }),
      [{ path: "/catalog", microApp: "catalog" }],
    );

    expect(qiankun.registerMicroApps).toHaveBeenCalledWith([
      {
        name: "catalog",
        entry: "https://example.com/catalog/",
        container,
        activeRule: ["/catalog", "/resolver-catalog"],
      },
    ]);
    expect(options.routes).toEqual([
      { path: "/catalog", microApp: "catalog" },
      { path: "/resolver-catalog", microApp: "catalog" },
    ]);

    await expect(
      startQiankunMaster(
        async () => ({
          apps: [],
          routes: [{ path: "/catalog", microApp: "other" }],
        }),
        [{ path: "/catalog", microApp: "catalog" }],
      ),
    ).rejects.toThrow(
      'Route "/catalog" maps to both micro-app "catalog" and "other"',
    );
  });

  it("resolves master app selector containers before registering apps", async () => {
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    );
    const container = createElement();

    qiankun.registerMicroApps.mockClear();
    qiankun.start.mockClear();
    Object.defineProperty(globalThis, "document", {
      value: {
        querySelector: vi.fn((selector: string) =>
          selector === "#slave-container" ? container : null,
        ),
      },
      configurable: true,
    });

    try {
      await startQiankunMaster(async () => ({
        apps: [
          {
            name: "catalog",
            entry: "https://example.com/catalog/",
            container: "#slave-container",
            activeRule: "/catalog",
          },
        ],
      }));

      expect(qiankun.registerMicroApps).toHaveBeenCalledWith([
        {
          name: "catalog",
          entry: "https://example.com/catalog/",
          container,
          activeRule: "/catalog",
        },
      ]);
    } finally {
      if (originalDocument) {
        Object.defineProperty(globalThis, "document", originalDocument);
      } else {
        delete (globalThis as { document?: unknown }).document;
      }
    }
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
