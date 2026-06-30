import {
  BUILD_IDENTIFIER_DESCRIPTION,
  findBestPageRoute,
  getRscFlightClientPageUrlParam,
  isBuildIdentifier,
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
import type { AppContext, AppModule } from "../framework/shell/index.js";
import {
  assertFetchErrorResponseStatus,
  assertFetchResponseJson,
  assertFetchResponseJsonContentType,
  assertFetchResponseObject,
  formatFetchErrorResponseDetail,
  getFetchResponseContentType,
  readFetchErrorResponseBody,
} from "../shared/fetch-response.js";
import {
  assertClientRuntime,
  type ClientRuntime,
  getClientRuntimeRoutes,
  type HydrationMode,
  type RenderMode,
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
  pages?: Record<
    string,
    {
      renderer: string;
      assets: {
        js: string[];
        css: string[];
      };
      routeId?: string;
    }
  >;
}

export interface RscDebugPayloadMountOptions {
  payload: RscDebugPayload;
  mount: string | Element;
}

const rootByMountPoint = new WeakMap<Element, Root>();

export function createReactPageModule(
  options: ReactPageMountOptions,
): AppModule {
  assertReactPageMountOptions(options, "createReactPageModule()");

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
        unmountMountedReactRoot(mountPoint);
        let root: Root;
        try {
          root = hydrateRoot(
            mountPoint,
            createReactPageElement(options.component, props, options.route),
          );
        } catch (error) {
          throw new Error(
            `[evjs] React page hydrateRoot failed${formatErrorDetail(error)}`,
          );
        }
        rootByMountPoint.set(mountPoint, root);
        return;
      }

      mountReactRoot(mountPoint, options.component, props, options.route);
    },
    unmount(mountPoint) {
      unmountMountedReactRoot(mountPoint);
    },
  };
}

function mountReactRoot(
  mountPoint: Element,
  component: ReactComponentExport,
  props: Record<string, unknown>,
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
  rootByMountPoint.set(mountPoint, root);
}

function unmountMountedReactRoot(mountPoint: Element): void {
  const root = rootByMountPoint.get(mountPoint);
  if (!root) return;
  rootByMountPoint.delete(mountPoint);
  try {
    root.unmount();
  } catch (error) {
    throw new Error(
      `[evjs] React page root.unmount failed${formatErrorDetail(error)}`,
    );
  }
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
  if (shouldHydrate(options)) {
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
  if (
    value !== undefined &&
    value !== "none" &&
    value !== "load" &&
    value !== "visible" &&
    value !== "idle"
  ) {
    throw new Error(
      `[evjs] ${source} hydrate must be "none", "load", "visible", or "idle".`,
    );
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
  assertRscFlightFetchOptions(options);
  const endpoint = options.runtime.runtime.server?.rsc;
  if (!endpoint) {
    throw new Error(
      "[evjs] RSC Flight endpoint is not present in the runtime.",
    );
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("[evjs] RSC Flight fetch requires a fetch implementation.");
  }

  const requestUrl = resolveRscFlightUrl(endpoint, options);
  let response: unknown;
  try {
    response = await fetchImpl(requestUrl);
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
const RSC_DEBUG_RESPONSE_ERROR_PREFIX = "[evjs] RSC debug payload response";

export async function fetchRscDebugPayload(
  options: RscFlightFetchOptions,
): Promise<RscDebugPayload> {
  const response = await fetchRscFlight(options);
  if (!response.ok) {
    assertFetchErrorResponseStatus(response, RSC_FLIGHT_FETCH_ERROR_PREFIX);
    const responseBody = await readFetchErrorResponseBody(response);
    throw new Error(
      `[evjs] RSC debug payload request failed: ${formatFetchErrorResponseDetail(
        response,
        responseBody,
      )}`,
    );
  }

  let payload: unknown;
  assertFetchResponseJson(response, RSC_DEBUG_RESPONSE_ERROR_PREFIX);
  assertFetchResponseJsonContentType(response, RSC_DEBUG_RESPONSE_ERROR_PREFIX);
  try {
    payload = await response.json();
  } catch {
    throw new Error("[evjs] RSC debug payload response is not valid JSON.");
  }
  assertRscDebugPayload(payload, "RSC debug payload response");
  return payload;
}

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

export function mountRscDebugPayload(
  options: RscDebugPayloadMountOptions,
): void {
  assertRscDebugPayloadMountOptions(options);
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
  const explicitUrl = options.url?.toString();
  const locationHref = globalThis.location?.href;
  const currentUrl = explicitUrl ?? locationHref;
  const transportBaseUrl = options.runtime.runtime.transport?.baseUrl;
  const base = transportBaseUrl ?? locationHref ?? explicitUrl ?? endpoint;
  const url = new URL(endpoint, base);
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

function assertRscDebugPayloadMountOptions(
  options: unknown,
): asserts options is RscDebugPayloadMountOptions {
  if (!isRecord(options)) {
    throw new Error("[evjs] mountRscDebugPayload() options must be an object.");
  }
  assertRscDebugPayload(options.payload, "mountRscDebugPayload() payload");
  assertReactPageMountOption(options.mount, "mountRscDebugPayload() mount");
}

function assertRscDebugPayload(
  value: unknown,
  source: string,
): asserts value is RscDebugPayload {
  if (!isRecord(value) || value.version !== 1 || value.type !== "evjs.rsc") {
    throw new Error(`[evjs] ${source} is not an evjs RSC debug payload.`);
  }

  assertRscDebugBuildIdentifier(value.buildId, `${source}.buildId`);
  assertOptionalRscDebugString(value.endpoint, `${source}.endpoint`);
  assertOptionalRscDebugBuildIdentifier(value.pageId, `${source}.pageId`);
  assertOptionalRscDebugBuildIdentifier(value.renderer, `${source}.renderer`);
  assertOptionalRscDebugHtml(value.html, `${source}.html`);
  if (value.assets !== undefined) {
    assertRscDebugAssets(value.assets, `${source}.assets`);
  }
  assertOptionalRscDebugRecord(value.pages, `${source}.pages`);
}

function assertRscDebugBuildIdentifier(value: unknown, path: string): void {
  if (typeof value !== "string" || !value) {
    throw new Error(`[evjs] ${path} must be a non-empty string.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${path} must not include leading or trailing whitespace.`,
    );
  }
  if (!isBuildIdentifier(value)) {
    throw new Error(
      `[evjs] ${path} must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
    );
  }
}

function assertOptionalRscDebugBuildIdentifier(
  value: unknown,
  path: string,
): void {
  if (value === undefined) return;
  assertRscDebugBuildIdentifier(value, path);
}

function assertOptionalRscDebugString(value: unknown, path: string): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw new Error(`[evjs] ${path} must be a string when provided.`);
  }
  if (!value) {
    throw new Error(`[evjs] ${path} must be a non-empty string.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${path} must not include leading or trailing whitespace.`,
    );
  }
}

function assertOptionalRscDebugHtml(value: unknown, path: string): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw new Error(`[evjs] ${path} must be a string when provided.`);
  }
}

function assertRscDebugAssets(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${path} must be an object.`);
  }
  assertRscDebugStringArray(value.js, `${path}.js`);
  assertRscDebugStringArray(value.css, `${path}.css`);
}

function assertRscDebugStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`[evjs] ${path} must contain only non-empty strings.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || !item) {
      throw new Error(`[evjs] ${path} must contain only non-empty strings.`);
    }
    if (item.trim() !== item) {
      throw new Error(
        `[evjs] ${path} item "${item}" must not contain leading or trailing whitespace.`,
      );
    }
  }
}

function assertOptionalRscDebugRecord(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${path} must be an object when provided.`);
  }
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
