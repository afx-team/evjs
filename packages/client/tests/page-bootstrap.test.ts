import { afterEach, describe, expect, it, vi } from "vitest";
import { createPagesApp, startPagesApp } from "../src/internal.js";
import type { App } from "../src/standalone/app.js";

const reactRootCalls: string[] = [];

vi.mock("react-dom/client", () => ({
  createRoot() {
    reactRootCalls.push("createRoot");
    return {
      render() {
        reactRootCalls.push("render");
      },
      unmount() {
        reactRootCalls.push("unmount");
      },
    };
  },
  hydrateRoot() {
    reactRootCalls.push("hydrateRoot");
    return {
      unmount() {
        reactRootCalls.push("unmount");
      },
    };
  },
}));

afterEach(() => {
  reactRootCalls.length = 0;
  vi.unstubAllGlobals();
});

describe("SPA page bootstrap", () => {
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

function createBootstrapApp(): App {
  const render = vi.fn<App["render"]>(() => Promise.resolve());
  return {
    router: {},
    queryClient: {} as App["queryClient"],
    render,
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
