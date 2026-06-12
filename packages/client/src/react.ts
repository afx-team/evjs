import type {
  BuildOutput,
  HydrationMode,
  RenderMode,
} from "@evjs/shared/manifest";
import {
  type ComponentType,
  createContext,
  createElement,
  useContext,
} from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { type FileRoutePageProps, FileRouteProvider } from "./file-route.js";
import type {
  ActivationRequest,
  AppContext,
  AppModule,
  RemoteSharedResolution,
} from "./shell.js";

export interface ReactPageRuntimeOptions {
  component: ComponentType;
  mount: string | Element;
  hydrate?: HydrationMode;
  render?: RenderMode;
  route?: ReactPageRouteContext;
  props?: Record<string, unknown>;
}

export interface ReactPageMountOptions {
  component: ComponentType;
  hydrate?: HydrationMode;
  render?: RenderMode;
  route?: ReactPageRouteContext;
  props?:
    | Record<string, unknown>
    | ((ctx?: AppContext) => Record<string, unknown>);
}

export interface ReactPageRouteContext {
  id: string;
  path: string;
}

export interface RemoteRuntimeContext {
  id: string;
  name: string;
  entryId: string;
  baseUrl?: string;
  source: string;
  requestUrl?: string;
  shared: RemoteRuntimeSharedContext;
}

export interface RemoteRuntimeSharedContext {
  provided: Record<string, RemoteRuntimeSharedEntry>;
  missing: string[];
  incompatible: RemoteSharedResolution["incompatible"];
  version(...names: string[]): string | undefined;
}

export interface RemoteRuntimeSharedEntry {
  version?: string;
  singleton?: boolean;
  eager?: boolean;
  loaded?: boolean;
  from?: string;
}

export interface RemoteReactProps {
  remote: RemoteRuntimeContext;
  request: ActivationRequest;
}

export interface RemoteReactModuleExports {
  default?: ComponentType<RemoteReactProps>;
  init?: AppModule["init"];
  mount?: AppModule["mount"];
  hydrate?: AppModule["hydrate"];
  unmount?: AppModule["unmount"];
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

const rootByMountPoint = new WeakMap<Element, Root>();
const RemoteContext = createContext<RemoteRuntimeContext | undefined>(
  undefined,
);

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
        options.route,
      );
    },
    hydrate(mountPoint, ctx) {
      if (options.hydrate === "none") return;
      const props = resolvePageProps(options, ctx);
      if (shouldHydrate(options)) {
        const root = hydrateRoot(
          mountPoint,
          createReactPageElement(options.component, props, options.route),
        );
        rootByMountPoint.set(mountPoint, root);
        return;
      }

      mountReactRoot(mountPoint, options.component, props, options.route);
    },
    unmount(mountPoint) {
      rootByMountPoint.get(mountPoint)?.unmount();
      rootByMountPoint.delete(mountPoint);
    },
  };
}

export function createRemoteReactModule(
  exports: RemoteReactModuleExports,
): AppModule {
  if (isLifecycleModule(exports)) return exports as AppModule;

  if (!exports.default) {
    throw new Error(
      "[evjs] Remote modules must export a default React component or lifecycle functions.",
    );
  }

  return {
    ...createReactPageModule({
      component: RemoteReactRoot as ComponentType,
      hydrate: "load",
      render: "csr",
      props(ctx) {
        return {
          component: exports.default,
          remote: createRemoteRuntimeContext(ctx),
          request: ctx?.request ?? {},
        };
      },
    }),
    init: exports.init,
  };
}

export function useRemoteContext(): RemoteRuntimeContext {
  const ctx = useContext(RemoteContext);
  if (!ctx) {
    throw new Error(
      "[evjs] useRemoteContext() must be used inside an evjs remote React module.",
    );
  }
  return ctx;
}

export function createRemoteRuntimeContext(
  ctx: AppContext | undefined,
): RemoteRuntimeContext {
  const remote = ctx?.remote;
  const provided = sanitizeRemoteSharedEntries(remote?.shared.provided ?? {});

  return {
    id: remote?.id ?? ctx?.id ?? "unknown",
    name: remote?.manifest.name ?? remote?.id ?? ctx?.id ?? "unknown",
    entryId: remote?.entryId ?? "unknown",
    baseUrl: remote?.manifest.baseUrl,
    source: getRemoteSourceLabel(remote?.manifest.baseUrl),
    requestUrl: ctx?.request.url?.toString(),
    shared: {
      provided,
      missing: remote?.shared.missing ?? [],
      incompatible: remote?.shared.incompatible ?? [],
      version(...names) {
        for (const name of names) {
          const version = provided[name]?.version;
          if (version) return version;
        }
        return undefined;
      },
    },
  };
}

function sanitizeRemoteSharedEntries(
  provided: RemoteSharedResolution["provided"],
): Record<string, RemoteRuntimeSharedEntry> {
  return Object.fromEntries(
    Object.entries(provided).map(([name, entry]) => [
      name,
      {
        version: entry.version,
        singleton: entry.singleton,
        eager: entry.eager,
        loaded: entry.loaded,
        from: entry.from,
      },
    ]),
  );
}

interface RemoteReactRootProps {
  component: ComponentType<RemoteReactProps>;
  remote: RemoteRuntimeContext;
  request: ActivationRequest;
}

function RemoteReactRoot({ component, remote, request }: RemoteReactRootProps) {
  return createElement(
    RemoteContext.Provider,
    { value: remote },
    createElement(component, { remote, request }),
  );
}

function isLifecycleModule(exports: RemoteReactModuleExports): boolean {
  return (
    typeof exports.mount === "function" ||
    typeof exports.hydrate === "function" ||
    typeof exports.unmount === "function"
  );
}

function mountReactRoot(
  mountPoint: Element,
  component: ComponentType,
  props: Record<string, unknown>,
  route?: ReactPageRouteContext,
) {
  const root = createRoot(mountPoint);
  root.render(createReactPageElement(component, props, route));
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
  const explicitProps =
    typeof options.props === "function" ? options.props(ctx) : options.props;

  return (
    explicitProps ??
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

function createReactPageElement(
  component: ComponentType,
  props: Record<string, unknown>,
  route?: ReactPageRouteContext,
) {
  if (!shouldProvideFileRouteProps(props, route)) {
    return createElement(component, props);
  }

  const fileRouteProps = resolveFileRoutePageProps(props, route);
  return createElement(
    FileRouteProvider,
    { value: fileRouteProps },
    createElement(component, props),
  );
}

function shouldProvideFileRouteProps(
  props: Record<string, unknown>,
  route?: ReactPageRouteContext,
): boolean {
  return (
    Boolean(route) ||
    isRecord(props.params) ||
    isRecord(props.search) ||
    "loaderData" in props
  );
}

function resolveFileRoutePageProps(
  props: Record<string, unknown>,
  explicitRoute?: ReactPageRouteContext,
): FileRoutePageProps {
  const route = explicitRoute ?? readRouteContext(props.route);
  return {
    params: isStringRecord(props.params)
      ? props.params
      : route
        ? matchRouteParams(route.path, readLocationPathname())
        : {},
    search: isRecord(props.search) ? props.search : readLocationSearch(),
    loaderData: props.loaderData,
  };
}

function readRouteContext(value: unknown): ReactPageRouteContext | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.id === "string" && typeof value.path === "string"
    ? { id: value.id, path: value.path }
    : undefined;
}

function readLocationPathname(): string {
  return globalThis.location?.pathname ?? "/";
}

function readLocationSearch(): Record<string, string> {
  const search = globalThis.location?.search;
  if (!search) return {};

  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    result[key] = value;
  }
  return result;
}

function matchRouteParams(
  routePath: string,
  pathname: string,
): Record<string, string> {
  const routeSegments = splitPath(routePath);
  const pathSegments = splitPath(pathname);
  const params: Record<string, string> = {};

  routeSegments.forEach((segment, index) => {
    if (!segment.startsWith("$")) return;
    const name = segment.slice(1) || "_splat";
    params[name] = decodeURIComponent(pathSegments[index] ?? "");
  });

  return params;
}

function splitPath(value: string): string[] {
  return value
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

function getRemoteSourceLabel(baseUrl: string | undefined): string {
  if (!baseUrl) return "served from remote manifest";

  try {
    const url = new URL(baseUrl);
    return `served from ${url.host}`;
  } catch {
    return `served from ${baseUrl}`;
  }
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
