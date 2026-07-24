import type {
  AppNode,
  BuildEntry,
  BuildPlan,
  BuildPlanUpdate,
  CoreGraph,
  HtmlPlan,
  PageNode,
  PageRouteNode,
  PagesAppRouteNode,
  RouteNode,
  RuntimePlan,
  ServerBuildPlan,
  ServerMiddlewareNode,
  ServerRenderPlan,
} from "@evjs/shared/manifest";
import {
  clonePageMetadata,
  getClientRouteMatches,
  getServerRenderedPaths,
  isRouteDerivedPage,
} from "@evjs/shared/manifest";
import type { PageRouteDiscoveryMetadata } from "../../../config/index.js";
import {
  GENERATED_PAGES_APP_BUILD_ENTRY,
  SERVER_RUNTIME_BUILD_ENTRY_NAME,
} from "../build-entry-conventions.js";
import {
  isPartialPrerenderPage,
  isRscPage,
  validatePageBuildContract,
} from "../page-rendering-contract.js";
import { sortPageRoutes } from "../page-route-order.js";
import type { DiscoveredServerRouteNode } from "../server-routes.js";
import { sanitizePageId } from "../utils.js";

const DEFAULT_PUBLIC_PATH: RuntimePlan["publicPath"] = "auto";
const FRAMEWORK_SERVER_FETCH_ENTRY = "@evjs/ev/_internal/server/fetch";
const DEFAULT_RESOLVE_ALIAS = {
  "@": "./src",
} as const satisfies NonNullable<BuildPlan["resolve"]>["alias"];

interface BuildPlanFacts {
  rootDir: string;
  apps: Record<string, AppNode>;
  pages: Record<string, PageNode>;
  routes: RouteNode[];
  serverFunctions: CoreGraph["serverFunctions"];
  serverRoutes: CoreGraph["serverRoutes"];
  clientReferences?: CoreGraph["clientReferences"];
  serverReferences?: CoreGraph["serverReferences"];
}

export interface BuildPlanConfig {
  routing?: {
    mode: "spa" | "mpa";
    dir: string;
    html: string;
    mount: string;
    routes: PageRouteNode[];
    rootModule?: string;
    metadata?: PageRouteDiscoveryMetadata;
    dependencies?: string[];
  };
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
  const apps: Record<string, AppNode> = {};
  const pages: Record<string, PageNode> = {};
  const routes: RouteNode[] = [];
  const clientRoutes = graph.routes.filter((route) => route.realm === "client");

  for (const application of Object.values(graph.applications)) {
    const hasClientRoutes = clientRoutes.some(
      (route) => route.applicationId === application.id,
    );
    if (application.topology !== "spa" || !hasClientRoutes) continue;
    const entry = GENERATED_PAGES_APP_BUILD_ENTRY;
    const document = application.documentIds
      .map((id) => graph.documents[id])
      .find(
        (candidate) =>
          candidate?.owner.kind === "application" &&
          candidate.applicationId === application.id,
      );
    if (!document) {
      throw new Error(
        `[evjs] Application "${application.id}" with client entry "${entry}" must own one Document.`,
      );
    }
    apps[application.id] = {
      id: application.id,
      entry,
      html: document.template,
      ...(document.mount ? { mount: document.mount } : {}),
    };
  }

  for (const page of Object.values(graph.pages)) {
    const application = graph.applications[page.applicationId];
    const route = clientRoutes.find(
      (candidate) =>
        candidate.target.kind === "page" && candidate.target.pageId === page.id,
    );
    const pageDocument = Object.values(graph.documents).find(
      (document) =>
        document.owner.kind === "page" && document.owner.pageId === page.id,
    );
    const applicationDocument = application?.documentIds
      .map((id) => graph.documents[id])
      .find((document) => document?.owner.kind === "application");
    const document = pageDocument ?? applicationDocument;
    pages[page.id] = {
      id: page.id,
      scope: page.source.scope,
      ...(application?.topology === "mpa" && route
        ? { path: formatCoreRoutePattern(route.pattern) }
        : {}),
      ...(route ? { routeId: route.id } : {}),
      component: page.source.module,
      html: document?.template ?? "",
      ...(pageDocument?.output ? { output: pageDocument.output } : {}),
      render: page.render,
      ...(page.componentModel ? { componentModel: page.componentModel } : {}),
      ...(page.hydrate ? { hydrate: page.hydrate } : {}),
      ...(document?.mount ? { mount: document.mount } : {}),
      ...(page.prerender ? { prerender: page.prerender } : {}),
      ...(page.ppr ? { ppr: page.ppr } : {}),
      ...(page.metadata ? { metadata: clonePageMetadata(page.metadata) } : {}),
    };
  }

  for (const route of clientRoutes) {
    const path = formatCoreRoutePattern(route.pattern);
    const page =
      route.target.kind === "page"
        ? graph.pages[route.target.pageId]
        : undefined;
    const target: RouteNode["target"] =
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
    rootDir: graph.rootDir,
    apps,
    pages,
    routes,
    serverFunctions: graph.serverFunctions,
    serverRoutes: graph.serverRoutes,
    ...(graph.clientReferences
      ? { clientReferences: graph.clientReferences }
      : {}),
    ...(graph.serverReferences
      ? { serverReferences: graph.serverReferences }
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
  const html = createHtmlPlans(config, graph);
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
      clientRoutes: getClientRouteMatches(graph),
      serverRoutePaths: [
        ...new Set([
          ...graph.serverRoutes.map((route) => route.path),
          ...getServerRenderedPaths(graph),
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
    serverChanged:
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
    if (isStaticOnlyRoutingApp(config, graph, app.id)) continue;

    const isGeneratedPagesApp = app.entry === GENERATED_PAGES_APP_BUILD_ENTRY;
    entries.push({
      name: app.id === "default" ? "main" : app.id,
      import: app.entry,
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: app.id },
      ...(isGeneratedPagesApp
        ? {
            metadata: {
              type: "pages-app",
              routes: createPagesAppRoutes(graph, app.id),
              mount: app.mount ?? "#app",
            },
          }
        : {}),
    });
  }

  for (const page of pages) {
    if (!isRouteDerivedPage(page)) {
      const pageEntry = getPageClientEntry(config, page);
      if (pageEntry) {
        entries.push({
          name: page.id,
          import: pageEntry.import,
          environment: "client",
          runtime: "browser",
          kind: "page-client",
          owner: createPageBuildOwner(config, page.id),
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
  const routes = graph.routes.flatMap<PagesAppRouteNode>((route) => {
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
  if (routes.every((route) => route.target === undefined && route.module)) {
    return sortPageRoutes(routes as PageRouteNode[]);
  }
  return routes;
}

function validatePageBuildContracts(graph: BuildPlanFacts): void {
  for (const page of Object.values(graph.pages)) {
    validatePageBuildContract(`Page "${page.id}"`, page);
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
    const existing = htmlByFileName.get(document.fileName);
    if (existing) {
      throw new Error(
        `[evjs] Duplicate HTML output file "${document.fileName}" from ${describeHtmlOwner(
          existing,
        )} and ${describeHtmlOwner(document)}. HTML output filenames must be unique.`,
      );
    }
    htmlByFileName.set(document.fileName, document);
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
      const pageServerEntry = getPageServerEntry(page);
      if (pageServerEntry) {
        renderers.push({
          name: `${page.id}-server`,
          import: pageServerEntry,
          kind: "page-server",
          owner: pageOwner(page),
        });
        renderers.push({
          name: `${page.id}-rsc`,
          import: pageServerEntry,
          kind: "rsc-page",
          owner: pageOwner(page),
        });
      }
    } else if (isPartialPrerenderPage(page) && page.component) {
      renderers.push({
        name: `${page.id}-ppr-shell`,
        import: page.component,
        kind: "ppr-shell",
        owner: pageOwner(page),
      });
    } else {
      const pageServerEntry = getPageServerEntry(page);
      if (pageServerEntry) {
        renderers.push({
          name: `${page.id}-server`,
          import: pageServerEntry,
          kind: "page-server",
          ...(isBuildOnlySsgPage(page) ? { phase: "build" as const } : {}),
          owner: pageOwner(page),
        });
      }
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

function getPageServerEntry(page: PageNode): string | undefined {
  return page.component;
}

function isBuildOnlySsgPage(page: PageNode): boolean {
  return (
    page.render === "ssg" &&
    !isRscPage(page) &&
    !isPartialPrerenderPage(page) &&
    (page.hydrate ?? defaultHydrate(page.render)) === "none"
  );
}

function getPageClientEntry(
  config: BuildPlanConfig,
  page: PageNode,
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
      ...createCanonicalMpaPageLayouts(config, page),
      mount: page.mount ?? "#app",
      hydrate,
      render: page.render,
      ...(page.path
        ? { route: { id: page.routeId ?? page.id, path: page.path } }
        : {}),
    },
  };
}

function createCanonicalMpaPageLayouts(
  config: BuildPlanConfig,
  page: PageNode,
): { layouts?: string[] } {
  if (
    config.routing?.mode !== "mpa" ||
    !isCanonicalPageRouting(config.routing)
  ) {
    return {};
  }

  const routesById = new Map(
    config.routing.routes.map((route) => [route.id, route]),
  );
  const route =
    routesById.get(page.routeId ?? page.id) ??
    config.routing.routes.find(
      (candidate) =>
        candidate.kind !== "layout" &&
        candidate.path === page.path &&
        candidate.module === page.component,
    );
  const nestedLayouts: string[] = [];
  const visited = new Set<string>();
  let parentId = route?.parentId;
  while (parentId) {
    if (visited.has(parentId)) {
      throw new Error(
        `[evjs] Canonical MPA Page "${page.id}" has a circular layout parent chain at Route "${parentId}".`,
      );
    }
    visited.add(parentId);
    const parent = routesById.get(parentId);
    if (!parent) {
      throw new Error(
        `[evjs] Canonical MPA Page "${page.id}" references missing layout Route "${parentId}".`,
      );
    }
    if (parent.kind === "layout") {
      nestedLayouts.unshift(parent.module);
    }
    parentId = parent.parentId;
  }

  const layouts = [
    ...(config.routing.rootModule ? [config.routing.rootModule] : []),
    ...nestedLayouts,
  ];
  return layouts.length > 0 ? { layouts: [...new Set(layouts)] } : {};
}

function createHtmlPlans(
  config: BuildPlanConfig,
  graph: BuildPlanFacts,
): HtmlPlan[] {
  const apps = Object.values(graph.apps);
  const pages = Object.values(graph.pages);

  return [
    ...apps
      .filter((app) => !isStaticOnlyRoutingApp(config, graph, app.id))
      .map((app) => ({
        id: app.id === "default" ? "index" : app.id,
        template: app.html,
        fileName: app.id === "default" ? "index.html" : `${app.id}.html`,
        owner: { appId: app.id },
      })),
    ...pages
      .filter((page) => shouldEmitDocumentForPage(config, page))
      .map((page) => ({
        id: page.id,
        template: page.html,
        fileName: page.output ?? `${page.id}.html`,
        owner: createPageBuildOwner(config, page.id),
        ...(page.metadata
          ? { metadata: clonePageMetadata(page.metadata) }
          : {}),
      })),
  ];
}

function createPageBuildOwner(
  config: Pick<BuildPlanConfig, "routing">,
  pageId: string,
): { appId?: string; pageId: string } {
  if (
    config.routing?.mode === "mpa" &&
    isCanonicalPageRouting(config.routing)
  ) {
    return { appId: "default", pageId };
  }
  return { pageId };
}

function isCanonicalPageRouting(
  routing: NonNullable<BuildPlanConfig["routing"]>,
): boolean {
  if (routing.metadata) return true;
  const pageRoutes = routing.routes.filter((route) => route.kind !== "layout");
  return (
    pageRoutes.length > 0 &&
    pageRoutes.every(
      (route) =>
        route.scope?.kind === "directory" &&
        /(?:^|\/)page\.(?:[cm]?[jt]sx?)$/.test(route.module),
    )
  );
}

function isStaticOnlyRoutingApp(
  config: BuildPlanConfig,
  graph: BuildPlanFacts,
  appId: string,
): boolean {
  if (config.routing?.mode !== "spa") return false;

  const routes = graph.routes.filter((route) => route.appId === appId);
  if (routes.length === 0) return false;

  return routes.every((route) => isStaticSsgRoute(graph, route));
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

function shouldEmitDocumentForPage(
  config: BuildPlanConfig,
  page: PageNode,
): boolean {
  if (isMpaFileRoutePage(config, page) && page.render === "ssg") return true;
  const pagePath = getPageRoutePath(config, page);
  if (page.render === "ssg" && pagePath && isStaticPagePath(pagePath)) {
    return true;
  }

  // Route-derived pages are served through the owning app/framework route.
  // In SPA mode this avoids colliding with the app HTML fallback.
  if (isRouteDerivedPage(page)) return false;
  if (page.path && page.render !== "csr") return false;
  return true;
}

function getPageRoutePath(
  config: BuildPlanConfig,
  page: {
    id: string;
    path?: string;
    routeId?: string;
  },
): string | undefined {
  return (
    page.path ??
    config.routing?.routes.find(
      (route) => route.id === (page.routeId ?? page.id),
    )?.path
  );
}

function isMpaFileRoutePage(
  config: BuildPlanConfig,
  page: {
    id: string;
    component?: string;
    path?: string;
    routeId?: string;
  },
): boolean {
  if (config.routing?.mode !== "mpa") return false;
  return config.routing.routes.some(
    (route) =>
      route.id === (page.routeId ?? page.id) &&
      route.path === page.path &&
      route.module === page.component,
  );
}

function isStaticPagePath(pathname: string): boolean {
  return !/(^|\/)(?:[$:]|[*])/.test(pathname);
}

function createServerPlan(
  config: BuildPlanConfig,
  graph: BuildPlanFacts,
  renderers: ServerRenderPlan[],
): ServerBuildPlan {
  const entry = createServerRuntimeEntry(config, graph, renderers)?.import;
  return {
    ...(entry ? { entry } : {}),
    ...(renderers.length > 0 ? { renderers } : {}),
  };
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
  render: PageNode["render"],
): NonNullable<PageNode["hydrate"]> {
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
