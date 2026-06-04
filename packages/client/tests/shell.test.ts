import type { BuildOutput } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AppModule,
  createHistoryDriver,
  createPageDriver,
  createShell,
  type HistoryDriverOptions,
  loadSharedDependency,
  registerShellModule,
} from "../src/shell.js";

const manifest: BuildOutput = {
  version: 1,
  buildId: "test",
  distDir: "dist",
  publicPath: "/",
  runtime: {},
  assets: {},
  apps: {},
  pages: {
    home: {
      assets: { js: ["home.js"], css: [] },
      render: "csr",
      rendering: {
        mode: "csr",
        component: "client",
        html: "client",
        streaming: false,
        hydrate: "load",
      },
      module: {
        type: "lifecycle",
        href: "/home.js",
      },
    },
  },
  routes: [
    {
      id: "home",
      path: "/home",
      pageId: "home",
    },
    {
      id: "app.order",
      path: "/orders/$orderId",
      appId: "default",
    },
  ],
  remotes: {
    crm: {
      manifest: "https://assets.example.com/crm/manifest.json",
      activeWhen: ["/crm/*"],
    },
  },
};

afterEach(() => {
  delete globalThis.__EVJS_SHELL_MODULES__;
  delete globalThis.__EVJS_SHARED_SCOPE__;
  vi.unstubAllGlobals();
});

describe("createShell", () => {
  it("activates and disposes manifest modules", async () => {
    const events: string[] = [];
    const mountPoint = {} as Element;
    const mod: AppModule = {
      mount(_mountPoint, ctx) {
        events.push(`mount:${ctx.kind}:${ctx.id}`);
      },
      unmount(_mountPoint, ctx) {
        events.push(`unmount:${ctx.kind}:${ctx.id}`);
      },
    };
    const shell = createShell({
      manifest,
      resolveMountPoint: () => mountPoint,
      async loadModule(href) {
        events.push(`load:${href}`);
        return mod;
      },
    });

    await shell.activate({ pageId: "home", hydrate: false });
    await shell.dispose();

    expect(events).toEqual([
      "load:/home.js",
      "mount:page:home",
      "unmount:page:home",
    ]);
  });

  it("loads registered modules with the default loader", async () => {
    const events: string[] = [];
    registerShellModule("/home.js", {
      mount(_mountPoint, ctx) {
        events.push(`mount:${ctx.kind}:${ctx.id}`);
      },
    });

    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
    });

    await shell.activate({ pageId: "home", hydrate: false });

    expect(events).toEqual(["mount:page:home"]);
  });

  it("loads script assets before reading registered modules", async () => {
    const events: string[] = [];
    const createdScripts: HTMLScriptElement[] = [];
    vi.stubGlobal("location", { href: "https://example.com/start" });
    const document = {
      head: {
        appendChild(script: HTMLScriptElement) {
          createdScripts.push(script);
          registerShellModule(new URL(script.src, location.href).toString(), {
            mount() {
              events.push("mount");
            },
          });
          script.onload?.call(script, new Event("load"));
          return script;
        },
      },
      createElement(tag: string) {
        expect(tag).toBe("script");
        return {} as HTMLScriptElement;
      },
    } as unknown as Document;
    vi.stubGlobal("document", document);

    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
    });

    await shell.activate({ pageId: "home", hydrate: false });

    expect(createdScripts.map((script) => script.src)).toEqual(["/home.js"]);
    expect(createdScripts[0]?.async).toBe(true);
    expect(events).toEqual(["mount"]);
  });

  it("preloads without mounting", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule(href) {
        events.push(`load:${href}`);
        return {
          mount() {
            events.push("mount");
          },
        };
      },
    });

    await shell.preload({ pageId: "home" });
    await shell.activate({ pageId: "home", hydrate: false });

    expect(events).toEqual(["load:/home.js", "mount"]);
  });

  it("activates remotes by activeWhen URL", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest(remote, ctx) {
        events.push(`remote-manifest:${ctx.id}:${remote.manifest}`);
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm/",
          entries: {
            default: {
              module: {
                type: "lifecycle",
                href: "remote-entry.js",
              },
              activeWhen: ["/crm/*"],
            },
          },
        };
      },
      async loadModule(href, ctx) {
        events.push(`load:${href}`);
        return {
          mount() {
            events.push(`mount:${ctx.kind}:${ctx.id}:${ctx.remote?.entryId}`);
          },
        };
      },
    });

    await shell.activate({ url: "/crm/customers", hydrate: false });

    expect(events).toEqual([
      "remote-manifest:crm:https://assets.example.com/crm/manifest.json",
      "load:https://assets.example.com/crm/remote-entry.js",
      "mount:remote:crm:default",
    ]);
  });

  it("caches remote manifests and modules", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest() {
        events.push("remote-manifest");
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm",
          entries: {
            list: {
              module: {
                type: "lifecycle",
                href: "./list.js",
              },
            },
          },
        };
      },
      async loadModule(href) {
        events.push(`load:${href}`);
        return {
          mount() {
            events.push("mount");
          },
        };
      },
    });

    await shell.preload({ remoteId: "crm", remoteEntryId: "list" });
    await shell.activate({
      remoteId: "crm",
      remoteEntryId: "list",
      hydrate: false,
    });

    expect(events).toEqual([
      "remote-manifest",
      "load:https://assets.example.com/crm/list.js",
      "mount",
    ]);
  });

  it("warns once when a remote manifest declares shared dependencies", async () => {
    const warnings: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest() {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm",
          shared: {
            react: {
              requiredVersion: "^19.0.0",
              singleton: true,
            },
          },
          entries: {
            list: {
              module: {
                type: "lifecycle",
                href: "./list.js",
              },
            },
          },
        };
      },
      async loadModule() {
        return {
          mount() {},
        };
      },
      onWarning(warning) {
        warnings.push(
          `${warning.code}:${warning.remoteId}:${warning.dependencies.join(",")}`,
        );
      },
    });

    await shell.preload({ remoteId: "crm", remoteEntryId: "list" });
    await shell.activate({
      remoteId: "crm",
      remoteEntryId: "list",
      hydrate: false,
    });

    expect(warnings).toEqual(["remote-shared-dependencies:crm:react"]);
  });

  it("negotiates remote shared dependencies from the host share scope", async () => {
    const events: string[] = [];
    const reactValue = { createElement: true };
    const shell = createShell({
      manifest,
      shared: {
        react: {
          version: "19.2.5",
          singleton: true,
          value: reactValue,
        },
      },
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest() {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm",
          shared: {
            react: {
              requiredVersion: "^19.0.0",
              singleton: true,
            },
          },
          entries: {
            list: {
              module: {
                type: "lifecycle",
                href: "./list.js",
              },
            },
          },
        };
      },
      async loadModule(_href, ctx) {
        events.push(
          `shared:${Object.keys(ctx.remote?.shared.provided ?? {}).join(",")}`,
        );
        return {
          mount() {},
        };
      },
      onWarning(warning) {
        events.push(`warning:${warning.code}`);
      },
    });

    await shell.activate({
      remoteId: "crm",
      remoteEntryId: "list",
      hydrate: false,
    });

    expect(events).toEqual(["shared:react"]);
    expect(await loadSharedDependency("react")).toBe(reactValue);
  });

  it("initializes remote modules once with the negotiated host share scope", async () => {
    const events: string[] = [];
    const reactValue = { createElement: true };
    const shell = createShell({
      manifest,
      shared: {
        react: {
          version: "19.2.5",
          singleton: true,
          value: reactValue,
        },
      },
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest() {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm",
          shared: {
            react: {
              requiredVersion: ">=19 <20",
              singleton: true,
            },
          },
          entries: {
            list: {
              module: {
                type: "lifecycle",
                href: "./list.js",
              },
            },
          },
        };
      },
      async loadModule() {
        return {
          init(scope, ctx) {
            events.push(
              `init:${ctx.remote?.entryId}:${scope.react?.value === reactValue}`,
            );
          },
          mount() {
            events.push("mount");
          },
        };
      },
    });

    await shell.preload({ remoteId: "crm", remoteEntryId: "list" });
    await shell.activate({
      remoteId: "crm",
      remoteEntryId: "list",
      hydrate: false,
    });

    expect(events).toEqual(["init:list:true", "mount"]);
  });

  it("supports shareKey aliases and OR version ranges for remote shared dependencies", async () => {
    const events: string[] = [];
    createShell({
      manifest,
      shared: {
        "react-dom": {
          version: "19.2.5",
          singleton: true,
          value: { hydrateRoot: true },
        },
      },
    });

    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest() {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm",
          shared: {
            react: {
              shareKey: "react-dom",
              requiredVersion: "^18.0.0 || ^19.0.0",
              singleton: true,
            },
          },
          entries: {
            list: {
              module: {
                type: "lifecycle",
                href: "./list.js",
              },
            },
          },
        };
      },
      async loadModule(_href, ctx) {
        events.push(
          `shared:${Boolean(ctx.remote?.shared.provided.react)}:${ctx.remote?.shared.incompatible.length}`,
        );
        return {
          mount() {},
        };
      },
    });

    await shell.activate({
      remoteId: "crm",
      remoteEntryId: "list",
      hydrate: false,
    });

    expect(events).toEqual(["shared:true:0"]);
  });

  it("can fail remote activation on singleton shared dependency conflicts", async () => {
    const shell = createShell({
      manifest,
      sharedPolicy: "error",
      shared: {
        react: {
          version: "19.2.5",
          singleton: false,
          value: {},
        },
      },
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest() {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm",
          shared: {
            react: {
              requiredVersion: "^19.0.0",
              singleton: true,
            },
          },
          entries: {
            list: {
              module: {
                type: "lifecycle",
                href: "./list.js",
              },
            },
          },
        };
      },
    });

    await expect(
      shell.activate({
        remoteId: "crm",
        remoteEntryId: "list",
        hydrate: false,
      }),
    ).rejects.toThrow("requires a singleton shared module");
  });

  it("can fail remote activation when shared dependencies are not satisfied", async () => {
    const shell = createShell({
      manifest,
      sharedPolicy: "error",
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest() {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm",
          shared: {
            react: {
              requiredVersion: "^19.0.0",
              singleton: true,
            },
          },
          entries: {
            list: {
              module: {
                type: "lifecycle",
                href: "./list.js",
              },
            },
          },
        };
      },
    });

    await expect(
      shell.activate({
        remoteId: "crm",
        remoteEntryId: "list",
        hydrate: false,
      }),
    ).rejects.toThrow('Remote "crm" declares shared dependencies');
  });

  it("starts from drivers and unsubscribes on dispose", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      drivers: [
        {
          current() {
            events.push("driver:current");
            return { pageId: "home", hydrate: false };
          },
          subscribe() {
            events.push("driver:subscribe");
            return () => events.push("driver:unsubscribe");
          },
        },
      ],
      resolveMountPoint: () => ({}) as Element,
      async loadModule(href, ctx) {
        events.push(`load:${href}`);
        return {
          mount() {
            events.push(`mount:${ctx.kind}:${ctx.id}`);
          },
          unmount() {
            events.push(`unmount:${ctx.kind}:${ctx.id}`);
          },
        };
      },
    });

    await shell.start();
    await shell.dispose();

    expect(events).toEqual([
      "driver:subscribe",
      "driver:current",
      "load:/home.js",
      "mount:page:home",
      "driver:unsubscribe",
      "unmount:page:home",
    ]);
  });

  it("reports lifecycle errors", async () => {
    const error = new Error("mount failed");
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule() {
        return {
          mount() {
            throw error;
          },
        };
      },
      onError(caught, ctx) {
        events.push(
          `${caught === error ? "same-error" : "other-error"}:${ctx.phase}:${ctx.app.kind}:${ctx.app.id}`,
        );
      },
    });

    await expect(
      shell.activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow("mount failed");
    expect(events).toEqual(["same-error:mount:page:home"]);
  });

  it("reports missing mount points as resolve errors", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      async loadModule() {
        return {
          mount() {},
        };
      },
      onError(error, ctx) {
        events.push(
          `${error instanceof Error ? error.message : "unknown"}:${ctx.phase}:${ctx.app.kind}:${ctx.app.id}`,
        );
      },
    });

    await expect(
      shell.activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow('Unable to resolve mount point for page "home"');
    expect(events).toEqual([
      '[evjs] Unable to resolve mount point for page "home".:resolve:page:home',
    ]);
  });

  it("does not cache failed module loads", async () => {
    const events: string[] = [];
    const loadError = new Error("load failed");
    let loadCount = 0;
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule() {
        loadCount++;
        events.push(`load:${loadCount}`);
        if (loadCount === 1) throw loadError;
        return {
          mount() {
            events.push("mount");
          },
        };
      },
      onError(error, ctx) {
        events.push(
          `${error === loadError ? "same-error" : "other-error"}:${ctx.phase}:${ctx.app.kind}:${ctx.app.id}`,
        );
      },
    });

    await expect(
      shell.activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow("load failed");
    await shell.activate({ pageId: "home", hydrate: false });

    expect(events).toEqual([
      "load:1",
      "same-error:load:page:home",
      "load:2",
      "mount",
    ]);
  });

  it("does not cache failed module initialization", async () => {
    const events: string[] = [];
    const initError = new Error("init failed");
    let initCount = 0;
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule() {
        events.push("load");
        return {
          init() {
            initCount++;
            events.push(`init:${initCount}`);
            if (initCount === 1) throw initError;
          },
          mount() {
            events.push("mount");
          },
        };
      },
      onError(error, ctx) {
        events.push(
          `${error === initError ? "same-error" : "other-error"}:${ctx.phase}:${ctx.app.kind}:${ctx.app.id}`,
        );
      },
    });

    await expect(
      shell.activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow("init failed");
    await shell.activate({ pageId: "home", hydrate: false });

    expect(events).toEqual([
      "load",
      "init:1",
      "same-error:init:page:home",
      "init:2",
      "mount",
    ]);
  });

  it("does not cache failed remote manifest loads", async () => {
    const events: string[] = [];
    let loadCount = 0;
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest() {
        loadCount++;
        events.push(`remote-manifest:${loadCount}`);
        if (loadCount === 1) throw new Error("remote manifest failed");
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm",
          entries: {
            list: {
              module: {
                type: "lifecycle",
                href: "./list.js",
              },
            },
          },
        };
      },
      async loadModule() {
        events.push("load");
        return {
          mount() {
            events.push("mount");
          },
        };
      },
    });

    await expect(
      shell.activate({
        remoteId: "crm",
        remoteEntryId: "list",
        hydrate: false,
      }),
    ).rejects.toThrow("remote manifest failed");
    await shell.activate({
      remoteId: "crm",
      remoteEntryId: "list",
      hydrate: false,
    });

    expect(events).toEqual([
      "remote-manifest:1",
      "remote-manifest:2",
      "load",
      "mount",
    ]);
  });
});

describe("createPageDriver", () => {
  it("creates activation requests from framework HTML attributes", () => {
    const document = {
      documentElement: {
        getAttribute(name: string) {
          return (
            {
              "data-evjs-kind": "page",
              "data-evjs-id": "home",
              "data-evjs-page": "home",
              "data-evjs-build": "test",
            }[name] ?? null
          );
        },
      },
      location: {
        href: "https://example.com/home",
      },
    } as Document;

    expect(createPageDriver({ document }).current()).toEqual({
      appId: undefined,
      pageId: "home",
      buildId: "test",
      url: "https://example.com/home",
    });
  });

  it("falls back to legacy page/app attributes", () => {
    const document = {
      documentElement: {
        getAttribute(name: string) {
          return (
            {
              "data-evjs-page": "home",
              "data-evjs-build": "test",
            }[name] ?? null
          );
        },
      },
      location: {
        href: "https://example.com/home",
      },
    } as Document;

    expect(createPageDriver({ document }).current()).toEqual({
      appId: undefined,
      pageId: "home",
      buildId: "test",
      url: "https://example.com/home",
    });
  });
});

describe("createHistoryDriver", () => {
  it("creates activation requests from matched manifest routes", () => {
    const driver = createHistoryDriver({
      manifest,
      window: createMockWindow("https://example.com/orders/123"),
    });

    expect(driver.current()).toEqual({
      appId: "default",
      pageId: undefined,
      url: "https://example.com/orders/123",
    });
  });

  it("subscribes to browser history navigation", () => {
    const calls: unknown[] = [];
    const win = createMockWindow("https://example.com/home");
    const driver = createHistoryDriver({ manifest, window: win });

    const unsubscribe = driver.subscribe((request) => calls.push(request));
    win.dispatchPopState();
    unsubscribe();
    win.dispatchPopState();

    expect(calls).toEqual([
      {
        appId: undefined,
        pageId: "home",
        url: "https://example.com/home",
      },
    ]);
  });
});

function createMockWindow(
  href: string,
): HistoryDriverOptions["window"] & { dispatchPopState(): void } {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  return {
    location: { href } as Location,
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      if (type === "popstate") listeners.add(listener);
    },
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      if (type === "popstate") listeners.delete(listener);
    },
    dispatchPopState() {
      const event = new Event("popstate");
      for (const listener of listeners) {
        if (typeof listener === "function") {
          listener(event);
        } else {
          listener.handleEvent(event);
        }
      }
    },
  };
}
