/**
 * @evjs/shared/manifest
 *
 * Shared manifest schemas for the ev framework build system.
 *
 * Bundler adapters emit one framework manifest to `dist/manifest.json`.
 */

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
  remotes: Record<string, RemoteNode>;
  remote?: RemoteBuildNode;
  clientReferences?: ClientReferenceNode[];
  serverReferences?: ServerReferenceNode[];
}

export interface AppNode {
  id: string;
  entry: string;
  html: string;
  routes?: string;
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
  hydrate?: HydrationMode;
  mount?: string;
  ppr?: PprConfig;
}

export interface PprConfig {
  delivery?: PprDeliveryMode;
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

export interface RemoteNode {
  id: string;
  manifest: string;
  activeWhen?: string[];
}

export interface RemoteBuildNode {
  name: string;
  baseUrl: string;
  shared?: SharedDependencyMap;
  entries: Record<string, RemoteBuildEntryNode>;
}

export interface RemoteBuildEntryNode {
  id: string;
  app: string;
  activeWhen?: string[];
  mount?: string;
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

export type RenderMode = "csr" | "ssr" | "ssg" | "ppr" | "rsc";
export type HydrationMode = "none" | "load" | "visible" | "idle";
export type BuildEnvironment = "client" | "server";
export type ServerRuntime = "node" | "edge";
export type PublicPathOutput = string | { mode: "runtime" };

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
  serverEnabled: boolean;
  entries: BuildEntry[];
  html: HtmlPlan[];
  server: ServerBuildPlan;
  runtime: RuntimePlan;
  remote?: RemoteBuildPlan;
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
    | "remote-client"
    | "runtime";
  owner?: BuildEntryOwner;
  metadata?: BuildEntryMetadata;
}

export interface BuildEntryOwner {
  appId?: string;
  pageId?: string;
  routeId?: string;
  regionId?: string;
  remoteId?: string;
  remoteEntryId?: string;
}

export type BuildEntryMetadata =
  | ReactComponentPageEntryMetadata
  | RemoteClientEntryMetadata;

export interface ReactComponentPageEntryMetadata {
  type: "react-component-page";
  component: string;
  mount: string;
  hydrate: HydrationMode;
  render: RenderMode;
}

export interface RemoteClientEntryMetadata {
  type: "remote-client";
  app: string;
}

export interface RemoteBuildPlan {
  name: string;
  baseUrl: string;
  shared?: SharedDependencyMap;
  entries: Record<string, RemoteBuildEntryPlan>;
}

export interface RemoteBuildEntryPlan {
  id: string;
  name: string;
  app: string;
  activeWhen?: string[];
  mount?: string;
}

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
  enabled: boolean;
  entry?: string;
  renderers?: ServerRenderPlan[];
  functionRuntime?: {
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
  server?: RuntimeServerOutput;
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
  server?: ServerOutput;
  remotes?: Record<string, RemoteOutput>;
  rsc?: RscOutput;
  deployment?: Record<string, unknown>;
}

export interface BuildOutputPaths {
  rootDir: string;
  publicDir: string;
  serverDir?: string;
}

export interface RuntimeOutput {
  server?: RuntimeServerOutput;
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
  entry?: string;
  routes?: string;
  mount?: string;
  module?: RuntimeModuleOutput;
}

export interface PageOutput {
  assets: AssetGroup;
  render: RenderMode;
  rendering: PageRenderingOutput;
  path?: string;
  routeId?: string;
  entry?: string;
  component?: string;
  app?: string;
  hydrate?: HydrationMode;
  mount?: string;
  module?: RuntimeModuleOutput;
  ppr?: PprPageOutput;
}

export interface PageRenderingOutput {
  /**
   * Original user-facing render shorthand. Kept for compatibility and
   * diagnostics; runtime decisions should prefer the orthogonal fields below.
   */
  mode: RenderMode;
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

export interface RemoteOutput {
  manifest: string;
  activeWhen?: string[];
}

export interface RemoteManifest {
  version: 1;
  name: string;
  baseUrl: string;
  shared?: SharedDependencyMap;
  entries: Record<string, RemoteEntry>;
}

export interface RemoteEntry {
  assets?: AssetGroup;
  module: RuntimeModuleOutput;
  activeWhen?: string[];
  mount?: string;
}

export type SharedDependencyMap = Record<string, SharedDependency>;

export interface SharedDependency {
  shareKey?: string;
  requiredVersion?: string;
  singleton?: boolean;
  strictVersion?: boolean;
  eager?: boolean;
}

export interface RscOutput {
  endpoint?: string;
  pages?: Record<string, RscPageOutput>;
  clientReferences?: Record<string, unknown>;
  serverReferences?: Record<string, unknown>;
  clientReferenceManifest?: Record<string, unknown>;
  serverConsumerManifest?: Record<string, unknown>;
}

export interface RscPageOutput {
  renderer?: string;
  assets: AssetGroup;
  component?: string;
  routeId?: string;
}

// ── Route resolution ────────────────────────────────────────────────────

/** Route metadata extracted from a createRoute() call. */
export interface ExtractedRoute {
  /** Route path (e.g. "/", "/posts/$postId"). */
  path: string;
  /** Stable route id when a static route DSL provides one. */
  id?: string;
  /** Static page/component module declared for this route. */
  module?: string;
  /** Route render mode declared in route metadata. */
  render?: RenderMode;
  /** Route hydration mode declared in route metadata. */
  hydrate?: HydrationMode;
  /** Server runtime declared in route metadata. */
  runtime?: ServerRuntime;
  /** Owning app id for routes extracted from an app-specific route source. */
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
  module?: string;
  render?: RenderMode;
  hydrate?: HydrationMode;
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
    module?: string;
    render?: RenderMode;
    hydrate?: HydrationMode;
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

    const seenKey = `${r.appId ?? ""}:${fullPath}`;
    if (!seen.has(seenKey)) {
      seen.add(seenKey);
      result.push({
        path: fullPath,
        id: r.id,
        module: r.module,
        render: r.render,
        hydrate: r.hydrate,
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

export {
  type BuildOutputLinkInput,
  type BuildOutputServerModule,
  createPublicManifest,
  linkBuildOutput,
  linkRemoteManifest,
  type RemoteManifestLinkInput,
} from "./linker.js";
