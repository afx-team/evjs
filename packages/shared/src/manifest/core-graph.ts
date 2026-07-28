import { assertStaticJsonValue } from "../_internal/static-json.js";
import {
  BUILD_IDENTIFIER_DESCRIPTION,
  isBuildIdentifier,
} from "../build-identifier.js";
import { HTTP_METHOD_LIST_DESCRIPTION, isHttpMethod } from "../http.js";
import { getPageRouteParamNameValidationError } from "../page-route-data.js";
import {
  getPathPatternValidationError,
  type PathPatternValidationError,
} from "../path-pattern.js";
import { isDotRouteSegment } from "../route-segment.js";
import {
  getServerRouteParamSegmentValidationError,
  type ServerRouteParamSegmentValidationError,
  serverRoutePathShapeFromPath,
} from "../server-route-data.js";
import {
  coreRoutePatternShape,
  isCoreRoutePatternPrefix,
} from "./core-route-pattern.js";
import type {
  ClientReferenceNode,
  ComponentModel,
  HydrationMode,
  PprConfig,
  PrerenderConfig,
  RenderMode,
  ServerFunctionNode,
  ServerReferenceNode,
  ServerRouteNode,
} from "./index.js";
import { assertPageMetadata, type PageMetadata } from "./page-metadata.js";

/** Built-in source provider for materialization-neutral positive `page.*` anchors. */
export const PAGE_ANCHOR_PROVIDER_ID = "@evjs/provider/page-anchor";

/** Built-in source provider for explicit SPA route-tree input. */
export const CONFIG_ROUTE_PROVIDER_ID = "@evjs/provider/config-route";

export type ApplicationId = string;
export type PageId = string;
export type RouteId = string;
export type DocumentId = string;

export interface CoreGraph {
  rootDir: string;
  applications: Record<ApplicationId, CoreApplicationNode>;
  pages: Record<PageId, CorePageNode>;
  routes: CoreRouteNode[];
  documents: Record<DocumentId, CoreDocumentNode>;
  extensions: CoreExtensionRegistrySnapshot;
  serverFunctions: ServerFunctionNode[];
  serverRoutes: ServerRouteNode[];
  clientReferences?: ClientReferenceNode[];
  serverReferences?: ServerReferenceNode[];
}

export interface CoreApplicationNode {
  id: ApplicationId;
  root: string;
  routingMode: "spa" | "mpa";
  /** Application-level React layout shared by its Page routes. */
  layout?: string;
  pageIds: PageId[];
  routeIds: RouteId[];
  documentIds: DocumentId[];
  extensions: CoreExtensionBag;
  provenance: CoreNodeProvenance;
}

export interface CorePageNode {
  id: PageId;
  applicationId: ApplicationId;
  source: CorePageSource;
  render: RenderMode;
  componentModel?: ComponentModel;
  hydrate?: HydrationMode;
  prerender?: PrerenderConfig;
  ppr?: PprConfig;
  metadata?: PageMetadata;
  extensions: CoreExtensionBag;
  provenance: CoreNodeProvenance;
}

export interface CorePageSource {
  module: string;
  /** Build-only canonical Page config module, when one was authored. */
  config?: string;
  scope: CorePageScope;
  provider: string;
}

export type CorePageScope =
  | { kind: "module"; file: string }
  | { kind: "directory"; root: string };

export type CoreRouteNode = CoreClientRouteNode;

export interface CoreClientRouteNode {
  id: RouteId;
  applicationId: ApplicationId;
  parentId?: RouteId;
  pattern: CoreRoutePattern;
  target: CoreClientRouteTarget;
  facets: CoreRouteFacets;
  extensions: CoreExtensionBag;
  provenance: CoreNodeProvenance;
}

export interface CoreRoutePattern {
  /** Root is represented by an empty segment list. */
  segments: CoreRouteSegment[];
}

export type CoreRouteSegment =
  | { kind: "static"; value: string }
  | { kind: "param"; name: string }
  | { kind: "splat"; name: string };

export type CoreClientRouteTarget =
  | { kind: "page"; pageId: PageId }
  | { kind: "redirect"; to: CoreRouteLocation }
  | { kind: "group" };

export type CoreRouteLocation =
  | { kind: "route"; pattern: CoreRoutePattern }
  | { kind: "url"; href: string };

export interface CoreRouteFacets {
  layout?: string | false;
  error?: string;
  notFound?: string;
  wrappers: string[];
}

export interface CoreDocumentNode {
  id: DocumentId;
  template: string;
  output: string;
  /**
   * Additional static output paths that contain the same transformed Document.
   *
   * Aliases do not create Routes or additional semantic Documents.
   */
  aliases?: string[];
  applicationId: ApplicationId;
  owner: CoreDocumentOwner;
  mount?: string;
  bootstrap?: CoreDocumentBootstrap;
  extensions: CoreExtensionBag;
  provenance: CoreNodeProvenance;
}

export type CoreDocumentOwner =
  | { kind: "application" }
  | { kind: "page"; pageId: PageId }
  | { kind: "extension"; extensionId: string };

export type CoreDocumentBootstrap =
  | { kind: "application" }
  | { kind: "page"; pageId: PageId };

export type CoreExtensionBag = Record<string, unknown>;

export interface CoreExtensionRegistrySnapshot {
  namespaces: Record<string, CoreExtensionNamespaceSnapshot>;
}

export interface CoreExtensionNamespaceSnapshot {
  producer: string;
  owners: CoreExtensionOwnerKind[];
  schemaVersion?: string;
}

export type CoreExtensionOwnerKind =
  | "application"
  | "page"
  | "route"
  | "document";

export interface CoreNodeProvenance {
  producer: CoreProvenanceProducer;
  source?: string;
}

export interface CoreProvenanceProducer {
  kind: "core" | "provider" | "plugin";
  id: string;
}

/**
 * Resolve the Page whose declared source scope owns a project-local module.
 *
 * Exact module scopes win over directory scopes. Directory ownership uses the
 * deepest matching root so a nested Page can carve its directory out of a
 * parent Page scope. Application layouts and Route facet modules are
 * deliberately outside Page source ownership even when they are colocated
 * below a Page directory.
 */
export function resolveCorePageOwner(
  graph: CoreGraph,
  sourcePath: string,
): CorePageNode | undefined {
  if (collectNonPageOwnedModules(graph).has(sourcePath)) return undefined;

  for (const page of Object.values(graph.pages)) {
    if (
      page.source.scope.kind === "module" &&
      page.source.scope.file === sourcePath
    ) {
      return page;
    }
  }

  let owner: CorePageNode | undefined;
  let ownerDepth = -1;
  for (const page of Object.values(graph.pages)) {
    if (page.source.scope.kind !== "directory") continue;
    const root = page.source.scope.root;
    if (!isPathWithinDirectory(sourcePath, root)) continue;
    const depth = getProjectPathDepth(root);
    if (depth > ownerDepth) {
      owner = page;
      ownerDepth = depth;
    }
  }
  return owner;
}

/**
 * Validate the normalized CoreGraph, including all ownership references and
 * the inverse indexes stored on each Application.
 */
export function assertCoreGraph(
  value: unknown,
  source = "CoreGraph",
): asserts value is CoreGraph {
  const graph = assertObjectShape(
    value,
    source,
    [
      "rootDir",
      "applications",
      "pages",
      "routes",
      "documents",
      "extensions",
      "serverFunctions",
      "serverRoutes",
    ],
    ["clientReferences", "serverReferences"],
  );
  assertNonEmptyString(graph.rootDir, `${source}.rootDir`);

  const applications = assertRecord(
    graph.applications,
    `${source}.applications`,
  );
  const pages = assertRecord(graph.pages, `${source}.pages`);
  const documents = assertRecord(graph.documents, `${source}.documents`);
  assertStrictArray(graph.routes, `${source}.routes`);
  assertStrictArray(graph.serverFunctions, `${source}.serverFunctions`);
  assertStrictArray(graph.serverRoutes, `${source}.serverRoutes`);
  if (graph.clientReferences !== undefined) {
    assertStrictArray(graph.clientReferences, `${source}.clientReferences`);
  }
  if (graph.serverReferences !== undefined) {
    assertStrictArray(graph.serverReferences, `${source}.serverReferences`);
  }
  assertExtensionRegistry(graph.extensions, `${source}.extensions`);
  assertServerFunctionNodes(graph.serverFunctions, `${source}.serverFunctions`);
  assertServerRouteNodes(graph.serverRoutes, `${source}.serverRoutes`);
  if (graph.clientReferences !== undefined) {
    assertReferenceNodes(graph.clientReferences, `${source}.clientReferences`);
  }
  if (graph.serverReferences !== undefined) {
    assertReferenceNodes(graph.serverReferences, `${source}.serverReferences`);
  }

  for (const [id, application] of Object.entries(applications)) {
    assertApplicationNode(application, id, `${source}.applications.${id}`);
  }
  for (const [id, page] of Object.entries(pages)) {
    assertPageNode(page, id, `${source}.pages.${id}`);
  }
  for (const [id, document] of Object.entries(documents)) {
    assertDocumentNode(document, id, `${source}.documents.${id}`);
  }

  const routesById = new Map<string, Record<string, unknown>>();
  for (const [index, route] of graph.routes.entries()) {
    const routeSource = `${source}.routes[${index}]`;
    const node = assertRouteNode(route, routeSource);
    const id = node.id as string;
    if (routesById.has(id)) {
      throw new Error(`[evjs] ${routeSource}.id "${id}" must be unique.`);
    }
    routesById.set(id, node);
  }

  assertExtensionRegistrations(
    graph as unknown as CoreGraph,
    `${source}.extensions.namespaces`,
  );

  assertUniqueDocumentOutputs(documents, source);
  assertApplicationIndexes(applications, pages, routesById, documents, source);
  assertPageOwnership(graph as unknown as CoreGraph, applications, source);
  assertUniqueTerminalRoutePatterns(
    graph.routes as Array<Record<string, unknown>>,
    source,
  );
  assertRouteOwnership(
    graph.routes as Array<Record<string, unknown>>,
    routesById,
    applications,
    pages,
    source,
  );
  assertDocumentOwnership(documents, applications, pages, source);
  assertClientRouteParentCycles(routesById, source);
}

function assertExtensionRegistrations(graph: CoreGraph, source: string): void {
  const namespaces = graph.extensions.namespaces;
  for (const [applicationId, application] of Object.entries(
    graph.applications,
  )) {
    assertExtensionBagOwners(
      application.extensions,
      "application",
      `${source} for Application "${applicationId}"`,
      namespaces,
    );
  }
  for (const [pageId, page] of Object.entries(graph.pages)) {
    assertExtensionBagOwners(
      page.extensions,
      "page",
      `${source} for Page "${pageId}"`,
      namespaces,
    );
  }
  for (const route of graph.routes) {
    assertExtensionBagOwners(
      route.extensions,
      "route",
      `${source} for Route "${route.id}"`,
      namespaces,
    );
  }
  for (const [documentId, document] of Object.entries(graph.documents)) {
    assertExtensionBagOwners(
      document.extensions,
      "document",
      `${source} for Document "${documentId}"`,
      namespaces,
    );
  }
}

function assertExtensionBagOwners(
  bag: CoreExtensionBag,
  owner: CoreExtensionOwnerKind,
  source: string,
  namespaces: Record<string, CoreExtensionNamespaceSnapshot>,
): void {
  for (const namespace of Object.keys(bag)) {
    const definition = getOwn(namespaces, namespace) as
      | CoreExtensionNamespaceSnapshot
      | undefined;
    if (!definition) {
      throw new Error(
        `[evjs] ${source} uses unregistered extension namespace "${namespace}".`,
      );
    }
    if (!definition.owners.includes(owner)) {
      throw new Error(
        `[evjs] ${source} uses extension namespace "${namespace}" which does not allow owner "${owner}".`,
      );
    }
  }
}

function assertApplicationNode(
  value: unknown,
  id: string,
  source: string,
): void {
  const application = assertObjectShape(
    value,
    source,
    [
      "id",
      "root",
      "routingMode",
      "pageIds",
      "routeIds",
      "documentIds",
      "extensions",
      "provenance",
    ],
    ["layout"],
  );
  assertNodeId(application.id, id, `${source}.id`);
  assertProjectPath(application.root, `${source}.root`, { allowRoot: true });
  if (application.routingMode !== "spa" && application.routingMode !== "mpa") {
    throw new Error(`[evjs] ${source}.routingMode must be "spa" or "mpa".`);
  }
  if (application.layout !== undefined) {
    assertProjectPath(application.layout, `${source}.layout`);
  }
  assertIdentifierList(application.pageIds, `${source}.pageIds`);
  assertIdentifierList(application.routeIds, `${source}.routeIds`);
  assertIdentifierList(application.documentIds, `${source}.documentIds`);
  assertExtensionBag(application.extensions, `${source}.extensions`);
  assertProvenance(application.provenance, `${source}.provenance`);
}

function assertPageNode(value: unknown, id: string, source: string): void {
  const page = assertObjectShape(
    value,
    source,
    ["id", "applicationId", "source", "render", "extensions", "provenance"],
    ["componentModel", "hydrate", "prerender", "ppr", "metadata"],
  );
  assertNodeId(page.id, id, `${source}.id`);
  assertNonEmptyString(page.applicationId, `${source}.applicationId`);
  if (page.render !== "csr" && page.render !== "ssr" && page.render !== "ssg") {
    throw new Error(`[evjs] ${source}.render must be "csr", "ssr", or "ssg".`);
  }
  if (
    page.componentModel !== undefined &&
    page.componentModel !== "client" &&
    page.componentModel !== "rsc"
  ) {
    throw new Error(
      `[evjs] ${source}.componentModel must be "client" or "rsc".`,
    );
  }
  if (page.metadata !== undefined) {
    assertPageMetadata(page.metadata, `${source}.metadata`);
  }
  if (
    page.hydrate !== undefined &&
    page.hydrate !== "none" &&
    page.hydrate !== "load"
  ) {
    throw new Error(`[evjs] ${source}.hydrate must be "none" or "load".`);
  }
  const prerender = getOwn(page, "prerender");
  if (prerender !== undefined) {
    assertPrerenderConfig(prerender, `${source}.prerender`);
  }
  const ppr = getOwn(page, "ppr");
  if (ppr !== undefined) {
    assertPprConfig(ppr, `${source}.ppr`);
  }
  const pageSource = assertObjectShape(
    page.source,
    `${source}.source`,
    ["module", "scope", "provider"],
    ["config"],
  );
  assertProjectPath(pageSource.module, `${source}.source.module`);
  if (pageSource.config !== undefined) {
    assertProjectPath(pageSource.config, `${source}.source.config`);
  }
  assertNonEmptyString(pageSource.provider, `${source}.source.provider`);
  assertPageScope(pageSource.scope, `${source}.source.scope`);
  const scope = pageSource.scope as unknown as CorePageScope;
  if (scope.kind === "module" && scope.file !== pageSource.module) {
    throw new Error(
      `[evjs] ${source}.source.scope.file must equal ${source}.source.module for a module scope.`,
    );
  }
  if (
    scope.kind === "directory" &&
    !isPathWithinDirectory(pageSource.module as string, scope.root)
  ) {
    throw new Error(
      `[evjs] ${source}.source.module must be lexically contained by ${source}.source.scope.root.`,
    );
  }
  assertExtensionBag(page.extensions, `${source}.extensions`);
  const provenance = assertProvenance(page.provenance, `${source}.provenance`);
  const producer = provenance.producer as Record<string, unknown>;
  if (producer.kind !== "provider" || producer.id !== pageSource.provider) {
    throw new Error(
      `[evjs] ${source}.provenance producer must be provider "${pageSource.provider}".`,
    );
  }
}

function assertPageScope(value: unknown, source: string): void {
  const scope = assertRecord(value, source);
  if (scope.kind === "module") {
    assertObjectKeys(scope, source, ["kind", "file"]);
    assertProjectPath(scope.file, `${source}.file`);
    return;
  }
  if (scope.kind === "directory") {
    assertObjectKeys(scope, source, ["kind", "root"]);
    assertProjectPath(scope.root, `${source}.root`, { allowRoot: true });
    return;
  }
  throw new Error(`[evjs] ${source}.kind must be "module" or "directory".`);
}

function assertRouteNode(
  value: unknown,
  source: string,
): Record<string, unknown> {
  const route = assertRecord(value, source);
  assertObjectKeys(
    route,
    source,
    [
      "id",
      "applicationId",
      "pattern",
      "target",
      "facets",
      "extensions",
      "provenance",
    ],
    ["parentId"],
  );
  assertNonEmptyString(route.id, `${source}.id`);
  assertNonEmptyString(route.applicationId, `${source}.applicationId`);
  assertRoutePattern(route.pattern, `${source}.pattern`);
  assertExtensionBag(route.extensions, `${source}.extensions`);
  assertProvenance(route.provenance, `${source}.provenance`);

  const parentId = getOwn(route, "parentId");
  if (parentId !== undefined) {
    assertNonEmptyString(parentId, `${source}.parentId`);
  }
  assertClientRouteTarget(route.target, `${source}.target`);
  assertRouteFacets(route.facets, `${source}.facets`);
  return route;
}

function assertRoutePattern(value: unknown, source: string): void {
  const pattern = assertObjectShape(value, source, ["segments"]);
  assertStrictArray(pattern.segments, `${source}.segments`);
  const names = new Set<string>();
  for (const [index, valueSegment] of pattern.segments.entries()) {
    const segmentSource = `${source}.segments[${index}]`;
    const segment = assertRecord(valueSegment, segmentSource);
    if (segment.kind === "static") {
      assertObjectKeys(segment, segmentSource, ["kind", "value"]);
      assertStaticRouteSegment(segment.value, `${segmentSource}.value`);
      continue;
    }
    if (segment.kind !== "param" && segment.kind !== "splat") {
      throw new Error(
        `[evjs] ${segmentSource}.kind must be "static", "param", or "splat".`,
      );
    }
    assertObjectKeys(segment, segmentSource, ["kind", "name"]);
    if (segment.kind === "param") {
      assertRouteParamName(segment.name, `${segmentSource}.name`);
    } else if (segment.name !== "_splat") {
      throw new Error(
        `[evjs] ${segmentSource}.name must be "_splat" for a splat segment.`,
      );
    }
    const name = segment.name as string;
    if (names.has(name)) {
      throw new Error(
        `[evjs] ${segmentSource}.name "${name}" must be unique within one route pattern.`,
      );
    }
    names.add(name);
    if (segment.kind === "splat" && index !== pattern.segments.length - 1) {
      throw new Error(`[evjs] ${segmentSource} splat must be terminal.`);
    }
  }
}

function assertClientRouteTarget(value: unknown, source: string): void {
  const target = assertRecord(value, source);
  if (target.kind === "page") {
    assertObjectKeys(target, source, ["kind", "pageId"]);
    assertNonEmptyString(target.pageId, `${source}.pageId`);
    return;
  }
  if (target.kind === "redirect") {
    assertObjectKeys(target, source, ["kind", "to"]);
    assertRouteLocation(target.to, `${source}.to`);
    return;
  }
  if (target.kind === "group") {
    assertObjectKeys(target, source, ["kind"]);
    return;
  }
  throw new Error(
    `[evjs] ${source}.kind must be "page", "redirect", or "group".`,
  );
}

function assertRouteLocation(value: unknown, source: string): void {
  const location = assertRecord(value, source);
  if (location.kind === "route") {
    assertObjectKeys(location, source, ["kind", "pattern"]);
    assertRoutePattern(location.pattern, `${source}.pattern`);
    return;
  }
  if (location.kind === "url") {
    assertObjectKeys(location, source, ["kind", "href"]);
    assertNonEmptyString(location.href, `${source}.href`);
    return;
  }
  throw new Error(`[evjs] ${source}.kind must be "route" or "url".`);
}

function assertRouteFacets(value: unknown, source: string): void {
  const facets = assertObjectShape(
    value,
    source,
    ["wrappers"],
    ["layout", "error", "notFound"],
  );
  const layout = getOwn(facets, "layout");
  if (layout !== undefined && layout !== false) {
    assertProjectPath(layout, `${source}.layout`);
  }
  const error = getOwn(facets, "error");
  if (error !== undefined) {
    assertProjectPath(error, `${source}.error`);
  }
  const notFound = getOwn(facets, "notFound");
  if (notFound !== undefined) {
    assertProjectPath(notFound, `${source}.notFound`);
  }
  assertStrictArray(facets.wrappers, `${source}.wrappers`);
  for (const [index, wrapper] of facets.wrappers.entries()) {
    assertProjectPath(wrapper, `${source}.wrappers[${index}]`);
  }
}

function assertDocumentNode(value: unknown, id: string, source: string): void {
  const document = assertObjectShape(
    value,
    source,
    [
      "id",
      "template",
      "output",
      "applicationId",
      "owner",
      "extensions",
      "provenance",
    ],
    ["aliases", "mount", "bootstrap"],
  );
  assertNodeId(document.id, id, `${source}.id`);
  assertProjectPath(document.template, `${source}.template`);
  assertDocumentOutputPath(document.output, `${source}.output`);
  const aliases = getOwn(document, "aliases");
  if (aliases !== undefined) {
    assertStrictArray(aliases, `${source}.aliases`);
    const seen = new Set<string>();
    for (const [index, alias] of aliases.entries()) {
      assertDocumentOutputPath(alias, `${source}.aliases[${index}]`);
      if (alias === document.output) {
        throw new Error(
          `[evjs] ${source}.aliases[${index}] must differ from the canonical output "${document.output}".`,
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
  assertNonEmptyString(document.applicationId, `${source}.applicationId`);
  assertDocumentOwner(document.owner, `${source}.owner`);
  const mount = getOwn(document, "mount");
  if (mount !== undefined) {
    assertNonEmptyString(mount, `${source}.mount`);
  }
  const bootstrap = getOwn(document, "bootstrap");
  if (bootstrap !== undefined) {
    assertDocumentBootstrap(bootstrap, `${source}.bootstrap`);
  }
  assertExtensionBag(document.extensions, `${source}.extensions`);
  assertProvenance(document.provenance, `${source}.provenance`);
}

function assertDocumentOwner(value: unknown, source: string): void {
  const owner = assertRecord(value, source);
  if (owner.kind === "application") {
    assertObjectKeys(owner, source, ["kind"]);
    return;
  }
  if (owner.kind === "page") {
    assertObjectKeys(owner, source, ["kind", "pageId"]);
    assertNonEmptyString(owner.pageId, `${source}.pageId`);
    return;
  }
  if (owner.kind === "extension") {
    assertObjectKeys(owner, source, ["kind", "extensionId"]);
    assertNonEmptyString(owner.extensionId, `${source}.extensionId`);
    return;
  }
  throw new Error(
    `[evjs] ${source}.kind must be "application", "page", or "extension".`,
  );
}

function assertDocumentBootstrap(value: unknown, source: string): void {
  const bootstrap = assertRecord(value, source);
  if (bootstrap.kind === "application") {
    assertObjectKeys(bootstrap, source, ["kind"]);
    return;
  }
  if (bootstrap.kind === "page") {
    assertObjectKeys(bootstrap, source, ["kind", "pageId"]);
    assertNonEmptyString(bootstrap.pageId, `${source}.pageId`);
    return;
  }
  throw new Error(`[evjs] ${source}.kind must be "application" or "page".`);
}

function assertApplicationIndexes(
  applications: Record<string, unknown>,
  pages: Record<string, unknown>,
  routes: Map<string, Record<string, unknown>>,
  documents: Record<string, unknown>,
  source: string,
): void {
  for (const [applicationId, value] of Object.entries(applications)) {
    const application = value as Record<string, unknown>;
    assertOwnedIndex(
      application.pageIds as string[],
      pages,
      applicationId,
      "pageIds",
      source,
    );
    assertOwnedRouteIndex(
      application.routeIds as string[],
      routes,
      applicationId,
      source,
    );
    assertOwnedIndex(
      application.documentIds as string[],
      documents,
      applicationId,
      "documentIds",
      source,
    );
  }

  for (const [pageId, value] of Object.entries(pages)) {
    assertInverseIndex(
      applications,
      (value as Record<string, unknown>).applicationId as string,
      "pageIds",
      pageId,
      `${source}.pages.${pageId}`,
    );
  }
  for (const [routeId, route] of routes) {
    assertInverseIndex(
      applications,
      route.applicationId as string,
      "routeIds",
      routeId,
      `${source}.routes`,
    );
  }
  for (const [documentId, value] of Object.entries(documents)) {
    assertInverseIndex(
      applications,
      (value as Record<string, unknown>).applicationId as string,
      "documentIds",
      documentId,
      `${source}.documents.${documentId}`,
    );
  }
}

function assertOwnedIndex(
  ids: string[],
  nodes: Record<string, unknown>,
  applicationId: string,
  field: "pageIds" | "documentIds",
  source: string,
): void {
  for (const id of ids) {
    const node = getOwn(nodes, id);
    const indexSource = `${source}.applications.${applicationId}.${field}`;
    if (!node) {
      throw new Error(`[evjs] ${indexSource} references unknown id "${id}".`);
    }
    if ((node as Record<string, unknown>).applicationId !== applicationId) {
      throw new Error(
        `[evjs] ${indexSource} id "${id}" belongs to another application.`,
      );
    }
  }
}

function assertOwnedRouteIndex(
  ids: string[],
  routes: Map<string, Record<string, unknown>>,
  applicationId: string,
  source: string,
): void {
  for (const id of ids) {
    const route = routes.get(id);
    const indexSource = `${source}.applications.${applicationId}.routeIds`;
    if (!route) {
      throw new Error(`[evjs] ${indexSource} references unknown id "${id}".`);
    }
    if (route.applicationId !== applicationId) {
      throw new Error(
        `[evjs] ${indexSource} id "${id}" belongs to another application.`,
      );
    }
  }
}

function assertInverseIndex(
  applications: Record<string, unknown>,
  applicationId: string,
  field: "pageIds" | "routeIds" | "documentIds",
  id: string,
  source: string,
): void {
  const application = getOwn(applications, applicationId) as
    | Record<string, unknown>
    | undefined;
  if (!application) return;
  if (!(application[field] as string[]).includes(id)) {
    throw new Error(
      `[evjs] ${source} id "${id}" is missing from applications.${applicationId}.${field}.`,
    );
  }
}

function assertPageOwnership(
  graph: CoreGraph,
  applications: Record<string, unknown>,
  source: string,
): void {
  const scopeOwners = new Map<string, string>();
  for (const [pageId, page] of Object.entries(graph.pages)) {
    if (!getOwn(applications, page.applicationId)) {
      throw new Error(
        `[evjs] ${source}.pages.${pageId}.applicationId "${page.applicationId}" does not match an Application.`,
      );
    }

    const scope = page.source.scope;
    const scopeKey =
      scope.kind === "module"
        ? `module:${scope.file}`
        : `directory:${scope.root}`;
    const previous = scopeOwners.get(scopeKey);
    if (previous) {
      throw new Error(
        `[evjs] ${source}.pages.${pageId}.source.scope duplicates the ${scope.kind} scope owned by Page "${previous}".`,
      );
    }
    scopeOwners.set(scopeKey, pageId);
  }

  for (const [pageId, page] of Object.entries(graph.pages)) {
    const owner = resolveCorePageOwner(graph, page.source.module);
    if (owner?.id !== pageId) {
      const ownerDescription = owner ? `Page "${owner.id}"` : "no Page";
      throw new Error(
        `[evjs] ${source}.pages.${pageId}.source.module "${page.source.module}" resolves to ${ownerDescription}, not Page "${pageId}".`,
      );
    }
  }
}

function assertUniqueTerminalRoutePatterns(
  routes: Array<Record<string, unknown>>,
  source: string,
): void {
  const owners = new Map<string, string>();
  for (const [index, route] of routes.entries()) {
    const target = route.target as Record<string, unknown>;
    if (target.kind === "group") continue;
    const shape = coreRoutePatternShape(route.pattern as CoreRoutePattern);
    const key = `${route.applicationId as string}\0${shape}`;
    const previous = owners.get(key);
    if (previous) {
      throw new Error(
        `[evjs] ${source}.routes[${index}] terminal pattern shape "${shape}" conflicts with Route "${previous}" in application "${route.applicationId as string}".`,
      );
    }
    owners.set(key, route.id as string);
  }
}

function assertRouteOwnership(
  routes: Array<Record<string, unknown>>,
  routesById: Map<string, Record<string, unknown>>,
  applications: Record<string, unknown>,
  pages: Record<string, unknown>,
  source: string,
): void {
  for (const [index, route] of routes.entries()) {
    const routeSource = `${source}.routes[${index}]`;
    const applicationId = route.applicationId as string;
    if (!getOwn(applications, applicationId)) {
      throw new Error(
        `[evjs] ${routeSource}.applicationId "${applicationId}" does not match an Application.`,
      );
    }
    assertClientRouteOwnership(
      route,
      routesById,
      pages,
      applicationId,
      routeSource,
    );
  }
}

function assertClientRouteOwnership(
  route: Record<string, unknown>,
  routesById: Map<string, Record<string, unknown>>,
  pages: Record<string, unknown>,
  applicationId: string,
  source: string,
): void {
  const parentId = getOwn(route, "parentId");
  if (parentId !== undefined) {
    const parent = routesById.get(parentId as string);
    if (!parent) {
      throw new Error(
        `[evjs] ${source}.parentId "${parentId}" does not match a Route.`,
      );
    }
    if (parent.applicationId !== applicationId) {
      throw new Error(
        `[evjs] ${source}.parentId must reference a Route in application "${applicationId}".`,
      );
    }
    assertClientRouteParentPattern(
      route.pattern as CoreRoutePattern,
      parent.pattern as CoreRoutePattern,
      parentId as string,
      source,
    );
  }
  const target = route.target as Record<string, unknown>;
  if (target.kind === "page") {
    assertSameApplicationTarget(
      pages,
      target.pageId as string,
      applicationId,
      `${source}.target.pageId`,
      "Page",
    );
  }
}

function assertSameApplicationTarget(
  nodes: Record<string, unknown>,
  id: string,
  applicationId: string,
  source: string,
  kind: "Page" | "Document",
): void {
  const node = getOwn(nodes, id) as Record<string, unknown> | undefined;
  if (!node) {
    throw new Error(`[evjs] ${source} "${id}" does not match a ${kind}.`);
  }
  if (node.applicationId !== applicationId) {
    throw new Error(
      `[evjs] ${source} "${id}" belongs to application "${node.applicationId}", not route application "${applicationId}".`,
    );
  }
}

function assertDocumentOwnership(
  documents: Record<string, unknown>,
  applications: Record<string, unknown>,
  pages: Record<string, unknown>,
  source: string,
): void {
  for (const [documentId, value] of Object.entries(documents)) {
    const document = value as Record<string, unknown>;
    const applicationId = document.applicationId as string;
    if (!getOwn(applications, applicationId)) {
      throw new Error(
        `[evjs] ${source}.documents.${documentId}.applicationId "${applicationId}" does not match an Application.`,
      );
    }
    const owner = document.owner as Record<string, unknown>;
    if (owner.kind === "page") {
      assertDocumentPageReference(
        pages,
        owner.pageId as string,
        applicationId,
        `${source}.documents.${documentId}.owner.pageId`,
      );
    }
    const bootstrap = getOwn(document, "bootstrap") as
      | Record<string, unknown>
      | undefined;
    if (bootstrap?.kind === "page") {
      assertDocumentPageReference(
        pages,
        bootstrap.pageId as string,
        applicationId,
        `${source}.documents.${documentId}.bootstrap.pageId`,
      );
    }
  }
}

function assertDocumentPageReference(
  pages: Record<string, unknown>,
  pageId: string,
  applicationId: string,
  source: string,
): void {
  const page = getOwn(pages, pageId) as Record<string, unknown> | undefined;
  if (!page) {
    throw new Error(`[evjs] ${source} "${pageId}" does not match a Page.`);
  }
  if (page.applicationId !== applicationId) {
    throw new Error(
      `[evjs] ${source} "${pageId}" must reference a Page in application "${applicationId}".`,
    );
  }
}

function assertClientRouteParentCycles(
  routes: Map<string, Record<string, unknown>>,
  source: string,
): void {
  const complete = new Set<string>();
  const visiting = new Set<string>();

  function visit(routeId: string): void {
    if (complete.has(routeId)) return;
    if (visiting.has(routeId)) {
      throw new Error(
        `[evjs] ${source}.routes contains a client parent cycle at route "${routeId}".`,
      );
    }
    const route = routes.get(routeId);
    if (!route) return;
    visiting.add(routeId);
    const parentId = getOwn(route, "parentId");
    if (typeof parentId === "string") visit(parentId);
    visiting.delete(routeId);
    complete.add(routeId);
  }

  for (const routeId of routes.keys()) visit(routeId);
}

function assertUniqueDocumentOutputs(
  documents: Record<string, unknown>,
  source: string,
): void {
  const owners = new Map<string, { documentId: string; kind: string }>();
  for (const [documentId, value] of Object.entries(documents)) {
    const document = value as Record<string, unknown>;
    const outputs = [
      {
        output: document.output as string,
        source: `${source}.documents.${documentId}.output`,
        kind: "canonical output",
      },
      ...((document.aliases as string[] | undefined) ?? []).map(
        (output, index) => ({
          output,
          source: `${source}.documents.${documentId}.aliases[${index}]`,
          kind: "alias",
        }),
      ),
    ];
    for (const candidate of outputs) {
      const previous = owners.get(candidate.output);
      if (previous) {
        throw new Error(
          `[evjs] ${candidate.source} "${candidate.output}" conflicts with ${previous.kind} owned by Document "${previous.documentId}". Static Document outputs and aliases must be globally unique.`,
        );
      }
      owners.set(candidate.output, {
        documentId,
        kind: candidate.kind,
      });
    }
  }
}

function assertServerFunctionNodes(value: unknown[], source: string): void {
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    const nodeSource = `${source}[${index}]`;
    const node = assertObjectShape(item, nodeSource, [
      "id",
      "module",
      "exportName",
    ]);
    assertTrimmedNonEmptyString(node.id, `${nodeSource}.id`);
    assertFrameworkModuleId(node.module, `${nodeSource}.module`);
    assertTrimmedNonEmptyString(node.exportName, `${nodeSource}.exportName`);
    assertUniqueNodeId(node.id as string, ids, `${nodeSource}.id`);
  }
}

function assertServerRouteNodes(value: unknown[], source: string): void {
  const ids = new Set<string>();
  const paths = new Set<string>();
  const shapes = new Map<string, string>();

  for (const [index, item] of value.entries()) {
    const nodeSource = `${source}[${index}]`;
    const node = assertObjectShape(item, nodeSource, [
      "id",
      "module",
      "path",
      "methods",
    ]);
    assertTrimmedNonEmptyString(node.id, `${nodeSource}.id`);
    assertFrameworkModuleId(node.module, `${nodeSource}.module`);
    assertServerRoutePath(node.path, `${nodeSource}.path`);
    assertHttpMethods(node.methods, `${nodeSource}.methods`);
    assertUniqueNodeId(node.id as string, ids, `${nodeSource}.id`);

    const routePath = node.path as string;
    if (paths.has(routePath)) {
      throw new Error(
        `[evjs] ${nodeSource}.path "${routePath}" must be unique within ${source}.`,
      );
    }
    paths.add(routePath);

    const shape = serverRoutePathShapeFromPath(routePath);
    const existing = shapes.get(shape);
    if (existing) {
      throw new Error(
        `[evjs] ${nodeSource}.path "${routePath}" has the same route shape as "${existing}".`,
      );
    }
    shapes.set(shape, routePath);
  }
}

function assertReferenceNodes(value: unknown[], source: string): void {
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    const nodeSource = `${source}[${index}]`;
    const node = assertObjectShape(
      item,
      nodeSource,
      ["id", "module"],
      ["exportName"],
    );
    assertTrimmedNonEmptyString(node.id, `${nodeSource}.id`);
    assertFrameworkModuleId(node.module, `${nodeSource}.module`);
    const exportName = getOwn(node, "exportName");
    if (exportName !== undefined) {
      assertTrimmedNonEmptyString(exportName, `${nodeSource}.exportName`);
    }
    assertUniqueNodeId(node.id as string, ids, `${nodeSource}.id`);
  }
}

function assertUniqueNodeId(
  id: string,
  ids: Set<string>,
  source: string,
): void {
  if (ids.has(id)) {
    throw new Error(`[evjs] ${source} "${id}" must be unique.`);
  }
  ids.add(id);
}

function assertFrameworkModuleId(value: unknown, source: string): void {
  assertTrimmedNonEmptyString(value, source);
  const moduleId = value as string;
  if (moduleId.includes("\\")) {
    throw new Error(`[evjs] ${source} must use forward slashes.`);
  }
  if (
    moduleId.startsWith("/") ||
    /^[A-Za-z]:\//.test(moduleId) ||
    moduleId.includes("?") ||
    moduleId.includes("#")
  ) {
    throw new Error(
      `[evjs] ${source} must be a normalized project-relative module id.`,
    );
  }
  const relative = moduleId.startsWith("./") ? moduleId.slice(2) : moduleId;
  const segments = relative.split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      `[evjs] ${source} must be normalized and must not contain empty, ".", or ".." segments.`,
    );
  }
}

function assertServerRoutePath(value: unknown, source: string): void {
  assertTrimmedNonEmptyString(value, source);
  const routePath = value as string;
  const pathError = getPathPatternValidationError(routePath);
  if (pathError) {
    throw new Error(
      `[evjs] ${source} ${formatPathPatternValidationError(pathError)}`,
    );
  }
  const paramError = getServerRouteParamSegmentValidationError(routePath);
  if (paramError) {
    throw new Error(
      `[evjs] ${source} ${formatServerRouteParamValidationError(paramError)}`,
    );
  }
}

function formatPathPatternValidationError(
  error: PathPatternValidationError,
): string {
  switch (error) {
    case "empty":
      return "must be a non-empty path.";
    case "whitespace":
      return "must not contain whitespace.";
    case "missing-leading-slash":
      return 'must start with "/".';
    case "query-or-hash":
      return "must not include a query string or hash.";
  }
}

function formatServerRouteParamValidationError(
  error: ServerRouteParamSegmentValidationError,
): string {
  if (error.error === "empty") {
    return `contains dynamic segment "${error.segment}" without a param name.`;
  }
  if (error.error === "reserved") {
    return `uses reserved dynamic param name "${error.name}" in segment "${error.segment}".`;
  }
  return `uses duplicate dynamic param name "${error.name}" in segment "${error.segment}".`;
}

function assertHttpMethods(value: unknown, source: string): void {
  assertStrictArray(value, source);
  if (value.length === 0) {
    throw new Error(`[evjs] ${source} must contain at least one HTTP method.`);
  }
  const methods = new Set<string>();
  for (const [index, method] of value.entries()) {
    if (typeof method !== "string" || !isHttpMethod(method)) {
      throw new Error(
        `[evjs] ${source}[${index}] "${String(method)}" is not a supported HTTP method. Supported methods: ${HTTP_METHOD_LIST_DESCRIPTION}.`,
      );
    }
    if (methods.has(method)) {
      throw new Error(
        `[evjs] ${source} must not contain duplicate method "${method}".`,
      );
    }
    methods.add(method);
  }
}

function assertPrerenderConfig(value: unknown, source: string): void {
  if (value === true) return;
  const config = assertObjectShape(
    value,
    source,
    [],
    ["partial", "delivery", "revalidate"],
  );
  const partial = getOwn(config, "partial");
  if (partial !== undefined && typeof partial !== "boolean") {
    throw new Error(`[evjs] ${source}.partial must be a boolean.`);
  }
  const delivery = getOwn(config, "delivery");
  if (delivery !== undefined && delivery !== "merge" && delivery !== "stream") {
    throw new Error(`[evjs] ${source}.delivery must be "merge" or "stream".`);
  }
  const revalidate = getOwn(config, "revalidate");
  if (revalidate !== undefined) {
    assertRevalidate(revalidate, `${source}.revalidate`);
  }
}

function assertPprConfig(value: unknown, source: string): void {
  const config = assertObjectShape(
    value,
    source,
    [],
    ["delivery", "revalidate", "regions"],
  );
  const delivery = getOwn(config, "delivery");
  if (delivery !== undefined && delivery !== "merge" && delivery !== "stream") {
    throw new Error(`[evjs] ${source}.delivery must be "merge" or "stream".`);
  }
  const revalidate = getOwn(config, "revalidate");
  if (revalidate !== undefined) {
    assertRevalidate(revalidate, `${source}.revalidate`);
  }
  const regions = getOwn(config, "regions");
  if (regions === undefined) return;

  const regionMap = assertRecord(regions, `${source}.regions`);
  for (const [regionId, valueRegion] of Object.entries(regionMap)) {
    if (!isBuildIdentifier(regionId)) {
      throw new Error(
        `[evjs] ${source}.regions key "${regionId}" must contain only ${BUILD_IDENTIFIER_DESCRIPTION}.`,
      );
    }
    assertPprRegionConfig(valueRegion, `${source}.regions.${regionId}`);
  }
}

function assertPprRegionConfig(value: unknown, source: string): void {
  const region = assertObjectShape(
    value,
    source,
    ["component"],
    ["fallback", "cache"],
  );
  assertProjectPath(region.component, `${source}.component`);
  const fallback = getOwn(region, "fallback");
  if (fallback !== undefined) {
    assertProjectPath(fallback, `${source}.fallback`);
  }
  const cache = getOwn(region, "cache");
  if (cache !== undefined) {
    assertPprCache(cache, `${source}.cache`);
  }
}

function assertPprCache(value: unknown, source: string): void {
  if (value === "no-store") return;
  const cache = assertObjectShape(value, source, ["revalidate"]);
  assertPositiveInteger(cache.revalidate, `${source}.revalidate`);
}

function assertRevalidate(value: unknown, source: string): void {
  if (value === false) return;
  assertPositiveInteger(value, source);
}

function assertPositiveInteger(value: unknown, source: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `[evjs] ${source} must be a positive integer number of seconds.`,
    );
  }
}

function assertClientRouteParentPattern(
  child: CoreRoutePattern,
  parent: CoreRoutePattern,
  parentId: string,
  source: string,
): void {
  if (isCoreRoutePatternPrefix(parent, child)) return;
  throw new Error(
    `[evjs] ${source}.pattern must start with parent Route "${parentId}" pattern.`,
  );
}

function assertExtensionBag(value: unknown, source: string): void {
  const bag = assertRecord(value, source);
  for (const namespace of Reflect.ownKeys(bag)) {
    if (typeof namespace !== "string") {
      throw new Error(`[evjs] ${source} contains an unsupported symbol field.`);
    }
    assertNonEmptyString(namespace, `${source} namespace`);
    assertStaticJsonValue(bag[namespace], `${source}.${namespace}`);
  }
}

function assertExtensionRegistry(value: unknown, source: string): void {
  const registry = assertObjectShape(value, source, ["namespaces"]);
  const namespaces = assertRecord(registry.namespaces, `${source}.namespaces`);
  const ownerKinds = new Set<CoreExtensionOwnerKind>([
    "application",
    "page",
    "route",
    "document",
  ]);
  for (const [namespace, valueNamespace] of Object.entries(namespaces)) {
    assertNonEmptyString(namespace, `${source}.namespaces key`);
    const definition = assertObjectShape(
      valueNamespace,
      `${source}.namespaces.${namespace}`,
      ["producer", "owners"],
      ["schemaVersion"],
    );
    assertNonEmptyString(
      definition.producer,
      `${source}.namespaces.${namespace}.producer`,
    );
    assertStrictArray(
      definition.owners,
      `${source}.namespaces.${namespace}.owners`,
    );
    const seenOwners = new Set<string>();
    for (const [index, owner] of definition.owners.entries()) {
      if (!ownerKinds.has(owner as CoreExtensionOwnerKind)) {
        throw new Error(
          `[evjs] ${source}.namespaces.${namespace}.owners[${index}] is not supported.`,
        );
      }
      if (seenOwners.has(owner as string)) {
        throw new Error(
          `[evjs] ${source}.namespaces.${namespace}.owners must be unique.`,
        );
      }
      seenOwners.add(owner as string);
    }
    const schemaVersion = getOwn(definition, "schemaVersion");
    if (schemaVersion !== undefined) {
      assertNonEmptyString(
        schemaVersion,
        `${source}.namespaces.${namespace}.schemaVersion`,
      );
    }
  }
}

function assertProvenance(
  value: unknown,
  source: string,
): Record<string, unknown> {
  const provenance = assertObjectShape(value, source, ["producer"], ["source"]);
  const producer = assertObjectShape(
    provenance.producer,
    `${source}.producer`,
    ["kind", "id"],
  );
  if (
    producer.kind !== "core" &&
    producer.kind !== "provider" &&
    producer.kind !== "plugin"
  ) {
    throw new Error(
      `[evjs] ${source}.producer.kind must be "core", "provider", or "plugin".`,
    );
  }
  assertNonEmptyString(producer.id, `${source}.producer.id`);
  const provenanceSource = getOwn(provenance, "source");
  if (provenanceSource !== undefined) {
    assertNonEmptyString(provenanceSource, `${source}.source`);
  }
  return provenance;
}

function assertIdentifierList(value: unknown, source: string): void {
  assertStrictArray(value, source);
  const seen = new Set<string>();
  for (const [index, id] of value.entries()) {
    assertNonEmptyString(id, `${source}[${index}]`);
    if (seen.has(id as string)) {
      throw new Error(`[evjs] ${source} must contain unique ids.`);
    }
    seen.add(id as string);
  }
}

function assertRouteParamName(value: unknown, source: string): void {
  assertNonEmptyString(value, source);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value as string)) {
    throw new Error(`[evjs] ${source} must be a valid identifier name.`);
  }
  if (getPageRouteParamNameValidationError(value) === "reserved") {
    throw new Error(
      `[evjs] ${source} must not use reserved page route param name "${value}".`,
    );
  }
}

function assertStaticRouteSegment(value: unknown, source: string): void {
  assertNonEmptyString(value, source);
  const segment = value as string;
  if (isDotRouteSegment(segment)) {
    throw new Error(`[evjs] ${source} must not be or decode to "." or "..".`);
  }
  if (segment.includes("/") || segment.includes("\\")) {
    throw new Error(`[evjs] ${source} must not contain a slash or backslash.`);
  }
  if (/\s/.test(segment)) {
    throw new Error(`[evjs] ${source} must not contain whitespace.`);
  }
  if (segment.includes("?") || segment.includes("#")) {
    throw new Error(`[evjs] ${source} must not contain a query or hash.`);
  }
}

function assertProjectPath(
  value: unknown,
  source: string,
  options: { allowRoot?: boolean } = {},
): asserts value is string {
  assertNonEmptyString(value, source);
  const projectPath = value as string;
  if (projectPath.includes("\\")) {
    throw new Error(`[evjs] ${source} must use forward slashes.`);
  }
  if (projectPath.includes("?") || projectPath.includes("#")) {
    throw new Error(`[evjs] ${source} must not contain a query or hash.`);
  }
  if (projectPath === ".") {
    if (options.allowRoot) return;
    throw new Error(`[evjs] ${source} must identify a project file.`);
  }
  if (!projectPath.startsWith("./")) {
    throw new Error(
      `[evjs] ${source} must be a normalized project-relative path starting with "./".`,
    );
  }
  const segments = projectPath.slice(2).split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      `[evjs] ${source} must be normalized and must not contain empty, ".", or ".." segments.`,
    );
  }
}

function assertDocumentOutputPath(value: unknown, source: string): void {
  assertNonEmptyString(value, source);
  const output = value as string;
  if (output.trim() !== output) {
    throw new Error(
      `[evjs] ${source} must not contain leading or trailing whitespace.`,
    );
  }
  if (output.includes("\\")) {
    throw new Error(`[evjs] ${source} must use forward slashes.`);
  }
  if (output.startsWith("/") || /^[A-Za-z]:\//.test(output)) {
    throw new Error(`[evjs] ${source} must be a relative output path.`);
  }
  if (output.includes("?") || output.includes("#")) {
    throw new Error(`[evjs] ${source} must not contain a query or hash.`);
  }
  if (output.endsWith("/")) {
    throw new Error(`[evjs] ${source} must not end with "/".`);
  }
  const segments = output.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      `[evjs] ${source} must not contain empty, ".", or ".." segments.`,
    );
  }
  if (!/\.html?$/i.test(output)) {
    throw new Error(
      `[evjs] ${source} must end with ".html" or ".htm" because a Document output contains HTML.`,
    );
  }
}

function collectNonPageOwnedModules(graph: CoreGraph): Set<string> {
  const modules = new Set<string>();
  for (const application of Object.values(graph.applications)) {
    if (application.layout) modules.add(application.layout);
  }
  for (const route of graph.routes) {
    if (typeof route.facets.layout === "string") {
      modules.add(route.facets.layout);
    }
    if (route.facets.error) modules.add(route.facets.error);
    if (route.facets.notFound) modules.add(route.facets.notFound);
    for (const wrapper of route.facets.wrappers) modules.add(wrapper);
  }
  return modules;
}

function isPathWithinDirectory(sourcePath: string, root: string): boolean {
  return root === "."
    ? sourcePath !== "."
    : sourcePath === root || sourcePath.startsWith(`${root}/`);
}

function getProjectPathDepth(projectPath: string): number {
  return projectPath === "." ? 0 : projectPath.slice(2).split("/").length;
}

function assertNodeId(value: unknown, expected: string, source: string): void {
  assertNonEmptyString(value, source);
  if (value !== expected) {
    throw new Error(
      `[evjs] ${source} must match its record key "${expected}".`,
    );
  }
}

function assertNonEmptyString(
  value: unknown,
  source: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[evjs] ${source} must be a non-empty string.`);
  }
}

function assertTrimmedNonEmptyString(
  value: unknown,
  source: string,
): asserts value is string {
  assertNonEmptyString(value, source);
  if (value.trim() !== value) {
    throw new Error(
      `[evjs] ${source} must not contain leading or trailing whitespace.`,
    );
  }
}

function assertRecord(value: unknown, source: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`[evjs] ${source} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`[evjs] ${source} must be a plain object.`);
  }
  assertEnumerableDataProperties(value, source);
  return value as Record<string, unknown>;
}

function assertEnumerableDataProperties(value: object, source: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new Error(`[evjs] ${source} contains an unsupported symbol field.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(
        `[evjs] ${source}.${key} must be an enumerable own data property.`,
      );
    }
  }
}

function assertStrictArray(
  value: unknown,
  source: string,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`[evjs] ${source} must be an array.`);
  }

  const indexes = new Set<number>();
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string") {
      throw new Error(`[evjs] ${source} contains an unsupported symbol field.`);
    }
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
      throw new Error(
        `[evjs] ${source}.${key} is not a supported array index.`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(
        `[evjs] ${source}[${key}] must be an enumerable own data property.`,
      );
    }
    indexes.add(Number(key));
  }

  for (let index = 0; index < value.length; index++) {
    if (!indexes.has(index)) {
      throw new Error(
        `[evjs] ${source}[${index}] must not be a sparse array hole.`,
      );
    }
  }
}

function assertObjectShape(
  value: unknown,
  source: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  const record = assertRecord(value, source);
  assertObjectKeys(record, source, requiredKeys, optionalKeys);
  return record;
}

function assertObjectKeys(
  record: Record<string, unknown>,
  source: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): void {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") {
      throw new Error(`[evjs] ${source} contains an unsupported symbol field.`);
    }
    if (!allowedKeys.has(key)) {
      throw new Error(`[evjs] ${source}.${key} is not supported.`);
    }
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(record, key)) {
      throw new Error(`[evjs] ${source}.${key} must be an own property.`);
    }
  }
}

function getOwn(
  record: Record<string, unknown>,
  key: string,
): unknown | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
