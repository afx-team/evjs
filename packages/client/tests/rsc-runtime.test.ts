import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReactRscModel,
  mountReactRscPage,
  type ReactRscRuntimeBootstrap,
  startReactRscPageRuntime,
  unmountReactRscPage,
} from "../src/rsc/rsc.js";
import type { ClientRuntime } from "../src/shared/runtime-config.js";

const calls: string[] = [];
const rootElements: unknown[] = [];
let createRootFailure: Error | undefined;
let hydrateRootFailure: Error | undefined;
let renderFailure: Error | undefined;
let unmountFailure: Error | undefined;

vi.mock("react-server-dom-webpack/client", () => ({
  createFromFetch(response: Promise<Response>, options?: unknown) {
    calls.push("createFromFetch");
    return {
      type: "rsc-model",
      response,
      options,
    };
  },
}));

vi.mock("react-dom/client", () => ({
  createRoot() {
    calls.push("createRoot");
    if (createRootFailure) throw createRootFailure;
    return {
      render(element: unknown) {
        calls.push("render");
        if (renderFailure) throw renderFailure;
        rootElements.push(element);
      },
      unmount() {
        calls.push("unmount");
        if (unmountFailure) throw unmountFailure;
      },
    };
  },
  hydrateRoot(_mount: unknown, element: unknown) {
    calls.push("hydrateRoot");
    if (hydrateRootFailure) throw hydrateRootFailure;
    rootElements.push(element);
    return {
      unmount() {
        calls.push("unmount");
        if (unmountFailure) throw unmountFailure;
      },
    };
  },
}));

afterEach(() => {
  rootElements.length = 0;
  createRootFailure = undefined;
  hydrateRootFailure = undefined;
  renderFailure = undefined;
  unmountFailure = undefined;
  vi.unstubAllGlobals();
});

describe("React RSC runtime", () => {
  it("creates an RSC model from the framework Flight endpoint", async () => {
    calls.length = 0;
    const fetchMock = vi.fn(async () => createFlightResponse());

    const model = (await createReactRscModel({
      runtime: createRuntime(),
      pageId: "insights",
      url: "https://example.com/insights",
      moduleBaseURL: "https://assets.example.com/",
      fetch: fetchMock,
    })) as unknown as {
      type: string;
      response: Promise<Response>;
      options: { moduleBaseURL?: string };
    };

    expect(calls).toEqual(["createFromFetch"]);
    expect(model.type).toBe("rsc-model");
    await expect(model.response).resolves.toBeInstanceOf(Response);
    expect(model.options).toEqual({
      moduleBaseURL: "https://assets.example.com/",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/__evjs/rsc?page=insights&url=%2Finsights",
    );
  });

  it("rejects successful RSC model responses without Flight content type", async () => {
    calls.length = 0;

    const wrongTypeModel = (await createReactRscModel({
      runtime: createRuntime(),
      pageId: "insights",
      url: "https://example.com/insights",
      fetch: async () =>
        new Response("not flight", {
          headers: { "Content-Type": "application/text/x-component" },
        }),
    })) as unknown as {
      response: Promise<Response>;
    };

    expect(calls).toEqual(["createFromFetch"]);
    await expect(wrongTypeModel.response).rejects.toThrow(
      '[evjs] RSC Flight response Content-Type must be "text/x-component"; received "application/text/x-component".',
    );

    const missingTypeModel = (await createReactRscModel({
      runtime: createRuntime(),
      pageId: "insights",
      url: "https://example.com/insights",
      fetch: async () => new Response(null),
    })) as unknown as {
      response: Promise<Response>;
    };

    expect(calls).toEqual(["createFromFetch", "createFromFetch"]);
    await expect(missingTypeModel.response).rejects.toThrow(
      '[evjs] RSC Flight response Content-Type must be "text/x-component"; received missing Content-Type.',
    );
  });

  it("rejects malformed RSC model options before loading the RSC client", async () => {
    calls.length = 0;

    await expect(createReactRscModel(null as never)).rejects.toThrow(
      "[evjs] fetchRscFlight() options must be an object.",
    );
    await expect(
      createReactRscModel({
        runtime: createRuntime(),
        pageId: "insights",
        url: "https://example.com/insights",
        moduleBaseURL: "",
        fetch: async () => createFlightResponse(),
      }),
    ).rejects.toThrow(
      "[evjs] createReactRscModel() moduleBaseURL must be a non-empty string when provided.",
    );
    await expect(
      createReactRscModel({
        runtime: createRuntime(),
        pageId: "insights",
        url: "https://example.com/insights",
        moduleBaseURL: " https://assets.example.com/ ",
        fetch: async () => createFlightResponse(),
      }),
    ).rejects.toThrow(
      "[evjs] createReactRscModel() moduleBaseURL must not include leading or trailing whitespace.",
    );

    expect(calls).toEqual([]);
  });

  it("hydrates and unmounts an RSC page by default", async () => {
    calls.length = 0;
    const mount = {} as Element;

    await mountReactRscPage({
      runtime: createRuntime(),
      pageId: "insights",
      url: "https://example.com/insights",
      mount,
      fetch: async () => createFlightResponse(),
    });
    unmountReactRscPage(mount);

    expect(calls).toEqual(["createFromFetch", "hydrateRoot", "unmount"]);
    expect(rootElements[0]).toMatchObject({
      type: "rsc-model",
    });
  });

  it("can mount an RSC page without hydration for client-only hosts", async () => {
    calls.length = 0;
    const mount = {} as Element;

    await mountReactRscPage({
      runtime: createRuntime(),
      pageId: "insights",
      url: "https://example.com/insights",
      mount,
      hydrate: false,
      fetch: async () => createFlightResponse(),
    });
    unmountReactRscPage(mount);

    expect(calls).toEqual([
      "createFromFetch",
      "createRoot",
      "render",
      "unmount",
    ]);
  });

  it("replaces an existing RSC root on the same mount point", async () => {
    calls.length = 0;
    const mount = {} as Element;

    await mountReactRscPage({
      runtime: createRuntime(),
      pageId: "insights",
      url: "https://example.com/insights",
      mount,
      hydrate: false,
      fetch: async () => createFlightResponse(),
    });
    await mountReactRscPage({
      runtime: createRuntime(),
      pageId: "insights",
      url: "https://example.com/insights?tab=summary",
      mount,
      hydrate: false,
      fetch: async () => createFlightResponse(),
    });
    unmountReactRscPage(mount);

    expect(calls).toEqual([
      "createFromFetch",
      "createRoot",
      "render",
      "createFromFetch",
      "unmount",
      "createRoot",
      "render",
      "unmount",
    ]);
  });

  it("reports RSC React DOM root failures with evjs errors", async () => {
    const mount = {} as Element;

    calls.length = 0;
    hydrateRootFailure = new Error("hydrate blocked");
    await expect(
      mountReactRscPage({
        runtime: createRuntime(),
        pageId: "insights",
        url: "https://example.com/insights",
        mount,
        fetch: async () => createFlightResponse(),
      }),
    ).rejects.toThrow("[evjs] RSC hydrateRoot failed: hydrate blocked");
    expect(calls).toEqual(["createFromFetch", "hydrateRoot"]);

    calls.length = 0;
    hydrateRootFailure = undefined;
    createRootFailure = new Error("create blocked");
    await expect(
      mountReactRscPage({
        runtime: createRuntime(),
        pageId: "insights",
        url: "https://example.com/insights",
        mount,
        hydrate: false,
        fetch: async () => createFlightResponse(),
      }),
    ).rejects.toThrow("[evjs] RSC createRoot failed: create blocked");
    expect(calls).toEqual(["createFromFetch", "createRoot"]);

    calls.length = 0;
    createRootFailure = undefined;
    renderFailure = new Error("render blocked");
    await expect(
      mountReactRscPage({
        runtime: createRuntime(),
        pageId: "insights",
        url: "https://example.com/insights",
        mount,
        hydrate: false,
        fetch: async () => createFlightResponse(),
      }),
    ).rejects.toThrow("[evjs] RSC root.render failed: render blocked");
    expect(calls).toEqual([
      "createFromFetch",
      "createRoot",
      "render",
      "unmount",
    ]);

    calls.length = 0;
    renderFailure = undefined;
    unmountFailure = new Error("unmount blocked");
    await mountReactRscPage({
      runtime: createRuntime(),
      pageId: "insights",
      url: "https://example.com/insights",
      mount,
      fetch: async () => createFlightResponse(),
    });
    expect(() => unmountReactRscPage(mount)).toThrow(
      "[evjs] RSC root.unmount failed: unmount blocked",
    );
    expect(calls).toEqual(["createFromFetch", "hydrateRoot", "unmount"]);
    expect(() => unmountReactRscPage(mount)).not.toThrow();
  });

  it("rejects invalid RSC mount options before Flight loading", async () => {
    calls.length = 0;

    await expect(mountReactRscPage(null as never)).rejects.toThrow(
      "[evjs] mountReactRscPage() options must be an object.",
    );
    await expect(
      mountReactRscPage({
        runtime: createRuntime(),
        mount: "",
        fetch: async () => createFlightResponse(),
      }),
    ).rejects.toThrow("[evjs] RSC mount must be a non-empty selector string.");
    await expect(
      mountReactRscPage({
        runtime: createRuntime(),
        mount: " #app",
        fetch: async () => createFlightResponse(),
      }),
    ).rejects.toThrow(
      "[evjs] RSC mount must not include leading or trailing whitespace.",
    );
    await expect(
      mountReactRscPage({
        runtime: createRuntime(),
        mount: 42 as never,
        fetch: async () => createFlightResponse(),
      }),
    ).rejects.toThrow("[evjs] RSC mount must be a selector string or Element.");
    await expect(
      mountReactRscPage({
        runtime: createRuntime(),
        mount: "#app",
        hydrate: "yes" as never,
        fetch: async () => createFlightResponse(),
      }),
    ).rejects.toThrow("[evjs] mountReactRscPage() hydrate must be a boolean.");

    expect(calls).toEqual([]);
  });

  it("reports missing or invalid RSC runtime documents before selector resolution", async () => {
    calls.length = 0;

    await expect(
      mountReactRscPage({
        runtime: createRuntime(),
        mount: "#app",
        fetch: async () => createFlightResponse(),
      }),
    ).rejects.toThrow(
      "[evjs] RSC runtime document must be available or provided.",
    );

    await expect(
      startReactRscPageRuntime({ document: {} as never }),
    ).rejects.toThrow(
      "[evjs] RSC runtime document.getElementById must be a function.",
    );
    await expect(
      startReactRscPageRuntime({
        bootstrap: createBootstrap(),
        document: {
          getElementById() {
            return null;
          },
        } as never,
      }),
    ).rejects.toThrow(
      "[evjs] RSC runtime document.querySelector must be a function.",
    );

    expect(calls).toEqual([]);
  });

  it("starts from the server-rendered RSC bootstrap payload", async () => {
    calls.length = 0;
    const fetchMock = vi.fn(async () => createFlightResponse());
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "document",
      createDocument({
        bootstrap: {
          version: 1,
          buildId: "test",
          pageId: "insights",
          endpoint: "/__evjs/rsc",
          basePath: "/__evjs",
          publicPath: "/assets/",
          mount: "#app",
          page: {
            routeId: "insights",
            assets: {
              js: ["insights-rsc.js"],
              css: ["insights.css"],
            },
          },
        },
      }),
    );

    await startReactRscPageRuntime();

    expect(calls).toEqual(["createFromFetch", "hydrateRoot"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/__evjs/rsc?page=insights&url=%2Finsights",
    );
    expect(rootElements[0]).toMatchObject({
      options: {
        moduleBaseURL: "https://example.com/assets/",
      },
    });
  });

  it("allows scheduled RSC runtime start to retry after a failed boot", async () => {
    calls.length = 0;
    const queuedStarts: Array<() => void> = [];
    const fetchMock = vi.fn(async () => createFlightResponse());
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    hydrateRootFailure = new Error("hydrate blocked");
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "document",
      createDocument({
        bootstrap: createBootstrap(),
      }),
    );
    vi.stubGlobal("queueMicrotask", (callback: () => void) => {
      queuedStarts.push(callback);
    });

    try {
      vi.resetModules();
      await import("../src/rsc/rsc.js");

      expect(queuedStarts).toHaveLength(1);
      queuedStarts[0]();
      await flushAsyncRuntime();
      expect(consoleError).toHaveBeenCalledWith(
        "[evjs] RSC page runtime failed to start.",
        expect.any(Error),
      );
      expect(calls).toEqual(["createFromFetch", "hydrateRoot"]);

      hydrateRootFailure = undefined;
      queuedStarts[0]();
      await flushAsyncRuntime();
      expect(calls).toEqual([
        "createFromFetch",
        "hydrateRoot",
        "createFromFetch",
        "hydrateRoot",
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
      vi.resetModules();
    }
  });

  it("uses the supplied document for RSC bootstrap mount selectors", async () => {
    calls.length = 0;
    const fetchMock = vi.fn(async () => createFlightResponse());
    vi.stubGlobal("fetch", fetchMock);

    await startReactRscPageRuntime({
      document: createDocument({
        bootstrap: {
          version: 1,
          buildId: "test",
          pageId: "insights",
          endpoint: "/__evjs/rsc",
          basePath: "/__evjs",
          mount: "#app",
        },
      }),
    });

    expect(calls).toEqual(["createFromFetch", "hydrateRoot"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/__evjs/rsc?page=insights&url=%2Finsights",
    );
  });

  it("returns undefined when no RSC bootstrap payload is present", async () => {
    calls.length = 0;

    await expect(
      startReactRscPageRuntime({
        document: createDocument({}),
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([]);
  });

  it("reports malformed RSC bootstrap JSON", async () => {
    calls.length = 0;

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrapText: "{",
        }),
      }),
    ).rejects.toThrow(
      '[evjs] Failed to parse RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" as JSON',
    );

    expect(calls).toEqual([]);
  });

  it("reports invalid RSC bootstrap payloads", async () => {
    calls.length = 0;

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "build.1",
            pageId: "insights",
            endpoint: "/__evjs/rsc",
            mount: "#app",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" buildId must contain only letters, numbers, underscores, or hyphens.',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: " insights ",
            endpoint: "/__evjs/rsc",
            mount: "#app",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" pageId must not contain leading or trailing whitespace.',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: "insights.page",
            endpoint: "/__evjs/rsc",
            mount: "#app",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" pageId must contain only letters, numbers, underscores, or hyphens.',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: "insights",
            endpoint: "",
            mount: "#app",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" endpoint must be a non-empty string.',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: "insights",
            endpoint: "__evjs/rsc",
            mount: "#app",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" endpoint must start with "/".',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: "insights",
            endpoint: "/__evjs/rsc?flight=1",
            mount: "#app",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" endpoint must not include a query string or hash.',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: "insights",
            endpoint: "/__evjs/rsc",
            basePath: " /__evjs ",
            mount: "#app",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" basePath must not contain leading or trailing whitespace.',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: "insights",
            endpoint: "/__evjs/rsc",
            publicPath: "",
            mount: "#app",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" publicPath must be a non-empty string.',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: "insights",
            endpoint: "/__evjs/rsc",
            publicPath: " /assets/ ",
            mount: "#app",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" publicPath must not contain leading or trailing whitespace.',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: "insights",
            endpoint: "/__evjs/rsc",
            publicPath: { mode: "asset" },
            mount: "#app",
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" publicPath must be a non-empty string.',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: "insights",
            endpoint: "/__evjs/rsc",
            mount: "#app",
            page: {
              routeId: " insights ",
            },
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" page.routeId must not contain leading or trailing whitespace.',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: "insights",
            endpoint: "/__evjs/rsc",
            mount: "#app",
            page: {
              assets: {
                js: [" rsc-client.js "],
                css: [],
              },
            },
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" page.assets.js item " rsc-client.js " must not contain leading or trailing whitespace.',
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: {
            version: 1,
            buildId: "test",
            pageId: "insights",
            endpoint: "/__evjs/rsc",
            mount: "#app",
            page: {
              assets: {
                js: ["rsc-client.js"],
                css: [""],
              },
            },
          },
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" page.assets.css must contain only non-empty strings.',
    );

    expect(calls).toEqual([]);
  });

  it("validates explicit RSC bootstrap options", async () => {
    calls.length = 0;

    await expect(
      startReactRscPageRuntime({
        bootstrap: {
          version: 1,
          buildId: "test",
          pageId: "",
          endpoint: "/__evjs/rsc",
          mount: "#app",
        } as never,
        document: createDocument(),
      }),
    ).rejects.toThrow(
      '[evjs] RSC bootstrap "__EVJS_RSC_BOOTSTRAP__" pageId must be a non-empty string.',
    );

    expect(calls).toEqual([]);
  });

  it("validates RSC runtime options and mount selectors", async () => {
    calls.length = 0;

    await expect(startReactRscPageRuntime(null as never)).rejects.toThrow(
      "[evjs] startReactRscPageRuntime() options must be an object.",
    );

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: createBootstrap({ mount: "[" }),
        }),
      }),
    ).rejects.toThrow('[evjs] RSC mount selector "[" is invalid');

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: createBootstrap({ mount: "#missing" }),
        }),
      }),
    ).rejects.toThrow('[evjs] RSC mount point "#missing" was not found.');

    await expect(
      startReactRscPageRuntime({
        document: createDocument({
          bootstrap: createBootstrap({ mount: "#invalid-result" }),
        }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC mount selector "#invalid-result" must resolve to an Element.',
    );

    expect(calls).toEqual([]);
  });
});

function createBootstrap(
  overrides: Partial<ReactRscRuntimeBootstrap> = {},
): ReactRscRuntimeBootstrap {
  return {
    version: 1,
    buildId: "test",
    pageId: "insights",
    endpoint: "/__evjs/rsc",
    basePath: "/__evjs",
    mount: "#app",
    ...overrides,
  };
}

function createRuntime(): ClientRuntime {
  return {
    version: 1,
    buildId: "test",
    runtime: {
      server: {
        rsc: "/__evjs/rsc",
      },
    },
    pages: {},
    routes: [],
  };
}

function createFlightResponse(body = "flight"): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/x-component" },
  });
}

async function flushAsyncRuntime(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createDocument(
  options: { bootstrap?: unknown; bootstrapText?: string } = {},
): Document {
  const mountPoint = {} as Element;
  return {
    location: {
      href: "https://example.com/insights",
    },
    getElementById(id: string) {
      if (id !== "__EVJS_RSC_BOOTSTRAP__") return null;
      if (options.bootstrapText !== undefined) {
        return {
          textContent: options.bootstrapText,
        } as HTMLElement;
      }
      if (options.bootstrap === undefined) return null;
      return {
        textContent: JSON.stringify(options.bootstrap),
      } as HTMLElement;
    },
    querySelector(selector: string) {
      if (selector === "[") {
        throw new SyntaxError("Invalid selector");
      }
      if (selector === "#invalid-result") {
        return "app" as unknown as Element;
      }
      return selector === "#app" ? mountPoint : null;
    },
  } as Document;
}
