import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeneratedReactPageEntry } from "../src/framework/page/react-page.js";
import { mountReactPage } from "../src/rsc/react.js";

vi.mock("../src/rsc/react.js", () => ({
  createReactPageModule: vi.fn(() => ({ mount: vi.fn() })),
  mountReactPage: vi.fn(),
}));

const entryHref = "https://example.com/assets/page-client-index.js";
const runtimeHref = "https://example.com/assets/shared-runtime.js";
const sourceHref = "file:///ROOT/.ev/entries/page-client-index.ts";
const options = {
  mount: "#app",
  route: { id: "index", path: "/" },
} as const;

function Component() {
  return null;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("generated React page entry", () => {
  it("registers by page identity when the route has a different id", () => {
    browserDocument({
      currentScript: script(runtimeHref),
      scripts: [script(entryHref), script(runtimeHref)],
      runtime: pageRuntime(),
    });

    const mod = createGeneratedReactPageEntry(
      Component,
      { ...options, pageId: "home" },
      sourceHref,
    );

    expect(globalThis.__EVJS_SHELL_MODULES__).toEqual({ [entryHref]: mod });
    expect(mountReactPage).toHaveBeenCalledExactlyOnceWith({
      component: Component,
      ...options,
    });
  });

  it("registers a page without a route and honors its bootstrap shell marker", () => {
    browserDocument({
      currentScript: script(runtimeHref),
      scripts: [script(entryHref, true), script(runtimeHref)],
      runtime: {
        routing: {
          kind: "mpa",
          pages: {
            home: { module: { href: "/assets/page-client-index.js" } },
          },
        },
      },
    });

    const mod = createGeneratedReactPageEntry(
      Component,
      { pageId: "home", mount: "#app" },
      sourceHref,
    );

    expect(globalThis.__EVJS_SHELL_MODULES__).toEqual({ [entryHref]: mod });
    expect(mountReactPage).not.toHaveBeenCalled();
  });

  it("registers the page bootstrap when a shared runtime is the current script", () => {
    const entryScript = script(entryHref);
    const runtimeScript = script(runtimeHref);
    browserDocument({
      currentScript: runtimeScript,
      scripts: [entryScript, runtimeScript],
      runtime: pageRuntime(),
    });

    const mod = createGeneratedReactPageEntry(Component, options, sourceHref);

    expect(globalThis.__EVJS_SHELL_MODULES__).toEqual({ [entryHref]: mod });
    expect(mountReactPage).toHaveBeenCalledOnce();
  });

  it.each([
    "shared-runtime",
    "none",
  ])("honors the page bootstrap's shell marker with %s as the current script", (current) => {
    const entryScript = script(entryHref, true);
    const runtimeScript = script(runtimeHref);
    browserDocument({
      currentScript: current === "shared-runtime" ? runtimeScript : null,
      scripts: [entryScript, runtimeScript],
      runtime: pageRuntime(),
    });

    const mod = createGeneratedReactPageEntry(Component, options, sourceHref);

    expect(globalThis.__EVJS_SHELL_MODULES__).toEqual({ [entryHref]: mod });
    expect(mountReactPage).not.toHaveBeenCalled();
  });

  it("mounts a page even when an unrelated runtime script has a shell marker", () => {
    browserDocument({
      currentScript: script(runtimeHref, true),
      scripts: [script(entryHref), script(runtimeHref, true)],
      runtime: pageRuntime(),
    });

    createGeneratedReactPageEntry(Component, options, sourceHref);

    expect(mountReactPage).toHaveBeenCalledOnce();
  });

  it("keeps the current script fallback for inline bundler runtimes", () => {
    const entryScript = script(entryHref, true);
    browserDocument({ currentScript: entryScript, scripts: [entryScript] });

    const mod = createGeneratedReactPageEntry(Component, options, sourceHref);

    expect(globalThis.__EVJS_SHELL_MODULES__).toEqual({ [entryHref]: mod });
    expect(mountReactPage).not.toHaveBeenCalled();
  });

  it("keeps the executing entry's shell marker when another copy is already in the document", () => {
    const shellScript = script(entryHref, true);
    browserDocument({
      currentScript: shellScript,
      scripts: [script(entryHref), shellScript],
      runtime: pageRuntime(),
    });

    createGeneratedReactPageEntry(Component, options, sourceHref);

    expect(mountReactPage).not.toHaveBeenCalled();
  });

  it("uses a browser import.meta.url and its shell marker without a current script", () => {
    browserDocument({
      currentScript: null,
      scripts: [script(entryHref, true)],
    });

    const mod = createGeneratedReactPageEntry(Component, options, entryHref);

    expect(globalThis.__EVJS_SHELL_MODULES__).toEqual({ [entryHref]: mod });
    expect(mountReactPage).not.toHaveBeenCalled();
  });

  it("keeps the import.meta.url fallback outside a document", () => {
    vi.stubGlobal("__EVJS_SHELL_MODULES__", undefined);
    vi.stubGlobal("document", undefined);

    const mod = createGeneratedReactPageEntry(Component, options, entryHref);

    expect(globalThis.__EVJS_SHELL_MODULES__).toEqual({ [entryHref]: mod });
  });
});

function script(src: string, shellLoad = false) {
  return {
    tagName: "SCRIPT",
    src,
    getAttribute(name: string) {
      return name === "data-evjs-shell-load" && shellLoad ? "true" : null;
    },
  };
}

function pageRuntime() {
  return {
    routing: {
      kind: "mpa",
      pages: {
        home: {
          routeId: "index",
          module: { href: "/assets/page-client-index.js" },
        },
      },
    },
  };
}

function browserDocument(options: {
  currentScript: ReturnType<typeof script> | null;
  scripts: ReturnType<typeof script>[];
  runtime?: unknown;
}) {
  vi.stubGlobal("__EVJS_SHELL_MODULES__", undefined);
  vi.stubGlobal("location", { href: "https://example.com/index.html" });
  vi.stubGlobal("document", {
    currentScript: options.currentScript,
    scripts: options.scripts,
    getElementById(id: string) {
      return id === "__EVJS_CLIENT_RUNTIME__" && options.runtime
        ? { textContent: JSON.stringify(options.runtime) }
        : null;
    },
  });
}
