import {
  PageProvider,
  type PageProviderProps,
} from "@evjs/client/internal/page-context";
import {
  findBestPageRoute,
  formatContentTypeHeaderValue,
  isHeadersInit,
  isHttpBodyStatus,
  isRscFlightContentType,
  matchPageRouteParams,
  parsePageSearch,
} from "@evjs/shared";
import type {
  AssetGroup,
  BuildOutput,
  PageOutput,
  RouteOutput,
  ServerRendererOutput,
} from "@evjs/shared/manifest";
import { type ComponentType, createElement, type ReactNode } from "react";
import * as ReactDomServer from "react-dom/server";
import type { RscCoordinator, RscFlightContext } from "./framework.js";
import { textResponse } from "./responses.js";
import {
  formatUnknownError,
  isRecord,
  sanitizeDiagnosticText,
} from "./validation.js";

export interface ReactServerRenderContext {
  request: Request;
  manifest: BuildOutput;
  pageUrl?: string;
  route?: RouteOutput;
  page?: PageOutput;
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
  renderDocument?(
    appHtml: string,
    ctx: ReactServerRenderContext,
  ): ReactServerRenderResult | Promise<ReactServerRenderResult>;
}

export interface ReactRscFlightAdapterOptions {
  loadModule?: (
    asset: string,
    renderer: ServerRendererOutput,
  ) => Promise<ReactServerRendererModule>;
  createProps?(
    ctx: RscFlightContext,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  renderFlight?(ctx: RscFlightContext): Response | Promise<Response>;
  onError?(error: unknown, ctx: RscFlightContext): void | Promise<void>;
  validateContentType?: boolean;
}

export interface ReactRscDebugPayload {
  version: 1;
  type: "evjs.rsc";
  buildId: string;
  endpoint?: string;
  pageId?: string;
  renderer?: string;
  html?: string;
  assets: AssetGroup;
  clientReferences?: Record<string, unknown>;
  serverReferences?: Record<string, unknown>;
  pages?: NonNullable<BuildOutput["rsc"]>["pages"];
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
        getRscEndpoint(ctx.manifest) &&
          ctx.pageId &&
          ctx.page?.componentModel === "rsc" &&
          ctx.rscPage &&
          ctx.renderer,
      );
    },
    async renderFlight(ctx) {
      try {
        if (options.renderFlight) {
          const response = await options.renderFlight(ctx);
          assertRscFlightResponse(
            response,
            "createReactRscFlightAdapter() renderFlight()",
          );
          return await validateFlightResponse(response, options);
        }

        const rendered = await renderDefaultRscDebugPayload(ctx, options);
        if (rendered instanceof Response) {
          return await validateFlightResponse(rendered, options);
        }

        return textResponse(
          "[evjs] RSC Flight renderer is not configured for this page.",
          501,
        );
      } catch (error) {
        await options.onError?.(error, ctx);
        return textResponse(
          `[evjs] RSC Flight render failed: ${formatUnknownError(error)}`,
          500,
        );
      }
    },
  };
}

async function validateFlightResponse(
  response: Response,
  options: ReactRscFlightAdapterOptions,
): Promise<Response> {
  const contentType = response.headers.get("Content-Type");
  if (isRscFlightContentType(contentType)) {
    return sanitizeFlightResponse(response);
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
    value.createProps,
    "createReactRscFlightAdapter() createProps",
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

async function sanitizeFlightResponse(response: Response): Promise<Response> {
  if (!response.body) return response;

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");

  if (typeof TransformStream === "undefined") {
    return new Response(sanitizeDiagnosticText(await response.text()), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let carry = "";
  const tailLength = 64 * 1024;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = carry + decoder.decode(chunk, { stream: true });
      const emitUntil = Math.max(0, text.length - tailLength);
      if (emitUntil > 0) {
        controller.enqueue(
          encoder.encode(sanitizeDiagnosticText(text.slice(0, emitUntil))),
        );
        carry = text.slice(emitUntil);
      } else {
        carry = text;
      }
    },
    flush(controller) {
      const text = carry + decoder.decode();
      if (text) {
        controller.enqueue(encoder.encode(sanitizeDiagnosticText(text)));
      }
    },
  });

  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function renderDefaultRscDebugPayload(
  ctx: RscFlightContext,
  options: ReactRscFlightAdapterOptions,
): Promise<ReactRscDebugPayload | Response> {
  const rendererName = ctx.rscPage?.renderer;
  const renderer = rendererName ? ctx.renderer : undefined;
  const html = renderer
    ? await renderRscRendererModule(ctx, renderer, options)
    : undefined;
  if (html instanceof Response) return html;

  return {
    version: 1,
    type: "evjs.rsc",
    buildId: ctx.manifest.buildId,
    endpoint: getRscEndpoint(ctx.manifest),
    pageId: ctx.pageId,
    renderer: rendererName,
    html,
    assets: ctx.rscPage?.assets ?? emptyAssets(),
    clientReferences: ctx.manifest.rsc?.clientReferences,
    serverReferences: ctx.manifest.rsc?.serverReferences,
    pages: ctx.manifest.rsc?.pages ?? {},
  };
}

async function renderRscRendererModule(
  ctx: RscFlightContext,
  renderer: ServerRendererOutput,
  options: ReactRscFlightAdapterOptions,
): Promise<string | Response | undefined> {
  const asset = renderer.assets.js[0];
  if (!asset || !options.loadModule) return undefined;

  const module = await options.loadModule(asset, renderer);
  assertReactServerRendererModule(
    module,
    "createReactRscFlightAdapter() loadModule()",
  );
  const customFlight = getModuleFunction(module, "renderFlight");
  if (customFlight) {
    const result = await customFlight(ctx);
    if (result instanceof Response) return result;
    if (typeof result === "string") return result;
    if (isHtmlResult(result)) return result.html;
    return undefined;
  }

  const customRsc = getModuleFunction(module, "renderRsc");
  if (customRsc) {
    const result = await customRsc(ctx);
    if (result instanceof Response) return result;
    if (typeof result === "string") return result;
    if (isHtmlResult(result)) return result.html;
    return undefined;
  }

  if (typeof module.default !== "function") return undefined;

  const Component = module.default as ComponentType<Record<string, unknown>>;
  const props = await resolveRscRenderProps(options, ctx);
  return renderReactHtml(createPageElement(Component, props, ctx));
}

function getModuleFunction(
  module: ReactServerRendererModule,
  name: "renderFlight" | "renderRsc",
): ((ctx: RscFlightContext) => unknown | Promise<unknown>) | undefined {
  return typeof module[name] === "function"
    ? (module[name] as (ctx: RscFlightContext) => unknown | Promise<unknown>)
    : undefined;
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

function defaultRscProps(ctx: RscFlightContext): Record<string, unknown> {
  return {
    manifest: {
      buildId: ctx.manifest.buildId,
    },
    pageId: ctx.pageId,
    route: findRouteForPage(
      ctx.manifest,
      ctx.pageId,
      readUrlPathname(ctx.pageUrl),
    ),
  };
}

function getRscEndpoint(manifest: BuildOutput): string | undefined {
  return manifest.rsc?.endpoint ?? manifest.runtime.server?.rsc;
}

async function resolveRscRenderProps(
  options: ReactRscFlightAdapterOptions,
  ctx: RscFlightContext,
): Promise<Record<string, unknown>> {
  const props = options.createProps
    ? await options.createProps(ctx)
    : defaultRscProps(ctx);
  assertRenderProps(props, "createReactRscFlightAdapter() createProps()");
  return props;
}

function defaultProps(ctx: ReactServerRenderContext): Record<string, unknown> {
  return {
    manifest: {
      buildId: ctx.manifest.buildId,
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
  manifest: BuildOutput,
  pageId: string | undefined,
  pathname?: string,
): { id: string; path: string } | undefined {
  if (!pageId) return undefined;

  const pageRoutes = manifest.routes.filter(
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
  manifest: BuildOutput;
  pageUrl?: string;
  route?: RouteOutput;
  pageId?: string;
}

function createPageElement(
  component: ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>,
  ctx: PageElementContext,
  Provider: ComponentType<PageProviderProps> = PageProvider,
) {
  if (!shouldProvidePageRouteProps(props, ctx)) {
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
): ComponentType<PageProviderProps> {
  return typeof module.PageProvider === "function"
    ? (module.PageProvider as ComponentType<PageProviderProps>)
    : PageProvider;
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
    findRouteForPage(ctx.manifest, ctx.pageId, readPageElementPathname(ctx))
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
  const assets = ctx.page?.assets ?? emptyAssets();
  const rscBootstrap = createRscBootstrap(ctx, mount);

  return [
    "<!doctype html>",
    `<html data-evjs-kind="page" data-evjs-id="${escapeHtmlAttr(ctx.pageId ?? "")}" data-evjs-build="${escapeHtmlAttr(ctx.manifest.buildId)}">`,
    "<head>",
    ...assets.css.map(
      (asset) =>
        `<link rel="stylesheet" href="${escapeHtmlAttr(assetHref(ctx.manifest, asset))}">`,
    ),
    "</head>",
    "<body>",
    `<div ${mount.attribute}="${escapeHtmlAttr(mount.value)}">${appHtml}</div>`,
    `<script id="__EVJS_PAGE_PROPS__" type="application/json">${serializePageProps(props)}</script>`,
    ...(rscBootstrap
      ? [
          `<script id="__EVJS_RSC_BOOTSTRAP__" type="application/json">${serializePageProps(rscBootstrap)}</script>`,
        ]
      : []),
    ...assets.js.map(
      (asset) =>
        `<script defer src="${escapeHtmlAttr(assetHref(ctx.manifest, asset))}"></script>`,
    ),
    "</body>",
    "</html>",
  ].join("");
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
      basePath?: string;
      publicPath: BuildOutput["publicPath"];
      mount: string;
      page: {
        assets: AssetGroup;
        routeId?: string;
      };
    }
  | undefined {
  if (ctx.page?.componentModel !== "rsc" || !ctx.pageId) return undefined;

  const endpoint = getRscEndpoint(ctx.manifest);
  if (!endpoint) return undefined;

  return {
    version: 1,
    buildId: ctx.manifest.buildId,
    pageId: ctx.pageId,
    endpoint,
    basePath: ctx.manifest.runtime.server?.basePath,
    publicPath: ctx.manifest.publicPath,
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

function assetHref(manifest: BuildOutput, asset: string): string {
  const publicPath = manifest.publicPath;
  if (publicPath === "auto") {
    return /^(?:https?:)?\/\//.test(asset) || asset.startsWith("/")
      ? asset
      : `/${asset}`;
  }
  if (/^(?:https?:)?\/\//.test(asset) || asset.startsWith("/")) return asset;
  const base = publicPath.endsWith("/") ? publicPath : `${publicPath}/`;
  return `${base}${asset}`;
}

function emptyAssets(): AssetGroup {
  return { js: [], css: [] };
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
