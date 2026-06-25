import type { BuildOutput } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startPageRuntime } from "../src/internal";
import {
  __resetForTesting,
  callServer,
  initTransport,
} from "../src/transport-runtime.js";

afterEach(() => {
  __resetForTesting();
  vi.unstubAllGlobals();
});

describe("startPageRuntime", () => {
  it("boots the shell from framework HTML attributes and an embedded manifest", async () => {
    const events: string[] = [];
    const mountPoint = {} as Element;
    const manifest = createManifest();
    const document = createDocument({
      manifest,
      mountPoint,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-build": "test",
      },
    });

    const shell = await startPageRuntime({
      document,
      async loadModule(href, ctx) {
        events.push(`load:${href}`);
        return {
          hydrate(target) {
            events.push(
              `hydrate:${ctx.kind}:${ctx.id}:${target === mountPoint}`,
            );
          },
        };
      },
    });

    await shell.dispose();

    expect(events).toEqual(["load:/home.js", "hydrate:page:home:true"]);
  });

  it("fetches the manifest when it is not embedded", async () => {
    const events: string[] = [];
    const mountPoint = {} as Element;
    const document = createDocument({
      mountPoint,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-manifest": "/assets/manifest.json",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(createManifest())),
    );

    await startPageRuntime({
      document,
      async loadModule(href) {
        events.push(`load:${href}`);
        return {
          mount() {
            events.push("mount");
          },
        };
      },
    });

    expect(fetch).toHaveBeenCalledWith("/assets/manifest.json");
    expect(events).toEqual(["load:/home.js", "mount"]);
  });

  it("rejects invalid framework HTML target attributes before manifest loading", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startPageRuntime({
        document: {
          documentElement: null,
          getElementById() {
            return null;
          },
          querySelector() {
            return null;
          },
        } as unknown as Document,
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() document.documentElement must include data-evjs-kind and data-evjs-id attributes.",
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "worker",
            "data-evjs-id": "jobs",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] startPageRuntime() data-evjs-kind must be "app" or "page".',
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "page",
          },
        }),
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() data-evjs-id must be a non-empty app/page id.",
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "page",
            "data-evjs-id": " home ",
          },
        }),
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() data-evjs-id must not include leading or trailing whitespace.",
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "page",
            "data-evjs-id": "home.page",
          },
        }),
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() data-evjs-id must contain only letters, numbers, underscores, or hyphens.",
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports malformed embedded manifests with an evjs error", async () => {
    const document = createDocument({
      embeddedManifestText: "{",
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to parse embedded manifest "__EVJS_MANIFEST__" as JSON',
    );
  });

  it("reports invalid embedded manifest script text with an evjs error", async () => {
    const document = createDocument({
      embeddedManifestText: 42,
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Embedded manifest "__EVJS_MANIFEST__" textContent must be a string when provided.',
    );
  });

  it("reports malformed fetched manifests with an evjs error", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-manifest": "/assets/manifest.json",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to parse manifest "/assets/manifest.json" as JSON',
    );
  });

  it("rejects invalid manifest URL attributes before fetching", async () => {
    await expect(
      startPageRuntime({
        document: createDocument({
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "page",
            "data-evjs-id": "home",
            "data-evjs-manifest": "",
          },
        }),
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() data-evjs-manifest must be a non-empty manifest URL.",
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "page",
            "data-evjs-id": "home",
            "data-evjs-manifest": " /assets/manifest.json ",
          },
        }),
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() data-evjs-manifest must not include leading or trailing whitespace.",
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "page",
            "data-evjs-id": "home",
            "data-evjs-manifest": "javascript:alert(1)",
          },
        }),
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() data-evjs-manifest must be an http(s) URL or path.",
    );
  });

  it("reports failed manifest fetches with an evjs error", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-manifest": "/assets/manifest.json",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network offline");
      }),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": network offline',
    );
  });

  it("reports missing fetch support for manifest loading", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-manifest": "/assets/manifest.json",
      },
    });
    vi.stubGlobal("fetch", undefined);

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": fetch is not available.',
    );
  });

  it("reports invalid manifest fetch response objects with an evjs error", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-manifest": "/assets/manifest.json",
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => null),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": fetch returned an invalid Response object.',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: "yes",
        json: async () => createManifest(),
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": fetch response.ok must be a boolean.',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        statusText: "Service Unavailable",
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": fetch response.status must be a number when ok is false.',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": fetch response.statusText must be a string when ok is false.',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": fetch response.json must be a function.',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "Content-Type": "text/application/json" }),
        json: async () => createManifest(),
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": fetch response Content-Type must be "application/json"; received "text/application/json".',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers(),
        json: async () => createManifest(),
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": fetch response Content-Type must be "application/json"; received missing Content-Type.',
    );
  });

  it("reports failed manifest HTTP responses without requiring a JSON parser", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-manifest": "/assets/manifest.json",
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": 503 Service Unavailable',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("deployment manifest missing", {
            status: 503,
            statusText: "Service Unavailable",
          }),
      ),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": 503 Service Unavailable: deployment manifest missing',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 502,
            statusText: "Bad Gateway",
          }),
      ),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load manifest "/assets/manifest.json": 502 Bad Gateway',
    );
  });

  it("reports invalid loaded manifest shapes with an evjs error", async () => {
    const document = createDocument({
      embeddedManifestText: "[]",
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Loaded embedded manifest "__EVJS_MANIFEST__" must be a JSON object.',
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          embeddedManifestText: JSON.stringify({
            ...createManifest(),
            version: 2,
          }),
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "page",
            "data-evjs-id": "home",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] Loaded embedded manifest "__EVJS_MANIFEST__" version must be 1.',
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          embeddedManifestText: JSON.stringify({
            ...createManifest(),
            pages: [],
          }),
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "page",
            "data-evjs-id": "home",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] Loaded embedded manifest "__EVJS_MANIFEST__" pages must be an object.',
    );
  });

  it("reports invalid explicit manifest options with an evjs error", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await expect(
      startPageRuntime({ document, manifest: null as never }),
    ).rejects.toThrow("[evjs] Loaded provided manifest must be a JSON object.");

    await expect(
      startPageRuntime({
        document,
        manifest: {
          ...createManifest(),
          buildId: "build.1",
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided manifest.buildId must contain only letters, numbers, underscores, or hyphens.",
    );

    await expect(
      startPageRuntime({
        document,
        manifest: {
          ...createManifest(),
          publicPath: { mode: "asset" },
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided manifest.publicPath must be a non-empty string.",
    );

    await expect(
      startPageRuntime({
        document,
        manifest: {
          ...createManifest(),
          assets: [],
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided manifest.assets must be an object.",
    );

    await expect(
      startPageRuntime({
        document,
        manifest: {
          ...createManifest(),
          pages: {
            home: {
              ...createManifest().pages.home,
              module: { type: "lifecycle", href: " /home.js " },
            },
          },
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided manifest.pages.home.module.href must not contain leading or trailing whitespace.",
    );

    await expect(
      startPageRuntime({
        document,
        manifest: {
          ...createManifest(),
          pages: {
            home: {
              ...createManifest().pages.home,
              rendering: {
                component: "server",
                html: "server",
                streaming: false,
                hydrate: "viewport",
              },
            },
          },
        } as never,
      }),
    ).rejects.toThrow(
      '[evjs] Loaded provided manifest.pages.home.rendering.hydrate must be "none", "load", "visible", or "idle".',
    );

    await expect(
      startPageRuntime({
        document,
        manifest: {
          ...createManifest(),
          runtime: { ...createManifest().runtime, transport: [] },
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided manifest.runtime.transport must be an object.",
    );

    await expect(
      startPageRuntime({
        document,
        manifest: {
          ...createManifest(),
          runtime: {
            ...createManifest().runtime,
            transport: { baseUrl: "http://[::1" },
          },
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided manifest.runtime.transport.baseUrl must be a valid URL string.",
    );

    await expect(
      startPageRuntime({
        document,
        manifest: {
          ...createManifest(),
          apps: [],
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided manifest apps must be an object.",
    );

    await expect(
      startPageRuntime({
        document,
        manifest: {
          ...createManifest(),
          routes: {},
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided manifest routes must be an array.",
    );

    await expect(
      startPageRuntime({
        document,
        manifest: {
          ...createManifest(),
          routes: [{ id: "home", path: "home", pageId: "home" }],
        } as never,
      }),
    ).rejects.toThrow(
      '[evjs] Loaded provided manifest.routes[0].path must start with "/".',
    );
  });

  it("rejects invalid page runtime options before activation", async () => {
    await expect(startPageRuntime(null as never)).rejects.toThrow(
      "[evjs] startPageRuntime() options must be an object.",
    );
    await expect(startPageRuntime({ manifestUrl: "" })).rejects.toThrow(
      "[evjs] startPageRuntime() manifestUrl must be a non-empty string.",
    );
    await expect(
      startPageRuntime({ manifestUrl: " /manifest.json" }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() manifestUrl must not include leading or trailing whitespace.",
    );
    await expect(
      startPageRuntime({ manifestUrl: "javascript:alert(1)" }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() manifestUrl must be an http(s) URL or path.",
    );
    await expect(startPageRuntime({ mount: "" })).rejects.toThrow(
      "[evjs] startPageRuntime() mount must be a non-empty selector string.",
    );
    await expect(startPageRuntime({ mount: 42 as never })).rejects.toThrow(
      "[evjs] startPageRuntime() mount must be a selector string or Element.",
    );
    await expect(
      startPageRuntime({ loadModule: "load" as never }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() loadModule must be a function.",
    );
  });

  it("rejects missing or invalid document options with an evjs error", async () => {
    await expect(startPageRuntime()).rejects.toThrow(
      "[evjs] startPageRuntime() document must be available or provided.",
    );
    await expect(startPageRuntime({ document: {} as never })).rejects.toThrow(
      "[evjs] startPageRuntime() document.getElementById must be a function.",
    );
    await expect(
      startPageRuntime({
        document: { getElementById() {} } as never,
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() document.querySelector must be a function.",
    );
    await expect(
      startPageRuntime({
        document: {
          documentElement: {},
          getElementById() {},
          querySelector() {
            return null;
          },
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() document.documentElement.getAttribute must be a function when documentElement is provided.",
    );
  });

  it("reports invalid custom mount selectors with an evjs error", async () => {
    const document = createDocument({
      manifest: createManifest(),
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await expect(
      startPageRuntime({
        document,
        mount: "[",
        async loadModule() {
          return {
            mount() {},
          };
        },
      }),
    ).rejects.toThrow(
      '[evjs] startPageRuntime() mount selector "[" is invalid',
    );
  });

  it("reports unresolved custom mount selectors with an evjs error", async () => {
    const document = createDocument({
      manifest: createManifest(),
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await expect(
      startPageRuntime({
        document,
        mount: "#missing-root",
        async loadModule() {
          return {
            mount() {},
          };
        },
      }),
    ).rejects.toThrow(
      '[evjs] startPageRuntime() mount selector "#missing-root" did not match an Element.',
    );
  });

  it("reports invalid custom mount selector results with an evjs error", async () => {
    const document = {
      ...createDocument({
        manifest: createManifest(),
        mountPoint: {} as Element,
        attributes: {
          "data-evjs-kind": "page",
          "data-evjs-id": "home",
        },
      }),
      querySelector(selector: string) {
        return selector === "#root" ? "root" : null;
      },
    } as unknown as Document;

    await expect(
      startPageRuntime({
        document,
        async loadModule() {
          return {
            mount() {},
          };
        },
      }),
    ).rejects.toThrow(
      '[evjs] startPageRuntime() mount selector "#root" must resolve to an Element or null.',
    );
  });

  it("initializes HTTP transport from manifest runtime metadata", async () => {
    const mountPoint = {} as Element;
    const manifest = createManifest();
    manifest.runtime.transport = {
      baseUrl: "https://api.example.com/framework",
    };
    const document = createDocument({
      manifest,
      mountPoint,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: async () => ({ result: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "/__evjs/fn");

    await startPageRuntime({
      document,
      async loadModule() {
        return {
          mount() {},
        };
      },
    });
    await callServer("fn", []);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://api.example.com/__evjs/fn"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not override an application-provided transport adapter", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ adapter: { send } });
    const mountPoint = {} as Element;
    const manifest = createManifest();
    manifest.runtime.transport = {
      baseUrl: "https://api.example.com/framework",
    };
    const document = createDocument({
      manifest,
      mountPoint,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await startPageRuntime({
      document,
      async loadModule() {
        return {
          mount() {},
        };
      },
    });
    await callServer("fn", []);

    expect(send).toHaveBeenCalledWith("fn", [], undefined);
  });
});

function createManifest(): BuildOutput {
  return {
    version: 1,
    buildId: "test",
    distDir: "dist",
    publicPath: "/",
    runtime: {
      server: {
        basePath: "/__evjs",
        fn: "/__evjs/fn",
      },
    },
    assets: {},
    apps: {},
    pages: {
      home: {
        assets: { js: ["home.js"], css: [] },
        render: "ssr",
        rendering: {
          component: "server",
          html: "server",
          streaming: false,
          hydrate: "load",
        },
        mount: "#root",
        module: {
          type: "lifecycle",
          href: "/home.js",
        },
      },
    },
    routes: [],
    server: {
      assets: { js: [], css: [] },
      functions: {},
      routes: [],
    },
  };
}

function createDocument(options: {
  manifest?: BuildOutput;
  embeddedManifestText?: unknown;
  mountPoint: Element;
  attributes: Record<string, string>;
}): Document {
  return {
    documentElement: {
      getAttribute(name: string) {
        return options.attributes[name] ?? null;
      },
    },
    getElementById(id: string) {
      if (id !== "__EVJS_MANIFEST__") return null;
      if (options.embeddedManifestText !== undefined) {
        return {
          textContent: options.embeddedManifestText,
        };
      }
      if (!options.manifest) return null;
      return {
        textContent: JSON.stringify(options.manifest),
      };
    },
    querySelector(selector: string) {
      if (selector === "[") {
        throw new SyntaxError("Invalid selector");
      }
      return selector === "#root" ? options.mountPoint : null;
    },
    location: {
      href: "https://example.com/home",
    },
  } as Document;
}
