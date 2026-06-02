import type {
  BuildOutput,
  HydrationMode,
  RenderMode,
} from "@evjs/shared/manifest";
import { type ComponentType, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import type { AppContext, AppModule } from "./shell.js";

export interface ReactPageRuntimeOptions {
  component: ComponentType;
  mount: string | Element;
  hydrate?: HydrationMode;
  render?: RenderMode;
}

export interface ReactPageMountOptions {
  component: ComponentType;
  hydrate?: HydrationMode;
  render?: RenderMode;
}

export interface RscFlightFetchOptions {
  manifest: BuildOutput;
  pageId?: string;
  url?: string | URL;
  fetch?: typeof fetch;
}

export interface RscPayload {
  version: 1;
  type: "evjs.rsc";
  buildId: string;
  endpoint?: string;
  pageId?: string;
  renderer?: string;
  html?: string;
  assets?: {
    js: string[];
    css: string[];
  };
  clientReferences?: Record<string, unknown>;
  serverReferences?: Record<string, unknown>;
  pages?: NonNullable<BuildOutput["rsc"]>["pages"];
}

export interface RscPayloadMountOptions {
  payload: RscPayload;
  mount: string | Element;
}

const rootByMountPoint = new WeakMap<Element, Root>();

export function createReactPageModule(
  options: ReactPageMountOptions,
): AppModule {
  return {
    mount(mountPoint) {
      if (options.hydrate === "none") return;
      mountReactRoot(mountPoint, options.component);
    },
    hydrate(mountPoint) {
      if (options.hydrate === "none") return;
      if (shouldHydrate(options)) {
        const root = hydrateRoot(mountPoint, createElement(options.component));
        rootByMountPoint.set(mountPoint, root);
        return;
      }

      mountReactRoot(mountPoint, options.component);
    },
    unmount(mountPoint) {
      rootByMountPoint.get(mountPoint)?.unmount();
      rootByMountPoint.delete(mountPoint);
    },
  };
}

function mountReactRoot(mountPoint: Element, component: ComponentType) {
  const root = createRoot(mountPoint);
  root.render(createElement(component));
  rootByMountPoint.set(mountPoint, root);
}

export function mountReactPage(options: ReactPageRuntimeOptions): void {
  if (options.hydrate === "none") return;

  const mountPoint = resolveMountPoint(options.mount);
  const mod = createReactPageModule(options);
  if (shouldHydrate(options)) {
    void mod.hydrate?.(mountPoint, {} as AppContext);
    return;
  }

  void mod.mount?.(mountPoint, {} as AppContext);
}

export async function fetchRscFlight(
  options: RscFlightFetchOptions,
): Promise<Response> {
  const endpoint =
    options.manifest.rsc?.endpoint ?? options.manifest.runtime.server?.rsc;
  if (!endpoint) {
    throw new Error(
      "[evjs] RSC Flight endpoint is not present in the manifest.",
    );
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("[evjs] RSC Flight fetch requires a fetch implementation.");
  }

  return fetchImpl(resolveRscFlightUrl(endpoint, options));
}

export async function fetchRscPayload(
  options: RscFlightFetchOptions,
): Promise<RscPayload> {
  const response = await fetchRscFlight(options);
  if (!response.ok) {
    throw new Error(
      `[evjs] RSC Flight request failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as unknown;
  if (!isRscPayload(payload)) {
    throw new Error("[evjs] RSC Flight response is not an evjs RSC payload.");
  }
  return payload;
}

export function mountRscPayload(options: RscPayloadMountOptions): void {
  const mountPoint = resolveMountPoint(options.mount);
  mountPoint.innerHTML = options.payload.html ?? "";
}

export async function loadRscPage(
  options: RscFlightFetchOptions & { mount: string | Element },
): Promise<RscPayload> {
  const payload = await fetchRscPayload(options);
  mountRscPayload({ payload, mount: options.mount });
  return payload;
}

function resolveRscFlightUrl(
  endpoint: string,
  options: RscFlightFetchOptions,
): string {
  const base = options.url?.toString() ?? globalThis.location?.href ?? endpoint;
  const url = new URL(endpoint, base);
  if (options.pageId) {
    url.searchParams.set("page", options.pageId);
  }
  return url.toString();
}

function isRscPayload(value: unknown): value is RscPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { version?: unknown }).version === 1 &&
      (value as { type?: unknown }).type === "evjs.rsc",
  );
}

function shouldHydrate(options: {
  hydrate?: HydrationMode;
  render?: RenderMode;
}): boolean {
  return options.hydrate !== "none" && options.render !== "csr";
}

function resolveMountPoint(mount: string | Element): Element {
  if (typeof mount !== "string") return mount;
  const mountPoint = document.querySelector(mount);
  if (!mountPoint) {
    throw new Error(`[evjs] Mount point "${mount}" was not found.`);
  }
  return mountPoint;
}
