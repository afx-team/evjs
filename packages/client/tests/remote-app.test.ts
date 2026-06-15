import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __getRemoteAppRequestKeyForTesting,
  __parseRemoteAppRequestKeyForTesting,
  __startRemoteHostLifecycleForTesting,
  createRemoteAppManifest,
  formatRemoteSharedNegotiation,
  getRemoteSharedVersion,
  type RemoteAppRuntimeController,
  type RemoteAppState,
  resolveRemoteAppManifestUrl,
  startRemoteAppRuntime,
} from "../src/remote-app.js";
import { defaultLoadRemoteManifest } from "../src/shell/assets.js";

const reactDomCalls: string[] = [];
const reactDomElements: unknown[] = [];

vi.mock("react-dom/client", () => ({
  createRoot() {
    reactDomCalls.push("createRoot");
    return {
      render(element: unknown) {
        reactDomElements.push(element);
        reactDomCalls.push("render");
      },
      unmount() {
        reactDomCalls.push("unmount");
      },
    };
  },
  hydrateRoot(_mountPoint: unknown, element: unknown) {
    reactDomElements.push(element);
    reactDomCalls.push("hydrateRoot");
    return {
      unmount() {
        reactDomCalls.push("unmount");
      },
    };
  },
}));

afterEach(() => {
  reactDomCalls.length = 0;
  reactDomElements.length = 0;
  vi.unstubAllGlobals();
  delete globalThis.__EVJS_SHELL_MODULES__;
  delete globalThis.__EVJS_SHARED_SCOPE__;
});

describe("remote app runtime", () => {
  it("creates a minimal framework manifest for a remote app", () => {
    expect(
      createRemoteAppManifest({
        remote: "crm",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        activeWhen: "/crm/*",
      }),
    ).toMatchObject({
      version: 1,
      remotes: {
        crm: {
          manifest: "https://assets.example.com/crm/evjs-remote.json",
          activeWhen: ["/crm/*"],
        },
      },
    });
  });

  it("validates remote app target identity options", () => {
    expect(() => createRemoteAppManifest(null as never)).toThrow(
      "[evjs] createRemoteAppManifest() options must be an object.",
    );

    expect(() => resolveRemoteAppManifestUrl(null as never)).toThrow(
      "[evjs] resolveRemoteAppManifestUrl() options must be an object.",
    );

    expect(() =>
      createRemoteAppManifest({
        remote: "",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
      }),
    ).toThrow("[evjs] RemoteApp remote must be a non-empty string.");

    expect(() =>
      createRemoteAppManifest({
        remote: " crm ",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
      }),
    ).toThrow(
      "[evjs] RemoteApp remote must not contain leading or trailing whitespace.",
    );

    expect(() =>
      createRemoteAppManifest({
        remote: "crm/main",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
      }),
    ).toThrow(
      "[evjs] RemoteApp remote must contain only letters, numbers, underscores, or hyphens.",
    );

    expect(() =>
      createRemoteAppManifest({
        remote: "crm",
        manifest: "",
      }),
    ).toThrow("[evjs] RemoteApp manifest must be a non-empty string.");

    expect(() =>
      createRemoteAppManifest({
        remote: "crm",
        manifest: "http://[",
      }),
    ).toThrow("[evjs] RemoteApp manifest must be an http(s) URL or path.");

    expect(() =>
      createRemoteAppManifest({
        remote: "crm",
        manifest: "javascript:alert(1)",
      }),
    ).toThrow("[evjs] RemoteApp manifest must be an http(s) URL or path.");

    expect(() =>
      resolveRemoteAppManifestUrl({
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        manifestQueryParam: "",
      }),
    ).toThrow(
      "[evjs] RemoteApp manifestQueryParam must be a non-empty string.",
    );

    expect(() =>
      resolveRemoteAppManifestUrl({
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        manifestQueryParam: " remoteManifest ",
      }),
    ).toThrow(
      "[evjs] RemoteApp manifestQueryParam must not contain leading or trailing whitespace.",
    );

    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html?remoteManifest=/dev-remote.json",
      hostname: "localhost",
    });
    expect(() =>
      resolveRemoteAppManifestUrl({
        manifest: "",
        manifestQueryParam: "remoteManifest",
      }),
    ).toThrow("[evjs] RemoteApp manifest must be a non-empty string.");

    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html?remoteManifest=%20/dev-remote.json%20",
      hostname: "localhost",
    });
    expect(() =>
      resolveRemoteAppManifestUrl({
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        manifestQueryParam: "remoteManifest",
      }),
    ).toThrow(
      "[evjs] RemoteApp remoteManifest manifest override must not contain leading or trailing whitespace.",
    );

    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html?remoteManifest=javascript:alert(1)",
      hostname: "localhost",
    });
    expect(() =>
      resolveRemoteAppManifestUrl({
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        manifestQueryParam: "remoteManifest",
      }),
    ).toThrow(
      "[evjs] RemoteApp remoteManifest manifest override must be an http(s) URL or path.",
    );
  });

  it("defaults and validates remote app activeWhen options", () => {
    expect(
      createRemoteAppManifest({
        remote: "crm",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
      }).remotes?.crm?.activeWhen,
    ).toEqual(["/*"]);

    expect(() =>
      createRemoteAppManifest({
        remote: "crm",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        activeWhen: "crm/*",
      }),
    ).toThrow(
      '[evjs] RemoteApp activeWhen pattern "crm/*" must start with "/".',
    );

    expect(() =>
      createRemoteAppManifest({
        remote: "crm",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        activeWhen: [],
      }),
    ).toThrow("[evjs] RemoteApp activeWhen must contain at least one path.");

    expect(() =>
      createRemoteAppManifest({
        remote: "crm",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        activeWhen: "/crm page/*",
      }),
    ).toThrow(
      '[evjs] RemoteApp activeWhen pattern "/crm page/*" must not contain whitespace.',
    );

    expect(() =>
      createRemoteAppManifest({
        remote: "crm",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        activeWhen: "/crm/*?preview=1",
      }),
    ).toThrow(
      '[evjs] RemoteApp activeWhen pattern "/crm/*?preview=1" must not include a query string or hash.',
    );

    expect(() =>
      createRemoteAppManifest({
        remote: "crm",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        activeWhen: "/crm/*#main",
      }),
    ).toThrow(
      '[evjs] RemoteApp activeWhen pattern "/crm/*#main" must not include a query string or hash.',
    );

    expect(() =>
      createRemoteAppManifest({
        remote: "crm",
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        activeWhen: ["/crm/*", "/crm/*"],
      }),
    ).toThrow(
      '[evjs] RemoteApp activeWhen must not contain duplicate pattern "/crm/*".',
    );
  });

  it("validates remote shared negotiation formatter inputs", () => {
    expect(() => formatRemoteSharedNegotiation(null as never)).toThrow(
      "[evjs] RemoteApp formatRemoteSharedNegotiation() event must be an object.",
    );

    expect(() =>
      formatRemoteSharedNegotiation({
        dependencies: ["react"],
        resolution: { provided: {} },
      } as never),
    ).toThrow(
      "[evjs] RemoteApp formatRemoteSharedNegotiation() event.remoteId must be a non-empty string.",
    );

    expect(() =>
      formatRemoteSharedNegotiation({
        remoteId: "crm",
        dependencies: "react",
        resolution: { provided: {} },
      } as never),
    ).toThrow(
      "[evjs] RemoteApp formatRemoteSharedNegotiation() event.dependencies must be an array.",
    );

    expect(() =>
      formatRemoteSharedNegotiation({
        remoteId: "crm",
        dependencies: [""],
        resolution: { provided: {} },
      } as never),
    ).toThrow(
      "[evjs] RemoteApp formatRemoteSharedNegotiation() event.dependencies[0] must be a non-empty string.",
    );

    expect(() =>
      getRemoteSharedVersion({
        remoteId: "crm",
        dependencies: ["react"],
        resolution: {},
      } as never),
    ).toThrow(
      "[evjs] RemoteApp getRemoteSharedVersion() event.resolution.provided must be an object.",
    );

    expect(() =>
      getRemoteSharedVersion(
        {
          remoteId: "crm",
          dependencies: ["react"],
          resolution: { provided: {} },
        } as never,
        "",
      ),
    ).toThrow(
      "[evjs] RemoteApp getRemoteSharedVersion() names[0] must be a non-empty string.",
    );
  });

  it("uses the configured manifest by default even when a query override exists", () => {
    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html?remoteManifest=/dev-remote.json",
      hostname: "localhost",
    });

    expect(
      resolveRemoteAppManifestUrl({
        manifest: "https://assets.example.com/crm/evjs-remote.json",
      }),
    ).toBe("https://assets.example.com/crm/evjs-remote.json");
  });

  it("uses an explicit query manifest override when enabled", () => {
    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html?remoteManifest=/dev-remote.json",
      hostname: "localhost",
    });

    expect(
      resolveRemoteAppManifestUrl({
        manifest: "https://assets.example.com/crm/evjs-remote.json",
        manifestQueryParam: "remoteManifest",
      }),
    ).toBe("/dev-remote.json");
  });

  it("accepts relative remote app manifest paths", () => {
    expect(
      createRemoteAppManifest({
        remote: "crm",
        manifest: "/remotes/crm/evjs-remote.json",
      }).remotes?.crm?.manifest,
    ).toBe("/remotes/crm/evjs-remote.json");

    expect(
      resolveRemoteAppManifestUrl({
        manifest: "remotes/crm/evjs-remote.json",
      }),
    ).toBe("remotes/crm/evjs-remote.json");
  });

  it("uses the configured manifest when there is no query override", () => {
    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html",
      hostname: "localhost",
    });

    expect(
      resolveRemoteAppManifestUrl({
        manifest: "https://assets.example.com/crm/evjs-remote.json",
      }),
    ).toBe("https://assets.example.com/crm/evjs-remote.json");
  });

  it("disposes remote host controllers that resolve after hook cleanup", async () => {
    let state: RemoteAppState = {
      status: "idle",
      sharedNegotiations: [],
    };
    const setState = vi.fn((next) => {
      state = typeof next === "function" ? next(state) : next;
    });
    const dispose = vi.fn(async () => {
      throw new Error("dispose failed");
    });
    let resolveRuntime:
      | ((controller: RemoteAppRuntimeController) => void)
      | undefined;
    const runtimeStarted = new Promise<RemoteAppRuntimeController>(
      (resolve) => {
        resolveRuntime = resolve;
      },
    );

    const cleanup = __startRemoteHostLifecycleForTesting({
      remote: "crm",
      manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
      mountRef: { current: {} as Element },
      setState,
      startRuntime: vi.fn(() => runtimeStarted),
    });

    expect(state.status).toBe("loading");

    cleanup();
    if (!resolveRuntime) throw new Error("Expected runtime resolver.");
    resolveRuntime({ dispose });
    await runtimeStarted;
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledOnce();
    expect(state.status).toBe("loading");
  });

  it("disposes mounted remote host controllers during hook cleanup", async () => {
    let state: RemoteAppState = {
      status: "idle",
      sharedNegotiations: [],
    };
    const setState = vi.fn((next) => {
      state = typeof next === "function" ? next(state) : next;
    });
    const dispose = vi.fn(async () => {
      throw new Error("dispose failed");
    });
    const runtimeStarted = Promise.resolve({ dispose });

    const cleanup = __startRemoteHostLifecycleForTesting({
      remote: "crm",
      manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
      mountRef: { current: {} as Element },
      setState,
      startRuntime: vi.fn(() => runtimeStarted),
    });

    expect(state.status).toBe("loading");

    await runtimeStarted;
    await Promise.resolve();

    expect(state.status).toBe("mounted");

    cleanup();
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledOnce();
    expect(state.status).toBe("mounted");
  });

  it("validates remote app mount options before lifecycle activation", async () => {
    const options = {
      remote: "crm",
      manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
      request: {
        remoteEntryId: "customers",
      },
      runtime: {
        async loadRemoteManifest() {
          return {
            version: 1,
            name: "crm",
            baseUrl: "https://cdn.example.com/remotes/crm/",
            entries: {
              customers: {
                module: {
                  type: "lifecycle",
                  href: "crm-customers.js",
                },
              },
            },
          };
        },
        async loadModule() {
          return {
            mount() {
              throw new Error("mount should not be called");
            },
          };
        },
      },
    } satisfies Omit<Parameters<typeof startRemoteAppRuntime>[0], "mount">;

    await expect(startRemoteAppRuntime(null as never)).rejects.toThrow(
      "[evjs] startRemoteAppRuntime() options must be an object.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: {} as Element,
        runtime: "runtime" as never,
      }),
    ).rejects.toThrow("[evjs] RemoteApp runtime must be an object.");

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: {} as Element,
        runtime: { shared: [] as never },
      }),
    ).rejects.toThrow("[evjs] RemoteApp runtime.shared must be an object.");

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: {} as Element,
        runtime: { shared: { react: "react" } as never },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp runtime.shared.react must be a shared dependency object.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: {} as Element,
        runtime: {
          shared: { react: { version: " 19.0.0 " } },
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp runtime.shared.react.version must not contain leading or trailing whitespace.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: {} as Element,
        runtime: {
          shared: { react: { loaded: "yes" } } as never,
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp runtime.shared.react.loaded must be a boolean when provided.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: {} as Element,
        runtime: {
          shared: { react: { get: "load" } } as never,
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp runtime.shared.react.get must be a function when provided.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: {} as Element,
        runtime: { sharedPolicy: "strict" as never },
      }),
    ).rejects.toThrow(
      '[evjs] RemoteApp runtime.sharedPolicy must be "warn" or "error".',
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: {} as Element,
        runtime: { loadModule: "load" as never },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp runtime.loadModule must be a function when provided.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: {} as Element,
        runtime: { loadRemoteManifest: "load" as never },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp runtime.loadRemoteManifest must be a function when provided.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: {} as Element,
        runtime: { onRemoteSharedNegotiated: "negotiate" as never },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp runtime.onRemoteSharedNegotiated must be a function when provided.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: {} as Element,
        runtime: { onError: "handle" as never },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp runtime.onError must be a function when provided.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: "",
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp mount selector must be a non-empty string.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: " #remote-root ",
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp mount selector must not contain leading or trailing whitespace.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: 42 as never,
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp mount must be a selector string, Element, or function.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: (() => "remote-root") as never,
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp mount function must resolve to an Element or null.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: "#remote-root",
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp mount selector requires a browser document.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: "#remote-root",
        document: {} as never,
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp mount selector document.querySelector must be a function.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: "[",
        document: createRemoteAppDocument(),
      }),
    ).rejects.toThrow('[evjs] RemoteApp mount selector "[" is invalid');

    await expect(
      startRemoteAppRuntime({
        ...options,
        mount: "#remote-root",
        document: {
          querySelector() {
            return "remote-root";
          },
        } as never,
      }),
    ).rejects.toThrow(
      '[evjs] RemoteApp mount selector "#remote-root" must resolve to an Element or null.',
    );
  });

  it("validates remote app activation request objects before shell activation", async () => {
    const options = {
      remote: "crm",
      manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
      mount: {} as Element,
      runtime: {
        async loadRemoteManifest() {
          throw new Error("manifest should not be loaded");
        },
        async loadModule() {
          throw new Error("module should not be loaded");
        },
      },
    } satisfies Parameters<typeof startRemoteAppRuntime>[0];

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: [] as never,
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request must be a string, URL, or activation request object.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          appId: " ",
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request.appId must be a non-empty string.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          appId: "default",
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request must not include appId or pageId; RemoteApp always targets the configured remote.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          pageId: "customers",
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request must not include appId or pageId; RemoteApp always targets the configured remote.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          pageId: "customers/list",
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request.pageId must contain only letters, numbers, underscores, or hyphens.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          remoteId: "crm/main",
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request.remoteId must contain only letters, numbers, underscores, or hyphens.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          remoteId: "analytics",
        },
      }),
    ).rejects.toThrow(
      '[evjs] RemoteApp request.remoteId "analytics" must match configured remote "crm".',
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          remoteEntryId: " customers ",
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request.remoteEntryId must not contain leading or trailing whitespace.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          remoteEntryId: "customers/list",
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request.remoteEntryId must contain only letters, numbers, underscores, or hyphens.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          remoteEntryId: "customers",
          url: "/crm/customers",
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request must not include both remoteEntryId and url; use remoteEntryId for an explicit remote entry or url for activeWhen routing.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          buildId: "build.1",
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request.buildId must contain only letters, numbers, underscores, or hyphens.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          buildId: "stale",
        },
      }),
    ).rejects.toThrow(
      '[evjs] RemoteApp request.buildId "stale" must match generated host buildId "remote-app".',
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: "crm/customers",
      }),
    ).rejects.toThrow(
      '[evjs] RemoteApp request url must be an http(s) URL or pathname starting with "/".',
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          url: " /crm/customers ",
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request.url must not contain leading or trailing whitespace.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          url: "crm/customers",
        },
      }),
    ).rejects.toThrow(
      '[evjs] RemoteApp request.url must be an http(s) URL or pathname starting with "/".',
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          url: new URL("ftp://example.com/crm"),
        },
      }),
    ).rejects.toThrow(
      '[evjs] RemoteApp request.url must be an http(s) URL or pathname starting with "/".',
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          mountPoint: "#remote-root" as never,
        },
      }),
    ).rejects.toThrow(
      "[evjs] RemoteApp request.mountPoint must be an Element when provided.",
    );

    await expect(
      startRemoteAppRuntime({
        ...options,
        request: {
          hydrate: "true" as never,
        },
      }),
    ).rejects.toThrow("[evjs] RemoteApp request.hydrate must be a boolean.");
  });

  it("includes request mount point identity in remote host lifecycle keys", () => {
    const firstMountPoint = {} as Element;
    const secondMountPoint = {} as Element;
    const firstRequest = {
      remoteEntryId: "customers",
      mountPoint: firstMountPoint,
    };
    const matchingRequest = {
      remoteEntryId: "customers",
      mountPoint: firstMountPoint,
    };
    const nextRequest = {
      remoteEntryId: "customers",
      mountPoint: secondMountPoint,
    };

    expect(__getRemoteAppRequestKeyForTesting(firstRequest)).toBe(
      __getRemoteAppRequestKeyForTesting(matchingRequest),
    );
    expect(__getRemoteAppRequestKeyForTesting(firstRequest)).not.toBe(
      __getRemoteAppRequestKeyForTesting(nextRequest),
    );
    expect(
      __parseRemoteAppRequestKeyForTesting(
        __getRemoteAppRequestKeyForTesting(firstRequest),
      ),
    ).toMatchObject({
      remoteEntryId: "customers",
      mountPoint: firstMountPoint,
    });
  });

  it("preserves invalid request values in remote host lifecycle keys", () => {
    expect(
      __parseRemoteAppRequestKeyForTesting(
        __getRemoteAppRequestKeyForTesting(""),
      ),
    ).toBe("");

    expect(
      __parseRemoteAppRequestKeyForTesting(
        __getRemoteAppRequestKeyForTesting(null as never),
      ),
    ).toBeNull();

    expect(
      __parseRemoteAppRequestKeyForTesting(
        __getRemoteAppRequestKeyForTesting({
          remoteEntryId: "customers",
          mountPoint: "#remote-root" as never,
        }),
      ),
    ).toMatchObject({
      remoteEntryId: "customers",
      mountPoint: "#remote-root",
    });
  });

  it("reports unavailable or malformed remote manifest fetch responses", async () => {
    const manifestUrl = "https://cdn.example.com/remotes/crm/evjs-remote.json";

    vi.stubGlobal("fetch", undefined);
    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to load remote manifest "${manifestUrl}": fetch is not available.`,
    );

    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    fetch.mockResolvedValueOnce(null);
    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to load remote manifest "${manifestUrl}": fetch returned an invalid Response object.`,
    );

    fetch.mockResolvedValueOnce({});
    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to load remote manifest "${manifestUrl}": fetch response.ok must be a boolean.`,
    );

    fetch.mockResolvedValueOnce({ ok: false });
    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to load remote manifest "${manifestUrl}": fetch response.status must be a number when ok is false.`,
    );

    fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to load remote manifest "${manifestUrl}": fetch response.statusText must be a string when ok is false.`,
    );

    fetch.mockResolvedValueOnce(
      new Response("upstream unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );
    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to load remote manifest "${manifestUrl}": 503 Service Unavailable: upstream unavailable`,
    );

    fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );
    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to load remote manifest "${manifestUrl}": 502 Bad Gateway`,
    );

    fetch.mockResolvedValueOnce({ ok: true });
    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to load remote manifest "${manifestUrl}": fetch response.json must be a function.`,
    );

    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "Content-Type": "text/application/json" }),
      async json() {
        return {};
      },
    } as unknown as Response);

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to load remote manifest "${manifestUrl}": fetch response Content-Type must be "application/json"; received "text/application/json".`,
    );

    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      async json() {
        return {};
      },
    } as unknown as Response);

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to load remote manifest "${manifestUrl}": fetch response Content-Type must be "application/json"; received missing Content-Type.`,
    );
  });

  it("validates fetched remote manifests before shell activation", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const manifestUrl = "https://cdn.example.com/remotes/crm/evjs-remote.json";

    fetch.mockRejectedValueOnce(new TypeError("network offline"));

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to load remote manifest "${manifestUrl}": network offline`,
    );

    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          version: 1,
          name: "crm",
          entries: {
            customers: {
              assets: { js: ["crm.js"], css: [] },
              module: {
                type: "lifecycle",
                href: "crm.js",
              },
            },
          },
        }),
        {
          headers: { "Content-Type": "Application/JSON; charset=utf-8" },
        },
      ),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).resolves.toMatchObject({
      name: "crm",
      baseUrl: "https://cdn.example.com/remotes/crm/",
      entries: {
        customers: {
          module: {
            href: "crm.js",
          },
        },
      },
    });

    fetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "Content-Type": "application/json" }),
      async json() {
        throw new SyntaxError("Unexpected token <");
      },
    } as unknown as Response);

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Failed to parse remote manifest "${manifestUrl}" as JSON: Unexpected token <`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
            },
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.customers.module.href must be a non-empty string.`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: " customers.js ",
            },
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.customers.module.href must not contain leading or trailing whitespace.`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
            assets: {
              js: ["customers.js"],
              css: [" customers.css "],
            },
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.customers.assets.css item " customers.css " must not contain leading or trailing whitespace.`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        shared: {
          react: {
            requiredVersion: ">=19 <",
          },
        },
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" shared.react.requiredVersion must use supported version range syntax (examples: "19", "^19.0.0", ">=18 <20", or "^18 || ^19").`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {},
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries must declare at least one remote entry.`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        baseUrl: "/assets/crm/",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).resolves.toMatchObject({
      baseUrl: "https://cdn.example.com/assets/crm/",
      entries: {
        customers: {
          module: {
            href: "customers.js",
          },
        },
      },
    });

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "http://[",
            },
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.customers.module.href must be an http(s) URL resolvable from baseUrl "https://cdn.example.com/remotes/crm/".`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "javascript:alert(1)",
            },
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.customers.module.href must be an http(s) URL resolvable from baseUrl "https://cdn.example.com/remotes/crm/".`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
            assets: {
              js: ["customers.js"],
              css: ["data:text/css,body{}"],
            },
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.customers.assets.css must be an http(s) URL resolvable from baseUrl "https://cdn.example.com/remotes/crm/".`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        baseUrl: "ftp://cdn.example.com/remotes/crm/",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" baseUrl must be an http(s) URL resolvable from manifest URL "${manifestUrl}".`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm/main",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" name must contain only letters, numbers, underscores, or hyphens.`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          "customers/list": {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries key "customers/list" must contain only letters, numbers, underscores, or hyphens.`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
            activeWhen: ["crm/*"],
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.customers.activeWhen pattern "crm/*" must start with "/".`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
            activeWhen: ["/crm page/*"],
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.customers.activeWhen pattern "/crm page/*" must not contain whitespace.`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
            activeWhen: ["/crm/*?preview=1"],
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.customers.activeWhen pattern "/crm/*?preview=1" must not include a query string or hash.`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
            activeWhen: ["/crm/*#main"],
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.customers.activeWhen pattern "/crm/*#main" must not include a query string or hash.`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
            activeWhen: [],
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.customers.activeWhen must contain at least one path.`,
    );

    fetch.mockResolvedValueOnce(
      Response.json({
        version: 1,
        name: "crm",
        entries: {
          customers: {
            module: {
              type: "lifecycle",
              href: "customers.js",
            },
            activeWhen: ["/crm/*"],
          },
          orders: {
            module: {
              type: "lifecycle",
              href: "orders.js",
            },
            activeWhen: ["/crm/*"],
          },
        },
      }),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).rejects.toThrow(
      `[evjs] Remote manifest "${manifestUrl}" entries.orders.activeWhen duplicates entries.customers.activeWhen pattern "/crm/*". Remote entry activeWhen patterns must be unique.`,
    );
  });

  it("normalizes fetched remote manifests to the validated runtime shape", async () => {
    const manifestUrl = "https://cdn.example.com/remotes/crm/evjs-remote.json";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          version: 1,
          name: "crm",
          baseUrl: "assets/",
          ignored: "root",
          shared: {
            react: {
              shareKey: "react",
              requiredVersion: "^19.0.0",
              singleton: true,
              strictVersion: false,
              eager: false,
              ignored: "shared",
            },
          },
          entries: {
            customers: {
              ignored: "entry",
              assets: {
                js: ["customers.js"],
                css: ["customers.css"],
                ignored: ["asset"],
              },
              module: {
                type: "lifecycle",
                href: "customers.js",
                source: "./src/Customers.tsx",
                ignored: "module",
              },
              activeWhen: ["/crm/*"],
              mount: "#crm",
            },
            dashboard: {
              module: {
                type: "react-component",
                href: "dashboard.js",
              },
            },
          },
        }),
      ),
    );

    await expect(
      defaultLoadRemoteManifest({ manifest: manifestUrl }),
    ).resolves.toEqual({
      version: 1,
      name: "crm",
      baseUrl: "https://cdn.example.com/remotes/crm/assets/",
      shared: {
        react: {
          shareKey: "react",
          requiredVersion: "^19.0.0",
          singleton: true,
          strictVersion: false,
          eager: false,
        },
      },
      entries: {
        customers: {
          assets: {
            js: ["customers.js"],
            css: ["customers.css"],
          },
          module: {
            type: "lifecycle",
            href: "customers.js",
          },
          activeWhen: ["/crm/*"],
          mount: "#crm",
        },
        dashboard: {
          module: {
            type: "react-component",
            href: "dashboard.js",
          },
        },
      },
    });
  });

  it("starts a remote app with manifest loading and shared negotiation", async () => {
    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html",
      hostname: "localhost",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          version: 1,
          name: "crm",
          baseUrl: "https://assets.example.com/crm/",
          shared: {
            "remote-react": {
              shareKey: "react",
              requiredVersion: ">=19 <20",
              singleton: true,
            },
          },
          entries: {
            customers: {
              module: {
                type: "lifecycle",
                href: "crm-customers.js",
              },
              activeWhen: ["/crm/*"],
            },
          },
        }),
      ),
    );
    const events: string[] = [];

    const controller = await startRemoteAppRuntime({
      remote: "crm",
      manifest: "http://localhost:3002/evjs-remote.json",
      activeWhen: "/crm/*",
      request: "/crm/customers",
      mount: {} as Element,
      runtime: {
        shared: {
          react: {
            version: "19.2.5",
            singleton: true,
            value: { createElement: true },
          },
        },
        async loadModule(href, ctx) {
          events.push(`load:${href}`);
          events.push(`base:${ctx.remote?.manifest.baseUrl}`);
          return {
            mount() {
              events.push("mount");
            },
          };
        },
        onRemoteSharedNegotiated(event) {
          events.push(`shared:${formatRemoteSharedNegotiation(event)}`);
        },
      },
    });

    await controller.dispose();

    expect(events).toEqual([
      "shared:crm: remote-react -> 19.2.5",
      "load:http://localhost:3002/crm-customers.js",
      "base:http://localhost:3002/",
      "mount",
    ]);
  });

  it("defaults object activation requests to the configured remote", async () => {
    vi.stubGlobal("location", {
      href: "http://localhost:3000/remote.html",
      hostname: "localhost",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          version: 1,
          name: "crm",
          entries: {
            customers: {
              module: {
                type: "lifecycle",
                href: "crm-customers.js",
              },
            },
          },
        }),
      ),
    );
    const events: string[] = [];

    const controller = await startRemoteAppRuntime({
      remote: "crm",
      manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
      request: {
        remoteEntryId: "customers",
      },
      mount: {} as Element,
      runtime: {
        async loadModule(href, ctx) {
          events.push(`load:${ctx.remote?.id}:${ctx.remote?.entryId}:${href}`);
          return {
            mount() {
              events.push("mount");
            },
          };
        },
      },
    });

    await controller.dispose();

    expect(events).toEqual([
      "load:crm:customers:https://cdn.example.com/remotes/crm/crm-customers.js",
      "mount",
    ]);
  });

  it("rejects remote app manifests whose name does not match the configured remote", async () => {
    const loadModule = vi.fn(async () => ({
      mount() {},
    }));

    await expect(
      startRemoteAppRuntime({
        remote: "crm",
        manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
        request: {
          remoteEntryId: "customers",
        },
        mount: {} as Element,
        runtime: {
          async loadRemoteManifest() {
            return {
              version: 1,
              name: "analytics",
              baseUrl: "https://cdn.example.com/remotes/analytics/",
              entries: {
                customers: {
                  module: {
                    type: "lifecycle",
                    href: "crm-customers.js",
                  },
                },
              },
            };
          },
          loadModule,
        },
      }),
    ).rejects.toThrow(
      '[evjs] Remote "crm" loaded manifest "https://cdn.example.com/remotes/crm/evjs-remote.json" with name "analytics". Remote manifest name must match the host manifest remote id.',
    );

    expect(loadModule).not.toHaveBeenCalled();
  });

  it("adapts react-component remote entries from default React exports", async () => {
    function RemoteDashboard() {
      return null;
    }

    vi.stubGlobal("location", {
      href: "https://host.example.com/remote.html",
      hostname: "host.example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          version: 1,
          name: "crm",
          entries: {
            dashboard: {
              module: {
                type: "react-component",
                href: "dashboard.js",
              },
            },
          },
        }),
      ),
    );
    const events: string[] = [];

    const controller = await startRemoteAppRuntime({
      remote: "crm",
      manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
      request: {
        remoteEntryId: "dashboard",
      },
      mount: {} as Element,
      runtime: {
        async loadModule(href, ctx) {
          events.push(`load:${ctx.remote?.entry.module.type}:${href}`);
          return { default: RemoteDashboard };
        },
      },
    });
    await controller.dispose();

    expect(events).toEqual([
      "load:react-component:https://cdn.example.com/remotes/crm/dashboard.js",
    ]);
    expect(reactDomCalls).toEqual(["createRoot", "render", "unmount"]);
    expect(reactDomElements[0]).toMatchObject({
      props: {
        component: RemoteDashboard,
        remote: {
          id: "crm",
          name: "crm",
          entryId: "dashboard",
        },
        request: {
          remoteEntryId: "dashboard",
          remoteId: "crm",
          hydrate: false,
        },
      },
    });
  });

  it("keeps react-component remote entries on the client mount path", async () => {
    function RemoteDashboard() {
      return null;
    }

    vi.stubGlobal("location", {
      href: "https://host.example.com/remote.html",
      hostname: "host.example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          version: 1,
          name: "crm",
          entries: {
            dashboard: {
              module: {
                type: "react-component",
                href: "dashboard.js",
              },
            },
          },
        }),
      ),
    );

    const controller = await startRemoteAppRuntime({
      remote: "crm",
      manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
      request: {
        remoteEntryId: "dashboard",
        hydrate: true,
      },
      mount: {} as Element,
      runtime: {
        async loadModule() {
          return { default: RemoteDashboard };
        },
      },
    });
    await controller.dispose();

    expect(reactDomCalls).toEqual(["createRoot", "render", "unmount"]);
    expect(reactDomElements[0]).toMatchObject({
      props: {
        component: RemoteDashboard,
        request: {
          remoteEntryId: "dashboard",
          remoteId: "crm",
          hydrate: true,
        },
      },
    });
  });

  it("reports lifecycle remote modules without render hooks as load errors", async () => {
    vi.stubGlobal("location", {
      href: "https://host.example.com/remote.html",
      hostname: "host.example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          version: 1,
          name: "crm",
          entries: {
            customers: {
              module: {
                type: "lifecycle",
                href: "customers.js",
              },
            },
          },
        }),
      ),
    );
    const events: string[] = [];

    await expect(
      startRemoteAppRuntime({
        remote: "crm",
        manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
        request: {
          remoteEntryId: "customers",
        },
        mount: {} as Element,
        runtime: {
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
        },
      }),
    ).rejects.toThrow(
      '[evjs] Shell remote module "https://cdn.example.com/remotes/crm/customers.js" must export mount or hydrate to render.',
    );

    expect(events).toEqual([
      "load:https://cdn.example.com/remotes/crm/customers.js",
      '[evjs] Shell remote module "https://cdn.example.com/remotes/crm/customers.js" must export mount or hydrate to render.:load:remote:customers',
    ]);
  });

  it("reports malformed react-component remote modules as load errors", async () => {
    vi.stubGlobal("location", {
      href: "https://host.example.com/remote.html",
      hostname: "host.example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          version: 1,
          name: "crm",
          entries: {
            dashboard: {
              module: {
                type: "react-component",
                href: "dashboard.js",
              },
            },
          },
        }),
      ),
    );
    const events: string[] = [];

    await expect(
      startRemoteAppRuntime({
        remote: "crm",
        manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
        request: {
          remoteEntryId: "dashboard",
        },
        mount: {} as Element,
        runtime: {
          async loadModule() {
            return {} as never;
          },
          onError(error, ctx) {
            events.push(
              `${error instanceof Error ? error.message : "unknown"}:${ctx.phase}:${ctx.app.kind}:${ctx.app.remote?.entryId}`,
            );
          },
        },
      }),
    ).rejects.toThrow(
      "[evjs] Remote modules must export a default React component or lifecycle functions.",
    );

    expect(events).toEqual([
      "[evjs] Remote modules must export a default React component or lifecycle functions.:load:remote:dashboard",
    ]);

    events.length = 0;
    await expect(
      startRemoteAppRuntime({
        remote: "crm",
        manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
        request: {
          remoteEntryId: "dashboard",
        },
        mount: {} as Element,
        runtime: {
          async loadModule() {
            return {
              default: "not-a-component",
            } as never;
          },
          onError(error, ctx) {
            events.push(
              `${error instanceof Error ? error.message : "unknown"}:${ctx.phase}:${ctx.app.kind}:${ctx.app.remote?.entryId}`,
            );
          },
        },
      }),
    ).rejects.toThrow(
      "[evjs] Remote module default export must be a React component.",
    );

    expect(events).toEqual([
      "[evjs] Remote module default export must be a React component.:load:remote:dashboard",
    ]);

    function RemoteDashboard() {
      return null;
    }

    events.length = 0;
    await expect(
      startRemoteAppRuntime({
        remote: "crm",
        manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
        request: {
          remoteEntryId: "dashboard",
        },
        mount: {} as Element,
        runtime: {
          async loadModule() {
            return {
              default: RemoteDashboard,
              init: "not-callable",
            } as never;
          },
          onError(error, ctx) {
            events.push(
              `${error instanceof Error ? error.message : "unknown"}:${ctx.phase}:${ctx.app.kind}:${ctx.app.remote?.entryId}`,
            );
          },
        },
      }),
    ).rejects.toThrow(
      "[evjs] Remote module init export must be a function when provided.",
    );

    expect(events).toEqual([
      "[evjs] Remote module init export must be a function when provided.:load:remote:dashboard",
    ]);
    expect(reactDomCalls).toEqual([]);
  });

  it("derives remote asset baseUrl from a CDN manifest URL when omitted", async () => {
    vi.stubGlobal("location", {
      href: "https://host.example.com/remote.html",
      hostname: "host.example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          version: 1,
          name: "crm",
          entries: {
            customers: {
              module: {
                type: "lifecycle",
                href: "crm-customers.js",
              },
              activeWhen: ["/crm/*"],
            },
          },
        }),
      ),
    );
    const events: string[] = [];

    const controller = await startRemoteAppRuntime({
      remote: "crm",
      manifest: "https://cdn.example.com/remotes/crm/evjs-remote.json",
      activeWhen: "/crm/*",
      request: "/crm/customers",
      mount: {} as Element,
      runtime: {
        async loadModule(href, ctx) {
          events.push(`load:${href}`);
          events.push(`base:${ctx.remote?.manifest.baseUrl}`);
          return {
            mount() {
              events.push("mount");
            },
          };
        },
      },
    });

    await controller.dispose();

    expect(events).toEqual([
      "load:https://cdn.example.com/remotes/crm/crm-customers.js",
      "base:https://cdn.example.com/remotes/crm/",
      "mount",
    ]);
  });
});

function createRemoteAppDocument(): Document {
  const mountPoint = {} as Element;
  return {
    querySelector(selector: string) {
      if (selector === "[") {
        throw new SyntaxError("Invalid selector");
      }
      return selector === "#remote-root" ? mountPoint : null;
    },
  } as Document;
}
