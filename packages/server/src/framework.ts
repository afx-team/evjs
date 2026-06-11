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

export interface FrameworkServerOptions {
  manifest: BuildOutput;
  render?: ServerRenderHandler | ServerRenderCoordinator;
  rsc?: RscFlightHandler | RscCoordinator;
  allowPageRenderRequest?: (request: Request) => boolean;
}

export interface ServerRenderContext {
  request: Request;
  manifest: BuildOutput;
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

interface PprCachedResponse {
  expiresAt: number;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
}

const pprRegionCaches = new WeakMap<
  FrameworkServerOptions,
  Map<string, PprCachedResponse>
>();

export function createModuleRenderCoordinator(
  options: ModuleRenderCoordinatorOptions,
): ServerRenderCoordinator {
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
        return new Response("No framework server renderer matched request", {
          status: 404,
        });
      }

      const module = await loadRendererModule(
        renderer.name,
        renderer.entry,
        moduleCache,
      );
      const namedRender = getNamedModuleRenderFunction(module);
      if (namedRender) {
        const result = await namedRender(ctx);
        if (!isServerRenderResult(result)) {
          return invalidRendererResult(renderer.name);
        }
        return result;
      }

      const adapterResult = options.renderModule
        ? await options.renderModule(module, ctx, renderer)
        : undefined;
      if (adapterResult !== undefined) {
        if (!isServerRenderResult(adapterResult)) {
          return invalidRendererResult(renderer.name);
        }
        return adapterResult;
      }

      const render = getDefaultModuleRenderFunction(module);
      if (!render) {
        return new Response(
          `[evjs] Server renderer "${renderer.name}" must export render(ctx) or default(ctx). React component SSR requires a React server render adapter.`,
          { status: 501 },
        );
      }

      const result = await render(ctx);
      if (!isServerRenderResult(result)) {
        return invalidRendererResult(renderer.name);
      }

      return result;
    },
  };
}

export function createManifestRenderCoordinator(
  options: ManifestRenderCoordinatorOptions,
): ServerRenderCoordinator {
  return createModuleRenderCoordinator({
    renderers: createRendererRegistryFromManifest(
      options.manifest,
      options.loadModule,
    ),
    renderModule: options.renderModule,
    fallback: options.fallback,
  });
}

export async function handleFrameworkRenderRequest(
  options: FrameworkServerOptions,
  request: Request,
): Promise<Response | undefined> {
  if (!options.render) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  if (
    options.allowPageRenderRequest &&
    !options.allowPageRenderRequest(request)
  ) {
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
    route,
    page,
    pageId,
  };
  const coordinator = normalizeRenderCoordinator(options.render);
  const match = coordinator.match ? await coordinator.match(ctx) : ctx;
  if (!match) return undefined;

  const response = toResponse(await coordinator.render(match));
  return renderPprPageResponse(options, request, match, response, coordinator);
}

export async function handlePprRegionRequest(
  options: FrameworkServerOptions,
  request: Request,
): Promise<Response | undefined> {
  if (!options.render) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;

  const url = new URL(request.url);
  const match = matchPprRegion(options.manifest, url.pathname);
  if (!match) return undefined;

  const page = options.manifest.pages[match.pageId];
  if (!page?.ppr) return undefined;
  const region = page.ppr?.regions[match.regionId];
  if (!region) return undefined;
  const coordinator = normalizeRenderCoordinator(options.render);
  return renderPprRegionResponse(options, request, match, coordinator);
}

async function renderPprPageResponse(
  options: FrameworkServerOptions,
  request: Request,
  ctx: ServerRenderContext,
  response: Response,
  coordinator: ServerRenderCoordinator,
): Promise<Response> {
  if (request.method === "HEAD") return response;
  const pageId = ctx.pageId;
  const page = pageId ? options.manifest.pages[pageId] : undefined;
  if (!pageId || !page?.ppr) return response;

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) return response;

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
      { pageId, regionId },
      coordinator,
    );
    if (!regionResponse?.ok) continue;

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
  headers.set("Content-Type", "text/html; charset=utf-8");
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
  headers.set("Content-Type", "text/html; charset=utf-8");
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
            { pageId, regionId },
            coordinator,
          );
          if (!regionResponse?.ok) continue;

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
  match: { pageId: string; regionId: string },
  coordinator: ServerRenderCoordinator,
): Promise<Response | undefined> {
  const page = options.manifest.pages[match.pageId];
  if (!page?.ppr) return undefined;
  const region = page.ppr?.regions[match.regionId];
  if (!region) return undefined;
  const cachePolicy = region.cache ?? "no-store";
  const cacheKey = createPprRegionCacheKey(request, match);
  const cached = readPprRegionCache(options, cacheKey, cachePolicy);
  if (cached) return cached;

  const ctx: ServerRenderContext = {
    request,
    manifest: options.manifest,
    page,
    pageId: match.pageId,
    regionId: match.regionId,
  };
  const renderMatch = coordinator.match ? await coordinator.match(ctx) : ctx;
  if (!renderMatch) return undefined;

  const response = await normalizePprRegionResponse(
    match,
    toResponse(await coordinator.render(renderMatch)),
  );

  return applyPprRegionCache(options, cacheKey, cachePolicy, response);
}

export async function handleRscFlightRequest(
  options: FrameworkServerOptions,
  request: Request,
): Promise<Response | undefined> {
  if (!options.rsc) return undefined;

  const rscPath = options.manifest.runtime.server?.rsc;
  if (!rscPath) return undefined;

  const url = new URL(request.url);
  if (normalizePathname(url.pathname) !== normalizePathname(rscPath)) {
    return undefined;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return frameworkTextResponse("Method Not Allowed", 405, {
      Allow: "GET, HEAD",
    });
  }

  const ctx: RscFlightContext = {
    request,
    manifest: options.manifest,
    ...createRscFlightPageContext(options.manifest, url),
  };

  const validationError = validateRscFlightContext(ctx);
  if (validationError) return validationError;

  const coordinator = normalizeRscCoordinator(options.rsc);
  if (coordinator.match && !(await coordinator.match(ctx))) {
    return frameworkTextResponse(
      `[evjs] No RSC Flight coordinator matched page "${ctx.pageId}".`,
      404,
    );
  }

  try {
    return await coordinator.renderFlight(ctx);
  } catch (error) {
    return frameworkTextResponse(
      `[evjs] RSC Flight render failed: ${formatUnknownError(error)}`,
      500,
    );
  }
}

function createRscFlightPageContext(
  manifest: BuildOutput,
  url: URL,
): Pick<RscFlightContext, "pageId" | "page" | "rscPage" | "renderer"> {
  const pageId = url.searchParams.get("page") ?? undefined;
  const page = pageId ? manifest.pages[pageId] : undefined;
  const rscPage = pageId ? manifest.rsc?.pages?.[pageId] : undefined;
  const renderer = rscPage?.renderer
    ? manifest.server?.renderers?.[rscPage.renderer]
    : undefined;

  return {
    pageId,
    page,
    rscPage,
    renderer,
  };
}

function validateRscFlightContext(ctx: RscFlightContext): Response | undefined {
  if (!ctx.pageId) {
    return frameworkTextResponse(
      "[evjs] RSC Flight request is missing the page query parameter.",
      400,
    );
  }

  if (!ctx.page) {
    return frameworkTextResponse(
      `[evjs] RSC page "${ctx.pageId}" is not in the manifest.`,
      404,
    );
  }

  if (ctx.page.componentModel !== "rsc") {
    return frameworkTextResponse(
      `[evjs] Page "${ctx.pageId}" is not configured with componentModel: "rsc".`,
      404,
    );
  }

  if (!ctx.rscPage) {
    return frameworkTextResponse(
      `[evjs] RSC page "${ctx.pageId}" has no RSC manifest metadata.`,
      501,
    );
  }

  if (!ctx.renderer) {
    return frameworkTextResponse(
      `[evjs] RSC page "${ctx.pageId}" has no loadable RSC renderer.`,
      501,
    );
  }

  return undefined;
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

function frameworkTextResponse(
  body: string,
  status: number,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "text/plain; charset=utf-8");
  return new Response(body, {
    status,
    headers: responseHeaders,
  });
}

function formatUnknownError(error: unknown): string {
  return sanitizeDiagnosticText(
    error instanceof Error ? error.message : String(error),
  );
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/file:\/\/\/[^\s"'<>)]*/g, "[redacted-file-url]")
    .replace(
      /(?:\/(?:Users|home|private|tmp)\/[^\s"'<>)]*)/g,
      "[redacted-path]",
    )
    .replace(/[A-Za-z]:\\[^\s"'<>)]*/g, "[redacted-path]");
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

function invalidRendererResult(rendererName: string): Response {
  return new Response(
    `[evjs] Server renderer "${rendererName}" returned an invalid result. Expected Response, string, or { html, status?, headers? }.`,
    { status: 501 },
  );
}

function isServerRenderResult(result: unknown): result is ServerRenderResult {
  if (result instanceof Response) return true;
  if (typeof result === "string") return true;
  if (!result || typeof result !== "object") return false;
  return typeof (result as { html?: unknown }).html === "string";
}

function matchRoute(
  routes: RouteOutput[],
  pathname: string,
): RouteOutput | undefined {
  const normalized = normalizePathname(pathname);
  return routes.find((route) =>
    routePathMatches(normalizePathname(route.path), normalized),
  );
}

function routePathMatches(routePath: string, pathname: string): boolean {
  if (routePath === pathname) return true;

  if (routePath.endsWith("/*")) {
    const base = routePath.slice(0, -2);
    return pathname === base || pathname.startsWith(`${base}/`);
  }

  const routeSegments = splitPath(routePath);
  const pathSegments = splitPath(pathname);
  if (routeSegments.length !== pathSegments.length) return false;

  return routeSegments.every((segment, index) => {
    const value = pathSegments[index];
    return (
      segment === value ||
      segment.startsWith("$") ||
      segment.startsWith(":") ||
      segment === "*"
    );
  });
}

function inferPageId(
  manifest: BuildOutput,
  pathname: string,
): string | undefined {
  const normalized = normalizePathname(pathname);
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
): { pageId: string; regionId: string } | undefined {
  const endpoint = normalizePathname(
    manifest.runtime.server?.ppr ??
      joinPath(manifest.runtime.server?.basePath ?? "/__evjs", "ppr"),
  );
  const normalized = normalizePathname(pathname);
  if (normalized === endpoint || !normalized.startsWith(`${endpoint}/`)) {
    return undefined;
  }

  const [pageId, regionId] = normalized
    .slice(endpoint.length + 1)
    .split("/")
    .map((segment) => decodeURIComponent(segment));
  if (!pageId || !regionId) return undefined;
  return { pageId, regionId };
}

function createPprRegionCacheKey(
  request: Request,
  match: { pageId: string; regionId: string },
): string {
  const url = new URL(request.url);
  return `${match.pageId}:${match.regionId}:${normalizePathname(url.pathname)}${url.search}`;
}

function readPprRegionCache(
  options: FrameworkServerOptions,
  key: string,
  policy: PprCachePolicy,
): Response | undefined {
  if (policy === "no-store") return undefined;
  const cached = pprRegionCaches.get(options)?.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    pprRegionCaches.get(options)?.delete(key);
    return undefined;
  }

  const headers = new Headers(cached.headers);
  headers.set("x-evjs-cache", "HIT");
  return new Response(cached.body.slice(0), {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}

async function applyPprRegionCache(
  options: FrameworkServerOptions,
  key: string,
  policy: PprCachePolicy,
  response: Response,
): Promise<Response> {
  const headers = new Headers(response.headers);

  if (policy === "no-store" || !Number.isFinite(policy.revalidate)) {
    if (!headers.has("Cache-Control")) {
      headers.set("Cache-Control", "no-store");
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const revalidate = Math.max(0, policy.revalidate);
  if (revalidate <= 0) {
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
    headers.set("Cache-Control", `s-maxage=${revalidate}`);
  }
  headers.set("x-evjs-cache", "MISS");

  const body = await response.arrayBuffer();
  if (response.ok) {
    let cache = pprRegionCaches.get(options);
    if (!cache) {
      cache = new Map();
      pprRegionCaches.set(options, cache);
    }
    cache.set(key, {
      expiresAt: Date.now() + revalidate * 1000,
      status: response.status,
      statusText: response.statusText,
      headers: [...headers.entries()].filter(
        ([name]) => name.toLowerCase() !== "x-evjs-cache",
      ),
      body,
    });
  }

  return new Response(body.slice(0), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function normalizePprRegionResponse(
  match: { pageId: string; regionId: string },
  response: Response,
): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("x-evjs-page", match.pageId);
  headers.set("x-evjs-ppr-region", match.regionId);

  const contentType = headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const html = await response.text();
  headers.set("Content-Type", "text/html; charset=utf-8");
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

function normalizePathname(pathname: string): string {
  if (!pathname.startsWith("/")) return normalizePathname(`/${pathname}`);
  if (pathname.length === 1) return pathname;
  return pathname.replace(/\/+$/, "");
}

function splitPath(pathname: string): string[] {
  return normalizePathname(pathname).split("/").filter(Boolean);
}

function toResponse(result: ServerRenderResult): Response {
  if (result instanceof Response) return result;
  if (typeof result === "string") {
    return new Response(result, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response(result.html, {
    status: result.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...Object.fromEntries(new Headers(result.headers)),
    },
  });
}
