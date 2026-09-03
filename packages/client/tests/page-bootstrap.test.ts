import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPagesApp, startPagesApp } from "../src/internal.js";
import type { App } from "../src/standalone/app.js";

const reactRootCalls: string[] = [];
const renderedTrees: ReactNode[] = [];

vi.mock("react-dom/client", () => ({
  createRoot() {
    reactRootCalls.push("createRoot");
    return {
      render(element: ReactNode) {
        reactRootCalls.push("render");
        renderedTrees.push(element);
      },
      unmount() {
        reactRootCalls.push("unmount");
      },
    };
  },
  hydrateRoot(_container: HTMLElement, element: ReactNode) {
    reactRootCalls.push("hydrateRoot");
    renderedTrees.push(element);
    return {
      unmount() {
        reactRootCalls.push("unmount");
      },
    };
  },
}));

afterEach(() => {
  reactRootCalls.length = 0;
  renderedTrees.length = 0;
  vi.unstubAllGlobals();
});

describe("SPA page bootstrap", () => {
  it.each([
    null,
    1,
    "signal",
    false,
    {},
    { aborted: "false" },
  ])("diagnoses malformed component signals without acquiring ownership: %j", (signal) => {
    const { app } = createTestPagesApp();
    expect(() => app.createComponent({ signal } as never)).toThrow(
      "[evjs] App component options.signal must be an AbortSignal when provided.",
    );
    const handle = app.createComponent();
    handle.dispose();
    expect(reactRootCalls).toEqual([]);
  });

  it("hydrates only after the router finishes its initial load", async () => {
    const { app } = createTestPagesApp();
    const load = createDeferred<void>();
    vi.spyOn(
      app.router as unknown as { load(): Promise<void> },
      "load",
    ).mockReturnValue(load.promise);

    const render = app.render({} as HTMLElement, { hydrate: true });

    expect(reactRootCalls).toEqual([]);
    load.resolve();
    await render;
    expect(reactRootCalls).toEqual(["hydrateRoot"]);
  });

  it("cancels hydration when the app unmounts during router loading", async () => {
    const { app } = createTestPagesApp();
    const load = createDeferred<void>();
    vi.spyOn(
      app.router as unknown as { load(): Promise<void> },
      "load",
    ).mockReturnValue(load.promise);

    const render = app.render({} as HTMLElement, { hydrate: true });
    app.unmount();
    load.resolve();
    await render;

    expect(reactRootCalls).toEqual([]);
  });

  it("releases render ownership when initial hydration loading fails", async () => {
    const { app } = createTestPagesApp();
    vi.spyOn(
      app.router as unknown as { load(): Promise<void> },
      "load",
    ).mockRejectedValue(new Error("initial route failed"));

    await expect(
      app.render({} as HTMLElement, { hydrate: true }),
    ).rejects.toThrow("initial route failed");

    const component = app.createComponent();
    component.dispose();
    expect(reactRootCalls).toEqual([]);
  });

  it("remounts a loaded replacement Router after runtime configuration changes", async () => {
    function Home() {
      return null;
    }
    const pagesApp = createPagesApp({
      routes: [{ path: "/", module: { default: Home } }],
      history: { type: "memory", initialEntries: ["/catalog"] },
    });
    const firstRouter = pagesApp.app.router;

    pagesApp.app.render({} as HTMLElement);
    await pagesApp.updateRuntime({ basepath: "/catalog" });

    expect(pagesApp.app.router).not.toBe(firstRouter);
    expect(reactRootCalls).toEqual([
      "createRoot",
      "render",
      "unmount",
      "createRoot",
      "render",
    ]);
  });

  it("places Application wrappers outside all CSR providers in stable order", () => {
    function Outer({ children }: { children?: ReactNode }) {
      return children;
    }
    function Inner({ children }: { children?: ReactNode }) {
      return children;
    }
    function Home() {
      return null;
    }
    const { app } = createPagesApp({
      wrappers: [{ default: Outer }, { default: Inner }],
      routes: [{ path: "/", module: { default: Home } }],
    });

    app.render({} as HTMLElement);

    const outer = requireElement(renderedTrees[0]);
    const inner = requireElement(outer.props.children);
    const queryProvider = requireElement(inner.props.children);
    const routerProvider = requireElement(queryProvider.props.children);
    expect(outer.type).toBe(Outer);
    expect(inner.type).toBe(Inner);
    expect(queryProvider.type).toBe(QueryClientProvider);
    expect(routerProvider.type).toBe(RouterProvider);
  });

  it("stays unmounted when unmount runs while a replacement Router loads", async () => {
    const loadStarted = createDeferred<void>();
    const releaseLoad = createDeferred<void>();
    const pagesApp = createRuntimeRacePagesApp(loadStarted, releaseLoad);
    const mount = {} as HTMLElement;

    pagesApp.app.render(mount);
    const update = pagesApp.updateRuntime({ routes: [] });
    await loadStarted.promise;

    pagesApp.app.unmount();
    releaseLoad.resolve();
    await update;

    expect(reactRootCalls).toEqual(["createRoot", "render", "unmount"]);
  });

  it("keeps a render started while a replacement Router loads mounted", async () => {
    const loadStarted = createDeferred<void>();
    const releaseLoad = createDeferred<void>();
    const pagesApp = createRuntimeRacePagesApp(loadStarted, releaseLoad);
    const mount = {} as HTMLElement;

    void pagesApp.app.router;
    const update = pagesApp.updateRuntime({ routes: [] });
    await loadStarted.promise;

    pagesApp.app.render(mount);
    releaseLoad.resolve();
    await update;

    expect(reactRootCalls).toEqual([
      "createRoot",
      "render",
      "unmount",
      "createRoot",
      "render",
    ]);
  });

  it("validates render options before mounting", () => {
    const { app } = createTestPagesApp();
    const mount = {} as HTMLElement;

    expect(() => app.render(mount, null as never)).toThrow(
      "[evjs] App render options must be an object.",
    );
    expect(() => app.render(mount, { hydrate: "yes" } as never)).toThrow(
      "[evjs] App render options.hydrate must be a boolean when provided.",
    );
    expect(reactRootCalls).toEqual([]);
  });

  it("uses CSR when the mount has no server hydration marker", () => {
    const app = createBootstrapApp();
    const mount = createMount();

    startPagesApp(app, mount);

    expect(app.render).toHaveBeenCalledWith(mount, { hydrate: false });
  });

  it("starts load hydration immediately", () => {
    const app = createBootstrapApp();
    const mount = createMount("load");

    startPagesApp(app, mount);

    expect(app.render).toHaveBeenCalledWith(mount, { hydrate: true });
  });

  it.each([
    "visible",
    "idle",
  ])("rejects the unsupported %s server hydration marker", (mode) => {
    const app = createBootstrapApp();
    const mount = createMount(mode);

    expect(() => startPagesApp(app, mount)).toThrow(
      '[evjs] data-evjs-hydrate must be "load".',
    );
    expect(app.render).not.toHaveBeenCalled();
  });

  it("rejects unknown server hydration markers", () => {
    const app = createBootstrapApp();
    const mount = createMount("eager");

    expect(() => startPagesApp(app, mount)).toThrow(
      '[evjs] data-evjs-hydrate must be "load".',
    );
    expect(app.render).not.toHaveBeenCalled();
  });
});

function createTestPagesApp() {
  function Home() {
    return null;
  }
  return createPagesApp({
    routes: [{ path: "/", module: { default: Home } }],
  });
}

function createRuntimeRacePagesApp(
  loadStarted: ReturnType<typeof createDeferred<void>>,
  releaseLoad: ReturnType<typeof createDeferred<void>>,
) {
  function Home() {
    return null;
  }
  return createPagesApp({
    routes: [
      {
        path: "/",
        module: {
          default: Home,
          async loader() {
            loadStarted.resolve();
            await releaseLoad.promise;
          },
        },
      },
    ],
    history: { type: "memory", initialEntries: ["/"] },
  });
}

function createBootstrapApp(): App {
  const render = vi.fn<App["render"]>(() => Promise.resolve());
  return {
    router: {},
    queryClient: {} as App["queryClient"],
    render,
    createComponent() {
      throw new Error("not used by page bootstrap tests");
    },
    unmount() {},
  };
}

function createMount(mode?: string): HTMLElement {
  return {
    getAttribute(name: string) {
      return name === "data-evjs-hydrate" ? (mode ?? null) : null;
    },
  } as HTMLElement;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function requireElement(
  value: ReactNode,
): ReactElement<{ children?: ReactNode }> {
  if (!isValidElement<{ children?: ReactNode }>(value)) {
    throw new Error("Expected a React element.");
  }
  return value;
}
