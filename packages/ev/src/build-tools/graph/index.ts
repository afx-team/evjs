import fs from "node:fs/promises";
import path from "node:path";
import type {
  AppGraph,
  AppNode,
  ComponentModel,
  ExtractedRoute,
  FileRouteNode,
  HydrationMode,
  PageNode,
  PprConfig,
  PrerenderConfig,
  RemoteBuildNode,
  RenderMode,
  RouteNode,
  ServerFunctionNode,
  ServerRouteNode,
  SharedDependencyMap,
} from "@evjs/shared/manifest";
import { extractPageModuleConfig } from "../page-module-config.js";
import {
  extractPprRegionModuleConfig,
  extractPprRegions,
} from "../ppr-regions.js";
import { analyzeRoutes, resolveRoutes } from "../routes/index.js";
import { extractRscReferences } from "../rsc-refs.js";
import { extractServerFunctionExports } from "../server-fns.js";
import { hashServerFunction } from "../utils.js";

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
  fileRoutes?: {
    mode: "spa" | "mpa";
    dir: string;
    entry?: string;
    html: string;
    mount: string;
    routes: FileRouteNode[];
    rootModule?: string;
  };
  remotes?: Record<
    string,
    {
      manifest: string;
      activeWhen?: string[];
    }
  >;
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
  };
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

interface FrameworkSourceFiles {
  analysisFiles: string[];
  explicitDependencyFiles: Set<string>;
}

type PprRegionConfigMap = NonNullable<PprConfig["regions"]>;

export async function createAppGraph(
  config: GraphConfig,
  cwd: string,
): Promise<GraphAnalysisResult> {
  const graph: AppGraph = {
    version: 1,
    rootDir: cwd,
    apps: {},
    pages: createPageNodes(config),
    routes: [],
    serverFunctions: [],
    serverRoutes: [],
    remotes: createRemoteNodes(config),
    remote: createRemoteBuildNode(config),
  };

  const sourceCache = new Map<string, string>();
  const sourceFiles = await collectFrameworkSourceFiles(
    config,
    cwd,
    sourceCache,
  );
  graph.apps = createAppNodes(config);
  await mergeConfiguredPageModuleConfigs(graph, cwd, sourceCache);
  // Watch explicit graph roots and files that already declare framework
  // semantics. Ordinary component edits should stay on the bundler HMR path.
  // If a plain component starts declaring routes/server functions later, a
  // configured route/server root or config change should introduce it into the
  // watched framework graph set.
  const fileDependencies = new Set(sourceFiles.explicitDependencyFiles);
  if (config.fileRoutes) {
    fileDependencies.add(path.resolve(cwd, config.fileRoutes.dir));
  }
  const clientRoutes: ExtractedRoute[] = [];
  const serverRoutes = new Map<string, ServerRouteNode>();
  const serverFunctions: ServerFunctionNode[] = [];
  const clientReferences = new Map<
    string,
    NonNullable<AppGraph["clientReferences"]>[number]
  >();
  const serverReferences = new Map<
    string,
    NonNullable<AppGraph["serverReferences"]>[number]
  >();
  const diagnostics: Diagnostic[] = [];

  for (const file of sourceFiles.analysisFiles) {
    const source = sourceCache.get(file) ?? (await fs.readFile(file, "utf-8"));
    if (
      sourceFiles.explicitDependencyFiles.has(file) ||
      isFrameworkDependencySource(source)
    ) {
      fileDependencies.add(file);
    }
    const sourceRel = toPosixPath(path.relative(cwd, file));
    const rscReferenceAnalysis = extractRscReferences(source, sourceRel);
    for (const reference of rscReferenceAnalysis.clientReferences) {
      clientReferences.set(reference.id, reference);
    }
    for (const reference of rscReferenceAnalysis.serverReferences) {
      serverReferences.set(reference.id, reference);
    }

    const routeAnalysis = analyzeRoutes(source);
    diagnostics.push(
      ...routeAnalysis.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        file: sourceRel,
      })),
    );

    if (!config.serverEnabled) continue;

    for (const route of routeAnalysis.serverRoutes) {
      const id = `${sourceRel}:${route.path}:${route.methods.join(",")}`;
      serverRoutes.set(id, {
        id,
        module: sourceRel,
        path: route.path,
        methods: route.methods,
      });
    }

    for (const exportName of extractServerFunctionExports(source)) {
      serverFunctions.push({
        id: hashServerFunction(sourceRel, exportName),
        module: sourceRel,
        exportName,
      });
    }
  }

  const defaultAppId = getDefaultAppId(graph);
  if (config.fileRoutes?.mode === "spa") {
    for (const route of config.fileRoutes.routes) {
      clientRoutes.push(
        await mergeRouteModuleConfig(
          cwd,
          {
            id: route.id,
            path: route.path,
            module: route.module,
            ...(defaultAppId ? { appId: defaultAppId } : {}),
          },
          sourceCache,
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
      createRouteDerivedPageNode(config, graph, route, routeId);
    const appId = route.appId ?? defaultAppId;
    return {
      id: routeId,
      path: route.path,
      ...(appId ? { appId } : {}),
      ...(pageId ? { pageId } : {}),
      ...(route.module ? { module: route.module } : {}),
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

async function mergeConfiguredPageModuleConfigs(
  graph: AppGraph,
  cwd: string,
  sourceCache: Map<string, string>,
) {
  for (const [pageId] of Object.entries(graph.pages)) {
    const page = graph.pages[pageId];
    if (!page?.component) continue;

    const moduleConfig = await readPageModuleConfig(
      cwd,
      page.component,
      sourceCache,
    );
    if (!moduleConfig) continue;

    applyPageModuleConfig(page, moduleConfig);
  }
}

async function mergeRouteModuleConfig(
  cwd: string,
  route: ExtractedRoute,
  sourceCache: Map<string, string>,
): Promise<ExtractedRoute> {
  if (!route.module) return route;

  const moduleConfig = await readPageModuleConfig(
    cwd,
    route.module,
    sourceCache,
  );
  if (!moduleConfig) return route;

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
    ...(derivePprConfig(moduleConfig.prerender)
      ? { ppr: derivePprConfig(moduleConfig.prerender) }
      : {}),
  };
}

async function readPageModuleConfig(
  cwd: string,
  component: string,
  sourceCache: Map<string, string>,
) {
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

  return extractPageModuleConfig(source);
}

function applyPageModuleConfig(
  page: PageNode,
  moduleConfig: {
    render?: RenderMode;
    componentModel?: ComponentModel;
    hydrate?: HydrationMode;
    prerender?: PrerenderConfig;
  },
) {
  if (moduleConfig.render) page.render = moduleConfig.render;
  if (moduleConfig.componentModel) {
    page.componentModel = moduleConfig.componentModel;
  }
  if (moduleConfig.hydrate) page.hydrate = moduleConfig.hydrate;
  if (moduleConfig.prerender) {
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
    const regions = await resolvePprRegionComponents(
      cwd,
      analysis.regions,
      sourceCache,
    );
    page.ppr = {
      ...(page.ppr ?? {}),
      regions: {
        ...(page.ppr?.regions ?? {}),
        ...regions,
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
          message: `Duplicate PPR region id "${id}" in the same PPR page component tree.`,
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
): Promise<PprRegionConfigMap> {
  const resolved: PprRegionConfigMap = {};

  for (const [id, region] of Object.entries(regions)) {
    const component = await resolveProjectSourcePath(cwd, region.component);
    const moduleConfig = await readPprRegionModuleConfig(
      cwd,
      component,
      sourceCache,
    );
    resolved[id] = {
      ...moduleConfig,
      ...region,
      component,
    };
  }

  return resolved;
}

async function readPprRegionModuleConfig(
  cwd: string,
  component: string,
  sourceCache: Map<string, string>,
): Promise<Partial<Omit<PprRegionConfigMap[string], "component">>> {
  if (!component.startsWith(".")) return {};
  const absolute = await resolveProjectSourceAbsolute(cwd, component);
  if (!absolute) return {};

  let source: string;
  try {
    source =
      sourceCache.get(absolute) ?? (await fs.readFile(absolute, "utf-8"));
    sourceCache.set(absolute, source);
  } catch {
    return {};
  }

  return extractPprRegionModuleConfig(source);
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
): string | undefined {
  if (!shouldCreateRouteDerivedPage(config, route)) return undefined;

  const pageId = sanitizeRoutePageId(route.id ?? route.path);
  graph.pages[pageId] ??= {
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
      hasRouteGraphSource(config) &&
      ((route.render && route.render !== "csr") ||
        route.componentModel === "rsc" ||
        route.ppr),
  );
}

function hasRouteGraphSource(config: GraphConfig): boolean {
  return Boolean(
    Object.keys(config.apps ?? {}).length > 0 ||
      (!config.pages && !config.remote) ||
      Object.values(config.apps ?? {}).some((app) =>
        typeof app === "string" ? app : app.source,
      ),
  );
}

function sanitizeRoutePageId(value: string): string {
  const sanitized = value
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_");
  return sanitized.length > 0 ? sanitized : "index";
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

  if (
    (config.pages && Object.keys(config.pages).length > 0) ||
    config.fileRoutes?.mode === "mpa" ||
    config.remote
  ) {
    return {};
  }

  const app: AppNode = {
    id: "default",
    entry: config.fileRoutes?.entry ?? config.entry,
    html: config.fileRoutes?.html ?? config.html,
    ...(config.fileRoutes?.mount ? { mount: config.fileRoutes.mount } : {}),
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

function createPageNodes(config: GraphConfig): Record<string, PageNode> {
  const pages: Record<string, PageNode> = {};

  if (config.fileRoutes?.mode === "mpa") {
    for (const route of config.fileRoutes.routes) {
      pages[route.id] = {
        id: route.id,
        path: route.path,
        component: route.module,
        html: config.fileRoutes.html,
        render: "csr",
        mount: config.fileRoutes.mount,
      };
    }
  }

  for (const [id, page] of Object.entries(config.pages ?? {})) {
    pages[id] = {
      id,
      path: page.path,
      entry: page.entry,
      component: page.component,
      app: page.app,
      html: page.html,
      render: "csr",
      mount: page.mount,
    };
  }

  return pages;
}

function createRemoteNodes(config: GraphConfig): AppGraph["remotes"] {
  return Object.fromEntries(
    Object.entries(config.remotes ?? {}).map(([id, remote]) => [
      id,
      {
        id,
        manifest: remote.manifest,
        activeWhen: remote.activeWhen,
      },
    ]),
  );
}

function createRemoteBuildNode(
  config: GraphConfig,
): RemoteBuildNode | undefined {
  if (!config.remote) return undefined;

  return {
    name: config.remote.name,
    baseUrl: config.remote.baseUrl,
    ...(config.remote.shared ? { shared: config.remote.shared } : {}),
    entries: Object.fromEntries(
      Object.entries(config.remote.entries).map(([id, entry]) => [
        id,
        {
          id,
          app: entry.app,
          activeWhen: entry.activeWhen,
          mount: entry.mount,
        },
      ]),
    ),
  };
}

function getDefaultAppId(graph: AppGraph): string | undefined {
  const appIds = Object.keys(graph.apps);
  return appIds.length > 0 ? appIds[0] : undefined;
}

async function collectFrameworkSourceFiles(
  config: GraphConfig,
  cwd: string,
  sourceCache: Map<string, string>,
): Promise<FrameworkSourceFiles> {
  const files = new Set<string>();
  const roots = new Set<string>();
  const explicitDependencyRoots = new Set<string>();

  if (config.apps && Object.keys(config.apps).length > 0) {
    for (const app of Object.values(config.apps)) {
      const appSource = getAppSourcePath(app);
      if (appSource) {
        await addExistingSource(roots, cwd, appSource, explicitDependencyRoots);
        continue;
      }

      if (!isAppEntryConfig(app)) continue;

      await addExistingSource(roots, cwd, app.entry);
    }
  } else if (!config.remote) {
    await addExistingSource(roots, cwd, config.entry);
  }
  for (const route of config.fileRoutes?.routes ?? []) {
    await addExistingSource(roots, cwd, route.module, explicitDependencyRoots);
  }
  await addExistingSource(
    roots,
    cwd,
    config.fileRoutes?.rootModule,
    explicitDependencyRoots,
  );
  for (const entry of Object.values(config.remote?.entries ?? {})) {
    await addExistingSource(roots, cwd, entry.app);
  }
  for (const page of Object.values(config.pages ?? {})) {
    await addExistingSource(roots, cwd, page.entry);
    await addExistingSource(roots, cwd, page.component);
    await addExistingSource(roots, cwd, page.app);
  }
  if (config.server.entry) {
    await addExistingSource(
      roots,
      cwd,
      config.server.entry,
      explicitDependencyRoots,
    );
  }

  for (const root of roots) {
    await collectStaticImportClosure(files, cwd, root, sourceCache);
  }

  return {
    analysisFiles: [...files].sort(),
    explicitDependencyFiles: explicitDependencyRoots,
  };
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
  const importPattern =
    /\bimport\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|\bexport\s+[^'"]*?\s+from\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier?.startsWith(".")) {
      specifiers.add(specifier);
    }
  }

  return [...specifiers];
}

function isFrameworkDependencySource(source: string): boolean {
  return (
    /^\s*["']use (client|server)["']/m.test(source.slice(0, 200)) ||
    (source.includes("@evjs/server") && source.includes("createRoute"))
  );
}

async function resolveSourceImport(
  cwd: string,
  fromFile: string,
  specifier: string,
): Promise<string | undefined> {
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

function isInsideCwd(cwd: string, candidate: string): boolean {
  const relative = path.relative(cwd, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, "/").replaceAll("\\", "/");
}
