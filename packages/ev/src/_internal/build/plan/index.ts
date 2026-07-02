import type {
  AppGraph,
  BuildEntry,
  BuildPlan,
  BuildPlanUpdate,
  ComponentModel,
  HtmlPlan,
  HydrationMode,
  PageRouteNode,
  PprConfig,
  PrerenderConfig,
  RenderMode,
  RuntimePlan,
  ServerBuildPlan,
  ServerMiddlewareNode,
  ServerRenderPlan,
} from "@evjs/shared/manifest";
import { isRouteDerivedPage } from "@evjs/shared/manifest";
import {
  isPartialPrerenderPage,
  isRscPage,
  validatePageBuildContract,
} from "../page-rendering-contract.js";
import { sortPageRoutes } from "../page-route-order.js";
import { PAGES_APP_ENTRY_IMPORT } from "../pages-entry.js";
import type { DiscoveredServerRouteNode } from "../server-routes.js";
import { SERVER_ROUTES_ENTRY_IMPORT } from "../server-routes-entry.js";
import { sanitizePageId } from "../utils.js";

const DEFAULT_PUBLIC_PATH: RuntimePlan["publicPath"] = "auto";
const FRAMEWORK_SERVER_FETCH_ENTRY = "@evjs/ev/_internal/server/fetch";
const DEFAULT_RESOLVE_ALIAS = {
  "@": "./src",
} as const satisfies NonNullable<BuildPlan["resolve"]>["alias"];

export interface BuildPlanConfig {
  entry: string;
  html: string;
  pages?: Record<
    string,
    {
      path?: string;
      entry?: string;
      component?: string;
      app?: string;
      html: string;
      render?: RenderMode;
      componentModel?: ComponentModel;
      hydrate?: HydrationMode;
      prerender?: PrerenderConfig;
      mount?: string;
      ppr?: PprConfig;
    }
  >;
  apps?: Record<
    string,
    | string
    | {
        source?: string;
        entry?: string;
        html?: string;
        mount?: string;
      }
  >;
  routing?: {
    mode: "spa" | "mpa";
    dir: string;
    entry?: string;
    html: string;
    mount: string;
    conventions?: {
      layout: boolean | string;
    };
    routes: PageRouteNode[];
    rootModule?: string;
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

export function createBuildPlan(
  config: BuildPlanConfig,
  graph: AppGraph,
  options: CreateBuildPlanOptions = {},
): BuildPlan {
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
    serverChanged:
      previous.output.clientDir !== next.output.clientDir ||
      previous.output.serverDir !== next.output.serverDir ||
      stableStringify(previous.server) !== stableStringify(next.server),
  };
}

function createEntries(
  config: BuildPlanConfig,
  graph: AppGraph,
  serverRenderers: ServerRenderPlan[],
): BuildEntry[] {
  const entries: BuildEntry[] = [];
  const pages = Object.values(graph.pages);
  const apps = Object.values(graph.apps);
  const spaRoutingEntry = getSpaRoutingEntry(config);

  for (const app of apps) {
    if (isStaticOnlyRoutingApp(config, graph, app.id)) continue;

    const pagesAppRouting =
      config.routing?.mode === "spa" && spaRoutingEntry === app.entry
        ? config.routing
        : undefined;
    entries.push({
      name: app.id === "default" ? "main" : app.id,
      import: pagesAppRouting ? PAGES_APP_ENTRY_IMPORT : app.entry,
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: app.id },
      ...(pagesAppRouting
        ? {
            metadata: {
              type: "pages-app",
              routes: createPagesAppRoutes(graph, app.id),
              mount: pagesAppRouting.mount,
              ...(pagesAppRouting.rootModule
                ? { rootModule: pagesAppRouting.rootModule }
                : {}),
            },
          }
        : {}),
    });
  }

  for (const page of pages) {
    if (!isRouteDerivedPage(page)) {
      const pageEntry = getPageClientEntry(page);
      if (pageEntry) {
        entries.push({
          name: page.id,
          import: pageEntry.import,
          environment: "client",
          runtime: "browser",
          kind: "page-client",
          owner: { pageId: page.id },
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
      name: "server",
      import: serverEntry.import,
      environment: "server",
      runtime: "node",
      kind: "server-runtime",
      ...(serverEntry.metadata ? { metadata: serverEntry.metadata } : {}),
    });
  }

  return entries;
}

function createPagesAppRoutes(graph: AppGraph, appId: string): PageRouteNode[] {
  return sortPageRoutes(
    graph.routes.flatMap((route) => {
      if (route.appId !== appId || !route.module) return [];
      return [
        {
          id: route.id,
          path: route.path,
          module: route.module,
          ...(route.parentId ? { parentId: route.parentId } : {}),
          ...(route.kind ? { kind: route.kind } : {}),
          ...(route.errorModule ? { errorModule: route.errorModule } : {}),
          ...(route.notFoundModule
            ? { notFoundModule: route.notFoundModule }
            : {}),
        },
      ];
    }),
  );
}

function validatePageBuildContracts(graph: AppGraph): void {
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

function createServerRenderers(graph: AppGraph): ServerRenderPlan[] {
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

function getPageServerEntry(page: {
  entry?: string;
  component?: string;
  app?: string;
}): string | undefined {
  return page.component ?? page.app ?? page.entry;
}

function isBuildOnlySsgPage(page: {
  render: RenderMode;
  componentModel?: ComponentModel;
  prerender?: PrerenderConfig;
  ppr?: PprConfig;
  hydrate?: HydrationMode;
}): boolean {
  return (
    page.render === "ssg" &&
    !isRscPage(page) &&
    !isPartialPrerenderPage(page) &&
    (page.hydrate ?? defaultHydrate(page.render)) === "none"
  );
}

function getPageClientEntry(page: {
  id: string;
  entry?: string;
  component?: string;
  app?: string;
  path?: string;
  routeId?: string;
  render?: RenderMode;
  componentModel?: ComponentModel;
  prerender?: PrerenderConfig;
  ppr?: PprConfig;
  hydrate?: HydrationMode;
  mount?: string;
}):
  | { import: string; metadata?: NonNullable<BuildEntry["metadata"]> }
  | undefined {
  if (isPartialPrerenderPage(page)) return undefined;
  if (page.entry) return { import: page.entry };
  if (page.app) return { import: page.app };
  if (isRscPage(page)) return undefined;
  const hydrate = page.hydrate ?? defaultHydrate(page.render ?? "csr");
  if (page.component && hydrate === "none" && page.render !== "csr") {
    return undefined;
  }
  if (page.component)
    return {
      import: page.component,
      metadata: {
        type: "react-component-page",
        component: page.component,
        mount: page.mount ?? "#app",
        hydrate,
        render: page.render ?? "csr",
        ...(page.path
          ? { route: { id: page.routeId ?? page.id, path: page.path } }
          : {}),
      },
    };
  return undefined;
}

function getSpaRoutingEntry(
  config: Pick<BuildPlanConfig, "entry" | "routing">,
): string | undefined {
  if (config.routing?.mode !== "spa") return undefined;
  return config.routing.entry ?? config.entry;
}

function createHtmlPlans(config: BuildPlanConfig, graph: AppGraph): HtmlPlan[] {
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
        fileName: `${page.id}.html`,
        owner: { pageId: page.id },
      })),
  ];
}

function isStaticOnlyRoutingApp(
  config: BuildPlanConfig,
  graph: AppGraph,
  appId: string,
): boolean {
  if (config.routing?.mode !== "spa") return false;

  const routes = graph.routes.filter((route) => route.appId === appId);
  if (routes.length === 0) return false;

  return routes.every((route) => isStaticSsgRoute(graph, route));
}

function isStaticSsgRoute(graph: AppGraph, route: AppGraph["routes"][number]) {
  if (route.kind === "layout" || !route.pageId) return false;
  if (!isStaticPagePath(route.path)) return false;

  const page = graph.pages[route.pageId];
  return page ? isBuildOnlySsgPage(page) : false;
}

function shouldEmitDocumentForPage(
  config: BuildPlanConfig,
  page: {
    id: string;
    component?: string;
    path?: string;
    routeId?: string;
    render: RenderMode;
  },
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
  graph: AppGraph,
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
  graph: AppGraph,
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
      import: SERVER_ROUTES_ENTRY_IMPORT,
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
  graph: AppGraph,
): DiscoveredServerRouteNode[] {
  const configured = config.server.routing?.routes ?? [];
  if (configured.length === 0) return [];
  const graphIds = new Set(graph.serverRoutes.map((route) => route.id));
  return configured.filter((route) => graphIds.has(route.id));
}

function readBuildMode(): "development" | "production" {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function defaultHydrate(render: RenderMode): HydrationMode {
  if (render === "ssg") return "none";
  return "load";
}

function hasPprPages(graph: AppGraph): boolean {
  return Object.values(graph.pages).some(isPartialPrerenderPage);
}

function hasRscPages(graph: AppGraph): boolean {
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
