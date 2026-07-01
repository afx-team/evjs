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

  it("loads slave entry during mount and lets runtime hooks extend lifecycle", async () => {
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

    expect(calls).toEqual([
      "bootstrap",
      "mount",
      "entry",
      "unmount",
      "entry-unmount",
      "clear",
    ]);
    expect(containerHtml).toBe("");
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
        loadEntry: async () => {
          queryResult = globalThis.document.querySelector("#app");
          idResult = globalThis.document.getElementById("app");
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
