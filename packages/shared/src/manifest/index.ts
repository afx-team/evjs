/**
 * @evjs/shared/manifest
 *
 * Shared manifest schemas for the ev framework build system.
 *
 * Bundler adapters emit framework manifests under the configured output
 * directories. By default, the public client manifest is written to
 * `dist/client/manifest.json`, the server bundle manifest to
 * `dist/server/manifest.json`, and the full private BuildOutput handoff to
 * `dist/build-output.json`. `output.client` and `output.server` can point to
 * alternate directories when an adapter or deployment target needs a different
 * artifact layout.
 */

import {
  BUILD_IDENTIFIER_DESCRIPTION,
  isBuildIdentifier,
} from "../build-identifier.js";
import { HTTP_METHOD_LIST_DESCRIPTION, isHttpMethod } from "../http.js";
import {
  getPageRouteParamSegmentValidationError,
  normalizeRoutePathname,
  type PageRouteParamSegmentValidationError,
  pageRoutePathShapeFromPath,
} from "../page-route-data.js";
import {
  getPathPatternValidationError,
  type PathPatternValidationError,
} from "../path-pattern.js";
import { isServerFunctionId } from "../server-function-id.js";
import {
  getServerRouteParamSegmentValidationError,
  type ServerRouteParamSegmentValidationError,
  serverRoutePathShapeFromPath,
} from "../server-route-data.js";
import {
  getUrlStringValidationError,
  type UrlStringValidationError,
} from "../url-validation.js";

/** JavaScript and CSS assets emitted for a manifest entry. */
export interface AssetGroup {
  /** JavaScript bundle paths. */
  js: string[];
  /** CSS bundle paths. */
  css: string[];
}

// ── Draft next-generation framework contracts ───────────────────────────

/** Framework semantic graph before bundling. */
export interface AppGraph {
  version: 1;
  rootDir: string;
  apps: Record<string, AppNode>;
  pages: Record<string, PageNode>;
  routes: RouteNode[];
  serverFunctions: ServerFunctionNode[];
  serverRoutes: ServerRouteNode[];
  clientReferences?: ClientReferenceNode[];
  serverReferences?: ServerReferenceNode[];
}

export interface AppNode {
  id: string;
  entry: string;
  html: string;
  mount?: string;
}

export interface PageNode {
  id: string;
  path?: string;
  routeId?: string;
  entry?: string;
  component?: string;
  app?: string;
  html: string;
  render: RenderMode;
  componentModel?: ComponentModel;
  hydrate?: HydrationMode;
  mount?: string;
  prerender?: PrerenderConfig;
  ppr?: PprConfig;
}

export interface PprConfig {
  delivery?: PprDeliveryMode;
  revalidate?: number | false;
  regions?: Record<string, PprRegionConfig>;
}

export interface PprRegionConfig {
  component: string;
  fallback?: string;
  cache?: PprCachePolicy;
  hydrate?: HydrationMode;
}

export type PprCachePolicy = "no-store" | { revalidate: number };

export type PprDeliveryMode = "merge" | "stream";

export interface RouteNode {
  id: string;
  path: string;
  parentId?: string;
  kind?: PageRouteKind;
  pageId?: string;
  appId?: string;
  module?: string;
  render?: RenderMode;
  hydrate?: HydrationMode;
  runtime?: ServerRuntime;
}

export interface ServerFunctionNode {
  id: string;
  module: string;
  exportName: string;
}

export interface ServerRouteNode {
  id: string;
  module: string;
  path: string;
  methods: string[];
}

export interface ClientReferenceNode {
  id: string;
  module: string;
  exportName?: string;
}

export interface ServerReferenceNode {
  id: string;
  module: string;
  exportName?: string;
}

export type RenderMode = "csr" | "ssr" | "ssg";
export type ComponentModel = "client" | "rsc";
export type PrerenderConfig =
  | true
  | {
      partial?: boolean;
      delivery?: PprDeliveryMode;
      revalidate?: number | false;
    };
export type HydrationMode = "none" | "load" | "visible" | "idle";
export type BuildEnvironment = "client" | "server";
export type ServerRuntime = "node" | "edge";
export type PublicPathOutput = string;

/**
 * Internal build-unit arrangement derived from ResolvedConfig + AppGraph.
 *
 * BuildPlan is not user config, not a second graph, and not a runtime
 * manifest. It lists concrete entries and HTML documents for bundler adapters
 * and dev-time diffing.
 */
export interface BuildPlan {
  version: 1;
  buildId: string;
  mode: "development" | "production";
  distDir: string;
  output: {
    clientDir: string;
    serverDir: string;
  };
  entries: BuildEntry[];
  html: HtmlPlan[];
  server: ServerBuildPlan;
  runtime: RuntimePlan;
}

export interface BuildEntry {
  name: string;
  import: string;
  environment: BuildEnvironment;
  runtime?: "browser" | ServerRuntime;
  kind:
    | "app-client"
    | "page-client"
    | "page-server"
    | "rsc-page"
    | "ppr-shell"
    | "ppr-region"
    | "server-runtime"
    | "runtime";
  owner?: BuildEntryOwner;
  metadata?: BuildEntryMetadata;
}

export interface BuildEntryOwner {
  appId?: string;
  pageId?: string;
  routeId?: string;
  regionId?: string;
}

export type BuildEntryMetadata =
  | ReactComponentPageEntryMetadata
  | PagesAppEntryMetadata
  | ServerAppEntryMetadata;

export interface ReactComponentPageEntryMetadata {
  type: "react-component-page";
  component: string;
  mount: string;
  hydrate: HydrationMode;
  render: RenderMode;
  route?: {
    id: string;
    path: string;
  };
}

export interface PagesAppEntryMetadata {
  type: "pages-app";
  routes: PageRouteNode[];
  mount: string;
  rootModule?: string;
}

export interface ServerMiddlewareNode {
  id: string;
  module: string;
  scope: "global" | "route";
  scopeSegments?: string[];
}

export interface ServerAppRouteNode extends ServerRouteNode {
  middlewares?: ServerMiddlewareNode[];
}

export interface ServerAppEntryMetadata {
  type: "server-app";
  routes: ServerAppRouteNode[];
  middlewares?: ServerMiddlewareNode[];
  serverFunctions?: ServerFunctionNode[];
}

export interface PageRouteNode {
  id: string;
  path: string;
  module: string;
  html?: string;
  parentId?: string;
  kind?: PageRouteKind;
}

export type PageRouteKind = "page" | "layout";

export interface HtmlPlan {
  id: string;
  template: string;
  fileName: string;
  owner: {
    appId?: string;
    pageId?: string;
  };
}

export interface ServerBuildPlan {
  entry: string;
  renderers?: ServerRenderPlan[];
  functionRuntime: {
    endpoint: string;
    clientProxy: string;
    serverRegister: string;
  };
}

export interface ServerRenderPlan {
  name: string;
  import: string;
  kind: "page-server" | "rsc-page" | "ppr-shell" | "ppr-region";
  owner?: BuildEntryOwner;
}

export interface RuntimePlan {
  publicPath: PublicPathOutput;
  server: RuntimeServerOutput;
  transport?: TransportOutput;
}

export interface BuildPlanUpdate {
  reason: "config" | "route-declaration" | "server-declaration" | "plugin";
  previous: BuildPlan;
  next: BuildPlan;
  entries: {
    added: BuildEntry[];
    removed: BuildEntry[];
    changed: BuildEntry[];
  };
  html: {
    added: HtmlPlan[];
    removed: HtmlPlan[];
    changed: HtmlPlan[];
  };
  serverChanged: boolean;
}

export interface BuildOutput {
  version: 1;
  buildId: string;
  distDir: string;
  paths?: BuildOutputPaths;
  publicPath: PublicPathOutput;
  runtime: RuntimeOutput;
  assets: Record<string, AssetGroup>;
  apps: Record<string, AppOutput>;
  pages: Record<string, PageOutput>;
  routes: RouteOutput[];
  server: ServerOutput;
  rsc?: RscOutput;
  deployment?: Record<string, unknown>;
}

export interface FrameworkManifestValidationOptions {
  serverFunctionModules?: "required" | "optional";
  pageRendererReferences?: "required" | "optional";
  pprRendererReferences?: "required" | "optional";
  rscRendererReferences?: "required" | "optional";
}

export interface BuildOutputPaths {
  rootDir: string;
  publicDir: string;
  serverDir: string;
}

export interface RuntimeOutput {
  server: RuntimeServerOutput;
  transport?: TransportOutput;
}

export interface RuntimeServerOutput {
  basePath: string;
  fn: string;
  ppr?: string;
  rsc?: string;
}

export interface TransportOutput {
  baseUrl?: string;
}

export interface AppOutput {
  assets: AssetGroup;
  document?: HtmlDocumentOutput;
  entry?: string;
  mount?: string;
  module?: RuntimeModuleOutput;
}

export interface PageOutput {
  assets: AssetGroup;
  document?: HtmlDocumentOutput;
  render: RenderMode;
  rendering: PageRenderingOutput;
  path?: string;
  routeId?: string;
  entry?: string;
  component?: string;
  componentModel?: ComponentModel;
  app?: string;
  hydrate?: HydrationMode;
  mount?: string;
  prerender?: PrerenderConfig;
  module?: RuntimeModuleOutput;
  ppr?: PprPageOutput;
}

export interface HtmlDocumentOutput {
  fileName: string;
}

export interface PageRenderingOutput {
  /** React execution model used by the page module. */
  component: "client" | "server" | "rsc";
  /** HTML delivery strategy for the initial document. */
  html: "client" | "server" | "static" | "partial";
  /** Static generation shape, when any part of the page is precomputed. */
  prerender?: "full" | "partial";
  /** Whether the page can stream server-rendered content after shell start. */
  streaming: boolean;
  /** Browser hydration behavior for client-capable parts of the page. */
  hydrate: HydrationMode;
}

export interface PprPageOutput {
  delivery: PprDeliveryMode;
  shell: AssetGroup;
  regions: Record<string, PprRegionOutput>;
}

export interface PprRegionOutput {
  id: string;
  assets: AssetGroup;
  component: string;
  fallback?: string;
  cache?: PprCachePolicy;
  hydrate?: HydrationMode;
}

export interface RuntimeModuleOutput {
  type: "entry" | "lifecycle" | "react-component";
  href?: string;
  source?: string;
}

export interface RouteOutput {
  id: string;
  path: string;
  parentId?: string;
  kind?: PageRouteKind;
  appId?: string;
  pageId?: string;
  module?: string;
  render?: RenderMode;
  hydrate?: HydrationMode;
  runtime?: ServerRuntime;
}

export interface ServerOutput {
  entry?: string;
  assets: AssetGroup;
  renderers?: Record<string, ServerRendererOutput>;
  functions: Record<string, ServerFunctionOutput>;
  routes: ServerRouteOutput[];
}

export interface ServerRendererOutput {
  kind: ServerRenderPlan["kind"];
  owner?: BuildEntryOwner;
  module: string;
  assets: AssetGroup;
}

export interface ServerFunctionOutput {
  assets: AssetGroup;
  module: string;
  exportName: string;
}

export interface ServerRouteOutput {
  path: string;
  methods: string[];
  assets: AssetGroup;
}

export interface RscOutput {
  endpoint?: string;
  pages?: Record<string, RscPageOutput>;
  clientReferences?: Record<string, RscReferenceOutput>;
  serverReferences?: Record<string, RscReferenceOutput>;
  clientReferenceManifest?: Record<string, unknown>;
  serverConsumerManifest?: Record<string, unknown>;
}

export interface RscPageOutput {
  renderer: string;
  assets: AssetGroup;
  component?: string;
  routeId?: string;
}

export interface RscReferenceOutput {
  module: string;
  exportName?: string;
}

// ── Route resolution ────────────────────────────────────────────────────

/** Route metadata discovered from page files or configured pages. */
export interface ExtractedRoute {
  /** Route path (e.g. "/", "/posts/$postId"). */
  path: string;
  /** Stable route id derived from the file path or page id. */
  id?: string;
  /** Parent route id for framework-managed file route trees. */
  parentId?: string;
  /** Framework-managed file route node kind. */
  kind?: PageRouteKind;
  /** Static page/component module declared for this route. */
  module?: string;
  /** Render mode declared by the route target module. */
  render?: RenderMode;
  /** Hydration mode declared by the route target module. */
  hydrate?: HydrationMode;
  /** Component execution model declared by the route target module. */
  componentModel?: ComponentModel;
  /** Prerender behavior declared by the route target module. */
  prerender?: PrerenderConfig;
  /** PPR config derived from the route target module. */
  ppr?: PprConfig;
  /** Server runtime declared in route metadata. */
  runtime?: ServerRuntime;
  /** Owning app id for framework-managed SPA routes. */
  appId?: string;
  /** Variable name of the parent route (e.g. "rootRoute", "postsRoute"). */
  parentName?: string;
  /** Variable name this route is assigned to (e.g. "homeRoute"). */
  varName?: string;
}

/** Server route metadata extracted from an @evjs/server createRoute() export. */
export interface ExtractedServerRoute {
  /** Route path pattern passed to createRoute(). */
  path: string;
  /** HTTP methods declared on the route definition object. */
  methods: string[];
}

/**
 * Resolve a flat list of extracted routes into de-duplicated full paths.
 *
 * Builds the parent-child hierarchy using `varName` / `parentName` and
 * walks the tree to construct full URL paths.
 *
 * Index routes (child `path: "/"` under a non-root parent) are excluded
 * since they resolve to the same URL as their parent route.
 *
 * @example
 * ```ts
 * resolveRoutes([
 *   { path: "/posts", varName: "postsRoute", parentName: "rootRoute" },
 *   { path: "/", varName: "postsIndexRoute", parentName: "postsRoute" },
 *   { path: "$postId", varName: "postDetailRoute", parentName: "postsRoute" },
 * ])
 * // => [{ path: "/posts" }, { path: "/posts/$postId" }]
 * ```
 */
export function resolveRoutes(routes: ExtractedRoute[]): Array<{
  path: string;
  id?: string;
  parentId?: string;
  kind?: PageRouteKind;
  module?: string;
  render?: RenderMode;
  hydrate?: HydrationMode;
  componentModel?: ComponentModel;
  prerender?: PrerenderConfig;
  ppr?: PprConfig;
  runtime?: ServerRuntime;
  appId?: string;
}> {
  // Build a lookup: varName → ExtractedRoute
  const byName = new Map<string, ExtractedRoute>();
  for (const r of routes) {
    if (r.varName) {
      byName.set(r.varName, r);
    }
  }

  /**
   * Walk up the parent chain to build the full path prefix for a route.
   * Returns the full resolved path of the given route variable.
   */
  function resolveParentPath(
    route: ExtractedRoute,
    visited = new Set<string>(),
  ): string {
    if (!route.parentName) return route.path;

    // Guard against circular parent references
    if (route.varName) {
      if (visited.has(route.varName)) return route.path;
      visited.add(route.varName);
    }

    const parent = byName.get(route.parentName);
    if (!parent) {
      // Parent not in the extracted set (e.g. rootRoute from createRootRoute)
      // — treat as top-level, no prefix.
      return route.path;
    }

    const parentPath = resolveParentPath(parent, visited);
    return joinPaths(parentPath, route.path);
  }

  const seen = new Set<string>();
  const result: Array<{
    path: string;
    id?: string;
    parentId?: string;
    kind?: PageRouteKind;
    module?: string;
    render?: RenderMode;
    hydrate?: HydrationMode;
    componentModel?: ComponentModel;
    prerender?: PrerenderConfig;
    ppr?: PprConfig;
    runtime?: ServerRuntime;
    appId?: string;
  }> = [];

  for (const r of routes) {
    const fullPath = resolveParentPath(r);

    // Skip index routes that resolve to the same path as their parent.
    // An index route has path "/" and a parent that is not the root.
    if (r.path === "/" && r.parentName) {
      const parent = byName.get(r.parentName);
      if (parent) {
        // This is a non-root index route — it duplicates the parent path.
        continue;
      }
    }

    const routeKind = r.kind ?? "page";
    const seenKey =
      routeKind === "layout"
        ? `${r.appId ?? ""}:layout:${r.id ?? fullPath}`
        : `${r.appId ?? ""}:page:${fullPath}`;
    if (!seen.has(seenKey)) {
      seen.add(seenKey);
      result.push({
        path: fullPath,
        id: r.id,
        parentId: r.parentId,
        kind: r.kind,
        module: r.module,
        render: r.render,
        hydrate: r.hydrate,
        componentModel: r.componentModel,
        prerender: r.prerender,
        ppr: r.ppr,
        runtime: r.runtime,
        appId: r.appId,
      });
    }
  }

  return result;
}

/** Join two path segments, normalizing double slashes. */
function joinPaths(parent: string, child: string): string {
  if (child === "/") return parent;
  if (child.startsWith("/")) return child;

  const base = parent.endsWith("/") ? parent : `${parent}/`;
  return base + child;
}

export function assertFrameworkManifestShape(
  value: unknown,
  source: string,
  options: FrameworkManifestValidationOptions = {},
): asserts value is BuildOutput {
  const requireServerFunctionModules =
    options.serverFunctionModules !== "optional";
  const requirePageRendererReferences =
    options.pageRendererReferences !== "optional";
  const requirePprRendererReferences =
    options.pprRendererReferences !== "optional";
  const requireRscRendererReferences =
    options.rscRendererReferences !== "optional";
  assertObject(value, source);
  if (value.version !== 1) {
    throw new Error(`[evjs] ${source}.version must be 1.`);
  }
  assertManifestBuildId(value.buildId, `${source}.buildId`);
  assertManifestString(value.distDir, `${source}.distDir`);
  assertPublicPathOutput(value.publicPath, `${source}.publicPath`);
  if (value.paths !== undefined) {
    assertBuildOutputPaths(value.paths, `${source}.paths`);
  }
  assertObject(value.runtime, `${source}.runtime`);
  assertObject(value.assets, `${source}.assets`);
  assertAssetGroupRecord(value.assets, `${source}.assets`);
  assertObject(value.apps, `${source}.apps`);
  assertAppOutputs(value.apps, `${source}.apps`);
  assertObject(value.pages, `${source}.pages`);
  assertPageOutputs(value.pages, `${source}.pages`);
  if (!Array.isArray(value.routes)) {
    throw new Error(`[evjs] ${source}.routes must be an array.`);
  }
  assertRouteOutputs(value.routes, `${source}.routes`, value.pages, value.apps);

  assertObject(value.runtime.server, `${source}.runtime.server`);
  assertManifestPathname(
    value.runtime.server.basePath,
    `${source}.runtime.server.basePath`,
    true,
  );
  assertManifestPathname(
    value.runtime.server.fn,
    `${source}.runtime.server.fn`,
    true,
  );
  assertManifestPathname(
    value.runtime.server.ppr,
    `${source}.runtime.server.ppr`,
  );
  assertManifestPathname(
    value.runtime.server.rsc,
    `${source}.runtime.server.rsc`,
  );
  if (value.runtime.transport !== undefined) {
    assertObject(value.runtime.transport, `${source}.runtime.transport`);
    assertManifestTransportBaseUrl(
      value.runtime.transport.baseUrl,
      `${source}.runtime.transport.baseUrl`,
    );
  }
  assertObject(value.server, `${source}.server`);
  if (value.server.entry !== undefined) {
    assertManifestString(value.server.entry, `${source}.server.entry`);
  }
  if (value.server.renderers !== undefined) {
    assertObject(value.server.renderers, `${source}.server.renderers`);
    assertServerRendererOutputs(
      value.server.renderers,
      `${source}.server.renderers`,
      value.pages,
      value.routes,
    );
  }
  assertAssetGroup(value.server.assets, `${source}.server.assets`);
  assertObject(value.server.functions, `${source}.server.functions`);
  assertServerFunctionOutputs(
    value.server.functions,
    `${source}.server.functions`,
    requireServerFunctionModules,
  );
  if (!Array.isArray(value.server.routes)) {
    throw new Error(`[evjs] ${source}.server.routes must be an array.`);
  }
  assertServerRouteOutputs(value.server.routes, `${source}.server.routes`);
  assertPageServerRendererReferences(
    value.pages,
    `${source}.pages`,
    getServerRendererOutputs(value.server),
    value.routes,
    requirePageRendererReferences,
  );
  assertPprPageOutputReferences(
    value.pages,
    `${source}.pages`,
    getServerRendererOutputs(value.server),
    requirePprRendererReferences,
  );
  if (value.rsc !== undefined) {
    assertRscOutput(
      value.rsc,
      `${source}.rsc`,
      value.pages,
      getServerRendererOutputs(value.server),
      value.routes,
      requireRscRendererReferences,
    );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function assertManifestBuildId(value: unknown, source: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[evjs] ${source} must be a non-empty string.`);
  }
  if (!isBuildIdentifier(value)) {
    throw new Error(
      `[evjs] ${source} must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
    );
  }
}

function assertPublicPathOutput(value: unknown, source: string): void {
  assertManifestString(value, source);
}

function assertBuildOutputPaths(value: unknown, source: string): void {
  assertObject(value, source);
  assertManifestString(value.rootDir, `${source}.rootDir`);
  assertManifestString(value.publicDir, `${source}.publicDir`);
  assertManifestString(value.serverDir, `${source}.serverDir`);
}

function assertAssetGroupRecord(
  value: Record<string, unknown>,
  source: string,
): void {
  for (const [name, group] of Object.entries(value)) {
    assertManifestBuildIdentifierKey(name, source);
    assertAssetGroup(group, `${source}.${name}`);
  }
}

function assertServerRendererOutputs(
  value: Record<string, unknown>,
  source: string,
  pages: Record<string, unknown>,
  routes: unknown[],
): void {
  const routesById = createRouteOutputMap(routes);
  for (const [name, output] of Object.entries(value)) {
    assertManifestBuildIdentifierKey(name, source);
    assertObject(output, `${source}.${name}`);
    assertServerRendererKind(output.kind, `${source}.${name}.kind`);
    assertManifestString(output.module, `${source}.${name}.module`);
    assertAssetGroup(output.assets, `${source}.${name}.assets`);
    assertServerRendererOwner(
      output.owner,
      `${source}.${name}.owner`,
      output.kind,
      pages,
      routesById,
    );
  }
}

function assertServerRendererOwner(
  value: unknown,
  source: string,
  kind: unknown,
  pages: Record<string, unknown>,
  routesById: Map<string, Record<string, unknown>>,
): void {
  if (value === undefined) {
    if (kind === "ppr-region") {
      throw new Error(`[evjs] ${source} is required for ppr-region renderers.`);
    }
    return;
  }

  assertObject(value, source);
  const supportedKeys = new Set(["pageId", "routeId", "regionId"]);
  for (const key of Object.keys(value)) {
    if (supportedKeys.has(key)) continue;
    throw new Error(
      `[evjs] ${source}.${key} is not supported for server renderers. Use pageId, routeId, or regionId.`,
    );
  }

  if (value.pageId !== undefined) {
    assertOptionalRecordReference(
      value.pageId,
      `${source}.pageId`,
      "pages",
      pages,
    );
  }

  const route = assertServerRendererRouteOwner(
    value.routeId,
    `${source}.routeId`,
    routesById,
  );
  if (
    route?.pageId !== undefined &&
    value.pageId !== undefined &&
    route.pageId !== value.pageId
  ) {
    throw new Error(
      `[evjs] ${source}.routeId "${value.routeId}" points to route pageId "${route.pageId}", not owner.pageId "${value.pageId}".`,
    );
  }

  if (kind === "ppr-region" && value.pageId === undefined) {
    throw new Error(
      `[evjs] ${source}.pageId is required for ppr-region renderers.`,
    );
  }
  if (kind === "ppr-region" && value.regionId === undefined) {
    throw new Error(
      `[evjs] ${source}.regionId is required for ppr-region renderers.`,
    );
  }

  if (value.regionId === undefined) return;
  assertManifestString(value.regionId, `${source}.regionId`);
  const regionId = value.regionId as string;
  if (value.pageId === undefined) {
    throw new Error(`[evjs] ${source}.regionId requires owner.pageId.`);
  }
  const pageId = value.pageId as string;
  if (!hasPprRegion(pages[pageId], regionId)) {
    throw new Error(
      `[evjs] ${source}.regionId "${regionId}" does not match any manifest.pages.${pageId}.ppr.regions entry.`,
    );
  }
}

function assertServerRendererRouteOwner(
  value: unknown,
  source: string,
  routesById: Map<string, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  assertManifestString(value, source);
  const routeId = value as string;
  const route = routesById.get(routeId);
  if (!route) {
    throw new Error(
      `[evjs] ${source} "${routeId}" does not match any manifest.routes entry.`,
    );
  }
  return route;
}

function createRouteOutputMap(
  routes: unknown[],
): Map<string, Record<string, unknown>> {
  const routesById = new Map<string, Record<string, unknown>>();
  for (const route of routes) {
    if (isRecord(route) && typeof route.id === "string") {
      routesById.set(route.id, route);
    }
  }
  return routesById;
}

function hasPprRegion(page: unknown, regionId: string): boolean {
  if (!isRecord(page) || !isRecord(page.ppr) || !isRecord(page.ppr.regions)) {
    return false;
  }
  return Object.hasOwn(page.ppr.regions, regionId);
}

function getServerRendererOutputs(
  server: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(server) || !isRecord(server.renderers)) return undefined;
  return server.renderers;
}

function assertServerRendererKind(value: unknown, source: string): void {
  if (
    value === "page-server" ||
    value === "rsc-page" ||
    value === "ppr-shell" ||
    value === "ppr-region"
  ) {
    return;
  }
  throw new Error(
    `[evjs] ${source} must be "page-server", "rsc-page", "ppr-shell", or "ppr-region".`,
  );
}

function assertServerFunctionOutputs(
  value: Record<string, unknown>,
  source: string,
  requireModule: boolean,
): void {
  for (const [name, output] of Object.entries(value)) {
    assertManifestServerFunctionIdKey(name, source);
    assertObject(output, `${source}.${name}`);
    if (requireModule || output.module !== undefined) {
      assertManifestString(output.module, `${source}.${name}.module`);
    }
    assertManifestString(output.exportName, `${source}.${name}.exportName`);
    assertAssetGroup(output.assets, `${source}.${name}.assets`);
  }
}

function assertAppOutputs(
  value: Record<string, unknown>,
  source: string,
): void {
  for (const [name, output] of Object.entries(value)) {
    assertManifestBuildIdentifierKey(name, source);
    assertObject(output, `${source}.${name}`);
    assertAssetGroup(output.assets, `${source}.${name}.assets`);
    assertHtmlDocumentOutput(output.document, `${source}.${name}.document`);
    assertRuntimeModuleOutput(output.module, `${source}.${name}.module`);
  }
}

function assertPageOutputs(
  value: Record<string, unknown>,
  source: string,
): void {
  for (const [name, output] of Object.entries(value)) {
    assertManifestBuildIdentifierKey(name, source);
    assertObject(output, `${source}.${name}`);
    assertAssetGroup(output.assets, `${source}.${name}.assets`);
    assertHtmlDocumentOutput(output.document, `${source}.${name}.document`);
    assertManifestPathname(output.path, `${source}.${name}.path`);
    assertRuntimeModuleOutput(output.module, `${source}.${name}.module`);
    if (output.ppr !== undefined) {
      assertPprPageOutput(output.ppr, `${source}.${name}.ppr`);
    }
    assertRenderMode(output.render, `${source}.${name}.render`);
    if (output.componentModel !== undefined) {
      assertComponentModel(
        output.componentModel,
        `${source}.${name}.componentModel`,
      );
    }
    if (output.hydrate !== undefined) {
      assertHydrationMode(output.hydrate, `${source}.${name}.hydrate`);
    }
    assertPageRenderingOutput(output.rendering, `${source}.${name}.rendering`);
    assertPprPageOutputContract(output, `${source}.${name}`);
    assertRscPageOutputContract(output, `${source}.${name}`);
  }
}

function assertHtmlDocumentOutput(value: unknown, source: string): void {
  if (value === undefined) return;
  assertObject(value, source);
  assertManifestString(value.fileName, `${source}.fileName`);
  const fileName = value.fileName as string;
  if (
    fileName.startsWith("/") ||
    fileName.includes("\\") ||
    fileName.split("/").includes("..")
  ) {
    throw new Error(
      `[evjs] ${source}.fileName must be a relative output file path.`,
    );
  }
}

function assertRuntimeModuleOutput(value: unknown, source: string): void {
  if (value === undefined) return;
  assertObject(value, source);
  assertRuntimeModuleType(value.type, `${source}.type`);
  assertManifestString(value.href, `${source}.href`);
  if (value.source !== undefined) {
    assertManifestString(value.source, `${source}.source`);
  }
}

function assertRuntimeModuleType(value: unknown, source: string): void {
  if (
    value === "entry" ||
    value === "lifecycle" ||
    value === "react-component"
  ) {
    return;
  }
  throw new Error(
    `[evjs] ${source} must be "entry", "lifecycle", or "react-component".`,
  );
}

function assertRenderMode(value: unknown, source: string): void {
  if (value === "csr" || value === "ssr" || value === "ssg") return;
  throw new Error(`[evjs] ${source} must be "csr", "ssr", or "ssg".`);
}

function assertComponentModel(value: unknown, source: string): void {
  if (value === "client" || value === "rsc") return;
  throw new Error(`[evjs] ${source} must be "client" or "rsc".`);
}

function assertPageRenderingOutput(value: unknown, source: string): void {
  assertObject(value, source);
  assertPageRenderingComponent(value.component, `${source}.component`);
  assertPageRenderingHtml(value.html, `${source}.html`);
  if (value.prerender !== undefined) {
    assertPageRenderingPrerender(value.prerender, `${source}.prerender`);
  }
  if (typeof value.streaming !== "boolean") {
    throw new Error(`[evjs] ${source}.streaming must be a boolean.`);
  }
  assertHydrationMode(value.hydrate, `${source}.hydrate`);
}

function assertPageRenderingComponent(value: unknown, source: string): void {
  if (value === "client" || value === "server" || value === "rsc") return;
  throw new Error(`[evjs] ${source} must be "client", "server", or "rsc".`);
}

function assertPageRenderingHtml(value: unknown, source: string): void {
  if (
    value === "client" ||
    value === "server" ||
    value === "static" ||
    value === "partial"
  ) {
    return;
  }
  throw new Error(
    `[evjs] ${source} must be "client", "server", "static", or "partial".`,
  );
}

function assertPageRenderingPrerender(value: unknown, source: string): void {
  if (value === "full" || value === "partial") return;
  throw new Error(`[evjs] ${source} must be "full" or "partial".`);
}

function assertHydrationMode(value: unknown, source: string): void {
  if (
    value === "none" ||
    value === "load" ||
    value === "visible" ||
    value === "idle"
  ) {
    return;
  }
  throw new Error(
    `[evjs] ${source} must be "none", "load", "visible", or "idle".`,
  );
}

function assertServerRuntime(value: unknown, source: string): void {
  if (value === "node" || value === "edge") return;
  throw new Error(`[evjs] ${source} must be "node" or "edge".`);
}

function assertRscPageOutputContract(
  output: Record<string, unknown>,
  source: string,
): void {
  const rendering = output.rendering;
  if (!isRecord(rendering)) return;
  const isRscPage =
    output.componentModel === "rsc" || rendering.component === "rsc";

  if (!isRscPage) return;
  if (output.componentModel !== "rsc") {
    throw new Error(
      `[evjs] ${source}.componentModel must be "rsc" when ${source}.rendering.component is "rsc".`,
    );
  }
  if (rendering.component !== "rsc") {
    throw new Error(
      `[evjs] ${source}.rendering.component must be "rsc" when ${source}.componentModel is "rsc".`,
    );
  }
  if (output.render !== "ssr") {
    throw new Error(`[evjs] ${source}.render must be "ssr" for RSC pages.`);
  }
  if (rendering.hydrate !== "none") {
    throw new Error(
      `[evjs] ${source}.rendering.hydrate must be "none" for RSC pages.`,
    );
  }
  if (output.hydrate !== undefined && output.hydrate !== "none") {
    throw new Error(`[evjs] ${source}.hydrate must be "none" for RSC pages.`);
  }
}

function assertPprPageOutputContract(
  output: Record<string, unknown>,
  source: string,
): void {
  if (output.ppr === undefined) return;
  const rendering = output.rendering;
  if (!isRecord(rendering) || !isRecord(output.ppr)) return;

  if (output.componentModel === "rsc" || rendering.component === "rsc") {
    throw new Error(`[evjs] ${source}.ppr is not supported for RSC pages.`);
  }
  if (output.render !== "ssr") {
    throw new Error(`[evjs] ${source}.render must be "ssr" for PPR pages.`);
  }
  if (rendering.component !== "server") {
    throw new Error(
      `[evjs] ${source}.rendering.component must be "server" for PPR pages.`,
    );
  }
  if (rendering.html !== "partial") {
    throw new Error(
      `[evjs] ${source}.rendering.html must be "partial" for PPR pages.`,
    );
  }
  if (rendering.prerender !== "partial") {
    throw new Error(
      `[evjs] ${source}.rendering.prerender must be "partial" for PPR pages.`,
    );
  }
  const streams = output.ppr.delivery === "stream";
  if (rendering.streaming !== streams) {
    throw new Error(
      `[evjs] ${source}.rendering.streaming must be ${String(streams)} when ${source}.ppr.delivery is "${output.ppr.delivery}".`,
    );
  }
  if (rendering.hydrate !== "none") {
    throw new Error(
      `[evjs] ${source}.rendering.hydrate must be "none" for PPR pages.`,
    );
  }
  if (output.hydrate !== undefined && output.hydrate !== "none") {
    throw new Error(`[evjs] ${source}.hydrate must be "none" for PPR pages.`);
  }
}

function assertRouteOutputs(
  value: unknown[],
  source: string,
  pages: Record<string, unknown>,
  apps: Record<string, unknown>,
): void {
  const idOwners = new Map<string, string>();
  const pathOwners = new Map<string, { path: string; source: string }>();
  const shapeOwners = new Map<string, { path: string; source: string }>();

  value.forEach((route, index) => {
    const routeSource = `${source}[${index}]`;
    assertObject(route, routeSource);
    assertManifestString(route.id, `${routeSource}.id`);
    const routeId = route.id as string;
    assertUniqueManifestRouteId(routeId, `${routeSource}.id`, idOwners);
    assertManifestPathname(route.path, `${routeSource}.path`, true);
    const path = route.path as string;
    assertPageRouteParamSegments(path, `${routeSource}.path`);
    assertUniquePageRoutePath(path, `${routeSource}.path`, pathOwners);
    assertUniquePageRouteShape(path, `${routeSource}.path`, shapeOwners);
    const page = assertOptionalRecordReference(
      route.pageId,
      `${routeSource}.pageId`,
      "pages",
      pages,
    );
    assertOptionalRecordReference(
      route.appId,
      `${routeSource}.appId`,
      "apps",
      apps,
    );
    if (route.module !== undefined) {
      assertManifestString(route.module, `${routeSource}.module`);
    }
    if (route.render !== undefined) {
      assertRenderMode(route.render, `${routeSource}.render`);
    }
    if (route.hydrate !== undefined) {
      assertHydrationMode(route.hydrate, `${routeSource}.hydrate`);
    }
    if (route.runtime !== undefined) {
      assertServerRuntime(route.runtime, `${routeSource}.runtime`);
    }
    if (page) {
      assertPageRouteOutputContract(route, page, routeSource);
    }
  });
}

function assertPageRouteOutputContract(
  route: Record<string, unknown>,
  page: Record<string, unknown>,
  routeSource: string,
): void {
  if (
    typeof page.path === "string" &&
    normalizeRoutePathname(route.path as string) !==
      normalizeRoutePathname(page.path)
  ) {
    throw new Error(
      `[evjs] ${routeSource}.path "${route.path as string}" must match manifest.pages.${route.pageId as string}.path "${page.path}".`,
    );
  }
  if (route.render !== undefined && route.render !== page.render) {
    throw new Error(
      `[evjs] ${routeSource}.render must match manifest.pages.${route.pageId as string}.render "${page.render as string}".`,
    );
  }
}

function assertUniqueManifestRouteId(
  id: string,
  source: string,
  idOwners: Map<string, string>,
): void {
  const existingSource = idOwners.get(id);
  if (existingSource) {
    throw new Error(
      `[evjs] ${source} duplicates ${existingSource} "${id}". Route ids must be unique.`,
    );
  }
  idOwners.set(id, source);
}

function assertUniquePageRoutePath(
  path: string,
  source: string,
  pathOwners: Map<string, { path: string; source: string }>,
): void {
  const normalizedPath = normalizeRoutePathname(path);
  const existing = pathOwners.get(normalizedPath);
  if (existing) {
    throw new Error(
      `[evjs] ${source} duplicates ${existing.source} "${existing.path}". Page route paths must be unique.`,
    );
  }
  pathOwners.set(normalizedPath, { path, source });
}

function assertUniquePageRouteShape(
  path: string,
  source: string,
  shapeOwners: Map<string, { path: string; source: string }>,
): void {
  const shape = pageRoutePathShapeFromPath(path);
  const existing = shapeOwners.get(shape);
  if (existing) {
    throw new Error(
      `[evjs] ${source} has the same route shape as ${existing.source} "${existing.path}". Use one page route per URL shape.`,
    );
  }
  shapeOwners.set(shape, { path, source });
}

function assertPageRouteParamSegments(path: string, source: string): void {
  const error = getPageRouteParamSegmentValidationError(path);
  if (!error) return;
  throw new Error(
    `[evjs] ${source} ${formatPageRouteParamSegmentError(error)}`,
  );
}

function formatPageRouteParamSegmentError(
  error: PageRouteParamSegmentValidationError,
): string {
  if (error.error === "empty") {
    return `contains dynamic segment "${error.segment}" without a param name.`;
  }
  if (error.error === "reserved") {
    return `uses reserved dynamic param name "${error.name}" in segment "${error.segment}". Use a safe application-specific name.`;
  }
  if (error.error === "duplicate") {
    return `uses duplicate dynamic param name "${error.name}" in segment "${error.segment}". Use unique param names within one route path.`;
  }
  return `contains more than one wildcard segment "${error.segment}". Use at most one wildcard segment in a route path.`;
}

function assertServerRouteOutputs(value: unknown[], source: string): void {
  const pathOwners = new Map<string, string>();
  const shapeOwners = new Map<string, { path: string; source: string }>();

  value.forEach((route, index) => {
    const routeSource = `${source}[${index}]`;
    assertObject(route, routeSource);
    assertManifestPathname(route.path, `${routeSource}.path`, true);
    const path = route.path as string;
    assertServerRouteParamSegments(path, `${routeSource}.path`);
    assertUniqueServerRoutePath(path, `${routeSource}.path`, pathOwners);
    assertUniqueServerRouteShape(path, `${routeSource}.path`, shapeOwners);
    assertHttpMethodArray(route.methods, `${routeSource}.methods`);
    assertAssetGroup(route.assets, `${routeSource}.assets`);
  });
}

function assertUniqueServerRoutePath(
  path: string,
  source: string,
  pathOwners: Map<string, string>,
): void {
  const existingSource = pathOwners.get(path);
  if (existingSource) {
    throw new Error(
      `[evjs] ${source} duplicates ${existingSource} "${path}". Server route paths must be unique.`,
    );
  }
  pathOwners.set(path, source);
}

function assertUniqueServerRouteShape(
  path: string,
  source: string,
  shapeOwners: Map<string, { path: string; source: string }>,
): void {
  const shape = serverRoutePathShapeFromPath(path);
  const existing = shapeOwners.get(shape);
  if (existing) {
    throw new Error(
      `[evjs] ${source} has the same route shape as ${existing.source} "${existing.path}". Use one server route per URL shape.`,
    );
  }
  shapeOwners.set(shape, { path, source });
}

function assertServerRouteParamSegments(path: string, source: string): void {
  const error = getServerRouteParamSegmentValidationError(path);
  if (!error) return;
  throw new Error(
    `[evjs] ${source} ${formatServerRouteParamSegmentError(error)}`,
  );
}

function formatServerRouteParamSegmentError(
  error: ServerRouteParamSegmentValidationError,
): string {
  if (error.error === "empty") {
    return `contains dynamic segment "${error.segment}" without a param name.`;
  }
  if (error.error === "reserved") {
    return `uses reserved dynamic param name "${error.name}" in segment "${error.segment}". Use a safe application-specific name.`;
  }
  return `uses duplicate dynamic param name "${error.name}" in segment "${error.segment}". Use unique param names within one route path.`;
}

function assertOptionalRecordReference(
  value: unknown,
  source: string,
  recordName: string,
  records: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  assertManifestString(value, source);
  if (!Object.hasOwn(records, value)) {
    throw new Error(
      `[evjs] ${source} "${value}" does not match any manifest.${recordName} entry.`,
    );
  }
  const record = records[value];
  return isRecord(record) ? record : undefined;
}

function assertManifestBuildIdentifierKey(key: string, source: string): void {
  if (!key.trim()) {
    throw new Error(`[evjs] ${source} must not contain empty keys.`);
  }
  if (isBuildIdentifier(key)) return;
  throw new Error(
    `[evjs] ${source} key "${key}" must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
  );
}

function assertManifestServerFunctionIdKey(key: string, source: string): void {
  if (!key.trim()) {
    throw new Error(`[evjs] ${source} must not contain empty keys.`);
  }
  if (isServerFunctionId(key)) return;
  throw new Error(
    `[evjs] ${source} key "${key}" must be a non-empty string without leading or trailing whitespace.`,
  );
}

function assertManifestStringKey(key: string, source: string): void {
  if (!key.trim()) {
    throw new Error(`[evjs] ${source} must not contain empty keys.`);
  }
  if (key.trim() !== key) {
    throw new Error(
      `[evjs] ${source} key "${key}" must not contain leading or trailing whitespace.`,
    );
  }
}

function assertManifestString(
  value: unknown,
  source: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[evjs] ${source} must be a non-empty string.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${source} must not contain leading or trailing whitespace.`,
    );
  }
}

function assertPprPageOutput(value: unknown, source: string): void {
  assertObject(value, source);
  assertPprDeliveryMode(value.delivery, `${source}.delivery`);
  assertAssetGroup(value.shell, `${source}.shell`);
  assertObject(value.regions, `${source}.regions`);
  for (const [name, region] of Object.entries(value.regions)) {
    assertManifestBuildIdentifierKey(name, `${source}.regions`);
    assertObject(region, `${source}.regions.${name}`);
    assertManifestString(region.id, `${source}.regions.${name}.id`);
    if (region.id !== name) {
      throw new Error(
        `[evjs] ${source}.regions.${name}.id must match region key "${name}".`,
      );
    }
    assertAssetGroup(region.assets, `${source}.regions.${name}.assets`);
    if (region.component !== undefined) {
      assertManifestString(
        region.component,
        `${source}.regions.${name}.component`,
      );
    }
    if (region.fallback !== undefined) {
      assertManifestString(
        region.fallback,
        `${source}.regions.${name}.fallback`,
      );
    }
    if (region.cache !== undefined) {
      assertPprRegionCache(region.cache, `${source}.regions.${name}.cache`);
    }
    if (region.hydrate !== undefined) {
      assertHydrationMode(region.hydrate, `${source}.regions.${name}.hydrate`);
    }
  }
}

function assertPprDeliveryMode(value: unknown, source: string): void {
  if (value === "merge" || value === "stream") return;
  throw new Error(`[evjs] ${source} must be "merge" or "stream".`);
}

function assertPprRegionCache(value: unknown, source: string): void {
  if (value === "no-store") return;
  if (!isRecord(value)) {
    throw new Error(
      `[evjs] ${source} must be "no-store" or an object with a positive integer revalidate.`,
    );
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "revalidate") {
    throw new Error(`[evjs] ${source} can only contain revalidate.`);
  }
  if (!isPositiveInteger(value.revalidate)) {
    throw new Error(
      `[evjs] ${source}.revalidate must be a positive integer number of seconds.`,
    );
  }
}

function assertPprPageOutputReferences(
  pages: Record<string, unknown>,
  source: string,
  serverRenderers: Record<string, unknown> | undefined,
  required: boolean,
): void {
  if (!required) return;
  for (const [pageId, page] of Object.entries(pages)) {
    if (!isRecord(page) || page.ppr === undefined) continue;
    if (!serverRenderers) {
      throw new Error(
        `[evjs] ${source}.${pageId}.ppr requires manifest.server.renderers for PPR server renderer references.`,
      );
    }

    assertPprServerRenderer(
      serverRenderers,
      "ppr-shell",
      pageId,
      undefined,
      `${source}.${pageId}.ppr.shell`,
    );

    const regions =
      isRecord(page.ppr) && isRecord(page.ppr.regions) ? page.ppr.regions : {};
    for (const regionId of Object.keys(regions)) {
      assertPprServerRenderer(
        serverRenderers,
        "ppr-region",
        pageId,
        regionId,
        `${source}.${pageId}.ppr.regions.${regionId}`,
      );
    }
  }
}

function assertPageServerRendererReferences(
  pages: Record<string, unknown>,
  source: string,
  serverRenderers: Record<string, unknown> | undefined,
  routes: unknown[],
  required: boolean,
): void {
  if (!required) return;
  const routesById = createRouteOutputMap(routes);
  for (const [pageId, page] of Object.entries(pages)) {
    if (!isRecord(page) || !requiresPageServerRenderer(page)) continue;
    if (!serverRenderers) {
      throw new Error(
        `[evjs] ${source}.${pageId} requires manifest.server.renderers for page-server renderer references.`,
      );
    }
    if (findPageServerRenderer(serverRenderers, pageId, routesById)) continue;
    throw new Error(
      `[evjs] ${source}.${pageId} requires a page-server manifest.server.renderers entry owned by page "${pageId}" or one of its routes.`,
    );
  }
}

function requiresPageServerRenderer(page: Record<string, unknown>): boolean {
  if (page.ppr !== undefined || !isRecord(page.rendering)) return false;
  if (page.rendering.html !== "server" && page.rendering.html !== "static") {
    return false;
  }
  return page.rendering.component !== "client";
}

function findPageServerRenderer(
  serverRenderers: Record<string, unknown>,
  pageId: string,
  routesById: Map<string, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  for (const renderer of Object.values(serverRenderers)) {
    if (!isRecord(renderer) || renderer.kind !== "page-server") continue;
    if (!isRecord(renderer.owner)) continue;
    if (renderer.owner.pageId === pageId) return renderer;
    if (typeof renderer.owner.routeId !== "string") continue;
    const route = routesById.get(renderer.owner.routeId);
    if (route?.pageId === pageId) return renderer;
  }
  return undefined;
}

function assertPprServerRenderer(
  serverRenderers: Record<string, unknown>,
  kind: "ppr-shell" | "ppr-region",
  pageId: string,
  regionId: string | undefined,
  source: string,
): void {
  if (findPprServerRenderer(serverRenderers, kind, pageId, regionId)) return;
  const owner =
    regionId === undefined
      ? `page "${pageId}"`
      : `page "${pageId}" region "${regionId}"`;
  throw new Error(
    `[evjs] ${source} requires a ${kind} manifest.server.renderers entry owned by ${owner}.`,
  );
}

function findPprServerRenderer(
  serverRenderers: Record<string, unknown>,
  kind: "ppr-shell" | "ppr-region",
  pageId: string,
  regionId: string | undefined,
): Record<string, unknown> | undefined {
  for (const renderer of Object.values(serverRenderers)) {
    if (!isRecord(renderer) || renderer.kind !== kind) continue;
    if (!isRecord(renderer.owner) || renderer.owner.pageId !== pageId) {
      continue;
    }
    if (regionId !== undefined && renderer.owner.regionId !== regionId) {
      continue;
    }
    return renderer;
  }
  return undefined;
}

function assertRscOutput(
  value: unknown,
  source: string,
  pages: Record<string, unknown>,
  serverRenderers: Record<string, unknown> | undefined,
  routes: unknown[],
  requireServerRendererReferences: boolean,
): void {
  assertObject(value, source);
  assertManifestPathname(
    value.endpoint,
    `${source}.endpoint`,
    value.pages !== undefined,
  );
  assertRscReferenceOutputs(
    value.clientReferences,
    `${source}.clientReferences`,
  );
  assertRscReferenceOutputs(
    value.serverReferences,
    `${source}.serverReferences`,
  );
  if (value.clientReferenceManifest !== undefined) {
    assertObject(
      value.clientReferenceManifest,
      `${source}.clientReferenceManifest`,
    );
  }
  if (value.serverConsumerManifest !== undefined) {
    assertObject(
      value.serverConsumerManifest,
      `${source}.serverConsumerManifest`,
    );
  }
  if (value.pages === undefined) return;

  assertObject(value.pages, `${source}.pages`);
  const routesById = createRouteOutputMap(routes);
  for (const [name, page] of Object.entries(value.pages)) {
    assertObject(page, `${source}.pages.${name}`);
    assertAssetGroup(page.assets, `${source}.pages.${name}.assets`);
    assertRscPageOutputReferences(
      name,
      page,
      `${source}.pages.${name}`,
      pages,
      serverRenderers,
      routesById,
      requireServerRendererReferences,
    );
  }
}

function assertRscReferenceOutputs(value: unknown, source: string): void {
  if (value === undefined) return;
  assertObject(value, source);
  for (const [id, reference] of Object.entries(value)) {
    assertManifestStringKey(id, source);
    const referenceSource = `${source}.${id}`;
    assertObject(reference, referenceSource);
    assertManifestString(reference.module, `${referenceSource}.module`);
    if (reference.exportName !== undefined) {
      assertManifestString(
        reference.exportName,
        `${referenceSource}.exportName`,
      );
    }
  }
}

function assertRscPageOutputReferences(
  name: string,
  page: Record<string, unknown>,
  source: string,
  pages: Record<string, unknown>,
  serverRenderers: Record<string, unknown> | undefined,
  routesById: Map<string, Record<string, unknown>>,
  requireServerRendererReferences: boolean,
): void {
  const manifestPage = pages[name];
  if (!Object.hasOwn(pages, name)) {
    throw new Error(
      `[evjs] ${source} does not match any manifest.pages entry.`,
    );
  }
  if (!isRecord(manifestPage) || manifestPage.componentModel !== "rsc") {
    throw new Error(
      `[evjs] ${source} requires manifest.pages.${name}.componentModel to be "rsc".`,
    );
  }

  assertManifestString(page.renderer, `${source}.renderer`);
  const rendererName = page.renderer as string;
  if (requireServerRendererReferences) {
    const renderer = serverRenderers?.[rendererName];
    if (!renderer) {
      throw new Error(
        `[evjs] ${source}.renderer "${rendererName}" does not match any manifest.server.renderers entry.`,
      );
    }
    if (!isRecord(renderer) || renderer.kind !== "rsc-page") {
      throw new Error(
        `[evjs] ${source}.renderer "${rendererName}" must reference an rsc-page server renderer.`,
      );
    }
    assertRscServerRendererOwner(renderer, name, `${source}.renderer`);
  }

  if (page.component !== undefined) {
    assertManifestString(page.component, `${source}.component`);
  }

  if (page.routeId === undefined) return;
  assertManifestString(page.routeId, `${source}.routeId`);
  const routeId = page.routeId as string;
  const route = routesById.get(routeId);
  if (!route) {
    throw new Error(
      `[evjs] ${source}.routeId "${routeId}" does not match any manifest.routes entry.`,
    );
  }
  if (route.pageId !== undefined && route.pageId !== name) {
    throw new Error(
      `[evjs] ${source}.routeId "${routeId}" points to route pageId "${route.pageId}", not RSC page "${name}".`,
    );
  }
}

function assertRscServerRendererOwner(
  renderer: Record<string, unknown>,
  pageId: string,
  source: string,
): void {
  if (isRecord(renderer.owner) && renderer.owner.pageId === pageId) return;
  throw new Error(
    `[evjs] ${source} must reference an rsc-page manifest.server.renderers entry owned by page "${pageId}".`,
  );
}

function assertAssetGroup(value: unknown, source: string): void {
  assertObject(value, source);
  assertStringArray(value.js, `${source}.js`);
  assertStringArray(value.css, `${source}.css`);
}

function assertStringArray(value: unknown, source: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`[evjs] ${source} must be an array.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`[evjs] ${source} must contain only non-empty strings.`);
    }
    if (item.trim() !== item) {
      throw new Error(
        `[evjs] ${source} item "${item}" must not contain leading or trailing whitespace.`,
      );
    }
  }
}

function assertHttpMethodArray(value: unknown, source: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`[evjs] ${source} must be an array.`);
  }
  if (value.length === 0) {
    throw new Error(`[evjs] ${source} must contain at least one HTTP method.`);
  }

  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !isHttpMethod(item)) {
      throw new Error(
        `[evjs] ${source} item "${String(item)}" is not a supported HTTP method. Supported methods: ${HTTP_METHOD_LIST_DESCRIPTION}.`,
      );
    }
    if (seen.has(item)) {
      throw new Error(
        `[evjs] ${source} must not contain duplicate method "${item}".`,
      );
    }
    seen.add(item);
  }
}

function assertManifestPathname(
  value: unknown,
  source: string,
  required = false,
): void {
  if (value === undefined) {
    if (required) {
      throw new Error(`[evjs] ${source} must be a non-empty pathname.`);
    }
    return;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[evjs] ${source} must be a non-empty pathname.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${source} must not contain leading or trailing whitespace.`,
    );
  }

  const error = getPathPatternValidationError(value);
  if (error) {
    throw new Error(`[evjs] ${source} ${formatManifestPathnameError(error)}`);
  }
}

function assertManifestTransportBaseUrl(value: unknown, source: string): void {
  if (value === undefined) return;

  const error = getUrlStringValidationError(value, {
    baseUrl: "http://evjs.local/",
  });
  if (error) {
    throw new Error(
      `[evjs] ${source} ${formatManifestTransportBaseUrlError(error)}`,
    );
  }
}

function formatManifestTransportBaseUrlError(
  error: UrlStringValidationError,
): string {
  switch (error) {
    case "empty":
      return "must be a non-empty URL string.";
    case "whitespace":
      return "must not contain leading or trailing whitespace.";
    case "invalid-url":
      return "must be a valid URL string.";
  }
}

function formatManifestPathnameError(
  error: PathPatternValidationError,
): string {
  switch (error) {
    case "empty":
      return "must be a non-empty pathname.";
    case "missing-leading-slash":
      return 'must start with "/".';
    case "whitespace":
      return "must not contain whitespace.";
    case "query-or-hash":
      return "must not include a query string or hash.";
  }
}

export {
  type BuildOutputLinkInput,
  type BuildOutputServerModule,
  createPublicManifest,
  createServerManifest,
  linkBuildOutput,
  type ServerManifestFnOutput,
  type ServerManifestOutput,
  type ServerManifestRouteOutput,
} from "./linker.js";
export {
  type ClientRouteMatch,
  type ClientRouteTarget,
  getClientRouteMatches,
  getClientRouteTarget,
  getServerRenderedPagePaths,
  getServerRenderedPaths,
  getServerRenderedRoutePaths,
  isRouteDerivedPage,
  isServerRenderedPage,
  type RouteDerivedPage,
  type RouteRenderingPage,
  type RouteRenderingRoute,
  type RouteRenderingSource,
} from "./routes.js";
