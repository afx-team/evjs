import type { BuildOutput } from "@evjs/shared/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReactRscModel,
  mountReactRscPage,
  startReactRscPageRuntime,
  unmountReactRscPage,
} from "../src/rsc.js";

const calls: string[] = [];
const rootElements: unknown[] = [];

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
    return {
      render(element: unknown) {
        calls.push("render");
        rootElements.push(element);
      },
      unmount() {
        calls.push("unmount");
      },
    };
  },
  hydrateRoot(_mount: unknown, element: unknown) {
    calls.push("hydrateRoot");
    rootElements.push(element);
    return {
      unmount() {
        calls.push("unmount");
      },
    };
  },
}));

afterEach(() => {
  rootElements.length = 0;
  vi.unstubAllGlobals();
});

describe("React RSC runtime", () => {
  it("creates an RSC model from the framework Flight endpoint", async () => {
    calls.length = 0;
    const fetchMock = vi.fn(async () => new Response("flight"));

    const model = (await createReactRscModel({
      manifest: createManifest(),
      pageId: "insights",
      url: "https://example.com/insights",
      moduleBaseURL: "https://assets.example.com/",
      fetch: fetchMock,
    })) as unknown as {
      type: string;
      options: { moduleBaseURL?: string };
    };

    expect(calls).toEqual(["createFromFetch"]);
    expect(model.type).toBe("rsc-model");
    expect(model.options).toEqual({
      moduleBaseURL: "https://assets.example.com/",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/__evjs/rsc?page=insights&url=%2Finsights",
    );
  });

  it("hydrates and unmounts an RSC page by default", async () => {
    calls.length = 0;
    const mount = {} as Element;

    await mountReactRscPage({
      manifest: createManifest(),
      pageId: "insights",
      url: "https://example.com/insights",
      mount,
      fetch: async () => new Response("flight"),
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
      manifest: createManifest(),
      pageId: "insights",
      url: "https://example.com/insights",
      mount,
      hydrate: false,
      fetch: async () => new Response("flight"),
    });
    unmountReactRscPage(mount);

    expect(calls).toEqual([
      "createFromFetch",
      "createRoot",
      "render",
      "unmount",
    ]);
  });

  it("starts from the server-rendered RSC bootstrap payload", async () => {
    calls.length = 0;
    const fetchMock = vi.fn(async () => new Response("flight"));
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
        rsc: "/__evjs/rsc",
      },
    },
    assets: {},
    apps: {},
    pages: {},
    routes: [],
  };
}

function createDocument(options: {
  bootstrap: Record<string, unknown>;
}): Document {
  const mountPoint = {} as Element;
  return {
    location: {
      href: "https://example.com/insights",
    },
    getElementById(id: string) {
      if (id !== "__EVJS_RSC_BOOTSTRAP__") return null;
      return {
        textContent: JSON.stringify(options.bootstrap),
      } as HTMLElement;
    },
    querySelector(selector: string) {
      return selector === "#app" ? mountPoint : null;
    },
  } as Document;
}
