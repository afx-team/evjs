import {
  BUILD_IDENTIFIER_DESCRIPTION,
  findBestPageRoute,
  formatContentTypeHeaderValue,
  isBuildIdentifier,
  isHeadersInit,
  isHttpBodyStatus,
  isRscFlightContentType,
  isTextHtmlContentType,
  normalizeRoutePathname,
  pageRoutePathMatches,
  RSC_FLIGHT_CONTENT_TYPE,
  type RscFlightRequestPageUrlError,
  resolveRscFlightRequestPageUrl,
  TEXT_HTML_UTF8_CONTENT_TYPE,
} from "@evjs/shared";
import type {
  BuildEntryOwner,
  BuildOutput,
  PageOutput,
  PprCachePolicy,
  RouteOutput,
  RscPageOutput,
  ServerRendererOutput,
  ServerRenderPlan,
} from "@evjs/shared/manifest";
import { assertFrameworkManifestShape } from "@evjs/shared/manifest";
import { tryGetContext } from "hono/context-storage";
import { textResponse } from "./responses.js";
import { formatUnknownError, isRecord } from "./validation.js";

export interface FrameworkServerOptions {
  manifest: BuildOutput;
  render?: ServerRenderHandler | ServerRenderCoordinator;
  rsc?: RscFlightHandler | RscCoordinator;
  ppr?: PprRuntimeOptions;
  allowPageRenderRequest?: (
    request: Request,
  ) => boolean | Response | Promise<boolean | Response>;
}

export interface PprRuntimeOptions {
  regionCache?: PprRegionCache;
  staleWhileRevalidate?: number;
}

export interface ServerRenderContext {
  request: Request;
  manifest: BuildOutput;
  pageUrl?: string;
  route?: RouteOutput;
  page?: PageOutput;
  pageId?: string;
  regionId?: string;
}

export interface ServerRenderCoordinator {
  match?(
    ctx: ServerRenderContext,
  ): ServerRenderContext | undefined | Promise<ServerRenderContext | undefined>;
  render(
    ctx: ServerRenderContext,
  ): ServerRenderResult | Promise<ServerRenderResult>;
}

export type ServerRenderResult =
  | Response
  | string
  | {
      html: string;
      status?: number;
      headers?: HeadersInit;
    };

export type ServerRenderHandler = (
  ctx: ServerRenderContext,
) => ServerRenderResult | Promise<ServerRenderResult>;

export type ServerRendererModule = Record<string, unknown>;

export interface ServerRendererRegistryEntry {
  kind: ServerRenderPlan["kind"];
  owner?: BuildEntryOwner;
  load(): Promise<ServerRendererModule>;
}

export type ServerRendererRegistry = Record<
  string,
  ServerRendererRegistryEntry
>;

export interface ModuleRenderCoordinatorOptions {
  renderers: ServerRendererRegistry;
  renderModule?: ServerModuleRenderHandler;
  fallback?: ServerRenderHandler | ServerRenderCoordinator;
}

export type ServerModuleRenderHandler = (
  module: ServerRendererModule,
  ctx: ServerRenderContext,
  renderer: {
    name: string;
    entry: ServerRendererRegistryEntry;
  },
) => ServerRenderResult | undefined | Promise<ServerRenderResult | undefined>;

export type ManifestServerModuleLoader = (
  asset: string,
  renderer: ServerRendererOutput,
) => Promise<ServerRendererModule>;

export interface ManifestRenderCoordinatorOptions {
  manifest: BuildOutput;
  loadModule: ManifestServerModuleLoader;
  renderModule?: ServerModuleRenderHandler;
  fallback?: ServerRenderHandler | ServerRenderCoordinator;
}

export interface RscFlightContext {
  request: Request;
  manifest: BuildOutput;
  pageUrl?: string;
  pageId?: string;
  page?: PageOutput;
  rscPage?: RscPageOutput;
  renderer?: ServerRendererOutput;
}

export type RscFlightHandler = (
  ctx: RscFlightContext,
) => Response | Promise<Response>;

export interface RscCoordinator {
  match?(ctx: RscFlightContext): boolean | Promise<boolean>;
  renderFlight(ctx: RscFlightContext): Response | Promise<Response>;
}

export interface PprRegionCacheEntry {
  expiresAt: number;
  staleUntil?: number;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
}

export interface PprRegionCache {
  get(
    key: string,
  ): PprRegionCacheEntry | undefined | Promise<PprRegionCacheEntry | undefined>;
  set(key: string, entry: PprRegionCacheEntry): void | Promise<void>;
  delete?(key: string): void | Promise<void>;
}

interface PprRegionMatch {
  pageId: string;
  regionId: string;
  pageUrl?: string;
}

const pprRegionCaches = new WeakMap<
  FrameworkServerOptions,
  Map<string, PprRegionCacheEntry>
>();
const pprRegionRevalidations = new WeakMap<
  FrameworkServerOptions,
  Set<string>
>();

interface PprRegionCacheWriteOptions {
  store: boolean;
}

interface PprRegionCacheRead {
  response: Response;
  state: "fresh" | "stale";
}

interface PprRegionNormalizeOptions {
  readBody: boolean;
}
export function createModuleRenderCoordinator(
  options: ModuleRenderCoordinatorOptions,
): ServerRenderCoordinator {
  assertModuleRenderCoordinatorOptions(options);

  const moduleCache = new Map<string, Promise<ServerRendererModule>>();
  const fallback = options.fallback
    ? normalizeRenderCoordinator(options.fallback)
    : undefined;

  return {
    async match(ctx) {
      const renderer = findRenderer(ctx, options.renderers);
      if (renderer) return ctx;
      if (!fallback) return undefined;
      return fallback.match ? fallback.match(ctx) : ctx;
    },
    async render(ctx) {
      const renderer = findRenderer(ctx, options.renderers);
      if (!renderer) {
        if (fallback) return fallback.render(ctx);
        return textResponse(
          "No framework server renderer matched request",
          404,
        );
      }

      const module = await loadRendererModule(
        renderer.name,
        renderer.entry,
        moduleCache,
      );
      const rendererSource = `Server renderer "${renderer.name}"`;
      const namedRender = getNamedModuleRenderFunction(module);
      if (namedRender) {
        const result = await namedRender(ctx);
        if (!isServerRenderResult(result)) {
          return invalidServerRenderResult(rendererSource);
        }
        return result;
      }

      const adapterResult = options.renderModule
        ? await options.renderModule(module, ctx, renderer)
        : undefined;
      if (adapterResult !== undefined) {
        if (!isServerRenderResult(adapterResult)) {
          return invalidServerRenderResult(rendererSource);
        }
        return adapterResult;
      }

      const render = getDefaultModuleRenderFunction(module);
      if (!render) {
        return textResponse(
          `[evjs] Server renderer "${renderer.name}" must export render(ctx) or default(ctx). React component SSR requires a React server render adapter.`,
          501,
        );
      }

      const result = await render(ctx);
      if (!isServerRenderResult(result)) {
        return invalidServerRenderResult(rendererSource);
      }

      return result;
    },
  };
}

export function createManifestRenderCoordinator(
  options: ManifestRenderCoordinatorOptions,
): ServerRenderCoordinator {
  assertManifestRenderCoordinatorOptions(options);

  return createModuleRenderCoordinator({
    renderers: createRendererRegistryFromManifest(
      options.manifest,
      options.loadModule,
    ),
    renderModule: options.renderModule,
    fallback: options.fallback,
  });
}

function assertModuleRenderCoordinatorOptions(
  value: unknown,
): asserts value is ModuleRenderCoordinatorOptions {
  if (!isRecord(value)) {
    throw new Error(
      "[evjs] createModuleRenderCoordinator() options must be an object.",
    );
  }

  assertRendererRegistry(
    value.renderers,
    "createModuleRenderCoordinator() renderers",
  );
  assertOptionalFunction(
    value.renderModule,
    "createModuleRenderCoordinator() renderModule",
  );
  assertOptionalRenderCoordinator(
    value.fallback,
    "createModuleRenderCoordinator() fallback",
  );
}

function assertManifestRenderCoordinatorOptions(
  value: unknown,
): asserts value is ManifestRenderCoordinatorOptions {
  if (!isRecord(value)) {
    throw new Error(
      "[evjs] createManifestRenderCoordinator() options must be an object.",
    );
  }

  assertFrameworkManifestShape(
    value.manifest,
    "createManifestRenderCoordinator() manifest",
  );
  assertFunction(
    value.loadModule,
    "createManifestRenderCoordinator() loadModule",
  );
  assertOptionalFunction(
    value.renderModule,
    "createManifestRenderCoordinator() renderModule",
  );
  assertOptionalRenderCoordinator(
    value.fallback,
    "createManifestRenderCoordinator() fallback",
  );
}

function assertRendererRegistry(value: unknown, source: string): void {
  assertObject(value, source);

  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      throw new Error(`[evjs] ${source}.${name} must be a renderer entry.`);
    }
    assertFunction(entry.load, `${source}.${name}.load`);
  }
}

function assertOptionalRenderCoordinator(value: unknown, source: string): void {
  if (value === undefined || typeof value === "function") return;
  if (isRecord(value) && typeof value.render === "function") return;
  throw new Error(
    `[evjs] ${source} must be a render function or coordinator object.`,
  );
}

function assertOptionalFunction(value: unknown, source: string): void {
  if (value !== undefined) {
    assertFunction(value, source);
  }
}

function assertFunction(
  value: unknown,
  source: string,
): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") {
    throw new Error(`[evjs] ${source} must be a function.`);
  }
}

function assertObject(
  value: unknown,
  source: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`[evjs] ${source} must be an object.`);
  }
}

export async function handleFrameworkRenderRequest(
  options: FrameworkServerOptions,
  request: Request,
): Promise<Response | undefined> {
  if (!options.render) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  const allowed = await runPageRenderRequestGuard(options, request);
  if (allowed instanceof Response) {
    return request.method === "HEAD" ? withoutResponseBody(allowed) : allowed;
  }
  if (!allowed) {
    return undefined;
  }

  const url = new URL(request.url);
  const route = matchRoute(options.manifest.routes, url.pathname);
  const pageId = route?.pageId ?? inferPageId(options.manifest, url.pathname);
  const page = pageId ? options.manifest.pages[pageId] : undefined;

  if (!route && !page) return undefined;

  const ctx: ServerRenderContext = {
    request,
    manifest: options.manifest,
    pageUrl: url.toString(),
    route,
    page,
    pageId,
  };
  const coordinator = normalizeRenderCoordinator(options.render);
  const match = await runServerRenderMatch(
    coordinator,
    ctx,
    "Framework render coordinator",
  );
  if (match instanceof Response) {
    return request.method === "HEAD" ? withoutResponseBody(match) : match;
  }
  if (!match) return undefined;

  const response = await runServerRender(
    coordinator,
    match,
    "Framework render coordinator",
  );
  return renderPprPageResponse(options, request, match, response, coordinator);
}

async function runPageRenderRequestGuard(
  options: FrameworkServerOptions,
  request: Request,
): Promise<boolean | Response> {
  if (!options.allowPageRenderRequest) return true;
  try {
    const allowed = await options.allowPageRenderRequest(request);
    if (typeof allowed === "boolean" || allowed instanceof Response) {
      return allowed;
    }
    return textResponse(
      "[evjs] framework.allowPageRenderRequest must return a boolean or Response.",
      500,
    );
  } catch (error) {
    return textResponse(
      `[evjs] framework.allowPageRenderRequest failed: ${formatUnknownError(error)}`,
      500,
    );
  }
}

async function runServerRenderMatch(
  coordinator: ServerRenderCoordinator,
  ctx: ServerRenderContext,
  source: string,
): Promise<ServerRenderContext | undefined | Response> {
  try {
    return toServerRenderMatch(
      coordinator.match ? await coordinator.match(ctx) : ctx,
      source,
    );
  } catch (error) {
    return textResponse(
      `[evjs] ${source} match failed: ${formatUnknownError(error)}`,
      500,
    );
  }
}

async function runServerRender(
  coordinator: ServerRenderCoordinator,
  ctx: ServerRenderContext,
  source: string,
): Promise<Response> {
  try {
    return toResponse(await coordinator.render(ctx), source);
  } catch (error) {
    return textResponse(
      `[evjs] ${source} render failed: ${formatUnknownError(error)}`,
      500,
    );
  }
}

export async function handlePprRegionRequest(
  options: FrameworkServerOptions,
  request: Request,
): Promise<Response | undefined> {
  if (!options.render) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;

  const url = new URL(request.url);
  let match: PprRegionMatch | undefined;
  try {
    match = matchPprRegion(options.manifest, url.pathname);
    if (match) {
      match = withPprRegionPageUrl(options.manifest, match, url);
    }
  } catch (error) {
    if (error instanceof PprRegionRequestError) {
      const response = textResponse(error.message, 400);
      return request.method === "HEAD"
        ? withoutResponseBody(response)
        : response;
    }
    throw error;
  }
  if (!match) return undefined;

  const page = options.manifest.pages[match.pageId];
  if (!page?.ppr) return undefined;
  const region = page.ppr?.regions[match.regionId];
  if (!region) return undefined;
  const coordinator = normalizeRenderCoordinator(options.render);
  const response = await renderPprRegionResponse(
    options,
    request,
    match,
    coordinator,
  );
  return request.method === "HEAD" && response
    ? withoutResponseBody(response)
    : response;
}

async function renderPprPageResponse(
  options: FrameworkServerOptions,
  request: Request,
  ctx: ServerRenderContext,
  response: Response,
  coordinator: ServerRenderCoordinator,
): Promise<Response> {
  const pageId = ctx.pageId;
  const page = pageId ? options.manifest.pages[pageId] : undefined;
  if (!pageId || !page?.ppr) {
    return request.method === "HEAD" ? withoutResponseBody(response) : response;
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!isTextHtmlContentType(contentType)) {
    return request.method === "HEAD" ? withoutResponseBody(response) : response;
  }

  if (request.method === "HEAD") {
    const headers = new Headers(response.headers);
    applyDefaultPprPageCacheHeaders(headers, page, options);
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return page.ppr.delivery === "stream"
    ? renderPprStreamingPageResponse(
        options,
        request,
        pageId,
        response,
        coordinator,
      )
    : renderPprMergedPageResponse(
        options,
        request,
        pageId,
        response,
        coordinator,
      );
}

async function renderPprMergedPageResponse(
  options: FrameworkServerOptions,
  request: Request,
  pageId: string,
  response: Response,
  coordinator: ServerRenderCoordinator,
): Promise<Response> {
  const page = options.manifest.pages[pageId];
  if (!page?.ppr) return response;

  let html = await response.text();
  let changed = false;

  for (const regionId of Object.keys(page.ppr.regions)) {
    const regionResponse = await renderPprRegionResponse(
      options,
      request,
      { pageId, regionId, pageUrl: request.url },
      coordinator,
    );
    if (!isPatchablePprRegionResponse(regionResponse)) continue;

    const nextHtml = replacePprRegionPlaceholder(
      html,
      regionId,
      await regionResponse.text(),
    );
    if (nextHtml !== html) {
      html = nextHtml;
      changed = true;
    }
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Type", TEXT_HTML_UTF8_CONTENT_TYPE);
  applyDefaultPprPageCacheHeaders(headers, page, options);
  if (!changed) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  headers.set("x-evjs-ppr", "merged");
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function renderPprStreamingPageResponse(
  options: FrameworkServerOptions,
  request: Request,
  pageId: string,
  response: Response,
  coordinator: ServerRenderCoordinator,
): Promise<Response> {
  const page = options.manifest.pages[pageId];
  if (!page?.ppr) return response;

  const html = await response.text();
  const { head, tail } = splitHtmlForPprStream(html);
  const headers = new Headers(response.headers);
  headers.set("Content-Type", TEXT_HTML_UTF8_CONTENT_TYPE);
  applyDefaultPprPageCacheHeaders(headers, page, options);
  headers.set("x-evjs-ppr", "stream");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(head));

      for (const regionId of Object.keys(page.ppr?.regions ?? {})) {
        try {
          const regionResponse = await renderPprRegionResponse(
            options,
            request,
            { pageId, regionId, pageUrl: request.url },
            coordinator,
          );
          if (!isPatchablePprRegionResponse(regionResponse)) continue;

          const fragment = await regionResponse.text();
          controller.enqueue(
            encoder.encode(createPprStreamPatch(regionId, fragment)),
          );
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `<!-- evjs ppr region ${escapeHtmlCommentText(
                regionId,
              )} failed: ${escapeHtmlCommentText(formatUnknownError(error))} -->`,
            ),
          );
        }
      }

      controller.enqueue(encoder.encode(tail));
      controller.close();
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function renderPprRegionResponse(
  options: FrameworkServerOptions,
  request: Request,
  match: PprRegionMatch,
  coordinator: ServerRenderCoordinator,
): Promise<Response | undefined> {
  const page = options.manifest.pages[match.pageId];
  if (!page?.ppr) return undefined;
  const region = page.ppr?.regions[match.regionId];
  if (!region) return undefined;
  const cachePolicy = region.cache ?? "no-store";
  const cacheKey = createPprRegionCacheKey(request, match);
  const cached = await readPprRegionCache(options, cacheKey, cachePolicy);
  if (cached) {
    if (cached.state === "stale" && request.method !== "HEAD") {
      schedulePprRegionRevalidation(options, cacheKey, () =>
        refreshPprRegionCache(
          options,
          request,
          match,
          coordinator,
          cacheKey,
          cachePolicy,
        ),
      );
    }
    return cached.response;
  }

  const response = await renderFreshPprRegionResponse(
    options,
    request,
    match,
    coordinator,
  );
  if (!response) return undefined;

  return applyPprRegionCache(options, cacheKey, cachePolicy, response, {
    store: request.method !== "HEAD",
  });
}

async function refreshPprRegionCache(
  options: FrameworkServerOptions,
  request: Request,
  match: PprRegionMatch,
  coordinator: ServerRenderCoordinator,
  cacheKey: string,
  cachePolicy: PprCachePolicy,
): Promise<void> {
  const freshResponse = await renderFreshPprRegionResponse(
    options,
    request,
    match,
    coordinator,
  );
  if (!freshResponse) return;

  await applyPprRegionCache(options, cacheKey, cachePolicy, freshResponse, {
    store: true,
  });
}

async function renderFreshPprRegionResponse(
  options: FrameworkServerOptions,
  request: Request,
  match: PprRegionMatch,
  coordinator: ServerRenderCoordinator,
): Promise<Response | undefined> {
  const page = options.manifest.pages[match.pageId];
  if (!page?.ppr) return undefined;
  const ctx: ServerRenderContext = {
    request,
    manifest: options.manifest,
    pageUrl: match.pageUrl,
    page,
    pageId: match.pageId,
    regionId: match.regionId,
  };
  const renderMatch = await runServerRenderMatch(
    coordinator,
    ctx,
    "PPR region render coordinator",
  );
  if (renderMatch instanceof Response) {
    return request.method === "HEAD"
      ? withoutResponseBody(renderMatch)
      : renderMatch;
  }
  if (!renderMatch) return undefined;

  return normalizePprRegionResponse(
    match,
    await runServerRender(
      coordinator,
      renderMatch,
      "PPR region render coordinator",
    ),
    {
      readBody: request.method !== "HEAD",
    },
  );
}

export async function handleRscFlightRequest(
  options: FrameworkServerOptions,
  request: Request,
): Promise<Response | undefined> {
  if (!options.rsc) return undefined;

  const rscPath =
    options.manifest.rsc?.endpoint ?? options.manifest.runtime.server?.rsc;
  if (!rscPath) return undefined;

  const url = new URL(request.url);
  if (
    normalizeRoutePathname(url.pathname) !== normalizeRoutePathname(rscPath)
  ) {
    return undefined;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse("Method Not Allowed", 405, {
      Allow: "GET, HEAD",
    });
  }

  let ctx: RscFlightContext;
  try {
    ctx = {
      request,
      manifest: options.manifest,
      ...createRscFlightPageContext(options.manifest, url),
    };
  } catch (error) {
    if (error instanceof RscFlightRequestError) {
      const response = textResponse(error.message, 400);
      return request.method === "HEAD"
        ? withoutResponseBody(response)
        : response;
    }
    throw error;
  }

  const validationError = validateRscFlightContext(ctx);
  if (validationError) {
    return request.method === "HEAD"
      ? withoutResponseBody(validationError)
      : validationError;
  }

  const coordinator = normalizeRscCoordinator(options.rsc);
  if (coordinator.match) {
    let match: boolean;
    try {
      match = toRscCoordinatorMatch(
        await coordinator.match(ctx),
        "RSC Flight coordinator",
      );
    } catch (error) {
      const response = textResponse(
        `[evjs] RSC Flight match failed: ${formatUnknownError(error)}`,
        500,
      );
      return request.method === "HEAD"
        ? withoutResponseBody(response)
        : response;
    }
    if (!match) {
      const response = textResponse(
        `[evjs] No RSC Flight coordinator matched page "${ctx.pageId}".`,
        404,
      );
      return request.method === "HEAD"
        ? withoutResponseBody(response)
        : response;
    }
  }

  try {
    const response = await coordinator.renderFlight(ctx);
    assertRscFlightResponse(response, "RSC Flight coordinator renderFlight()");
    const cacheSafeResponse = withDefaultRscFlightCacheHeaders(response);
    return request.method === "HEAD"
      ? withoutResponseBody(cacheSafeResponse)
      : cacheSafeResponse;
  } catch (error) {
    const response = textResponse(
      `[evjs] RSC Flight render failed: ${formatUnknownError(error)}`,
      500,
    );
    return request.method === "HEAD" ? withoutResponseBody(response) : response;
  }
}

function createRscFlightPageContext(
  manifest: BuildOutput,
  url: URL,
): Pick<
  RscFlightContext,
  "pageUrl" | "pageId" | "page" | "rscPage" | "renderer"
> {
  const pageId = url.searchParams.get("page") ?? undefined;
  const page = pageId ? manifest.pages[pageId] : undefined;
  const rscPage = pageId ? manifest.rsc?.pages?.[pageId] : undefined;
  const renderer = rscPage?.renderer
    ? manifest.server?.renderers?.[rscPage.renderer]
    : undefined;
  const pageUrl = resolveRscFlightPageUrl(url);

  return {
    pageUrl,
    pageId,
    page,
    rscPage,
    renderer,
  };
}

function resolveRscFlightPageUrl(url: URL): string | undefined {
  const result = resolveRscFlightRequestPageUrl(url);
  if (result.error) {
    throw new RscFlightRequestError(
      formatRscFlightRequestPageUrlError(result.error),
    );
  }
  return result.value;
}

function withPprRegionPageUrl(
  manifest: BuildOutput,
  match: PprRegionMatch,
  url: URL,
): PprRegionMatch {
  const page = manifest.pages[match.pageId];
  const explicitPageUrl = resolvePprRegionPageUrl(url);
  const pageUrl =
    explicitPageUrl ?? inferStaticPprRegionPageUrl(manifest, match, page, url);
  if (!pageUrl && shouldRequirePprRegionPageUrl(manifest, match, page)) {
    throw new PprRegionRequestError(
      `[evjs] PPR region request url is required for page "${match.pageId}" because its route cannot be inferred from the direct region endpoint.`,
    );
  }
  if (pageUrl && !pageUrlMatchesPage(manifest, match.pageId, page, pageUrl)) {
    throw new PprRegionRequestError(
      `[evjs] PPR region request url does not match page "${match.pageId}".`,
    );
  }
  return pageUrl ? { ...match, pageUrl } : match;
}

function inferStaticPprRegionPageUrl(
  manifest: BuildOutput,
  match: PprRegionMatch,
  page: PageOutput | undefined,
  requestUrl: URL,
): string | undefined {
  const paths = getPprRegionPagePaths(manifest, match.pageId, page);
  return paths.length === 1 && isStaticPagePath(paths[0])
    ? new URL(paths[0], requestUrl).toString()
    : undefined;
}

function shouldRequirePprRegionPageUrl(
  manifest: BuildOutput,
  match: PprRegionMatch,
  page: PageOutput | undefined,
): boolean {
  const paths = getPprRegionPagePaths(manifest, match.pageId, page);
  return (
    paths.length > 0 && !(paths.length === 1 && isStaticPagePath(paths[0]))
  );
}

function getPprRegionPagePaths(
  manifest: BuildOutput,
  pageId: string,
  page: PageOutput | undefined,
): string[] {
  const routePaths = manifest.routes
    .filter((route) => route.pageId === pageId)
    .map((route) => route.path);
  return routePaths.length > 0 ? routePaths : page?.path ? [page.path] : [];
}

function isStaticPagePath(pathname: string): boolean {
  return !/(^|\/)(?:[$:]|[*])/.test(pathname);
}

function resolvePprRegionPageUrl(url: URL): string | undefined {
  const result = resolveRscFlightRequestPageUrl(url);
  if (result.error) {
    throw new PprRegionRequestError(
      formatPprRegionRequestPageUrlError(result.error),
    );
  }
  return result.value;
}

function formatPprRegionRequestPageUrlError(
  error: RscFlightRequestPageUrlError,
): string {
  switch (error) {
    case "not-absolute-path":
      return '[evjs] PPR region request url must be an absolute path starting with "/".';
    case "invalid-path":
      return "[evjs] PPR region request url is not a valid URL path.";
    case "cross-origin-or-hash":
      return "[evjs] PPR region request url must stay on the same origin and must not include a hash.";
  }
}

class RscFlightRequestError extends Error {}

function formatRscFlightRequestPageUrlError(
  error: RscFlightRequestPageUrlError,
): string {
  switch (error) {
    case "not-absolute-path":
      return '[evjs] RSC Flight request url must be an absolute path starting with "/".';
    case "invalid-path":
      return "[evjs] RSC Flight request url is not a valid URL path.";
    case "cross-origin-or-hash":
      return "[evjs] RSC Flight request url must stay on the same origin and must not include a hash.";
  }
}

function validateRscFlightContext(ctx: RscFlightContext): Response | undefined {
  if (!ctx.pageId) {
    return textResponse(
      "[evjs] RSC Flight request is missing the page query parameter.",
      400,
    );
  }
  if (!isBuildIdentifier(ctx.pageId)) {
    return textResponse(
      `[evjs] RSC Flight request page query parameter must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
      400,
    );
  }

  if (!ctx.page) {
    return textResponse(
      `[evjs] RSC page "${ctx.pageId}" is not in the manifest.`,
      404,
    );
  }

  if (ctx.pageUrl && !rscFlightPageUrlMatchesPage(ctx)) {
    return textResponse(
      `[evjs] RSC Flight request url does not match page "${ctx.pageId}".`,
      400,
    );
  }

  if (ctx.page.componentModel !== "rsc") {
    return textResponse(
      `[evjs] Page "${ctx.pageId}" is not configured with componentModel: "rsc".`,
      404,
    );
  }

  if (!ctx.rscPage) {
    return textResponse(
      `[evjs] RSC page "${ctx.pageId}" has no RSC manifest metadata.`,
      501,
    );
  }

  if (!ctx.renderer) {
    return textResponse(
      `[evjs] RSC page "${ctx.pageId}" has no loadable RSC renderer.`,
      501,
    );
  }

  return undefined;
}

function rscFlightPageUrlMatchesPage(ctx: RscFlightContext): boolean {
  if (!ctx.pageUrl || !ctx.pageId) return true;
  return pageUrlMatchesPage(ctx.manifest, ctx.pageId, ctx.page, ctx.pageUrl);
}

function pageUrlMatchesPage(
  manifest: BuildOutput,
  pageId: string,
  page: PageOutput | undefined,
  pageUrl: string,
): boolean {
  const pathname = normalizeRoutePathname(new URL(pageUrl).pathname);
  const pageRoutes = manifest.routes.filter((route) => route.pageId === pageId);

  if (pageRoutes.length > 0) {
    return pageRoutes.some((route) =>
      pageRoutePathMatches(route.path, pathname),
    );
  }

  return page?.path ? pageRoutePathMatches(page.path, pathname) : true;
}

function normalizeRenderCoordinator(
  render: ServerRenderHandler | ServerRenderCoordinator,
): ServerRenderCoordinator {
  if (typeof render === "function") {
    return {
      render,
    };
  }
  return render;
}

function normalizeRscCoordinator(
  rsc: RscFlightHandler | RscCoordinator,
): RscCoordinator {
  if (typeof rsc === "function") {
    return {
      renderFlight: rsc,
    };
  }
  return rsc;
}

function withDefaultRscFlightCacheHeaders(response: Response): Response {
  if (response.headers.has("Cache-Control")) return response;

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function assertRscFlightResponse(
  value: unknown,
  source: string,
): asserts value is Response {
  if (!(value instanceof Response)) {
    throw new Error(`[evjs] ${source} must return a Response.`);
  }
  if (!value.ok) return;

  const contentType = value.headers.get("Content-Type");
  if (!isRscFlightContentType(contentType)) {
    throw new Error(
      `[evjs] ${source} must return Content-Type "${RSC_FLIGHT_CONTENT_TYPE}"; received ${formatContentTypeHeaderValue(
        contentType,
      )}.`,
    );
  }
}

function toRscCoordinatorMatch(value: unknown, source: string): boolean {
  if (typeof value === "boolean") return value;
  throw new Error(`[evjs] ${source} match() must return a boolean.`);
}

function withoutResponseBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function createRendererRegistryFromManifest(
  manifest: BuildOutput,
  loadModule: ManifestServerModuleLoader,
): ServerRendererRegistry {
  const renderers = manifest.server?.renderers ?? {};
  return Object.fromEntries(
    Object.entries(renderers).map(([name, renderer]) => {
      const asset = renderer.assets.js[0];
      return [
        name,
        {
          kind: renderer.kind,
          owner: renderer.owner,
          load() {
            if (!asset) {
              return Promise.resolve({});
            }
            return loadModule(asset, renderer);
          },
        },
      ];
    }),
  );
}

function findRenderer(
  ctx: ServerRenderContext,
  renderers: ServerRendererRegistry,
): { name: string; entry: ServerRendererRegistryEntry } | undefined {
  const candidates = Object.entries(renderers).map(([name, entry]) => ({
    name,
    entry,
  }));
  const pageId = ctx.pageId;
  const routeId = ctx.route?.id;
  const preferredKind = isPartialPrerenderPageOutput(ctx.page)
    ? "ppr-shell"
    : ctx.page?.componentModel === "rsc"
      ? "page-server"
      : undefined;

  if (pageId && ctx.regionId) {
    const regionRenderer = candidates.find(
      ({ entry }) =>
        entry.kind === "ppr-region" &&
        entry.owner?.pageId === pageId &&
        entry.owner?.regionId === ctx.regionId,
    );
    if (regionRenderer) return regionRenderer;
  }

  if (pageId && preferredKind) {
    const pageRenderer = candidates.find(
      ({ entry }) =>
        entry.kind === preferredKind && entry.owner?.pageId === pageId,
    );
    if (pageRenderer) return pageRenderer;
  }

  if (pageId) {
    const pageRenderer = candidates.find(
      ({ entry }) =>
        entry.kind === "page-server" && entry.owner?.pageId === pageId,
    );
    if (pageRenderer) return pageRenderer;
  }

  if (routeId) {
    const routeRenderer = candidates.find(
      ({ entry }) =>
        (entry.kind === "page-server" || entry.kind === "rsc-page") &&
        entry.owner?.routeId === routeId,
    );
    if (routeRenderer) return routeRenderer;
  }

  return undefined;
}

function isPartialPrerenderPageOutput(
  page: ServerRenderContext["page"],
): boolean {
  return Boolean(page?.ppr || page?.rendering.prerender === "partial");
}

function loadRendererModule(
  name: string,
  entry: ServerRendererRegistryEntry,
  cache: Map<string, Promise<ServerRendererModule>>,
): Promise<ServerRendererModule> {
  const cached = cache.get(name);
  if (cached) return cached;

  const loaded = entry.load();
  cache.set(name, loaded);
  loaded.catch(() => {
    if (cache.get(name) === loaded) {
      cache.delete(name);
    }
  });
  return loaded;
}

function getNamedModuleRenderFunction(
  module: ServerRendererModule,
):
  | ((
      ctx: ServerRenderContext,
    ) => ServerRenderResult | Promise<ServerRenderResult>)
  | undefined {
  if (typeof module.render === "function") {
    return module.render as (
      ctx: ServerRenderContext,
    ) => ServerRenderResult | Promise<ServerRenderResult>;
  }

  return undefined;
}

function getDefaultModuleRenderFunction(
  module: ServerRendererModule,
):
  | ((
      ctx: ServerRenderContext,
    ) => ServerRenderResult | Promise<ServerRenderResult>)
  | undefined {
  if (typeof module.default === "function") {
    return module.default as (
      ctx: ServerRenderContext,
    ) => ServerRenderResult | Promise<ServerRenderResult>;
  }

  return undefined;
}

function invalidServerRenderResult(source: string): Response {
  return textResponse(
    `[evjs] ${source} returned an invalid result. Expected Response, string, or { html, status?, headers? }.`,
    501,
  );
}

function isServerRenderResult(result: unknown): result is ServerRenderResult {
  if (result instanceof Response) return true;
  if (typeof result === "string") return true;
  return isHtmlResult(result);
}

function isHtmlResult(
  result: unknown,
): result is { html: string; status?: unknown; headers?: unknown } {
  return Boolean(
    result &&
      typeof result === "object" &&
      typeof (result as { html?: unknown }).html === "string",
  );
}

function validateHtmlResult(
  result: { status?: unknown; headers?: unknown },
  source: string,
): Response | undefined {
  if (result.status !== undefined && !isHttpBodyStatus(result.status)) {
    return textResponse(
      `[evjs] ${source} status must be an integer HTTP status between 200 and 599 that can include an HTML body.`,
      501,
    );
  }

  if (result.headers !== undefined && !isHeadersInit(result.headers)) {
    return textResponse(
      `[evjs] ${source} headers must be valid HeadersInit.`,
      501,
    );
  }

  return undefined;
}

function toServerRenderMatch(
  value: unknown,
  source: string,
): ServerRenderContext | undefined | Response {
  if (!value) return undefined;
  if (isServerRenderContext(value)) return value;
  return textResponse(
    `[evjs] ${source} match() must return a render context or undefined.`,
    501,
  );
}

function isServerRenderContext(value: unknown): value is ServerRenderContext {
  return (
    isRecord(value) &&
    value.request instanceof Request &&
    isRecord(value.manifest)
  );
}

function matchRoute(
  routes: RouteOutput[],
  pathname: string,
): RouteOutput | undefined {
  return findBestPageRoute(routes, pathname);
}

function inferPageId(
  manifest: BuildOutput,
  pathname: string,
): string | undefined {
  const normalized = normalizeRoutePathname(pathname);
  const directId = normalized === "/" ? "index" : normalized.slice(1);
  const withoutHtml = directId.replace(/\.html$/, "");

  if (manifest.pages[withoutHtml]) return withoutHtml;
  if (manifest.pages[directId]) return directId;

  const dotted = withoutHtml.replaceAll("/", ".");
  return manifest.pages[dotted] ? dotted : undefined;
}

function matchPprRegion(
  manifest: BuildOutput,
  pathname: string,
): PprRegionMatch | undefined {
  const endpoint = normalizeRoutePathname(
    manifest.runtime.server?.ppr ??
      joinPath(manifest.runtime.server?.basePath ?? "/__evjs", "ppr"),
  );
  const normalized = normalizeRoutePathname(pathname);
  if (normalized === endpoint || !normalized.startsWith(`${endpoint}/`)) {
    return undefined;
  }

  const segments = normalized.slice(endpoint.length + 1).split("/");
  if (segments.length !== 2) return undefined;

  const pageId = decodePprRegionPathSegment(segments[0], "page");
  const regionId = decodePprRegionPathSegment(segments[1], "region");
  if (!pageId || !regionId) return undefined;
  return { pageId, regionId };
}

function decodePprRegionPathSegment(
  segment: string | undefined,
  name: "page" | "region",
): string {
  if (segment === undefined) return "";
  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    throw new PprRegionRequestError(
      "[evjs] PPR region request path contains invalid URL encoding.",
    );
  }

  if (/[/?#\s]/.test(value)) {
    throw new PprRegionRequestError(
      `[evjs] PPR region request ${name} path segment must not contain separators, whitespace, query strings, or hashes.`,
    );
  }
  if (!isBuildIdentifier(value)) {
    throw new PprRegionRequestError(
      `[evjs] PPR region request ${name} path segment must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
    );
  }
  return value;
}

class PprRegionRequestError extends Error {}

function createPprRegionCacheKey(
  request: Request,
  match: PprRegionMatch,
): string {
  const url = new URL(match.pageUrl ?? request.url, request.url);
  return `${match.pageId}:${match.regionId}:${normalizeRoutePathname(url.pathname)}${url.search}`;
}

async function readPprRegionCache(
  options: FrameworkServerOptions,
  key: string,
  policy: PprCachePolicy,
): Promise<PprRegionCacheRead | undefined> {
  const revalidate = getPprRegionRevalidate(policy);
  if (revalidate === undefined) return undefined;

  const cache = getPprRegionCache(options);
  const cached = await getPprRegionCacheEntry(cache, key);
  if (!cached) return undefined;
  const now = Date.now();
  const isFresh = cached.expiresAt > now;
  const isStale =
    !isFresh && cached.staleUntil !== undefined && cached.staleUntil > now;
  if (!isFresh && !isStale) {
    await deletePprRegionCacheEntry(cache, key);
    return undefined;
  }

  const headers = new Headers(cached.headers);
  headers.set("x-evjs-cache", isFresh ? "HIT" : "STALE");
  return {
    state: isFresh ? "fresh" : "stale",
    response: new Response(cached.body.slice(0), {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    }),
  };
}

async function applyPprRegionCache(
  options: FrameworkServerOptions,
  key: string,
  policy: PprCachePolicy,
  response: Response,
  writeOptions: PprRegionCacheWriteOptions,
): Promise<Response> {
  const headers = new Headers(response.headers);
  const revalidate = getPprRegionRevalidate(policy);
  if (revalidate === undefined) {
    if (!headers.has("Cache-Control")) {
      headers.set("Cache-Control", "no-store");
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  if (!headers.has("Cache-Control")) {
    headers.set(
      "Cache-Control",
      createRevalidateCacheControl(
        revalidate,
        getPprStaleWhileRevalidate(options),
      ),
    );
  }
  headers.set("x-evjs-cache", "MISS");

  if (!writeOptions.store) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const body = await response.arrayBuffer();
  if (response.ok) {
    const now = Date.now();
    const staleWhileRevalidate = getPprStaleWhileRevalidate(options);
    const entry: PprRegionCacheEntry = {
      expiresAt: now + revalidate * 1000,
      ...(staleWhileRevalidate > 0
        ? { staleUntil: now + (revalidate + staleWhileRevalidate) * 1000 }
        : {}),
      status: response.status,
      statusText: response.statusText,
      headers: [...headers.entries()].filter(
        ([name]) => name.toLowerCase() !== "x-evjs-cache",
      ),
      body,
    };
    await setPprRegionCacheEntry(getPprRegionCache(options), key, entry);
  }

  return new Response(body.slice(0), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function getPprRegionRevalidate(policy: PprCachePolicy): number | undefined {
  if (policy === "no-store") return undefined;
  if (!Number.isInteger(policy.revalidate) || policy.revalidate <= 0) {
    return undefined;
  }
  return policy.revalidate;
}

function getPprStaleWhileRevalidate(options: FrameworkServerOptions): number {
  const value = options.ppr?.staleWhileRevalidate;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 0;
}

function createRevalidateCacheControl(
  revalidate: number,
  staleWhileRevalidate = 0,
): string {
  return staleWhileRevalidate > 0
    ? `s-maxage=${revalidate}, stale-while-revalidate=${staleWhileRevalidate}`
    : `s-maxage=${revalidate}`;
}

function getPprRegionCache(options: FrameworkServerOptions): PprRegionCache {
  if (options.ppr?.regionCache) return options.ppr.regionCache;

  let cache = pprRegionCaches.get(options);
  if (!cache) {
    cache = new Map();
    pprRegionCaches.set(options, cache);
  }
  const cacheMap = cache;

  return {
    get: (key) => cacheMap.get(key),
    set: (key, entry) => {
      cacheMap.set(key, entry);
    },
    delete: (key) => {
      cacheMap.delete(key);
    },
  };
}

async function getPprRegionCacheEntry(
  cache: PprRegionCache,
  key: string,
): Promise<PprRegionCacheEntry | undefined> {
  try {
    return await cache.get(key);
  } catch (error) {
    console.error(
      `[evjs] PPR region cache get failed for "${key}": ${formatUnknownError(error)}`,
    );
    return undefined;
  }
}

async function setPprRegionCacheEntry(
  cache: PprRegionCache,
  key: string,
  entry: PprRegionCacheEntry,
): Promise<void> {
  try {
    await cache.set(key, entry);
  } catch (error) {
    console.error(
      `[evjs] PPR region cache set failed for "${key}": ${formatUnknownError(error)}`,
    );
  }
}

async function deletePprRegionCacheEntry(
  cache: PprRegionCache,
  key: string,
): Promise<void> {
  try {
    await cache.delete?.(key);
  } catch (error) {
    console.error(
      `[evjs] PPR region cache delete failed for "${key}": ${formatUnknownError(error)}`,
    );
  }
}

function schedulePprRegionRevalidation(
  options: FrameworkServerOptions,
  key: string,
  task: () => Promise<unknown>,
): void {
  let active = pprRegionRevalidations.get(options);
  if (!active) {
    active = new Set();
    pprRegionRevalidations.set(options, active);
  }
  if (active.has(key)) return;
  active.add(key);

  const promise = Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(
        `[evjs] PPR region stale revalidation failed for "${key}": ${formatUnknownError(error)}`,
      );
    })
    .finally(() => {
      active.delete(key);
    });

  waitUntilPprRegionRevalidation(promise);
}

function waitUntilPprRegionRevalidation(promise: Promise<unknown>): void {
  try {
    const context = tryGetContext();
    const executionCtx = context?.executionCtx as
      | { waitUntil?: (p: Promise<unknown>) => void }
      | undefined;
    executionCtx?.waitUntil?.(promise);
  } catch {
    // Hono only exposes executionCtx in runtimes that provide waitUntil.
  }
}

function applyDefaultPprPageCacheHeaders(
  headers: Headers,
  page: PageOutput,
  options: FrameworkServerOptions,
): void {
  if (headers.has("Cache-Control")) return;

  const cacheControl = getPprPageCacheControl(page, options);
  if (cacheControl) {
    headers.set("Cache-Control", cacheControl);
  }
}

function getPprPageCacheControl(
  page: PageOutput,
  options: FrameworkServerOptions,
): string | undefined {
  if (!page.ppr) return undefined;

  const regions = Object.values(page.ppr.regions);
  if (regions.length === 0) return "no-store";

  let minRevalidate = Number.POSITIVE_INFINITY;
  for (const region of regions) {
    const revalidate = getPprRegionRevalidate(region.cache ?? "no-store");
    if (revalidate === undefined) return "no-store";
    minRevalidate = Math.min(minRevalidate, revalidate);
  }

  return createRevalidateCacheControl(
    minRevalidate,
    getPprStaleWhileRevalidate(options),
  );
}

function isPatchablePprRegionResponse(
  response: Response | undefined,
): response is Response {
  return (
    response?.ok === true &&
    isTextHtmlContentType(response.headers.get("Content-Type") ?? "")
  );
}

async function normalizePprRegionResponse(
  match: PprRegionMatch,
  response: Response,
  options: PprRegionNormalizeOptions = { readBody: true },
): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("x-evjs-page", match.pageId);
  headers.set("x-evjs-ppr-region", match.regionId);

  const contentType = headers.get("Content-Type") ?? "";
  if (!isTextHtmlContentType(contentType)) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  headers.set("Content-Type", TEXT_HTML_UTF8_CONTENT_TYPE);
  if (!options.readBody) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const html = await response.text();
  return new Response(extractPprRegionFragment(html), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function extractPprRegionFragment(html: string): string {
  if (!/<!doctype|<html[\s>]/i.test(html)) return html;

  const mountMatch = html.match(
    /<div\s+[^>]*(?:id=["']app["']|data-evjs-mount=["'][^"']+["'])[^>]*>/i,
  );
  if (mountMatch?.[0] && mountMatch.index !== undefined) {
    const fragment = extractBalancedDivContent(
      html,
      mountMatch.index,
      mountMatch[0].length,
    );
    if (fragment) return fragment;
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) {
    return bodyMatch[1].replace(/<script\b[\s\S]*?<\/script>/gi, "").trim();
  }

  return html;
}

function replacePprRegionPlaceholder(
  html: string,
  regionId: string,
  fragment: string,
): string {
  const range = findPprRegionPlaceholderRange(html, regionId);
  if (!range) return replaceFirstSuspenseFallback(html, fragment);
  return `${html.slice(0, range.start)}${fragment}${html.slice(range.end)}`;
}

function splitHtmlForPprStream(html: string): { head: string; tail: string } {
  const closeBody = html.match(/<\/body\s*>/i);
  if (!closeBody || closeBody.index === undefined) {
    return { head: html, tail: "" };
  }

  return {
    head: html.slice(0, closeBody.index),
    tail: html.slice(closeBody.index),
  };
}

function createPprStreamPatch(regionId: string, fragment: string): string {
  return [
    `<script data-evjs-ppr-stream-region="${escapeHtmlAttribute(regionId)}">`,
    "(function(){",
    `var regionId=${jsonForInlineScript(regionId)};`,
    `var html=${jsonForInlineScript(fragment)};`,
    "var currentScript=document.currentScript;",
    "var template=document.createElement('template');",
    "template.innerHTML=html;",
    "var root=document.body||document.documentElement;",
    "var explicit=document.querySelectorAll('[data-evjs-ppr-region]');",
    "for(var i=0;i<explicit.length;i++){",
    "var target=explicit[i];",
    "if(target.getAttribute('data-evjs-ppr-region')===regionId){",
    "target.replaceWith(template.content.cloneNode(true));",
    "if(currentScript)currentScript.remove();return;",
    "}",
    "}",
    "var walker=document.createTreeWalker(root,128);",
    "var start=null,node;",
    "while((node=walker.nextNode())){",
    "var value=node.nodeValue||'';",
    "if(!start&&(value==='$!'||value==='$?')){start=node;continue;}",
    "if(start&&value==='/$'){",
    "var range=document.createRange();",
    "range.setStartBefore(start);range.setEndAfter(node);",
    "range.deleteContents();",
    "range.insertNode(template.content.cloneNode(true));",
    "if(currentScript)currentScript.remove();return;",
    "}",
    "}",
    "})();",
    "</script>",
  ].join("");
}

function jsonForInlineScript(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlCommentText(value: string): string {
  return value.replace(/--/g, "- -").replace(/>/g, "&gt;");
}

function findPprRegionPlaceholderRange(
  html: string,
  regionId: string,
): { start: number; end: number } | undefined {
  const openPattern = new RegExp(
    `<([A-Za-z][\\w:-]*)\\b[^>]*\\sdata-evjs-ppr-region=(["'])${escapeRegExp(regionId)}\\2[^>]*>`,
    "i",
  );
  const match = openPattern.exec(html);
  if (!match?.[0] || match.index === undefined) return undefined;

  const tagName = match[1];
  const start = match.index;
  const openTag = match[0];
  if (openTag.endsWith("/>")) {
    return {
      start,
      end: start + openTag.length,
    };
  }

  const end = findBalancedElementEnd(html, tagName, start, openTag.length);
  return end === undefined ? undefined : { start, end };
}

function replaceFirstSuspenseFallback(html: string, fragment: string): string {
  const range = findFirstSuspenseFallbackRange(html);
  if (!range) return html;
  return `${html.slice(0, range.start)}${fragment}${html.slice(range.end)}`;
}

function findFirstSuspenseFallbackRange(
  html: string,
): { start: number; end: number } | undefined {
  const startPattern = /<!--\$(?:[!?])?-->/g;
  let startMatch = startPattern.exec(html);

  while (startMatch) {
    const end = html.indexOf("<!--/$-->", startPattern.lastIndex);
    if (end === -1) return undefined;
    const marker = startMatch[0];
    if (marker !== "<!--$-->") {
      return {
        start: startMatch.index,
        end: end + "<!--/$-->".length,
      };
    }
    startMatch = startPattern.exec(html);
  }

  return undefined;
}

function findBalancedElementEnd(
  html: string,
  tagName: string,
  openIndex: number,
  openLength: number,
): number | undefined {
  const tagPattern = new RegExp(`</?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = openIndex + openLength;
  let depth = 1;

  for (
    let match = tagPattern.exec(html);
    match;
    match = tagPattern.exec(html)
  ) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      depth -= 1;
      if (depth === 0) return match.index + tag.length;
      continue;
    }

    if (!tag.endsWith("/>")) {
      depth += 1;
    }
  }

  return undefined;
}

function extractBalancedDivContent(
  html: string,
  openIndex: number,
  openLength: number,
): string | undefined {
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = openIndex + openLength;
  let depth = 1;

  for (
    let match = tagPattern.exec(html);
    match;
    match = tagPattern.exec(html)
  ) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(openIndex + openLength, match.index).trim();
      }
      continue;
    }

    if (!tag.endsWith("/>")) {
      depth += 1;
    }
  }

  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function joinPath(base: string, segment: string): string {
  return `${base.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`;
}

function toResponse(result: unknown, source: string): Response {
  if (!isServerRenderResult(result)) {
    return invalidServerRenderResult(source);
  }

  if (result instanceof Response) return result;
  if (typeof result === "string") {
    return new Response(result, {
      headers: { "Content-Type": TEXT_HTML_UTF8_CONTENT_TYPE },
    });
  }

  const validationError = validateHtmlResult(result, source);
  if (validationError) return validationError;

  return new Response(result.html, {
    status: result.status,
    headers: {
      "Content-Type": TEXT_HTML_UTF8_CONTENT_TYPE,
      ...Object.fromEntries(new Headers(result.headers)),
    },
  });
}
