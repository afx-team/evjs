import type {
  ClientReferenceNode,
  CoreApplicationNode,
  CoreClientRouteNode,
  CoreDocumentNode,
  CoreDocumentRouteNode,
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
import type { ResolvedPageFileConfig } from "../page-config-module.js";
import type { GraphConfig } from "./index.js";

const PAGE_ANCHOR_PRODUCER = {
  kind: "provider",
  id: PAGE_ANCHOR_PROVIDER_ID,
} as const;

export const PAGE_ANCHOR_ROOT_LAYOUT_ROUTE_ID =
  "@evjs/provider/page-anchor:root-layout";

/** Apply adjacent Page config to normalized Core Page fields. */
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
  const resolved: CoreGraph = {
    ...graph,
    pages,
  };
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
 * Normalize the canonical page-anchor provider into the Core 0.3 graph.
 *
 * Page and semantic Route identity are topology-neutral. SPA materializes one
 * Application-owned Document; MPA materializes one Page-owned Document for
 * every static Page Route while retaining the same semantic client Routes for
 * plugin inspection.
 */
export function createPageAnchorGraph(
  config: GraphConfig,
  facts: PageAnchorGraphFacts,
  pageConfigs: Record<string, ResolvedPageFileConfig> = {},
): CoreGraph {
  if (!isPageAnchorGraphConfig(config)) {
    throw new Error(
      "[evjs] CoreGraph page-anchor normalization requires canonical page.* discovery without an application.routes migration input.",
    );
  }
  const pageConfig = config as PageAnchorGraphConfig;

  const topology = pageConfig.routing.mode;
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
      render: resolvedPageConfig?.render ?? "csr",
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
      extensions: {},
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
  const rootLayoutRouteIds = new Map<string, string>();

  if (pageConfig.routing.rootModule) {
    const applicationId = "default";
    rootLayoutRouteIds.set(applicationId, PAGE_ANCHOR_ROOT_LAYOUT_ROUTE_ID);
    routes.push({
      realm: "client",
      id: PAGE_ANCHOR_ROOT_LAYOUT_ROUTE_ID,
      applicationId,
      pattern: { segments: [] },
      target: { kind: "group" },
      facets: { layout: pageConfig.routing.rootModule, wrappers: [] },
      extensions: {},
      provenance: {
        producer: PAGE_ANCHOR_PRODUCER,
        source: pageConfig.routing.rootModule,
      },
    });
    getOwn(applications, applicationId)?.routeIds.push(
      PAGE_ANCHOR_ROOT_LAYOUT_ROUTE_ID,
    );
  }

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
      : rootLayoutRouteIds.get(applicationId);
    const layout =
      mergedLayout?.module ??
      (route.kind === "layout" ? route.module : undefined);
    routes.push({
      realm: "client",
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
      extensions: {},
      provenance: {
        producer: PAGE_ANCHOR_PRODUCER,
        source: route.module,
      },
    });
    getOwn(applications, applicationId)?.routeIds.push(route.id);
  }

  if (topology === "mpa") {
    materializePageAnchorMpaDocuments(
      pageConfig,
      routeFacts,
      applications,
      pages,
      routes,
      documents,
    );
  }

  const coreGraph: CoreGraph = {
    rootDir: facts.rootDir,
    applications,
    pages,
    routes,
    documents,
    extensions: { namespaces: {} },
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
  if (!config.routing || config.application) return false;
  if (config.routing.metadata) return true;
  const pageRoutes = config.routing.routes.filter(
    (route) => route.kind !== "layout",
  );
  return (
    pageRoutes.length > 0 &&
    pageRoutes.every(
      (route) =>
        route.scope?.kind === "directory" &&
        /(?:^|\/)page\.(?:[cm]?[jt]sx?)$/.test(route.module),
    )
  );
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
      topology: "mpa",
      pageIds: [],
      routeIds: [],
      documentIds: [],
      extensions: {},
      provenance: {
        producer: PAGE_ANCHOR_PRODUCER,
        source: config.routing.dir,
      },
    });
    return;
  }

  defineRecordValue(applications, "default", {
    id: "default",
    root: ".",
    topology: "spa",
    pageIds: [],
    routeIds: [],
    documentIds: ["index"],
    extensions: {},
    provenance: {
      producer: PAGE_ANCHOR_PRODUCER,
      source: config.routing.dir,
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
    extensions: {},
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

function materializePageAnchorMpaDocuments(
  config: PageAnchorGraphConfig,
  routeFacts: PageAnchorRouteFact[],
  applications: Record<string, CoreApplicationNode>,
  pages: Record<string, CorePageNode>,
  routes: CoreRouteNode[],
  documents: Record<string, CoreDocumentNode>,
): void {
  const application = getOwn(applications, "default");
  if (!application) {
    throw new Error(
      '[evjs] Canonical MPA materialization requires Application "default".',
    );
  }
  const semanticPageRoutes = routes.filter(
    (route): route is CorePageClientRoute =>
      route.realm === "client" && route.target.kind === "page",
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
    const documentId = pageId;
    defineRecordValue(documents, documentId, {
      id: documentId,
      template: pageFact.html ?? config.routing.html,
      output,
      applicationId: route.applicationId,
      owner: { kind: "page", pageId },
      mount: config.routing.mount,
      bootstrap: { kind: "page", pageId },
      extensions: {},
      provenance: {
        producer: PAGE_ANCHOR_PRODUCER,
        source: pageFact.html ?? config.routing.html,
      },
    });

    const documentRoute: CoreDocumentRouteNode = {
      realm: "document",
      id: `document:${route.id}`,
      applicationId: route.applicationId,
      pattern: route.pattern,
      target: { kind: "document", documentId },
      extensions: {},
      provenance: {
        producer: PAGE_ANCHOR_PRODUCER,
        source: page.source.module,
      },
    };
    routes.push(documentRoute);
    application.documentIds.push(documentId);
    application.routeIds.push(documentRoute.id);
  }

  for (const pageId of Object.keys(pages)) {
    if (!routeByPageId.has(pageId)) {
      throw new Error(
        `[evjs] Canonical MPA Page "${pageId}" has no semantic file Route.`,
      );
    }
  }
}

function createCanonicalMpaDocumentOutput(route: CoreClientRouteNode): string {
  const dynamic = route.pattern.segments.find(
    (segment) => segment.kind !== "static",
  );
  if (dynamic) {
    throw new Error(
      `[evjs] Canonical MPA Route "${route.id}" cannot materialize dynamic segment "${dynamic.kind === "param" ? `$${dynamic.name}` : "$..."}" as a static HTML document yet. Use routing.mode "spa".`,
    );
  }
  const directory = route.pattern.segments
    .map((segment) => {
      if (segment.kind !== "static") {
        throw new Error(
          `[evjs] Canonical MPA Route "${route.id}" contains a non-static segment after materialization validation.`,
        );
      }
      return segment.value;
    })
    .join("/");
  return directory ? `${directory}/index.html` : "index.html";
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
