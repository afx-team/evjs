import type {
  AssetGroup,
  BuildOutput,
  PublicPathOutput,
} from "@evjs/shared/manifest";
import { createElement, type ReactNode, Suspense } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { fetchRscFlight, type RscFlightFetchOptions } from "./react.js";

export interface ReactRscModelOptions extends RscFlightFetchOptions {
  moduleBaseURL?: string;
}

export interface ReactRscMountOptions extends ReactRscModelOptions {
  mount: string | Element;
  fallback?: ReactNode;
  hydrate?: boolean;
}

export interface ReactRscRuntimeBootstrap {
  version: 1;
  buildId: string;
  pageId: string;
  endpoint: string;
  basePath?: string;
  publicPath?: PublicPathOutput;
  mount: string;
  page?: {
    assets?: AssetGroup;
    routeId?: string;
  };
}

const rootByMountPoint = new WeakMap<Element, Root>();
let runtimeStarted = false;

export async function createReactRscModel(
  options: ReactRscModelOptions,
): Promise<ReactNode> {
  const { createFromFetch } = await import("react-server-dom-webpack/client");
  return createFromFetch(fetchRscFlight(options), {
    moduleBaseURL: options.moduleBaseURL,
  }) as ReactNode;
}

export async function mountReactRscPage(
  options: ReactRscMountOptions,
): Promise<ReactNode> {
  const mountPoint = resolveMountPoint(options.mount);
  const model = await createReactRscModel(options);
  const element = createRscRootElement(model, options);
  const root =
    options.hydrate === false
      ? createRoot(mountPoint)
      : hydrateRoot(mountPoint, element);
  if (options.hydrate === false) {
    root.render(element);
  }
  rootByMountPoint.set(mountPoint, root);
  return model;
}

function createRscRootElement(
  model: ReactNode,
  options: ReactRscMountOptions,
): ReactNode {
  if (options.hydrate !== false) return model;
  if (options.fallback === undefined) return model;
  return createElement(Suspense, { fallback: options.fallback }, model);
}

export function unmountReactRscPage(mount: string | Element): void {
  const mountPoint = resolveMountPoint(mount);
  rootByMountPoint.get(mountPoint)?.unmount();
  rootByMountPoint.delete(mountPoint);
}

export async function startReactRscPageRuntime(
  options: { document?: Document; bootstrap?: ReactRscRuntimeBootstrap } = {},
): Promise<ReactNode | undefined> {
  const doc = options.document ?? globalThis.document;
  const bootstrap = options.bootstrap ?? readRscBootstrap(doc);
  if (!bootstrap) return undefined;

  runtimeStarted = true;
  return mountReactRscPage({
    manifest: createBootstrapManifest(bootstrap),
    pageId: bootstrap.pageId,
    moduleBaseURL: publicPathModuleBaseURL(bootstrap.publicPath, doc),
    mount: bootstrap.mount,
    url: doc.location?.href,
  });
}

function publicPathModuleBaseURL(
  publicPath: PublicPathOutput | undefined,
  document: Document,
): string | undefined {
  if (typeof publicPath !== "string") return undefined;
  try {
    return new URL(
      publicPath,
      document.baseURI || document.location?.href,
    ).toString();
  } catch {
    return publicPath;
  }
}

function resolveMountPoint(mount: string | Element): Element {
  if (typeof mount !== "string") return mount;
  const mountPoint = document.querySelector(mount);
  if (!mountPoint) {
    throw new Error(`[evjs] Mount point "${mount}" was not found.`);
  }
  return mountPoint;
}

function readRscBootstrap(
  document: Document | undefined,
): ReactRscRuntimeBootstrap | undefined {
  const text = document
    ?.getElementById("__EVJS_RSC_BOOTSTRAP__")
    ?.textContent?.trim();
  if (!text) return undefined;

  try {
    const value = JSON.parse(text) as Partial<ReactRscRuntimeBootstrap>;
    if (
      value.version !== 1 ||
      typeof value.buildId !== "string" ||
      typeof value.pageId !== "string" ||
      typeof value.endpoint !== "string" ||
      typeof value.mount !== "string"
    ) {
      return undefined;
    }
    return value as ReactRscRuntimeBootstrap;
  } catch {
    return undefined;
  }
}

function createBootstrapManifest(
  bootstrap: ReactRscRuntimeBootstrap,
): BuildOutput {
  const basePath = bootstrap.basePath ?? "/__evjs";
  return {
    version: 1,
    buildId: bootstrap.buildId,
    distDir: "",
    publicPath: bootstrap.publicPath ?? "/",
    runtime: {
      server: {
        basePath,
        fn: joinEndpoint(basePath, "fn"),
        rsc: bootstrap.endpoint,
      },
      transport: {},
    },
    assets: {},
    apps: {},
    pages: {
      [bootstrap.pageId]: {
        assets: bootstrap.page?.assets ?? { js: [], css: [] },
        render: "ssr",
        componentModel: "rsc",
        rendering: {
          component: "rsc",
          html: "server",
          streaming: true,
          hydrate: "load",
        },
        routeId: bootstrap.page?.routeId,
      },
    },
    routes: [],
    rsc: {
      endpoint: bootstrap.endpoint,
      pages: {
        [bootstrap.pageId]: {
          assets: bootstrap.page?.assets ?? { js: [], css: [] },
          routeId: bootstrap.page?.routeId,
        },
      },
    },
  };
}

function joinEndpoint(basePath: string, name: string): string {
  return `/${basePath.split("/").concat(name).filter(Boolean).join("/")}`;
}

function scheduleRscRuntimeStart(): void {
  if (runtimeStarted || typeof document === "undefined") return;

  const start = () => {
    if (runtimeStarted) return;
    void startReactRscPageRuntime().catch((error: unknown) => {
      console.error("[evjs] RSC page runtime failed to start.", error);
    });
  };

  if (typeof queueMicrotask === "function") {
    queueMicrotask(start);
    return;
  }

  void Promise.resolve().then(start);
}

scheduleRscRuntimeStart();
