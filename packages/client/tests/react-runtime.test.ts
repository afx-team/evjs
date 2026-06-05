import type { BuildOutput } from "@evjs/shared/manifest";
import { describe, expect, it, vi } from "vitest";
import {
  createReactPageModule,
  fetchRscDebugPayload,
  fetchRscFlight,
  loadRscDebugPage,
  mountRscDebugPayload,
} from "../src/react.js";

const calls: string[] = [];
const renderedElements: unknown[] = [];

vi.mock("react-dom/client", () => ({
  createRoot() {
    calls.push("createRoot");
    return {
      render(element: unknown) {
        renderedElements.push(element);
        calls.push("render");
      },
      unmount() {
        calls.push("unmount");
      },
    };
  },
  hydrateRoot(_mountPoint: Element, element: unknown) {
    renderedElements.push(element);
    calls.push("hydrateRoot");
    return {
      unmount() {
        calls.push("unmount");
      },
    };
  },
}));

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
        id: "crm",
        kind: "remote",
      } as never,
    );

    expect(calls).toEqual(["createRoot", "render"]);
    expect((renderedElements[0] as { props?: unknown }).props).toEqual({
      kind: "remote",
      id: "crm",
    });
  });
});

describe("fetchRscFlight", () => {
  it("fetches the configured RSC endpoint with page identity", async () => {
    const fetchMock = vi.fn(async () => new Response("flight"));

    await fetchRscFlight({
      manifest: {
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
      },
      pageId: "dashboard",
      url: "https://example.com/dashboard",
      fetch: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/__evjs/rsc?page=dashboard",
    );
  });

  it("parses an evjs RSC debug payload", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            version: 1,
            type: "evjs.rsc",
            buildId: "test",
            pageId: "dashboard",
            html: "<h1>Dashboard</h1>",
          }),
        ),
    );

    await expect(
      fetchRscDebugPayload({
        manifest: createRscManifest(),
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

  it("loads and mounts an RSC page", async () => {
    const mountPoint = { innerHTML: "" } as Element & { innerHTML: string };
    const payload = await loadRscDebugPage({
      manifest: createRscManifest(),
      pageId: "dashboard",
      url: "https://example.com/dashboard",
      mount: mountPoint,
      async fetch() {
        return new Response(
          JSON.stringify({
            version: 1,
            type: "evjs.rsc",
            buildId: "test",
            html: "<h1>Dashboard</h1>",
          }),
        );
      },
    });

    expect(payload.html).toBe("<h1>Dashboard</h1>");
    expect(mountPoint.innerHTML).toBe("<h1>Dashboard</h1>");
  });
});

function createRscManifest(): BuildOutput {
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
