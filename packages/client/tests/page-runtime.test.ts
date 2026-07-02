import { afterEach, describe, expect, it, vi } from "vitest";
import { startPageRuntime } from "../src/internal";
import {
  __resetForTesting,
  callServer,
  initTransport,
} from "../src/server-functions/transport-runtime.js";
import type {
  ClientRuntime,
  ClientRuntimePage,
  ClientRuntimeRoute,
} from "../src/shared/runtime-config.js";

afterEach(() => {
  __resetForTesting();
  vi.unstubAllGlobals();
});

describe("startPageRuntime", () => {
  it("boots the shell from framework HTML attributes and an embedded runtime", async () => {
    const events: string[] = [];
    const mountPoint = {} as Element;
    const runtime = createRuntime();
    const document = createDocument({
      runtime,
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

  it("fetches the runtime when it is not embedded", async () => {
    const events: string[] = [];
    const mountPoint = {} as Element;
    const document = createDocument({
      mountPoint,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-runtime": "/assets/runtime.json",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(createRuntime())),
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

    expect(fetch).toHaveBeenCalledWith("/assets/runtime.json");
    expect(events).toEqual(["load:/home.js", "mount"]);
  });

  it("rejects invalid framework HTML target attributes before runtime loading", async () => {
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

  it("reports malformed embedded runtimes with an evjs error", async () => {
    const document = createDocument({
      embeddedRuntimeText: "{",
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to parse embedded runtime "__EVJS_CLIENT_RUNTIME__" as JSON',
    );
  });

  it("reports invalid embedded runtime script text with an evjs error", async () => {
    const document = createDocument({
      embeddedRuntimeText: 42,
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Embedded runtime "__EVJS_CLIENT_RUNTIME__" textContent must be a string when provided.',
    );
  });

  it("reports malformed fetched runtimes with an evjs error", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-runtime": "/assets/runtime.json",
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
      '[evjs] Failed to parse runtime "/assets/runtime.json" as JSON',
    );
  });

  it("rejects invalid runtime URL attributes before fetching", async () => {
    await expect(
      startPageRuntime({
        document: createDocument({
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "page",
            "data-evjs-id": "home",
            "data-evjs-runtime": "",
          },
        }),
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() data-evjs-runtime must be a non-empty runtime URL.",
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "page",
            "data-evjs-id": "home",
            "data-evjs-runtime": " /assets/runtime.json ",
          },
        }),
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() data-evjs-runtime must not include leading or trailing whitespace.",
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          mountPoint: {} as Element,
          attributes: {
            "data-evjs-kind": "page",
            "data-evjs-id": "home",
            "data-evjs-runtime": "javascript:alert(1)",
          },
        }),
      }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() data-evjs-runtime must be an http(s) URL or path.",
    );
  });

  it("reports failed runtime fetches with an evjs error", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-runtime": "/assets/runtime.json",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network offline");
      }),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load runtime "/assets/runtime.json": network offline',
    );
  });

  it("reports missing fetch support for runtime loading", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-runtime": "/assets/runtime.json",
      },
    });
    vi.stubGlobal("fetch", undefined);

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load runtime "/assets/runtime.json": fetch is not available.',
    );
  });

  it("reports invalid runtime fetch response objects with an evjs error", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-runtime": "/assets/runtime.json",
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => null),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load runtime "/assets/runtime.json": fetch returned an invalid Response object.',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: "yes",
        json: async () => createRuntime(),
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load runtime "/assets/runtime.json": fetch response.ok must be a boolean.',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        statusText: "Service Unavailable",
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load runtime "/assets/runtime.json": fetch response.status must be a number when ok is false.',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load runtime "/assets/runtime.json": fetch response.statusText must be a string when ok is false.',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load runtime "/assets/runtime.json": fetch response.json must be a function.',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "Content-Type": "text/application/json" }),
        json: async () => createRuntime(),
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load runtime "/assets/runtime.json": fetch response Content-Type must be "application/json"; received "text/application/json".',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers(),
        json: async () => createRuntime(),
      })),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load runtime "/assets/runtime.json": fetch response Content-Type must be "application/json"; received missing Content-Type.',
    );
  });

  it("reports failed runtime HTTP responses without requiring a JSON parser", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
        "data-evjs-runtime": "/assets/runtime.json",
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
      '[evjs] Failed to load runtime "/assets/runtime.json": 503 Service Unavailable',
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("deployment runtime missing", {
            status: 503,
            statusText: "Service Unavailable",
          }),
      ),
    );

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Failed to load runtime "/assets/runtime.json": 503 Service Unavailable: deployment runtime missing',
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
      '[evjs] Failed to load runtime "/assets/runtime.json": 502 Bad Gateway',
    );
  });

  it("reports invalid loaded runtime shapes with an evjs error", async () => {
    const document = createDocument({
      embeddedRuntimeText: "[]",
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await expect(startPageRuntime({ document })).rejects.toThrow(
      '[evjs] Loaded embedded runtime "__EVJS_CLIENT_RUNTIME__" must be a JSON object.',
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          embeddedRuntimeText: JSON.stringify({
            ...createRuntime(),
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
      '[evjs] Loaded embedded runtime "__EVJS_CLIENT_RUNTIME__" version must be 1.',
    );

    await expect(
      startPageRuntime({
        document: createDocument({
          embeddedRuntimeText: JSON.stringify({
            ...createRuntime(),
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
      '[evjs] Loaded embedded runtime "__EVJS_CLIENT_RUNTIME__".pages must be an object.',
    );
  });

  it("reports invalid explicit runtime options with an evjs error", async () => {
    const document = createDocument({
      mountPoint: {} as Element,
      attributes: {
        "data-evjs-kind": "page",
        "data-evjs-id": "home",
      },
    });

    await expect(
      startPageRuntime({ document, runtime: null as never }),
    ).rejects.toThrow("[evjs] Loaded provided runtime must be a JSON object.");

    await expect(
      startPageRuntime({
        document,
        runtime: {
          ...createRuntime(),
          buildId: "build.1",
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided runtime.buildId must contain only letters, numbers, underscores, or hyphens.",
    );

    await expect(
      startPageRuntime({
        document,
        runtime: {
          ...createRuntime(),
          pages: {
            home: {
              ...createRuntime().pages.home,
              module: { type: "lifecycle", href: " /home.js " },
            },
          },
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided runtime.pages.home.module.href must not contain leading or trailing whitespace.",
    );

    await expect(
      startPageRuntime({
        document,
        runtime: {
          ...createRuntime(),
          runtime: { ...createRuntime().runtime, transport: [] },
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided runtime.runtime.transport must be an object.",
    );

    await expect(
      startPageRuntime({
        document,
        runtime: {
          ...createRuntime(),
          runtime: {
            ...createRuntime().runtime,
            transport: { baseUrl: "http://[::1" },
          },
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided runtime.runtime.transport.baseUrl must be a valid URL string.",
    );

    await expect(
      startPageRuntime({
        document,
        runtime: {
          ...createRuntime(),
          app: [],
        } as never,
      }),
    ).rejects.toThrow("[evjs] Loaded provided runtime app must be an object.");

    await expect(
      startPageRuntime({
        document,
        runtime: {
          ...createRuntime(),
          routes: {},
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] Loaded provided runtime.routes must be an array.",
    );

    await expect(
      startPageRuntime({
        document,
        runtime: {
          ...createRuntime(),
          routes: [{ id: "home", path: "home", pageId: "home" }],
        } as never,
      }),
    ).rejects.toThrow(
      '[evjs] Loaded provided runtime.routes[0].path must start with "/".',
    );
  });

  it("rejects invalid page runtime options before activation", async () => {
    await expect(startPageRuntime(null as never)).rejects.toThrow(
      "[evjs] startPageRuntime() options must be an object.",
    );
    await expect(startPageRuntime({ runtimeUrl: "" })).rejects.toThrow(
      "[evjs] startPageRuntime() runtimeUrl must be a non-empty string.",
    );
    await expect(
      startPageRuntime({ runtimeUrl: " /runtime.json" }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() runtimeUrl must not include leading or trailing whitespace.",
    );
    await expect(
      startPageRuntime({ runtimeUrl: "javascript:alert(1)" }),
    ).rejects.toThrow(
      "[evjs] startPageRuntime() runtimeUrl must be an http(s) URL or path.",
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
      runtime: createRuntime(),
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
      runtime: createRuntime(),
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
        runtime: createRuntime(),
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

  it("initializes HTTP transport from runtime runtime metadata", async () => {
    const mountPoint = {} as Element;
    const runtime = createRuntime();
    runtime.runtime.transport = {
      baseUrl: "https://api.example.com/framework",
    };
    const document = createDocument({
      runtime,
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
    vi.stubGlobal("__EVJS_FUNCTION_ENDPOINT__", "__evjs/fn");

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
      new URL("https://api.example.com/framework/__evjs/fn"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not override an application-provided transport adapter", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    initTransport({ adapter: { send } });
    const mountPoint = {} as Element;
    const runtime = createRuntime();
    runtime.runtime.transport = {
      baseUrl: "https://api.example.com/framework",
    };
    const document = createDocument({
      runtime,
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

type LegacyClientRuntime = ClientRuntime & {
  pages: Record<string, ClientRuntimePage>;
  routes: ClientRuntimeRoute[];
};

function createRuntime(): LegacyClientRuntime {
  return {
    version: 1,
    buildId: "test",
    runtime: {},
    pages: {
      home: {
        mount: "#root",
        module: {
          type: "lifecycle",
          href: "/home.js",
        },
      },
    },
    routes: [],
  };
}

function createDocument(options: {
  runtime?: ClientRuntime;
  embeddedRuntimeText?: unknown;
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
      if (id !== "__EVJS_CLIENT_RUNTIME__") return null;
      if (options.embeddedRuntimeText !== undefined) {
        return {
          textContent: options.embeddedRuntimeText,
        };
      }
      if (!options.runtime) return null;
      return {
        textContent: JSON.stringify(options.runtime),
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
