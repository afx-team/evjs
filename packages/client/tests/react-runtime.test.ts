import { memo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReactPageModule, mountReactPage } from "../src/internal";
import {
  fetchRscDebugPayload,
  fetchRscFlight,
  loadRscDebugPage,
  mountRscDebugPayload,
} from "../src/rsc/react.js";
import type {
  ClientRuntime,
  ClientRuntimePage,
  ClientRuntimeRoute,
  RuntimeTransportOptions,
} from "../src/shared/runtime-config.js";

type LegacyClientRuntime = ClientRuntime & {
  pages: Record<string, ClientRuntimePage>;
  routes: ClientRuntimeRoute[];
};

const calls: string[] = [];
const renderedElements: unknown[] = [];
let createRootFailure: Error | undefined;
let hydrateRootFailure: Error | undefined;
let renderFailure: Error | undefined;
let unmountFailure: Error | undefined;

vi.mock("react-dom/client", () => ({
  createRoot() {
    calls.push("createRoot");
    if (createRootFailure) throw createRootFailure;
    return {
      render(element: unknown) {
        renderedElements.push(element);
        calls.push("render");
        if (renderFailure) throw renderFailure;
      },
      unmount() {
        calls.push("unmount");
        if (unmountFailure) throw unmountFailure;
      },
    };
  },
  hydrateRoot(_mountPoint: Element, element: unknown) {
    renderedElements.push(element);
    calls.push("hydrateRoot");
    if (hydrateRootFailure) throw hydrateRootFailure;
    return {
      unmount() {
        calls.push("unmount");
        if (unmountFailure) throw unmountFailure;
      },
    };
  },
}));

afterEach(() => {
  createRootFailure = undefined;
  hydrateRootFailure = undefined;
  renderFailure = undefined;
  unmountFailure = undefined;
  vi.unstubAllGlobals();
});

function Component() {
  return null;
}

describe("createReactPageModule", () => {
  it("mounts CSR pages with createRoot", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    const mod = createReactPageModule({
      component: Component,
      render: "csr",
      hydrate: "load",
    });

    await mod.hydrate?.({} as Element, {} as never);
    await mod.unmount?.({} as Element, {} as never);

    expect(calls).toEqual(["createRoot", "render"]);
  });

  it("accepts wrapped React page components", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    const MemoComponent = memo(Component);
    const mod = createReactPageModule({
      component: MemoComponent,
      render: "csr",
      hydrate: "load",
    });

    await mod.mount?.({} as Element, {} as never);

    expect(calls).toEqual(["createRoot", "render"]);
    expect(renderedElements[0]).toMatchObject({
      type: MemoComponent,
    });
  });

  it("hydrates non-CSR pages with hydrateRoot", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    const mountPoint = {} as Element;
    const mod = createReactPageModule({
      component: Component,
      render: "ssr",
      hydrate: "load",
    });

    await mod.hydrate?.(mountPoint, {} as never);
    await mod.unmount?.(mountPoint, {} as never);

    expect(calls).toEqual(["hydrateRoot", "unmount"]);
  });

  it("defers visible hydration until the mount point intersects", async () => {
    calls.length = 0;
    let notifyVisible:
      | ((entries: IntersectionObserverEntry[]) => void)
      | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
          notifyVisible = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const mountPoint = {} as Element;
    const mod = createReactPageModule({
      component: Component,
      render: "ssr",
      hydrate: "visible",
    });

    await mod.hydrate?.(mountPoint, {} as never);
    expect(calls).toEqual([]);

    notifyVisible?.([{ isIntersecting: true } as IntersectionObserverEntry]);
    expect(calls).toEqual(["hydrateRoot"]);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("defers idle hydration and cancels pending work on unmount", async () => {
    calls.length = 0;
    let runIdle: (() => void) | undefined;
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      runIdle = callback;
      return 7;
    });
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    const firstMount = {} as Element;
    const secondMount = {} as Element;
    const mod = createReactPageModule({
      component: Component,
      render: "ssr",
      hydrate: "idle",
    });

    await mod.hydrate?.(firstMount, {} as never);
    expect(calls).toEqual([]);
    runIdle?.();
    expect(calls).toEqual(["hydrateRoot"]);

    await mod.hydrate?.(secondMount, {} as never);
    await mod.unmount?.(secondMount, {} as never);
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it("replaces an existing React page root on the same mount point", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    const mountPoint = {} as Element;
    const mod = createReactPageModule({
      component: Component,
      render: "csr",
      hydrate: "load",
    });

    await mod.mount?.(mountPoint, {} as never);
    await mod.mount?.(mountPoint, {} as never);
    await mod.unmount?.(mountPoint, {} as never);

    expect(calls).toEqual([
      "createRoot",
      "render",
      "unmount",
      "createRoot",
      "render",
      "unmount",
    ]);
  });

  it("reports React page root failures with evjs errors", async () => {
    const mountPoint = {} as Element;
    const mod = createReactPageModule({
      component: Component,
      render: "ssr",
      hydrate: "load",
    });

    calls.length = 0;
    hydrateRootFailure = new Error("hydrate blocked");
    expect(() => mod.hydrate?.(mountPoint, {} as never)).toThrow(
      "[evjs] React page hydrateRoot failed: hydrate blocked",
    );
    expect(calls).toEqual(["hydrateRoot"]);

    calls.length = 0;
    hydrateRootFailure = undefined;
    const csr = createReactPageModule({
      component: Component,
      render: "csr",
      hydrate: "load",
    });
    createRootFailure = new Error("create blocked");
    expect(() => csr.mount?.(mountPoint, {} as never)).toThrow(
      "[evjs] React page createRoot failed: create blocked",
    );
    expect(calls).toEqual(["createRoot"]);

    calls.length = 0;
    createRootFailure = undefined;
    renderFailure = new Error("render blocked");
    expect(() => csr.mount?.(mountPoint, {} as never)).toThrow(
      "[evjs] React page root.render failed: render blocked",
    );
    expect(calls).toEqual(["createRoot", "render", "unmount"]);

    calls.length = 0;
    renderFailure = undefined;
    unmountFailure = new Error("unmount blocked");
    await mod.hydrate?.(mountPoint, {} as never);
    expect(() => mod.unmount?.(mountPoint, {} as never)).toThrow(
      "[evjs] React page root.unmount failed: unmount blocked",
    );
    expect(calls).toEqual(["hydrateRoot", "unmount"]);
    expect(() => mod.unmount?.(mountPoint, {} as never)).not.toThrow();
  });

  it("reports malformed React page module options with evjs errors", () => {
    expect(() => createReactPageModule(null as never)).toThrow(
      "[evjs] createReactPageModule() options must be an object.",
    );
    expect(() => createReactPageModule({ component: "Home" } as never)).toThrow(
      "[evjs] createReactPageModule() component must be a React component.",
    );
    expect(() =>
      createReactPageModule({
        component: Component,
        render: "static" as never,
      }),
    ).toThrow(
      '[evjs] createReactPageModule() render must be "csr", "ssr", or "ssg".',
    );
    expect(() =>
      createReactPageModule({
        component: Component,
        hydrate: "always" as never,
      }),
    ).toThrow(
      '[evjs] createReactPageModule() hydrate must be "none", "load", "visible", or "idle".',
    );
    expect(() =>
      createReactPageModule({
        component: Component,
        props: [] as never,
      }),
    ).toThrow(
      "[evjs] createReactPageModule() props must be an object or function.",
    );
    expect(() =>
      createReactPageModule({
        component: Component,
        route: null as never,
      }),
    ).toThrow("[evjs] createReactPageModule() route must be an object.");
    expect(() =>
      createReactPageModule({
        component: Component,
        route: { id: "", path: "/" },
      }),
    ).toThrow(
      "[evjs] createReactPageModule() route.id must be a non-empty string.",
    );
    expect(() =>
      createReactPageModule({
        component: Component,
        route: { id: "home", path: " /home" },
      }),
    ).toThrow(
      "[evjs] createReactPageModule() route.path must not include leading or trailing whitespace.",
    );
  });

  it("reports page props factories that do not return objects", () => {
    const mod = createReactPageModule({
      component: Component,
      props: () => "props" as never,
    });

    expect(() => mod.mount?.({} as Element, {} as never)).toThrow(
      "[evjs] React page props must resolve to an object.",
    );
  });

  it("does not mount pages with hydrate none", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    const mod = createReactPageModule({
      component: Component,
      render: "ssg",
      hydrate: "none",
    });

    await mod.hydrate?.({} as Element, {} as never);
    await mod.mount?.({} as Element, {} as never);
    await mod.unmount?.({} as Element, {} as never);

    expect(calls).toEqual([]);
  });

  it("reports malformed mountReactPage options before DOM activation", () => {
    expect(() => mountReactPage(null as never)).toThrow(
      "[evjs] mountReactPage() options must be an object.",
    );
    expect(() => mountReactPage({ component: Component, mount: "" })).toThrow(
      "[evjs] mountReactPage() mount must be a non-empty selector string.",
    );
    expect(() =>
      mountReactPage({ component: Component, mount: " #app " }),
    ).toThrow(
      "[evjs] mountReactPage() mount must not include leading or trailing whitespace.",
    );
    expect(() =>
      mountReactPage({ component: Component, mount: 42 as never }),
    ).toThrow(
      "[evjs] mountReactPage() mount must be a selector string or Element.",
    );
  });

  it("reports mount selector resolution failures with evjs errors", () => {
    expect(() =>
      mountReactPage({ component: Component, mount: "#app" }),
    ).toThrow(
      '[evjs] Document is not available to resolve mount selector "#app".',
    );

    vi.stubGlobal("document", {
      querySelector() {
        throw new SyntaxError("bad selector");
      },
    });

    expect(() =>
      mountReactPage({ component: Component, mount: "##bad" }),
    ).toThrow('[evjs] Mount selector "##bad" is invalid: bad selector');

    vi.stubGlobal("document", {
      querySelector: vi.fn(() => null),
    });

    expect(() =>
      mountReactPage({ component: Component, mount: "#app" }),
    ).toThrow('[evjs] Mount point "#app" was not found.');
  });

  it("passes context-derived props to mounted React modules", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    const mod = createReactPageModule({
      component: Component,
      render: "csr",
      hydrate: "load",
      props(ctx) {
        return {
          kind: ctx?.kind,
          id: ctx?.id,
        };
      },
    });

    await mod.mount?.(
      {} as Element,
      {
        id: "default",
        kind: "app",
      } as never,
    );

    expect(calls).toEqual(["createRoot", "render"]);
    expect((renderedElements[0] as { props?: unknown }).props).toEqual({
      kind: "app",
      id: "default",
    });
  });

  it("uses the most specific matching route for context-derived page props", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    vi.stubGlobal("location", {
      href: "https://example.com/users/settings",
      pathname: "/users/settings",
      search: "",
    });
    const runtime: LegacyClientRuntime = {
      ...createRscRuntime(),
      pages: {
        profile: {},
      },
      routes: [
        {
          id: "user",
          path: "/users/$userId",
          pageId: "profile",
        },
        {
          id: "settings",
          path: "/users/settings",
          pageId: "profile",
        },
      ],
    };
    const mod = createReactPageModule({
      component: Component,
      render: "csr",
      hydrate: "load",
    });

    await mod.mount?.(
      {} as Element,
      {
        id: "profile",
        kind: "page",
        runtime,
        output: runtime.pages.profile,
        request: { url: "/users/settings" },
      } as never,
    );

    const element = renderedElements[0] as {
      props?: {
        value?: unknown;
        children?: {
          props?: unknown;
        };
      };
    };

    expect(calls).toEqual(["createRoot", "render"]);
    expect(element.props?.value).toEqual({
      params: {},
      search: {},
      loaderData: undefined,
    });
    expect(element.props?.children?.props).toEqual({
      runtime: { buildId: "test" },
      pageId: "profile",
      route: { id: "settings", path: "/users/settings" },
    });
  });

  it("ignores embedded page props that are not JSON objects", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    vi.stubGlobal("document", {
      getElementById: vi.fn(() => ({ textContent: "[]" })),
    });
    const mod = createReactPageModule({
      component: Component,
      render: "csr",
      hydrate: "load",
    });

    await mod.mount?.({} as Element, {} as never);

    expect(calls).toEqual(["createRoot", "render"]);
    expect((renderedElements[0] as { props?: unknown }).props).toEqual({});
  });

  it("provides route-derived params and search through page context", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    vi.stubGlobal("location", {
      pathname: "/posts/42",
      search: "?tab=comments&tag=a&tag=b",
    });
    const mod = createReactPageModule({
      component: Component,
      render: "csr",
      hydrate: "load",
      route: {
        id: "post",
        path: "/posts/$postId",
      },
    });

    await mod.mount?.({} as Element, {} as never);

    const element = renderedElements[0] as {
      props?: {
        value?: unknown;
        children?: {
          props?: unknown;
        };
      };
    };
    const pageProps = {
      params: { postId: "42" },
      search: { tab: "comments", tag: ["a", "b"] },
      loaderData: undefined,
    };

    expect(calls).toEqual(["createRoot", "render"]);
    expect(element.props?.value).toEqual(pageProps);
    expect(element.props?.children?.props).toEqual({});
  });

  it("provides colon-style route params through page context", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    vi.stubGlobal("location", {
      pathname: "/posts/42",
      search: "",
    });
    const mod = createReactPageModule({
      component: Component,
      render: "csr",
      hydrate: "load",
      route: {
        id: "post",
        path: "/posts/:postId",
      },
    });

    await mod.mount?.({} as Element, {} as never);

    const element = renderedElements[0] as {
      props?: {
        value?: unknown;
        children?: {
          props?: unknown;
        };
      };
    };

    expect(calls).toEqual(["createRoot", "render"]);
    expect(element.props?.value).toEqual({
      params: { postId: "42" },
      search: {},
      loaderData: undefined,
    });
    expect(element.props?.children?.props).toEqual({});
  });

  it("provides wildcard route params through page context", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    vi.stubGlobal("location", {
      pathname: "/docs/guides/install",
      search: "",
    });
    const mod = createReactPageModule({
      component: Component,
      render: "csr",
      hydrate: "load",
      route: {
        id: "docs-fallback",
        path: "/docs/$",
      },
    });

    await mod.mount?.({} as Element, {} as never);

    const element = renderedElements[0] as {
      props?: {
        value?: unknown;
        children?: {
          props?: unknown;
        };
      };
    };

    expect(calls).toEqual(["createRoot", "render"]);
    expect(element.props?.value).toEqual({
      params: { _splat: "guides/install" },
      search: {},
      loaderData: undefined,
    });
    expect(element.props?.children?.props).toEqual({});
  });

  it("keeps explicit props but hides route data props from MPA page components", async () => {
    calls.length = 0;
    renderedElements.length = 0;
    const mod = createReactPageModule({
      component: Component,
      render: "csr",
      hydrate: "load",
      props: {
        title: "Post",
        params: { postId: "42" },
        search: { tab: "comments" },
        loaderData: { title: "Hello" },
      },
    });

    await mod.mount?.({} as Element, {} as never);

    const element = renderedElements[0] as {
      props?: {
        value?: unknown;
        children?: {
          props?: unknown;
        };
      };
    };

    expect(calls).toEqual(["createRoot", "render"]);
    expect(element.props?.value).toEqual({
      params: { postId: "42" },
      search: { tab: "comments" },
      loaderData: { title: "Hello" },
    });
    expect(element.props?.children?.props).toEqual({ title: "Post" });
  });
});

describe("fetchRscFlight", () => {
  it("fetches the configured RSC endpoint with page identity", async () => {
    const fetchMock = vi.fn(async () => new Response("flight"));

    await fetchRscFlight({
      runtime: {
        version: 1,
        buildId: "test",
        runtime: {
          server: {
            rsc: "__evjs/rsc",
          },
        },
        pages: {},
        routes: [],
      },
      pageId: "dashboard",
      url: "https://example.com/dashboard?tab=comments&tag=a&tag=b",
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/__evjs/rsc?page=dashboard&url=%2Fdashboard%3Ftab%3Dcomments%26tag%3Da%26tag%3Db",
    );
  });

  it("accepts absolute path RSC page urls relative to the current origin", async () => {
    vi.stubGlobal("location", { href: "https://example.com/current" });
    const fetchMock = vi.fn(async () => new Response("flight"));

    await fetchRscFlight({
      runtime: createRscRuntime(),
      pageId: "dashboard",
      url: "/dashboard?tab=stats",
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/__evjs/rsc?page=dashboard&url=%2Fdashboard%3Ftab%3Dstats",
    );
  });

  it("uses the framework server transport base URL for RSC Flight requests", async () => {
    vi.stubGlobal("location", { href: "https://app.example.com/current" });
    const fetchMock = vi.fn(async () => new Response("flight"));

    await fetchRscFlight({
      runtime: {
        ...createRscRuntime(),
        runtime: {
          ...createRscRuntime().runtime,
          transport: {
            baseUrl: "https://runtime.example.com/service/",
          },
        },
      },
      pageId: "dashboard",
      url: "https://app.example.com/dashboard?tab=stats",
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/service/__evjs/rsc?page=dashboard&url=%2Fdashboard%3Ftab%3Dstats",
    );
  });

  it("uses runtime transport request defaults for RSC Flight requests", async () => {
    vi.stubGlobal("location", { href: "https://app.example.com/current" });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("flight"));

    await fetchRscFlight({
      runtime: {
        ...createRscRuntime(),
        runtime: {
          ...createRscRuntime().runtime,
          transport: {
            baseUrl: "https://runtime.example.com/service/",
            credentials: "include",
            headers: {
              "x-webgw-appid": "1800",
              "x-webgw-version": "2.0",
            },
          },
        },
      },
      pageId: "dashboard",
      url: "https://app.example.com/dashboard?tab=stats",
      fetch: fetchMock,
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/service/__evjs/rsc?page=dashboard&url=%2Fdashboard%3Ftab%3Dstats",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(headers.get("x-webgw-appid")).toBe("1800");
    expect(headers.get("x-webgw-version")).toBe("2.0");
  });

  it("uses global transport config for RSC Flight requests", async () => {
    vi.stubGlobal("location", { href: "https://app.example.com/current" });
    vi.stubGlobal("__EVJS_TRANSPORT__", {
      baseUrl: "https://webgw.example.com/app/api/yuyan/1800/version",
      credentials: "include",
      headers: {
        "x-webgw-appid": "1800",
      },
    } satisfies RuntimeTransportOptions);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("flight"));

    await fetchRscFlight({
      runtime: createRscRuntime(),
      pageId: "dashboard",
      url: "https://app.example.com/dashboard?tab=stats",
      fetch: fetchMock,
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://webgw.example.com/app/api/yuyan/1800/version/__evjs/rsc?page=dashboard&url=%2Fdashboard%3Ftab%3Dstats",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(headers.get("x-webgw-appid")).toBe("1800");
  });

  it("rejects malformed RSC Flight options before fetching", async () => {
    const fetchMock = vi.fn(async () => new Response("flight"));

    await expect(fetchRscFlight(null as never)).rejects.toThrow(
      "[evjs] fetchRscFlight() options must be an object.",
    );
    await expect(
      fetchRscFlight({
        runtime: null,
        fetch: fetchMock,
      } as never),
    ).rejects.toThrow("[evjs] fetchRscFlight() runtime must be an object.");
    await expect(
      fetchRscFlight({
        runtime: {
          ...createRscRuntime(),
          runtime: null,
        } as never,
        fetch: fetchMock,
      }),
    ).rejects.toThrow(
      "[evjs] fetchRscFlight() runtime.runtime must be an object.",
    );
    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: "",
        fetch: fetchMock,
      }),
    ).rejects.toThrow(
      "[evjs] fetchRscFlight() pageId must be a non-empty string.",
    );
    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: " dashboard ",
        fetch: fetchMock,
      }),
    ).rejects.toThrow(
      "[evjs] fetchRscFlight() pageId must not include leading or trailing whitespace.",
    );
    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        url: { pathname: "/dashboard" } as never,
        fetch: fetchMock,
      }),
    ).rejects.toThrow(
      "[evjs] fetchRscFlight() url must be a string or URL when provided.",
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid explicit RSC page urls before fetching", async () => {
    vi.stubGlobal("location", { href: "https://example.com/current" });
    const fetchMock = vi.fn(async () => new Response("flight"));

    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "",
        fetch: fetchMock,
      }),
    ).rejects.toThrow(
      "[evjs] RSC Flight page url must be a non-empty string without leading or trailing whitespace.",
    );

    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "dashboard",
        fetch: fetchMock,
      }),
    ).rejects.toThrow(
      '[evjs] RSC Flight page url must be an absolute path starting with "/" or an absolute same-origin HTTP(S) URL.',
    );

    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "javascript:alert(1)",
        fetch: fetchMock,
      }),
    ).rejects.toThrow(
      '[evjs] RSC Flight page url must be an absolute path starting with "/" or an absolute same-origin HTTP(S) URL.',
    );

    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "/dashboard#details",
        fetch: fetchMock,
      }),
    ).rejects.toThrow("[evjs] RSC Flight page url must not include a hash.");

    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://evil.example/dashboard",
        fetch: fetchMock,
      }),
    ).rejects.toThrow(
      "[evjs] RSC Flight page url must stay on the same origin.",
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports unavailable or malformed RSC Flight fetch responses", async () => {
    vi.stubGlobal("fetch", undefined);
    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: "dashboard",
      }),
    ).rejects.toThrow(
      "[evjs] RSC Flight fetch requires a fetch implementation.",
    );

    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        fetch: "fetch" as never,
      }),
    ).rejects.toThrow(
      "[evjs] RSC Flight fetch requires a fetch implementation.",
    );

    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () => {
          throw new TypeError("network offline");
        },
      }),
    ).rejects.toThrow("[evjs] RSC Flight request failed: network offline");

    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () => null as never,
      }),
    ).rejects.toThrow(
      "[evjs] RSC Flight: fetch returned an invalid Response object.",
    );

    await expect(
      fetchRscFlight({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () => ({}) as never,
      }),
    ).rejects.toThrow(
      "[evjs] RSC Flight: fetch response.ok must be a boolean.",
    );
  });

  it("parses an evjs RSC debug payload", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        version: 1,
        type: "evjs.rsc",
        buildId: "test",
        pageId: "dashboard",
        html: "<h1>Dashboard</h1>",
      }),
    );

    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: fetchMock,
      }),
    ).resolves.toEqual({
      version: 1,
      type: "evjs.rsc",
      buildId: "test",
      pageId: "dashboard",
      html: "<h1>Dashboard</h1>",
    });
  });

  it("rejects RSC debug payload responses with invalid JSON", async () => {
    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () =>
          new Response("{not json", {
            headers: { "Content-Type": "application/json" },
          }),
      }),
    ).rejects.toThrow("[evjs] RSC debug payload response is not valid JSON.");
  });

  it("rejects RSC debug payload responses without application/json content type", async () => {
    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () =>
          new Response(
            JSON.stringify({
              version: 1,
              type: "evjs.rsc",
              buildId: "test",
            }),
            {
              headers: { "Content-Type": "text/application/json" },
            },
          ),
      }),
    ).rejects.toThrow(
      '[evjs] RSC debug payload response: fetch response Content-Type must be "application/json"; received "text/application/json".',
    );
  });

  it("includes RSC debug payload error response bodies", async () => {
    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () =>
          new Response("renderer module failed to load", {
            status: 502,
            statusText: "Bad Gateway",
          }),
      }),
    ).rejects.toThrow(
      "[evjs] RSC debug payload request failed: 502 Bad Gateway: renderer module failed to load",
    );
  });

  it("reports malformed RSC debug payload response metadata", async () => {
    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () => ({ ok: false }) as never,
      }),
    ).rejects.toThrow(
      "[evjs] RSC Flight: fetch response.status must be a number when ok is false.",
    );

    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () => ({ ok: false, status: 500 }) as never,
      }),
    ).rejects.toThrow(
      "[evjs] RSC Flight: fetch response.statusText must be a string when ok is false.",
    );

    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () => ({ ok: true }) as never,
      }),
    ).rejects.toThrow(
      "[evjs] RSC debug payload response: fetch response.json must be a function.",
    );

    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () =>
          Response.json({
            version: 2,
            type: "evjs.rsc",
            buildId: "test",
          }),
      }),
    ).rejects.toThrow(
      "[evjs] RSC debug payload response is not an evjs RSC debug payload.",
    );

    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () =>
          Response.json({
            version: 1,
            type: "evjs.rsc",
          }),
      }),
    ).rejects.toThrow(
      "[evjs] RSC debug payload response.buildId must be a non-empty string.",
    );

    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () =>
          Response.json({
            version: 1,
            type: "evjs.rsc",
            buildId: "test.1",
          }),
      }),
    ).rejects.toThrow(
      "[evjs] RSC debug payload response.buildId must contain only letters, numbers, underscores, or hyphens.",
    );

    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () =>
          Response.json({
            version: 1,
            type: "evjs.rsc",
            buildId: "test",
            html: { markup: "<h1>Dashboard</h1>" },
          }),
      }),
    ).rejects.toThrow(
      "[evjs] RSC debug payload response.html must be a string when provided.",
    );

    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () =>
          Response.json({
            version: 1,
            type: "evjs.rsc",
            buildId: "test",
            assets: {
              js: [" dashboard-rsc.js "],
              css: [],
            },
          }),
      }),
    ).rejects.toThrow(
      '[evjs] RSC debug payload response.assets.js item " dashboard-rsc.js " must not contain leading or trailing whitespace.',
    );

    await expect(
      fetchRscDebugPayload({
        runtime: createRscRuntime(),
        pageId: "dashboard",
        url: "https://example.com/dashboard",
        fetch: async () =>
          Response.json({
            version: 1,
            type: "evjs.rsc",
            buildId: "test",
            pages: [],
          }),
      }),
    ).rejects.toThrow(
      "[evjs] RSC debug payload response.pages must be an object when provided.",
    );
  });

  it("mounts RSC payload HTML", async () => {
    const mountPoint = { innerHTML: "" } as Element & { innerHTML: string };

    mountRscDebugPayload({
      payload: {
        version: 1,
        type: "evjs.rsc",
        buildId: "test",
        html: "<h1>Dashboard</h1>",
      },
      mount: mountPoint,
    });

    expect(mountPoint.innerHTML).toBe("<h1>Dashboard</h1>");
  });

  it("validates manual RSC debug payload mounts", () => {
    const mountPoint = { innerHTML: "" } as Element & { innerHTML: string };

    expect(() => mountRscDebugPayload(null as never)).toThrow(
      "[evjs] mountRscDebugPayload() options must be an object.",
    );
    expect(() =>
      mountRscDebugPayload({
        payload: {
          version: 1,
          type: "evjs.rsc",
          buildId: "test",
          html: 42,
        } as never,
        mount: mountPoint,
      }),
    ).toThrow(
      "[evjs] mountRscDebugPayload() payload.html must be a string when provided.",
    );
    expect(() =>
      mountRscDebugPayload({
        payload: {
          version: 1,
          type: "evjs.rsc",
          buildId: "test",
        },
        mount: " #app",
      }),
    ).toThrow(
      "[evjs] mountRscDebugPayload() mount must not include leading or trailing whitespace.",
    );
  });

  it("loads and mounts an RSC page", async () => {
    const mountPoint = { innerHTML: "" } as Element & { innerHTML: string };
    const payload = await loadRscDebugPage({
      runtime: createRscRuntime(),
      pageId: "dashboard",
      url: "https://example.com/dashboard",
      mount: mountPoint,
      async fetch() {
        return Response.json({
          version: 1,
          type: "evjs.rsc",
          buildId: "test",
          html: "<h1>Dashboard</h1>",
        });
      },
    });

    expect(payload.html).toBe("<h1>Dashboard</h1>");
    expect(mountPoint.innerHTML).toBe("<h1>Dashboard</h1>");
  });
});

function createRscRuntime(): ClientRuntime {
  return {
    version: 1,
    buildId: "test",
    runtime: {
      server: {
        rsc: "__evjs/rsc",
      },
    },
    pages: {},
    routes: [],
  };
}
