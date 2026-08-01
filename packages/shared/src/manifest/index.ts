/**
 * @evjs/shared/manifest
 *
 * Shared contracts for the evjs control plane: semantic CoreGraph, concrete
 * BuildPlan, linked BuildOutput, and their runtime and deployment projections.
 * Core serializes DeploymentMetadata; public and server manifests are explicit
 * consumer-specific projections.
 */

import {
  readOptionalStaticJsonObjectProperty,
  type StaticJsonObject,
} from "../_internal/static-json.js";
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
import {
  formatConcreteRuntimePathSegmentValidationError,
  getConcreteRuntimePathSegmentValidationError,
} from "../runtime-path.js";
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
import { assertPageMetadata, type PageMetadata } from "./page-metadata.js";
import { assertBuildOutputServerArtifacts } from "./server-artifacts.js";

/** JavaScript and CSS assets emitted for a manifest entry. */
export interface AssetGroup {
  /** JavaScript bundle paths. */
  js: string[];
  /** CSS bundle paths. */
  css: string[];
}

export type PageScope =
  | { kind: "module"; file: string }
  | { kind: "directory"; root: string };

export interface PprConfig {
  delivery?: PprDeliveryMode;
  revalidate?: number | false;
  regions?: Record<string, PprRegionConfig>;
}

export interface PprRegionConfig {
  component: string;
  fallback?: string;
  cache?: PprCachePolicy;
}

export type PprCachePolicy = "no-store" | { revalidate: number };

export type PprDeliveryMode = "merge" | "stream";

export type AppRouteTarget =
  | { kind: "page"; pageId: string }
  | { kind: "group" }
  | { kind: "redirect"; to: AppRouteLocation };

export type AppRouteLocation =
  | { kind: "path"; path: string }
  | { kind: "url"; href: string };

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
export type HydrationMode = "none" | "load";
export type BuildEnvironment = "client" | "server";
export type ServerRuntime = "node" | "edge";
export type PublicPathOutput = string;

/**
 * Concrete compilation and materialization units derived from resolved config
 * and CoreGraph. Semantic ownership remains in CoreGraph; bundler adapters
 * consume this plan and return build facts for linking.
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
  resolve?: ResolvePlan;
  generated?: GeneratedFrameworkPlan;
  entries: BuildEntry[];
  html: HtmlPlan[];
  server: ServerBuildPlan;
  runtime: RuntimePlan;
  dev: DevBuildPlan;
  rsc?: RscBuildPlan;
}

export interface DevBuildPlan {
  clientRoutes: DevClientRoutePlan[];
  /** Canonical request Route patterns handled by server file routes. */
  serverRequestRoutePaths: string[];
  /** Canonical Page route patterns whose rendering requires the dev server. */
  serverRenderedPagePaths: string[];
  hasPpr: boolean;
}

export interface DevClientRoutePlan {
  path: string;
  target: { kind: "app"; appId: string } | { kind: "page"; pageId: string };
}

export interface RscBuildPlan {
  clientReferenceModules: string[];
}

export interface ResolvePlan {
  alias?: Record<string, string>;
  external?: Record<string, ResolveExternalPlan>;
}

export interface ResolveExternalPlan {
  source?: string;
  runtime?: "client" | "server" | "all";
}

export interface BuildEntry {
  name: string;
  import: string;
  environment: BuildEnvironment;
  runtime?: "browser" | ServerRuntime;
  phase?: BuildEntryPhase;
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

export type BuildEntryPhase = "runtime" | "build";

export interface BuildEntryOwner {
  appId?: string;
  pageId?: string;
  routeId?: string;
  regionId?: string;
}

export type BuildEntryMetadata =
  | ReactComponentPageEntryMetadata
  | ReactServerPageEntryMetadata
  | PagesAppEntryMetadata
  | ServerAppEntryMetadata;

export interface ReactComponentPageEntryMetadata {
  type: "react-component-page";
  component: string;
  /** Outer-to-inner Page composition for an independent MPA Page. */
  layers?: ReactPageLayer[];
  mount: string;
  /**
   * Effective browser activation policy. `"load"` mounts a CSR Page, but
   * hydrates a Page whose initial HTML came from SSR or SSG.
   */
  hydrate: HydrationMode;
  render: RenderMode;
  route?: {
    id: string;
    path: string;
  };
}

export interface ReactServerPageEntryMetadata {
  type: "react-server-page";
  component: string;
  /** Outer-to-inner route composition shared with the client Page tree. */
  layers?: ReactPageLayer[];
}

export interface ReactPageLayer {
  kind: "layout" | "wrapper";
  module: string;
}

export interface PagesAppEntryMetadata {
  type: "pages-app";
  routes: PagesAppRouteNode[];
  mount: string;
  rootModule?: string;
}

/** Route input consumed only by the generated framework SPA bootstrap. */
export interface PagesAppRouteNode {
  id: string;
  path: string;
  parentId?: string;
  kind?: PageRouteKind;
  module?: string;
  target?: AppRouteTarget;
  wrappers?: string[];
  /** Bypass the Application/root layout while this route branch matches. */
  layout?: false;
  errorModule?: string;
  notFoundModule?: string;
  /** Page-owned metadata projected into the generated SPA route runtime. */
  metadata?: PageMetadata;
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
  /** Page source boundary; explicit route input may retain module scope. */
  scope?: PageScope;
  html?: string;
  parentId?: string;
  kind?: PageRouteKind;
  errorModule?: string;
  notFoundModule?: string;
}

export type PageRouteKind = "page" | "layout";

export interface HtmlPlan {
  id: string;
  template: string;
  fileName: string;
  /** Additional static paths containing the same transformed HTML Document. */
  aliases?: string[];
  owner: {
    appId?: string;
    pageId?: string;
  };
  /** Page-owned metadata projected onto this concrete HTML document. */
  metadata?: PageMetadata;
}

export interface ServerBuildPlan {
  entry?: string;
  renderers?: ServerRenderPlan[];
  /**
   * HTML templates compiled into request-time document shells for Pages that
   * are rendered by the deployment server.
   *
   * These are build inputs, not emitted static documents. Keeping them on the
   * server plan makes template ownership explicit and avoids reconstructing
   * document semantics from the CoreGraph in the runtime emission phase.
   */
  documents?: ServerDocumentPlan[];
}

export interface ServerDocumentPlan {
  /** Page whose request-time HTML is inserted into this document. */
  pageId: string;
  /** Core Document identity exposed to HTML plugin hooks. */
  documentId: string;
  /** Application identity exposed to application-scoped HTML contributions. */
  applicationId: string;
  /** Source HTML template path. */
  template: string;
  /** Logical document filename exposed to HTML plugin hooks; not emitted. */
  fileName: string;
  /** Mount selector whose contents are replaced by the server-rendered Page. */
  mount: string;
  /** Page-owned metadata applied before HTML plugin hooks run. */
  metadata?: PageMetadata;
}

/**
 * Serialized request-time document template split around values produced while
 * rendering a Page request.
 */
export interface ServerDocumentShell {
  /** Document bytes before the server-rendered Page HTML. */
  beforeContent: string;
  /** Document bytes between Page HTML and request-specific bootstrap data. */
  betweenContentAndData: string;
  /** Document bytes after request-specific bootstrap data. */
  afterData: string;
}

export interface ServerRenderPlan {
  name: string;
  import: string;
  phase?: BuildEntryPhase;
  kind: "page-server" | "rsc-page" | "ppr-shell" | "ppr-region";
  owner?: BuildEntryOwner;
  metadata?: ReactServerPageEntryMetadata;
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
  /** Generated IR or CoreGraph semantics changed without changing entry identity. */
  generatedChanged: boolean;
  /** Bundler resolution inputs changed and require adapter reconfiguration. */
  resolveChanged: boolean;
  /** Runtime endpoints, public paths, or transport settings changed. */
  runtimeChanged: boolean;
  /** Config changed and framework-owned delivery artifacts must be re-emitted. */
  deliveryChanged: boolean;
  /** Server compiler output, renderers, or RSC compilation inputs changed. */
  serverCompilationChanged: boolean;
  /** Request-time server Document inputs changed and must be re-emitted. */
  serverDocumentsChanged: boolean;
  /** Development routing or proxy topology changed. */
  devRoutingChanged: boolean;
}

/**
 * Complete in-memory link of CoreGraph ownership, BuildPlan units, and bundler
 * asset facts. Plugins, runtime projection, and deployment projection consume
 * this contract; it is not serialized wholesale as the deployment artifact.
 */
export interface BuildOutput {
  version: 1;
  buildId: string;
  paths: BuildOutputPaths;
  publicPath: PublicPathOutput;
  runtime: RuntimeOutput;
  assets: Record<string, AssetGroup>;
  apps: Record<string, AppOutput>;
  pages: Record<string, PageOutput>;
  routes: RouteOutput[];
  server: ServerOutput;
  rsc?: RscOutput;
  deployment?: StaticJsonObject;
}

/**
 * Select the manifest contract and cross-reference strictness to validate.
 * `server: "optional"` selects a PublicManifest shape; it does not make the
 * server field optional on an otherwise complete BuildOutput.
 */
export interface FrameworkManifestValidationOptions {
  server?: "required" | "optional";
  pageRendererReferences?: "required" | "optional";
  pprRendererReferences?: "required" | "optional";
  rscRendererReferences?: "required" | "optional";
}

export type PublicManifestOutput =
  | PublicSpaManifestOutput
  | PublicMpaManifestOutput
  | PublicStaticManifestOutput;

export interface PublicSpaManifestOutput {
  version: 1;
  buildId: string;
  publicPath: PublicPathOutput;
  assets?: Record<string, AssetGroup>;
  routing: PublicSpaRoutingOutput;
}

export interface PublicMpaManifestOutput {
  version: 1;
  buildId: string;
  publicPath: PublicPathOutput;
  routing: PublicMpaRoutingOutput;
}

export interface PublicStaticManifestOutput {
  version: 1;
  buildId: string;
  publicPath: PublicPathOutput;
  documents: PublicDocumentOutput[];
}

export type PublicRoutingOutput =
  | PublicSpaRoutingOutput
  | PublicMpaRoutingOutput;

export interface PublicSpaRoutingOutput {
  kind: "spa";
  routes: PublicRouteOutput[];
}

export interface PublicMpaRoutingOutput {
  kind: "mpa";
  pages: Record<string, PublicPageOutput>;
}

export interface PublicDocumentOutput {
  id: string;
  path: string;
  fileName: string;
  aliases?: string[];
  render: Extract<RenderMode, "csr" | "ssg">;
  assets?: AssetGroup;
  metadata?: PageMetadata;
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
  componentModel?: ComponentModel;
  /** Effective browser activation; CSR `"load"` means mount, not hydration. */
  hydrate?: HydrationMode;
  mount?: string;
  prerender?: PrerenderConfig;
  module?: RuntimeModuleOutput;
  ppr?: PprPageOutput;
  metadata?: PageMetadata;
}

export interface PublicPageOutput {
  assets: AssetGroup;
  document?: HtmlDocumentOutput;
  path?: string;
  routeId?: string;
  render?: RenderMode;
  metadata?: PageMetadata;
}

export interface HtmlDocumentOutput {
  fileName: string;
  aliases?: string[];
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
  /**
   * Effective browser activation policy. CSR `"load"` means mount; with
   * server- or build-rendered HTML it means hydrate.
   */
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
  cache?: PprCachePolicy;
}

export interface RuntimeModuleOutput {
  type: "entry" | "lifecycle" | "react-component";
  href?: string;
}

export interface RouteOutput {
  id: string;
  path: string;
  parentId?: string;
  kind?: PageRouteKind;
  appId?: string;
  pageId?: string;
}

export interface PublicRouteOutput {
  id: string;
  path: string;
  pageId?: string;
  render?: RenderMode;
  metadata?: PageMetadata;
}

/**
 * Canonical serializable deployment projection of public assets, Documents,
 * request routes, the server entry, and plugin-owned deployment metadata.
 */
export interface DeploymentMetadata {
  version: 1;
  buildId: string;
  paths: BuildOutputPaths;
  publicPath: PublicPathOutput;
  assets?: Record<string, AssetGroup>;
  documents: DeploymentDocumentOutput[];
  routes: DeploymentRouteOutput[];
  server: DeploymentServerOutput;
  metadata?: StaticJsonObject;
}

export type DeploymentDocumentOutput =
  | {
      kind: "app";
      id: string;
      fileName: string;
      aliases?: string[];
      fallback?: string;
      assets?: AssetGroup;
    }
  | {
      kind: "page";
      id: string;
      fileName: string;
      aliases?: string[];
      assets?: AssetGroup;
    };

export type DeploymentPageRenderOutput = RenderMode;
export type DeploymentServerPageRenderOutput = Extract<
  DeploymentPageRenderOutput,
  "ssr"
>;

export type DeploymentRouteOutput =
  | {
      kind: "static-page";
      path: string;
      pageId: string;
      documentId: string;
      render: Extract<DeploymentPageRenderOutput, "csr" | "ssg">;
      methods: ["GET", "HEAD"];
    }
  | {
      kind: "server-page";
      path: string;
      pageId: string;
      render: DeploymentServerPageRenderOutput;
      prerender?: "full" | "partial";
      rsc?: true;
      methods: ["GET", "HEAD"];
    }
  | {
      kind: "server-function";
      path: string;
      methods: ["POST"];
    }
  | {
      kind: "ppr-endpoint";
      path: string;
      methods: ["GET", "HEAD"];
    }
  | {
      kind: "rsc-endpoint";
      path: string;
      methods: ["GET", "HEAD"];
    }
  | {
      kind: "api-route";
      path: string;
      methods: string[];
    };

export interface DeploymentServerOutput {
  entry?: string;
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
  phase?: BuildEntryPhase;
  owner?: BuildEntryOwner;
  assets: AssetGroup;
}

export interface ServerFunctionOutput {
  assets: AssetGroup;
  exportName: string;
}

export interface ServerRouteOutput {
  path: string;
  methods: string[];
  assets: AssetGroup;
}

export interface RscOutput {
  pages?: Record<string, RscPageOutput>;
}

export interface RscPageOutput {
  renderer: string;
  assets: AssetGroup;
  routeId?: string;
}

export function assertFrameworkManifestShape(
  value: unknown,
  source: string,
  options?: FrameworkManifestValidationOptions & { server?: "required" },
): asserts value is BuildOutput;
export function assertFrameworkManifestShape(
  value: unknown,
  source: string,
  options: FrameworkManifestValidationOptions & { server: "optional" },
): asserts value is PublicManifestOutput;
export function assertFrameworkManifestShape(
  value: unknown,
  source: string,
  options?: FrameworkManifestValidationOptions,
): asserts value is BuildOutput | PublicManifestOutput;
export function assertFrameworkManifestShape(
  value: unknown,
  source: string,
  options: FrameworkManifestValidationOptions = {},
): asserts value is BuildOutput | PublicManifestOutput {
  const requireServer = options.server !== "optional";
  const requirePageRendererReferences =
    options.pageRendererReferences !== "optional";
  const requirePprRendererReferences =
    options.pprRendererReferences !== "optional";
  const requireRscRendererReferences =
    options.rscRendererReferences !== "optional";
  assertObject(value, source);
  if (!requireServer) {
    assertPublicManifestFields(value, source);
  }
  if (value.version !== 1) {
    throw new Error(`[evjs] ${source}.version must be 1.`);
  }
  assertManifestBuildId(value.buildId, `${source}.buildId`);
  if (value.paths === undefined) {
    if (requireServer) {
      throw new Error(`[evjs] ${source}.paths must be an object.`);
    }
  } else {
    assertBuildOutputPaths(value.paths, `${source}.paths`);
  }
  assertPublicPathOutput(value.publicPath, `${source}.publicPath`);
  if (value.runtime === undefined) {
    if (requireServer) {
      throw new Error(`[evjs] ${source}.runtime must be an object.`);
    }
  } else {
    assertObject(value.runtime, `${source}.runtime`);
  }
  if (value.assets !== undefined) {
    assertObject(value.assets, `${source}.assets`);
    assertAssetGroupRecord(value.assets, `${source}.assets`);
  }
  if (value.documents !== undefined) {
    if (requireServer) {
      throw new Error(
        `[evjs] ${source}.documents is only supported in public manifests.`,
      );
    }
    if (value.routing !== undefined) {
      throw new Error(
        `[evjs] ${source} must not define both documents and routing.`,
      );
    }
    if (value.assets !== undefined) {
      throw new Error(
        `[evjs] ${source}.assets must be omitted when documents are used.`,
      );
    }
    assertPublicDocumentOutputs(value.documents, `${source}.documents`);
  }
  const apps = assertManifestAppProjection(value, source, requireServer);
  const { pages, routes } = assertManifestRoutingProjection(
    value,
    source,
    requireServer,
    apps,
  );
  assertUniqueManifestDocumentOutputs(apps, pages, source);
  if (
    !requireServer &&
    value.assets !== undefined &&
    isRecord(value.routing) &&
    value.routing.kind === "mpa"
  ) {
    throw new Error(
      `[evjs] ${source}.assets must be omitted when routing.kind is "mpa".`,
    );
  }

  if (value.runtime !== undefined) {
    assertObject(value.runtime.server, `${source}.runtime.server`);
    assertManifestPathname(
      value.runtime.server.basePath,
      `${source}.runtime.server.basePath`,
      true,
    );
    assertConcreteRuntimePathSegments(
      value.runtime.server.basePath,
      `${source}.runtime.server.basePath`,
    );
    assertManifestEndpoint(
      value.runtime.server.fn,
      `${source}.runtime.server.fn`,
      true,
    );
    assertManifestEndpoint(
      value.runtime.server.ppr,
      `${source}.runtime.server.ppr`,
    );
    assertManifestEndpoint(
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
  }
  if (value.server === undefined) {
    if (requireServer) {
      throw new Error(`[evjs] ${source}.server must be an object.`);
    }
  } else {
    assertObject(value.server, `${source}.server`);
    if (value.server.entry !== undefined) {
      assertManifestString(value.server.entry, `${source}.server.entry`);
    }
    if (value.server.renderers !== undefined) {
      assertObject(value.server.renderers, `${source}.server.renderers`);
      assertServerRendererOutputs(
        value.server.renderers,
        `${source}.server.renderers`,
        pages,
        routes,
      );
    }
    assertAssetGroup(value.server.assets, `${source}.server.assets`);
    assertObject(value.server.functions, `${source}.server.functions`);
    assertServerFunctionOutputs(
      value.server.functions,
      `${source}.server.functions`,
    );
    if (!Array.isArray(value.server.routes)) {
      throw new Error(`[evjs] ${source}.server.routes must be an array.`);
    }
    assertServerRouteOutputs(value.server.routes, `${source}.server.routes`);
  }
  const serverRenderers = getServerRendererOutputs(value.server);
  assertPageServerRendererReferences(
    pages,
    getManifestPagesSource(value, source),
    serverRenderers,
    routes,
    requirePageRendererReferences,
  );
  assertPprPageOutputReferences(
    pages,
    getManifestPagesSource(value, source),
    serverRenderers,
    requirePprRendererReferences,
  );
  if (value.rsc !== undefined) {
    assertRscOutput(
      value.rsc,
      `${source}.rsc`,
      pages,
      serverRenderers,
      routes,
      requireRscRendererReferences,
    );
  }
  if (requireServer) {
    readOptionalStaticJsonObjectProperty(
      value,
      "deployment",
      `${source}.deployment`,
    );
    assertBuildOutputServerArtifacts(value as unknown as BuildOutput, source);
  }
}

export type GeneratedScope =
  | { kind: "application" }
  | { kind: "page"; pageId: string }
  | { kind: "server" };

export type FrameworkSlotName =
  | "client.entry"
  | "page.wrapper"
  | "server.request.middleware"
  | "html.tag"
  | "resolve.alias"
  | "resolve.external";

export type EntryContributionPosition =
  | "polyfill"
  | "before-main-imports"
  | "after-main-imports"
  | "before-main"
  | "after-main";

export type ContributionRuntime = "client" | "server" | "all";
export type ClientContributionRuntime = "client";

export type ContributionTarget =
  | { kind: "application"; applicationId?: string }
  | { kind: "page"; pageId: string };

export interface GeneratedFrameworkPlan {
  version: 1;
  rootDir: string;
  entriesDir: string;
  frameworkDir: string;
  pluginsDir: string;
  frameworkFiles: GeneratedFrameworkFilePlan[];
  modules: GeneratedModulePlan[];
  slots: FrameworkSlotPlanItem[];
  importEdges: GeneratedImportEdgePlan[];
  entries: GeneratedEntryPlan[];
  /** Stable digest of the CoreGraph snapshot exposed to contribution hooks. */
  coreGraphHash?: string;
}

export interface GeneratedFrameworkFilePlan {
  id: "core-graph" | "build-plan";
  file: string;
}

export interface GeneratedModulePlan {
  key: string;
  id: string;
  pluginId: string;
  scope: GeneratedScope;
  file: string;
  specifier: string;
  extension: string;
  /** Stable digest of the fully resolved generated module source. */
  sourceHash: string;
}

export interface GeneratedEntryPlan {
  name: string;
  file: string;
  originalImport: string;
  kind: BuildEntry["kind"];
  environment: BuildEnvironment;
}

export interface GeneratedImportEdgePlan {
  from: string;
  to: string;
  kind:
    | "module-import"
    | "slot-module"
    | "resolve-alias"
    | "plugin-import-helper";
  specifier: string;
}

export type FrameworkSlotPlanItem =
  | ClientEntrySlotPlanItem
  | PageWrapperSlotPlanItem
  | ServerRequestMiddlewareSlotPlanItem
  | HtmlTagSlotPlanItem
  | ResolveAliasSlotPlanItem
  | ResolveExternalSlotPlanItem;

interface FrameworkSlotPlanItemBase {
  key: string;
  id: string;
  pluginId: string;
}

export interface ClientEntrySlotPlanItem extends FrameworkSlotPlanItemBase {
  slot: "client.entry";
  module: string;
  position: EntryContributionPosition;
  runtime: ClientContributionRuntime;
  mode: "import" | "replace";
  target?: ContributionTarget;
}

export interface PageWrapperSlotPlanItem extends FrameworkSlotPlanItemBase {
  slot: "page.wrapper";
  module: string;
  runtime: ContributionRuntime;
  target?: ContributionTarget;
}

export interface ServerRequestMiddlewareSlotPlanItem
  extends FrameworkSlotPlanItemBase {
  slot: "server.request.middleware";
  module: string;
}

export type HtmlTagPlacement =
  | "head-prepend"
  | "head-append"
  | "body-prepend"
  | "body-append";

export type HtmlTagName = "meta" | "link" | "script" | "style";

export interface HtmlTagSlotPlanItem extends FrameworkSlotPlanItemBase {
  slot: "html.tag";
  tag: HtmlTagName;
  placement: HtmlTagPlacement;
  attrs?: Record<string, string | boolean>;
  children?: string;
  target?: ContributionTarget;
}

export interface ResolveAliasSlotPlanItem extends FrameworkSlotPlanItemBase {
  slot: "resolve.alias";
  specifier: string;
  replacement: string;
}

export interface ResolveExternalSlotPlanItem extends FrameworkSlotPlanItemBase {
  slot: "resolve.external";
  specifier: string;
  source?: string;
  runtime: ContributionRuntime;
}

function assertPublicDocumentOutputs(value: unknown, source: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`[evjs] ${source} must be an array.`);
  }
  const pathOwners = new Map<string, { path: string; source: string }>();
  const outputOwners = new Map<string, string>();
  for (const [index, document] of value.entries()) {
    const documentSource = `${source}[${index}]`;
    assertObject(document, documentSource);
    assertManifestString(document.id, `${documentSource}.id`);
    assertManifestPathname(document.path, `${documentSource}.path`, true);
    assertUniquePageRoutePath(
      document.path as string,
      `${documentSource}.path`,
      pathOwners,
    );
    assertHtmlDocumentOutput(document, documentSource);
    for (const output of [
      document.fileName,
      ...(Array.isArray(document.aliases) ? document.aliases : []),
    ]) {
      if (typeof output !== "string") continue;
      const previous = outputOwners.get(output);
      if (previous) {
        throw new Error(
          `[evjs] ${documentSource} static output "${output}" conflicts with ${previous}. Document filenames and aliases must be globally unique.`,
        );
      }
      outputOwners.set(output, documentSource);
    }
    assertStaticDocumentRenderMode(document.render, `${documentSource}.render`);
    if (document.assets !== undefined) {
      assertAssetGroup(document.assets, `${documentSource}.assets`);
    }
    if (document.metadata !== undefined) {
      assertPageMetadata(document.metadata, `${documentSource}.metadata`);
    }
  }
}

function assertStaticDocumentRenderMode(value: unknown, source: string): void {
  if (value === "csr" || value === "ssg") return;
  throw new Error(`[evjs] ${source} must be "csr" or "ssg".`);
}

function assertManifestRoutingProjection(
  value: Record<string, unknown>,
  source: string,
  requireBuildOutputRouting: boolean,
  apps: Record<string, unknown>,
): {
  pages: Record<string, unknown>;
  routes: Array<Record<string, unknown>>;
} {
  if (value.routing !== undefined) {
    if (value.pages !== undefined || value.routes !== undefined) {
      throw new Error(
        `[evjs] ${source} must not define both routing and pages/routes.`,
      );
    }
    assertObject(value.routing, `${source}.routing`);
    if (value.routing.kind === "spa") {
      if (!Array.isArray(value.routing.routes)) {
        throw new Error(`[evjs] ${source}.routing.routes must be an array.`);
      }
      const pages = createPagesFromPublicManifestRoutes(value.routing.routes);
      assertRouteOutputs(
        value.routing.routes,
        `${source}.routing.routes`,
        pages,
        apps,
      );
      return {
        pages,
        routes: value.routing.routes as Array<Record<string, unknown>>,
      };
    }
    if (value.routing.kind === "mpa") {
      assertObject(value.routing.pages, `${source}.routing.pages`);
      assertPublicPageOutputs(value.routing.pages, `${source}.routing.pages`);
      const routes = createRoutesFromManifestPages(value.routing.pages);
      assertRouteOutputs(
        routes,
        `${source}.routing.pages`,
        value.routing.pages,
        apps,
      );
      return { pages: value.routing.pages, routes };
    }
    throw new Error(`[evjs] ${source}.routing.kind must be "spa" or "mpa".`);
  }

  if (value.pages === undefined && value.routes === undefined) {
    if (requireBuildOutputRouting) {
      throw new Error(`[evjs] ${source}.pages must be an object.`);
    }
    if (value.documents === undefined) {
      throw new Error(
        `[evjs] ${source} must define either routing or documents.`,
      );
    }
    return { pages: {}, routes: [] };
  }

  assertObject(value.pages, `${source}.pages`);
  assertPageOutputs(value.pages, `${source}.pages`);
  if (!Array.isArray(value.routes)) {
    throw new Error(`[evjs] ${source}.routes must be an array.`);
  }
  assertRouteOutputs(value.routes, `${source}.routes`, value.pages, apps);
  return { pages: value.pages, routes: value.routes };
}

function assertPublicManifestFields(
  value: Record<string, unknown>,
  source: string,
): void {
  const supported = new Set([
    "version",
    "buildId",
    "publicPath",
    "assets",
    "routing",
    "documents",
  ]);
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field !== "string") {
      throw new Error(`[evjs] ${source} contains an unsupported symbol field.`);
    }
    if (!supported.has(field)) {
      throw new Error(
        `[evjs] ${source}.${field} is not supported in public manifests.`,
      );
    }
  }
}

function createRoutesFromManifestPages(
  pages: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return Object.entries(pages).flatMap(([pageId, page]) => {
    if (!isRecord(page)) return [];
    if (typeof page.path !== "string" || typeof page.routeId !== "string") {
      return [];
    }
    return [
      {
        id: page.routeId,
        path: page.path,
        pageId,
        render: page.render,
        metadata: page.metadata,
      },
    ];
  });
}

function createPagesFromPublicManifestRoutes(
  routes: unknown[],
): Record<string, unknown> {
  return Object.fromEntries(
    routes.flatMap((route) => {
      if (!isRecord(route) || typeof route.pageId !== "string") return [];
      return [
        [
          route.pageId,
          {
            ...(route.render === undefined ? {} : { render: route.render }),
            ...(route.metadata === undefined
              ? {}
              : { metadata: route.metadata }),
          },
        ],
      ];
    }),
  );
}

function getManifestPagesSource(
  value: Record<string, unknown>,
  source: string,
): string {
  return value.routing !== undefined
    ? `${source}.routing.pages`
    : `${source}.pages`;
}

function assertManifestAppProjection(
  value: Record<string, unknown>,
  source: string,
  requireApps: boolean,
): Record<string, unknown> {
  if (value.app !== undefined && value.apps !== undefined) {
    throw new Error(`[evjs] ${source} must not define both app and apps.`);
  }
  if (value.apps !== undefined) {
    assertObject(value.apps, `${source}.apps`);
    assertAppOutputs(value.apps, `${source}.apps`);
    return value.apps;
  }
  if (value.app !== undefined) {
    assertAppOutput(value.app, `${source}.app`);
    return { app: value.app };
  }
  if (requireApps) {
    throw new Error(`[evjs] ${source}.apps must be an object.`);
  }
  return {};
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
    if (output.phase !== undefined) {
      assertBuildEntryPhase(output.phase, `${source}.${name}.phase`);
    }
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

function assertBuildEntryPhase(value: unknown, source: string): void {
  if (value === "runtime" || value === "build") return;
  throw new Error(`[evjs] ${source} must be "runtime" or "build".`);
}

function assertServerFunctionOutputs(
  value: Record<string, unknown>,
  source: string,
): void {
  for (const [name, output] of Object.entries(value)) {
    assertManifestServerFunctionIdKey(name, source);
    assertObject(output, `${source}.${name}`);
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
    assertAppOutput(output, `${source}.${name}`);
  }
}

function assertAppOutput(value: unknown, source: string): void {
  assertObject(value, source);
  assertAssetGroup(value.assets, `${source}.assets`);
  assertHtmlDocumentOutput(value.document, `${source}.document`);
  assertRuntimeModuleOutput(value.module, `${source}.module`);
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
    if (output.metadata !== undefined) {
      assertPageMetadata(output.metadata, `${source}.${name}.metadata`);
    }
    assertPageRenderingOutput(output.rendering, `${source}.${name}.rendering`);
    assertPprPageOutputContract(output, `${source}.${name}`);
    assertRscPageOutputContract(output, `${source}.${name}`);
  }
}

function assertPublicPageOutputs(
  value: Record<string, unknown>,
  source: string,
): void {
  for (const [name, output] of Object.entries(value)) {
    assertManifestBuildIdentifierKey(name, source);
    assertObject(output, `${source}.${name}`);
    assertAssetGroup(output.assets, `${source}.${name}.assets`);
    assertHtmlDocumentOutput(output.document, `${source}.${name}.document`);
    assertManifestPathname(output.path, `${source}.${name}.path`);
    if (output.routeId !== undefined) {
      assertManifestString(output.routeId, `${source}.${name}.routeId`);
    }
    if (output.render !== undefined) {
      assertRenderMode(output.render, `${source}.${name}.render`);
    }
    if (output.metadata !== undefined) {
      assertPageMetadata(output.metadata, `${source}.${name}.metadata`);
    }
  }
}

function assertHtmlDocumentOutput(value: unknown, source: string): void {
  if (value === undefined) return;
  assertObject(value, source);
  assertHtmlOutputPath(value.fileName, `${source}.fileName`);
  const fileName = value.fileName as string;
  if (value.aliases === undefined) return;
  if (!Array.isArray(value.aliases)) {
    throw new Error(`[evjs] ${source}.aliases must be an array.`);
  }
  const seen = new Set<string>();
  for (const [index, alias] of value.aliases.entries()) {
    assertHtmlOutputPath(alias, `${source}.aliases[${index}]`);
    if (alias === fileName) {
      throw new Error(
        `[evjs] ${source}.aliases[${index}] must differ from fileName "${fileName}".`,
      );
    }
    if (seen.has(alias as string)) {
      throw new Error(
        `[evjs] ${source}.aliases[${index}] duplicates alias "${alias}".`,
      );
    }
    seen.add(alias as string);
  }
}

function assertHtmlOutputPath(value: unknown, source: string): void {
  assertManifestString(value, source);
  const fileName = value as string;
  if (
    fileName.trim() !== fileName ||
    fileName.startsWith("/") ||
    /^[A-Za-z]:\//.test(fileName) ||
    fileName.includes("\\") ||
    fileName.includes("?") ||
    fileName.includes("#") ||
    fileName.endsWith("/") ||
    fileName
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(
      `[evjs] ${source} must be a normalized relative output file path.`,
    );
  }
  if (!/\.html?$/i.test(fileName)) {
    throw new Error(
      `[evjs] ${source} must end with ".html" or ".htm" because a Document output contains HTML.`,
    );
  }
}

function assertUniqueManifestDocumentOutputs(
  apps: Record<string, unknown>,
  pages: Record<string, unknown>,
  source: string,
): void {
  const outputs = new Map<string, string>();
  const visit = (owner: string, value: unknown): void => {
    if (!isRecord(value) || !isRecord(value.document)) return;
    const document = value.document;
    const candidates = [
      document.fileName,
      ...(Array.isArray(document.aliases) ? document.aliases : []),
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const previous = outputs.get(candidate);
      if (previous) {
        throw new Error(
          `[evjs] ${source} static Document output "${candidate}" is owned by both ${previous} and ${owner}. Document filenames and aliases must be globally unique.`,
        );
      }
      outputs.set(candidate, owner);
    }
  };
  for (const [id, app] of Object.entries(apps)) {
    visit(`Application "${id}"`, app);
  }
  for (const [id, page] of Object.entries(pages)) {
    visit(`Page "${id}"`, page);
  }
}

function assertRuntimeModuleOutput(value: unknown, source: string): void {
  if (value === undefined) return;
  assertObject(value, source);
  assertRuntimeModuleType(value.type, `${source}.type`);
  assertManifestString(value.href, `${source}.href`);
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
  if (value === "none" || value === "load") return;
  throw new Error(`[evjs] ${source} must be "none" or "load".`);
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
    if (route.render !== undefined) {
      assertRenderMode(route.render, `${routeSource}.render`);
    }
    if (route.metadata !== undefined) {
      assertPageMetadata(route.metadata, `${routeSource}.metadata`);
    }
    assertOptionalRecordReference(
      route.appId,
      `${routeSource}.appId`,
      "apps",
      apps,
    );
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
  if (
    route.render !== undefined &&
    page.render !== undefined &&
    route.render !== page.render
  ) {
    throw new Error(
      `[evjs] ${routeSource}.render "${route.render as string}" must match manifest.pages.${route.pageId as string}.render "${page.render as string}".`,
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
  if (error.error === "star-wildcard") {
    return 'uses "*" as a wildcard segment. Use "$" for page route splats.';
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
    if (region.cache !== undefined) {
      assertPprRegionCache(region.cache, `${source}.regions.${name}.cache`);
    }
    if (region.hydrate !== undefined) {
      throw new Error(
        `[evjs] ${source}.regions.${name}.hydrate is not supported for PPR regions. Use an explicit client island instead.`,
      );
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

function assertManifestEndpoint(
  value: unknown,
  source: string,
  required = false,
): void {
  if (value === undefined) {
    if (required) {
      throw new Error(`[evjs] ${source} must be a non-empty endpoint.`);
    }
    return;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`[evjs] ${source} must be a non-empty endpoint.`);
  }
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${source} must not contain leading or trailing whitespace.`,
    );
  }
  if (value.startsWith("/")) {
    throw new Error(`[evjs] ${source} must not start with "/".`);
  }

  const error = getPathPatternValidationError(`/${value}`);
  if (error) {
    throw new Error(`[evjs] ${source} ${formatManifestPathnameError(error)}`);
  }
  const segmentError = getConcreteRuntimePathSegmentValidationError(value);
  if (segmentError) {
    throw new Error(
      `[evjs] ${source} ${formatConcreteRuntimePathSegmentValidationError(segmentError)}`,
    );
  }
}

function assertConcreteRuntimePathSegments(
  value: unknown,
  source: string,
): void {
  if (typeof value !== "string") return;
  const segmentError = getConcreteRuntimePathSegmentValidationError(value);
  if (segmentError) {
    throw new Error(
      `[evjs] ${source} ${formatConcreteRuntimePathSegmentValidationError(segmentError)}`,
    );
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

export type {
  StaticJsonObject,
  StaticJsonValue,
} from "../_internal/static-json.js";
export {
  assertPortableRelativeArtifactPath,
  assertPortableRelativeBrowserArtifactPath,
  canonicalPortableArtifactPathKey,
  portableArtifactPathsConflict,
} from "./artifact-path.js";
export {
  type ApplicationId,
  assertCoreGraph,
  assertPluginId,
  CONFIG_ROUTE_PROVIDER_ID,
  type CoreApplicationNode,
  type CoreApplicationPluginSetting,
  type CoreApplicationPluginSettings,
  type CoreClientRouteNode,
  type CoreClientRouteTarget,
  type CoreDocumentBootstrap,
  type CoreDocumentNode,
  type CoreDocumentOwner,
  type CoreGraph,
  type CoreNodeProvenance,
  type CorePageNode,
  type CorePagePluginSetting,
  type CorePagePluginSettings,
  type CorePageScope,
  type CorePageSource,
  type CorePluginApplicationContractSnapshot,
  type CorePluginCatalogEntrySnapshot,
  type CorePluginCatalogSnapshot,
  type CorePluginPageContractSnapshot,
  type CoreProvenanceProducer,
  type CoreRouteFacets,
  type CoreRouteLocation,
  type CoreRouteNode,
  type CoreRoutePattern,
  type CoreRouteSegment,
  type DocumentId,
  PAGE_ANCHOR_PROVIDER_ID,
  type PageId,
  type RouteId,
  resolveCorePageOwner,
} from "./core-graph.js";
export {
  coreRoutePatternShape,
  coreRoutePatternsEqual,
  isCoreRoutePatternPrefix,
} from "./core-route-pattern.js";
export {
  assertBuildOutputLinkInputClientAssets,
  type BuildOutputLinkInput,
  createDeploymentMetadata,
  createPublicManifest,
  createServerManifest,
  type DeploymentMetadataOptions,
  linkBuildOutput,
  type ServerManifestOutput,
  type ServerManifestRouteOutput,
} from "./linker.js";
export {
  assertPageMetadata,
  clonePageMetadata,
  type PageMetadata,
} from "./page-metadata.js";
export {
  assertBuildOutputServerArtifacts,
  assertServerRelativeArtifactPath,
  collectBuildOutputServerJavaScriptArtifacts,
} from "./server-artifacts.js";
