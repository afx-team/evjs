import {
  findBestPageRoute,
  getRscFlightClientPageUrlParam,
  matchPageRouteParams,
  type PageSearchParams,
  parsePageSearch,
  type RscFlightClientPageUrlParamError,
} from "@evjs/shared";
import { type ComponentType, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import {
  type PageProps,
  PageProvider,
} from "../framework/page/page-context.js";
import type { AppContext, AppModule } from "../framework/shell/types.js";
import {
  assertFetchResponseObject,
  getFetchResponseContentType,
} from "../shared/fetch-response.js";
import {
  assertClientRuntime,
  type ClientRuntime,
  type ClientRuntimeTransport,
  getClientRuntimeRoutes,
  getClientRuntimeServer,
  type HydrationMode,
  type RenderMode,
  resolveClientRuntimeTransport,
} from "../shared/runtime-config.js";
import { formatErrorDetail, isRecord } from "../shared/validation.js";
import {
  isReactComponentExport,
  type ReactComponentExport,
} from "./react-component.js";

export interface ReactPageRuntimeOptions {
  component: ReactComponentExport;
  mount: string | Element;
  hydrate?: HydrationMode;
  render?: RenderMode;
  route?: ReactPageRouteContext;
  props?: Record<string, unknown>;
}

export interface ReactPageMountOptions {
  component: ReactComponentExport;
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

export interface RscFlightFetchOptions {
  runtime: ClientRuntime;
  pageId?: string;
  url?: string | URL;
  fetch?: typeof fetch;
}

interface MountedReactRoot {
  ownerToken: symbol;
  root: Root;
}

const PAGE_HYDRATION_ATTRIBUTE = "data-evjs-hydrate";
const rootByMountPoint = new WeakMap<Element, MountedReactRoot>();

export function createReactPageModule(
  options: ReactPageMountOptions,
): AppModule {
  assertReactPageMountOptions(options, "createReactPageModule()");
  const ownerToken = Symbol("ReactPageModule");

  return {
    mount(mountPoint, ctx) {
      if (options.hydrate === "none") return;
      mountReactRoot(
        mountPoint,
        options.component,
        resolvePageProps(options, ctx),
        ownerToken,
        options.route,
      );
    },
    hydrate(mountPoint, ctx) {
      if (options.hydrate === "none") return;
      const props = resolvePageProps(options, ctx);
      if (shouldHydrate(options)) {
        hydrateReactRoot(
          mountPoint,
          options.component,
          props,
          ownerToken,
          options.route,
        );
        return;
      }
      mountReactRoot(
        mountPoint,
        options.component,
        props,
        ownerToken,
        options.route,
      );
    },
    unmount(mountPoint) {
      unmountOwnedReactRoot(mountPoint, ownerToken);
    },
  };
}

function mountReactRoot(
  mountPoint: Element,
  component: ReactComponentExport,
  props: Record<string, unknown>,
  ownerToken: symbol,
  route?: ReactPageRouteContext,
) {
  unmountMountedReactRoot(mountPoint);
  let root: Root;
  try {
    root = createRoot(mountPoint);
  } catch (error) {
    throw new Error(
      `[evjs] React page createRoot failed${formatErrorDetail(error)}`,
    );
  }
  try {
    root.render(createReactPageElement(component, props, route));
  } catch (error) {
    tryUnmountReactRoot(root);
    throw new Error(
      `[evjs] React page root.render failed${formatErrorDetail(error)}`,
    );
  }
  rootByMountPoint.set(mountPoint, { ownerToken, root });
}

function hydrateReactRoot(
  mountPoint: Element,
  component: ReactComponentExport,
  props: Record<string, unknown>,
  ownerToken: symbol,
  route?: ReactPageRouteContext,
): void {
  unmountMountedReactRoot(mountPoint);
  let root: Root;
  try {
    root = hydrateRoot(
      mountPoint,
      createReactPageElement(component, props, route),
    );
  } catch (error) {
    throw new Error(
      `[evjs] React page hydrateRoot failed${formatErrorDetail(error)}`,
    );
  }
  rootByMountPoint.set(mountPoint, { ownerToken, root });
}

function unmountMountedReactRoot(mountPoint: Element): void {
  const mounted = rootByMountPoint.get(mountPoint);
  if (!mounted) return;
  rootByMountPoint.delete(mountPoint);
  try {
    mounted.root.unmount();
  } catch (error) {
    throw new Error(
      `[evjs] React page root.unmount failed${formatErrorDetail(error)}`,
    );
  }
}

function unmountOwnedReactRoot(mountPoint: Element, ownerToken: symbol): void {
  const mounted = rootByMountPoint.get(mountPoint);
  if (mounted?.ownerToken !== ownerToken) return;
  unmountMountedReactRoot(mountPoint);
}

function tryUnmountReactRoot(root: Root): void {
  try {
    root.unmount();
  } catch {
    // Preserve the render failure as the primary error.
  }
}

export function mountReactPage(options: ReactPageRuntimeOptions): void {
  assertReactPageRuntimeOptions(options);
  if (options.hydrate === "none") return;

  const mountPoint = resolveMountPoint(options.mount);
  const mod = createReactPageModule(options);
  if (mountPoint.getAttribute(PAGE_HYDRATION_ATTRIBUTE) === "load") {
    void mod.hydrate?.(mountPoint, {} as AppContext);
    return;
  }

  void mod.mount?.(mountPoint, {} as AppContext);
}

function assertReactPageRuntimeOptions(
  options: unknown,
): asserts options is ReactPageRuntimeOptions {
  assertReactPageMountOptions(options, "mountReactPage()");
  assertReactPageMountOption(
    (options as { mount?: unknown }).mount,
    "mountReactPage() mount",
  );
}

function assertReactPageMountOptions(
  options: unknown,
  source: string,
): asserts options is ReactPageMountOptions {
  if (!isRecord(options)) {
    throw new Error(`[evjs] ${source} options must be an object.`);
  }
  if (!isReactComponentExport(options.component)) {
    throw new Error(`[evjs] ${source} component must be a React component.`);
  }
  assertReactPageRenderMode(options.render, source);
  assertReactPageHydrationMode(options.hydrate, source);
  assertOptionalReactPageProps(options.props, source);
  assertOptionalReactPageRoute(options.route, source);
}

function assertReactPageRenderMode(value: unknown, source: string): void {
  if (
    value !== undefined &&
    value !== "csr" &&
    value !== "ssr" &&
    value !== "ssg"
  ) {
    throw new Error(`[evjs] ${source} render must be "csr", "ssr", or "ssg".`);
  }
}

function assertReactPageHydrationMode(value: unknown, source: string): void {
  if (value !== undefined && value !== "none" && value !== "load") {
    throw new Error(`[evjs] ${source} hydrate must be "none" or "load".`);
  }
}

function assertOptionalReactPageProps(value: unknown, source: string): void {
  if (value !== undefined && typeof value !== "function" && !isRecord(value)) {
    throw new Error(`[evjs] ${source} props must be an object or function.`);
  }
}

function assertReactPageProps(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("[evjs] React page props must resolve to an object.");
  }
}

function assertOptionalReactPageRoute(value: unknown, source: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${source} route must be an object.`);
  }
  assertReactPageString(value.id, `${source} route.id`);
  assertReactPageString(value.path, `${source} route.path`);
}

function assertReactPageMountOption(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (!value.trim()) {
      throw new Error(`[evjs] ${path} must be a non-empty selector string.`);
    }
    if (value.trim() !== value) {
      throw new Error(
        `[evjs] ${path} must not include leading or trailing whitespace.`,
      );
    }
    return;
  }
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${path} must be a selector string or Element.`);
  }
}

function assertReactPageString(value: unknown, path: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[evjs] ${path} must be a non-empty string.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${path} must not include leading or trailing whitespace.`,
    );
  }
}

export async function fetchRscFlight(
  options: RscFlightFetchOptions,
): Promise<Response> {
  return fetchRscFlightWithSignal(options);
}

/** @internal Used by the RSC mount runtime to cancel superseded requests. */
export async function fetchRscFlightWithSignal(
  options: RscFlightFetchOptions,
  signal?: AbortSignal,
): Promise<Response> {
  assertRscFlightFetchOptions(options);
  const endpoint = getClientRuntimeServer(options.runtime)?.rsc;
  if (!endpoint) {
    throw new Error(
      "[evjs] RSC Flight endpoint is not present in the runtime.",
    );
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("[evjs] RSC Flight fetch requires a fetch implementation.");
  }

  const transport = resolveClientRuntimeTransport(options.runtime);
  const requestUrl = resolveRscFlightUrl(endpoint, options, transport);
  const requestInit = resolveRscFlightRequestInit(transport, signal);
  let response: unknown;
  try {
    response =
      requestInit === undefined
        ? await fetchImpl(requestUrl)
        : await fetchImpl(requestUrl, requestInit);
  } catch (error) {
    throw new Error(
      `[evjs] RSC Flight request failed${formatErrorDetail(error)}`,
    );
  }
  assertRscFetchResponseObject(response);
  return response;
}

export function assertRscFlightFetchOptions(
  options: unknown,
): asserts options is RscFlightFetchOptions {
  if (!isRecord(options)) {
    throw new Error("[evjs] fetchRscFlight() options must be an object.");
  }
  assertClientRuntime(options.runtime, "fetchRscFlight() runtime");
  assertOptionalRscFlightString(options.pageId, "fetchRscFlight() pageId");
  assertOptionalRscFlightUrl(options.url, "fetchRscFlight() url");
}

function resolveRscFlightRequestInit(
  transport: ClientRuntimeTransport | undefined,
  signal?: AbortSignal,
): RequestInit | undefined {
  if (!transport && !signal) return undefined;

  const init: RequestInit = {};
  if (transport?.credentials !== undefined) {
    init.credentials = transport.credentials;
  }

  const headers = new Headers(transport?.headers);
  if ([...headers.keys()].length > 0) {
    init.headers = headers;
  }
  if (signal) {
    init.signal = signal;
  }

  return init.credentials !== undefined ||
    init.headers !== undefined ||
    init.signal !== undefined
    ? init
    : undefined;
}

function assertOptionalRscFlightString(value: unknown, path: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[evjs] ${path} must be a non-empty string.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${path} must not include leading or trailing whitespace.`,
    );
  }
}

function assertOptionalRscFlightUrl(value: unknown, path: string): void {
  if (value === undefined) return;
  if (typeof value === "string" || value instanceof URL) return;
  throw new Error(`[evjs] ${path} must be a string or URL when provided.`);
}

const RSC_FLIGHT_FETCH_ERROR_PREFIX = "[evjs] RSC Flight";

function assertRscFetchResponseObject(
  value: unknown,
): asserts value is Response {
  assertFetchResponseObject(value, RSC_FLIGHT_FETCH_ERROR_PREFIX);
}

export function getRscFetchResponseContentType(
  response: Response,
): string | null {
  return getFetchResponseContentType(response);
}

function resolveRscFlightUrl(
  endpoint: string,
  options: RscFlightFetchOptions,
  transport: ClientRuntimeTransport | undefined,
): string {
  const explicitUrl = options.url?.toString();
  const locationHref = globalThis.location?.href;
  const currentUrl = explicitUrl ?? locationHref;
  const url = resolveRuntimeEndpointUrl(
    endpoint,
    transport?.baseUrl ??
      getOriginRootUrl(locationHref ?? getAbsoluteHttpUrl(explicitUrl)),
  );
  if (options.pageId) {
    url.searchParams.set("page", options.pageId);
  }
  const pageUrl =
    currentUrl !== undefined
      ? toPageUrlParam(currentUrl, {
          explicit: explicitUrl !== undefined,
          locationHref: locationHref ?? getAbsoluteHttpUrl(explicitUrl),
          requestUrl: url,
        })
      : undefined;
  if (pageUrl) {
    url.searchParams.set("url", pageUrl);
  }
  return url.toString();
}

function resolveRuntimeEndpointUrl(endpoint: string, baseHref?: string): URL {
  const base = new URL(baseHref ?? "http://evjs.local/");
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) {
    base.pathname = `${base.pathname}/`;
  }
  return new URL(endpoint.replace(/^\/+/, ""), base);
}

function getOriginRootUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function getAbsoluteHttpUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function toPageUrlParam(
  value: string,
  options: {
    explicit: boolean;
    locationHref?: string;
    requestUrl: URL;
  },
): string | undefined {
  const result = getRscFlightClientPageUrlParam(value, options);
  if (result.error) {
    throw new Error(formatRscFlightPageUrlError(result.error));
  }
  return result.value;
}

function formatRscFlightPageUrlError(
  error: RscFlightClientPageUrlParamError,
): string {
  switch (error) {
    case "empty-or-whitespace":
      return "[evjs] RSC Flight page url must be a non-empty string without leading or trailing whitespace.";
    case "not-absolute-path-or-url":
      return '[evjs] RSC Flight page url must be an absolute path starting with "/" or an absolute same-origin HTTP(S) URL.';
    case "invalid-url":
      return "[evjs] RSC Flight page url is not a valid URL.";
    case "hash":
      return "[evjs] RSC Flight page url must not include a hash.";
    case "cross-origin":
      return "[evjs] RSC Flight page url must stay on the same origin.";
  }
}

function resolvePageProps(
  options: ReactPageMountOptions,
  ctx?: AppContext,
): Record<string, unknown> {
  const explicitProps =
    typeof options.props === "function" ? options.props(ctx) : options.props;
  if (explicitProps !== undefined) {
    assertReactPageProps(explicitProps);
    return explicitProps;
  }

  return (
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
    const props = JSON.parse(text) as unknown;
    return isRecord(props) ? props : undefined;
  } catch {
    return undefined;
  }
}

function pagePropsFromContext(ctx: AppContext): Record<string, unknown> {
  if (ctx.kind !== "page") return {};
  const route = findRouteForPage(ctx.runtime, ctx.id, readRequestPathname(ctx));

  return {
    runtime: {
      buildId: ctx.runtime.buildId,
    },
    pageId: ctx.id,
    route,
  };
}

function findRouteForPage(
  runtime: ClientRuntime,
  pageId: string,
  pathname: string | undefined,
): ReactPageRouteContext | undefined {
  const pageRoutes = getClientRuntimeRoutes(runtime).filter(
    (candidate) => candidate.pageId === pageId,
  );
  const route = pathname
    ? findBestPageRoute(pageRoutes, pathname)
    : pageRoutes[0];
  return route
    ? {
        id: route.id,
        path: route.path,
      }
    : undefined;
}

function readRequestPathname(ctx: AppContext): string | undefined {
  return parseUrlPathname(ctx.request?.url) ?? globalThis.location?.pathname;
}

function parseUrlPathname(value: string | URL | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return new URL(value, globalThis.location?.href ?? "http://evjs.local")
      .pathname;
  } catch {
    return undefined;
  }
}

function createReactPageElement(
  component: ReactComponentExport,
  props: Record<string, unknown>,
  route?: ReactPageRouteContext,
) {
  if (!shouldProvidePageRouteProps(props, route)) {
    return createElement(component, props);
  }

  const pageProps = resolvePageRouteProps(props, route);
  const componentProps = stripPageRouteProps(props);
  return createElement(
    PageProvider,
    { value: pageProps },
    createElement(
      component as ComponentType<Record<string, unknown>>,
      componentProps,
    ),
  );
}

function stripPageRouteProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const {
    params: _params,
    search: _search,
    loaderData: _loaderData,
    ...rest
  } = props;
  return rest;
}

function shouldProvidePageRouteProps(
  props: Record<string, unknown>,
  route?: ReactPageRouteContext,
): boolean {
  return (
    Boolean(route ?? readRouteContext(props.route)) ||
    isRecord(props.params) ||
    isRecord(props.search) ||
    "loaderData" in props
  );
}

function resolvePageRouteProps(
  props: Record<string, unknown>,
  explicitRoute?: ReactPageRouteContext,
): PageProps {
  const route = explicitRoute ?? readRouteContext(props.route);
  return {
    params: isStringRecord(props.params)
      ? props.params
      : route
        ? matchPageRouteParams(route.path, readLocationPathname())
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

function readLocationSearch(): PageSearchParams {
  const search = globalThis.location?.search;
  return search ? parsePageSearch(search) : {};
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

function shouldHydrate(options: {
  hydrate?: HydrationMode;
  render?: RenderMode;
}): boolean {
  return options.hydrate !== "none" && options.render !== "csr";
}

function resolveMountPoint(mount: string | Element): Element {
  if (typeof mount !== "string") return mount;
  const doc = globalThis.document;
  if (!doc) {
    throw new Error(
      `[evjs] Document is not available to resolve mount selector "${mount}".`,
    );
  }
  let mountPoint: Element | null;
  try {
    mountPoint = doc.querySelector(mount);
  } catch (error) {
    throw new Error(
      `[evjs] Mount selector "${mount}" is invalid${formatErrorDetail(error)}`,
    );
  }
  if (!mountPoint) {
    throw new Error(`[evjs] Mount point "${mount}" was not found.`);
  }
  return mountPoint;
}
