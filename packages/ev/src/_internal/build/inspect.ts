import path from "node:path";
import type {
  AppGraph,
  BuildPlan,
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
import type { PluginContext } from "../../plugin/index.js";
import { analyzeAndMaterializeFrameworkIR } from "./analyze-and-materialize.js";
import type { BundlerAdapter } from "./bundler.js";
import { withActiveBundler } from "./bundler-config.js";
import {
  createNoServerRoutesFoundMessage,
  readRoutingConfig,
  readServerRoutingConfig,
  withPageRoutingDefaults,
  withServerConventionDefaults,
  withServerRoutingDefaults,
} from "./convention-config.js";
import { validateHtmlTemplates } from "./framework-output.js";
import { createAppGraph } from "./graph/index.js";
import { getPageRouteTypesPath } from "./page-route-types.js";
import type { PageRouteDiscovery } from "./page-routes.js";
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
    | "contributions";
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface InspectRouteFile {
  file: string;
  status: "route" | "ignored" | "rejected";
  routeId?: string;
  routePath?: string;
  diagnostics?: InspectDiagnostic[];
}

export interface InspectPageRoute {
  id: string;
  path: string;
  module: string;
}

export interface InspectPageOutput {
  id: string;
  path?: string;
  routeId?: string;
  component?: string;
  entry?: string;
  app?: string;
  render: string;
  hydrate?: string;
  prerender?: unknown;
  rsc: boolean;
  partialPrerender: boolean;
}

export interface InspectServerFunction {
  id: string;
  module: string;
  exportName: string;
}

export interface InspectServerRoute {
  id: string;
  module: string;
  path: string;
  methods: string[];
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
  owner: unknown;
}

export interface InspectFrameworkBuildResult {
  cwd: string;
  mode: "development" | "production";
  command: "dev" | "build";
  routing?: {
    mode: "spa" | "mpa";
    dir: string;
    html: string;
    mount: string;
    conventions?: {
      layout: boolean | string;
    };
    rootModule?: string;
    routeTypes?: string;
  };
  pageRoutes: InspectPageRoute[];
  routeFiles: InspectRouteFile[];
  pages: InspectPageOutput[];
  serverFunctions: InspectServerFunction[];
  serverRoutes: InspectServerRoute[];
  runtime: {
    server: ResolvedConfig["server"]["runtime"];
    transport?: ResolvedConfig["transport"];
  };
  output: {
    client: ResolvedConfig["output"]["client"];
    server: ResolvedConfig["output"]["server"];
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
  const diagnostics: InspectDiagnostic[] = [];
  let pageRouteDiscovery: PageRouteDiscovery | undefined;

  const configuredConfig = await runConfigHooks(userConfig, {
    mode,
    command,
    cwd,
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
            message: `No page routes found in ${base.dir}. Add a default-exporting route module such as ${base.dir.replace(/\/+$/, "")}/index.tsx or set routing: false.`,
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
  const config = bundler
    ? withActiveBundler(resolvedConfig, bundler)
    : resolvedConfig;
  const pluginWatchFiles = new Set<string>();
  const pluginContext: PluginContext<TBundlerCfg> = {
    mode,
    command,
    cwd,
    config,
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

    let analysis: Awaited<ReturnType<typeof createAppGraph>>;
    let plan: BuildPlan | undefined;
    try {
      const materialized = await analyzeAndMaterializeFrameworkIR({
        cwd,
        mode,
        command,
        config,
        pluginContext,
        write: false,
      });
      analysis = materialized.analysis;
      plan = materialized.plan;
    } catch (err) {
      analysis = await createAppGraph(config, cwd);
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

    return {
      cwd,
      mode,
      command,
      routing: createInspectRouting(cwd, config),
      pageRoutes: (config.routing?.routes ?? []).map((route) => ({
        id: route.id,
        path: route.path,
        module: route.module,
      })),
      routeFiles: createInspectRouteFiles(cwd, pageRouteDiscovery, diagnostics),
      pages: Object.values(analysis.graph.pages)
        .map(createInspectPageOutput)
        .sort((left, right) => left.id.localeCompare(right.id)),
      serverFunctions: analysis.graph.serverFunctions
        .map((fn) => ({
          id: fn.id,
          module: fn.module,
          exportName: fn.exportName,
        }))
        .sort(compareById),
      serverRoutes: analysis.graph.serverRoutes
        .map((route) => ({
          id: route.id,
          module: route.module,
          path: route.path,
          methods: route.methods,
        }))
        .sort(compareById),
      runtime: {
        server: config.server.runtime,
        ...(config.transport.baseUrl ? { transport: config.transport } : {}),
      },
      output: {
        client: config.output.client,
        server: config.output.server,
      },
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
  cwd: string,
  config: ResolvedConfig<TBundlerCfg>,
): InspectFrameworkBuildResult["routing"] {
  if (!config.routing) return undefined;
  return {
    mode: config.routing.mode,
    dir: config.routing.dir,
    html: config.routing.html,
    mount: config.routing.mount,
    ...(config.routing.conventions
      ? { conventions: config.routing.conventions }
      : {}),
    ...(config.routing.rootModule
      ? { rootModule: config.routing.rootModule }
      : {}),
    ...(config.routing.mode === "spa"
      ? {
          routeTypes: toProjectPath(
            cwd,
            getPageRouteTypesPath(cwd, config.routing.dir).file,
          ),
        }
      : {}),
  };
}

function createInspectRouteFiles(
  cwd: string,
  discovery: PageRouteDiscovery | undefined,
  diagnostics: InspectDiagnostic[],
): InspectRouteFile[] {
  if (!discovery) return [];

  const routeByModule = new Map(
    discovery.routes.map((route) => [route.module, route]),
  );
  const diagnosticsByFile = new Map<string, InspectDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.source !== "page-routes" || !diagnostic.file) continue;
    const file = normalizeDiagnosticFile(diagnostic.file);
    const entries = diagnosticsByFile.get(file) ?? [];
    entries.push(diagnostic);
    diagnosticsByFile.set(file, entries);
  }

  return discovery.files
    .map((file) => {
      const projectFile = toProjectPath(cwd, file);
      const route = routeByModule.get(projectFile);
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

function createInspectPageOutput(
  page: AppGraph["pages"][string],
): InspectPageOutput {
  return {
    id: page.id,
    ...(page.path ? { path: page.path } : {}),
    ...(page.routeId ? { routeId: page.routeId } : {}),
    ...(page.component ? { component: page.component } : {}),
    ...(page.entry ? { entry: page.entry } : {}),
    ...(page.app ? { app: page.app } : {}),
    render: page.render,
    ...(page.hydrate ? { hydrate: page.hydrate } : {}),
    ...(page.prerender ? { prerender: page.prerender } : {}),
    rsc: page.componentModel === "rsc",
    partialPrerender:
      Boolean(page.ppr) ||
      (typeof page.prerender === "object" &&
        page.prerender !== null &&
        "partial" in page.prerender &&
        page.prerender.partial === true),
  };
}

function compareById<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function normalizeDiagnosticFile(file: string): string {
  return file.replace(/^\.\//, "");
}
