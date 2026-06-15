import type { BuildOutput, RemoteManifest } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AppModule,
  createHistoryDriver,
  createPageDriver,
  createShell,
  type HistoryDriverOptions,
  loadSharedDependency,
  registerSharedDependency,
  registerShellModule,
} from "../src/internal";

const manifest: BuildOutput = {
  version: 1,
  buildId: "test",
  distDir: "dist",
  publicPath: "/",
  runtime: {},
  assets: {},
  apps: {
    default: {
      assets: { js: ["default.js"], css: [] },
      module: {
        type: "lifecycle",
        href: "/default.js",
      },
    },
  },
  pages: {
    home: {
      assets: { js: ["home.js"], css: [] },
      render: "csr",
      rendering: {
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
    about: {
      assets: { js: ["about.js"], css: [] },
      render: "csr",
      rendering: {
        component: "client",
        html: "client",
        streaming: false,
        hydrate: "load",
      },
      module: {
        type: "lifecycle",
        href: "/about.js",
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
      id: "about",
      path: "/about",
      pageId: "about",
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
  it("rejects invalid shell option shapes", () => {
    expect(() => createShell(null as never)).toThrow(
      "[evjs] createShell() options must be an object.",
    );
    expect(() =>
      createShell({
        manifest: null,
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow("[evjs] createShell() manifest must be an object.");
    expect(() =>
      createShell({
        manifest: { ...manifest, version: 2 },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow("[evjs] createShell() manifest.version must be 1.");
    expect(() =>
      createShell({
        manifest: { ...manifest, buildId: "" },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      "[evjs] createShell() manifest.buildId must be a non-empty string.",
    );
    expect(() =>
      createShell({
        manifest: { ...manifest, buildId: "build.1" },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      "[evjs] createShell() manifest.buildId must contain only letters, numbers, underscores, or hyphens.",
    );
    expect(() =>
      createShell({
        manifest: { ...manifest, runtime: null },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow("[evjs] createShell() manifest.runtime must be an object.");
    expect(() =>
      createShell({
        manifest: { ...manifest, assets: [] },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow("[evjs] createShell() manifest.assets must be an object.");
    expect(() =>
      createShell({
        manifest: { ...manifest, assets: { main: { js: "main.js", css: [] } } },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow("[evjs] createShell() manifest.assets.main.js must be an array.");
    expect(() =>
      createShell({
        manifest: {
          ...manifest,
          assets: { "main.entry": { js: [], css: [] } },
        },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      '[evjs] createShell() manifest.assets key "main.entry" must contain only letters, numbers, underscores, or hyphens.',
    );
    expect(() =>
      createShell({
        manifest: { ...manifest, pages: [] },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow("[evjs] createShell() manifest.pages must be an object.");
    expect(() =>
      createShell({
        manifest: {
          ...manifest,
          pages: {
            ...manifest.pages,
            home: {
              ...manifest.pages.home,
              assets: { js: [], css: [""] },
            },
          },
        },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      "[evjs] createShell() manifest.pages.home.assets.css must contain only non-empty strings.",
    );
    expect(() =>
      createShell({
        manifest: { ...manifest, apps: [] },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow("[evjs] createShell() manifest.apps must be an object.");
    expect(() =>
      createShell({
        manifest: {
          ...manifest,
          apps: {
            "admin.app": {
              assets: { js: [], css: [] },
              module: { type: "lifecycle", href: "/admin.js" },
            },
          },
        },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      '[evjs] createShell() manifest.apps key "admin.app" must contain only letters, numbers, underscores, or hyphens.',
    );
    expect(() =>
      createShell({
        manifest: { ...manifest, routes: {} },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow("[evjs] createShell() manifest.routes must be an array.");
    expect(() =>
      createShell({
        manifest: {
          ...manifest,
          routes: [{ id: "home", path: "home", pageId: "home" }],
        },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      '[evjs] createShell() manifest.routes[0].path must start with "/".',
    );
    expect(() =>
      createShell({
        manifest: {
          ...manifest,
          routes: [{ id: " home", path: "/home", pageId: "home" }],
        },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      "[evjs] createShell() manifest.routes[0].id must not contain leading or trailing whitespace.",
    );
    expect(() =>
      createShell({
        manifest: {
          ...manifest,
          routes: [{ id: "orders", path: "/orders", appId: "missing" }],
        },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      '[evjs] createShell() manifest.routes[0].appId "missing" does not match any manifest.apps entry.',
    );
    expect(() =>
      createShell({
        manifest: {
          ...manifest,
          routes: [{ id: "orders", path: "/orders", appId: "default " }],
        },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      "[evjs] createShell() manifest.routes[0].appId must not contain leading or trailing whitespace.",
    );
    expect(() =>
      createShell({
        manifest: {
          ...manifest,
          routes: [
            { id: "userById", path: "/users/$id", pageId: "home" },
            {
              id: "userByUserId",
              path: "/users/$userId",
              pageId: "about",
            },
          ],
        },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      '[evjs] createShell() manifest.routes[1].path has the same route shape as createShell() manifest.routes[0].path "/users/$id". Use one page route per URL shape.',
    );
    expect(() =>
      createShell({
        manifest: { ...manifest, remotes: [] },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow("[evjs] createShell() manifest.remotes must be an object.");
    expect(() =>
      createShell({
        manifest: { ...manifest, runtime: { transport: [] } },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      "[evjs] createShell() manifest.runtime.transport must be an object.",
    );
    expect(() =>
      createShell({
        manifest: {
          ...manifest,
          runtime: { transport: { baseUrl: "http://[::1" } },
        },
        resolveMountPoint: () => ({}) as Element,
      } as never),
    ).toThrow(
      "[evjs] createShell() manifest.runtime.transport.baseUrl must be a valid URL string.",
    );
  });

  it("rejects invalid host remote declarations", () => {
    const createWithRemotes = (remotes: unknown) =>
      createShell({
        manifest: { ...manifest, remotes } as never,
        resolveMountPoint: () => ({}) as Element,
      });
    const remoteManifest = "https://assets.example.com/crm/manifest.json";

    expect(() =>
      createWithRemotes({
        "crm/list": { manifest: remoteManifest },
      }),
    ).toThrow(
      '[evjs] createShell() manifest.remotes key "crm/list" must contain only letters, numbers, underscores, or hyphens.',
    );
    expect(() =>
      createWithRemotes({
        crm: null,
      }),
    ).toThrow("[evjs] createShell() manifest.remotes.crm must be an object.");
    expect(() =>
      createWithRemotes({
        crm: { manifest: "" },
      }),
    ).toThrow(
      "[evjs] createShell() manifest.remotes.crm.manifest must be a non-empty string.",
    );
    expect(() =>
      createWithRemotes({
        crm: { manifest: ` ${remoteManifest} ` },
      }),
    ).toThrow(
      "[evjs] createShell() manifest.remotes.crm.manifest must not contain leading or trailing whitespace.",
    );
    expect(() =>
      createWithRemotes({
        crm: { manifest: remoteManifest, activeWhen: "/crm/*" },
      }),
    ).toThrow(
      "[evjs] createShell() manifest.remotes.crm.activeWhen must be an array of path patterns.",
    );
    expect(() =>
      createWithRemotes({
        crm: { manifest: remoteManifest, activeWhen: [] },
      }),
    ).toThrow(
      "[evjs] createShell() manifest.remotes.crm.activeWhen must contain at least one path.",
    );
    expect(() =>
      createWithRemotes({
        crm: { manifest: remoteManifest, activeWhen: ["/crm page/*"] },
      }),
    ).toThrow(
      '[evjs] createShell() manifest.remotes.crm.activeWhen pattern "/crm page/*" must not contain whitespace.',
    );
    expect(() =>
      createWithRemotes({
        crm: { manifest: remoteManifest, activeWhen: ["crm/*"] },
      }),
    ).toThrow(
      '[evjs] createShell() manifest.remotes.crm.activeWhen pattern "crm/*" must start with "/".',
    );
    expect(() =>
      createWithRemotes({
        crm: { manifest: remoteManifest, activeWhen: ["/crm/*?preview=1"] },
      }),
    ).toThrow(
      '[evjs] createShell() manifest.remotes.crm.activeWhen pattern "/crm/*?preview=1" must not include a query string or hash.',
    );
    expect(() =>
      createWithRemotes({
        crm: { manifest: remoteManifest, activeWhen: ["/crm/*", "/crm/*"] },
      }),
    ).toThrow(
      '[evjs] createShell() manifest.remotes.crm.activeWhen must not contain duplicate pattern "/crm/*".',
    );
    expect(() =>
      createWithRemotes({
        crm: { manifest: remoteManifest, activeWhen: ["/crm/*"] },
        analytics: {
          manifest: "https://assets.example.com/analytics/manifest.json",
          activeWhen: ["/crm/*"],
        },
      }),
    ).toThrow(
      '[evjs] createShell() manifest.remotes.analytics.activeWhen duplicates manifest.remotes.crm.activeWhen pattern "/crm/*". Remote activeWhen patterns must be unique.',
    );
  });

  it("rejects invalid shell driver and callback shapes", () => {
    expect(() => createShell({ manifest, drivers: {} as never })).toThrow(
      "[evjs] createShell() drivers must be an array.",
    );
    expect(() => createShell({ manifest, drivers: [null as never] })).toThrow(
      "[evjs] createShell() drivers[0] must be a shell driver object.",
    );
    expect(() =>
      createShell({ manifest, drivers: [{ current: "now" } as never] }),
    ).toThrow("[evjs] createShell() drivers[0].current must be a function.");
    expect(() =>
      createShell({
        manifest,
        drivers: [{ current: () => ({}), subscribe: "listen" } as never],
      }),
    ).toThrow(
      "[evjs] createShell() drivers[0].subscribe must be a function when provided.",
    );
    expect(() =>
      createShell({ manifest, loadModule: "load" as never }),
    ).toThrow(
      "[evjs] createShell() loadModule must be a function when provided.",
    );
    expect(() =>
      createShell({
        manifest,
        loadRemoteManifest: "load" as never,
      }),
    ).toThrow(
      "[evjs] createShell() loadRemoteManifest must be a function when provided.",
    );
    expect(() =>
      createShell({ manifest, resolveMountPoint: "resolve" as never }),
    ).toThrow(
      "[evjs] createShell() resolveMountPoint must be a function when provided.",
    );
    expect(() => createShell({ manifest, shared: [] as never })).toThrow(
      "[evjs] createShell() shared must be an object.",
    );
    expect(() =>
      createShell({ manifest, shared: { "": {} } as never }),
    ).toThrow("[evjs] createShell() shared must not contain empty keys.");
    expect(() =>
      createShell({ manifest, shared: { " react": {} } as never }),
    ).toThrow(
      '[evjs] createShell() shared key " react" must not contain leading or trailing whitespace.',
    );
    expect(() =>
      createShell({ manifest, shared: { react: "react" } as never }),
    ).toThrow(
      "[evjs] createShell() shared.react must be a shared dependency object.",
    );
    expect(() =>
      createShell({
        manifest,
        shared: { react: { version: "" } },
      }),
    ).toThrow(
      "[evjs] createShell() shared.react.version must be a non-empty string when provided.",
    );
    expect(() =>
      createShell({
        manifest,
        shared: { react: { singleton: "yes" } } as never,
      }),
    ).toThrow(
      "[evjs] createShell() shared.react.singleton must be a boolean when provided.",
    );
    expect(() =>
      createShell({
        manifest,
        shared: { react: { get: "load" } } as never,
      }),
    ).toThrow(
      "[evjs] createShell() shared.react.get must be a function when provided.",
    );
    expect(() =>
      createShell({ manifest, sharedPolicy: "strict" as never }),
    ).toThrow('[evjs] createShell() sharedPolicy must be "warn" or "error".');
    expect(() => createShell({ manifest, onError: "handle" as never })).toThrow(
      "[evjs] createShell() onError must be a function when provided.",
    );
    expect(() => createShell({ manifest, onWarning: "warn" as never })).toThrow(
      "[evjs] createShell() onWarning must be a function when provided.",
    );
    expect(() =>
      createShell({
        manifest,
        onRemoteSharedNegotiated: "negotiate" as never,
      }),
    ).toThrow(
      "[evjs] createShell() onRemoteSharedNegotiated must be a function when provided.",
    );
  });

  it("rejects invalid global shared dependency registrations", async () => {
    expect(() => registerSharedDependency("" as never, { value: {} })).toThrow(
      "[evjs] registerSharedDependency() name must be a non-empty string.",
    );
    expect(() =>
      registerSharedDependency(" react" as never, { value: {} }),
    ).toThrow(
      "[evjs] registerSharedDependency() name must not contain leading or trailing whitespace.",
    );
    expect(() => registerSharedDependency("react", "react" as never)).toThrow(
      "[evjs] registerSharedDependency() entry must be a shared dependency object.",
    );
    expect(() => registerSharedDependency("react", { version: "" })).toThrow(
      "[evjs] registerSharedDependency() entry.version must be a non-empty string when provided.",
    );
    expect(() =>
      registerSharedDependency("react", { singleton: "yes" } as never),
    ).toThrow(
      "[evjs] registerSharedDependency() entry.singleton must be a boolean when provided.",
    );
    expect(() =>
      registerSharedDependency("react", { get: "load" } as never),
    ).toThrow(
      "[evjs] registerSharedDependency() entry.get must be a function when provided.",
    );

    await expect(loadSharedDependency("" as never)).rejects.toThrow(
      "[evjs] loadSharedDependency() name must be a non-empty string.",
    );
    await expect(loadSharedDependency(" react" as never)).rejects.toThrow(
      "[evjs] loadSharedDependency() name must not contain leading or trailing whitespace.",
    );
  });

  it("rejects malformed global shared scope before shell negotiation", async () => {
    globalThis.__EVJS_SHARED_SCOPE__ = {
      react: {
        get: "load",
      },
    } as never;

    expect(() =>
      createShell({
        manifest,
        resolveMountPoint: () => ({}) as Element,
      }),
    ).toThrow(
      "[evjs] global shared scope.react.get must be a function when provided.",
    );
    await expect(loadSharedDependency("react")).rejects.toThrow(
      "[evjs] global shared scope.react.get must be a function when provided.",
    );
  });

  it("rejects invalid shell activation request shapes", async () => {
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
    });

    await expect(shell.activate(null as never)).rejects.toThrow(
      "[evjs] Shell activate() request must be an object.",
    );
    await expect(shell.activate({ pageId: "" } as never)).rejects.toThrow(
      "[evjs] Shell activate() request.pageId must be a non-empty string when provided.",
    );
    await expect(shell.activate({ appId: 42 } as never)).rejects.toThrow(
      "[evjs] Shell activate() request.appId must be a non-empty string when provided.",
    );
    await expect(shell.activate({ remoteId: [] } as never)).rejects.toThrow(
      "[evjs] Shell activate() request.remoteId must be a non-empty string when provided.",
    );
    await expect(
      shell.activate({ remoteEntryId: " " } as never),
    ).rejects.toThrow(
      "[evjs] Shell activate() request.remoteEntryId must be a non-empty string when provided.",
    );
    await expect(shell.activate({ pageId: " home" } as never)).rejects.toThrow(
      "[evjs] Shell activate() request.pageId must not contain leading or trailing whitespace.",
    );
    await expect(
      shell.activate({ appId: "default", pageId: "home" }),
    ).rejects.toThrow(
      "[evjs] Shell activate() request must specify at most one of appId, pageId, or remoteId.",
    );
    await expect(
      shell.activate({ remoteEntryId: "list" } as never),
    ).rejects.toThrow(
      "[evjs] Shell activate() request.remoteEntryId requires remoteId when provided.",
    );
    await expect(shell.activate({ buildId: null } as never)).rejects.toThrow(
      "[evjs] Shell activate() request.buildId must be a non-empty string when provided.",
    );
    await expect(
      shell.activate({ pageId: "home", buildId: "stale" }),
    ).rejects.toThrow(
      '[evjs] Shell activate() request.buildId "stale" does not match manifest.buildId "test".',
    );
    await expect(
      shell.activate({ pageId: "home", buildId: "build.1" }),
    ).rejects.toThrow(
      "[evjs] Shell activate() request.buildId must contain only letters, numbers, underscores, or hyphens.",
    );
    await expect(
      shell.activate({ url: { href: "/home" } } as never),
    ).rejects.toThrow(
      "[evjs] Shell activate() request.url must be a string or URL when provided.",
    );
    await expect(shell.activate({ url: "" } as never)).rejects.toThrow(
      "[evjs] Shell activate() request.url must be a non-empty string or URL when provided.",
    );
    await expect(shell.activate({ url: " /home" } as never)).rejects.toThrow(
      "[evjs] Shell activate() request.url must not contain leading or trailing whitespace.",
    );
    await expect(shell.activate({ url: "home" } as never)).rejects.toThrow(
      '[evjs] Shell activate() request.url must be an http(s) URL or pathname starting with "/".',
    );
    await expect(
      shell.activate({ url: new URL("ftp://example.com/home") } as never),
    ).rejects.toThrow(
      '[evjs] Shell activate() request.url must be an http(s) URL or pathname starting with "/".',
    );
    await expect(
      shell.activate({ mountPoint: "root" } as never),
    ).rejects.toThrow(
      "[evjs] Shell activate() request.mountPoint must be an Element when provided.",
    );
    await expect(shell.activate({ hydrate: "yes" } as never)).rejects.toThrow(
      "[evjs] Shell activate() request.hydrate must be a boolean when provided.",
    );
  });

  it("rejects malformed page and app runtime module metadata before loading", () => {
    const loadModule = vi.fn(async () => ({
      mount() {},
    }));
    const createMalformedShell = (nextManifest: BuildOutput) =>
      createShell({
        manifest: nextManifest,
        resolveMountPoint: () => ({}) as Element,
        loadModule,
      });

    expect(() =>
      createMalformedShell({
        ...manifest,
        pages: {
          ...manifest.pages,
          home: {
            ...manifest.pages.home,
            module: null as never,
          },
        },
      }),
    ).toThrow(
      "[evjs] createShell() manifest.pages.home.module must be an object.",
    );

    expect(() =>
      createMalformedShell({
        ...manifest,
        pages: {
          ...manifest.pages,
          home: {
            ...manifest.pages.home,
            module: {
              type: "lifecycle",
              href: 42,
            } as never,
          },
        },
      }),
    ).toThrow(
      "[evjs] createShell() manifest.pages.home.module.href must be a non-empty string.",
    );

    expect(() =>
      createMalformedShell({
        ...manifest,
        apps: {
          default: {
            assets: { js: [], css: [] },
            module: {
              type: "lifecycle",
              href: " /app.js",
            },
          },
        },
      }),
    ).toThrow(
      "[evjs] createShell() manifest.apps.default.module.href must not contain leading or trailing whitespace.",
    );

    expect(loadModule).not.toHaveBeenCalled();
  });

  it("rejects invalid shell preload request shapes", async () => {
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
    });

    await expect(shell.preload(null as never)).rejects.toThrow(
      "[evjs] Shell preload() request must be an object.",
    );
    await expect(
      shell.preload({ url: { href: "/home" } } as never),
    ).rejects.toThrow(
      "[evjs] Shell preload() request.url must be a string or URL when provided.",
    );
    await expect(shell.preload({ url: "" } as never)).rejects.toThrow(
      "[evjs] Shell preload() request.url must be a non-empty string or URL when provided.",
    );
    await expect(shell.preload({ url: "home" } as never)).rejects.toThrow(
      '[evjs] Shell preload() request.url must be an http(s) URL or pathname starting with "/".',
    );
    await expect(shell.preload({ appId: "default " })).rejects.toThrow(
      "[evjs] Shell preload() request.appId must not contain leading or trailing whitespace.",
    );
    await expect(
      shell.preload({ pageId: "home", remoteId: "crm" }),
    ).rejects.toThrow(
      "[evjs] Shell preload() request must specify at most one of appId, pageId, or remoteId.",
    );
    await expect(
      shell.preload({ remoteEntryId: "list" } as never),
    ).rejects.toThrow(
      "[evjs] Shell preload() request.remoteEntryId requires remoteId when provided.",
    );
    await expect(
      shell.preload({ pageId: "home", buildId: "stale" }),
    ).rejects.toThrow(
      '[evjs] Shell preload() request.buildId "stale" does not match manifest.buildId "test".',
    );
    await expect(
      shell.preload({ pageId: "home", buildId: "build.1" }),
    ).rejects.toThrow(
      "[evjs] Shell preload() request.buildId must contain only letters, numbers, underscores, or hyphens.",
    );
  });

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

  it("reactivates the same target when the request changes", async () => {
    const events: string[] = [];
    const mountPoint = {} as Element;
    const mod: AppModule = {
      mount(_mountPoint, ctx) {
        events.push(`mount:${ctx.request.url?.toString()}`);
      },
      unmount(_mountPoint, ctx) {
        events.push(`unmount:${ctx.request.url?.toString()}`);
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

    await shell.activate({ url: "/orders/1", hydrate: false });
    await shell.activate({ url: "/orders/2", hydrate: false });
    await shell.activate({ url: "/orders/2", hydrate: false });
    await shell.dispose();

    expect(events).toEqual([
      "load:/default.js",
      "mount:/orders/1",
      "unmount:/orders/1",
      "mount:/orders/2",
      "unmount:/orders/2",
    ]);
  });

  it("does not unmount modules that never mounted or hydrated", async () => {
    const events: string[] = [];
    const modules: Record<string, AppModule> = {
      "/home.js": {
        unmount(_mountPoint, ctx) {
          events.push(`unmount-never-mounted:${ctx.id}`);
        },
      },
      "/about.js": {
        mount(_mountPoint, ctx) {
          events.push(`mount:${ctx.id}`);
        },
        unmount(_mountPoint, ctx) {
          events.push(`unmount:${ctx.id}`);
        },
      },
    };
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule(href) {
        events.push(`load:${href}`);
        return modules[href] ?? {};
      },
    });

    await shell.activate({ pageId: "home", hydrate: false });
    await shell.activate({ pageId: "about", hydrate: false });
    await shell.dispose();

    expect(events).toEqual([
      "load:/home.js",
      "load:/about.js",
      "mount:about",
      "unmount:about",
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

  it("rejects invalid shell module registrations", () => {
    expect(() => registerShellModule("", {})).toThrow(
      "[evjs] registerShellModule() href must be a non-empty string.",
    );
    expect(() => registerShellModule(" /home.js ", {})).toThrow(
      "[evjs] registerShellModule() href must not contain leading or trailing whitespace.",
    );
    expect(() => registerShellModule("/home.js", null as never)).toThrow(
      "[evjs] registerShellModule() module must be a lifecycle module object.",
    );
    expect(() =>
      registerShellModule("/home.js", { mount: "mount" } as never),
    ).toThrow(
      "[evjs] registerShellModule() module mount must be a function when provided.",
    );
    expect(() =>
      registerShellModule("/home.js", { hydrate: "hydrate" } as never),
    ).toThrow(
      "[evjs] registerShellModule() module hydrate must be a function when provided.",
    );
    expect(() =>
      registerShellModule("/home.js", { unmount: "unmount" } as never),
    ).toThrow(
      "[evjs] registerShellModule() module unmount must be a function when provided.",
    );
  });

  it("rejects malformed direct shell module registry state", async () => {
    const createDefaultLoaderShell = () =>
      createShell({
        manifest,
        resolveMountPoint: () => ({}) as Element,
      });

    globalThis.__EVJS_SHELL_MODULES__ = [] as never;
    await expect(
      createDefaultLoaderShell().activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow("[evjs] shell module registry must be an object.");

    globalThis.__EVJS_SHELL_MODULES__ = {
      "/home.js": undefined,
    } as never;
    await expect(
      createDefaultLoaderShell().activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] shell module registry["/home.js"] must be a lifecycle module object.',
    );

    globalThis.__EVJS_SHELL_MODULES__ = {
      "/home.js": null,
    } as never;
    await expect(
      createDefaultLoaderShell().activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] shell module registry["/home.js"] must be a lifecycle module object.',
    );

    globalThis.__EVJS_SHELL_MODULES__ = {
      "/home.js": {
        mount: "mount",
      },
    } as never;
    await expect(
      createDefaultLoaderShell().activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] shell module registry["/home.js"] mount must be a function when provided.',
    );

    globalThis.__EVJS_SHELL_MODULES__ = {
      "/home.js": () => null,
    } as never;
    await expect(
      createDefaultLoaderShell().activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] shell module registry["/home.js"] factory result must be a lifecycle module object.',
    );
  });

  it("reports invalid shell modules as load errors", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule() {
        return null as never;
      },
      onError(error, ctx) {
        events.push(
          `${error instanceof Error ? error.message : "unknown"}:${ctx.phase}:${ctx.app.kind}:${ctx.app.id}`,
        );
      },
    });

    await expect(
      shell.activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] Shell module "/home.js" must be a lifecycle module object.',
    );
    expect(events).toEqual([
      '[evjs] Shell module "/home.js" must be a lifecycle module object.:load:page:home',
    ]);
  });

  it("reports invalid shell module lifecycle hooks as load errors", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule() {
        return {
          mount: "not-callable",
        } as never;
      },
      onError(error, ctx) {
        events.push(
          `${error instanceof Error ? error.message : "unknown"}:${ctx.phase}:${ctx.app.kind}:${ctx.app.id}`,
        );
      },
    });

    await expect(
      shell.activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] Shell module "/home.js" mount must be a function when provided.',
    );
    expect(events).toEqual([
      '[evjs] Shell module "/home.js" mount must be a function when provided.:load:page:home',
    ]);
  });

  it("reports remote lifecycle modules without render hooks as load errors", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest(): Promise<RemoteManifest> {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm/",
          entries: {
            customers: {
              module: {
                type: "lifecycle",
                href: "customers.js",
              },
            },
          },
        };
      },
      async loadModule(href) {
        events.push(`load:${href}`);
        return {
          init() {},
          unmount() {},
        };
      },
      onError(error, ctx) {
        events.push(
          `${error instanceof Error ? error.message : "unknown"}:${ctx.phase}:${ctx.app.kind}:${ctx.app.remote?.entryId}`,
        );
      },
    });

    await expect(
      shell.activate({
        remoteId: "crm",
        remoteEntryId: "customers",
        hydrate: false,
      }),
    ).rejects.toThrow(
      '[evjs] Shell remote module "https://assets.example.com/crm/customers.js" must export mount or hydrate to render.',
    );
    expect(events).toEqual([
      "load:https://assets.example.com/crm/customers.js",
      '[evjs] Shell remote module "https://assets.example.com/crm/customers.js" must export mount or hydrate to render.:load:remote:customers',
    ]);
  });

  it("passes app context to registered module factories", async () => {
    const events: string[] = [];
    registerShellModule("/home.js", (ctx) => ({
      mount() {
        events.push(`factory:${ctx.kind}:${ctx.id}`);
      },
    }));

    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
    });

    await shell.activate({ pageId: "home", hydrate: false });

    expect(events).toEqual(["factory:page:home"]);
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

  it("loads remote stylesheets before remote module scripts", async () => {
    const events: string[] = [];
    const createdLinks: HTMLLinkElement[] = [];
    const createdScripts: HTMLScriptElement[] = [];
    vi.stubGlobal("location", { href: "https://host.example.com/start" });
    const document = {
      head: {
        appendChild(element: HTMLLinkElement | HTMLScriptElement) {
          if ("rel" in element && element.rel === "stylesheet") {
            createdLinks.push(element);
            events.push(`style:${element.href}`);
            element.onload?.call(element, new Event("load"));
          } else {
            const script = element as HTMLScriptElement;
            createdScripts.push(script);
            events.push(`script:${script.src}`);
            registerShellModule(script.src, {
              mount() {
                events.push("mount");
              },
            });
            script.onload?.call(script, new Event("load"));
          }
          return element;
        },
      },
      createElement(tag: string) {
        if (tag === "link") {
          return {
            remove() {
              events.push("remove-style");
            },
            setAttribute() {},
          } as unknown as HTMLLinkElement;
        }
        expect(tag).toBe("script");
        return {
          setAttribute() {},
        } as unknown as HTMLScriptElement;
      },
    } as unknown as Document;
    vi.stubGlobal("document", document);

    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest(): Promise<RemoteManifest> {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm/",
          entries: {
            customers: {
              assets: {
                css: ["customers.css"],
                js: ["customers.js"],
              },
              module: {
                type: "lifecycle",
                href: "customers.js",
              },
              activeWhen: ["/crm/*"],
            },
          },
        };
      },
    });

    await shell.activate({ url: "/crm/customers", hydrate: false });
    await shell.dispose();

    expect(createdLinks.map((link) => link.href)).toEqual([
      "https://assets.example.com/crm/customers.css",
    ]);
    expect(createdScripts.map((script) => script.src)).toEqual([
      "https://assets.example.com/crm/customers.js",
    ]);
    expect(events).toEqual([
      "style:https://assets.example.com/crm/customers.css",
      "script:https://assets.example.com/crm/customers.js",
      "mount",
      "remove-style",
    ]);
  });

  it("reports stylesheet release failures with evjs errors", async () => {
    const createStylesheetShell = (baseUrl: string) =>
      createShell({
        manifest,
        resolveMountPoint: () => ({}) as Element,
        async loadRemoteManifest(): Promise<RemoteManifest> {
          return {
            version: 1,
            name: "crm",
            baseUrl,
            entries: {
              customers: {
                assets: {
                  css: ["customers.css"],
                  js: [],
                },
                module: {
                  type: "lifecycle",
                  href: "customers.js",
                },
                activeWhen: ["/crm/*"],
              },
            },
          };
        },
        async loadModule() {
          return {
            mount() {},
          };
        },
      });

    vi.stubGlobal("document", {
      head: {
        appendChild(element: HTMLLinkElement) {
          element.onload?.call(element, new Event("load"));
          return element;
        },
      },
      createElement() {
        return {
          remove() {
            throw new Error("remove blocked");
          },
          setAttribute() {},
        } as unknown as HTMLLinkElement;
      },
    });
    const throwingShell = createStylesheetShell(
      "https://assets.example.com/release-throw/",
    );
    await throwingShell.activate({ url: "/crm/customers", hydrate: false });
    await expect(throwingShell.dispose()).rejects.toThrow(
      '[evjs] Shell cannot release stylesheet "https://assets.example.com/release-throw/customers.css": element.remove failed: remove blocked',
    );

    vi.stubGlobal("document", {
      head: {
        appendChild(element: HTMLLinkElement) {
          element.onload?.call(element, new Event("load"));
          return element;
        },
      },
      createElement() {
        return {
          remove: "remove",
          setAttribute() {},
        } as unknown as HTMLLinkElement;
      },
    });
    const invalidShell = createStylesheetShell(
      "https://assets.example.com/release-invalid/",
    );
    await invalidShell.activate({ url: "/crm/customers", hydrate: false });
    await expect(invalidShell.dispose()).rejects.toThrow(
      '[evjs] Shell cannot release stylesheet "https://assets.example.com/release-invalid/customers.css": element.remove must be a function when provided.',
    );
  });

  it("reports invalid shell asset documents with evjs errors", async () => {
    vi.stubGlobal("document", {
      head: {
        appendChild() {},
      },
    });
    const scriptShell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
    });

    await expect(
      scriptShell.activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] Shell cannot load module script "/home.js": document.createElement must be a function.',
    );

    vi.stubGlobal("document", {
      createElement() {
        return {} as HTMLLinkElement;
      },
    });
    const stylesheetShell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest(): Promise<RemoteManifest> {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm/",
          entries: {
            customers: {
              assets: {
                css: ["customers.css"],
                js: [],
              },
              module: {
                type: "lifecycle",
                href: "customers.js",
              },
              activeWhen: ["/crm/*"],
            },
          },
        };
      },
    });

    await expect(
      stylesheetShell.activate({ url: "/crm/customers", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] Shell cannot load stylesheet "https://assets.example.com/crm/customers.css": document.head.appendChild must be a function.',
    );
  });

  it("reports invalid shell asset elements with evjs errors", async () => {
    vi.stubGlobal("document", {
      head: {
        appendChild() {},
      },
      createElement() {
        return null;
      },
    });
    const scriptShell = createShell({
      manifest: {
        ...manifest,
        pages: {
          ...manifest.pages,
          home: {
            ...manifest.pages.home,
            module: {
              type: "lifecycle",
              href: "/invalid-create-element.js",
            },
          },
        },
      },
      resolveMountPoint: () => ({}) as Element,
    });

    await expect(
      scriptShell.activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] Shell cannot load module script "/invalid-create-element.js": document.createElement("script") must return an element.',
    );

    const stylesheetShell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest(): Promise<RemoteManifest> {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm/",
          entries: {
            customers: {
              assets: {
                css: ["customers.css"],
                js: [],
              },
              module: {
                type: "lifecycle",
                href: "customers.js",
              },
              activeWhen: ["/crm/*"],
            },
          },
        };
      },
    });

    await expect(
      stylesheetShell.activate({ url: "/crm/customers", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] Shell cannot load stylesheet "https://assets.example.com/crm/customers.css": document.createElement("link") must return an element.',
    );
  });

  it("reports shell asset append failures with evjs errors", async () => {
    vi.stubGlobal("document", {
      head: {
        appendChild() {
          throw new Error("append blocked");
        },
      },
      createElement() {
        return {
          setAttribute() {},
        };
      },
    });
    const scriptShell = createShell({
      manifest: {
        ...manifest,
        pages: {
          ...manifest.pages,
          home: {
            ...manifest.pages.home,
            module: {
              type: "lifecycle",
              href: "/append-fail.js",
            },
          },
        },
      },
      resolveMountPoint: () => ({}) as Element,
    });

    await expect(
      scriptShell.activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] Shell cannot load module script "/append-fail.js": document.head.appendChild failed: append blocked',
    );

    const stylesheetShell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest(): Promise<RemoteManifest> {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/append-fail/",
          entries: {
            customers: {
              assets: {
                css: ["customers.css"],
                js: [],
              },
              module: {
                type: "lifecycle",
                href: "customers.js",
              },
              activeWhen: ["/crm/*"],
            },
          },
        };
      },
    });

    await expect(
      stylesheetShell.activate({ url: "/crm/customers", hydrate: false }),
    ).rejects.toThrow(
      '[evjs] Shell cannot load stylesheet "https://assets.example.com/append-fail/customers.css": document.head.appendChild failed: append blocked',
    );
  });

  it("reports invalid managed stylesheet inspection with evjs errors", async () => {
    const createStylesheetShell = () =>
      createShell({
        manifest,
        resolveMountPoint: () => ({}) as Element,
        async loadRemoteManifest(): Promise<RemoteManifest> {
          return {
            version: 1,
            name: "crm",
            baseUrl: "https://assets.example.com/query-selector/",
            entries: {
              customers: {
                assets: {
                  css: ["customers.css"],
                  js: [],
                },
                module: {
                  type: "lifecycle",
                  href: "customers.js",
                },
                activeWhen: ["/crm/*"],
              },
            },
          };
        },
      });

    vi.stubGlobal("document", {
      head: {
        appendChild() {},
      },
      createElement() {
        return {
          setAttribute() {},
        } as unknown as HTMLLinkElement;
      },
      querySelectorAll: "links",
    });
    await expect(
      createStylesheetShell().activate({
        url: "/crm/customers",
        hydrate: false,
      }),
    ).rejects.toThrow(
      '[evjs] Shell cannot inspect managed stylesheet "https://assets.example.com/query-selector/customers.css": document.querySelectorAll must be a function when provided.',
    );

    vi.stubGlobal("document", {
      head: {
        appendChild() {},
      },
      createElement() {
        return {
          setAttribute() {},
        } as unknown as HTMLLinkElement;
      },
      querySelectorAll() {
        return null;
      },
    });
    await expect(
      createStylesheetShell().activate({
        url: "/crm/customers",
        hydrate: false,
      }),
    ).rejects.toThrow(
      '[evjs] Shell cannot inspect managed stylesheet "https://assets.example.com/query-selector/customers.css": document.querySelectorAll must return a list of elements.',
    );

    vi.stubGlobal("document", {
      head: {
        appendChild() {},
      },
      createElement() {
        return {
          setAttribute() {},
        } as unknown as HTMLLinkElement;
      },
      querySelectorAll() {
        return [null];
      },
    });
    await expect(
      createStylesheetShell().activate({
        url: "/crm/customers",
        hydrate: false,
      }),
    ).rejects.toThrow(
      '[evjs] Shell cannot inspect managed stylesheet "https://assets.example.com/query-selector/customers.css": document.querySelectorAll result[0] must be an element.',
    );
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

  it("serializes overlapping activations", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule(href, ctx) {
        events.push(`load:${ctx.id}:${href}`);
        return {
          mount() {
            events.push(`mount:${ctx.id}`);
          },
          unmount() {
            events.push(`unmount:${ctx.id}`);
          },
        };
      },
    });

    const first = shell.activate({ pageId: "home", hydrate: false });
    const second = shell.activate({ pageId: "about", hydrate: false });
    await Promise.all([first, second]);

    expect(events).toEqual([
      "load:home:/home.js",
      "mount:home",
      "load:about:/about.js",
      "unmount:home",
      "mount:about",
    ]);
  });

  it("does not mount an activation that finishes loading after dispose starts", async () => {
    const events: string[] = [];
    let markLoadStarted: (() => void) | undefined;
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    let resolveModule: ((module: AppModule) => void) | undefined;
    const moduleLoaded = new Promise<AppModule>((resolve) => {
      resolveModule = resolve;
    });
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule(href) {
        events.push(`load:${href}`);
        markLoadStarted?.();
        return moduleLoaded;
      },
    });

    const activation = shell.activate({ pageId: "home", hydrate: false });
    await loadStarted;
    const disposal = shell.dispose();
    if (!resolveModule) throw new Error("Expected module resolver.");
    resolveModule({
      mount() {
        events.push("mount");
      },
      unmount() {
        events.push("unmount");
      },
    });
    await Promise.all([activation, disposal]);

    expect(events).toEqual(["load:/home.js"]);
  });

  it("unmounts an activation that finishes mounting after dispose starts", async () => {
    const events: string[] = [];
    let markMountStarted: (() => void) | undefined;
    const mountStarted = new Promise<void>((resolve) => {
      markMountStarted = resolve;
    });
    let finishMount: (() => void) | undefined;
    const mountFinished = new Promise<void>((resolve) => {
      finishMount = resolve;
    });
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule() {
        return {
          async mount() {
            events.push("mount:start");
            markMountStarted?.();
            await mountFinished;
            events.push("mount:end");
          },
          unmount() {
            events.push("unmount");
          },
        };
      },
    });

    const activation = shell.activate({ pageId: "home", hydrate: false });
    await mountStarted;
    const disposal = shell.dispose();
    if (!finishMount) throw new Error("Expected mount resolver.");
    finishMount();
    await Promise.all([activation, disposal]);

    expect(events).toEqual(["mount:start", "mount:end", "unmount"]);
  });

  it("rejects shell lifecycle calls after dispose", async () => {
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
    });

    await shell.dispose();

    await expect(
      shell.activate({ pageId: "home", hydrate: false }),
    ).rejects.toThrow("[evjs] Shell activate() cannot run after dispose().");
    await expect(shell.preload({ pageId: "home" })).rejects.toThrow(
      "[evjs] Shell preload() cannot run after dispose().",
    );
    await expect(
      shell.start({ pageId: "home", hydrate: false }),
    ).rejects.toThrow("[evjs] Shell start() cannot run after dispose().");
  });

  it("keeps the current activation mounted when the next module load fails", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule(href, ctx) {
        events.push(`load:${ctx.id}:${href}`);
        if (ctx.id === "about") throw new Error("about failed");
        return {
          mount() {
            events.push(`mount:${ctx.id}`);
          },
          unmount() {
            events.push(`unmount:${ctx.id}`);
          },
        };
      },
    });

    await shell.activate({ pageId: "home", hydrate: false });
    await expect(
      shell.activate({ pageId: "about", hydrate: false }),
    ).rejects.toThrow("about failed");
    await shell.dispose();

    expect(events).toEqual([
      "load:home:/home.js",
      "mount:home",
      "load:about:/about.js",
      "unmount:home",
    ]);
  });

  it("restores the current hydrated page when the next hydration fails", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadModule(href, ctx) {
        events.push(`load:${ctx.id}:${href}`);
        return {
          hydrate() {
            events.push(`hydrate:${ctx.id}`);
            if (ctx.id === "about") throw new Error("about hydrate failed");
          },
          unmount() {
            events.push(`unmount:${ctx.id}`);
          },
        };
      },
    });

    await shell.activate({ pageId: "home" });
    await expect(shell.activate({ pageId: "about" })).rejects.toThrow(
      "about hydrate failed",
    );
    await shell.dispose();

    expect(events).toEqual([
      "load:home:/home.js",
      "hydrate:home",
      "load:about:/about.js",
      "unmount:home",
      "hydrate:about",
      "hydrate:home",
      "unmount:home",
    ]);
  });

  it("restores the current page when the next remote mount fails", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest(_remote, ctx) {
        events.push(`remote-manifest:${ctx.id}`);
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
      async loadModule(href, ctx) {
        events.push(`load:${ctx.kind}:${ctx.id}:${href}`);
        return {
          mount() {
            events.push(`mount:${ctx.kind}:${ctx.id}`);
            if (ctx.kind === "remote") throw new Error("remote mount failed");
          },
          unmount() {
            events.push(`unmount:${ctx.kind}:${ctx.id}`);
          },
        };
      },
    });

    await shell.activate({ pageId: "home", hydrate: false });
    await expect(
      shell.activate({
        remoteId: "crm",
        remoteEntryId: "list",
        hydrate: false,
      }),
    ).rejects.toThrow("remote mount failed");
    await shell.dispose();

    expect(events).toEqual([
      "load:page:home:/home.js",
      "mount:page:home",
      "remote-manifest:crm",
      "load:remote:crm:https://assets.example.com/crm/list.js",
      "unmount:page:home",
      "mount:remote:crm",
      "mount:page:home",
      "unmount:page:home",
    ]);
  });

  it("releases next remote stylesheets when previous unmount fails", async () => {
    const events: string[] = [];
    vi.stubGlobal("document", {
      head: {
        appendChild(element: HTMLLinkElement) {
          events.push(`style:${element.href}`);
          element.onload?.call(element, new Event("load"));
          return element;
        },
      },
      createElement(tag: string) {
        expect(tag).toBe("link");
        const link = {
          href: "",
          remove() {
            events.push(`remove:${link.href}`);
          },
          setAttribute() {},
        } as unknown as HTMLLinkElement;
        return link;
      },
    } as unknown as Document);

    const shell = createShell({
      manifest: {
        ...manifest,
        remotes: {
          crm: {
            manifest: "https://assets.example.com/crm/manifest.json",
          },
          support: {
            manifest: "https://assets.example.com/support/manifest.json",
          },
        },
      },
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest(_remote, ctx): Promise<RemoteManifest> {
        events.push(`remote-manifest:${ctx.id}`);
        return {
          version: 1,
          name: ctx.id,
          baseUrl: `https://assets.example.com/${ctx.id}/`,
          entries: {
            default: {
              assets: {
                css: [`${ctx.id}.css`],
                js: [],
              },
              module: {
                type: "lifecycle",
                href: `${ctx.id}.js`,
              },
            },
          },
        };
      },
      async loadModule(_href, ctx) {
        events.push(`load:${ctx.id}`);
        return {
          mount() {
            events.push(`mount:${ctx.id}`);
          },
          unmount() {
            events.push(`unmount:${ctx.id}`);
            if (ctx.id === "crm") {
              throw new Error("crm unmount failed");
            }
          },
        };
      },
    });

    await shell.activate({ remoteId: "crm", hydrate: false });
    await expect(
      shell.activate({ remoteId: "support", hydrate: false }),
    ).rejects.toThrow("crm unmount failed");

    expect(events).toEqual([
      "remote-manifest:crm",
      "style:https://assets.example.com/crm/crm.css",
      "load:crm",
      "mount:crm",
      "remote-manifest:support",
      "style:https://assets.example.com/support/support.css",
      "load:support",
      "unmount:crm",
      "remove:https://assets.example.com/support/support.css",
      "remove:https://assets.example.com/crm/crm.css",
    ]);
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

    await shell.activate({
      url: "/crm/customers?id=123#notes",
      hydrate: false,
    });

    expect(events).toEqual([
      "remote-manifest:crm:https://assets.example.com/crm/manifest.json",
      "load:https://assets.example.com/crm/remote-entry.js",
      "mount:remote:crm:default",
    ]);
  });

  it("prefers the most specific host remote activeWhen match", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest: {
        ...manifest,
        remotes: {
          app: {
            manifest: "https://assets.example.com/app/manifest.json",
            activeWhen: ["/app/*"],
          },
          crm: {
            manifest: "https://assets.example.com/crm/manifest.json",
            activeWhen: ["/app/crm/*"],
          },
        },
      },
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest(remote, ctx) {
        events.push(`remote-manifest:${ctx.id}:${remote.manifest}`);
        return {
          version: 1,
          name: ctx.id,
          baseUrl: `https://assets.example.com/${ctx.id}/`,
          entries: {
            default: {
              module: {
                type: "lifecycle",
                href: "entry.js",
              },
            },
          },
        };
      },
      async loadModule(href, ctx) {
        events.push(`load:${ctx.remote?.id}:${href}`);
        return {
          mount() {
            events.push(`mount:${ctx.remote?.id}:${ctx.remote?.entryId}`);
          },
        };
      },
    });

    await shell.activate({
      url: "/app/crm/customers",
      hydrate: false,
    });

    expect(events).toEqual([
      "remote-manifest:crm:https://assets.example.com/crm/manifest.json",
      "load:crm:https://assets.example.com/crm/entry.js",
      "mount:crm:default",
    ]);
  });

  it("prefers the most specific remote entry activeWhen match", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest() {
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm/",
          entries: {
            default: {
              module: {
                type: "lifecycle",
                href: "default.js",
              },
              activeWhen: ["/crm/*"],
            },
            customers: {
              module: {
                type: "lifecycle",
                href: "customers.js",
              },
              activeWhen: ["/crm/customers/*"],
            },
          },
        };
      },
      async loadModule(href, ctx) {
        events.push(`load:${href}`);
        return {
          mount() {
            events.push(`mount:${ctx.remote?.entryId}`);
          },
        };
      },
    });

    await shell.activate({
      url: "/crm/customers/123",
      hydrate: false,
    });

    expect(events).toEqual([
      "load:https://assets.example.com/crm/customers.js",
      "mount:customers",
    ]);
  });

  it("validates custom remote manifest loaders before caching", async () => {
    const events: string[] = [];
    let loadCount = 0;
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      loadRemoteManifest: async (): Promise<RemoteManifest> => {
        loadCount++;
        events.push(`remote-manifest:${loadCount}`);
        if (loadCount === 1) {
          return {
            version: 1,
            name: "crm",
            baseUrl: "https://assets.example.com/crm/",
            entries: {},
          };
        }
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm/",
          entries: {
            list: {
              module: {
                type: "lifecycle",
                href: "list.js",
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

    await expect(
      shell.activate({
        remoteId: "crm",
        remoteEntryId: "list",
        hydrate: false,
      }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "https://assets.example.com/crm/manifest.json" entries must declare at least one remote entry.`,
    );
    await shell.activate({
      remoteId: "crm",
      remoteEntryId: "list",
      hydrate: false,
    });

    expect(events).toEqual([
      "remote-manifest:1",
      "remote-manifest:2",
      "load:https://assets.example.com/crm/list.js",
      "mount",
    ]);
  });

  it("rejects remote manifests whose name does not match the host remote id", async () => {
    const events: string[] = [];
    let loadCount = 0;
    const shell = createShell({
      manifest,
      resolveMountPoint: () => ({}) as Element,
      async loadRemoteManifest(): Promise<RemoteManifest> {
        loadCount++;
        events.push(`remote-manifest:${loadCount}`);
        if (loadCount === 1) {
          return {
            version: 1,
            name: "analytics",
            baseUrl: "https://assets.example.com/analytics/",
            entries: {
              list: {
                module: {
                  type: "lifecycle",
                  href: "list.js",
                },
              },
            },
          };
        }
        return {
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm/",
          entries: {
            list: {
              module: {
                type: "lifecycle",
                href: "list.js",
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

    await expect(
      shell.activate({
        remoteId: "crm",
        remoteEntryId: "list",
        hydrate: false,
      }),
    ).rejects.toThrow(
      '[evjs] Remote "crm" loaded manifest "https://assets.example.com/crm/manifest.json" with name "analytics". Remote manifest name must match the host manifest remote id.',
    );
    await shell.activate({
      remoteId: "crm",
      remoteEntryId: "list",
      hydrate: false,
    });

    expect(events).toEqual([
      "remote-manifest:1",
      "remote-manifest:2",
      "load:https://assets.example.com/crm/list.js",
      "mount",
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
      onRemoteSharedNegotiated(event) {
        events.push(
          `negotiated:${event.remoteId}:${event.dependencies.join(",")}:${event.resolution.provided.react?.version}`,
        );
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

    expect(events).toEqual(["negotiated:crm:react:19.2.5", "shared:react"]);
    await expect(loadSharedDependency("react")).rejects.toThrow(
      'Shared dependency "react" is not registered',
    );
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
    const shell = createShell({
      manifest,
      shared: {
        "react-dom": {
          version: "19.2.5",
          singleton: true,
          value: { hydrateRoot: true },
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

  it("uses semver caret rules for pre-1.0 shared dependencies", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      sharedPolicy: "warn",
      shared: {
        ok: {
          version: "0.2.4",
          singleton: true,
          value: {},
        },
        nextMinor: {
          version: "0.3.0",
          singleton: true,
          value: {},
        },
        invalid: {
          version: "not-a-version",
          singleton: true,
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
            ok: {
              requiredVersion: "^0.2.3",
              singleton: true,
            },
            nextMinor: {
              requiredVersion: "^0.2.3",
              singleton: true,
            },
            invalid: {
              requiredVersion: "^1.0.0",
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
          `provided:${Object.keys(ctx.remote?.shared.provided ?? {}).join(",")}`,
        );
        events.push(
          `incompatible:${ctx.remote?.shared.incompatible
            .map((item) => `${item.name}:${item.providedVersion}`)
            .join(",")}`,
        );
        return {
          mount() {},
        };
      },
      onWarning() {},
    });

    await shell.activate({
      remoteId: "crm",
      remoteEntryId: "list",
      hydrate: false,
    });

    expect(events).toEqual([
      "provided:ok",
      "incompatible:nextMinor:0.3.0,invalid:not-a-version",
    ]);
  });

  it("uses explicitly registered global shared dependencies as shell defaults", async () => {
    const events: string[] = [];
    registerSharedDependency("react", {
      version: "19.2.5",
      singleton: true,
      value: { createElement: true },
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
        events.push(ctx.remote?.shared.provided.react?.version ?? "missing");
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

    expect(events).toEqual(["19.2.5"]);
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

  it("treats strict remote shared dependency failures as errors", async () => {
    const shell = createShell({
      manifest,
      sharedPolicy: "warn",
      shared: {
        react: {
          version: "18.3.1",
          singleton: true,
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
              strictVersion: true,
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
    ).rejects.toThrow("does not satisfy ^19.0.0");
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

  it("reports invalid resolved mount points as resolve errors", async () => {
    const events: string[] = [];
    const shell = createShell({
      manifest,
      resolveMountPoint: () => "root" as never,
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
    ).rejects.toThrow(
      '[evjs] Shell resolveMountPoint() for page "home" must return an Element or null.',
    );
    expect(events).toEqual([
      '[evjs] Shell resolveMountPoint() for page "home" must return an Element or null.:resolve:page:home',
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
  it("rejects invalid page driver options with evjs errors", () => {
    expect(() => createPageDriver(null as never)).toThrow(
      "[evjs] createPageDriver() options must be an object.",
    );
    expect(() => createPageDriver({ document: [] as never })).toThrow(
      "[evjs] createPageDriver() document must be available or provided.",
    );
  });

  it("reports unavailable or invalid page documents with evjs errors", () => {
    vi.stubGlobal("document", undefined);
    const missingDocumentDriver = createPageDriver();

    expect(() => missingDocumentDriver.current()).toThrow(
      "[evjs] createPageDriver() document must be available or provided.",
    );

    expect(() =>
      createPageDriver({
        document: {
          documentElement: "html",
        } as never,
      }).current(),
    ).toThrow(
      "[evjs] createPageDriver() document.documentElement must be an object when provided.",
    );

    expect(() =>
      createPageDriver({
        document: {
          documentElement: {},
        } as never,
      }).current(),
    ).toThrow(
      "[evjs] createPageDriver() document.documentElement.getAttribute must be a function when documentElement is provided.",
    );

    expect(() =>
      createPageDriver({
        document: {
          documentElement: null,
          location: "https://example.com/home",
        } as never,
      }).current(),
    ).toThrow(
      "[evjs] createPageDriver() document.location must be an object when provided.",
    );

    expect(() =>
      createPageDriver({
        document: {
          documentElement: null,
          location: { href: 42 },
        } as never,
      }).current(),
    ).toThrow(
      "[evjs] createPageDriver() document.location.href must be a string when provided.",
    );
  });

  it("creates activation requests from framework HTML attributes", () => {
    const document = {
      documentElement: {
        getAttribute(name: string) {
          return (
            {
              "data-evjs-kind": "page",
              "data-evjs-id": "home",
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

  it("handles documents without an available documentElement", () => {
    const document = {
      documentElement: null,
      location: {
        href: "https://example.com/home",
      },
    } as unknown as Document;

    expect(createPageDriver({ document }).current()).toEqual({
      appId: undefined,
      pageId: undefined,
      buildId: undefined,
      url: "https://example.com/home",
    });
  });
});

describe("createHistoryDriver", () => {
  it("rejects invalid history driver options with evjs errors", () => {
    expect(() => createHistoryDriver(null as never)).toThrow(
      "[evjs] createHistoryDriver() options must be an object.",
    );
    expect(() => createHistoryDriver({ manifest: null } as never)).toThrow(
      "[evjs] createHistoryDriver() manifest must be an object.",
    );
    expect(() =>
      createHistoryDriver({
        manifest: { ...manifest, routes: {} },
        window: createMockWindow("https://example.com/home"),
      } as never),
    ).toThrow("[evjs] createHistoryDriver() manifest.routes must be an array.");
    expect(() =>
      createHistoryDriver({
        manifest: { ...manifest, remotes: [] },
        window: createMockWindow("https://example.com/home"),
      } as never),
    ).toThrow(
      "[evjs] createHistoryDriver() manifest.remotes must be an object when provided.",
    );
    expect(() =>
      createHistoryDriver({
        manifest,
        window: {
          addEventListener() {},
          removeEventListener() {},
        },
      } as never),
    ).toThrow(
      "[evjs] createHistoryDriver() window.location must be an object.",
    );
    expect(() =>
      createHistoryDriver({
        manifest,
        window: {
          location: { href: "https://example.com/home" },
          removeEventListener() {},
        },
      } as never),
    ).toThrow(
      "[evjs] createHistoryDriver() window.addEventListener must be a function.",
    );
    expect(() =>
      createHistoryDriver({
        manifest,
        window: {
          addEventListener() {},
          location: { href: "https://example.com/home" },
        },
      } as never),
    ).toThrow(
      "[evjs] createHistoryDriver() window.removeEventListener must be a function.",
    );
  });

  it("reports unavailable or invalid history window locations with evjs errors", () => {
    vi.stubGlobal("window", undefined);
    const missingWindowDriver = createHistoryDriver({ manifest });

    expect(() => missingWindowDriver.current()).toThrow(
      "[evjs] createHistoryDriver() window must be available or provided.",
    );

    const invalidHrefDriver = createHistoryDriver({
      manifest,
      window: {
        ...createMockWindow("https://example.com/home"),
        location: { href: "" } as Location,
      },
    });

    expect(() => invalidHrefDriver.current()).toThrow(
      "[evjs] createHistoryDriver() window.location.href must be a non-empty string.",
    );
  });

  it("reports history listener subscription failures with evjs errors", () => {
    const addFailureWindow: HistoryDriverOptions["window"] = {
      location: { href: "https://example.com/home" } as Location,
      addEventListener() {
        throw new Error("add blocked");
      },
      removeEventListener() {},
    };
    const addFailureDriver = createHistoryDriver({
      manifest,
      window: addFailureWindow,
    });

    expect(() => addFailureDriver.subscribe(() => {})).toThrow(
      '[evjs] createHistoryDriver() window.addEventListener("popstate") failed: add blocked',
    );

    const removeFailureWindow: HistoryDriverOptions["window"] = {
      location: { href: "https://example.com/home" } as Location,
      addEventListener() {},
      removeEventListener() {
        throw new Error("remove blocked");
      },
    };
    const removeFailureDriver = createHistoryDriver({
      manifest,
      window: removeFailureWindow,
    });
    const unsubscribe = removeFailureDriver.subscribe(() => {});

    expect(unsubscribe).toThrow(
      '[evjs] createHistoryDriver() window.removeEventListener("popstate") failed: remove blocked',
    );
  });

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

  it("prefers the most specific manifest route for activation requests", () => {
    const orderedManifest: BuildOutput = {
      ...manifest,
      routes: [
        {
          id: "user",
          path: "/users/$userId",
          pageId: "about",
        },
        {
          id: "user-settings",
          path: "/users/settings",
          pageId: "home",
        },
      ],
    };
    const driver = createHistoryDriver({
      manifest: orderedManifest,
      window: createMockWindow("https://example.com/users/settings"),
    });

    expect(driver.current()).toEqual({
      appId: undefined,
      pageId: "home",
      url: "https://example.com/users/settings",
    });
  });

  it("prefers remote activeWhen matches over host fallback routes", () => {
    const driver = createHistoryDriver({
      manifest: {
        ...manifest,
        routes: [
          {
            id: "fallback",
            path: "/*",
            appId: "default",
          },
        ],
      },
      window: createMockWindow("https://example.com/crm/customers"),
    });

    expect(driver.current()).toEqual({
      remoteId: "crm",
      url: "https://example.com/crm/customers",
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
