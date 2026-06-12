import type {
  AppGraph,
  BuildEntry,
  BuildPlan,
  BuildPlanUpdate,
  ComponentModel,
  FileRouteNode,
  HtmlPlan,
  HydrationMode,
  PprConfig,
  PrerenderConfig,
  RenderMode,
  RuntimePlan,
  ServerBuildPlan,
  ServerRenderPlan,
  SharedDependencyMap,
} from "@evjs/shared/manifest";
import { isRouteDerivedPage } from "@evjs/shared/manifest";

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
  fileRoutes?: {
    mode: "spa" | "mpa";
    dir: string;
    entry?: string;
    html: string;
    mount: string;
    routes: FileRouteNode[];
    rootModule?: string;
  };
  transport?: {
    baseUrl?: string;
  };
  remote?: {
    name: string;
    baseUrl: string;
    shared?: SharedDependencyMap;
    entries: Record<
      string,
      {
        app: string;
        activeWhen?: string[];
        mount?: string;
      }
    >;
  };
  serverEnabled: boolean;
  server: {
    entry?: string;
    basePath: string;
    functionRuntime: {
      endpoint: string;
      clientProxy: string;
      serverRegister: string;
    };
    runtime?: {
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
  const serverRenderers = createServerRenderers(config, graph);
  const entries = createEntries(config, graph, serverRenderers);
  const html = createHtmlPlans(graph);
  const server = createServerPlan(config, serverRenderers);
  const remote = createRemotePlan(graph);

  return {
    version: 1,
    buildId: options.buildId ?? mode,
    mode,
    distDir: options.distDir ?? "dist",
    serverEnabled: config.serverEnabled,
    entries,
    html,
    server,
    remote,
    runtime: {
      publicPath: options.publicPath ?? "/",
      server: config.serverEnabled
        ? {
            basePath: config.server.basePath,
            fn: config.server.functionRuntime.endpoint,
            ppr: hasPprPages(graph)
              ? joinPath(config.server.basePath, "ppr")
              : undefined,
            rsc: hasRscPages(graph)
              ? (config.server.runtime?.rsc ??
                joinPath(config.server.basePath, "rsc"))
              : config.server.runtime?.rsc,
          }
        : undefined,
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
      previous.serverEnabled !== next.serverEnabled ||
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
  const remoteEntries = Object.values(graph.remote?.entries ?? {});

  for (const app of apps) {
    entries.push({
      name: app.id === "default" ? "main" : app.id,
      import: app.entry,
      environment: "client",
      runtime: "browser",
      kind: "app-client",
      owner: { appId: app.id },
      ...(config.fileRoutes?.mode === "spa" &&
      config.fileRoutes.entry === app.entry
        ? {
            metadata: {
              type: "file-route-app",
              routes: config.fileRoutes.routes.map((route) => ({ ...route })),
              mount: config.fileRoutes.mount,
              ...(config.fileRoutes.rootModule
                ? { rootModule: config.fileRoutes.rootModule }
                : {}),
            },
          }
        : {}),
    });
  }

  for (const page of pages) {
    if (isPartialPrerenderPage(page) && !config.serverEnabled) {
      throw new Error(
        `[evjs] Page "${page.id}" uses partial prerendering but server is disabled.`,
      );
    }
    if (page.render !== "csr" && !config.serverEnabled) {
      throw new Error(
        `[evjs] Page "${page.id}" uses render: "${page.render}" but server is disabled.`,
      );
    }
    if (isPartialPrerenderPage(page) && !page.component) {
      throw new Error(
        `[evjs] Page "${page.id}" uses partial prerendering but does not declare a component page module.`,
      );
    }

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
          owner: renderer.owner,
        })),
    );
  }

  for (const entry of remoteEntries) {
    const name = `${graph.remote?.name ?? "remote"}-${entry.id}`;
    entries.push({
      name,
      import: entry.app,
      environment: "client",
      runtime: "browser",
      kind: "remote-client",
      owner: {
        remoteId: graph.remote?.name,
        remoteEntryId: entry.id,
      },
      metadata: {
        type: "remote-client",
        app: entry.app,
      },
    });
  }

  if (hasRscPages(graph)) {
    entries.push({
      name: "evjs-rsc-client",
      import: "@evjs/client",
      environment: "client",
      runtime: "browser",
      kind: "runtime",
    });
  }

  if (config.serverEnabled) {
    entries.push({
      name: "server",
      import: resolveServerEntry(config, serverRenderers),
      environment: "server",
      runtime: "node",
      kind: "server-runtime",
    });
  }

  return entries;
}

function createRemotePlan(graph: AppGraph): BuildPlan["remote"] {
  if (!graph.remote) return undefined;

  return {
    name: graph.remote.name,
    baseUrl: graph.remote.baseUrl,
    ...(graph.remote.shared ? { shared: graph.remote.shared } : {}),
    entries: Object.fromEntries(
      Object.entries(graph.remote.entries).map(([entryId, entry]) => [
        entryId,
        {
          id: entry.id,
          name: `${graph.remote?.name ?? "remote"}-${entry.id}`,
          app: entry.app,
          activeWhen: entry.activeWhen,
          mount: entry.mount,
        },
      ]),
    ),
  };
}

function createServerRenderers(
  config: BuildPlanConfig,
  graph: AppGraph,
): ServerRenderPlan[] {
  if (!config.serverEnabled) return [];

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
  if (page.component && page.hydrate === "none" && page.render !== "csr") {
    return undefined;
  }
  if (page.component)
    return {
      import: page.component,
      metadata: {
        type: "react-component-page",
        component: page.component,
        mount: page.mount ?? "#app",
        hydrate: page.hydrate ?? defaultHydrate(page.render ?? "csr"),
        render: page.render ?? "csr",
        ...(page.path
          ? { route: { id: page.routeId ?? page.id, path: page.path } }
          : {}),
      },
    };
  return undefined;
}

function createHtmlPlans(graph: AppGraph): HtmlPlan[] {
  const apps = Object.values(graph.apps);
  const pages = Object.values(graph.pages);

  return [
    ...apps.map((app) => ({
      id: app.id === "default" ? "index" : app.id,
      template: app.html,
      fileName: app.id === "default" ? "index.html" : `${app.id}.html`,
      owner: { appId: app.id },
    })),
    ...pages.filter(shouldEmitDocumentForPage).map((page) => ({
      id: page.id,
      template: page.html,
      fileName: `${page.id}.html`,
      owner: { pageId: page.id },
    })),
  ];
}

function shouldEmitDocumentForPage(page: {
  path?: string;
  routeId?: string;
  render: RenderMode;
}): boolean {
  if (isRouteDerivedPage(page)) return false;
  if (page.path && page.render !== "csr") return false;
  return true;
}

function createServerPlan(
  config: BuildPlanConfig,
  renderers: ServerRenderPlan[],
): ServerBuildPlan {
  if (!config.serverEnabled) {
    return { enabled: false };
  }

  return {
    enabled: true,
    entry: resolveServerEntry(config, renderers),
    ...(renderers.length > 0 ? { renderers } : {}),
    functionRuntime: {
      endpoint: config.server.functionRuntime.endpoint,
      clientProxy: config.server.functionRuntime.clientProxy,
      serverRegister: config.server.functionRuntime.serverRegister,
    },
  };
}

function resolveServerEntry(
  config: BuildPlanConfig,
  _renderers: ServerRenderPlan[],
): string {
  if (config.server.entry) return config.server.entry;
  return "@evjs/server/fetch";
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

function isRscPage(page: { componentModel?: ComponentModel }): boolean {
  return page.componentModel === "rsc";
}

function isPartialPrerenderPage(page: {
  prerender?: PrerenderConfig;
  ppr?: PprConfig;
}): boolean {
  return (
    (typeof page.prerender === "object" && page.prerender.partial === true) ||
    Boolean(page.ppr)
  );
}

function joinPath(base: string, segment: string): string {
  return `${base.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`;
}

function buildEntryKey(entry: BuildEntry): string {
  return `${entry.environment}:${entry.name}`;
}

function sanitizePageId(pageId: string): string {
  return pageId.replace(/[^a-zA-Z0-9_-]+/g, "_");
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
