import type {
  AppRouteTarget,
  BuildEntry,
  BuildPlan,
  BuildPlanUpdate,
  CoreApplicationNode,
  CoreClientRouteNode,
  CoreGraph,
  CorePageNode,
  HtmlPlan,
  PagesAppRouteNode,
  ReactPageLayer,
  RuntimePlan,
  ServerBuildPlan,
  ServerDocumentPlan,
  ServerMiddlewareNode,
  ServerRenderPlan,
} from "@evjs/shared/manifest";
import { clonePageMetadata } from "@evjs/shared/manifest";
import {
  GENERATED_PAGES_APP_BUILD_ENTRY,
  SERVER_RUNTIME_BUILD_ENTRY_NAME,
} from "../build-entry-conventions.js";
import { createStaticPageDocumentOutput } from "../page-document-output.js";
import {
  isPartialPrerenderPage,
  isRscPage,
  validatePageBuildContract,
} from "../page-rendering-contract.js";
import type { DiscoveredServerRouteNode } from "../server-routes.js";
import { sanitizePageId } from "../utils.js";

const DEFAULT_PUBLIC_PATH: RuntimePlan["publicPath"] = "auto";
const FRAMEWORK_SERVER_FETCH_ENTRY = "@evjs/ev/_internal/server/fetch";
const FRAMEWORK_SPA_FALLBACK_OUTPUT_DIR = "__evjs";
const DEFAULT_RESOLVE_ALIAS = {
  "@": "./src",
} as const satisfies NonNullable<BuildPlan["resolve"]>["alias"];

interface BuildApplicationFacts {
  id: string;
  html: string;
  documentOutput: string;
  documentAliases?: string[];
  mount?: string;
  rootModule?: string;
}

interface BuildPageFacts
  extends Pick<
    CorePageNode,
    | "id"
    | "render"
    | "componentModel"
    | "hydrate"
    | "prerender"
    | "ppr"
    | "metadata"
  > {
  applicationId: string;
  routingMode: CoreApplicationNode["routingMode"];
  scope: CorePageNode["source"]["scope"];
  routePath?: string;
  routeId?: string;
  component: string;
  documentId?: string;
  /** Logical filename of the selected Page or Application Document. */
  html: string;
  documentOutput?: string;
  documentAliases?: string[];
  /** Concrete Page-owned static output; Application fallback is not copied. */
  output?: string;
  mount?: string;
  layers?: ReactPageLayer[];
}

interface BuildRouteFacts extends PagesAppRouteNode {
  appId: string;
  pageId?: string;
}

interface BuildPlanFacts {
  apps: Record<string, BuildApplicationFacts>;
  pages: Record<string, BuildPageFacts>;
  routes: BuildRouteFacts[];
  devClientRoutes: BuildPlan["dev"]["clientRoutes"];
  serverRenderedRoutePaths: string[];
  serverFunctions: CoreGraph["serverFunctions"];
  serverRoutes: CoreGraph["serverRoutes"];
  clientReferences?: CoreGraph["clientReferences"];
}

export interface BuildPlanConfig {
  transport?: {
    baseUrl?: string;
  };
  output: {
    client: string;
    server: string;
  };
  server: {
    routing?: {
      dir: string;
      routes: DiscoveredServerRouteNode[];
    };
    conventions?: {
      globalMiddlewares: ServerMiddlewareNode[];
      routeMiddlewares: ServerMiddlewareNode[];
    };
    basePath: string;
    runtime: {
      fn: string;
      ppr?: string;
      rsc?: string;
    };
  };
}

export interface CreateBuildPlanOptions {
  mode?: "development" | "production";
  buildId?: string;
  distDir?: string;
  publicPath?: RuntimePlan["publicPath"];
}

function deriveBuildPlanFacts(graph: CoreGraph): BuildPlanFacts {
  const apps: Record<string, BuildApplicationFacts> = {};
  const pages: Record<string, BuildPageFacts> = {};
  const routes: BuildRouteFacts[] = [];
  const clientRoutes = graph.routes;
  const routeById = new Map(clientRoutes.map((route) => [route.id, route]));
  const routesByPageId = new Map<string, CoreClientRouteNode[]>();
  const pageDocumentByPageId = new Map<
    string,
    CoreGraph["documents"][string]
  >();
  const applicationDocumentById = new Map<
    string,
    CoreGraph["documents"][string]
  >();

  for (const route of clientRoutes) {
    if (route.target.kind === "page") {
      const routes = routesByPageId.get(route.target.pageId) ?? [];
      routes.push(route);
      routesByPageId.set(route.target.pageId, routes);
    }
  }
  for (const document of Object.values(graph.documents)) {
    if (document.owner.kind === "page") {
      const previous = pageDocumentByPageId.get(document.owner.pageId);
      if (previous) {
        throw new Error(
          `[evjs] Page "${document.owner.pageId}" owns more than one Document: "${previous.id}" and "${document.id}".`,
        );
      }
      pageDocumentByPageId.set(document.owner.pageId, document);
    } else if (document.owner.kind === "application") {
      const previous = applicationDocumentById.get(document.applicationId);
      if (previous) {
        throw new Error(
          `[evjs] Application "${document.applicationId}" owns more than one Application Document: "${previous.id}" and "${document.id}".`,
        );
      }
      applicationDocumentById.set(document.applicationId, document);
    }
  }

  for (const application of Object.values(graph.applications)) {
    const hasClientRoutes = clientRoutes.some(
      (route) => route.applicationId === application.id,
    );
    if (application.routingMode !== "spa" || !hasClientRoutes) continue;
    const document = applicationDocumentById.get(application.id);
    if (!document) {
      throw new Error(
        `[evjs] Application "${application.id}" with client entry "${GENERATED_PAGES_APP_BUILD_ENTRY}" must own one Document.`,
      );
    }
    apps[application.id] = {
      id: application.id,
      html: document.template,
      documentOutput: document.output,
      ...(document.aliases ? { documentAliases: [...document.aliases] } : {}),
      ...(document.mount ? { mount: document.mount } : {}),
      ...(application.layout ? { rootModule: application.layout } : {}),
    };
  }

  for (const page of Object.values(graph.pages)) {
    const application = graph.applications[page.applicationId];
    if (!application) {
      throw new Error(
        `[evjs] Page "${page.id}" references missing Application "${page.applicationId}".`,
      );
    }
    const pageRoutes = routesByPageId.get(page.id) ?? [];
    const pageDocument = pageDocumentByPageId.get(page.id);
    const applicationDocument = applicationDocumentById.get(application.id);
    if (
      pageRoutes.length > 1 &&
      (page.render !== "csr" || pageDocument !== undefined)
    ) {
      throw new Error(
        `[evjs] Page "${page.id}" is targeted by multiple Routes (${pageRoutes
          .map((route) => `"${route.id}"`)
          .join(
            ", ",
          )}), but independently rendered Pages must map to exactly one URL.`,
      );
    }
    const route = pageRoutes[0];
    const document = pageDocument ?? applicationDocument;
    const composition = route
      ? collectPageComposition(application, routeById, route, page.id)
      : [];
    pages[page.id] = {
      id: page.id,
      applicationId: page.applicationId,
      routingMode: application.routingMode,
      scope: page.source.scope,
      ...(route ? { routePath: formatCoreRoutePattern(route.pattern) } : {}),
      ...(route ? { routeId: route.id } : {}),
      component: page.source.module,
      ...(document ? { documentId: document.id } : {}),
      html: document?.template ?? "",
      ...(document?.output ? { documentOutput: document.output } : {}),
      ...(pageDocument?.aliases
        ? { documentAliases: [...pageDocument.aliases] }
        : {}),
      ...(pageDocument?.output ? { output: pageDocument.output } : {}),
      render: page.render,
      ...(page.componentModel ? { componentModel: page.componentModel } : {}),
      ...(page.hydrate ? { hydrate: page.hydrate } : {}),
      ...(document?.mount ? { mount: document.mount } : {}),
      ...(page.prerender ? { prerender: page.prerender } : {}),
      ...(page.ppr ? { ppr: page.ppr } : {}),
      ...(page.metadata ? { metadata: clonePageMetadata(page.metadata) } : {}),
      ...(composition.length > 0 ? { layers: composition } : {}),
    };
  }

  for (const route of clientRoutes) {
    const path = formatCoreRoutePattern(route.pattern);
    const page =
      route.target.kind === "page"
        ? graph.pages[route.target.pageId]
        : undefined;
    const target: AppRouteTarget =
      route.target.kind === "page"
        ? { kind: "page", pageId: route.target.pageId }
        : route.target.kind === "group"
          ? { kind: "group" }
          : {
              kind: "redirect",
              to:
                route.target.to.kind === "url"
                  ? { kind: "url", href: route.target.to.href }
                  : {
                      kind: "path",
                      path: formatCoreRoutePattern(route.target.to.pattern),
                    },
            };
    const layoutModule =
      typeof route.facets.layout === "string" ? route.facets.layout : undefined;
    if (layoutModule && route.target.kind === "page") {
      const layoutId = `${route.id}:layout`;
      routes.push({
        id: layoutId,
        path,
        ...(route.parentId ? { parentId: route.parentId } : {}),
        kind: "layout",
        appId: route.applicationId,
        module: layoutModule,
        ...(route.facets.error ? { errorModule: route.facets.error } : {}),
        ...(route.facets.notFound
          ? { notFoundModule: route.facets.notFound }
          : {}),
      });
      routes.push({
        id: route.id,
        path,
        parentId: layoutId,
        appId: route.applicationId,
        pageId: route.target.pageId,
        module: page?.source.module,
        target,
        wrappers: [...route.facets.wrappers],
      });
      continue;
    }
    routes.push({
      id: route.id,
      path,
      ...(route.parentId ? { parentId: route.parentId } : {}),
      ...(layoutModule ? { kind: "layout" as const } : {}),
      appId: route.applicationId,
      ...(route.target.kind === "page"
        ? {
            pageId: route.target.pageId,
            module: page?.source.module,
          }
        : layoutModule
          ? { module: layoutModule }
          : {}),
      target,
      wrappers: [...route.facets.wrappers],
      ...(route.facets.layout === false ? { layout: false as const } : {}),
      ...(route.facets.error ? { errorModule: route.facets.error } : {}),
      ...(route.facets.notFound
        ? { notFoundModule: route.facets.notFound }
        : {}),
    });
  }

  return {
    apps,
    pages,
    routes,
    devClientRoutes: createDevClientRoutes(graph),
    serverRenderedRoutePaths: createServerRenderedRoutePaths(graph),
    serverFunctions: graph.serverFunctions,
    serverRoutes: graph.serverRoutes,
    ...(graph.clientReferences
      ? { clientReferences: graph.clientReferences }
      : {}),
  };
}

function formatCoreRoutePattern(
  pattern: CoreGraph["routes"][number]["pattern"],
): string {
  if (pattern.segments.length === 0) return "/";
  return `/${pattern.segments
    .map((segment) => {
      if (segment.kind === "static") return segment.value;
      if (segment.kind === "param") return `$${segment.name}`;
      return "$";
    })
    .join("/")}`;
}

function collectPageComposition(
  application: CoreApplicationNode,
  routesById: ReadonlyMap<string, CoreClientRouteNode>,
  route: CoreClientRouteNode,
  pageId: string,
): ReactPageLayer[] {
  const innerToOuter: CoreClientRouteNode[] = [];
  const visited = new Set<string>();
  let current: CoreClientRouteNode | undefined = route;

  while (current) {
    if (visited.has(current.id)) {
      throw new Error(
        `[evjs] Page "${pageId}" has a circular layout parent chain at Route "${current.id}".`,
      );
    }
    visited.add(current.id);
    innerToOuter.push(current);
    if (!current.parentId) break;
    const parentId: string = current.parentId;
    current = routesById.get(parentId);
    if (!current) {
      throw new Error(
        `[evjs] Page "${pageId}" references missing layout Route "${parentId}".`,
      );
    }
  }

  const routeChain = innerToOuter.reverse();
  const bypassApplicationLayout = routeChain.some(
    (candidate) => candidate.facets.layout === false,
  );
  const layers: ReactPageLayer[] = [];
  if (application.layout && !bypassApplicationLayout) {
    layers.push({ kind: "layout", module: application.layout });
  }
  for (const candidate of routeChain) {
    if (typeof candidate.facets.layout === "string") {
      layers.push({ kind: "layout", module: candidate.facets.layout });
    }
    layers.push(
      ...candidate.facets.wrappers.map((module) => ({
        kind: "wrapper" as const,
        module,
      })),
    );
  }
  return layers;
}

function createDevClientRoutes(
  graph: CoreGraph,
): BuildPlan["dev"]["clientRoutes"] {
  const routes: BuildPlan["dev"]["clientRoutes"] = [];
  const seen = new Set<string>();

  for (const route of graph.routes) {
    const application = graph.applications[route.applicationId];
    if (!application) continue;

    let target: BuildPlan["dev"]["clientRoutes"][number]["target"];
    if (route.target.kind === "page") {
      const page = graph.pages[route.target.pageId];
      if (!page || page.render !== "csr") continue;
      target =
        application.routingMode === "mpa"
          ? { kind: "page", pageId: page.id }
          : { kind: "app", appId: application.id };
    } else {
      if (application.routingMode !== "spa") continue;
      target = { kind: "app", appId: application.id };
    }

    const pathname = formatCoreRoutePattern(route.pattern);
    const key =
      target.kind === "page"
        ? `${pathname}:page:${target.pageId}`
        : `${pathname}:app:${target.appId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ path: pathname, target });
  }

  return routes;
}

function createServerRenderedRoutePaths(graph: CoreGraph): string[] {
  const paths = graph.routes.flatMap((route) => {
    if (route.target.kind !== "page") return [];
    const page = graph.pages[route.target.pageId];
    return page && page.render !== "csr"
      ? [formatCoreRoutePattern(route.pattern)]
      : [];
  });
  return [...new Set(paths)];
}

export function createBuildPlan(
  config: BuildPlanConfig,
  coreGraph: CoreGraph,
  options: CreateBuildPlanOptions = {},
): BuildPlan {
  const graph = deriveBuildPlanFacts(coreGraph);
  const mode = options.mode ?? readBuildMode();
  validatePageBuildContracts(graph);
  const serverRenderers = createServerRenderers(graph);
  const entries = createEntries(config, graph, serverRenderers);
  const html = createHtmlPlans(graph);
  validateBuildOutputNames(entries, html);
  const server = createServerPlan(config, graph, serverRenderers);

  return {
    version: 1,
    buildId: options.buildId ?? mode,
    mode,
    distDir: options.distDir ?? "dist",
    output: {
      clientDir: config.output.client,
      serverDir: config.output.server,
    },
    resolve: {
      alias: {
        ...DEFAULT_RESOLVE_ALIAS,
      },
    },
    entries,
    html,
    server,
    runtime: {
      publicPath: options.publicPath ?? DEFAULT_PUBLIC_PATH,
      server: {
        basePath: config.server.basePath,
        fn: config.server.runtime.fn,
        ppr: hasPprPages(graph)
          ? (config.server.runtime.ppr ??
            toRuntimeEndpoint(joinPath(config.server.basePath, "ppr")))
          : undefined,
        rsc: hasRscPages(graph)
          ? (config.server.runtime.rsc ??
            toRuntimeEndpoint(joinPath(config.server.basePath, "rsc")))
          : config.server.runtime.rsc,
      },
      transport: config.transport,
    },
    dev: {
      clientRoutes: graph.devClientRoutes,
      serverRoutePaths: [
        ...new Set([
          ...graph.serverRoutes.map((route) => route.path),
          ...graph.serverRenderedRoutePaths,
        ]),
      ],
      hasPpr: hasPprPages(graph),
    },
    ...((graph.clientReferences?.length ?? 0) > 0
      ? {
          rsc: {
            clientReferenceModules: [
              ...new Set(
                graph.clientReferences?.map((reference) => reference.module),
              ),
            ],
          },
        }
      : {}),
  };
}

export function diffBuildPlan(
  previous: BuildPlan,
  next: BuildPlan,
  reason: BuildPlanUpdate["reason"],
): BuildPlanUpdate {
  const runtimeChanged =
    stableStringify(previous.runtime) !== stableStringify(next.runtime);
  return {
    reason,
    previous,
    next,
    entries: diffByKey(previous.entries, next.entries, buildEntryKey),
    html: diffByKey(previous.html, next.html, (html) => html.id),
    generatedChanged:
      stableStringify(previous.generated) !== stableStringify(next.generated),
    resolveChanged:
      stableStringify(previous.resolve) !== stableStringify(next.resolve),
    runtimeChanged,
    deliveryChanged: reason === "config",
    serverChanged:
      runtimeChanged ||
      previous.output.clientDir !== next.output.clientDir ||
      previous.output.serverDir !== next.output.serverDir ||
      stableStringify(previous.server) !== stableStringify(next.server) ||
      stableStringify(previous.dev) !== stableStringify(next.dev) ||
      stableStringify(previous.rsc) !== stableStringify(next.rsc),
  };
}

function createEntries(
  config: BuildPlanConfig,
  graph: BuildPlanFacts,
  serverRenderers: ServerRenderPlan[],
): BuildEntry[] {
  const entries: BuildEntry[] = [];
  const pages = Object.values(graph.pages);
  const apps = Object.values(graph.apps);

  for (const app of apps) {
    if (isClientlessStaticDocumentApp(graph, app.id)) continue;

    entries.push({
      name: app.id === "default" ? "main" : app.id,
      import: GENERATED_PAGES_APP_BUILD_ENTRY,
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: app.id },
      metadata: {
        type: "pages-app",
        routes: createPagesAppRoutes(graph, app.id),
        mount: app.mount ?? "#app",
        ...(app.rootModule ? { rootModule: app.rootModule } : {}),
      },
    });
  }

  for (const page of pages) {
    if (page.routingMode === "mpa") {
      const pageEntry = getPageClientEntry(page);
      if (pageEntry) {
        entries.push({
          name: page.id,
          import: pageEntry.import,
          environment: "client",
          runtime: "browser",
          kind: "page-client",
          owner: createPageBuildOwner(page),
          ...(pageEntry.metadata ? { metadata: pageEntry.metadata } : {}),
        });
      }
    }

    entries.push(
      ...serverRenderers
        .filter((renderer) => renderer.owner?.pageId === page.id)
        .map((renderer) => ({
          name: renderer.name,
          import: renderer.import,
          environment: "server" as const,
          runtime: "node" as const,
          kind: renderer.kind,
          ...(renderer.phase ? { phase: renderer.phase } : {}),
          owner: renderer.owner,
          ...(renderer.metadata ? { metadata: renderer.metadata } : {}),
        })),
    );
  }

  if (hasRscPages(graph)) {
    entries.push({
      name: "evjs-rsc-client",
      import: "@evjs/ev/_internal/client/rsc-runtime",
      environment: "client",
      runtime: "browser",
      kind: "runtime",
    });
  }

  const serverEntry = createServerRuntimeEntry(config, graph, serverRenderers);
  if (serverEntry) {
    entries.push({
      name: SERVER_RUNTIME_BUILD_ENTRY_NAME,
      import: serverEntry.import,
      environment: "server",
      runtime: "node",
      kind: "server-runtime",
      ...(serverEntry.metadata ? { metadata: serverEntry.metadata } : {}),
    });
  }

  return entries;
}

function createPagesAppRoutes(
  graph: BuildPlanFacts,
  appId: string,
): PagesAppRouteNode[] {
  return graph.routes.flatMap<PagesAppRouteNode>((route) => {
    if (route.appId !== appId) return [];
    if (!route.module && !route.target) return [];
    if (route.target?.kind === "page" && !route.module) {
      throw new Error(
        `[evjs] Application-route Page target "${route.id}" has no component module for the pages-app entry.`,
      );
    }
    const metadata =
      route.target?.kind === "page"
        ? clonePageMetadata(graph.pages[route.target.pageId]?.metadata)
        : undefined;
    return [
      {
        id: route.id,
        path: route.path,
        ...(route.module ? { module: route.module } : {}),
        ...(route.parentId ? { parentId: route.parentId } : {}),
        ...(route.kind ? { kind: route.kind } : {}),
        ...(route.target ? { target: route.target } : {}),
        ...(route.wrappers ? { wrappers: [...route.wrappers] } : {}),
        ...(route.layout === false ? { layout: false as const } : {}),
        ...(route.errorModule ? { errorModule: route.errorModule } : {}),
        ...(route.notFoundModule
          ? { notFoundModule: route.notFoundModule }
          : {}),
        ...(metadata ? { metadata } : {}),
      },
    ];
  });
}

function validatePageBuildContracts(graph: BuildPlanFacts): void {
  for (const page of Object.values(graph.pages)) {
    validatePageBuildContract(`Page "${page.id}"`, page);
    if (
      page.render === "ssg" &&
      page.routePath &&
      !isStaticPagePath(page.routePath)
    ) {
      throw new Error(
        `[evjs] Page "${page.id}" uses render "ssg" on dynamic Route "${page.routePath}", which does not identify one build-time HTML output. Use a static Route or render "ssr".`,
      );
    }
  }
}

function validateBuildOutputNames(
  entries: BuildEntry[],
  html: HtmlPlan[],
): void {
  const entriesByName = new Map<string, BuildEntry>();
  for (const entry of entries) {
    const existing = entriesByName.get(entry.name);
    if (existing) {
      throw new Error(
        `[evjs] Duplicate build entry name "${entry.name}" from ${describeBuildEntryOwner(
          existing,
        )} and ${describeBuildEntryOwner(entry)}. Build entry names are manifest asset keys and must be globally unique.`,
      );
    }
    entriesByName.set(entry.name, entry);
  }

  const htmlByFileName = new Map<string, HtmlPlan>();
  for (const document of html) {
    for (const fileName of [document.fileName, ...(document.aliases ?? [])]) {
      const existing = htmlByFileName.get(fileName);
      if (existing) {
        throw new Error(
          `[evjs] Duplicate HTML output file "${fileName}" from ${describeHtmlOwner(
            existing,
          )} and ${describeHtmlOwner(document)}. Canonical HTML outputs and aliases must be globally unique.`,
        );
      }
      htmlByFileName.set(fileName, document);
    }
  }
}

function describeBuildEntryOwner(entry: BuildEntry): string {
  if (entry.owner?.appId) return `app "${entry.owner.appId}"`;
  if (entry.owner?.pageId && entry.owner.regionId) {
    return `page "${entry.owner.pageId}" PPR region "${entry.owner.regionId}"`;
  }
  if (entry.owner?.pageId) return `page "${entry.owner.pageId}"`;
  return `${entry.kind} entry`;
}

function describeHtmlOwner(document: HtmlPlan): string {
  if (document.owner.appId) return `app "${document.owner.appId}"`;
  return `page "${document.owner.pageId}"`;
}

function createServerRenderers(graph: BuildPlanFacts): ServerRenderPlan[] {
  const renderers: ServerRenderPlan[] = [];
  for (const page of Object.values(graph.pages)) {
    if (page.render === "csr") continue;

    if (isRscPage(page)) {
      renderers.push({
        name: `${page.id}-server`,
        import: page.component,
        kind: "page-server",
        owner: pageOwner(page),
        metadata: createServerPageMetadata(page),
      });
      renderers.push({
        name: `${page.id}-rsc`,
        import: page.component,
        kind: "rsc-page",
        owner: pageOwner(page),
        metadata: createServerPageMetadata(page),
      });
    } else if (isPartialPrerenderPage(page)) {
      renderers.push({
        name: `${page.id}-ppr-shell`,
        import: page.component,
        kind: "ppr-shell",
        owner: pageOwner(page),
        metadata: createServerPageMetadata(page),
      });
    } else {
      renderers.push({
        name: `${page.id}-server`,
        import: page.component,
        kind: "page-server",
        ...(isBuildOnlySsgPage(page) ? { phase: "build" as const } : {}),
        owner: pageOwner(page),
        metadata: createServerPageMetadata(page),
      });
    }

    for (const [regionId, region] of Object.entries(page.ppr?.regions ?? {})) {
      renderers.push({
        name: `${page.id}-${sanitizePageId(regionId)}-ppr-region`,
        import: region.component,
        kind: "ppr-region",
        owner: pageOwner(page, { regionId }),
      });
    }
  }

  return renderers;
}

function createServerPageMetadata(
  page: BuildPageFacts,
): NonNullable<ServerRenderPlan["metadata"]> {
  return {
    type: "react-server-page",
    component: page.component,
    ...(page.layers?.length
      ? {
          layers: page.layers.map((layer) => ({ ...layer })),
        }
      : {}),
  };
}

function pageOwner(
  page: { id: string; routeId?: string },
  extra: { regionId?: string } = {},
): BuildEntry["owner"] {
  return {
    pageId: page.id,
    ...(page.routeId ? { routeId: page.routeId } : {}),
    ...extra,
  };
}

function isBuildOnlySsgPage(page: BuildPageFacts): boolean {
  return (
    page.render === "ssg" && !isRscPage(page) && !isPartialPrerenderPage(page)
  );
}

function getPageClientEntry(
  page: BuildPageFacts,
):
  | { import: string; metadata?: NonNullable<BuildEntry["metadata"]> }
  | undefined {
  if (isPartialPrerenderPage(page)) return undefined;
  if (isRscPage(page)) return undefined;
  const hydrate = page.hydrate ?? defaultHydrate(page.render);
  if (hydrate === "none" && page.render !== "csr") {
    return undefined;
  }
  return {
    import: page.component,
    metadata: {
      type: "react-component-page",
      component: page.component,
      ...(page.layers?.length
        ? { layers: page.layers.map((layer) => ({ ...layer })) }
        : {}),
      mount: page.mount ?? "#app",
      hydrate,
      render: page.render,
      ...(page.routePath
        ? { route: { id: page.routeId ?? page.id, path: page.routePath } }
        : {}),
    },
  };
}

function createHtmlPlans(graph: BuildPlanFacts): HtmlPlan[] {
  const apps = Object.values(graph.apps);
  const pages = Object.values(graph.pages);
  const pageDocuments: HtmlPlan[] = pages
    .filter(shouldEmitDocumentForPage)
    .map((page) => ({
      id: page.id,
      template: page.html,
      fileName: resolvePageDocumentOutput(page),
      ...(page.documentAliases ? { aliases: [...page.documentAliases] } : {}),
      owner: createPageBuildOwner(page),
      ...(page.metadata ? { metadata: clonePageMetadata(page.metadata) } : {}),
    }));
  const applicationDocuments: HtmlPlan[] = apps
    .filter((app) => !isStaticDocumentApp(graph, app.id))
    .map((app) => {
      const preferredOutput =
        app.documentOutput ??
        (app.id === "default" ? "index.html" : `${app.id}.html`);
      const conflictsWithPage = pageDocuments.some((document) => {
        if (document.fileName !== preferredOutput || !document.owner.pageId) {
          return false;
        }
        return graph.pages[document.owner.pageId]?.applicationId === app.id;
      });
      return {
        id: app.id === "default" ? "index" : app.id,
        template: app.html,
        fileName: conflictsWithPage
          ? `${FRAMEWORK_SPA_FALLBACK_OUTPUT_DIR}/${sanitizePageId(app.id)}.html`
          : preferredOutput,
        ...(app.documentAliases ? { aliases: [...app.documentAliases] } : {}),
        owner: { appId: app.id },
      };
    });

  return [...applicationDocuments, ...pageDocuments];
}

function resolvePageDocumentOutput(page: BuildPageFacts): string {
  if (page.output) return page.output;
  const output = page.routePath
    ? createStaticPageDocumentOutput(page.routePath)
    : undefined;
  if (page.render === "ssg" && output) return output;
  throw new Error(
    `[evjs] Page "${page.id}" does not resolve to a static semantic Route output.`,
  );
}

function createPageBuildOwner(
  page: Pick<BuildPageFacts, "applicationId" | "id" | "routingMode">,
): { appId?: string; pageId: string } {
  if (page.routingMode === "mpa") {
    return { appId: page.applicationId, pageId: page.id };
  }
  return { pageId: page.id };
}

function isStaticDocumentApp(graph: BuildPlanFacts, appId: string): boolean {
  const routes = getMaterializedAppRoutes(graph, appId);
  if (routes.length === 0) return false;

  return routes.every((route) => isStaticSsgRoute(graph, route));
}

function isClientlessStaticDocumentApp(
  graph: BuildPlanFacts,
  appId: string,
): boolean {
  const routes = getMaterializedAppRoutes(graph, appId);
  if (routes.length === 0) return false;

  return routes.every((route) => {
    if (!isStaticSsgRoute(graph, route) || !route.pageId) return false;
    const page = graph.pages[route.pageId];
    return (
      page !== undefined &&
      (page.hydrate ?? defaultHydrate(page.render)) === "none"
    );
  });
}

function getMaterializedAppRoutes(
  graph: BuildPlanFacts,
  appId: string,
): BuildRouteFacts[] {
  return graph.routes.filter(
    (route) => route.appId === appId && route.kind !== "layout",
  );
}

function isStaticSsgRoute(
  graph: BuildPlanFacts,
  route: BuildPlanFacts["routes"][number],
) {
  if (route.kind === "layout" || !route.pageId) return false;
  if (!isStaticPagePath(route.path)) return false;

  const page = graph.pages[route.pageId];
  return page ? isBuildOnlySsgPage(page) : false;
}

function shouldEmitDocumentForPage(page: BuildPageFacts): boolean {
  if (
    page.render === "ssg" &&
    page.routePath &&
    isStaticPagePath(page.routePath)
  ) {
    return true;
  }

  // Static SSG Pages emit route-owned Documents in either mode. CSR Page
  // Documents are emitted only by canonical MPA materialization.
  return page.routingMode === "mpa" && page.render === "csr";
}

function isStaticPagePath(pathname: string): boolean {
  return createStaticPageDocumentOutput(pathname) !== undefined;
}

function createServerPlan(
  config: BuildPlanConfig,
  graph: BuildPlanFacts,
  renderers: ServerRenderPlan[],
): ServerBuildPlan {
  const entry = createServerRuntimeEntry(config, graph, renderers)?.import;
  const documents = createServerDocumentPlans(graph);
  return {
    ...(entry ? { entry } : {}),
    ...(renderers.length > 0 ? { renderers } : {}),
    ...(documents.length > 0 ? { documents } : {}),
  };
}

function createServerDocumentPlans(
  graph: BuildPlanFacts,
): ServerDocumentPlan[] {
  return Object.values(graph.pages)
    .filter((page) => page.render === "ssr")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((page) => {
      if (!page.documentId || !page.html || !page.documentOutput) {
        throw new Error(
          `[evjs] Server-rendered Page "${page.id}" must resolve to one HTML Document template.`,
        );
      }

      return {
        pageId: page.id,
        documentId: page.documentId,
        applicationId: page.applicationId,
        template: page.html,
        fileName: page.documentOutput,
        mount: page.mount ?? "#app",
        ...(page.metadata
          ? { metadata: clonePageMetadata(page.metadata) }
          : {}),
      };
    });
}

function createServerRuntimeEntry(
  config: BuildPlanConfig,
  graph: BuildPlanFacts,
  renderers: ServerRenderPlan[],
): Pick<BuildEntry, "import" | "metadata"> | undefined {
  const routes = getConfiguredServerRoutes(config, graph);
  const middlewares = config.server.conventions?.globalMiddlewares ?? [];
  const serverFunctions = graph.serverFunctions;
  const runtimeRenderers = renderers.filter(
    (renderer) => renderer.phase !== "build",
  );
  if (
    routes.length > 0 ||
    middlewares.length > 0 ||
    serverFunctions.length > 0
  ) {
    return {
      import: FRAMEWORK_SERVER_FETCH_ENTRY,
      metadata: {
        type: "server-app",
        routes,
        ...(middlewares.length > 0 ? { middlewares } : {}),
        ...(serverFunctions.length > 0 ? { serverFunctions } : {}),
      },
    };
  }
  if (runtimeRenderers.length > 0) {
    return { import: FRAMEWORK_SERVER_FETCH_ENTRY };
  }
  return undefined;
}

function getConfiguredServerRoutes(
  config: BuildPlanConfig,
  graph: BuildPlanFacts,
): DiscoveredServerRouteNode[] {
  const configured = config.server.routing?.routes ?? [];
  if (configured.length === 0) return [];
  const graphIds = new Set(graph.serverRoutes.map((route) => route.id));
  return configured.filter((route) => graphIds.has(route.id));
}

function readBuildMode(): "development" | "production" {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function defaultHydrate(
  render: BuildPageFacts["render"],
): NonNullable<BuildPageFacts["hydrate"]> {
  if (render === "ssg") return "none";
  return "load";
}

function hasPprPages(graph: BuildPlanFacts): boolean {
  return Object.values(graph.pages).some(isPartialPrerenderPage);
}

function hasRscPages(graph: BuildPlanFacts): boolean {
  return Object.values(graph.pages).some(isRscPage);
}

function joinPath(base: string, segment: string): string {
  return `${base.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`;
}

function toRuntimeEndpoint(pathname: string): string {
  return pathname.startsWith("/") ? pathname.slice(1) : pathname;
}

function buildEntryKey(entry: BuildEntry): string {
  return `${entry.environment}:${entry.name}`;
}

function diffByKey<T>(
  previous: T[],
  next: T[],
  keyOf: (value: T) => string,
): {
  added: T[];
  removed: T[];
  changed: T[];
} {
  const previousByKey = new Map(previous.map((value) => [keyOf(value), value]));
  const nextByKey = new Map(next.map((value) => [keyOf(value), value]));
  const added: T[] = [];
  const removed: T[] = [];
  const changed: T[] = [];

  for (const [key, value] of nextByKey) {
    const oldValue = previousByKey.get(key);
    if (!oldValue) {
      added.push(value);
    } else if (stableStringify(oldValue) !== stableStringify(value)) {
      changed.push(value);
    }
  }

  for (const [key, value] of previousByKey) {
    if (!nextByKey.has(key)) {
      removed.push(value);
    }
  }

  return { added, removed, changed };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortObject(nested)]),
  );
}
