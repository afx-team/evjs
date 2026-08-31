import {
  findBestPageRoute,
  formatContentTypeHeaderValue,
  isHeadersInit,
  isHttpBodyStatus,
  isRscFlightContentType,
  matchPageRouteParams,
  parsePageSearch,
  resolveBrowserAssetHref,
} from "@evjs/shared";
import { type ComponentType, createElement, type ReactNode } from "react";
import * as ReactDomServer from "react-dom/server";
import { textResponse } from "../shared/responses.js";
import { isRecord } from "../shared/validation.js";
import { createFrameworkErrorResponse } from "./errors.js";
import type {
  FrameworkAssetGroup,
  FrameworkPageRuntime,
  FrameworkRouteRuntime,
  FrameworkRuntime,
  FrameworkServerRenderer,
  RscCoordinator,
  RscFlightContext,
} from "./runtime.js";
import { getFrameworkRuntimeRoutes } from "./runtime.js";

const PAGE_METADATA_ATTRIBUTE = "data-evjs-page-metadata";
const PAGE_METADATA_CREATED_ATTRIBUTE = "data-evjs-page-metadata-created";
const PAGE_HYDRATION_ATTRIBUTE = "data-evjs-hydrate";

export interface PageProviderProps<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
> {
  value: {
    params: TParams;
    search: TSearch;
    loaderData: TLoaderData;
  };
  children?: ReactNode;
}

export interface ReactServerRenderContext {
  request: Request;
  runtime: FrameworkRuntime;
  pageUrl?: string;
  route?: FrameworkRouteRuntime;
  page?: FrameworkPageRuntime;
  pageId?: string;
  regionId?: string;
}

export type ReactServerRendererModule = Record<string, unknown>;

export type ReactServerRenderResult =
  | Response
  | string
  | {
      html: string;
      status?: number;
      headers?: HeadersInit;
    };

export interface ReactServerRenderAdapterOptions {
  createProps?(
    ctx: ReactServerRenderContext,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  /**
   * Replace the complete server-rendered HTML document.
   *
   * Custom documents own their head and template baseline. Use
   * `renderReactPageMetadata(ctx)` to safely serialize the current Page
   * metadata with the ownership markers required by SPA navigation.
   */
  renderDocument?(
    appHtml: string,
    ctx: ReactServerRenderContext,
  ): ReactServerRenderResult | Promise<ReactServerRenderResult>;
}

export interface ReactRscFlightAdapterOptions {
  loadModule?: (
    asset: string,
    renderer: FrameworkServerRenderer,
  ) => Promise<ReactServerRendererModule>;
  renderFlight?(ctx: RscFlightContext): Response | Promise<Response>;
  onError?(error: unknown, ctx: RscFlightContext): void | Promise<void>;
  validateContentType?: boolean;
}

export function createReactServerRenderAdapter(
  options: ReactServerRenderAdapterOptions = {},
) {
  assertReactServerRenderAdapterOptions(options);

  return async (
    module: ReactServerRendererModule,
    ctx: ReactServerRenderContext,
  ): Promise<ReactServerRenderResult | undefined> => {
    assertReactServerRendererModule(
      module,
      "createReactServerRenderAdapter() module",
    );
    if (typeof module.default !== "function") return undefined;

    const Component = module.default as ComponentType<Record<string, unknown>>;
    const props = await resolveServerRenderProps(options, ctx);
    const appHtml = await renderReactHtml(
      createPageElement(Component, props, ctx, resolvePageProvider(module)),
      shouldRenderPprShell(ctx) ? "shell" : "complete",
    );

    if (ctx.regionId) {
      return {
        html: appHtml,
      };
    }

    if (options.renderDocument) {
      const result = await options.renderDocument(appHtml, ctx);
      assertServerRenderResult(
        result,
        "createReactServerRenderAdapter() renderDocument()",
      );
      return result;
    }

    return {
      html: renderDefaultDocument(appHtml, ctx, props),
    };
  };
}

type ReactRenderReadiness = "complete" | "shell";

async function renderReactHtml(
  element: ReactNode,
  readiness: ReactRenderReadiness = "complete",
): Promise<string> {
  if (readiness === "shell") {
    return ReactDomServer.renderToString(element);
  }

  const renderToReadableStream = ReactDomServer.renderToReadableStream as
    | typeof ReactDomServer.renderToReadableStream
    | undefined;
  if (!renderToReadableStream) {
    return ReactDomServer.renderToString(element);
  }

  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return readReactHtmlStream(stream);
}

async function readReactHtmlStream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let html = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    return html;
  } finally {
    reader.releaseLock();
  }
}

function shouldRenderPprShell(ctx: ReactServerRenderContext): boolean {
  return Boolean(ctx.page?.ppr && !ctx.regionId);
}

export function createReactRscFlightAdapter(
  options: ReactRscFlightAdapterOptions = {},
): RscCoordinator {
  assertReactRscFlightAdapterOptions(options);

  return {
    match(ctx) {
      return Boolean(
        getRscEndpoint(ctx.runtime) &&
          ctx.pageId &&
          ctx.page?.componentModel === "rsc" &&
          ctx.rscPage &&
          ctx.renderer,
      );
    },
    async renderFlight(ctx) {
      try {
        const response = options.renderFlight
          ? await options.renderFlight(ctx)
          : await renderLoadedRscFlight(ctx, options);
        if (response === undefined) {
          return textResponse(
            "[evjs] RSC Flight renderer is not configured for this page.",
            501,
          );
        }
        assertRscFlightResponse(
          response,
          "createReactRscFlightAdapter() renderFlight()",
        );
        return validateFlightResponse(response, options);
      } catch (error) {
        await options.onError?.(error, ctx);
        return createFrameworkErrorResponse("RSC Flight render failed", error);
      }
    },
  };
}

function validateFlightResponse(
  response: Response,
  options: ReactRscFlightAdapterOptions,
): Response {
  const contentType = response.headers.get("Content-Type");
  if (isRscFlightContentType(contentType)) {
    return response;
  }

  if (options.validateContentType === false || response.status >= 400) {
    return response;
  }

  return textResponse(
    `[evjs] RSC Flight renderer returned invalid Content-Type ${formatContentTypeHeaderValue(
      contentType,
    )}.`,
    500,
  );
}

function assertRscFlightResponse(
  value: unknown,
  source: string,
): asserts value is Response {
  if (!(value instanceof Response)) {
    throw new Error(`[evjs] ${source} must return a Response.`);
  }
}

function assertReactServerRendererModule(
  value: unknown,
  source: string,
): asserts value is ReactServerRendererModule {
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${source} must be a renderer module object.`);
  }
}

function assertReactServerRenderAdapterOptions(
  value: unknown,
): asserts value is ReactServerRenderAdapterOptions {
  if (!isRecord(value)) {
    throw new Error(
      "[evjs] createReactServerRenderAdapter() options must be an object.",
    );
  }

  assertOptionalFunction(
    value.createProps,
    "createReactServerRenderAdapter() createProps",
  );
  assertOptionalFunction(
    value.renderDocument,
    "createReactServerRenderAdapter() renderDocument",
  );
}

function assertReactRscFlightAdapterOptions(
  value: unknown,
): asserts value is ReactRscFlightAdapterOptions {
  if (!isRecord(value)) {
    throw new Error(
      "[evjs] createReactRscFlightAdapter() options must be an object.",
    );
  }

  assertOptionalFunction(
    value.loadModule,
    "createReactRscFlightAdapter() loadModule",
  );
  assertOptionalFunction(
    value.renderFlight,
    "createReactRscFlightAdapter() renderFlight",
  );
  assertOptionalFunction(
    value.onError,
    "createReactRscFlightAdapter() onError",
  );
  assertOptionalBoolean(
    value.validateContentType,
    "createReactRscFlightAdapter() validateContentType",
  );
}

function assertOptionalFunction(value: unknown, source: string): void {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`[evjs] ${source} must be a function.`);
  }
}

function assertOptionalBoolean(value: unknown, source: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`[evjs] ${source} must be a boolean.`);
  }
}

async function renderLoadedRscFlight(
  ctx: RscFlightContext,
  options: ReactRscFlightAdapterOptions,
): Promise<Response | undefined> {
  const renderer = ctx.renderer;
  if (!renderer) return undefined;
  const asset = renderer.assets.js[0];
  if (!asset || !options.loadModule) return undefined;

  const module = await options.loadModule(asset, renderer);
  assertReactServerRendererModule(
    module,
    "createReactRscFlightAdapter() loadModule()",
  );
  if (typeof module.renderFlight !== "function") return undefined;

  const response = await module.renderFlight(ctx);
  assertRscFlightResponse(
    response,
    "createReactRscFlightAdapter() loaded module renderFlight()",
  );
  return response;
}

function isHtmlResult(value: unknown): value is { html: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { html?: unknown }).html === "string",
  );
}

function isReactServerRenderResult(
  value: unknown,
): value is ReactServerRenderResult {
  return (
    value instanceof Response ||
    typeof value === "string" ||
    isHtmlResult(value)
  );
}

function getRscEndpoint(runtime: FrameworkRuntime): string | undefined {
  return runtime.runtime.server.rsc;
}

function defaultProps(ctx: ReactServerRenderContext): Record<string, unknown> {
  return {
    runtime: {
      buildId: ctx.runtime.buildId,
    },
    route: ctx.route
      ? {
          id: ctx.route.id,
          path: ctx.route.path,
        }
      : undefined,
    pageId: ctx.pageId,
  };
}

async function resolveServerRenderProps(
  options: ReactServerRenderAdapterOptions,
  ctx: ReactServerRenderContext,
): Promise<Record<string, unknown>> {
  const props = options.createProps
    ? await options.createProps(ctx)
    : defaultProps(ctx);
  assertRenderProps(props, "createReactServerRenderAdapter() createProps()");
  return props;
}

function assertRenderProps(
  value: unknown,
  source: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${source} must return an object.`);
  }
}

function assertServerRenderResult(
  value: unknown,
  source: string,
): asserts value is ReactServerRenderResult {
  if (!isReactServerRenderResult(value)) {
    throw new Error(
      `[evjs] ${source} must return a Response, string, or { html, status?, headers? }.`,
    );
  }

  if (!isHtmlResult(value)) return;
  if (value.status !== undefined && !isHttpBodyStatus(value.status)) {
    throw new Error(
      `[evjs] ${source} status must be an integer HTTP status between 200 and 599 that can include an HTML body.`,
    );
  }
  if (value.headers !== undefined) {
    assertHeadersInit(value.headers, source);
  }
}

function assertHeadersInit(
  value: unknown,
  source: string,
): asserts value is HeadersInit {
  if (!isHeadersInit(value)) {
    throw new Error(`[evjs] ${source} headers must be valid HeadersInit.`);
  }
}

function findRouteForPage(
  runtime: FrameworkRuntime,
  pageId: string | undefined,
  pathname?: string,
): { id: string; path: string } | undefined {
  if (!pageId) return undefined;

  const pageRoutes = getFrameworkRuntimeRoutes(runtime).filter(
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

interface PageElementContext {
  request: Request;
  runtime: FrameworkRuntime;
  pageUrl?: string;
  route?: FrameworkRouteRuntime;
  pageId?: string;
}

function createPageElement(
  component: ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>,
  ctx: PageElementContext,
  Provider: ComponentType<PageProviderProps> | undefined,
) {
  if (!Provider || !shouldProvidePageRouteProps(props, ctx)) {
    return createElement(component, props);
  }

  return createElement(
    Provider,
    { value: resolvePageRouteProps(props, ctx) },
    createElement(component, stripPageRouteProps(props)),
  );
}

function resolvePageProvider(
  module: ReactServerRendererModule,
): ComponentType<PageProviderProps> | undefined {
  return typeof module.PageProvider === "function"
    ? (module.PageProvider as ComponentType<PageProviderProps>)
    : undefined;
}

function shouldProvidePageRouteProps(
  props: Record<string, unknown>,
  ctx: PageElementContext,
): boolean {
  return (
    Boolean(resolveRouteContext(props, ctx)) ||
    isRecord(props.params) ||
    isRecord(props.search) ||
    "loaderData" in props
  );
}

function resolvePageRouteProps(
  props: Record<string, unknown>,
  ctx: PageElementContext,
) {
  const route = resolveRouteContext(props, ctx);
  const url = new URL(ctx.pageUrl ?? ctx.request.url, ctx.request.url);

  return {
    params: isStringRecord(props.params)
      ? props.params
      : route
        ? matchPageRouteParams(route.path, url.pathname)
        : {},
    search: isRecord(props.search) ? props.search : parsePageSearch(url.search),
    loaderData: props.loaderData,
  };
}

function resolveRouteContext(
  props: Record<string, unknown>,
  ctx: PageElementContext,
): { id: string; path: string } | undefined {
  return (
    ctx.route ??
    readRouteContext(props.route) ??
    findRouteForPage(ctx.runtime, ctx.pageId, readPageElementPathname(ctx))
  );
}

function readPageElementPathname(ctx: PageElementContext): string | undefined {
  return readUrlPathname(ctx.pageUrl ?? ctx.request.url);
}

function readUrlPathname(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return new URL(value, "http://evjs.local").pathname;
  } catch {
    return undefined;
  }
}

function readRouteContext(
  value: unknown,
): { id: string; path: string } | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.id === "string" && typeof value.path === "string"
    ? { id: value.id, path: value.path }
    : undefined;
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function renderDefaultDocument(
  appHtml: string,
  ctx: ReactServerRenderContext,
  props: Record<string, unknown>,
): string {
  const mount = resolveMount(ctx.page?.mount);
  const runtimeData = renderRequestRuntimeData(ctx, props, mount);
  const document = ctx.page?.document;
  if (document) {
    return [
      document.beforeContent,
      appHtml,
      document.betweenContentAndData,
      runtimeData,
      document.afterData,
    ].join("");
  }

  const assets = ctx.page?.assets ?? emptyAssets();
  const hydrationAttribute = renderPageHydrationAttribute(ctx.page, assets);

  return [
    "<!doctype html>",
    `<html data-evjs-kind="page" data-evjs-id="${escapeHtmlAttr(ctx.pageId ?? "")}" data-evjs-build="${escapeHtmlAttr(ctx.runtime.buildId)}">`,
    "<head>",
    ...renderPageMetadata(
      ctx.page?.metadata,
      ctx.runtime.routing?.kind === "spa",
    ),
    ...assets.css.map(
      (asset) =>
        `<link rel="stylesheet" href="${escapeHtmlAttr(assetHref(ctx.runtime, asset))}">`,
    ),
    "</head>",
    "<body>",
    `<div ${mount.attribute}="${escapeHtmlAttr(mount.value)}"${hydrationAttribute}>${appHtml}</div>`,
    runtimeData,
    ...assets.js.map(
      (asset) =>
        `<script defer src="${escapeHtmlAttr(assetHref(ctx.runtime, asset))}"></script>`,
    ),
    "</body>",
    "</html>",
  ].join("");
}

function renderRequestRuntimeData(
  ctx: ReactServerRenderContext,
  props: Record<string, unknown>,
  mount: {
    attribute: "id" | "data-evjs-mount";
    value: string;
  },
): string {
  const rscBootstrap = createRscBootstrap(ctx, mount);
  return [
    `<script id="__EVJS_PAGE_PROPS__" type="application/json">${serializePageProps(props)}</script>`,
    ...(rscBootstrap
      ? [
          `<script id="__EVJS_RSC_BOOTSTRAP__" type="application/json">${serializePageProps(rscBootstrap)}</script>`,
        ]
      : []),
  ].join("");
}

function renderPageHydrationAttribute(
  page: FrameworkPageRuntime | undefined,
  assets: FrameworkAssetGroup,
): string {
  if (
    !page ||
    page.render === "csr" ||
    page.rendering.hydrate === "none" ||
    assets.js.length === 0
  ) {
    return "";
  }
  return ` ${PAGE_HYDRATION_ATTRIBUTE}="${page.rendering.hydrate}"`;
}

/**
 * Serialize the current Page's title and named meta values for a custom React
 * server document, including SPA ownership markers when required.
 */
export function renderReactPageMetadata(
  ctx: Pick<ReactServerRenderContext, "page" | "runtime">,
): string {
  return renderPageMetadata(
    ctx.page?.metadata,
    ctx.runtime.routing?.kind === "spa",
  ).join("");
}

function renderPageMetadata(
  metadata: FrameworkPageRuntime["metadata"],
  markForSpaRuntime: boolean,
): string[] {
  if (!metadata) return [];

  const head: string[] = [];
  const titleMarker = markForSpaRuntime
    ? ` ${PAGE_METADATA_ATTRIBUTE}="title" ${PAGE_METADATA_CREATED_ATTRIBUTE}=""`
    : "";
  const metaMarker = markForSpaRuntime
    ? ` ${PAGE_METADATA_ATTRIBUTE}="meta" ${PAGE_METADATA_CREATED_ATTRIBUTE}=""`
    : "";
  if (metadata.title !== undefined) {
    head.push(`<title${titleMarker}>${escapeHtmlText(metadata.title)}</title>`);
  }

  const metaByName = new Map<string, readonly [string, string]>();
  for (const entry of Object.entries(metadata.meta ?? {})) {
    metaByName.set(toAsciiLowerCase(entry[0]), entry);
  }
  for (const [name, content] of metaByName.values()) {
    head.push(
      `<meta name="${escapeHtmlAttr(name)}" content="${escapeHtmlAttr(content)}"${metaMarker}>`,
    );
  }
  return head;
}

function createRscBootstrap(
  ctx: ReactServerRenderContext,
  mount: {
    attribute: "id" | "data-evjs-mount";
    value: string;
  },
):
  | {
      version: 1;
      buildId: string;
      pageId: string;
      endpoint: string;
      basepath?: string;
      publicPath: FrameworkRuntime["publicPath"];
      mount: string;
      page: {
        assets: FrameworkAssetGroup;
        routeId?: string;
      };
    }
  | undefined {
  if (ctx.page?.componentModel !== "rsc" || !ctx.pageId) return undefined;

  const endpoint = getRscEndpoint(ctx.runtime);
  if (!endpoint) return undefined;

  return {
    version: 1,
    buildId: ctx.runtime.buildId,
    pageId: ctx.pageId,
    endpoint,
    basepath: ctx.runtime.runtime.server?.basepath,
    publicPath: ctx.runtime.publicPath,
    mount:
      mount.attribute === "id"
        ? `#${mount.value}`
        : `[${mount.attribute}="${mount.value}"]`,
    page: {
      assets: ctx.page.assets,
      routeId: ctx.page.routeId,
    },
  };
}

function resolveMount(mount: string | undefined): {
  attribute: "id" | "data-evjs-mount";
  value: string;
} {
  if (!mount || mount === "#app") return { attribute: "id", value: "app" };
  if (mount.startsWith("#") && mount.length > 1) {
    return { attribute: "id", value: mount.slice(1) };
  }
  return { attribute: "data-evjs-mount", value: mount };
}

function serializePageProps(props: Record<string, unknown>): string {
  try {
    return JSON.stringify(props, (_key, value: unknown) => {
      if (
        value instanceof Request ||
        value instanceof Response ||
        value instanceof Headers ||
        typeof value === "function" ||
        typeof value === "symbol" ||
        typeof value === "bigint"
      ) {
        return undefined;
      }
      return value;
    })
      .replaceAll("<", "\\u003c")
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029");
  } catch {
    return "{}";
  }
}

function assetHref(runtime: FrameworkRuntime, asset: string): string {
  return resolveBrowserAssetHref(asset, runtime.publicPath);
}

function emptyAssets(): FrameworkAssetGroup {
  return { js: [], css: [] };
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function toAsciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 32),
  );
}
