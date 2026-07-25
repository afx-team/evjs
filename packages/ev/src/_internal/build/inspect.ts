import path from "node:path";
import type {
  BuildPlan,
  CoreGraph,
  GeneratedFrameworkPlan,
} from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import {
  type Config,
  type DefaultBundlerConfig,
  type ResolvedConfig,
  resolveBundlerConfig,
  resolveConfig,
} from "../../config/index.js";
import type { CliFlags, PluginContext } from "../../plugin/index.js";
import { analyzeAndMaterializeFrameworkIR } from "./analyze-and-materialize.js";
import {
  type BundlerAdapter,
  type BundlerCapabilities,
  type BundlerCapabilityGap,
  getBundlerBuildCapabilityGaps,
} from "./bundler.js";
import { withActiveBundler } from "./bundler-config.js";
import {
  createNoPageRoutesFoundMessage,
  createNoServerRoutesFoundMessage,
  readRoutingConfig,
  readServerRoutingConfig,
  withPageRoutingDefaults,
  withServerConventionDefaults,
  withServerRoutingDefaults,
} from "./convention-config.js";
import { validateHtmlTemplates } from "./framework-output.js";
import { createCoreGraph } from "./graph/index.js";
import { createPageRouteNodesFromCoreGraph } from "./page-route-types.js";
import type { PageRouteDiscovery } from "./page-routes.js";
import { resolvePluginExtensionState } from "./plugin-extensions.js";
import {
  collectPluginHooks,
  orderPluginsByDependencies,
  runBuildStartHooks,
  runConfigHooks,
  runDisposeHooks,
} from "./plugin-lifecycle.js";
import { toProjectPath } from "./utils.js";

const logger = getLogger(["evjs", "ev"]);

export interface InspectFrameworkBuildOptions<
  TBundlerCfg = DefaultBundlerConfig,
> {
  cwd?: string;
  flags?: CliFlags;
  mode?: "development" | "production";
  command?: "dev" | "build";
  bundler?: BundlerAdapter<TBundlerCfg>;
  runLifecycleHooks?: boolean;
}

export interface InspectDiagnostic {
  level: "warning" | "error";
  source:
    | "config"
    | "html"
    | "page-routes"
    | "server-routes"
    | "server-conventions"
    | "graph"
    | "plan"
    | "bundler"
    | "contributions";
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface InspectRouteFile {
  file: string;
  status: "route" | "facet" | "ignored" | "rejected";
  routeId?: string;
  routePath?: string;
  facetKind?: "root-layout" | "layout" | "error" | "not-found";
  diagnostics?: InspectDiagnostic[];
}

export interface InspectPageRoute {
  id: string;
  path: string;
  module: string;
}

export interface InspectBuildEntry {
  name: string;
  kind: string;
  environment: string;
  owner?: unknown;
}

export interface InspectHtmlDocument {
  id: string;
  fileName: string;
  aliases?: string[];
  owner: unknown;
}

export interface InspectFrameworkBuildResult {
  cwd: string;
  mode: "development" | "production";
  command: "dev" | "build";
  routing?: {
    /** Route and Document materialization mode. */
    routingMode: "spa" | "mpa";
    /** Canonical Page root. */
    pageRoot: string;
    document: {
      template: string;
      mount: string;
    };
    rootModule?: string;
  };
  pageRoutes: InspectPageRoute[];
  routeFiles: InspectRouteFile[];
  /** The single normalized semantic graph used by planning and plugins. */
  graph: CoreGraph;
  runtime: {
    server: ResolvedConfig["server"]["runtime"];
    transport?: ResolvedConfig["transport"];
  };
  output: {
    client: ResolvedConfig["output"]["client"];
    server: ResolvedConfig["output"]["server"];
  };
  bundler?: {
    name: string;
    capabilities: BundlerCapabilities;
    gaps: BundlerCapabilityGap[];
  };
  buildPlan?: {
    entries: InspectBuildEntry[];
    html: InspectHtmlDocument[];
    generated?: GeneratedFrameworkPlan;
  };
  diagnostics: InspectDiagnostic[];
  fileDependencies: string[];
  pluginWatchFiles: string[];
}

export async function inspectFrameworkBuild<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options: InspectFrameworkBuildOptions<TBundlerCfg> = {},
): Promise<InspectFrameworkBuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const command =
    options.command ??
    (options.mode === "development" ? "dev" : ("build" as const));
  const expectedMode = command === "dev" ? "development" : "production";
  if (options.mode && options.mode !== expectedMode) {
    throw new Error(
      `[evjs] inspectFrameworkBuild command "${command}" must use mode "${expectedMode}".`,
    );
  }
  const mode = options.mode ?? expectedMode;
  const flags = options.flags;
  const diagnostics: InspectDiagnostic[] = [];
  let pageRouteDiscovery: PageRouteDiscovery | undefined;

  const configuredConfig = await runConfigHooks(userConfig, {
    mode,
    command,
    cwd,
    flags,
  });
  const pageResolvedConfig = await withPageRoutingDefaults(
    resolveConfig(configuredConfig),
    configuredConfig,
    cwd,
    {
      allowEmptyRoutes: true,
      reportDiagnostics: false,
      syncRouteTypes: false,
      onDiscovery(base, discovery) {
        pageRouteDiscovery = discovery;
        diagnostics.push(
          ...discovery.diagnostics.map((diagnostic) =>
            toInspectDiagnostic("page-routes", diagnostic),
          ),
        );
        if (
          discovery.routes.length === 0 &&
          readRoutingConfig(configuredConfig) !== undefined &&
          !discovery.diagnostics.some(
            (diagnostic) => diagnostic.level === "error",
          )
        ) {
          diagnostics.push({
            level: "error",
            source: "page-routes",
            message: createNoPageRoutesFoundMessage(base.dir),
          });
        }
      },
    },
  );
  const rawResolvedConfig = await withServerRoutingDefaults(
    pageResolvedConfig,
    configuredConfig,
    cwd,
    {
      allowEmptyRoutes: true,
      reportDiagnostics: false,
      onDiscovery(base, discovery) {
        diagnostics.push(
          ...discovery.diagnostics.map((diagnostic) =>
            toInspectDiagnostic("server-routes", diagnostic),
          ),
        );
        if (
          discovery.routes.length === 0 &&
          readServerRoutingConfig(configuredConfig) !== undefined &&
          !discovery.diagnostics.some(
            (diagnostic) => diagnostic.level === "error",
          )
        ) {
          diagnostics.push({
            level: "error",
            source: "server-routes",
            message: createNoServerRoutesFoundMessage(base.dir),
          });
        }
      },
    },
  );
  const conventionResolvedConfig = await withServerConventionDefaults(
    rawResolvedConfig,
    cwd,
    {
      reportDiagnostics: false,
      onDiscovery(discovery) {
        diagnostics.push(
          ...discovery.diagnostics.map((diagnostic) =>
            toInspectDiagnostic("server-conventions", diagnostic),
          ),
        );
      },
    },
  );
  const resolvedConfig = {
    ...conventionResolvedConfig,
    plugins: orderPluginsByDependencies(conventionResolvedConfig.plugins),
  };
  const optionBundler = resolveBundlerConfig<TBundlerCfg>(
    options.bundler,
    "options.bundler",
  );
  const bundler = optionBundler ?? resolvedConfig.bundler ?? undefined;
  const baseConfig = bundler
    ? withActiveBundler(resolvedConfig, bundler)
    : resolvedConfig;
  const {
    registry: pluginExtensions,
    applicationExtensions,
    config,
  } = resolvePluginExtensionState(baseConfig);
  const pluginWatchFiles = new Set<string>();
  const pluginContext: PluginContext<TBundlerCfg> = {
    mode,
    command,
    cwd,
    config,
    flags,
    logger,
    addWatchFile(file) {
      pluginWatchFiles.add(path.resolve(cwd, file));
    },
  };
  const hooks = await collectPluginHooks(config.plugins, pluginContext);
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await runDisposeHooks(hooks, pluginContext);
  };

  try {
    if (options.runLifecycleHooks === true) {
      await runBuildStartHooks(hooks, pluginContext);
    }
    try {
      validateHtmlTemplates(cwd, config);
    } catch (err) {
      diagnostics.push({
        level: "error",
        source: "html",
        message: formatInspectError(err),
      });
    }

    let analysis: Awaited<ReturnType<typeof createCoreGraph>>;
    let latestAnalysis: Awaited<ReturnType<typeof createCoreGraph>> | undefined;
    let plan: BuildPlan | undefined;
    try {
      const materialized = await analyzeAndMaterializeFrameworkIR({
        cwd,
        mode,
        command,
        config,
        pluginContext,
        pluginExtensions,
        applicationExtensions,
        write: false,
        onAnalysis(currentAnalysis) {
          latestAnalysis = currentAnalysis;
        },
      });
      analysis = materialized.analysis;
      plan = materialized.plan;
    } catch (err) {
      analysis =
        latestAnalysis ??
        (await createCoreGraph(config, cwd, {
          pluginExtensions,
          applicationExtensions,
        }));
      diagnostics.push({
        level: "error",
        source: "contributions",
        message: formatInspectError(err),
      });
    }
    diagnostics.push(
      ...analysis.diagnostics.map((diagnostic) =>
        toInspectDiagnostic("graph", diagnostic),
      ),
    );
    const bundlerGaps =
      bundler && plan ? getBundlerBuildCapabilityGaps(bundler, plan) : [];
    diagnostics.push(
      ...bundlerGaps.map((gap) => ({
        level: "error" as const,
        source: "bundler" as const,
        message: `Bundler "${bundler?.name}" lacks ${gap.capability}: ${gap.reason}.`,
      })),
    );

    return {
      cwd,
      mode,
      command,
      routing: createInspectRouting(config, analysis.graph),
      pageRoutes: createPageRouteNodesFromCoreGraph(analysis.graph).map(
        (route) => ({
          id: route.id,
          path: route.path,
          module: route.module,
        }),
      ),
      routeFiles: createInspectRouteFiles(cwd, pageRouteDiscovery, diagnostics),
      graph: analysis.graph,
      runtime: {
        server: config.server.runtime,
        ...(config.transport.baseUrl ? { transport: config.transport } : {}),
      },
      output: {
        client: config.output.client,
        server: config.output.server,
      },
      ...(bundler
        ? {
            bundler: {
              name: bundler.name,
              capabilities: {
                build: { ...bundler.capabilities.build },
                dev: { ...bundler.capabilities.dev },
              },
              gaps: bundlerGaps,
            },
          }
        : {}),
      buildPlan: plan
        ? {
            entries: plan.entries.map((entry) => ({
              name: entry.name,
              kind: entry.kind,
              environment: entry.environment,
              ...(entry.owner ? { owner: entry.owner } : {}),
            })),
            html: plan.html.map((document) => ({
              id: document.id,
              fileName: document.fileName,
              ...(document.aliases ? { aliases: [...document.aliases] } : {}),
              owner: document.owner,
            })),
            ...(plan.generated ? { generated: plan.generated } : {}),
          }
        : undefined,
      diagnostics,
      fileDependencies: analysis.fileDependencies,
      pluginWatchFiles: [...pluginWatchFiles].sort(),
    };
  } finally {
    await dispose();
  }
}
function toInspectDiagnostic(
  source: InspectDiagnostic["source"],
  diagnostic: {
    level: "warning" | "error";
    message: string;
    file?: string;
    line?: number;
    column?: number;
  },
): InspectDiagnostic {
  return {
    level: diagnostic.level,
    source,
    message: diagnostic.message,
    ...(diagnostic.file ? { file: diagnostic.file } : {}),
    ...(diagnostic.line !== undefined ? { line: diagnostic.line } : {}),
    ...(diagnostic.column !== undefined ? { column: diagnostic.column } : {}),
  };
}

function formatInspectError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function createInspectRouting<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  graph: CoreGraph,
): InspectFrameworkBuildResult["routing"] {
  if (config.routing) {
    return {
      routingMode: config.routing.mode,
      pageRoot: config.routing.dir,
      document: {
        template: config.routing.html,
        mount: config.routing.mount,
      },
      ...(config.routing.rootModule
        ? { rootModule: config.routing.rootModule }
        : {}),
    };
  }
  if (!config.application) return undefined;

  const rootLayout = graph.applications.default?.layout;
  return {
    routingMode: "spa",
    pageRoot: config.application.pageRoot,
    document: {
      template: config.application.document.template,
      mount: config.application.document.mount,
    },
    ...(rootLayout ? { rootModule: rootLayout } : {}),
  };
}

function createInspectRouteFiles(
  cwd: string,
  discovery: PageRouteDiscovery | undefined,
  diagnostics: InspectDiagnostic[],
): InspectRouteFile[] {
  if (!discovery) return [];

  const routeByModule = new Map(
    discovery.routes
      .filter((route) => route.kind !== "layout")
      .map((route) => [route.module, route]),
  );
  const facetByModule = createInspectFacetClaims(discovery);
  const diagnosticsByFile = new Map<string, InspectDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.source !== "page-routes" || !diagnostic.file) continue;
    const file = normalizeDiagnosticFile(diagnostic.file);
    const entries = diagnosticsByFile.get(file) ?? [];
    entries.push(diagnostic);
    diagnosticsByFile.set(file, entries);
  }

  const projectFiles = new Set(
    discovery.files.map((file) => toProjectPath(cwd, file)),
  );
  if (discovery.rootModule) projectFiles.add(discovery.rootModule);

  return [...projectFiles]
    .map((projectFile) => {
      const route = routeByModule.get(projectFile);
      const facet = facetByModule.get(projectFile);
      const fileDiagnostics =
        diagnosticsByFile.get(normalizeDiagnosticFile(projectFile)) ?? [];
      if (route) {
        return {
          file: projectFile,
          status: "route" as const,
          routeId: route.id,
          routePath: route.path,
        };
      }
      if (facet) {
        return {
          file: projectFile,
          status: "facet" as const,
          facetKind: facet.kind,
          ...(facet.routeId ? { routeId: facet.routeId } : {}),
          ...(facet.routePath ? { routePath: facet.routePath } : {}),
        };
      }
      if (fileDiagnostics.some((diagnostic) => diagnostic.level === "error")) {
        return {
          file: projectFile,
          status: "rejected" as const,
          diagnostics: fileDiagnostics,
        };
      }
      return {
        file: projectFile,
        status: "ignored" as const,
        ...(fileDiagnostics.length > 0 ? { diagnostics: fileDiagnostics } : {}),
      };
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

interface InspectFacetClaim {
  kind: "root-layout" | "layout" | "error" | "not-found";
  routeId?: string;
  routePath?: string;
}

function createInspectFacetClaims(
  discovery: PageRouteDiscovery,
): Map<string, InspectFacetClaim> {
  const claims = new Map<string, InspectFacetClaim>();
  if (discovery.rootModule) {
    claims.set(discovery.rootModule, { kind: "root-layout" });
  }
  for (const route of discovery.routes) {
    if (route.kind === "layout") {
      claims.set(route.module, {
        kind: "layout",
        routeId: route.id,
        routePath: route.path,
      });
    }
    if (route.errorModule && !claims.has(route.errorModule)) {
      claims.set(route.errorModule, { kind: "error" });
    }
    if (route.notFoundModule && !claims.has(route.notFoundModule)) {
      claims.set(route.notFoundModule, { kind: "not-found" });
    }
  }
  return claims;
}

function normalizeDiagnosticFile(file: string): string {
  return file.replace(/^\.\//, "");
}
