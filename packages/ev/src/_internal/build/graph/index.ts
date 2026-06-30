import fs from "node:fs/promises";
import path from "node:path";
import {
  getPageRouteParamSegmentValidationError,
  getPathPatternValidationError,
  type PageRouteParamSegmentValidationError,
  type PathPatternValidationError,
  serverRoutePathShapeFromPath,
} from "@evjs/shared";
import type {
  AppGraph,
  AppNode,
  ComponentModel,
  ExtractedRoute,
  HydrationMode,
  PageNode,
  PageRouteNode,
  PprConfig,
  PrerenderConfig,
  RenderMode,
  RouteNode,
  ServerFunctionNode,
  ServerMiddlewareNode,
  ServerRouteNode,
} from "@evjs/shared/manifest";
import { resolveRoutes } from "@evjs/shared/manifest";
import { parseSync } from "@swc/core";
import type { ModuleItem } from "@swc/types";
import {
  analyzePageModuleConfig,
  type PageModuleConfig,
} from "../page-module-config.js";
import { getPageBuildContractViolation } from "../page-rendering-contract.js";
import { routePathShapeFromPath } from "../page-route-conventions.js";
import { sortPageRoutes } from "../page-route-order.js";
import { isPagesAppEntryImport } from "../pages-entry.js";
import {
  extractPprRegionModuleConfig,
  extractPprRegions,
} from "../ppr-regions.js";
import {
  extractRscReferences,
  hasBlockingReferenceParseDiagnostic,
} from "../rsc-refs.js";
import {
  analyzeServerFunctionExports,
  type ServerFunctionExportAnalysis,
} from "../server-fns.js";
import type { DiscoveredServerRouteNode } from "../server-routes.js";
import {
  deriveRouteIdFromPath,
  detectUseServer,
  hashServerFunction,
  isInsideCwd,
  toPosixPath,
} from "../utils.js";

export interface GraphAnalysisResult {
  graph: AppGraph;
  diagnostics: Diagnostic[];
  fileDependencies: string[];
}

export interface Diagnostic {
  level: "warning" | "error";
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface GraphConfig {
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
  server: {
    routing?: {
      dir: string;
      routes: DiscoveredServerRouteNode[];
    };
    conventions?: {
      globalMiddlewares: ServerMiddlewareNode[];
      routeMiddlewares: ServerMiddlewareNode[];
    };
  };
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const DEFAULT_TOP_LEVEL_ENTRY = "./src/main.tsx";
const DEFAULT_SOURCE_ALIAS = "@/";

interface FrameworkSourceFiles {
  analysisFiles: string[];
  explicitDependencyFiles: Set<string>;
  diagnostics: Diagnostic[];
}

type PprRegionConfigMap = NonNullable<PprConfig["regions"]>;

export async function createAppGraph(
  config: GraphConfig,
  cwd: string,
): Promise<GraphAnalysisResult> {
  const diagnostics: Diagnostic[] = [];
  const configuredPageRoutes = validateConfiguredPageRoutes(
    config,
    diagnostics,
  );
  const configuredPagePathIds = validateConfiguredPagePaths(
    config,
    diagnostics,
  );

  const graph: AppGraph = {
    version: 1,
    rootDir: cwd,
    apps: {},
    pages: createPageNodes(config, configuredPageRoutes, configuredPagePathIds),
    routes: [],
    serverFunctions: [],
    serverRoutes: [],
  };

  const sourceCache = new Map<string, string>();
  const sourceFiles = await collectFrameworkSourceFiles(
    config,
    cwd,
    sourceCache,
  );
  diagnostics.push(...sourceFiles.diagnostics);
  graph.apps = createAppNodes(config);
  await mergeConfiguredPageModuleConfigs(
    config,
    graph,
    cwd,
    sourceCache,
    diagnostics,
  );
  // Watch explicit graph roots and files that already declare framework
  // semantics. Ordinary component edits should stay on the bundler HMR path.
  // If a plain component starts declaring routes/server functions later, a
  // configured route/server root or config change should introduce it into the
  // watched framework graph set.
  const fileDependencies = new Set(sourceFiles.explicitDependencyFiles);
  if (config.routing) {
    const routingDir = path.resolve(cwd, config.routing.dir);
    for (const dir of await collectRouteDirectories(routingDir)) {
      fileDependencies.add(dir);
    }
  }
  if (config.server.routing) {
    const routingDir = path.resolve(cwd, config.server.routing.dir);
    for (const dir of await collectRouteDirectories(routingDir)) {
      fileDependencies.add(dir);
    }
  }
  for (const middleware of [
    ...(config.server.conventions?.globalMiddlewares ?? []),
    ...(config.server.conventions?.routeMiddlewares ?? []),
  ]) {
    fileDependencies.add(path.resolve(cwd, middleware.module));
  }
  const clientRoutes: ExtractedRoute[] = [];
  const serverRoutes = new Map<string, ServerRouteNode>();
  const serverRoutePathOwners = new Map<string, ServerRouteNode>();
  const serverRouteShapeOwners = new Map<string, ServerRouteNode>();
  const serverFileRouteModules = new Set(
    (config.server.routing?.routes ?? []).map((route) =>
      path.resolve(cwd, route.module),
    ),
  );
  const serverConventionModules = new Set(
    [
      ...(config.server.conventions?.globalMiddlewares ?? []),
      ...(config.server.conventions?.routeMiddlewares ?? []),
    ].map((middleware) => path.resolve(cwd, middleware.module)),
  );
  const serverFunctions: ServerFunctionNode[] = [];
  const clientReferences = new Map<
    string,
    NonNullable<AppGraph["clientReferences"]>[number]
  >();
  const serverReferences = new Map<
    string,
    NonNullable<AppGraph["serverReferences"]>[number]
  >();
  const configuredServerRoutePublication = validateServerRouteNodePublication(
    config.server.routing?.routes ?? [],
    serverRoutePathOwners,
    serverRouteShapeOwners,
  );
  diagnostics.push(...configuredServerRoutePublication.diagnostics);
  for (const node of configuredServerRoutePublication.nodes) {
    serverRoutePathOwners.set(node.path, node);
    serverRouteShapeOwners.set(serverRoutePathShapeFromPath(node.path), node);
    serverRoutes.set(node.id, node);
  }

  for (const file of sourceFiles.analysisFiles) {
    const source = sourceCache.get(file) ?? (await fs.readFile(file, "utf-8"));
    if (
      sourceFiles.explicitDependencyFiles.has(file) ||
      isFrameworkDependencySource(source)
    ) {
      fileDependencies.add(file);
    }
    const sourceRel = toPosixPath(path.relative(cwd, file));
    const usesServerDirective = detectUseServer(source);
    const rscReferenceAnalysis = extractRscReferences(source, sourceRel);
    const hasRscReferenceDiagnostics =
      rscReferenceAnalysis.diagnostics.length > 0;
    diagnostics.push(
      ...rscReferenceAnalysis.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        file: sourceRel,
      })),
    );

    if (serverFileRouteModules.has(file) || serverConventionModules.has(file)) {
      continue;
    }

    if (hasBlockingReferenceParseDiagnostic(rscReferenceAnalysis)) {
      continue;
    }

    let serverFunctionAnalysis: ServerFunctionExportAnalysis = {
      exports: [],
      diagnostics: [],
    };
    if (!(usesServerDirective && hasRscReferenceDiagnostics)) {
      serverFunctionAnalysis = analyzeServerFunctionExports(source);
    }
    const hasServerFunctionDiagnostics =
      serverFunctionAnalysis.diagnostics.length > 0;
    diagnostics.push(
      ...serverFunctionAnalysis.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        file: sourceRel,
      })),
    );

    if (hasRscReferenceDiagnostics || hasServerFunctionDiagnostics) {
      continue;
    }

    for (const reference of rscReferenceAnalysis.clientReferences) {
      clientReferences.set(reference.id, reference);
    }
    for (const reference of rscReferenceAnalysis.serverReferences) {
      serverReferences.set(reference.id, reference);
    }
    for (const { exportName } of serverFunctionAnalysis.exports) {
      serverFunctions.push({
        id: hashServerFunction(sourceRel, exportName),
        module: sourceRel,
        exportName,
      });
    }
  }

  const defaultAppId = getDefaultAppId(graph, getSpaRoutingEntry(config));
  if (config.routing?.mode === "spa") {
    for (const route of sortPageRoutes(configuredPageRoutes)) {
      clientRoutes.push(
        await mergeRouteModuleConfig(
          cwd,
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
            ...(defaultAppId ? { appId: defaultAppId } : {}),
          },
          sourceCache,
          diagnostics,
        ),
      );
    }
  }
  clientRoutes.push(...createConfiguredPageRoutes(graph));

  graph.routes = resolveRoutes(clientRoutes).map<RouteNode>((route) => {
    const routeId = route.id ?? route.path;
    const configuredPageId = getConfiguredPageRouteId(graph, route);
    if (configuredPageId) {
      graph.pages[configuredPageId].routeId ??= routeId;
    }
    const pageId =
      configuredPageId ??
      createRouteDerivedPageNode(config, graph, route, routeId, diagnostics);
    const appId = route.appId ?? defaultAppId;
    return {
      id: routeId,
      path: route.path,
      ...(route.parentId ? { parentId: route.parentId } : {}),
      ...(route.kind ? { kind: route.kind } : {}),
      ...(appId ? { appId } : {}),
      ...(pageId ? { pageId } : {}),
      ...(route.module ? { module: route.module } : {}),
      ...(route.errorModule ? { errorModule: route.errorModule } : {}),
      ...(route.notFoundModule ? { notFoundModule: route.notFoundModule } : {}),
      ...(route.render ? { render: route.render } : {}),
      ...(route.hydrate ? { hydrate: route.hydrate } : {}),
      ...(route.runtime ? { runtime: route.runtime } : {}),
    };
  });
  await mergePprRegionsFromPageModules(
    graph,
    cwd,
    sourceCache,
    diagnostics,
    fileDependencies,
  );
  validateGraphPageContracts(graph, diagnostics);
  graph.serverRoutes = [...serverRoutes.values()];
  graph.serverFunctions = serverFunctions;
  graph.clientReferences = [...clientReferences.values()];
  graph.serverReferences = [...serverReferences.values()];

  return {
    graph,
    diagnostics,
    fileDependencies: [...fileDependencies].sort(),
  };
}

function validateServerRouteNodePublication(
  routes: ServerRouteNode[],
  serverRoutePathOwners: Map<string, ServerRouteNode>,
  serverRouteShapeOwners: Map<string, ServerRouteNode>,
): { nodes: ServerRouteNode[]; diagnostics: Diagnostic[] } {
  const nodes: ServerRouteNode[] = [];
  const diagnostics: Diagnostic[] = [];
  const pendingPathOwners = new Map(serverRoutePathOwners);
  const pendingShapeOwners = new Map(serverRouteShapeOwners);

  for (const route of routes) {
    const existing = pendingPathOwners.get(route.path);
    if (existing) {
      diagnostics.push({
        level: "error",
        file: route.module,
        message:
          `Server route path "${route.path}" is already declared by ${existing.module}. ` +
          "Declare all HTTP methods for a path in one server file route module.",
      });
      continue;
    }
    const routeShape = serverRoutePathShapeFromPath(route.path);
    const existingShapeOwner = pendingShapeOwners.get(routeShape);
    if (existingShapeOwner) {
      diagnostics.push({
        level: "error",
        file: route.module,
        message:
          `Server route path "${route.path}" has the same route shape as ${existingShapeOwner.module} (${existingShapeOwner.path}). ` +
          "Use one route handler per URL shape.",
      });
      continue;
    }
    pendingPathOwners.set(route.path, route);
    pendingShapeOwners.set(routeShape, route);
    nodes.push({
      id: route.id,
      module: route.module,
      path: route.path,
      methods: route.methods,
    });
  }

  return { nodes, diagnostics };
}

async function mergeConfiguredPageModuleConfigs(
  config: GraphConfig,
  graph: AppGraph,
  cwd: string,
  sourceCache: Map<string, string>,
  diagnostics: Diagnostic[],
) {
  for (const [pageId] of Object.entries(graph.pages)) {
    const page = graph.pages[pageId];
    if (!page?.component) continue;

    const analysis = await readPageModuleConfig(
      cwd,
      page.component,
      sourceCache,
    );
    if (!analysis) continue;

    diagnostics.push(...analysis.diagnostics);
    applyPageModuleConfig(
      page,
      analysis.config,
      getConfiguredPageModuleConfig(config.pages?.[pageId]),
    );
  }
}

function getConfiguredPageModuleConfig(
  page: NonNullable<GraphConfig["pages"]>[string] | undefined,
): PageModuleConfig {
  if (!page) return {};
  return {
    ...(page.render ? { render: page.render } : {}),
    ...(page.componentModel ? { componentModel: page.componentModel } : {}),
    ...(page.hydrate ? { hydrate: page.hydrate } : {}),
    ...(page.prerender ? { prerender: page.prerender } : {}),
  };
}

async function mergeRouteModuleConfig(
  cwd: string,
  route: ExtractedRoute,
  sourceCache: Map<string, string>,
  diagnostics: Diagnostic[],
): Promise<ExtractedRoute> {
  if (!route.module) return route;

  const analysis = await readPageModuleConfig(cwd, route.module, sourceCache);
  if (!analysis) return route;

  diagnostics.push(...analysis.diagnostics);
  const moduleConfig = analysis.config;
  const ppr = derivePprConfig(moduleConfig.prerender);
  return {
    ...route,
    ...(route.render === undefined && moduleConfig.render
      ? { render: moduleConfig.render }
      : {}),
    ...(route.hydrate === undefined && moduleConfig.hydrate
      ? { hydrate: moduleConfig.hydrate }
      : {}),
    ...(moduleConfig.componentModel
      ? { componentModel: moduleConfig.componentModel }
      : {}),
    ...(moduleConfig.prerender ? { prerender: moduleConfig.prerender } : {}),
    ...(ppr ? { ppr } : {}),
  };
}

async function readPageModuleConfig(
  cwd: string,
  component: string,
  sourceCache: Map<string, string>,
): Promise<
  | {
      config: PageModuleConfig;
      diagnostics: Diagnostic[];
    }
  | undefined
> {
  const absolute = await resolveProjectSourceAbsolute(cwd, component);
  if (!absolute) return undefined;

  let source: string;
  try {
    source =
      sourceCache.get(absolute) ?? (await fs.readFile(absolute, "utf-8"));
    sourceCache.set(absolute, source);
  } catch {
    return undefined;
  }

  const analysis = analyzePageModuleConfig(source);
  const file = toPosixPath(path.relative(cwd, absolute));
  return {
    config: analysis.config,
    diagnostics: analysis.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      file,
    })),
  };
}

function applyPageModuleConfig(
  page: PageNode,
  moduleConfig: {
    render?: RenderMode;
    componentModel?: ComponentModel;
    hydrate?: HydrationMode;
    prerender?: PrerenderConfig;
  },
  configured: {
    render?: RenderMode;
    componentModel?: ComponentModel;
    hydrate?: HydrationMode;
    prerender?: PrerenderConfig;
  } = {},
) {
  if (!configured.render && moduleConfig.render) {
    page.render = moduleConfig.render;
  }
  if (!configured.componentModel && moduleConfig.componentModel) {
    page.componentModel = moduleConfig.componentModel;
  }
  if (!configured.hydrate && moduleConfig.hydrate) {
    page.hydrate = moduleConfig.hydrate;
  }
  if (!configured.prerender && moduleConfig.prerender) {
    page.prerender = moduleConfig.prerender;
    const ppr = derivePprConfig(moduleConfig.prerender);
    if (ppr) {
      page.ppr = {
        ...(page.ppr ?? {}),
        ...ppr,
      };
    }
  }
}

function derivePprConfig(
  prerender: PrerenderConfig | undefined,
): Pick<PprConfig, "delivery" | "revalidate"> | undefined {
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

async function mergePprRegionsFromPageModules(
  graph: AppGraph,
  cwd: string,
  sourceCache: Map<string, string>,
  diagnostics: Diagnostic[],
  fileDependencies: Set<string>,
) {
  for (const page of Object.values(graph.pages)) {
    if (!page.ppr || !page.component) continue;

    const root = await resolveProjectSourceAbsolute(cwd, page.component);
    if (!root) continue;

    const analysis = await collectPprRegionsFromPageClosure(
      cwd,
      root,
      sourceCache,
      fileDependencies,
    );
    diagnostics.push(...analysis.diagnostics);

    if (Object.keys(analysis.regions).length === 0) continue;
    const resolved = await resolvePprRegionComponents(
      cwd,
      analysis.regions,
      sourceCache,
    );
    diagnostics.push(...resolved.diagnostics);
    page.ppr = {
      ...(page.ppr ?? {}),
      regions: {
        ...(page.ppr?.regions ?? {}),
        ...resolved.regions,
      },
    };
  }
}

async function collectPprRegionsFromPageClosure(
  cwd: string,
  root: string,
  sourceCache: Map<string, string>,
  fileDependencies: Set<string>,
): Promise<{
  regions: PprRegionConfigMap;
  diagnostics: Diagnostic[];
}> {
  const visited = new Set<string>();
  const regions: PprRegionConfigMap = {};
  const diagnostics: Diagnostic[] = [];

  async function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    fileDependencies.add(file);

    let source: string;
    try {
      source = sourceCache.get(file) ?? (await fs.readFile(file, "utf-8"));
      sourceCache.set(file, source);
    } catch {
      return;
    }

    const sourceRel = toPosixPath(path.relative(cwd, file));
    const analysis = extractPprRegions(source, sourceRel);
    for (const diagnostic of analysis.diagnostics) {
      diagnostics.push({
        ...diagnostic,
        file: sourceRel,
      });
    }

    for (const [id, region] of Object.entries(analysis.regions)) {
      if (regions[id]) {
        diagnostics.push({
          level: "error",
          file: sourceRel,
          message: `Duplicate internal PPR region id "${id}" in the same PPR page component tree.`,
        });
        continue;
      }
      regions[id] = region;
    }

    for (const specifier of extractStaticImportSpecifiers(source)) {
      const dependency = await resolveSourceImport(cwd, file, specifier);
      if (dependency) {
        await visit(dependency);
      }
    }
  }

  await visit(root);

  return {
    regions,
    diagnostics,
  };
}

async function resolvePprRegionComponents(
  cwd: string,
  regions: PprRegionConfigMap,
  sourceCache: Map<string, string>,
): Promise<{
  regions: PprRegionConfigMap;
  diagnostics: Diagnostic[];
}> {
  const resolved: PprRegionConfigMap = {};
  const diagnostics: Diagnostic[] = [];

  for (const [id, region] of Object.entries(regions)) {
    const component = await resolveProjectSourcePath(cwd, region.component);
    const moduleConfig = await readPprRegionModuleConfig(
      cwd,
      component,
      sourceCache,
    );
    diagnostics.push(...moduleConfig.diagnostics);
    resolved[id] = {
      ...moduleConfig.config,
      ...region,
      component,
    };
  }

  return { regions: resolved, diagnostics };
}

async function readPprRegionModuleConfig(
  cwd: string,
  component: string,
  sourceCache: Map<string, string>,
): Promise<{
  config: Partial<Omit<PprRegionConfigMap[string], "component">>;
  diagnostics: Diagnostic[];
}> {
  const empty = { config: {}, diagnostics: [] };
  if (!component.startsWith(".")) return empty;
  const absolute = await resolveProjectSourceAbsolute(cwd, component);
  if (!absolute) return empty;

  let source: string;
  try {
    source =
      sourceCache.get(absolute) ?? (await fs.readFile(absolute, "utf-8"));
    sourceCache.set(absolute, source);
  } catch {
    return empty;
  }

  const analysis = extractPprRegionModuleConfig(source);
  const file = toPosixPath(path.relative(cwd, absolute));
  return {
    config: analysis.config,
    diagnostics: analysis.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      file,
    })),
  };
}

async function resolveProjectSourceAbsolute(
  cwd: string,
  sourcePath: string,
): Promise<string | undefined> {
  if (!sourcePath.startsWith(".")) return undefined;
  return resolveSourcePath(cwd, path.resolve(cwd, sourcePath));
}

async function resolveProjectSourcePath(
  cwd: string,
  sourcePath: string,
): Promise<string> {
  if (!sourcePath.startsWith(".")) return sourcePath;
  const resolved = await resolveSourcePath(cwd, path.resolve(cwd, sourcePath));
  return resolved
    ? `./${toPosixPath(path.relative(cwd, resolved))}`
    : sourcePath;
}

function createRouteDerivedPageNode(
  config: GraphConfig,
  graph: AppGraph,
  route: ReturnType<typeof resolveRoutes>[number],
  routeId: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (!shouldCreateRouteDerivedPage(config, route)) return undefined;

  const pageId = deriveRouteIdFromPath(route.id ?? route.path);
  const existing = graph.pages[pageId];
  if (existing) {
    diagnostics.push({
      level: "error",
      message: `Route-derived page id "${pageId}" for route path "${route.path}" conflicts with existing page "${existing.id}". Add an explicit route id or rename one route so generated page ids are unique.`,
    });
    return undefined;
  }

  graph.pages[pageId] = {
    id: pageId,
    routeId,
    component: route.module,
    html: config.html,
    render: route.render ?? "csr",
    hydrate: route.hydrate,
    componentModel: route.componentModel,
    prerender: route.prerender,
    ...(route.ppr ? { ppr: route.ppr } : {}),
  };
  return pageId;
}

function getConfiguredPageRouteId(
  graph: AppGraph,
  route: ReturnType<typeof resolveRoutes>[number],
): string | undefined {
  if (!route.id) return undefined;
  const page = graph.pages[route.id];
  return page?.path ? page.id : undefined;
}

function createConfiguredPageRoutes(graph: AppGraph): ExtractedRoute[] {
  return Object.values(graph.pages)
    .filter((page): page is PageNode & { path: string } => Boolean(page.path))
    .map((page) => ({
      id: page.id,
      path: normalizePublicRoutePath(page.path),
      module: page.component ?? page.app ?? page.entry,
      render: page.render,
      hydrate: page.hydrate,
      componentModel: page.componentModel,
      prerender: page.prerender,
      ppr: page.ppr,
    }));
}

function normalizePublicRoutePath(routePath: string): string {
  return routePath.startsWith("/") ? routePath : `/${routePath}`;
}

function shouldCreateRouteDerivedPage(
  config: GraphConfig,
  route: ReturnType<typeof resolveRoutes>[number],
): route is ReturnType<typeof resolveRoutes>[number] & {
  module: string;
} {
  return Boolean(
    route.module &&
      route.kind !== "layout" &&
      hasRouteGraphSource(config) &&
      ((route.render && route.render !== "csr") ||
        route.componentModel === "rsc" ||
        route.ppr),
  );
}

function hasRouteGraphSource(config: GraphConfig): boolean {
  return Boolean(
    Object.keys(config.apps ?? {}).length > 0 ||
      !config.pages ||
      Object.values(config.apps ?? {}).some((app) =>
        typeof app === "string" ? app : app.source,
      ),
  );
}

function validateGraphPageContracts(
  graph: AppGraph,
  diagnostics: Diagnostic[],
): void {
  for (const page of Object.values(graph.pages)) {
    const file = getPageContractDiagnosticFile(page);
    if (file && hasErrorDiagnosticForFile(diagnostics, file)) continue;

    const renderingError = getPageBuildContractViolation(
      `Page "${page.id}"`,
      page,
    );
    if (renderingError) {
      diagnostics.push({
        level: "error",
        file,
        message: renderingError,
      });
    }
  }
}

function hasErrorDiagnosticForFile(
  diagnostics: Diagnostic[],
  file: string,
): boolean {
  return diagnostics.some(
    (diagnostic) => diagnostic.level === "error" && diagnostic.file === file,
  );
}

function getPageContractDiagnosticFile(page: PageNode): string | undefined {
  if (!page.component?.startsWith("./")) return undefined;
  return page.component.slice(2);
}

function createAppNodes(config: GraphConfig): Record<string, AppNode> {
  if (config.apps && Object.keys(config.apps).length > 0) {
    return Object.fromEntries(
      Object.entries(config.apps).flatMap(([id, app]) => {
        if (isAppSourceConfig(app)) {
          const source = getAppSourcePath(app);
          if (!source) return [];
          return [
            [
              id,
              {
                id,
                entry: source,
                html: config.html,
              } satisfies AppNode,
            ],
          ];
        }
        if (!isAppEntryConfig(app)) return [];

        return [
          [
            id,
            {
              id,
              entry: app.entry,
              html: app.html ?? config.html,
              ...(app.mount ? { mount: app.mount } : {}),
            } satisfies AppNode,
          ],
        ];
      }),
    );
  }

  if (!hasDefaultAppNode(config)) {
    return {};
  }

  const app: AppNode = {
    id: "default",
    entry: getDefaultAppEntry(config),
    html: config.routing?.html ?? config.html,
    ...(config.routing?.mount ? { mount: config.routing.mount } : {}),
  };
  return {
    default: app,
  };
}

function isAppSourceConfig(
  app: NonNullable<GraphConfig["apps"]>[string],
): app is string | { source: string } {
  return typeof app === "string" || "source" in app;
}

function getAppSourcePath(
  app: NonNullable<GraphConfig["apps"]>[string],
): string | undefined {
  if (typeof app === "string") return app;
  return "source" in app ? app.source : undefined;
}

function isAppEntryConfig(
  app: NonNullable<GraphConfig["apps"]>[string],
): app is { entry: string; html?: string; mount?: string } {
  return typeof app !== "string" && "entry" in app && Boolean(app.entry);
}

function hasDefaultAppNode(config: GraphConfig): boolean {
  return Boolean(
    (!config.apps || Object.keys(config.apps).length === 0) &&
      (!config.pages || Object.keys(config.pages).length === 0) &&
      config.routing?.mode !== "mpa",
  );
}

function getDefaultAppEntry(config: GraphConfig): string {
  return config.routing?.entry ?? config.entry;
}

function isRequiredDefaultAppEntry(
  config: GraphConfig,
  entry: string,
): boolean {
  if (isPagesAppEntryImport(entry)) return false;
  return Boolean(config.routing?.entry || entry !== DEFAULT_TOP_LEVEL_ENTRY);
}

function createPageNodes(
  config: GraphConfig,
  configuredPageRoutes: PageRouteNode[] = config.routing?.routes ?? [],
  configuredPagePathIds: Set<string> = new Set(),
): Record<string, PageNode> {
  const pages: Record<string, PageNode> = {};

  if (config.routing?.mode === "mpa") {
    for (const route of sortPageRoutes(configuredPageRoutes)) {
      if (route.kind === "layout") continue;
      pages[route.id] = {
        id: route.id,
        path: route.path,
        component: route.module,
        html: route.html ?? config.routing.html,
        render: "csr",
        mount: config.routing.mount,
      };
    }
  }

  for (const [id, page] of Object.entries(config.pages ?? {})) {
    const pagePath =
      page.path && configuredPagePathIds.has(id) ? page.path : undefined;
    pages[id] = {
      id,
      path: pagePath,
      entry: page.entry,
      component: page.component,
      app: page.app,
      html: page.html,
      render: page.render ?? "csr",
      mount: page.mount,
      ...(page.componentModel ? { componentModel: page.componentModel } : {}),
      ...(page.hydrate ? { hydrate: page.hydrate } : {}),
      ...(page.prerender ? { prerender: page.prerender } : {}),
      ...(page.ppr ? { ppr: page.ppr } : {}),
    };
  }

  return pages;
}

function validateConfiguredPagePaths(
  config: Pick<GraphConfig, "pages">,
  diagnostics: Diagnostic[],
): Set<string> {
  const routeByPath = new Map<string, { id: string; path: string }>();
  const routeByShape = new Map<string, { id: string; path: string }>();
  const validPagePathIds = new Set<string>();

  for (const [id, page] of Object.entries(config.pages ?? {})) {
    if (!page.path) continue;
    const pathError = getPathPatternValidationError(page.path);
    const file = getConfiguredPageDiagnosticFile(page);
    if (pathError) {
      diagnostics.push({
        level: "error",
        ...(file ? { file } : {}),
        message: `Configured page "${id}" path ${formatConfiguredPageRoutePathValue(page.path)} ${formatConfiguredPageRoutePathValidationError(pathError)}`,
      });
      continue;
    }
    const paramError = getConfiguredPageRouteParamValidationError(page.path);
    if (paramError) {
      diagnostics.push({
        level: "error",
        ...(file ? { file } : {}),
        message: `Configured page "${id}" path "${page.path}" ${formatConfiguredPageRouteParamValidationError(paramError)}`,
      });
      continue;
    }

    const previousPathOwner = routeByPath.get(page.path);
    if (previousPathOwner) {
      diagnostics.push({
        level: "error",
        ...(file ? { file } : {}),
        message:
          `Configured page "${id}" path "${page.path}" is already declared by ` +
          `page "${previousPathOwner.id}". Keep one page route per URL path.`,
      });
      continue;
    }
    routeByPath.set(page.path, { id, path: page.path });

    const routeShape = routePathShapeFromPath(page.path).key;
    const previousShapeOwner = routeByShape.get(routeShape);
    if (previousShapeOwner) {
      diagnostics.push({
        level: "error",
        ...(file ? { file } : {}),
        message:
          `Configured page "${id}" path "${page.path}" has the same route shape as ` +
          `page "${previousShapeOwner.id}" (${previousShapeOwner.path}). ` +
          "Use one dynamic param name for each URL shape.",
      });
      continue;
    }
    routeByShape.set(routeShape, { id, path: page.path });
    validPagePathIds.add(id);
  }

  return validPagePathIds;
}

function validateConfiguredPageRoutes(
  config: Pick<GraphConfig, "routing">,
  diagnostics: Diagnostic[],
): PageRouteNode[] {
  if (!config.routing) return [];

  const routeByPath = new Map<string, PageRouteNode>();
  const routeByShape = new Map<string, PageRouteNode>();
  const routeById = new Map<string, PageRouteNode>();
  const validRoutes: PageRouteNode[] = [];

  for (const route of config.routing.routes) {
    if (
      route.kind !== undefined &&
      route.kind !== "page" &&
      route.kind !== "layout"
    ) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticModulePath(route.module),
        message: `Configured page route "${route.id}" kind must be "page" or "layout".`,
      });
      continue;
    }
    const routePathError = getConfiguredPageRoutePathValidationError(
      route.path,
    );
    if (routePathError) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticModulePath(route.module),
        message: `Configured page route path ${formatConfiguredPageRoutePathValue(route.path)} ${formatConfiguredPageRoutePathValidationError(routePathError)}`,
      });
      continue;
    }

    const normalizedPath = normalizePublicRoutePath(route.path);
    const paramError =
      getConfiguredPageRouteParamValidationError(normalizedPath);
    if (paramError) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticModulePath(route.module),
        message: `Configured page route path "${normalizedPath}" ${formatConfiguredPageRouteParamValidationError(paramError)}`,
      });
      continue;
    }
    const normalizedRoute: PageRouteNode = {
      ...route,
      path: normalizedPath,
    };
    const isLayoutRoute = normalizedRoute.kind === "layout";

    if (!isLayoutRoute) {
      const previousPathOwner = routeByPath.get(normalizedPath);
      if (previousPathOwner) {
        diagnostics.push({
          level: "error",
          file: toDiagnosticModulePath(route.module),
          message:
            `Configured page route path "${normalizedPath}" is already declared by ${previousPathOwner.module}. ` +
            "Keep one page route per URL path.",
        });
        continue;
      }
      routeByPath.set(normalizedPath, normalizedRoute);

      const routeShape = routePathShapeFromPath(normalizedPath).key;
      const previousShapeOwner = routeByShape.get(routeShape);
      if (previousShapeOwner) {
        diagnostics.push({
          level: "error",
          file: toDiagnosticModulePath(route.module),
          message:
            `Configured page route path "${normalizedPath}" has the same route shape as ` +
            `${previousShapeOwner.module} (${normalizePublicRoutePath(previousShapeOwner.path)}). ` +
            "Use one dynamic param name for each URL shape.",
        });
        continue;
      }
      routeByShape.set(routeShape, normalizedRoute);
    }

    const previousIdOwner = routeById.get(route.id);
    if (previousIdOwner) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticModulePath(route.module),
        message:
          `Configured page route id "${route.id}" for path "${normalizedPath}" is already used by ` +
          `${previousIdOwner.module} (${normalizePublicRoutePath(previousIdOwner.path)}). ` +
          "Route ids must be unique because they drive page ids and build entries.",
      });
      continue;
    }
    routeById.set(route.id, normalizedRoute);
    validRoutes.push(normalizedRoute);
  }

  return validRoutes.filter((route) => {
    if (!route.parentId) return true;
    const parent = routeById.get(route.parentId);
    if (!parent) {
      diagnostics.push({
        level: "error",
        file: toDiagnosticModulePath(route.module),
        message: `Configured page route "${route.id}" parentId "${route.parentId}" does not match another route id.`,
      });
      return false;
    }
    if (parent.kind !== "layout") {
      diagnostics.push({
        level: "error",
        file: toDiagnosticModulePath(route.module),
        message: `Configured page route "${route.id}" parentId "${route.parentId}" must reference a layout route.`,
      });
      return false;
    }
    return true;
  });
}

function getConfiguredPageRoutePathValidationError(
  routePath: string,
): PathPatternValidationError | undefined {
  const initialError = getPathPatternValidationError(routePath);
  if (!initialError) return undefined;
  if (initialError !== "missing-leading-slash") return initialError;

  return getPathPatternValidationError(normalizePublicRoutePath(routePath));
}

function getConfiguredPageRouteParamValidationError(
  routePath: string,
): PageRouteParamSegmentValidationError | undefined {
  return getPageRouteParamSegmentValidationError(
    normalizePublicRoutePath(routePath),
  );
}

function formatConfiguredPageRoutePathValue(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : String(value);
}

function formatConfiguredPageRoutePathValidationError(
  error: PathPatternValidationError,
): string {
  switch (error) {
    case "empty":
      return "must be a non-empty string.";
    case "missing-leading-slash":
      return 'must start with "/".';
    case "whitespace":
      return "must not contain whitespace.";
    case "query-or-hash":
      return "must not include a query string or hash.";
  }
}

function formatConfiguredPageRouteParamValidationError(
  error: PageRouteParamSegmentValidationError,
): string {
  switch (error.error) {
    case "empty":
      return `contains dynamic segment "${error.segment}" without a param name.`;
    case "reserved":
      return `uses reserved dynamic param name "${error.name}" in segment "${error.segment}". Use a safe application-specific name.`;
    case "duplicate":
      return `uses duplicate dynamic param name "${error.name}" in segment "${error.segment}". Use unique param names within one route path.`;
    case "duplicate-wildcard":
      return `contains more than one wildcard segment "${error.segment}". Use at most one wildcard segment in a route path.`;
  }
}

function toDiagnosticModulePath(module: string): string {
  return module.replace(/^\.\//, "");
}

function getConfiguredPageDiagnosticFile(
  page: NonNullable<GraphConfig["pages"]>[string],
): string | undefined {
  const source = page.component ?? page.app ?? page.entry;
  return source ? toDiagnosticModulePath(source) : undefined;
}

async function collectRouteDirectories(root: string): Promise<string[]> {
  const dirs = new Set([root]);

  async function visit(current: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      dirs.add(absolute);
      await visit(absolute);
    }
  }

  await visit(root);
  return [...dirs].sort();
}

function getDefaultAppId(
  graph: AppGraph,
  preferredEntry?: string,
): string | undefined {
  if (preferredEntry) {
    const app = Object.values(graph.apps).find(
      (candidate) => candidate.entry === preferredEntry,
    );
    if (app) return app.id;
  }

  const appIds = Object.keys(graph.apps);
  return appIds.length > 0 ? appIds[0] : undefined;
}

function getSpaRoutingEntry(
  config: Pick<GraphConfig, "entry" | "routing">,
): string | undefined {
  if (config.routing?.mode !== "spa") return undefined;
  return config.routing.entry ?? config.entry;
}

async function collectFrameworkSourceFiles(
  config: GraphConfig,
  cwd: string,
  sourceCache: Map<string, string>,
): Promise<FrameworkSourceFiles> {
  const files = new Set<string>();
  const roots = new Set<string>();
  const explicitDependencyRoots = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  if (config.apps && Object.keys(config.apps).length > 0) {
    for (const [appId, app] of Object.entries(config.apps)) {
      const appSource = getAppSourcePath(app);
      if (appSource) {
        await addConfiguredSource(
          roots,
          cwd,
          appSource,
          `App "${appId}" source`,
          diagnostics,
          explicitDependencyRoots,
        );
        continue;
      }

      if (!isAppEntryConfig(app)) continue;

      await addConfiguredSource(
        roots,
        cwd,
        app.entry,
        `App "${appId}" entry`,
        diagnostics,
      );
    }
  } else if (hasDefaultAppNode(config)) {
    const entry = getDefaultAppEntry(config);
    if (isRequiredDefaultAppEntry(config, entry)) {
      await addConfiguredSource(
        roots,
        cwd,
        entry,
        'App "default" entry',
        diagnostics,
      );
    } else {
      await addExistingSource(roots, cwd, entry);
    }
  }
  for (const route of config.routing?.routes ?? []) {
    await addConfiguredSource(
      roots,
      cwd,
      route.module,
      `Page route "${route.id}" module`,
      diagnostics,
      explicitDependencyRoots,
    );
    await addConfiguredSource(
      roots,
      cwd,
      route.errorModule,
      `Page route "${route.id}" error boundary module`,
      diagnostics,
      explicitDependencyRoots,
    );
    await addConfiguredSource(
      roots,
      cwd,
      route.notFoundModule,
      `Page route "${route.id}" not-found boundary module`,
      diagnostics,
      explicitDependencyRoots,
    );
  }
  for (const route of config.server.routing?.routes ?? []) {
    await addConfiguredSource(
      roots,
      cwd,
      route.module,
      `Server route "${route.path}" module`,
      diagnostics,
      explicitDependencyRoots,
    );
  }
  for (const middleware of [
    ...(config.server.conventions?.globalMiddlewares ?? []),
    ...(config.server.conventions?.routeMiddlewares ?? []),
  ]) {
    await addConfiguredSource(
      roots,
      cwd,
      middleware.module,
      `Server middleware "${middleware.module}" module`,
      diagnostics,
      explicitDependencyRoots,
    );
  }
  await addConfiguredSource(
    roots,
    cwd,
    config.routing?.rootModule,
    "SPA root layout module",
    diagnostics,
    explicitDependencyRoots,
  );
  for (const [pageId, page] of Object.entries(config.pages ?? {})) {
    await addConfiguredSource(
      roots,
      cwd,
      page.entry,
      `Page "${pageId}" entry`,
      diagnostics,
    );
    await addConfiguredSource(
      roots,
      cwd,
      page.component,
      `Page "${pageId}" component`,
      diagnostics,
      explicitDependencyRoots,
    );
    await addConfiguredSource(
      roots,
      cwd,
      page.app,
      `Page "${pageId}" app`,
      diagnostics,
    );
  }
  for (const root of roots) {
    await collectStaticImportClosure(files, cwd, root, sourceCache);
  }

  return {
    analysisFiles: [...files].sort(),
    explicitDependencyFiles: explicitDependencyRoots,
    diagnostics,
  };
}

async function addConfiguredSource(
  files: Set<string>,
  cwd: string,
  filePath: string | undefined,
  label: string,
  diagnostics: Diagnostic[],
  explicitDependencyFiles?: Set<string>,
): Promise<string | undefined> {
  if (!filePath) return;
  const absolute = path.resolve(cwd, filePath);
  const file = getConfiguredSourceDiagnosticFile(cwd, filePath, absolute);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absolute);
  } catch {
    diagnostics.push({
      level: "error",
      file,
      message: `${label} source file not found.`,
    });
    return undefined;
  }

  if (!stat.isFile()) {
    diagnostics.push({
      level: "error",
      file,
      message: `${label} source path must be a file.`,
    });
    return undefined;
  }

  if (!SOURCE_EXTENSIONS.has(path.extname(absolute))) {
    diagnostics.push({
      level: "error",
      file,
      message: `${label} source file must use .ts, .tsx, .js, or .jsx.`,
    });
    return undefined;
  }

  files.add(absolute);
  explicitDependencyFiles?.add(absolute);
  return absolute;
}

function getConfiguredSourceDiagnosticFile(
  cwd: string,
  filePath: string,
  absolute: string,
): string {
  if (filePath.startsWith(".")) {
    return toPosixPath(path.relative(cwd, absolute));
  }
  return toPosixPath(filePath);
}

async function addExistingSource(
  files: Set<string>,
  cwd: string,
  filePath: string | undefined,
  explicitDependencyFiles?: Set<string>,
): Promise<string | undefined> {
  if (!filePath) return;
  const absolute = path.resolve(cwd, filePath);
  try {
    const stat = await fs.stat(absolute);
    if (stat.isFile() && SOURCE_EXTENSIONS.has(path.extname(absolute))) {
      files.add(absolute);
      explicitDependencyFiles?.add(absolute);
      return absolute;
    }
  } catch {
    // Missing entry files are reported by the bundler today. Keep graph
    // creation non-blocking for phase 1 so behavior does not change.
  }
  return undefined;
}

async function collectStaticImportClosure(
  files: Set<string>,
  cwd: string,
  file: string,
  sourceCache: Map<string, string>,
) {
  if (files.has(file)) return;
  files.add(file);

  let source: string;
  try {
    source = sourceCache.get(file) ?? (await fs.readFile(file, "utf-8"));
    sourceCache.set(file, source);
  } catch {
    return;
  }

  for (const specifier of extractStaticImportSpecifiers(source)) {
    const dependency = await resolveSourceImport(cwd, file, specifier);
    if (dependency) {
      await collectStaticImportClosure(files, cwd, dependency, sourceCache);
    }
  }
}

function extractStaticImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  for (const specifier of extractParsedStaticImportSpecifiers(source)) {
    specifiers.add(specifier);
  }
  for (const specifier of extractDynamicImportSpecifiers(source)) {
    specifiers.add(specifier);
  }

  return [...specifiers].filter(isLocalSourceImportSpecifier);
}

function isLocalSourceImportSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith(".") ||
    specifier === DEFAULT_SOURCE_ALIAS.slice(0, -1) ||
    specifier.startsWith(DEFAULT_SOURCE_ALIAS)
  );
}

function extractParsedStaticImportSpecifiers(source: string): string[] {
  try {
    const ast = parseSync(source, {
      syntax: "typescript",
      tsx: true,
      target: "esnext",
    });
    return ast.body.flatMap(getStaticModuleSpecifier);
  } catch {
    return extractStaticImportSpecifiersWithRegex(source);
  }
}

function getStaticModuleSpecifier(item: ModuleItem): string[] {
  if (item.type === "ImportDeclaration") return [item.source.value];
  if (item.type === "ExportNamedDeclaration" && item.source) {
    return [item.source.value];
  }
  if (item.type === "ExportAllDeclaration") return [item.source.value];
  return [];
}

function extractDynamicImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier) specifiers.push(specifier);
  }

  return specifiers;
}

function extractStaticImportSpecifiersWithRegex(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern =
    /\bimport\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|\bexport\s+[^'"]*?\s+from\s+["']([^"']+)["']/g;

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier) specifiers.push(specifier);
  }

  return specifiers;
}

function isFrameworkDependencySource(source: string): boolean {
  return /^\s*["']use (client|server)["']/m.test(source.slice(0, 200));
}

async function resolveSourceImport(
  cwd: string,
  fromFile: string,
  specifier: string,
): Promise<string | undefined> {
  if (specifier === DEFAULT_SOURCE_ALIAS.slice(0, -1)) {
    return resolveSourcePath(cwd, path.resolve(cwd, "src"));
  }
  if (specifier.startsWith(DEFAULT_SOURCE_ALIAS)) {
    return resolveSourcePath(
      cwd,
      path.resolve(cwd, "src", specifier.slice(DEFAULT_SOURCE_ALIAS.length)),
    );
  }
  return resolveSourcePath(
    cwd,
    path.resolve(path.dirname(fromFile), specifier),
  );
}

async function resolveSourcePath(
  cwd: string,
  base: string,
): Promise<string | undefined> {
  const candidates = [base];
  if (!SOURCE_EXTENSIONS.has(path.extname(base))) {
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(`${base}${extension}`);
    }
  }
  for (const extension of SOURCE_EXTENSIONS) {
    candidates.push(path.join(base, `index${extension}`));
  }

  for (const candidate of candidates) {
    if (!isInsideCwd(cwd, candidate)) continue;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile() && SOURCE_EXTENSIONS.has(path.extname(candidate))) {
        return candidate;
      }
    } catch {
      // Non-source imports are handled by the bundler. Graph analysis only
      // follows local framework-relevant TypeScript/JavaScript modules.
    }
  }

  return undefined;
}
