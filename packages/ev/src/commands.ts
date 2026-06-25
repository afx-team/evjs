import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AppGraph,
  BuildOutput,
  BuildPlan,
  BuildPlanUpdate,
} from "@evjs/shared/manifest";
import {
  assertFrameworkManifestShape,
  createPublicManifest,
  createServerManifest,
  linkBuildOutput,
} from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import { execa } from "execa";
import { validateHtmlTemplate } from "./build-tools/html.js";
import {
  applyRouteScopedMiddlewares,
  type CreateBuildPlanOptions,
  createAppGraph,
  createBuildPlan,
  diffBuildPlan,
  discoverPageRoutes,
  discoverServerConventions,
  discoverServerRoutes,
  generateHtml,
  type HtmlAsset,
} from "./build-tools/index.js";
import {
  PAGE_ROUTE_CONVENTION_DOCS_URL,
  PAGE_ROUTE_CONVENTION_SUMMARY,
} from "./build-tools/page-route-conventions.js";
import {
  collectGeneratedPageRouteTypeFiles,
  generatePageRouteTypes,
  getPageRouteTypesPath,
  writePageRouteTypesIfChanged,
} from "./build-tools/page-route-types.js";
import { PAGES_APP_ENTRY_IMPORT } from "./build-tools/pages-entry.js";
import { toProjectPath } from "./build-tools/utils.js";
import type {
  BundlerAdapter,
  BundlerBuildFacts,
  BundlerDevController,
} from "./bundler.js";
import {
  CONFIG_DEFAULTS,
  type Config,
  type DefaultBundlerConfig,
  type ResolvedConfig,
  resolveBundlerConfig,
  resolveConfig,
  resolvePluginsConfig,
} from "./config.js";
import { buildHtml } from "./html.js";
import {
  type BuildResult,
  createBuildResult,
  type HtmlDocumentInfo,
  type Plugin,
  type PluginConfigContext,
  type PluginContext,
  type PluginHooks,
} from "./plugin.js";

const logger = getLogger(["evjs", "ev"]);

type ApiProcess = ReturnType<typeof execa>;
const API_READY_MARKER = "__EVJS_API_READY__";
const DEV_PAGE_RENDER_PROXY_HEADER = "x-evjs-dev-page-render";
const DEV_DIST_DIR = "dist";
const DEV_DIST_LOCK_FILE = ".evjs-dev.lock";
const MANIFEST_FILE = "manifest.json";
const BUILD_OUTPUT_FILE = "build-output.json";
const PLUGIN_HOOK_NAMES = [
  "buildStart",
  "buildOutput",
  "bundlerConfig",
  "buildEnd",
  "dispose",
  "transformHtml",
] as const satisfies readonly (keyof PluginHooks)[];
const PAGE_ROUTE_CONVENTION_DOCS_HINT = `${PAGE_ROUTE_CONVENTION_SUMMARY}. See ${PAGE_ROUTE_CONVENTION_DOCS_URL} for the page route file convention.`;

interface DevDistLock {
  command: "dev";
  distDir: string;
  pid: number;
  startedAt: string;
}

export interface DevOptions<TBundlerCfg = DefaultBundlerConfig> {
  cwd?: string;
  bundler?: BundlerAdapter<TBundlerCfg>;
  loadConfig?: (
    cwd: string,
  ) =>
    | Config<TBundlerCfg>
    | undefined
    | Promise<Config<TBundlerCfg> | undefined>;
}

export interface BuildOptions<TBundlerCfg = DefaultBundlerConfig> {
  cwd?: string;
  bundler?: BundlerAdapter<TBundlerCfg>;
}

export interface PrepareFrameworkBuildOptions<
  TBundlerCfg = DefaultBundlerConfig,
> {
  cwd?: string;
  mode?: "development" | "production";
  command?: "dev" | "build";
  bundler?: BundlerAdapter<TBundlerCfg>;
  requireBundler?: boolean;
  runLifecycleHooks?: boolean;
}

export interface PreparedFrameworkBuild<TBundlerCfg = DefaultBundlerConfig> {
  cwd: string;
  mode: "development" | "production";
  command: "dev" | "build";
  config: ResolvedConfig<TBundlerCfg>;
  fileDependencies: string[];
  pluginWatchFiles: string[];
  dispose(): Promise<void>;
}

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
    | "plan";
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
  };
  diagnostics: InspectDiagnostic[];
  fileDependencies: string[];
  pluginWatchFiles: string[];
}

interface InternalPrepareFrameworkBuildOptions<
  TBundlerCfg = DefaultBundlerConfig,
> extends PrepareFrameworkBuildOptions<TBundlerCfg> {
  plan?: CreateBuildPlanOptions;
}

interface InternalPreparedFrameworkBuild<TBundlerCfg = DefaultBundlerConfig>
  extends PreparedFrameworkBuild<TBundlerCfg> {
  graph: AppGraph;
  plan: BuildPlan;
  hooks: PluginHooks<TBundlerCfg>[];
  pluginContext: PluginContext<TBundlerCfg>;
}

interface PageRoutingDefaultsOptions {
  syncRouteTypes?: boolean;
  reportDiagnostics?: boolean;
  allowEmptyRoutes?: boolean;
  onDiscovery?: (
    base: NonNullable<ResolvedConfig["routing"]>,
    discovery: Awaited<ReturnType<typeof discoverPageRoutes>>,
  ) => void;
}

interface ServerRoutingDefaultsOptions {
  reportDiagnostics?: boolean;
  allowEmptyRoutes?: boolean;
  onDiscovery?: (
    base: NonNullable<ResolvedConfig["server"]["routing"]>,
    discovery: Awaited<ReturnType<typeof discoverServerRoutes>>,
  ) => void;
}

interface ServerConventionDefaultsOptions {
  reportDiagnostics?: boolean;
  onDiscovery?: (
    discovery: Awaited<ReturnType<typeof discoverServerConventions>>,
  ) => void;
}

function resolveBundler<TBundlerCfg>(
  configBundler: BundlerAdapter<TBundlerCfg> | undefined,
  optionBundler: BundlerAdapter<TBundlerCfg> | undefined,
): BundlerAdapter<TBundlerCfg> {
  const bundler =
    optionBundler === undefined
      ? configBundler
      : resolveBundlerConfig<TBundlerCfg>(optionBundler, "options.bundler");
  if (!bundler) {
    throw new Error(
      "[evjs] No bundler configured. Pass a bundler adapter in ev.config.ts or through dev/build options.",
    );
  }
  return bundler;
}

function withActiveBundler<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  bundler: BundlerAdapter<TBundlerCfg>,
): ResolvedConfig<TBundlerCfg> {
  if (config.bundler === bundler) {
    return config;
  }

  return {
    ...config,
    bundler,
  };
}

async function withPageRoutingDefaults<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  userConfig: Config<TBundlerCfg> | undefined,
  cwd: string,
  options: PageRoutingDefaultsOptions = {},
): Promise<ResolvedConfig<TBundlerCfg>> {
  const routingOption = readRoutingConfig(userConfig);
  const syncRouteTypes = options.syncRouteTypes !== false;
  if (routingOption === false) {
    if (syncRouteTypes) {
      await removeAllPageRouteTypes(cwd);
    }
    return { ...config, routing: undefined };
  }

  const requested = routingOption !== undefined;
  if ((config.pages || config.app) && requested) {
    throw new Error(
      "[evjs] routing cannot be combined with app or pages configuration.",
    );
  }
  if (config.pages || config.app) {
    if (syncRouteTypes) {
      await removeAllPageRouteTypes(cwd);
    }
    return config;
  }

  const base = config.routing ?? {
    mode: CONFIG_DEFAULTS.routingMode,
    dir: CONFIG_DEFAULTS.routingDir,
    html: config.html,
    mount: CONFIG_DEFAULTS.mount,
    conventions: {
      layout: true,
    },
    routes: [],
  };
  const discovery = await discoverPageRoutes(cwd, {
    dir: base.dir,
    mode: base.mode,
    rootLayout:
      base.mode === "spa" ? (base.conventions?.layout ?? false) : false,
    required: requested,
  });
  options.onDiscovery?.(base, discovery);
  if (options.reportDiagnostics !== false) {
    reportPageRouteDiagnostics(discovery.diagnostics);
  }

  if (discovery.routes.length === 0) {
    if (!requested) {
      if (syncRouteTypes) {
        await removeAllPageRouteTypes(cwd);
      }
      return config;
    }
    if (options.allowEmptyRoutes) {
      return {
        ...config,
        html: base.html,
        routing: {
          ...base,
          routes: [],
        },
      };
    }
    throw new Error(
      `[evjs] No page routes found in ${base.dir}. Add a default-exporting route module such as ${base.dir.replace(/\/+$/, "")}/index.tsx or set routing: false. ${PAGE_ROUTE_CONVENTION_DOCS_HINT}`,
    );
  }

  if (syncRouteTypes) {
    await syncPageRouteTypes(cwd, base.dir, base.mode, discovery.routes);
  }

  const entry =
    base.mode === "spa" ? createPagesEntryImport(discovery.routes) : undefined;

  return {
    ...config,
    ...(entry ? { entry } : {}),
    html: base.html,
    routing: {
      ...base,
      ...(entry ? { entry } : {}),
      routes: discovery.routes,
      ...(base.mode === "spa" && discovery.rootModule
        ? { rootModule: discovery.rootModule }
        : {}),
    },
  };
}

async function withServerRoutingDefaults<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  userConfig: Config<TBundlerCfg> | undefined,
  cwd: string,
  options: ServerRoutingDefaultsOptions = {},
): Promise<ResolvedConfig<TBundlerCfg>> {
  const routingOption = readServerRoutingConfig(userConfig);
  if (routingOption === false) {
    return {
      ...config,
      server: {
        ...config.server,
        routing: undefined,
      },
    };
  }

  if (!config.server.routing) return config;

  const requested = routingOption !== undefined;
  const base = config.server.routing;
  const discovery = await discoverServerRoutes(cwd, {
    dir: base.dir,
    required: requested,
  });
  options.onDiscovery?.(base, discovery);
  if (options.reportDiagnostics !== false) {
    reportServerRouteDiagnostics(discovery.diagnostics);
  }

  if (discovery.routes.length === 0) {
    if (!requested) {
      return {
        ...config,
        server: {
          ...config.server,
          routing: undefined,
        },
      };
    }
    if (options.allowEmptyRoutes) {
      return {
        ...config,
        server: {
          ...config.server,
          routing: {
            ...base,
            routes: [],
          },
        },
      };
    }
    throw new Error(createNoServerRoutesFoundMessage(base.dir));
  }

  return {
    ...config,
    server: {
      ...config.server,
      routing: {
        ...base,
        routes: discovery.routes,
      },
    },
  };
}

async function withServerConventionDefaults<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  cwd: string,
  options: ServerConventionDefaultsOptions = {},
): Promise<ResolvedConfig<TBundlerCfg>> {
  const conventions = config.server.conventions;
  if (conventions?.middleware !== true) {
    return {
      ...config,
      server: {
        ...config.server,
        conventions: undefined,
      },
    };
  }

  const discovery = await discoverServerConventions(cwd, {
    globalFile: CONFIG_DEFAULTS.serverMiddlewareFile,
    routingDir: config.server.routing?.dir,
    middleware: conventions.middleware,
  });
  options.onDiscovery?.(discovery);
  if (options.reportDiagnostics !== false) {
    reportServerConventionDiagnostics(discovery.diagnostics);
  }

  const nextRouting = config.server.routing
    ? {
        ...config.server.routing,
        routes: applyRouteScopedMiddlewares(
          config.server.routing.routes,
          discovery.routeMiddlewares,
        ),
      }
    : undefined;

  return {
    ...config,
    server: {
      ...config.server,
      ...(nextRouting ? { routing: nextRouting } : { routing: undefined }),
      conventions: {
        ...conventions,
        globalMiddlewares: discovery.globalMiddlewares,
        routeMiddlewares: discovery.routeMiddlewares,
      },
    },
  };
}

function readRoutingConfig<TBundlerCfg>(
  config: Config<TBundlerCfg> | undefined,
): Config<TBundlerCfg>["routing"] {
  return config?.routing;
}

function readServerRoutingConfig<TBundlerCfg>(
  config: Config<TBundlerCfg> | undefined,
): ServerRoutingConfigValue<TBundlerCfg> {
  return config?.server?.routing;
}

type ServerRoutingConfigValue<TBundlerCfg> =
  | Exclude<Config<TBundlerCfg>["server"], undefined>["routing"]
  | undefined;

function createPagesEntryImport(
  routes: NonNullable<ResolvedConfig["routing"]>["routes"],
): string {
  if (!routes[0]) {
    throw new Error("[evjs] Page routes need at least one page module.");
  }
  return PAGES_APP_ENTRY_IMPORT;
}

async function syncPageRouteTypes(
  cwd: string,
  routingDir: string,
  mode: NonNullable<ResolvedConfig["routing"]>["mode"],
  routes: NonNullable<ResolvedConfig["routing"]>["routes"],
): Promise<void> {
  const { dir, file, importBaseDir } = getPageRouteTypesPath(cwd, routingDir);

  if (mode !== "spa") {
    await removeAllPageRouteTypes(cwd);
    return;
  }

  const source = generatePageRouteTypes({
    routes,
    importBaseDir,
  });

  await fs.promises.mkdir(dir, { recursive: true });
  await writePageRouteTypesIfChanged(file, source);
  await removeStalePageRouteTypes(cwd, file);
}

async function removeStalePageRouteTypes(
  cwd: string,
  activeFile: string,
): Promise<void> {
  const active = path.resolve(activeFile);
  const staleFiles = await collectGeneratedPageRouteTypeFiles(cwd);
  await Promise.all(
    staleFiles
      .filter((file) => path.resolve(file) !== active)
      .map((file) => fs.promises.rm(file, { force: true })),
  );
}

async function removeAllPageRouteTypes(cwd: string): Promise<void> {
  await Promise.all(
    (await collectGeneratedPageRouteTypeFiles(cwd)).map((file) =>
      fs.promises.rm(file, { force: true }),
    ),
  );
}

function reportPageRouteDiagnostics(
  diagnostics: Array<{
    level: "warning" | "error";
    message: string;
    file?: string;
  }>,
): void {
  const errors: string[] = [];
  for (const diagnostic of diagnostics) {
    const message = diagnostic.file
      ? `${diagnostic.file} - ${diagnostic.message}`
      : diagnostic.message;
    if (diagnostic.level === "error") {
      errors.push(message);
    } else {
      logger.warn`${message}`;
    }
  }
  if (errors.length > 0) {
    throw new Error(
      [
        "[evjs] Page route discovery failed.",
        ...errors,
        PAGE_ROUTE_CONVENTION_DOCS_HINT,
      ].join("\n"),
    );
  }
}

function reportServerRouteDiagnostics(
  diagnostics: Array<{
    level: "warning" | "error";
    message: string;
    file?: string;
  }>,
): void {
  const errors: string[] = [];
  for (const diagnostic of diagnostics) {
    const message = diagnostic.file
      ? `${diagnostic.file} - ${diagnostic.message}`
      : diagnostic.message;
    if (diagnostic.level === "error") {
      errors.push(message);
    } else {
      logger.warn`${message}`;
    }
  }
  if (errors.length > 0) {
    throw new Error(
      ["[evjs] Server route discovery failed.", ...errors].join("\n"),
    );
  }
}

function reportServerConventionDiagnostics(
  diagnostics: Array<{
    level: "warning" | "error";
    message: string;
    file?: string;
  }>,
): void {
  const errors: string[] = [];
  for (const diagnostic of diagnostics) {
    const message = diagnostic.file
      ? `${diagnostic.file} - ${diagnostic.message}`
      : diagnostic.message;
    if (diagnostic.level === "error") {
      errors.push(message);
    } else {
      logger.warn`${message}`;
    }
  }
  if (errors.length > 0) {
    throw new Error(
      ["[evjs] Server convention discovery failed.", ...errors].join("\n"),
    );
  }
}

function createNoServerRoutesFoundMessage(dir: string): string {
  return `[evjs] No server routes found in ${dir}. Add a route module exporting GET or POST such as ${dir.replace(/\/+$/, "")}/index.ts or set server.routing: false.`;
}

function orderPluginsByDependencies<TBundlerCfg>(
  plugins: Plugin<TBundlerCfg>[],
): Plugin<TBundlerCfg>[] {
  const pluginByName = new Map<string, Plugin<TBundlerCfg>>();
  const dependentsByName = new Map<string, string[]>();
  const dependencyCountByName = new Map<string, number>();

  for (const plugin of plugins) {
    const existing = pluginByName.get(plugin.name);
    if (existing) {
      throw new Error(
        `[evjs] Duplicate plugin name "${plugin.name}". Plugin names must be unique.`,
      );
    }
    pluginByName.set(plugin.name, plugin);
    dependentsByName.set(plugin.name, []);
    dependencyCountByName.set(plugin.name, 0);
  }

  const addDependency = (
    plugin: Plugin<TBundlerCfg>,
    dependencyName: string,
    options: { optional: boolean },
  ) => {
    if (!pluginByName.has(dependencyName)) {
      if (options.optional) return;
      throw new Error(
        `[evjs] Plugin "${plugin.name}" depends on missing plugin "${dependencyName}".`,
      );
    }
    dependentsByName.get(dependencyName)?.push(plugin.name);
    dependencyCountByName.set(
      plugin.name,
      (dependencyCountByName.get(plugin.name) ?? 0) + 1,
    );
  };

  for (const plugin of plugins) {
    for (const dependencyName of plugin.dependencies ?? []) {
      addDependency(plugin, dependencyName, { optional: false });
    }
    for (const dependencyName of plugin.optionalDependencies ?? []) {
      addDependency(plugin, dependencyName, { optional: true });
    }
  }

  const ready = plugins
    .filter((plugin) => dependencyCountByName.get(plugin.name) === 0)
    .sort(comparePluginEnforce);
  const ordered: Plugin<TBundlerCfg>[] = [];

  while (ready.length > 0) {
    const plugin = ready.shift();
    if (!plugin) break;
    ordered.push(plugin);

    for (const dependentName of dependentsByName.get(plugin.name) ?? []) {
      const nextDependencyCount =
        (dependencyCountByName.get(dependentName) ?? 0) - 1;
      dependencyCountByName.set(dependentName, nextDependencyCount);
      if (nextDependencyCount === 0) {
        const dependent = pluginByName.get(dependentName);
        if (dependent) {
          ready.push(dependent);
          ready.sort(comparePluginEnforce);
        }
      }
    }
  }

  if (ordered.length !== plugins.length) {
    const remainingNames = plugins
      .filter((plugin) => !ordered.includes(plugin))
      .map((plugin) => plugin.name);
    const remaining = new Set(remainingNames);

    for (const pluginName of remainingNames) {
      const path: string[] = [];
      const seen = new Set<string>();
      let currentName = pluginName;
      let repeatedName: string | undefined;

      while (true) {
        if (seen.has(currentName)) {
          repeatedName = currentName;
          break;
        }
        seen.add(currentName);
        path.push(currentName);
        const current = pluginByName.get(currentName);
        const nextName = [
          ...(current?.dependencies ?? []),
          ...(current?.optionalDependencies ?? []),
        ].find((name) => remaining.has(name));
        if (!nextName) break;
        currentName = nextName;
      }

      if (repeatedName) {
        const cycleStart = path.indexOf(repeatedName);
        const cycle = [...path.slice(cycleStart), repeatedName].join(" -> ");
        throw new Error(
          `[evjs] Circular plugin dependency detected: ${cycle}.`,
        );
      }
    }

    throw new Error(
      `[evjs] Circular plugin dependency detected among: ${remainingNames.join(", ")}.`,
    );
  }

  return ordered;
}

function comparePluginEnforce<TBundlerCfg>(
  a: Plugin<TBundlerCfg>,
  b: Plugin<TBundlerCfg>,
): number {
  return pluginEnforceRank(a) - pluginEnforceRank(b);
}

function pluginEnforceRank<TBundlerCfg>(plugin: Plugin<TBundlerCfg>): number {
  if (plugin.enforce === "pre") return 0;
  if (plugin.enforce === "post") return 2;
  return 1;
}

async function collectPluginHooks<TBundlerCfg>(
  plugins: Plugin<TBundlerCfg>[],
  ctx: PluginContext<TBundlerCfg>,
): Promise<PluginHooks<TBundlerCfg>[]> {
  const allHooks: PluginHooks<TBundlerCfg>[] = [];
  for (const plugin of plugins) {
    if (plugin.setup) {
      const hooks = resolvePluginSetupHooks<TBundlerCfg>(
        plugin.name,
        await plugin.setup(ctx),
      );
      if (hooks) {
        allHooks.push(hooks);
      }
    }
  }
  return allHooks;
}

function resolvePluginSetupHooks<TBundlerCfg>(
  pluginName: string,
  hooks: unknown,
): PluginHooks<TBundlerCfg> | undefined {
  if (hooks === undefined) return undefined;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" setup hook must return a plugin hooks object or undefined.`,
    );
  }

  const hookConfig = hooks as Record<string, unknown>;
  for (const hookName of PLUGIN_HOOK_NAMES) {
    if (
      hookConfig[hookName] !== undefined &&
      typeof hookConfig[hookName] !== "function"
    ) {
      throw new Error(
        `[evjs] Plugin "${pluginName}" setup hook returned ${hookName} must be a function.`,
      );
    }
  }
  return hookConfig as PluginHooks<TBundlerCfg>;
}

async function runConfigHooks<TBundlerCfg>(
  userConfig: Config<TBundlerCfg> | undefined,
  ctx: PluginConfigContext,
): Promise<Config<TBundlerCfg> | undefined> {
  let config = userConfig;
  const plugins = orderPluginsByDependencies(
    resolvePluginsConfig<TBundlerCfg>(userConfig?.plugins),
  );

  for (const plugin of plugins) {
    if (!plugin.config) continue;

    const nextConfig = await plugin.config(config ?? {}, ctx);
    if (nextConfig !== undefined) {
      config = resolvePluginConfigHookResult<TBundlerCfg>(
        plugin.name,
        nextConfig,
      );
    }
  }

  return config;
}

function resolvePluginConfigHookResult<TBundlerCfg>(
  pluginName: string,
  config: unknown,
): Config<TBundlerCfg> {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return config as Config<TBundlerCfg>;
  }
  throw new Error(
    `[evjs] Plugin "${pluginName}" config hook must return a config object or undefined.`,
  );
}

async function runBuildStartHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  ctx: PluginContext<TBundlerCfg>,
): Promise<void> {
  for (const h of hooks) {
    if (h.buildStart) {
      await h.buildStart(ctx);
    }
  }
}

async function runBuildOutputHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  output: BuildOutput,
  ctx: PluginContext<TBundlerCfg>,
): Promise<void> {
  for (const h of hooks) {
    if (h.buildOutput) {
      await h.buildOutput(output, ctx);
    }
  }
}

function isEmptyPlanUpdate(update: BuildPlanUpdate): boolean {
  return (
    update.entries.added.length === 0 &&
    update.entries.removed.length === 0 &&
    update.entries.changed.length === 0 &&
    update.html.added.length === 0 &&
    update.html.removed.length === 0 &&
    update.html.changed.length === 0 &&
    !update.serverChanged
  );
}

function reportGraphDiagnostics(analysis: {
  diagnostics: Array<{
    level: "warning" | "error";
    message: string;
    file?: string;
    line?: number;
    column?: number;
  }>;
}): void {
  const errors: string[] = [];

  for (const diagnostic of analysis.diagnostics) {
    const message = formatGraphDiagnostic(diagnostic);
    if (diagnostic.level === "error") {
      errors.push(message);
    } else {
      logger.warn`${message}`;
    }
  }

  if (errors.length > 0) {
    throw new Error(
      ["[evjs] App graph analysis failed.", ...errors].join("\n"),
    );
  }
}

function formatGraphDiagnostic(diagnostic: {
  message: string;
  file?: string;
  line?: number;
  column?: number;
}): string {
  const location = [
    diagnostic.file,
    diagnostic.line === undefined
      ? undefined
      : diagnostic.column === undefined
        ? String(diagnostic.line)
        : `${diagnostic.line}:${diagnostic.column}`,
  ]
    .filter(Boolean)
    .join(":");

  return location ? `${location} - ${diagnostic.message}` : diagnostic.message;
}

function hasSamePluginIdentity<TBundlerCfg>(
  previous: Plugin<TBundlerCfg>[],
  next: Plugin<TBundlerCfg>[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((plugin, index) => plugin.name === next[index]?.name)
  );
}

function listConfigDependencyFiles(cwd: string): string[] {
  return ["ev.config.ts", "ev.config.js", "ev.config.mjs"]
    .map((file) => path.resolve(cwd, file))
    .filter((file) => fs.existsSync(file));
}

function watchFiles(
  files: string[],
  onChange: (file: string) => void,
): () => void {
  const watchers: fs.FSWatcher[] = [];

  for (const file of [...new Set(files)]) {
    try {
      watchers.push(
        fs.watch(file, () => {
          onChange(file);
        }),
      );
    } catch {
      // The file may have been removed between graph analysis and watcher
      // setup. The next config or graph change will rebuild the watch list.
    }
  }

  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
  };
}

async function runBuildEndHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  result: BuildResult,
): Promise<void> {
  for (const h of hooks) {
    if (h.buildEnd) {
      await h.buildEnd(result);
    }
  }
}

async function runDisposeHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  ctx: PluginContext<TBundlerCfg>,
): Promise<void> {
  for (const h of hooks) {
    if (h.dispose) {
      await h.dispose(ctx);
    }
  }
}

function validateHtmlTemplates<TBundlerCfg>(
  cwd: string,
  config: ResolvedConfig<TBundlerCfg>,
): void {
  const templates = collectHtmlTemplates(config);
  const documents = new Map<string, HtmlTemplateDocument>();

  for (const template of templates) {
    const templatePath = path.resolve(cwd, template.path);
    let doc = documents.get(templatePath);
    if (!doc) {
      doc = readHtmlTemplateDocument(templatePath, template);
      documents.set(templatePath, doc);
    }
    validateHtmlMountTarget(template, doc);
  }
}

type HtmlTemplateDocument = ReturnType<typeof validateHtmlTemplate>;

interface HtmlTemplateValidation {
  path: string;
  notFoundMessage: string;
  notFileMessage: string;
  mount?: string;
  mountNotFoundMessage?: string;
  mountInvalidMessage?: string;
}

function readHtmlTemplateDocument(
  templatePath: string,
  template: HtmlTemplateValidation,
): HtmlTemplateDocument {
  let stat: ReturnType<typeof fs.statSync>;
  try {
    stat = fs.statSync(templatePath);
  } catch {
    throw new Error(`${template.notFoundMessage}: ${template.path}`);
  }

  if (!stat.isFile()) {
    throw new Error(`${template.notFileMessage}: ${template.path}`);
  }
  return validateHtmlTemplate({
    template: templatePath,
    displayName: template.path,
  });
}

function validateHtmlMountTarget(
  template: HtmlTemplateValidation,
  doc: HtmlTemplateDocument,
): void {
  if (!template.mount) return;
  const mountInvalidMessage =
    template.mountInvalidMessage ?? "[evjs] HTML mount selector is invalid";
  const mountNotFoundMessage =
    template.mountNotFoundMessage ?? "[evjs] HTML mount target was not found";

  let target: unknown;
  try {
    target = doc.querySelector(template.mount);
  } catch {
    throw new Error(`${mountInvalidMessage}: ${template.mount}`);
  }

  if (!target) {
    throw new Error(
      `${mountNotFoundMessage} "${template.mount}" in html template: ${template.path}`,
    );
  }
}

function collectHtmlTemplates<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
): HtmlTemplateValidation[] {
  const templates: HtmlTemplateValidation[] = [];

  for (const [appId, app] of Object.entries(config.apps ?? {})) {
    templates.push({
      path: app.html ?? config.html,
      notFoundMessage: `[evjs] App "${appId}" html template not found`,
      notFileMessage: `[evjs] App "${appId}" html template must be a file`,
      mount: app.mount,
      mountNotFoundMessage: `[evjs] App "${appId}" mount target was not found`,
      mountInvalidMessage: `[evjs] App "${appId}" mount selector is invalid`,
    });
  }

  for (const [pageId, page] of Object.entries(config.pages ?? {})) {
    templates.push({
      path: page.html,
      notFoundMessage: `[evjs] MPA page "${pageId}" html template not found`,
      notFileMessage: `[evjs] MPA page "${pageId}" html template must be a file`,
      mount: page.mount,
      mountNotFoundMessage: `[evjs] MPA page "${pageId}" mount target was not found`,
      mountInvalidMessage: `[evjs] MPA page "${pageId}" mount selector is invalid`,
    });
  }

  if (config.routing?.mode === "mpa") {
    let usesRoutingHtml = false;
    for (const route of config.routing.routes) {
      if (route.kind === "layout") continue;
      if (route.html) {
        templates.push({
          path: route.html,
          notFoundMessage: `[evjs] MPA page route "${route.id}" html template not found`,
          notFileMessage: `[evjs] MPA page route "${route.id}" html template must be a file`,
          mount: config.routing.mount,
          mountNotFoundMessage: `[evjs] MPA page route "${route.id}" mount target was not found`,
          mountInvalidMessage: `[evjs] MPA page route "${route.id}" mount selector is invalid`,
        });
      } else {
        usesRoutingHtml = true;
      }
    }
    if (usesRoutingHtml) {
      templates.push({
        path: config.routing.html,
        notFoundMessage: "[evjs] Page routing html template not found",
        notFileMessage: "[evjs] Page routing html template must be a file",
        mount: config.routing.mount,
        mountNotFoundMessage: "[evjs] Page routing mount target was not found",
        mountInvalidMessage: "[evjs] Page routing mount selector is invalid",
      });
    }
  } else if (config.routing) {
    templates.push({
      path: config.routing.html,
      notFoundMessage: "[evjs] Page routing html template not found",
      notFileMessage: "[evjs] Page routing html template must be a file",
      mount: config.routing.mount,
      mountNotFoundMessage: "[evjs] Page routing mount target was not found",
      mountInvalidMessage: "[evjs] Page routing mount selector is invalid",
    });
  }

  if (templates.length === 0) {
    templates.push({
      path: config.html,
      notFoundMessage: "[evjs] HTML template not found",
      notFileMessage: "[evjs] HTML template must be a file",
    });
  }

  return templates;
}

function getFrameworkOutputPaths(
  cwd: string,
  output: BuildOutput,
): { rootDir: string; clientDir: string; serverDir: string } {
  const rootDir = path.resolve(cwd, output.distDir);
  const publicDir = output.paths?.publicDir ?? output.distDir;
  const serverDir =
    output.paths?.serverDir ?? path.join(output.distDir, "server");
  return {
    rootDir,
    clientDir: path.resolve(cwd, publicDir),
    serverDir: path.resolve(cwd, serverDir),
  };
}

async function emitFrameworkManifest(
  cwd: string,
  output: BuildOutput,
): Promise<void> {
  const { rootDir, clientDir, serverDir } = getFrameworkOutputPaths(
    cwd,
    output,
  );
  await fs.promises.mkdir(rootDir, { recursive: true });
  await fs.promises.mkdir(serverDir, { recursive: true });
  const serverManifest = createServerManifest(output);
  await fs.promises.writeFile(
    path.join(serverDir, MANIFEST_FILE),
    JSON.stringify(serverManifest, null, 2),
    "utf-8",
  );
  await fs.promises.writeFile(
    path.join(rootDir, BUILD_OUTPUT_FILE),
    JSON.stringify(output, null, 2),
    "utf-8",
  );
  await fs.promises.rm(path.join(serverDir, BUILD_OUTPUT_FILE), {
    force: true,
  });
  await removeManifestIfInactive(rootDir, [clientDir, serverDir]);
  await removeManifestIfInactive(path.join(rootDir, "client"), [
    clientDir,
    serverDir,
  ]);
  await removeManifestIfInactive(path.join(rootDir, "server"), [
    clientDir,
    serverDir,
  ]);

  const publicManifest = createPublicManifest(output);
  await fs.promises.mkdir(clientDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(clientDir, MANIFEST_FILE),
    JSON.stringify(publicManifest, null, 2),
    "utf-8",
  );
}

async function removeManifestIfInactive(
  dir: string,
  activeDirs: string[],
): Promise<void> {
  const normalizedDir = path.resolve(dir);
  if (
    activeDirs.some((activeDir) => path.resolve(activeDir) === normalizedDir)
  ) {
    return;
  }
  await fs.promises.rm(path.join(normalizedDir, MANIFEST_FILE), {
    force: true,
  });
}

function getHtmlAssets(html: BuildPlan["html"][number], output: BuildOutput) {
  const pageId = html.owner.pageId;
  const appId = html.owner.appId;
  return pageId
    ? output.pages[pageId]?.assets
    : appId
      ? output.apps[appId]?.assets
      : undefined;
}

function createHtmlDocumentInfo(
  html: BuildPlan["html"][number],
  output: BuildOutput,
): HtmlDocumentInfo | undefined {
  const assets = getHtmlAssets(html, output);
  if (!assets) return undefined;

  if (html.owner.pageId) {
    return {
      kind: "page",
      htmlId: html.id,
      pageId: html.owner.pageId,
      template: html.template,
      fileName: html.fileName,
      assets,
    };
  }

  return {
    kind: "app",
    htmlId: html.id,
    appId: html.owner.appId ?? "default",
    template: html.template,
    fileName: html.fileName,
    assets,
  };
}

function withHtmlAssetCrossOrigin(
  assets: string[],
  crossOriginLoading: ResolvedConfig["output"]["crossOriginLoading"],
): HtmlAsset[] {
  if (!crossOriginLoading) return assets;
  return assets.map((url) => ({
    url,
    attrs: { crossorigin: crossOriginLoading },
  }));
}

async function emitFrameworkHtml<TBundlerCfg>(
  cwd: string,
  config: ResolvedConfig<TBundlerCfg>,
  hooks: PluginHooks<TBundlerCfg>[],
  pluginCtx: PluginContext<TBundlerCfg>,
  output: BuildOutput,
  plan: BuildPlan,
  isRebuild: boolean,
): Promise<void> {
  const { clientDir } = getFrameworkOutputPaths(cwd, output);

  for (const html of plan.html) {
    const htmlInfo = createHtmlDocumentInfo(html, output);
    if (!htmlInfo) continue;

    const doc = generateHtml({
      template: path.resolve(cwd, html.template),
      js: withHtmlAssetCrossOrigin(
        htmlInfo.assets.js,
        config.output.crossOriginLoading,
      ),
      css: withHtmlAssetCrossOrigin(
        htmlInfo.assets.css,
        config.output.crossOriginLoading,
      ),
    });
    doc.documentElement?.setAttribute("data-evjs-build", output.buildId);
    if (htmlInfo.kind === "page") {
      doc.documentElement?.setAttribute("data-evjs-kind", "page");
      doc.documentElement?.setAttribute("data-evjs-id", htmlInfo.pageId);
    } else {
      doc.documentElement?.setAttribute("data-evjs-kind", "app");
      doc.documentElement?.setAttribute("data-evjs-id", htmlInfo.appId);
    }

    const finalHtml = await buildHtml({
      doc,
      hooks,
      pluginContext: pluginCtx,
      html: htmlInfo,
      output,
      isRebuild,
    });

    const outPath = path.join(clientDir, html.fileName);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, finalHtml, "utf-8");
  }
}

async function linkAndEmitBuildOutput<TBundlerCfg>(options: {
  bundlerFacts: BundlerBuildFacts;
  graph: AppGraph;
  plan: BuildPlan;
  config: ResolvedConfig<TBundlerCfg>;
  cwd: string;
  hooks: PluginHooks<TBundlerCfg>[];
  pluginCtx: PluginContext<TBundlerCfg>;
  isRebuild: boolean;
}): Promise<BuildOutput> {
  const output = linkBuildOutput({
    graph: options.graph,
    plan: options.plan,
    clientEntryAssets: options.bundlerFacts.clientEntryAssets,
    firstClientEntryAssets: options.bundlerFacts.firstClientEntryAssets,
    serverEntryAssets: options.bundlerFacts.serverEntryAssets,
    serverEntry: options.bundlerFacts.serverEntry,
    serverAssets: options.bundlerFacts.serverAssets,
    serverModules: options.bundlerFacts.serverModules,
    rscManifests: options.bundlerFacts.rscManifests,
  });

  await runBuildOutputHooks(options.hooks, output, options.pluginCtx);
  assertFrameworkManifestShape(output, "BuildOutput after buildOutput hooks");
  await emitFrameworkManifest(options.cwd, output);
  await emitFrameworkHtml(
    options.cwd,
    options.config,
    options.hooks,
    options.pluginCtx,
    output,
    options.plan,
    options.isRebuild,
  );

  return output;
}

function normalizeAssetName(name: string | undefined): string | undefined {
  return name?.replace(/^\.\//, "");
}

function getDevDistLockPath(cwd: string, distDir: string): string {
  return path.resolve(cwd, distDir, DEV_DIST_LOCK_FILE);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readDevDistLock(
  cwd: string,
  distDir: string,
): Promise<DevDistLock | undefined> {
  const lockPath = getDevDistLockPath(cwd, distDir);
  try {
    return JSON.parse(
      await fs.promises.readFile(lockPath, "utf-8"),
    ) as DevDistLock;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    logger.warn`Failed to read dev dist lock: ${err}`;
    return undefined;
  }
}

async function assertNoActiveDevDistLock(
  cwd: string,
  distDir: string,
): Promise<void> {
  const lock = await readDevDistLock(cwd, distDir);
  if (!lock) return;

  if (isProcessAlive(lock.pid)) {
    throw new Error(
      `[evjs] Cannot write to "${distDir}" because ev dev is using it in process ${lock.pid}. Stop ev dev first or run build in a separate workspace.`,
    );
  }

  await fs.promises.rm(getDevDistLockPath(cwd, distDir), { force: true });
}

async function writeDevDistLock(
  cwd: string,
  distDir: string,
): Promise<() => Promise<void>> {
  const lockPath = getDevDistLockPath(cwd, distDir);
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.promises.writeFile(
    lockPath,
    JSON.stringify(
      {
        command: "dev",
        distDir,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      } satisfies DevDistLock,
      null,
      2,
    ),
  );

  return async () => {
    const lock = await readDevDistLock(cwd, distDir);
    if (lock?.pid === process.pid) {
      await fs.promises.rm(lockPath, { force: true });
    }
  };
}

function readServerEntryFromManifest(
  cwd: string,
  distDir: string,
): string | undefined {
  const manifestPath = path.resolve(cwd, distDir, "server", MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return undefined;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
      entry?: unknown;
    };
    return normalizeAssetName(
      typeof manifest.entry === "string" ? manifest.entry : undefined,
    );
  } catch (err) {
    logger.warn`Failed to parse build manifest for server entry: ${err}`;
    return undefined;
  }
}

function readServerEntryFromStats(
  cwd: string,
  distDir: string,
): string | undefined {
  const statsPath = path.resolve(cwd, distDir, "server/stats.json");
  if (!fs.existsSync(statsPath)) return undefined;

  try {
    const stats = JSON.parse(fs.readFileSync(statsPath, "utf-8")) as {
      entrypoints?: Record<
        string,
        { assets?: Array<string | { name?: string }> }
      >;
    };
    const entrypoints = stats.entrypoints ?? {};
    const entrypointValues = Object.values(entrypoints);
    const firstEntry =
      entrypoints.server ??
      (entrypointValues.length === 1 ? entrypointValues[0] : undefined);
    const jsAsset = firstEntry?.assets?.find((asset) => {
      const assetName = readStatsAssetName(asset);
      return assetName ? isJavaScriptAsset(assetName) : false;
    });
    return normalizeAssetName(readStatsAssetName(jsAsset));
  } catch (err) {
    logger.warn`Failed to parse server stats.json: ${err}`;
    return undefined;
  }
}

function readStatsAssetName(
  asset: string | { name?: string } | undefined,
): string | undefined {
  return typeof asset === "string" ? asset : asset?.name;
}

function isJavaScriptAsset(name: string): boolean {
  return /\.(?:cjs|mjs|js)$/.test(name);
}

function isExistingDevServerEntry(
  cwd: string,
  distDir: string,
  entry: string,
): boolean {
  return fs.existsSync(path.resolve(cwd, distDir, "server", entry));
}

async function findDevServerEntry(
  cwd: string,
  distDir: string,
): Promise<string | undefined> {
  const entryFromManifest = readServerEntryFromManifest(cwd, distDir);
  if (entryFromManifest) {
    return isExistingDevServerEntry(cwd, distDir, entryFromManifest)
      ? entryFromManifest
      : undefined;
  }

  const entryFromStats = readServerEntryFromStats(cwd, distDir);
  if (
    entryFromStats &&
    isExistingDevServerEntry(cwd, distDir, entryFromStats)
  ) {
    return entryFromStats;
  }

  const serverDir = path.resolve(cwd, distDir, "server");
  const files: string[] = await fs.promises.readdir(serverDir).catch(() => []);
  if (files.includes("server.cjs")) return "server.cjs";
  if (files.includes("server.js")) return "server.js";

  const jsFiles = files.filter(isJavaScriptAsset);
  return jsFiles.length === 1 ? jsFiles[0] : undefined;
}

async function stopApiProcess(
  processToStop: ApiProcess,
  timeoutMs = 3000,
): Promise<void> {
  processToStop.kill();
  const exited = await Promise.race([
    processToStop.then(() => true).catch(() => true),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), timeoutMs),
    ),
  ]);

  if (!exited) {
    processToStop.kill("SIGKILL");
    await processToStop.catch(() => {});
  }
}

function forwardApiOutput(child: ApiProcess): void {
  child.stdout?.on("data", (data) => {
    const text = data.toString().replaceAll(API_READY_MARKER, "");
    if (text.length > 0) {
      process.stdout.write(text);
    }
  });
  child.stderr?.on("data", (data) => {
    process.stderr.write(data);
  });
}

function waitForApiReady(child: ApiProcess, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
      fn();
    };

    const onStdout = (data: Buffer) => {
      if (data.toString().includes(API_READY_MARKER)) {
        settle(resolve);
      }
    };
    const onStderr = (data: Buffer) => {
      if (data.toString().includes("EADDRINUSE")) {
        settle(() =>
          reject(new Error("API server port is already in use (EADDRINUSE)")),
        );
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      settle(() =>
        reject(
          new Error(
            `API server exited before it was ready (code ${code ?? "null"}, signal ${signal ?? "null"})`,
          ),
        ),
      );
    };
    const timeout = setTimeout(() => {
      settle(() =>
        reject(
          new Error(`API server did not report ready within ${timeoutMs}ms`),
        ),
      );
    }, timeoutMs);

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
  });
}

async function prepareInternalFrameworkBuild<
  TBundlerCfg = DefaultBundlerConfig,
>(
  userConfig?: Config<TBundlerCfg>,
  options: InternalPrepareFrameworkBuildOptions<TBundlerCfg> = {},
): Promise<InternalPreparedFrameworkBuild<TBundlerCfg>> {
  const cwd = options.cwd ?? process.cwd();
  const command =
    options.command ??
    (options.mode === "development" ? "dev" : ("build" as const));
  const expectedMode = command === "dev" ? "development" : "production";
  if (options.mode && options.mode !== expectedMode) {
    throw new Error(
      `[evjs] prepareFrameworkBuild command "${command}" must use mode "${expectedMode}".`,
    );
  }
  const mode = options.mode ?? expectedMode;
  const configuredConfig = await runConfigHooks(userConfig, {
    mode,
    command,
    cwd,
  });
  const pageResolvedConfig = await withPageRoutingDefaults(
    resolveConfig(configuredConfig),
    configuredConfig,
    cwd,
  );
  const rawResolvedConfig = await withServerRoutingDefaults(
    pageResolvedConfig,
    configuredConfig,
    cwd,
  );
  const conventionResolvedConfig = await withServerConventionDefaults(
    rawResolvedConfig,
    cwd,
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
  if (options.requireBundler && !bundler) {
    throw new Error(
      "[evjs] No bundler configured. Pass a bundler adapter in ev.config.ts or through dev/build options.",
    );
  }
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
    if (options.runLifecycleHooks ?? true) {
      await runBuildStartHooks(hooks, pluginContext);
    }
    validateHtmlTemplates(cwd, config);
    const analysis = await createAppGraph(config, cwd);
    reportGraphDiagnostics(analysis);
    const plan = createBuildPlan(config, analysis.graph, {
      mode,
      ...options.plan,
    });

    return {
      cwd,
      mode,
      command,
      config,
      graph: analysis.graph,
      plan,
      hooks,
      pluginContext,
      fileDependencies: analysis.fileDependencies,
      pluginWatchFiles: [...pluginWatchFiles].sort(),
      dispose,
    };
  } catch (err) {
    await dispose();
    throw err;
  }
}

export async function prepareFrameworkBuild<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options: PrepareFrameworkBuildOptions<TBundlerCfg> = {},
): Promise<PreparedFrameworkBuild<TBundlerCfg>> {
  const prepared = await prepareInternalFrameworkBuild(userConfig, options);
  return {
    cwd: prepared.cwd,
    mode: prepared.mode,
    command: prepared.command,
    config: prepared.config,
    fileDependencies: prepared.fileDependencies,
    pluginWatchFiles: prepared.pluginWatchFiles,
    dispose: prepared.dispose,
  };
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
  let pageRouteDiscovery:
    | {
        base: NonNullable<ResolvedConfig["routing"]>;
        discovery: Awaited<ReturnType<typeof discoverPageRoutes>>;
      }
    | undefined;

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
        pageRouteDiscovery = { base, discovery };
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

    const analysis = await createAppGraph(config, cwd);
    diagnostics.push(
      ...analysis.diagnostics.map((diagnostic) =>
        toInspectDiagnostic("graph", diagnostic),
      ),
    );

    let plan: BuildPlan | undefined;
    try {
      plan = createBuildPlan(config, analysis.graph, { mode });
    } catch (err) {
      diagnostics.push({
        level: "error",
        source: "plan",
        message: formatInspectError(err),
      });
    }

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
  pageRouteDiscovery:
    | {
        discovery: Awaited<ReturnType<typeof discoverPageRoutes>>;
      }
    | undefined,
  diagnostics: InspectDiagnostic[],
): InspectRouteFile[] {
  if (!pageRouteDiscovery) return [];

  const routeByModule = new Map(
    pageRouteDiscovery.discovery.routes.map((route) => [route.module, route]),
  );
  const diagnosticsByFile = new Map<string, InspectDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.source !== "page-routes" || !diagnostic.file) continue;
    const file = normalizeDiagnosticFile(diagnostic.file);
    const entries = diagnosticsByFile.get(file) ?? [];
    entries.push(diagnostic);
    diagnosticsByFile.set(file, entries);
  }

  return pageRouteDiscovery.discovery.files
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

export async function dev<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options?: DevOptions<TBundlerCfg>,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "development";
  const configuredConfig = await runConfigHooks(userConfig, {
    mode: "development",
    command: "dev",
    cwd,
  });
  const pageResolvedConfig = await withPageRoutingDefaults(
    resolveConfig(configuredConfig),
    configuredConfig,
    cwd,
  );
  const rawResolvedConfig = await withServerRoutingDefaults(
    pageResolvedConfig,
    configuredConfig,
    cwd,
  );
  const conventionResolvedConfig = await withServerConventionDefaults(
    rawResolvedConfig,
    cwd,
  );
  const resolvedConfig = {
    ...conventionResolvedConfig,
    plugins: orderPluginsByDependencies(conventionResolvedConfig.plugins),
  };

  const bundler = resolveBundler(resolvedConfig.bundler, options?.bundler);
  let activeConfig = withActiveBundler(resolvedConfig, bundler);

  const pluginWatchFiles = new Set<string>();
  const addWatchFile = (file: string) => {
    pluginWatchFiles.add(path.resolve(cwd, file));
  };
  const pluginCtx: PluginContext<TBundlerCfg> = {
    mode: "development",
    command: "dev",
    cwd,
    config: activeConfig,
    logger,
    addWatchFile,
  };
  const hooks = await collectPluginHooks(activeConfig.plugins, pluginCtx);

  await runBuildStartHooks(hooks, pluginCtx);
  validateHtmlTemplates(cwd, activeConfig);
  let activeAnalysis = await createAppGraph(activeConfig, cwd);
  reportGraphDiagnostics(activeAnalysis);
  let activePlan = createBuildPlan(activeConfig, activeAnalysis.graph, {
    mode: "development",
    distDir: DEV_DIST_DIR,
  });
  let apiProcess: ApiProcess | null = null;
  let restartQueue: Promise<void> = Promise.resolve();
  let devUpdateQueue: Promise<void> = Promise.resolve();
  let devController: BundlerDevController | undefined;
  let releaseDevDistLock: (() => Promise<void>) | undefined;
  let stopWatchingDevDependencies = () => {};
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const expectedApiExits = new WeakSet<ApiProcess>();
  let resolveShutdown: (() => void) | undefined;
  const waitForShutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });

  const stopApiOnParentShutdown = () => {
    if (apiProcess) {
      expectedApiExits.add(apiProcess);
      apiProcess.kill();
      apiProcess = null;
    }
    resolveShutdown?.();
  };

  await assertNoActiveDevDistLock(cwd, activePlan.distDir);

  process.once("SIGINT", stopApiOnParentShutdown);
  process.once("SIGTERM", stopApiOnParentShutdown);

  const restartApiServer = async () => {
    const serverEntry = await findDevServerEntry(cwd, activePlan.distDir);
    if (!serverEntry) return;

    if (apiProcess) {
      logger.info`Restarting API server...`;
      const oldProcess = apiProcess;
      expectedApiExits.add(oldProcess);
      try {
        await stopApiProcess(oldProcess);
      } catch {}
      if (apiProcess === oldProcess) {
        apiProcess = null;
      }
    }

    const serverPort =
      activeConfig.server?.dev?.port ?? CONFIG_DEFAULTS.serverPort;
    logger.info`Server bundle detected, starting API...`;

    const devRootDir = path.resolve(cwd, activePlan.distDir);
    const bootstrapPath = path.join(devRootDir, "_dev_start.cjs");
    try {
      const serverBundlePath = path.join(devRootDir, "server", serverEntry);

      if (!fs.existsSync(path.dirname(bootstrapPath))) {
        fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
      }
      fs.writeFileSync(
        bootstrapPath,
        [
          `(async () => {`,
          `const fs = require("node:fs");`,
          `const path = require("node:path");`,
          `const { pathToFileURL } = require("node:url");`,
          `const manifestPath = ${JSON.stringify(path.join(devRootDir, BUILD_OUTPUT_FILE))};`,
          `const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf-8")) : undefined;`,
          `if (manifest) globalThis.__EVJS_MANIFEST__ = manifest;`,
          `globalThis.__EVJS_DEV_PAGE_RENDER_PROXY_HEADER__ = ${JSON.stringify(DEV_PAGE_RENDER_PROXY_HEADER)};`,
          `const serverDir = path.dirname(${JSON.stringify(serverBundlePath)});`,
          `globalThis.__EVJS_SERVER_MODULE_LOADER__ = async (asset) => { const mod = await import(pathToFileURL(path.resolve(serverDir, asset)).href); const nested = mod && typeof mod.default === "object" ? mod.default : undefined; return nested && ("default" in nested || "render" in nested) ? nested : mod; };`,
          `const serverModule = await import(${JSON.stringify(pathToFileURL(serverBundlePath).href)});`,
          `const handler = serverModule.default?.default ?? serverModule.default ?? serverModule;`,
          `const { serve } = require("@evjs/ev/internal/server/node");`,
          `const server = serve({ fetch: handler.fetch }, { port: ${serverPort}, https: ${JSON.stringify(activeConfig.server?.dev?.https ?? false)} });`,
          `const ready = () => console.log(${JSON.stringify(API_READY_MARKER)});`,
          `if (server.listening) ready(); else server.once("listening", ready);`,
          `server.once("error", (err) => { console.error(err); process.exit(1); });`,
          `})().catch((err) => { console.error(err); process.exit(1); });`,
        ].join("\n"),
      );

      const child = execa("node", [bootstrapPath], {
        stdio: ["inherit", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "development" },
      });
      apiProcess = child;
      forwardApiOutput(child);

      child.catch((err) => {
        if (expectedApiExits.has(child)) return;
        if (apiProcess === child) {
          apiProcess = null;
          logger.error`API server process exited unexpectedly: ${err}`;
        }
      });
      await waitForApiReady(child);
      logger.info`API server ready`;
    } catch (err) {
      logger.error`Server runtime failed: ${err}`;
      apiProcess = null;
      throw err;
    }
  };

  const handleServerBundleReady = async () => {
    restartQueue = restartQueue.catch(() => {}).then(restartApiServer);
    await restartQueue;
  };

  const loadCurrentConfig = async () => {
    const nextUserConfig = options?.loadConfig
      ? await options.loadConfig(cwd)
      : userConfig;
    const nextConfiguredConfig = await runConfigHooks(nextUserConfig, {
      mode: "development",
      command: "dev",
      cwd,
    });
    const nextPageResolvedConfig = await withPageRoutingDefaults(
      resolveConfig(nextConfiguredConfig),
      nextConfiguredConfig,
      cwd,
    );
    const nextRawResolvedConfig = await withServerRoutingDefaults(
      nextPageResolvedConfig,
      nextConfiguredConfig,
      cwd,
    );
    const nextConventionResolvedConfig = await withServerConventionDefaults(
      nextRawResolvedConfig,
      cwd,
    );
    const nextResolvedConfig = {
      ...nextConventionResolvedConfig,
      plugins: orderPluginsByDependencies(nextConventionResolvedConfig.plugins),
    };

    return withActiveBundler(nextResolvedConfig, bundler);
  };

  const stagePluginHooks = async (nextConfig: typeof activeConfig) => {
    const previousConfig = activeConfig;
    const previousHooks = [...hooks];
    const previousPluginWatchFiles = [...pluginWatchFiles];
    const nextPluginWatchFiles = new Set<string>();
    const nextPluginCtx: PluginContext<TBundlerCfg> = {
      ...pluginCtx,
      config: nextConfig,
      addWatchFile(file) {
        nextPluginWatchFiles.add(path.resolve(cwd, file));
      },
    };
    const nextHooks = await collectPluginHooks(
      nextConfig.plugins,
      nextPluginCtx,
    );

    hooks.splice(0, hooks.length, ...nextHooks);
    pluginWatchFiles.clear();
    for (const file of nextPluginWatchFiles) {
      pluginWatchFiles.add(file);
    }
    pluginCtx.config = nextConfig;

    return {
      async commit() {
        await runDisposeHooks(previousHooks, {
          ...pluginCtx,
          config: previousConfig,
        });
      },
      async rollback() {
        await runDisposeHooks(nextHooks, {
          ...pluginCtx,
          config: nextConfig,
        });
        hooks.splice(0, hooks.length, ...previousHooks);
        pluginWatchFiles.clear();
        for (const file of previousPluginWatchFiles) {
          pluginWatchFiles.add(file);
        }
        pluginCtx.config = previousConfig;
      },
    };
  };

  const refreshDevDependencyWatchers = () => {
    stopWatchingDevDependencies();
    stopWatchingDevDependencies = watchFiles(
      [
        ...listConfigDependencyFiles(cwd),
        ...activeAnalysis.fileDependencies,
        ...pluginWatchFiles,
      ],
      scheduleDevUpdate,
    );
  };

  const handleDevDependencyChange = async (changedFile: string) => {
    const isConfigChange = listConfigDependencyFiles(cwd).includes(changedFile);
    const reason: BuildPlanUpdate["reason"] = isConfigChange
      ? "config"
      : "route-declaration";

    const nextConfig = await loadCurrentConfig();
    if (!hasSamePluginIdentity(activeConfig.plugins, nextConfig.plugins)) {
      logger.warn`Plugin configuration changed. Please restart ev dev to apply plugin additions, removals, or reordering.`;
      return;
    }

    validateHtmlTemplates(cwd, nextConfig);
    let stagedPluginHooks:
      | Awaited<ReturnType<typeof stagePluginHooks>>
      | undefined;
    if (isConfigChange) {
      stagedPluginHooks = await stagePluginHooks(nextConfig);
    }

    try {
      const nextAnalysis = await createAppGraph(nextConfig, cwd);
      reportGraphDiagnostics(nextAnalysis);
      const nextPlan = createBuildPlan(nextConfig, nextAnalysis.graph, {
        mode: "development",
        distDir: DEV_DIST_DIR,
      });
      const update = diffBuildPlan(activePlan, nextPlan, reason);
      if (isEmptyPlanUpdate(update)) {
        activeConfig = nextConfig;
        activeAnalysis = nextAnalysis;
        activePlan = nextPlan;
        pluginCtx.config = nextConfig;
        await stagedPluginHooks?.commit();
        refreshDevDependencyWatchers();
        return;
      }

      if (!devController) {
        await stagedPluginHooks?.rollback();
        logger.warn`The selected bundler does not expose a dev controller. Please restart ev dev to apply framework plan changes.`;
        return;
      }

      const previousConfig = activeConfig;
      const previousAnalysis = activeAnalysis;
      const previousPlan = activePlan;

      activeConfig = nextConfig;
      activeAnalysis = nextAnalysis;
      activePlan = nextPlan;

      try {
        await devController.updatePlan(update, nextAnalysis.graph);
      } catch (err) {
        activeConfig = previousConfig;
        activeAnalysis = previousAnalysis;
        activePlan = previousPlan;
        pluginCtx.config = previousConfig;
        await stagedPluginHooks?.rollback();
        logger.warn`Unable to apply framework plan update without restart: ${err}`;
        return;
      }
      pluginCtx.config = nextConfig;
      await stagedPluginHooks?.commit();
      refreshDevDependencyWatchers();
    } catch (err) {
      await stagedPluginHooks?.rollback();
      throw err;
    }
  };

  function scheduleDevUpdate(changedFile: string) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      devUpdateQueue = devUpdateQueue
        .catch(() => {})
        .then(() => handleDevDependencyChange(changedFile))
        .catch((err) => {
          logger.warn`Failed to update framework dev state: ${err}`;
        });
    }, 50);
  }

  try {
    devController =
      (await bundler.dev({
        config: activeConfig,
        cwd,
        hooks,
        graph: activeAnalysis.graph,
        plan: activePlan,
        callbacks: {
          async onBuildFacts(bundlerFacts, options) {
            await linkAndEmitBuildOutput({
              bundlerFacts,
              graph: activeAnalysis.graph,
              plan: activePlan,
              config: activeConfig,
              cwd,
              hooks,
              pluginCtx,
              isRebuild: options?.isRebuild ?? false,
            });
          },
          onServerBundleReady: handleServerBundleReady,
        },
      })) ?? undefined;
    releaseDevDistLock = await writeDevDistLock(cwd, activePlan.distDir);
    refreshDevDependencyWatchers();
    await waitForShutdown;
  } finally {
    if (debounceTimer) clearTimeout(debounceTimer);
    stopWatchingDevDependencies();
    await devController?.close?.();
    await releaseDevDistLock?.();
    process.off("SIGINT", stopApiOnParentShutdown);
    process.off("SIGTERM", stopApiOnParentShutdown);
    await runDisposeHooks(hooks, pluginCtx);
  }
}

export async function build<TBundlerCfg = DefaultBundlerConfig>(
  userConfig?: Config<TBundlerCfg>,
  options?: BuildOptions<TBundlerCfg>,
): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  process.env.NODE_ENV ??= "production";
  const prepared = await prepareInternalFrameworkBuild(userConfig, {
    cwd,
    mode: "production",
    command: "build",
    bundler: options?.bundler,
    requireBundler: true,
  });
  const bundler = prepared.config.bundler;
  if (!bundler) {
    await prepared.dispose();
    throw new Error(
      "[evjs] No bundler configured. Pass a bundler adapter in ev.config.ts or through dev/build options.",
    );
  }
  try {
    await assertNoActiveDevDistLock(cwd, prepared.plan.distDir);
    const bundlerFacts = await bundler.build({
      config: prepared.config,
      cwd,
      hooks: prepared.hooks,
      graph: prepared.graph,
      plan: prepared.plan,
    });
    const buildOutput = await linkAndEmitBuildOutput({
      bundlerFacts,
      graph: prepared.graph,
      plan: prepared.plan,
      config: prepared.config,
      cwd,
      hooks: prepared.hooks,
      pluginCtx: prepared.pluginContext,
      isRebuild: false,
    });

    await runBuildEndHooks(
      prepared.hooks,
      createBuildResult(buildOutput, false),
    );
  } finally {
    await prepared.dispose();
  }
}
