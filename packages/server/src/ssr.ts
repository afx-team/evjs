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
  preload?: {
    js?: string[];
    css?: string[];
  };
  publicPath?: string;
  routes?: SsrRouteAssets[];
}

export interface SsrRouteAssets {
  path: string;
  assets?: {
    js?: string[];
    css?: string[];
  };
}

export type SsrAssetsSource =
  | SsrAssets
  | (() => SsrAssets | Promise<SsrAssets>);

export type SsrForwardHeaders =
  | readonly string[]
  | ((request: Request) => HeadersInit | undefined);

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
  /**
   * Header allowlist for server function calls made during SSR.
   * Defaults to forwarding only `cookie`.
   */
  forwardHeaders?: SsrForwardHeaders;
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
  /**
   * Header allowlist for server function calls made during SSR.
   * Defaults to forwarding only `cookie`.
   */
  forwardHeaders?: SsrForwardHeaders;
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
  /**
   * Header allowlist for server function calls made during SSR.
   * Defaults to forwarding only `cookie`.
   */
  forwardHeaders?: SsrForwardHeaders;
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
const REQUEST_CONTEXT_INIT_KEY = Symbol.for(
  "evjs.transport.requestContext.init",
);
const DEFAULT_FORWARDED_HEADERS = ["cookie"] as const;

interface TransportRequestContext {
  baseUrl?: string;
  headers?: Record<string, string>;
}

interface TransportRequestContextStore {
  getStore(): TransportRequestContext | undefined;
  run<T>(store: TransportRequestContext, callback: () => T): T;
}

let transportRequestContextStore:
  | Promise<TransportRequestContextStore>
  | undefined;

function getGlobalRecord(): Record<symbol, unknown> {
  return globalThis as Record<symbol, unknown>;
}

function getGlobalTransportRequestContextStore():
  | TransportRequestContextStore
  | undefined {
  const store = getGlobalRecord()[REQUEST_CONTEXT_KEY];
  if (typeof store !== "object" || store === null) return undefined;

  const candidate = store as Partial<TransportRequestContextStore>;
  if (
    typeof candidate.getStore === "function" &&
    typeof candidate.run === "function"
  ) {
    return candidate as TransportRequestContextStore;
  }
}

function createNoopTransportRequestContextStore(): TransportRequestContextStore {
  return {
    getStore: () => undefined,
    run: (_store, callback) => callback(),
  };
}

async function createTransportRequestContextStore(): Promise<TransportRequestContextStore> {
  if (typeof process === "undefined" || !process.versions?.node) {
    // Non-Node runtimes can still render SSR documents. They just do not get
    // implicit request-scoped server-function forwarding until a runtime store
    // is provided by an adapter.
    return createNoopTransportRequestContextStore();
  }

  const asyncHooksModule = "node:async_hooks";
  const { AsyncLocalStorage } = (await import(
    asyncHooksModule
  )) as typeof import("node:async_hooks");

  return new AsyncLocalStorage<TransportRequestContext>();
}

function getGlobalTransportRequestContextInit():
  | Promise<TransportRequestContextStore>
  | undefined {
  const pending = getGlobalRecord()[REQUEST_CONTEXT_INIT_KEY];
  return pending instanceof Promise ? pending : undefined;
}

function setGlobalTransportRequestContextStore(
  store: TransportRequestContextStore,
): TransportRequestContextStore {
  getGlobalRecord()[REQUEST_CONTEXT_KEY] = store;
  return store;
}

async function getTransportRequestContextStore(): Promise<TransportRequestContextStore> {
  const existing = getGlobalTransportRequestContextStore();
  if (existing) return existing;

  const pending = getGlobalTransportRequestContextInit();
  if (pending) return pending;

  transportRequestContextStore ??= createTransportRequestContextStore().then(
    (store) => getGlobalTransportRequestContextStore() ?? store,
  );

  if (typeof process !== "undefined" && process.versions?.node) {
    getGlobalRecord()[REQUEST_CONTEXT_INIT_KEY] =
      transportRequestContextStore.then(setGlobalTransportRequestContextStore);
    return getGlobalRecord()[
      REQUEST_CONTEXT_INIT_KEY
    ] as Promise<TransportRequestContextStore>;
  }

  return transportRequestContextStore;
}

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
  const preloadJs = assets.preload?.js ?? [];
  const preloadCss = assets.preload?.css ?? [];

  return createElement(
    Fragment,
    null,
    ...preloadJs.map((href) =>
      createElement("link", {
        key: `preload:${href}`,
        rel: "preload",
        as: "script",
        href: assetUrl(href, assets.publicPath),
        nonce,
      }),
    ),
    ...preloadCss.map((href) =>
      createElement("link", {
        key: `preload:${href}`,
        rel: "preload",
        as: "style",
        href: assetUrl(href, assets.publicPath),
        nonce,
      }),
    ),
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
    ...(assets?.preload
      ? {
          preload: {
            js: assets.preload.js ?? [],
            css: assets.preload.css ?? [],
          },
        }
      : {}),
    publicPath: assets?.publicPath ?? "/",
    ...(assets?.routes ? { routes: assets.routes } : {}),
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function mergeSsrAssets(base: SsrAssets, routeAssets: SsrRouteAssets[]) {
  const routeJs = routeAssets.flatMap((route) => route.assets?.js ?? []);
  const routeCss = routeAssets.flatMap((route) => route.assets?.css ?? []);
  const preload = {
    js: dedupe([...(base.preload?.js ?? []), ...routeJs]),
    css: dedupe(base.preload?.css ?? []),
  };

  return normalizeAssets({
    ...base,
    css: dedupe([...base.css, ...routeCss]),
    preload,
  });
}

function getRouterMatchedRouteIds(router: AnyRouter): Set<string> {
  const matches = router.stores.matches.get() as Array<{
    routeId?: unknown;
  }>;
  return new Set(
    matches
      .map((match) =>
        typeof match.routeId === "string" ? match.routeId : undefined,
      )
      .filter((id): id is string => Boolean(id)),
  );
}

function selectRouteAssets(assets: SsrAssets, router: AnyRouter): SsrAssets {
  if (!assets.routes || assets.routes.length === 0) return assets;

  const routeIds = getRouterMatchedRouteIds(router);
  if (routeIds.size === 0) return assets;

  const matchedRouteAssets = assets.routes.filter((route) =>
    routeIds.has(route.path),
  );
  if (matchedRouteAssets.length === 0) return assets;

  return mergeSsrAssets(assets, matchedRouteAssets);
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
          routes?: SsrRouteAssets[];
        };
        return normalizeAssets({
          ...manifest.assets,
          routes: manifest.routes,
        });
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
  const forwardHeaders =
    typeof options === "function" ? undefined : options.forwardHeaders;

  return (request) =>
    runWithTransportContext(
      request,
      async () => {
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

        return request.method === "HEAD"
          ? copyHeadResponse(response)
          : response;
      },
      forwardHeaders,
    );
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

function headersToRecord(
  request: Request,
  forwardHeaders: SsrForwardHeaders | undefined,
): Record<string, string> {
  if (typeof forwardHeaders === "function") {
    const headers = new Headers(forwardHeaders(request));
    const result: Record<string, string> = {};
    for (const key of new Set(headers.keys())) {
      const value = headers.get(key);
      if (value !== null) {
        result[key] = value;
      }
    }
    return result;
  }

  const forwardedHeaders = forwardHeaders ?? DEFAULT_FORWARDED_HEADERS;
  const result: Record<string, string> = {};
  for (const name of forwardedHeaders) {
    const value = request.headers.get(name);
    if (value !== null) {
      result[name.toLowerCase()] = value;
    }
  }
  return result;
}

async function runWithTransportContext<T>(
  request: Request,
  fn: () => T | Promise<T>,
  forwardHeaders?: SsrForwardHeaders,
): Promise<T> {
  const location = getRequestLocation(request);
  const store = await getTransportRequestContextStore();
  return store.run(
    {
      baseUrl: `${location.origin}/`,
      headers: headersToRecord(request, forwardHeaders),
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
    forwardHeaders: options.forwardHeaders,
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
    runWithTransportContext(
      request,
      async () => {
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
          ({ request: currentRequest, router, responseHeaders }) => {
            const selectedAssets = selectRouteAssets(assets, router);

            return renderRouterResponse({
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
                  assets: selectedAssets,
                  children: renderRouterChildren(router, queryClient),
                }),
              ),
            });
          },
        );

        return request.method === "HEAD"
          ? copyHeadResponse(response)
          : response;
      },
      options.forwardHeaders,
    );
}
