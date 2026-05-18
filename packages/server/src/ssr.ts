import { AsyncLocalStorage } from "node:async_hooks";
import {
  EVJS_QUERY_DEHYDRATION_KEY,
  isDocumentRequestLike,
} from "@evjs/shared";
import {
  dehydrate,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  type AnyRoute,
  type AnyRouter,
  createRouter,
  type RouterConstructorOptions,
  type RouterHistory,
  type TrailingSlashOption,
} from "@tanstack/react-router";
import {
  createRequestHandler,
  RouterServer,
  renderRouterToStream,
  renderRouterToString,
} from "@tanstack/react-router/ssr/server";
import {
  createContext,
  createElement,
  Fragment,
  type ReactNode,
  useContext,
} from "react";

export type SsrRenderMode = "string" | "stream";

export interface SsrAssets {
  js: string[];
  css: string[];
  publicPath?: string;
}

export type SsrAssetsSource =
  | SsrAssets
  | (() => SsrAssets | Promise<SsrAssets>);

export interface SsrAssetTagsProps {
  assets?: SsrAssets;
  nonce?: string;
}

export interface SsrRenderContext {
  request: Request;
  url: URL;
  assets: SsrAssets;
}

export type SsrRenderResult =
  | Response
  | string
  | Uint8Array
  | ReadableStream<Uint8Array>;

export type SsrRender = (
  ctx: SsrRenderContext,
) => SsrRenderResult | Promise<SsrRenderResult>;

export type DocumentHandler = (
  request: Request,
) => Response | Promise<Response>;

export interface SsrRenderHandlerOptions {
  render: SsrRender;
  assets?: SsrAssetsSource;
  shouldHandle?: (request: Request) => boolean;
}

export interface SsrRouterFactoryContext {
  request: Request;
}

export interface SsrRouterFactoryResult<TRouter extends AnyRouter> {
  router: TRouter;
  queryClient?: QueryClient;
}

export type SsrRouterFactory<TRouter extends AnyRouter> = (
  ctx: SsrRouterFactoryContext,
) => TRouter | SsrRouterFactoryResult<TRouter>;

export interface SsrDocumentRenderContext<TRouter extends AnyRouter> {
  request: Request;
  router: TRouter;
  responseHeaders: Headers;
  assets: SsrAssets;
  children: ReactNode;
}

export interface SsrRouterHandlerOptions<TRouter extends AnyRouter> {
  createRouter: SsrRouterFactory<TRouter>;
  assets?: SsrAssetsSource;
  mode?: SsrRenderMode;
  renderDocument: (ctx: SsrDocumentRenderContext<TRouter>) => ReactNode;
  shouldHandle?: (request: Request) => boolean;
}

export interface SsrRouteTreeContext {
  request: Request;
  queryClient: QueryClient;
}

export type SsrRouteTreeRouterOptions<
  TRouteTree extends AnyRoute,
  TTrailingSlashOption extends TrailingSlashOption = "never",
  TDefaultStructuralSharingOption extends boolean = false,
  TDehydrated extends Record<string, unknown> = Record<string, unknown>,
> = Omit<
  RouterConstructorOptions<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    RouterHistory,
    TDehydrated
  >,
  "context" | "history" | "isServer" | "origin" | "routeTree"
>;

type SsrRouteTreeRouter<
  TRouteTree extends AnyRoute,
  TTrailingSlashOption extends TrailingSlashOption,
  TDefaultStructuralSharingOption extends boolean,
  TDehydrated extends Record<string, unknown>,
> = ReturnType<
  typeof createRouter<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    RouterHistory,
    TDehydrated
  >
>;

export interface SsrRouteTreeHandlerOptions<
  TRouteTree extends AnyRoute,
  TTrailingSlashOption extends TrailingSlashOption = "never",
  TDefaultStructuralSharingOption extends boolean = false,
  TDehydrated extends Record<string, unknown> = Record<string, unknown>,
> {
  routeTree: TRouteTree;
  router?: SsrRouteTreeRouterOptions<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TDehydrated
  >;
  createQueryClient?: () => QueryClient;
  getRouterContext?: (ctx: SsrRouteTreeContext) => Record<string, unknown>;
  assets?: SsrAssetsSource;
  mode?: SsrRenderMode;
  renderDocument: (
    ctx: SsrDocumentRenderContext<
      SsrRouteTreeRouter<
        TRouteTree,
        TTrailingSlashOption,
        TDefaultStructuralSharingOption,
        TDehydrated
      >
    >,
  ) => ReactNode;
  shouldHandle?: (request: Request) => boolean;
}

export type SsrHandlerOptions<TRouter extends AnyRouter = AnyRouter> =
  | SsrRenderHandlerOptions
  | SsrRouteTreeHandlerOptions<AnyRoute>
  | SsrRouterHandlerOptions<TRouter>;

const DEFAULT_ASSETS: SsrAssets = { js: [], css: [], publicPath: "/" };
const SsrRouterContext = createContext<AnyRouter | undefined>(undefined);

const REQUEST_CONTEXT_KEY = Symbol.for("evjs.transport.requestContext");
const transportRequestContext = new AsyncLocalStorage<{
  baseUrl?: string;
  headers?: Record<string, string>;
}>();

(globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT_KEY] =
  transportRequestContext;

const FORWARDED_HEADER_DENYLIST = new Set([
  "connection",
  "content-length",
  "content-type",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function isDocumentRequest(request: Request): boolean {
  const url = new URL(request.url);
  return isDocumentRequestLike({
    method: request.method,
    accept: request.headers.get("Accept"),
    pathname: url.pathname,
  });
}

function copyHeadResponse(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function normalizePublicPath(publicPath: string | undefined): string {
  if (!publicPath) return "/";
  return publicPath.endsWith("/") ? publicPath : `${publicPath}/`;
}

function assetUrl(asset: string, publicPath: string | undefined): string {
  if (/^(?:[a-z][a-z\d+\-.]*:)?\/\//i.test(asset) || asset.startsWith("/")) {
    return asset;
  }
  return `${normalizePublicPath(publicPath)}${asset}`;
}

export function AssetLinks({
  assets = DEFAULT_ASSETS,
  nonce,
}: SsrAssetTagsProps): ReactNode {
  return createElement(
    Fragment,
    null,
    ...assets.css.map((href) =>
      createElement("link", {
        key: href,
        rel: "stylesheet",
        href: assetUrl(href, assets.publicPath),
        nonce,
      }),
    ),
  );
}

export function AssetScripts({
  assets = DEFAULT_ASSETS,
  nonce,
}: SsrAssetTagsProps): ReactNode {
  const router = useContext(SsrRouterContext);

  return createElement(
    Fragment,
    null,
    renderRouterHydrationScript(router, nonce),
    ...assets.js.map((src) =>
      createElement("script", {
        key: src,
        defer: true,
        src: assetUrl(src, assets.publicPath),
        nonce,
      }),
    ),
  );
}

function renderRouterHydrationScript(
  router: AnyRouter | undefined,
  nonce: string | undefined,
): ReactNode {
  const script = router?.serverSsr?.takeBufferedScripts();
  if (
    !script ||
    script.tag !== "script" ||
    typeof script.children !== "string"
  ) {
    return null;
  }

  return createElement("script", {
    key: "evjs-router-hydration",
    ...(script.attrs ?? {}),
    nonce: (script.attrs as { nonce?: string } | undefined)?.nonce ?? nonce,
    dangerouslySetInnerHTML: { __html: script.children },
  });
}

export function AssetTags(props: SsrAssetTagsProps): ReactNode {
  return createElement(
    Fragment,
    null,
    createElement(AssetLinks, props),
    createElement(AssetScripts, props),
  );
}

function normalizeAssets(assets: Partial<SsrAssets> | undefined): SsrAssets {
  return {
    js: assets?.js ?? [],
    css: assets?.css ?? [],
    publicPath: assets?.publicPath ?? "/",
  };
}

async function readClientManifestAssets(): Promise<SsrAssets> {
  try {
    const [{ readFile }, path] = await Promise.all([
      import("node:fs/promises"),
      import("node:path"),
    ]);
    const cwd = typeof process !== "undefined" ? process.cwd() : ".";
    const candidates = [
      path.join(cwd, "dist", "client", "manifest.json"),
      path.join(cwd, "dist", "manifest.json"),
    ];

    for (const manifestPath of candidates) {
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as {
          assets?: Partial<SsrAssets>;
        };
        return normalizeAssets(manifest.assets);
      } catch {
        // Try the next known output layout.
      }
    }
  } catch {
    // Node filesystem APIs are not available in every runtime.
  }

  return DEFAULT_ASSETS;
}

let clientManifestAssets: Promise<SsrAssets> | undefined;

function getDefaultAssets(): Promise<SsrAssets> {
  clientManifestAssets ??= readClientManifestAssets();
  return clientManifestAssets;
}

async function resolveAssets(source: SsrAssetsSource | undefined) {
  if (!source) return getDefaultAssets();
  return normalizeAssets(
    typeof source === "function" ? await source() : source,
  );
}

function getDefaultRenderMode(): SsrRenderMode {
  try {
    const mode = process.env.EVJS_SSR_MODE;
    if (mode === "string" || mode === "stream") return mode;
  } catch {
    // `process` is not available in some direct edge runtime usage.
  }
  return "stream";
}

function toHtmlResponse(result: SsrRenderResult): Response {
  if (result instanceof Response) return result;

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
  });
  const body =
    result instanceof Uint8Array
      ? result.buffer.slice(
          result.byteOffset,
          result.byteOffset + result.byteLength,
        )
      : result;

  return new Response(body as BodyInit, { headers });
}

export function createSsrHandler(
  options: SsrRender | SsrRenderHandlerOptions,
): DocumentHandler;
export function createSsrHandler<TRouter extends AnyRouter>(
  options: SsrRouterHandlerOptions<TRouter>,
): DocumentHandler;
export function createSsrHandler<
  TRouteTree extends AnyRoute,
  TTrailingSlashOption extends TrailingSlashOption = "never",
  TDefaultStructuralSharingOption extends boolean = false,
  TDehydrated extends Record<string, unknown> = Record<string, unknown>,
>(
  options: SsrRouteTreeHandlerOptions<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TDehydrated
  >,
): DocumentHandler;
export function createSsrHandler<TRouter extends AnyRouter>(
  options: SsrRender | SsrHandlerOptions<TRouter>,
): DocumentHandler {
  if (isSsrRouterHandlerOptions(options)) {
    return createSsrRouterHandler(options);
  }

  if (isSsrRouteTreeHandlerOptions(options)) {
    return createSsrRouteTreeHandler(options);
  }

  const render = typeof options === "function" ? options : options.render;
  const shouldHandle =
    typeof options === "function"
      ? isDocumentRequest
      : (options.shouldHandle ?? isDocumentRequest);
  const assetsSource =
    typeof options === "function" ? undefined : options.assets;

  return async (request) => {
    if (shouldHandle && !shouldHandle(request)) {
      return new Response("Not Found", { status: 404 });
    }

    const assets = await resolveAssets(assetsSource);

    const response = toHtmlResponse(
      await render({
        request,
        url: new URL(request.url),
        assets,
      }),
    );

    return request.method === "HEAD" ? copyHeadResponse(response) : response;
  };
}

function isRouterFactoryResult<TRouter extends AnyRouter>(
  value: TRouter | SsrRouterFactoryResult<TRouter>,
): value is SsrRouterFactoryResult<TRouter> {
  return typeof value === "object" && value !== null && "router" in value;
}

function isSsrRouterHandlerOptions<TRouter extends AnyRouter>(
  options: SsrRender | SsrHandlerOptions<TRouter>,
): options is SsrRouterHandlerOptions<TRouter> {
  return (
    typeof options === "object" && options !== null && "createRouter" in options
  );
}

function isSsrRouteTreeHandlerOptions<TRouter extends AnyRouter>(
  options: SsrRender | SsrHandlerOptions<TRouter>,
): options is SsrRouteTreeHandlerOptions<AnyRoute> {
  return (
    typeof options === "object" && options !== null && "routeTree" in options
  );
}

function getRequestLocation(request: Request): {
  origin: string;
  path: string;
} {
  const url = new URL(request.url);
  return {
    origin: url.origin,
    path: `${url.pathname}${url.search}${url.hash}` || "/",
  };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!FORWARDED_HEADER_DENYLIST.has(key.toLowerCase())) {
      result[key] = value;
    }
  });
  return result;
}

function runWithTransportContext<T>(request: Request, fn: () => T): T {
  const location = getRequestLocation(request);
  return transportRequestContext.run(
    {
      baseUrl: `${location.origin}/`,
      headers: headersToRecord(request.headers),
    },
    fn,
  );
}

function mergeDehydratedQueryState(
  userData: unknown,
  queryClient: QueryClient,
): Record<string, unknown> {
  const base =
    userData && typeof userData === "object" && !Array.isArray(userData)
      ? (userData as Record<string, unknown>)
      : {};

  return {
    ...base,
    [EVJS_QUERY_DEHYDRATION_KEY]: dehydrate(queryClient),
  };
}

function renderRouterChildren<TRouter extends AnyRouter>(
  router: TRouter,
  queryClient: QueryClient | undefined,
): ReactNode {
  const routerServer = createElement(RouterServer, { router });

  if (!queryClient) return routerServer;

  return createElement(
    QueryClientProvider,
    { client: queryClient },
    routerServer,
  );
}

function renderRouterResponse(options: {
  mode: SsrRenderMode;
  request: Request;
  router: AnyRouter;
  responseHeaders: Headers;
  children: ReactNode;
}) {
  if (options.mode === "string") {
    return renderRouterToString({
      router: options.router,
      responseHeaders: options.responseHeaders,
      children: options.children,
    });
  }

  return renderRouterToStream({
    request: options.request,
    router: options.router,
    responseHeaders: options.responseHeaders,
    children: options.children,
  });
}

function createSsrRouteTreeHandler<
  TRouteTree extends AnyRoute,
  TTrailingSlashOption extends TrailingSlashOption,
  TDefaultStructuralSharingOption extends boolean,
  TDehydrated extends Record<string, unknown>,
>(
  options: SsrRouteTreeHandlerOptions<
    TRouteTree,
    TTrailingSlashOption,
    TDefaultStructuralSharingOption,
    TDehydrated
  >,
): DocumentHandler {
  return createSsrRouterHandler({
    shouldHandle: options.shouldHandle,
    assets: options.assets,
    mode: options.mode,
    createRouter: ({ request }) => {
      const queryClient = options.createQueryClient?.() ?? new QueryClient();
      const context = {
        ...(options.getRouterContext?.({ request, queryClient }) ?? {}),
        queryClient,
      };
      const userDehydrate = options.router?.dehydrate;
      const router = createRouter({
        ...options.router,
        routeTree: options.routeTree,
        isServer: true,
        context,
        dehydrate: () =>
          mergeDehydratedQueryState(userDehydrate?.(), queryClient),
      } as unknown as RouterConstructorOptions<
        TRouteTree,
        TTrailingSlashOption,
        TDefaultStructuralSharingOption,
        RouterHistory,
        TDehydrated
      >);

      return { router, queryClient };
    },
    renderDocument: options.renderDocument,
  });
}

function createSsrRouterHandler<TRouter extends AnyRouter>(
  options: SsrRouterHandlerOptions<TRouter>,
): DocumentHandler {
  return (request) =>
    runWithTransportContext(request, async () => {
      const shouldHandle = options.shouldHandle ?? isDocumentRequest;
      if (!shouldHandle(request)) {
        return new Response("Not Found", { status: 404 });
      }

      const assets = await resolveAssets(options.assets);
      const mode = options.mode ?? getDefaultRenderMode();
      let queryClient: QueryClient | undefined;

      const handler = createRequestHandler({
        request,
        createRouter: () => {
          const result = options.createRouter({ request });

          if (isRouterFactoryResult(result)) {
            queryClient = result.queryClient;
            return result.router;
          }

          queryClient = undefined;
          return result;
        },
      });

      const response = await handler(
        ({ request: currentRequest, router, responseHeaders }) =>
          renderRouterResponse({
            mode,
            request: currentRequest,
            router,
            responseHeaders,
            children: createElement(
              SsrRouterContext.Provider,
              { value: router },
              options.renderDocument({
                request: currentRequest,
                router,
                responseHeaders,
                assets,
                children: renderRouterChildren(router, queryClient),
              }),
            ),
          }),
      );

      return request.method === "HEAD" ? copyHeadResponse(response) : response;
    });
}
