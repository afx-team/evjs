import type {
  ClientReferenceNode,
  CoreApplicationNode,
  CoreClientRouteNode,
  CoreDocumentNode,
  CoreGraph,
  CorePageNode,
  CoreRouteNode,
  CoreRoutePattern,
  CoreRouteSegment,
  PageRouteNode,
  ServerFunctionNode,
  ServerReferenceNode,
  ServerRouteNode,
} from "@evjs/shared/manifest";
import {
  assertCoreGraph,
  clonePageMetadata,
  PAGE_ANCHOR_PROVIDER_ID,
} from "@evjs/shared/manifest";
import type { ResolvedPageFileConfig } from "../config-loading/page-config-module.js";
import {
  createRouteHtmlDocumentOutput,
  createRouteIndexDocumentOutput,
} from "../conventions/page-document-output.js";
import { resolvePageRenderMode } from "../conventions/page-rendering-contract.js";
import { CANONICAL_PAGE_ROUTE_ROOT } from "../conventions/page-route-conventions.js";
import type { GraphConfig } from "./types.js";

const PAGE_ANCHOR_PRODUCER = {
  kind: "provider",
  id: PAGE_ANCHOR_PROVIDER_ID,
} as const;

/**
 * Apply build-time Page configuration without changing semantic Page or Route
 * identity. SPA SSG configuration may add a Page-owned Document, after which
 * the complete graph is validated again.
 */
export function applyResolvedPageConfigs(
  graph: CoreGraph,
  pageConfigs: Record<string, ResolvedPageFileConfig>,
): CoreGraph {
  const pages = createRecord<CorePageNode>();
  let changed = false;
  for (const [pageId, page] of Object.entries(graph.pages)) {
    const config = getOwn(pageConfigs, pageId);
    const metadata = clonePageMetadata(config?.metadata ?? page.metadata);
    changed ||= config !== undefined;
    defineRecordValue(pages, pageId, {
      ...page,
      ...(getResolvedPageRendering(config, page) ?? {}),
      ...(metadata ? { metadata } : {}),
    });
  }
  for (const [pageId, config] of Object.entries(pageConfigs)) {
    if (getOwn(graph.pages, pageId)) continue;
    throw new Error(
      `[evjs] Page config "${config.source}" targets missing CoreGraph Page "${pageId}".`,
    );
  }
  if (!changed) return graph;
  let resolved: CoreGraph = {
    ...graph,
    pages,
  };
  resolved = materializeSpaPageDocuments(resolved, pageConfigs);
  assertCoreGraph(resolved, "resolved Page config CoreGraph");
  return resolved;
}

function getResolvedPageRendering(
  config: ResolvedPageFileConfig | undefined,
  page: CorePageNode,
):
  | Pick<
      CorePageNode,
      "render" | "componentModel" | "hydrate" | "prerender" | "ppr"
    >
  | undefined {
  if (!config) return undefined;
  const ppr = derivePprConfig(config.prerender);
  return {
    render: config.render ?? page.render,
    ...(config.componentModel
      ? { componentModel: config.componentModel }
      : page.componentModel
        ? { componentModel: page.componentModel }
        : {}),
    ...(config.hydrate
      ? { hydrate: config.hydrate }
      : page.hydrate
        ? { hydrate: page.hydrate }
        : {}),
    ...(config.prerender
      ? { prerender: config.prerender }
      : page.prerender
        ? { prerender: page.prerender }
        : {}),
    ...((ppr ?? page.ppr)
      ? { ppr: { ...(page.ppr ?? {}), ...(ppr ?? {}) } }
      : {}),
  };
}

function derivePprConfig(
  prerender: ResolvedPageFileConfig["prerender"],
): CorePageNode["ppr"] | undefined {
  if (!prerender || prerender === true || !prerender.partial) {
    return undefined;
  }
  return {
    delivery: prerender.delivery ?? "merge",
    ...(prerender.revalidate !== undefined
      ? { revalidate: prerender.revalidate }
      : {}),
  };
}

interface PageAnchorRouteFact {
  id: string;
  path: string;
  module: string;
  parentId?: string;
  kind?: "page" | "layout";
  pageId?: string;
  scope?: PageRouteNode["scope"];
  html?: string;
  errorModule?: string;
  notFoundModule?: string;
}

type PageAnchorGraphConfig = GraphConfig & {
  routing: NonNullable<GraphConfig["routing"]>;
};

type CorePageClientRoute = CoreClientRouteNode & {
  target: { kind: "page"; pageId: string };
};

export interface PageAnchorGraphFacts {
  rootDir: string;
  routes: PageRouteNode[];
  serverFunctions: ServerFunctionNode[];
  serverRoutes: ServerRouteNode[];
  clientReferences?: ClientReferenceNode[];
  serverReferences?: ServerReferenceNode[];
}

/**
 * Normalize canonical page-anchor discovery into the CoreGraph.
 *
 * Page and semantic Route identity are materialization-neutral. Routing mode
 * changes Document ownership and the later entry materialization, while server
 * functions, request Routes, and module references remain analysis facts for
 * later planning. Bundler-specific entry and asset decisions are deliberately
 * outside this normalization boundary.
 */
export function createPageAnchorGraph(
  config: GraphConfig,
  facts: PageAnchorGraphFacts,
  pageConfigs: Record<string, ResolvedPageFileConfig> = {},
): CoreGraph {
  if (!isPageAnchorGraphConfig(config)) {
    throw new Error(
      "[evjs] CoreGraph page-anchor normalization requires canonical page.* discovery without explicit application.routes input.",
    );
  }
  const pageConfig = config as PageAnchorGraphConfig;

  const routingMode = pageConfig.routing.mode;
  const applications = createRecord<CoreApplicationNode>();
  const pages = createRecord<CorePageNode>();
  const documents = createRecord<CoreDocumentNode>();
  const routes: CoreRouteNode[] = [];
  const routeFacts = createPageAnchorRouteFacts(facts.routes);
  createPageAnchorApplication(pageConfig, applications, documents);

  for (const route of routeFacts) {
    if (!route.pageId) continue;
    const applicationId = "default";
    if (!getOwn(applications, applicationId)) {
      throw new Error(
        `[evjs] CoreGraph Page "${route.pageId}" does not resolve to an owning page-anchor Application.`,
      );
    }
    if (route.scope?.kind !== "directory") {
      throw new Error(
        `[evjs] Canonical Page "${route.pageId}" must use its page.* directory as scope.`,
      );
    }
    const resolvedPageConfig = getOwn(pageConfigs, route.pageId);
    const metadata = clonePageMetadata(resolvedPageConfig?.metadata);
    const ppr = derivePprConfig(resolvedPageConfig?.prerender);
    defineRecordValue(pages, route.pageId, {
      id: route.pageId,
      applicationId,
      source: {
        module: route.module,
        ...(resolvedPageConfig ? { config: resolvedPageConfig.source } : {}),
        scope: route.scope,
        provider: PAGE_ANCHOR_PROVIDER_ID,
      },
      render: resolvePageRenderMode(resolvedPageConfig?.render),
      ...(resolvedPageConfig?.componentModel
        ? { componentModel: resolvedPageConfig.componentModel }
        : {}),
      ...(resolvedPageConfig?.hydrate
        ? { hydrate: resolvedPageConfig.hydrate }
        : {}),
      ...(resolvedPageConfig?.prerender
        ? { prerender: resolvedPageConfig.prerender }
        : {}),
      ...(ppr ? { ppr } : {}),
      ...(metadata ? { metadata } : {}),
      plugins: {},
      provenance: {
        producer: PAGE_ANCHOR_PRODUCER,
        source: route.module,
      },
    });
    getOwn(applications, applicationId)?.pageIds.push(route.pageId);
  }
  for (const [pageId, resolvedPageConfig] of Object.entries(pageConfigs)) {
    if (getOwn(pages, pageId)) continue;
    throw new Error(
      `[evjs] Page config "${resolvedPageConfig.source}" targets missing canonical Page "${pageId}".`,
    );
  }

  // A directory may contain both a layout anchor and a Page anchor at the same
  // URL. The Page Route becomes the semantic node for that URL: it inherits the
  // layout facets, the synthetic layout Route is removed, and descendants are
  // reparented to the surviving Page Route.
  const layoutRoutesById = new Map(
    routeFacts
      .filter((route) => route.kind === "layout")
      .map((route) => [route.id, route]),
  );
  const mergedLayoutByPageRouteId = new Map(
    routeFacts.flatMap((route) => {
      if (!route.pageId || !route.parentId) return [];
      const layout = layoutRoutesById.get(route.parentId);
      return layout?.path === route.path ? [[route.id, layout] as const] : [];
    }),
  );
  const mergedLayoutReplacementIds = new Map(
    [...mergedLayoutByPageRouteId].map(([pageRouteId, layout]) => [
      layout.id,
      pageRouteId,
    ]),
  );
  for (const route of routeFacts) {
    if (mergedLayoutReplacementIds.has(route.id)) continue;
    const applicationId = "default";
    if (!getOwn(applications, applicationId)) {
      throw new Error(
        `[evjs] CoreGraph Route "${route.id}" does not resolve to an owning page-anchor Application.`,
      );
    }
    const target = route.pageId
      ? ({ kind: "page", pageId: route.pageId } as const)
      : ({ kind: "group" } as const);
    if (target.kind === "page" && !getOwn(pages, target.pageId)) {
      throw new Error(
        `[evjs] CoreGraph Route "${route.id}" targets missing Page "${target.pageId}".`,
      );
    }
    const mergedLayout = mergedLayoutByPageRouteId.get(route.id);
    const physicalParentId = mergedLayout
      ? mergedLayout.parentId
      : route.parentId;
    const parentId = physicalParentId
      ? (mergedLayoutReplacementIds.get(physicalParentId) ?? physicalParentId)
      : undefined;
    const layout =
      mergedLayout?.module ??
      (route.kind === "layout" ? route.module : undefined);
    routes.push({
      id: route.id,
      applicationId,
      ...(parentId ? { parentId } : {}),
      pattern: parseRoutePattern(route.path),
      target,
      facets: {
        ...(layout ? { layout } : {}),
        ...(route.errorModule ? { error: route.errorModule } : {}),
        ...(route.notFoundModule ? { notFound: route.notFoundModule } : {}),
        wrappers: [],
      },
      provenance: {
        producer: PAGE_ANCHOR_PRODUCER,
        source: route.module,
      },
    });
    getOwn(applications, applicationId)?.routeIds.push(route.id);
  }

  if (routingMode === "mpa") {
    materializePageAnchorMpaDocuments(
      pageConfig,
      routeFacts,
      applications,
      pages,
      routes,
      documents,
      pageConfigs,
    );
  } else {
    materializeSpaPageDocumentsInPlace({
      applications,
      pages,
      routes,
      documents,
      pageConfigs,
    });
  }

  const coreGraph: CoreGraph = {
    rootDir: facts.rootDir,
    applications,
    pages,
    routes,
    documents,
    plugins: { entries: {} },
    serverFunctions: facts.serverFunctions,
    serverRoutes: facts.serverRoutes,
    ...(facts.clientReferences
      ? { clientReferences: facts.clientReferences }
      : {}),
    ...(facts.serverReferences
      ? { serverReferences: facts.serverReferences }
      : {}),
  };
  assertCoreGraph(coreGraph, "page-anchor CoreGraph");
  return coreGraph;
}

function isPageAnchorGraphConfig(
  config: GraphConfig,
): config is PageAnchorGraphConfig {
  return Boolean(config.routing && !config.application);
}

function createPageAnchorApplication(
  config: PageAnchorGraphConfig,
  applications: Record<string, CoreApplicationNode>,
  documents: Record<string, CoreDocumentNode>,
): void {
  if (config.routing.mode === "mpa") {
    defineRecordValue(applications, "default", {
      id: "default",
      root: ".",
      routingMode: "mpa",
      ...(config.routing.rootModule
        ? { layout: config.routing.rootModule }
        : {}),
      pageIds: [],
      routeIds: [],
      documentIds: [],
      plugins: {},
      provenance: {
        producer: PAGE_ANCHOR_PRODUCER,
        source: CANONICAL_PAGE_ROUTE_ROOT,
      },
    });
    return;
  }

  defineRecordValue(applications, "default", {
    id: "default",
    root: ".",
    routingMode: "spa",
    ...(config.routing.rootModule ? { layout: config.routing.rootModule } : {}),
    pageIds: [],
    routeIds: [],
    documentIds: ["index"],
    plugins: {},
    provenance: {
      producer: PAGE_ANCHOR_PRODUCER,
      source: CANONICAL_PAGE_ROUTE_ROOT,
    },
  });
  defineRecordValue(documents, "index", {
    id: "index",
    template: config.routing.html,
    output: "index.html",
    applicationId: "default",
    owner: { kind: "application" },
    mount: config.routing.mount,
    bootstrap: { kind: "application" },
    provenance: {
      producer: PAGE_ANCHOR_PRODUCER,
      source: config.routing.html,
    },
  });
}

function createPageAnchorRouteFacts(
  routes: PageRouteNode[],
): PageAnchorRouteFact[] {
  return routes.map((route) => ({
    id: route.id,
    path: route.path,
    module: route.module,
    ...(route.parentId ? { parentId: route.parentId } : {}),
    ...(route.kind ? { kind: route.kind } : {}),
    ...(route.kind === "layout" ? {} : { pageId: route.id }),
    ...(route.scope ? { scope: route.scope } : {}),
    ...(route.html ? { html: route.html } : {}),
    ...(route.errorModule ? { errorModule: route.errorModule } : {}),
    ...(route.notFoundModule ? { notFoundModule: route.notFoundModule } : {}),
  }));
}

/**
 * Materialize one Page-owned Document for each canonical MPA Page Route.
 * Every Page must resolve to exactly one static URL; per-Page templates and
 * aliases refine that output without creating additional semantic Routes.
 */
function materializePageAnchorMpaDocuments(
  config: PageAnchorGraphConfig,
  routeFacts: PageAnchorRouteFact[],
  applications: Record<string, CoreApplicationNode>,
  pages: Record<string, CorePageNode>,
  routes: CoreRouteNode[],
  documents: Record<string, CoreDocumentNode>,
  pageConfigs: Record<string, ResolvedPageFileConfig>,
): void {
  const application = getOwn(applications, "default");
  if (!application) {
    throw new Error(
      '[evjs] Canonical MPA materialization requires Application "default".',
    );
  }
  const semanticPageRoutes = routes.filter(
    (route): route is CorePageClientRoute => route.target.kind === "page",
  );
  const routeByPageId = new Map<string, CorePageClientRoute>();

  for (const route of semanticPageRoutes) {
    const pageId = route.target.pageId;
    const previous = routeByPageId.get(pageId);
    if (previous) {
      throw new Error(
        `[evjs] Canonical MPA Page "${pageId}" is targeted by both Route "${previous.id}" and Route "${route.id}". File-convention Pages must map to exactly one URL.`,
      );
    }
    routeByPageId.set(pageId, route);

    const page = getOwn(pages, pageId);
    const pageFact = routeFacts.find(
      (candidate) => candidate.pageId === pageId,
    );
    if (!page || !pageFact) {
      throw new Error(
        `[evjs] Canonical MPA Route "${route.id}" targets missing Page "${pageId}".`,
      );
    }
    const output = createCanonicalMpaDocumentOutput(route);
    const resolvedPageConfig = getOwn(pageConfigs, pageId);
    const aliases = resolvedPageConfig?.document?.aliases;
    if (aliases?.length && page.render !== "csr" && page.render !== "ssg") {
      throw new Error(
        `[evjs] Page "${pageId}" config "${resolvedPageConfig?.source ?? page.source.config ?? page.source.module}" document.aliases requires a static Page-owned Document. Render mode "${page.render}" uses a request-time Document.`,
      );
    }
    const documentId = pageId;
    defineRecordValue(documents, documentId, {
      id: documentId,
      template: pageFact.html ?? config.routing.html,
      output,
      ...(aliases?.length ? { aliases: [...aliases] } : {}),
      applicationId: route.applicationId,
      owner: { kind: "page", pageId },
      mount: config.routing.mount,
      bootstrap: { kind: "page", pageId },
      provenance: {
        producer: PAGE_ANCHOR_PRODUCER,
        source: pageFact.html ?? config.routing.html,
      },
    });

    application.documentIds.push(documentId);
  }

  for (const pageId of Object.keys(pages)) {
    if (!routeByPageId.has(pageId)) {
      throw new Error(
        `[evjs] Canonical MPA Page "${pageId}" has no semantic file Route.`,
      );
    }
  }
}

function materializeSpaPageDocuments(
  graph: CoreGraph,
  pageConfigs: Record<string, ResolvedPageFileConfig>,
): CoreGraph {
  if (
    !Object.values(graph.pages).some((page) => {
      const application = getOwn(graph.applications, page.applicationId);
      const config = getOwn(pageConfigs, page.id);
      return (
        application?.routingMode === "spa" &&
        (page.render === "ssg" || config?.document !== undefined)
      );
    })
  ) {
    return graph;
  }
  const applications = cloneRecord(graph.applications, (application) => ({
    ...application,
    pageIds: [...application.pageIds],
    routeIds: [...application.routeIds],
    documentIds: [...application.documentIds],
  }));
  const documents = cloneRecord(graph.documents, (document) => ({
    ...document,
    ...(document.aliases ? { aliases: [...document.aliases] } : {}),
  }));
  materializeSpaPageDocumentsInPlace({
    applications,
    pages: graph.pages,
    routes: graph.routes,
    documents,
    pageConfigs,
  });
  return {
    ...graph,
    applications,
    documents,
  };
}

/**
 * Materialize Page-owned Documents only for static SPA SSG Pages. They inherit
 * the Application template and mount, while an output collision relocates the
 * shared Application fallback to a framework-owned path.
 */
function materializeSpaPageDocumentsInPlace(options: {
  applications: Record<string, CoreApplicationNode>;
  pages: Record<string, CorePageNode>;
  routes: CoreRouteNode[];
  documents: Record<string, CoreDocumentNode>;
  pageConfigs: Record<string, ResolvedPageFileConfig>;
}): void {
  const { applications, pages, routes, documents, pageConfigs } = options;
  for (const [pageId, page] of Object.entries(pages)) {
    const config = getOwn(pageConfigs, pageId);
    const application = getOwn(applications, page.applicationId);
    if (!application || application.routingMode !== "spa") continue;
    if (!config?.document && page.render !== "ssg") continue;
    if (page.render !== "ssg") {
      throw new Error(
        `[evjs] Page "${pageId}" config "${config?.source ?? page.source.config ?? page.source.module}" document requires an independently materialized Page Document. SPA render mode "${page.render}" shares its Application Document; use render "ssg" or move Document configuration to the Application owner.`,
      );
    }
    const source = config?.source ?? page.source.config ?? page.source.module;
    const pageRoutes = routes.filter(
      (route): route is CorePageClientRoute =>
        route.target.kind === "page" && route.target.pageId === pageId,
    );
    if (pageRoutes.length !== 1) {
      throw new Error(
        `[evjs] SPA SSG Page "${pageId}" config "${source}" requires exactly one semantic Route to materialize its Page-owned Document; found ${pageRoutes.length}.`,
      );
    }
    const route = pageRoutes[0];
    if (!route) continue;
    const output = createRouteIndexDocumentOutput(route.pattern);
    if (!output) {
      throw new Error(
        `[evjs] SPA SSG Page "${pageId}" config "${source}" cannot materialize dynamic Route "${formatRoutePattern(route.pattern)}" as one static HTML output.`,
      );
    }
    const applicationDocument = Object.values(documents).find(
      (document) =>
        document.applicationId === application.id &&
        document.owner.kind === "application",
    );
    if (!applicationDocument) {
      throw new Error(
        `[evjs] SPA SSG Page "${pageId}" config "${source}" requires an Application Document template.`,
      );
    }
    if (
      Object.values(documents).some(
        (document) =>
          document.owner.kind === "page" && document.owner.pageId === pageId,
      )
    ) {
      throw new Error(
        `[evjs] SPA SSG Page "${pageId}" config "${source}" already owns a Document.`,
      );
    }
    const documentId = createPageDocumentId(pageId, documents);
    const aliases = config?.document?.aliases;
    defineRecordValue(documents, documentId, {
      id: documentId,
      template: applicationDocument.template,
      output,
      ...(aliases?.length ? { aliases: [...aliases] } : {}),
      applicationId: application.id,
      owner: { kind: "page", pageId },
      ...(applicationDocument.mount
        ? { mount: applicationDocument.mount }
        : {}),
      bootstrap: { kind: "page", pageId },
      provenance: {
        producer: page.provenance.producer,
        source,
      },
    });
    application.documentIds.push(documentId);
    if (applicationDocument.output === output) {
      applicationDocument.output = createApplicationFallbackOutput(
        application.id,
        documents,
        applicationDocument.id,
      );
    }
  }
}

function createPageDocumentId(
  pageId: string,
  documents: Record<string, CoreDocumentNode>,
): string {
  if (!getOwn(documents, pageId)) return pageId;
  const base = `page:${pageId}`;
  if (!getOwn(documents, base)) return base;
  let suffix = 2;
  while (getOwn(documents, `${base}:${suffix}`)) suffix += 1;
  return `${base}:${suffix}`;
}

function createApplicationFallbackOutput(
  applicationId: string,
  documents: Record<string, CoreDocumentNode>,
  documentId: string,
): string {
  const occupied = new Set(
    Object.values(documents).flatMap((document) =>
      document.id === documentId
        ? []
        : [document.output, ...(document.aliases ?? [])],
    ),
  );
  const slug = applicationId.replace(/[^A-Za-z0-9._~-]+/g, "_") || "app";
  let output = `__evjs/${slug}.html`;
  let suffix = 2;
  while (occupied.has(output)) {
    output = `__evjs/${slug}-${suffix}.html`;
    suffix += 1;
  }
  return output;
}

function formatRoutePattern(pattern: CoreRoutePattern): string {
  if (pattern.segments.length === 0) return "/";
  return `/${pattern.segments
    .map((segment) =>
      segment.kind === "static"
        ? segment.value
        : segment.kind === "param"
          ? `$${segment.name}`
          : `$...${segment.name}`,
    )
    .join("/")}`;
}

function createCanonicalMpaDocumentOutput(route: CoreClientRouteNode): string {
  const dynamic = route.pattern.segments.find(
    (segment) => segment.kind !== "static",
  );
  if (dynamic) {
    throw new Error(
      `[evjs] Canonical MPA Route "${route.id}" cannot materialize dynamic segment "${dynamic.kind === "param" ? `$${dynamic.name}` : "$..."}" as one static HTML document. Use routing.mode "spa".`,
    );
  }
  const output = createRouteHtmlDocumentOutput(route.pattern);
  if (output) return output;
  throw new Error(
    `[evjs] Canonical MPA Route "${route.id}" contains a non-static segment after materialization validation.`,
  );
}

function parseRoutePattern(pathname: string): CoreRoutePattern {
  if (pathname === "/") return { segments: [] };
  const segments = pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map<CoreRouteSegment>((segment) => {
      if (segment === "$" || segment === "*") {
        return { kind: "splat", name: "_splat" };
      }
      if (segment.startsWith("$")) {
        return { kind: "param", name: segment.slice(1) };
      }
      if (segment.startsWith(":")) {
        return { kind: "param", name: segment.slice(1) };
      }
      if (segment.startsWith("*")) {
        return { kind: "splat", name: segment.slice(1) || "_splat" };
      }
      return { kind: "static", value: segment };
    });
  return { segments };
}

function createRecord<T>(): Record<string, T> {
  return {};
}

function cloneRecord<T>(
  record: Record<string, T>,
  clone: (value: T) => T,
): Record<string, T> {
  const resolved = createRecord<T>();
  for (const [key, value] of Object.entries(record)) {
    defineRecordValue(resolved, key, clone(value));
  }
  return resolved;
}

function defineRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function getOwn<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
