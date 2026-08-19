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
  ClientReferenceNode,
  CoreGraph,
  PageRouteNode,
  PprConfig,
  PrerenderConfig,
  ServerFunctionNode,
  ServerReferenceNode,
  ServerRouteNode,
} from "@evjs/shared/manifest";
import { assertCoreGraph } from "@evjs/shared/manifest";
import { analyzePageModuleExports } from "../analysis/page-module-exports.js";
import {
  extractPprRegionModuleConfig,
  extractPprRegions,
} from "../analysis/ppr-regions.js";
import {
  extractRscReferences,
  hasBlockingReferenceParseDiagnostic,
} from "../analysis/rsc-refs.js";
import {
  analyzeServerFunctionExports,
  type ServerFunctionExportAnalysis,
} from "../analysis/server-fns.js";
import { extractRuntimeModuleSpecifiers } from "../analysis/static-imports.js";
import {
  resolveCorePageConfigModules,
  resolvePageConfigModules,
} from "../config-loading/page-config-module.js";
import { getPageBuildContractViolation } from "../conventions/page-rendering-contract.js";
import {
  CANONICAL_PAGE_ROUTE_ROOT,
  routePathShapeFromPath,
} from "../conventions/page-route-conventions.js";
import { sortRoutesBySpecificity } from "../conventions/route-order.js";
import { CANONICAL_SERVER_ROUTE_ROOT } from "../conventions/server-route-conventions.js";
import {
  applyPluginSettings,
  collectPluginSettingsRegistry,
} from "../plugins/settings.js";
import {
  detectUseServer,
  hashServerFunction,
  isInsideCwd,
  isRealPathInsideCwd,
  toPosixPath,
} from "../utils.js";
import {
  collectConfigRouteCoreSourceModules,
  createConfigRouteGraph,
} from "./config-route.js";
import { applyResolvedPageConfigs, createPageAnchorGraph } from "./core.js";
import {
  isMissingSourcePathError,
  isProjectSourceModule,
  registerProjectSourceResolutionCandidates,
} from "./source-resolution.js";
import type {
  CreateCoreGraphOptions,
  Diagnostic,
  GraphAnalysisResult,
  GraphConfig,
} from "./types.js";

interface FrameworkAnalysisFacts {
  rootDir: string;
  serverFunctions: ServerFunctionNode[];
  serverRoutes: ServerRouteNode[];
  clientReferences?: ClientReferenceNode[];
  serverReferences?: ServerReferenceNode[];
}

const DEFAULT_SOURCE_ALIAS = "@/";

interface FrameworkSourceFiles {
  analysisFiles: string[];
  explicitDependencyFiles: Set<string>;
  diagnostics: Diagnostic[];
}

type PprRegionConfigMap = NonNullable<PprConfig["regions"]>;

export async function createCoreGraph(
  config: GraphConfig,
  cwd: string,
  options: CreateCoreGraphOptions = {},
): Promise<GraphAnalysisResult> {
  const configRouteGraph = config.application
    ? await createConfigRouteGraph(
        config,
        cwd,
        options.beforeSourceRead,
        options.onSourceDependency,
      )
    : undefined;
  const pageConfigs =
    options.pageConfigs ??
    (hasPageAnchorDiscovery(config)
      ? await resolvePageConfigModules(cwd, config.routing.metadata, {
          beforeSourceRead: options.beforeSourceRead,
          onSourceDependency: options.onSourceDependency,
        })
      : configRouteGraph
        ? await resolveCorePageConfigModules(cwd, configRouteGraph, {
            beforeSourceRead: options.beforeSourceRead,
            onSourceDependency: options.onSourceDependency,
          })
        : { pages: {}, dependencies: [] });
  const diagnostics: Diagnostic[] = [];
  const configuredPageRoutes = validateConfiguredPageRoutes(
    config,
    diagnostics,
  );

  const facts: FrameworkAnalysisFacts = {
    rootDir: cwd,
    serverFunctions: [],
    serverRoutes: [],
  };

  const sourceCache = new Map<string, string>();
  const sourceFiles = await collectFrameworkSourceFiles(
    config,
    cwd,
    sourceCache,
    options.resolve?.alias,
    configRouteGraph
      ? collectConfigRouteCoreSourceModules(configRouteGraph)
      : [],
    options.beforeSourceRead,
    options.onSourceDependency,
  );
  diagnostics.push(...sourceFiles.diagnostics);
  // Watch explicit graph roots and files that already declare framework
  // semantics. Ordinary component edits should stay on the bundler HMR path.
  // If a plain component starts declaring routes/server functions later, a
  // configured route/server root or config change should introduce it into the
  // watched framework graph set.
  const fileDependencies = new Set(sourceFiles.explicitDependencyFiles);
  if (config.routing) {
    const pageRoot = path.resolve(cwd, CANONICAL_PAGE_ROUTE_ROOT);
    for (const dir of await collectRouteDirectories(cwd, pageRoot)) {
      fileDependencies.add(dir);
    }
    for (const dependency of config.routing.dependencies ?? []) {
      fileDependencies.add(path.resolve(cwd, dependency));
    }
  }
  for (const dependency of pageConfigs.dependencies) {
    fileDependencies.add(dependency);
  }
  if (config.server.routes) {
    const routingDir = path.resolve(cwd, CANONICAL_SERVER_ROUTE_ROOT);
    for (const dir of await collectRouteDirectories(cwd, routingDir)) {
      fileDependencies.add(dir);
    }
  }
  for (const middleware of [
    ...(config.server.conventions?.globalMiddlewares ?? []),
    ...(config.server.conventions?.routeMiddlewares ?? []),
  ]) {
    fileDependencies.add(path.resolve(cwd, middleware.module));
  }
  const serverRoutes = new Map<string, ServerRouteNode>();
  const serverRoutePathOwners = new Map<string, ServerRouteNode>();
  const serverRouteShapeOwners = new Map<string, ServerRouteNode>();
  const serverFileRouteModules = new Set(
    (config.server.routes ?? []).map((route) =>
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
  const clientReferences = new Map<string, ClientReferenceNode>();
  const serverReferences = new Map<string, ServerReferenceNode>();
  const configuredServerRoutePublication = validateServerRouteNodePublication(
    config.server.routes ?? [],
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
    const source = await readFrameworkSource(
      file,
      sourceCache,
      options.beforeSourceRead,
    );
    if (source === undefined) continue;
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

  facts.serverRoutes = [...serverRoutes.values()];
  facts.serverFunctions = serverFunctions;
  facts.clientReferences = [...clientReferences.values()];
  facts.serverReferences = [...serverReferences.values()];

  let graph = configRouteGraph
    ? applyResolvedPageConfigs(
        withAnalysisFacts(configRouteGraph, facts),
        pageConfigs.pages,
      )
    : hasPageAnchorDiscovery(config)
      ? createPageAnchorGraph(
          config,
          {
            ...facts,
            routes: configuredPageRoutes,
          },
          pageConfigs.pages,
        )
      : createEmptyCoreGraph(facts);
  await mergePprRegionsIntoCoreGraph(
    graph,
    cwd,
    sourceCache,
    diagnostics,
    fileDependencies,
    options.resolve?.alias,
    options.beforeSourceRead,
    options.onSourceDependency,
  );
  validateCoreGraphPageContracts(graph, diagnostics);
  await diagnosePageModuleRouteLifecycleExports(
    graph,
    cwd,
    sourceCache,
    diagnostics,
    options.beforeSourceRead,
    options.onSourceDependency,
  );
  const pluginSettings =
    options.pluginSettings ?? collectPluginSettingsRegistry([]);
  graph = applyPluginSettings(graph, pluginSettings, {
    applicationSettings: options.applicationPluginSettings,
    canonicalPages: pageConfigs.pages,
    session: options.pluginSettingsSession,
  });
  assertCoreGraph(graph, "resolved CoreGraph");

  return {
    graph,
    diagnostics,
    fileDependencies: [...fileDependencies].sort(),
  };
}

function hasPageAnchorDiscovery(
  config: Pick<GraphConfig, "application" | "routing">,
): config is Pick<GraphConfig, "application"> & {
  routing: NonNullable<GraphConfig["routing"]>;
} {
  return Boolean(config.routing && !config.application);
}

function withAnalysisFacts(
  graph: CoreGraph,
  facts: FrameworkAnalysisFacts,
): CoreGraph {
  return {
    ...graph,
    serverFunctions: facts.serverFunctions,
    serverRoutes: facts.serverRoutes,
    ...(facts.clientReferences
      ? { clientReferences: facts.clientReferences }
      : {}),
    ...(facts.serverReferences
      ? { serverReferences: facts.serverReferences }
      : {}),
  };
}

function createEmptyCoreGraph(facts: FrameworkAnalysisFacts): CoreGraph {
  const graph: CoreGraph = {
    rootDir: facts.rootDir,
    applications: {},
    pages: {},
    routes: [],
    documents: {},
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
  assertCoreGraph(graph, "resolved CoreGraph");
  return graph;
}

async function mergePprRegionsIntoCoreGraph(
  graph: CoreGraph,
  cwd: string,
  sourceCache: Map<string, string>,
  diagnostics: Diagnostic[],
  fileDependencies: Set<string>,
  aliases?: Record<string, string>,
  beforeSourceRead?: (file: string) => void,
  onSourceDependency?: (file: string) => void,
): Promise<void> {
  for (const page of Object.values(graph.pages)) {
    const ppr = page.ppr ?? derivePprConfig(page.prerender);
    if (!ppr) continue;
    const root = await resolveProjectSourceAbsolute(
      cwd,
      page.source.module,
      onSourceDependency,
    );
    if (!root) continue;
    const analysis = await collectPprRegionsFromPageClosure(
      cwd,
      root,
      sourceCache,
      fileDependencies,
      aliases,
      beforeSourceRead,
      onSourceDependency,
    );
    diagnostics.push(...analysis.diagnostics);
    if (Object.keys(analysis.regions).length === 0) {
      page.ppr = ppr;
      continue;
    }
    const resolved = await resolvePprRegionComponents(
      cwd,
      analysis.regions,
      sourceCache,
      beforeSourceRead,
      onSourceDependency,
    );
    diagnostics.push(...resolved.diagnostics);
    page.ppr = {
      ...ppr,
      regions: {
        ...(ppr.regions ?? {}),
        ...resolved.regions,
      },
    };
  }
}

function validateCoreGraphPageContracts(
  graph: CoreGraph,
  diagnostics: Diagnostic[],
): void {
  for (const page of Object.values(graph.pages)) {
    const file = page.source.module;
    if (hasErrorDiagnosticForFile(diagnostics, file)) continue;
    const renderingError = getPageBuildContractViolation(`Page "${page.id}"`, {
      ...page,
      component: page.source.module,
    });
    if (renderingError) {
      diagnostics.push({
        level: "error",
        file,
        message: renderingError,
      });
    }
  }
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

async function diagnosePageModuleRouteLifecycleExports(
  graph: CoreGraph,
  cwd: string,
  sourceCache: Map<string, string>,
  diagnostics: Diagnostic[],
  beforeSourceRead?: (file: string) => void,
  onSourceDependency?: (file: string) => void,
): Promise<void> {
  for (const page of Object.values(graph.pages)) {
    const absolute = await resolveProjectSourceAbsolute(
      cwd,
      page.source.module,
      onSourceDependency,
    );
    if (!absolute) continue;

    const source = await readFrameworkSource(
      absolute,
      sourceCache,
      beforeSourceRead,
    );
    if (source === undefined) continue;

    const exports = analyzePageModuleExports(source);
    if (exports.renderingConfig.length > 0) {
      diagnostics.push({
        level: "error",
        file: toPosixPath(path.relative(cwd, absolute)),
        message: `Page "${page.id}" exports rendering configuration ${exports.renderingConfig.map((name) => `"${name}"`).join(", ")} from its component module. Define these fields in the adjacent page.config.ts module; Page component exports are runtime values, not build configuration.`,
      });
    }
    if (page.render !== "csr" && exports.routeLifecycle.length > 0) {
      diagnostics.push({
        level: "error",
        file: toPosixPath(path.relative(cwd, absolute)),
        message: `Page "${page.id}" uses render "${page.render}" and exports browser-only route lifecycle ${exports.routeLifecycle.map((name) => `"${name}"`).join(", ")}. Non-CSR Pages cannot use browser-only route lifecycle exports. Remove these exports or use render: "csr".`,
      });
    }
  }
}

function derivePprConfig(
  prerender: PrerenderConfig | undefined,
): PprConfig | undefined {
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

async function collectPprRegionsFromPageClosure(
  cwd: string,
  root: string,
  sourceCache: Map<string, string>,
  fileDependencies: Set<string>,
  aliases?: Record<string, string>,
  beforeSourceRead?: (file: string) => void,
  onSourceDependency?: (file: string) => void,
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

    const source = await readFrameworkSource(
      file,
      sourceCache,
      beforeSourceRead,
    );
    if (source === undefined) return;

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

    for (const specifier of extractStaticImportSpecifiers(source, aliases)) {
      const dependency = await resolveSourceImport(
        cwd,
        file,
        specifier,
        aliases,
        onSourceDependency,
      );
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
  beforeSourceRead?: (file: string) => void,
  onSourceDependency?: (file: string) => void,
): Promise<{
  regions: PprRegionConfigMap;
  diagnostics: Diagnostic[];
}> {
  const resolved: PprRegionConfigMap = {};
  const diagnostics: Diagnostic[] = [];

  for (const [id, region] of Object.entries(regions)) {
    const component = await resolveProjectSourcePath(
      cwd,
      region.component,
      onSourceDependency,
    );
    const moduleConfig = await readPprRegionModuleConfig(
      cwd,
      component,
      sourceCache,
      beforeSourceRead,
      onSourceDependency,
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
  beforeSourceRead?: (file: string) => void,
  onSourceDependency?: (file: string) => void,
): Promise<{
  config: Partial<Omit<PprRegionConfigMap[string], "component">>;
  diagnostics: Diagnostic[];
}> {
  const empty = { config: {}, diagnostics: [] };
  if (!component.startsWith(".")) return empty;
  const absolute = await resolveProjectSourceAbsolute(
    cwd,
    component,
    onSourceDependency,
  );
  if (!absolute) return empty;

  const source = await readFrameworkSource(
    absolute,
    sourceCache,
    beforeSourceRead,
  );
  if (source === undefined) return empty;

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
  onSourceDependency?: (file: string) => void,
): Promise<string | undefined> {
  if (!sourcePath.startsWith(".")) return undefined;
  return resolveSourcePath(
    cwd,
    path.resolve(cwd, sourcePath),
    onSourceDependency,
  );
}

async function resolveProjectSourcePath(
  cwd: string,
  sourcePath: string,
  onSourceDependency?: (file: string) => void,
): Promise<string> {
  if (!sourcePath.startsWith(".")) return sourcePath;
  const resolved = await resolveSourcePath(
    cwd,
    path.resolve(cwd, sourcePath),
    onSourceDependency,
  );
  return resolved
    ? `./${toPosixPath(path.relative(cwd, resolved))}`
    : sourcePath;
}

function normalizePublicRoutePath(routePath: string): string {
  return routePath.startsWith("/") ? routePath : `/${routePath}`;
}

function hasErrorDiagnosticForFile(
  diagnostics: Diagnostic[],
  file: string,
): boolean {
  return diagnostics.some(
    (diagnostic) => diagnostic.level === "error" && diagnostic.file === file,
  );
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

  return sortRoutesBySpecificity(
    validRoutes.filter((route) => {
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
    }),
  );
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
    case "star-wildcard":
      return 'uses "*" as a wildcard segment. Use "$" for page route splats.';
  }
}

function toDiagnosticModulePath(module: string): string {
  return module.replace(/^\.\//, "");
}

async function collectRouteDirectories(
  cwd: string,
  root: string,
): Promise<string[]> {
  const dirs = new Set([root]);

  try {
    if (!(await isRealPathInsideCwd(cwd, root))) return [...dirs];
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [...dirs];
    throw error;
  }

  async function visit(current: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
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

async function collectFrameworkSourceFiles(
  config: GraphConfig,
  cwd: string,
  sourceCache: Map<string, string>,
  aliases?: Record<string, string>,
  providerSourceModules: string[] = [],
  beforeSourceRead?: (file: string) => void,
  onSourceDependency?: (file: string) => void,
): Promise<FrameworkSourceFiles> {
  const files = new Set<string>();
  const roots = new Set<string>();
  const explicitDependencyRoots = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  for (const module of providerSourceModules) {
    await addConfiguredSource(
      roots,
      cwd,
      module,
      `Application-route module "${module}"`,
      diagnostics,
      explicitDependencyRoots,
      onSourceDependency,
    );
  }

  for (const route of config.routing?.routes ?? []) {
    await addConfiguredSource(
      roots,
      cwd,
      route.module,
      `Page route "${route.id}" module`,
      diagnostics,
      explicitDependencyRoots,
      onSourceDependency,
    );
    await addConfiguredSource(
      roots,
      cwd,
      route.errorModule,
      `Page route "${route.id}" error boundary module`,
      diagnostics,
      explicitDependencyRoots,
      onSourceDependency,
    );
    await addConfiguredSource(
      roots,
      cwd,
      route.notFoundModule,
      `Page route "${route.id}" not-found boundary module`,
      diagnostics,
      explicitDependencyRoots,
      onSourceDependency,
    );
  }
  for (const route of config.server.routes ?? []) {
    await addConfiguredSource(
      roots,
      cwd,
      route.module,
      `Server route "${route.path}" module`,
      diagnostics,
      explicitDependencyRoots,
      onSourceDependency,
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
      onSourceDependency,
    );
  }
  await addConfiguredSource(
    roots,
    cwd,
    config.routing?.rootModule,
    "SPA root layout module",
    diagnostics,
    explicitDependencyRoots,
    onSourceDependency,
  );
  for (const root of roots) {
    await collectStaticImportClosure(
      files,
      cwd,
      root,
      sourceCache,
      aliases,
      beforeSourceRead,
      onSourceDependency,
    );
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
  onSourceDependency?: (file: string) => void,
): Promise<string | undefined> {
  if (!filePath) return;
  const absolute = path.resolve(cwd, filePath);
  const file = getConfiguredSourceDiagnosticFile(cwd, filePath, absolute);
  if (isInsideCwd(cwd, absolute)) onSourceDependency?.(absolute);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absolute);
  } catch (error) {
    if (!isMissingSourcePathError(error)) throw error;
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

  if (!isProjectSourceModule(absolute)) {
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

async function collectStaticImportClosure(
  files: Set<string>,
  cwd: string,
  file: string,
  sourceCache: Map<string, string>,
  aliases?: Record<string, string>,
  beforeSourceRead?: (file: string) => void,
  onSourceDependency?: (file: string) => void,
) {
  if (files.has(file)) return;
  files.add(file);

  const source = await readFrameworkSource(file, sourceCache, beforeSourceRead);
  if (source === undefined) return;

  for (const specifier of extractStaticImportSpecifiers(source, aliases)) {
    const dependency = await resolveSourceImport(
      cwd,
      file,
      specifier,
      aliases,
      onSourceDependency,
    );
    if (dependency) {
      await collectStaticImportClosure(
        files,
        cwd,
        dependency,
        sourceCache,
        aliases,
        beforeSourceRead,
        onSourceDependency,
      );
    }
  }
}

async function readFrameworkSource(
  file: string,
  sourceCache: Map<string, string>,
  beforeSourceRead?: (file: string) => void,
): Promise<string | undefined> {
  const cached = sourceCache.get(file);
  if (cached !== undefined) return cached;

  // Keep observer failures fail-closed while preserving source-discovery
  // tolerance for files that disappear during graph traversal.
  beforeSourceRead?.(file);
  try {
    const source = await fs.readFile(file, "utf-8");
    sourceCache.set(file, source);
    return source;
  } catch (error) {
    if (isMissingSourcePathError(error)) return undefined;
    throw error;
  }
}

function extractStaticImportSpecifiers(
  source: string,
  aliases?: Record<string, string>,
): string[] {
  return extractRuntimeModuleSpecifiers(source).filter((specifier) =>
    isLocalSourceImportSpecifier(specifier, aliases),
  );
}

function isLocalSourceImportSpecifier(
  specifier: string,
  aliases?: Record<string, string>,
): boolean {
  return (
    specifier.startsWith(".") ||
    specifier === DEFAULT_SOURCE_ALIAS.slice(0, -1) ||
    specifier.startsWith(DEFAULT_SOURCE_ALIAS) ||
    findMatchingSourceAlias(specifier, aliases) !== undefined
  );
}

function isFrameworkDependencySource(source: string): boolean {
  return /^\s*["']use (client|server)["']/m.test(source.slice(0, 200));
}

async function resolveSourceImport(
  cwd: string,
  fromFile: string,
  specifier: string,
  aliases?: Record<string, string>,
  onSourceDependency?: (file: string) => void,
): Promise<string | undefined> {
  const alias = findMatchingSourceAlias(specifier, aliases);
  if (alias) {
    const suffix = specifier.slice(alias.specifier.length).replace(/^\//, "");
    return resolveSourcePath(
      cwd,
      path.resolve(cwd, alias.replacement, suffix),
      onSourceDependency,
    );
  }
  if (specifier === DEFAULT_SOURCE_ALIAS.slice(0, -1)) {
    return resolveSourcePath(cwd, path.resolve(cwd, "src"), onSourceDependency);
  }
  if (specifier.startsWith(DEFAULT_SOURCE_ALIAS)) {
    return resolveSourcePath(
      cwd,
      path.resolve(cwd, "src", specifier.slice(DEFAULT_SOURCE_ALIAS.length)),
      onSourceDependency,
    );
  }
  return resolveSourcePath(
    cwd,
    path.resolve(path.dirname(fromFile), specifier),
    onSourceDependency,
  );
}

function findMatchingSourceAlias(
  specifier: string,
  aliases?: Record<string, string>,
): { specifier: string; replacement: string } | undefined {
  if (!aliases) return undefined;
  let match: { specifier: string; replacement: string } | undefined;
  for (const [alias, replacement] of Object.entries(aliases)) {
    if (specifier !== alias && !specifier.startsWith(`${alias}/`)) continue;
    if (!match || alias.length > match.specifier.length) {
      match = { specifier: alias, replacement };
    }
  }
  return match;
}

async function resolveSourcePath(
  cwd: string,
  base: string,
  onSourceDependency?: (file: string) => void,
): Promise<string | undefined> {
  const projectCandidates = registerProjectSourceResolutionCandidates(
    cwd,
    base,
    onSourceDependency,
  );

  for (const candidate of projectCandidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile() && isProjectSourceModule(candidate)) {
        return candidate;
      }
    } catch (error) {
      if (!isMissingSourcePathError(error)) throw error;
      // Non-source imports are handled by the bundler. Graph analysis only
      // follows local framework-relevant TypeScript/JavaScript modules.
    }
  }

  return undefined;
}
