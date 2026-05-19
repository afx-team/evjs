import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, createAppRootRoute } from "../src/index";

const reactDomClient = vi.hoisted(() => ({
  createRoot: vi.fn(() => ({
    render: vi.fn(),
    unmount: vi.fn(),
  })),
  hydrateRoot: vi.fn(() => ({
    unmount: vi.fn(),
  })),
}));

vi.mock("react-dom/client", () => reactDomClient);

function createRouteTree() {
  return createAppRootRoute({
    component: () => null,
  });
}

describe("createApp", () => {
  beforeEach(() => {
    reactDomClient.createRoot.mockClear();
    reactDomClient.hydrateRoot.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps TanStack Router global catch boundary by default", () => {
    const app = createApp({ routeTree: createRouteTree() });

    expect(app.router.options.disableGlobalCatchBoundary).toBeUndefined();
  });

  it("can disable TanStack Router global catch boundary from app options", () => {
    const app = createApp({
      routeTree: createRouteTree(),
      router: { disableGlobalCatchBoundary: true },
    });

    expect(app.router.options.disableGlobalCatchBoundary).toBe(true);
  });

  it("passes TanStack Router options through", () => {
    const app = createApp({
      routeTree: createRouteTree(),
      router: {
        basepath: "/app",
        caseSensitive: true,
        defaultPreload: false,
      },
    });

    expect(app.router.options.basepath).toBe("/app");
    expect(app.router.options.caseSensitive).toBe(true);
    expect(app.router.options.defaultPreload).toBe(false);
  });

  it("does not auto-hydrate existing DOM without a router SSR payload", () => {
    vi.stubGlobal("window", {});
    const app = createApp({ routeTree: createRouteTree() });
    const container = {
      hasChildNodes: () => true,
    } as HTMLElement;

    app.render(container);

    expect(reactDomClient.hydrateRoot).not.toHaveBeenCalled();
    expect(reactDomClient.createRoot).toHaveBeenCalledWith(container);
  });

  it("auto-hydrates existing DOM when the router SSR payload is present", () => {
    vi.stubGlobal("window", { $_TSR: {} });
    const app = createApp({ routeTree: createRouteTree() });
    const container = {
      hasChildNodes: () => true,
    } as HTMLElement;

    app.render(container);

    expect(reactDomClient.hydrateRoot).toHaveBeenCalledWith(
      container,
      expect.anything(),
      expect.objectContaining({
        onRecoverableError: expect.any(Function),
      }),
    );
    expect(reactDomClient.createRoot).not.toHaveBeenCalled();
  });

  it("reports recoverable hydration errors", () => {
    vi.stubGlobal("window", { $_TSR: {} });
    const onHydrationError = vi.fn();
    const app = createApp({
      routeTree: createRouteTree(),
      onHydrationError,
    });
    const container = {
      hasChildNodes: () => true,
    } as HTMLElement;

    app.render(container);

    const hydrateRootCalls = reactDomClient.hydrateRoot.mock
      .calls as unknown as Array<
      [
        HTMLElement,
        unknown,
        {
          onRecoverableError?: (
            error: unknown,
            errorInfo: { componentStack?: string },
          ) => void;
        },
      ]
    >;
    const hydrateOptions = hydrateRootCalls[0]?.[2];
    const error = new Error("mismatch");
    const errorInfo = { componentStack: "stack" };
    hydrateOptions?.onRecoverableError?.(error, errorInfo);

    expect(onHydrationError).toHaveBeenCalledWith(error, {
      phase: "recoverable",
      errorInfo,
    });
  });

  it("falls back to client rendering when hydrateRoot throws synchronously", () => {
    vi.stubGlobal("window", { $_TSR: {} });
    const error = new Error("hydrate failed");
    const onHydrationError = vi.fn();
    reactDomClient.hydrateRoot.mockImplementationOnce(() => {
      throw error;
    });
    const app = createApp({
      routeTree: createRouteTree(),
      onHydrationError,
    });
    const container = {
      hasChildNodes: () => true,
    } as HTMLElement;

    app.render(container);

    expect(onHydrationError).toHaveBeenCalledWith(error, {
      phase: "fallback",
    });
    expect(reactDomClient.createRoot).toHaveBeenCalledWith(container);
    expect(
      reactDomClient.createRoot.mock.results[0]?.value.render,
    ).toHaveBeenCalledWith(expect.anything());
  });

  it("wraps router hydration with a client-render fallback boundary", () => {
    vi.stubGlobal("window", { $_TSR: {} });
    const onHydrationError = vi.fn();
    const app = createApp({
      routeTree: createRouteTree(),
      onHydrationError,
    });
    const container = {
      hasChildNodes: () => true,
    } as HTMLElement;

    app.render(container);

    const hydrateRootCalls = reactDomClient.hydrateRoot.mock
      .calls as unknown as Array<[HTMLElement, unknown]>;
    const appElement = hydrateRootCalls[0]?.[1] as {
      props: { children: { type: unknown; props: Record<string, unknown> } };
    };
    const boundaryElement = appElement.props.children;
    const Boundary = boundaryElement.type as {
      new (
        props: Record<string, unknown>,
      ): {
        props: Record<string, unknown>;
        state: unknown;
        render: () => unknown;
        componentDidCatch: (
          error: unknown,
          errorInfo: { componentStack?: string },
        ) => void;
      };
      getDerivedStateFromError: (error: unknown) => unknown;
    };
    const instance = new Boundary(boundaryElement.props);
    const error = new Error("router hydration failed");
    const errorInfo = { componentStack: "stack" };

    instance.componentDidCatch(error, errorInfo);
    instance.state = Boundary.getDerivedStateFromError(error);

    expect(onHydrationError).toHaveBeenCalledWith(error, {
      phase: "fallback",
      errorInfo,
    });
    expect(instance.render()).toBe(boundaryElement.props.fallback);
  });
});
