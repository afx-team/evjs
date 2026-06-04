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

  return toResponse(await coordinator.render(match));
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
  if (!page || page.render !== "ppr") return undefined;
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
  const coordinator = normalizeRenderCoordinator(options.render);
  const renderMatch = coordinator.match ? await coordinator.match(ctx) : ctx;
  if (!renderMatch) return undefined;

  return applyPprRegionCache(
    options,
    cacheKey,
    cachePolicy,
    toResponse(await coordinator.render(renderMatch)),
  );
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

  if (ctx.page.render !== "rsc") {
    return frameworkTextResponse(
      `[evjs] Page "${ctx.pageId}" is not configured with render: "rsc".`,
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
  return error instanceof Error ? error.message : String(error);
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
  const preferredKind =
    ctx.page?.render === "ppr"
      ? "ppr-shell"
      : ctx.page?.render === "rsc"
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
