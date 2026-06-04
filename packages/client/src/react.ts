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
  props?: Record<string, unknown>;
}

export interface ReactPageMountOptions {
  component: ComponentType;
  hydrate?: HydrationMode;
  render?: RenderMode;
  props?: Record<string, unknown>;
}

export interface RscFlightFetchOptions {
  manifest: BuildOutput;
  pageId?: string;
  url?: string | URL;
  fetch?: typeof fetch;
}

export interface RscDebugPayload {
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

export interface RscDebugPayloadMountOptions {
  payload: RscDebugPayload;
  mount: string | Element;
}

/**
 * @deprecated Use `RscDebugPayload`. Real React Flight rendering uses
 * `createReactRscModel()` and `mountReactRscPage()`.
 */
export type RscPayload = RscDebugPayload;

/**
 * @deprecated Use `RscDebugPayloadMountOptions`.
 */
export type RscPayloadMountOptions = RscDebugPayloadMountOptions;

const rootByMountPoint = new WeakMap<Element, Root>();

export function createReactPageModule(
  options: ReactPageMountOptions,
): AppModule {
  return {
    mount(mountPoint, ctx) {
      if (options.hydrate === "none") return;
      mountReactRoot(
        mountPoint,
        options.component,
        resolvePageProps(options, ctx),
      );
    },
    hydrate(mountPoint, ctx) {
      if (options.hydrate === "none") return;
      const props = resolvePageProps(options, ctx);
      if (shouldHydrate(options)) {
        const root = hydrateRoot(
          mountPoint,
          createElement(options.component, props),
        );
        rootByMountPoint.set(mountPoint, root);
        return;
      }

      mountReactRoot(mountPoint, options.component, props);
    },
    unmount(mountPoint) {
      rootByMountPoint.get(mountPoint)?.unmount();
      rootByMountPoint.delete(mountPoint);
    },
  };
}

function mountReactRoot(
  mountPoint: Element,
  component: ComponentType,
  props: Record<string, unknown>,
) {
  const root = createRoot(mountPoint);
  root.render(createElement(component, props));
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

export async function fetchRscDebugPayload(
  options: RscFlightFetchOptions,
): Promise<RscDebugPayload> {
  const response = await fetchRscFlight(options);
  if (!response.ok) {
    throw new Error(
      `[evjs] RSC debug payload request failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as unknown;
  if (!isRscDebugPayload(payload)) {
    throw new Error(
      "[evjs] RSC debug payload response is not an evjs RSC debug payload.",
    );
  }
  return payload;
}

export function mountRscDebugPayload(
  options: RscDebugPayloadMountOptions,
): void {
  const mountPoint = resolveMountPoint(options.mount);
  mountPoint.innerHTML = options.payload.html ?? "";
}

export async function loadRscDebugPage(
  options: RscFlightFetchOptions & { mount: string | Element },
): Promise<RscDebugPayload> {
  const payload = await fetchRscDebugPayload(options);
  mountRscDebugPayload({ payload, mount: options.mount });
  return payload;
}

/**
 * @deprecated Use `fetchRscDebugPayload`.
 */
export const fetchRscPayload = fetchRscDebugPayload;

/**
 * @deprecated Use `mountRscDebugPayload`.
 */
export const mountRscPayload = mountRscDebugPayload;

/**
 * @deprecated Use `loadRscDebugPage`.
 */
export const loadRscPage = loadRscDebugPage;

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

function resolvePageProps(
  options: ReactPageMountOptions,
  ctx?: AppContext,
): Record<string, unknown> {
  return (
    options.props ??
    readEmbeddedPageProps() ??
    (ctx ? pagePropsFromContext(ctx) : undefined) ??
    {}
  );
}

function readEmbeddedPageProps(): Record<string, unknown> | undefined {
  const doc = globalThis.document;
  if (!doc) return undefined;

  const script = doc.getElementById("__EVJS_PAGE_PROPS__");
  const text = script?.textContent?.trim();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function pagePropsFromContext(ctx: AppContext): Record<string, unknown> {
  if (ctx.kind !== "page") return {};
  const route = ctx.manifest.routes.find(
    (candidate) => candidate.pageId === ctx.id,
  );

  return {
    manifest: {
      buildId: ctx.manifest.buildId,
    },
    pageId: ctx.id,
    route: route
      ? {
          id: route.id,
          path: route.path,
        }
      : undefined,
  };
}

function isRscDebugPayload(value: unknown): value is RscDebugPayload {
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
