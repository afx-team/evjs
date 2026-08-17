import { createHash } from "node:crypto";
import path from "node:path";
import type {
  BuildPlan,
  CoreApplicationPluginSettings,
  CoreGraph,
} from "@evjs/shared/manifest";
import { getLogger } from "@logtape/logtape";
import type {
  Config,
  ResolvedConfig,
  ResolvedFrameworkConfig,
} from "../../config/index.js";
import { resolveConfig } from "../../config/index.js";
import type { PluginSetupContext } from "../../plugin/index.js";
import { analyzeAndMaterializeFrameworkIR } from "./analyze-and-materialize.js";
import type { BundlerAdapter } from "./bundler.js";
import { resolveBundler, withActiveBundler } from "./bundler-config.js";
import {
  withPageRoutingDefaults,
  withServerConventionDefaults,
  withServerRouteDiscovery,
} from "./convention-config.js";
import {
  collectRouteDirectoryWatchState,
  listConfigDependencyFiles,
  readWatchInputSnapshot,
} from "./dev-watch.js";
import { validateHtmlTemplates } from "./framework-output.js";
import type { GeneratedIRImage } from "./generated-contributions.js";
import type { GraphAnalysisResult } from "./graph/index.js";
import {
  collectProjectSourceResolutionWatchDirectories,
  type SourceDependencyReporter,
} from "./graph/source-resolution.js";
import { CANONICAL_PAGE_ROUTE_ROOT } from "./page-route-conventions.js";
import {
  orderPluginsByDependencies,
  runConfigureHooks,
} from "./plugin-lifecycle.js";
import { resolvePluginSettingsState } from "./plugin-settings.js";
import { CANONICAL_SERVER_ROUTE_ROOT } from "./server-route-conventions.js";

const logger = getLogger(["evjs", "ev"]);
const DEV_DIST_DIR = "dist";

export type DevDependencyKind = "opaque" | "semantic" | "topology";

export interface DevDependencyCollector {
  add(file: string, kind: DevDependencyKind): void;
}

export interface PrepareDevRevisionOptions<TBundlerCfg> {
  readonly buildId: string;
  readonly bundler?: BundlerAdapter<TBundlerCfg>;
  readonly cwd: string;
  readonly fallbackBundler?: BundlerAdapter<TBundlerCfg>;
  readonly flags?: PluginSetupContext<TBundlerCfg>["flags"];
  /** Programmatic `ev dev --no-shortcuts` override. */
  readonly cliShortcuts?: false;
  readonly loadConfig?: (
    cwd: string,
    context?: { onDependency(file: string): void },
  ) =>
    | Config<TBundlerCfg>
    | undefined
    | Promise<Config<TBundlerCfg> | undefined>;
  readonly reloadConfig: boolean;
  readonly userConfig?: Config<TBundlerCfg>;
  readonly dependencies: DevDependencyCollector;
  /** Supervisor-owned port resolution, invoked after config validation. */
  readonly resolveRuntimeConfig: (
    config: ResolvedConfig<TBundlerCfg>,
  ) => Promise<ResolvedConfig<TBundlerCfg>>;
  /** Active setup/configureBundler dependencies are opaque constructor input. */
  readonly inheritedOpaqueDependencies?: readonly string[];
}

export interface PreparedDevRevision<TBundlerCfg> {
  readonly analysis: GraphAnalysisResult;
  readonly bundler: BundlerAdapter<TBundlerCfg>;
  readonly config: ResolvedFrameworkConfig<TBundlerCfg>;
  readonly configuredConfig: Config<TBundlerCfg> | undefined;
  readonly dependencies: readonly string[];
  readonly generatedIR: GeneratedIRImage;
  readonly graph: CoreGraph;
  readonly opaqueDependencies: readonly string[];
  readonly plan: BuildPlan;
  readonly requestedPorts: {
    readonly client: number;
    readonly server: number;
  };
  readonly semanticFingerprint: string;
}

/**
 * Resolve one side-effect-free candidate revision. Plugin setup and bundler
 * construction intentionally happen later, after the active Session closes.
 */
export async function prepareDevRevision<TBundlerCfg>(
  options: PrepareDevRevisionOptions<TBundlerCfg>,
): Promise<PreparedDevRevision<TBundlerCfg>> {
  const dependencies = new Map<string, DevDependencyKind>();
  const addDependency = (file: string, kind: DevDependencyKind) => {
    const absolute = path.resolve(options.cwd, file);
    const previous = dependencies.get(absolute);
    if (
      previous === "opaque" ||
      (previous === "topology" && kind === "semantic")
    ) {
      return;
    }
    dependencies.set(absolute, kind);
    options.dependencies.add(absolute, kind);
  };

  for (const file of listConfigDependencyFiles(options.cwd)) {
    addDependency(file, "opaque");
  }
  for (const file of options.inheritedOpaqueDependencies ?? []) {
    addDependency(file, "opaque");
  }

  const configuredConfig =
    options.reloadConfig && options.loadConfig
      ? await options.loadConfig(options.cwd, {
          onDependency(file) {
            addDependency(file, "opaque");
          },
        })
      : options.userConfig;
  const configured = withCliShortcutsOverride(
    await runConfigureHooks(configuredConfig, {
      mode: "development",
      cwd: options.cwd,
      flags: options.flags,
    }),
    options.cliShortcuts,
  );
  const baseConfig = resolveConfig(configured);
  const requestedPorts = {
    client: baseConfig.dev.port,
    server: baseConfig.server.dev.port,
  };

  const pageRoot = baseConfig.application
    ? path.resolve(options.cwd, baseConfig.application.pageRoot)
    : path.resolve(options.cwd, CANONICAL_PAGE_ROUTE_ROOT);
  const serverRoot = path.resolve(options.cwd, CANONICAL_SERVER_ROUTE_ROOT);
  addDependency(pageRoot, "topology");
  addDependency(serverRoot, "topology");

  const shouldDiscoverPages =
    Boolean(baseConfig.application) ||
    (baseConfig.conventions !== false && configured?.routing !== undefined);
  if (shouldDiscoverPages) {
    const state = await collectRouteDirectoryWatchState(options.cwd, pageRoot, {
      beforeDirectoryRead: (file) => addDependency(file, "topology"),
    });
    for (const dependency of state.dependencies) {
      addDependency(dependency, "topology");
    }
  }
  if (baseConfig.conventions !== false) {
    const state = await collectRouteDirectoryWatchState(
      options.cwd,
      serverRoot,
      { beforeDirectoryRead: (file) => addDependency(file, "topology") },
    );
    for (const dependency of state.dependencies) {
      addDependency(dependency, "topology");
    }
  }

  const pageConfig = await withPageRoutingDefaults(
    baseConfig,
    configured,
    options.cwd,
    { syncRouteTypes: false },
  );
  const routeConfig = await withServerRouteDiscovery(pageConfig, options.cwd);
  const conventionConfig = await withServerConventionDefaults(
    routeConfig,
    options.cwd,
  );
  const orderedConfig = {
    ...conventionConfig,
    plugins: orderPluginsByDependencies(conventionConfig.plugins),
  };
  const runtimeConfig = await options.resolveRuntimeConfig(orderedConfig);
  const bundler = resolveBundler(
    runtimeConfig.bundler ?? options.fallbackBundler,
    options.bundler,
  );
  const config = withActiveBundler(runtimeConfig, bundler);
  const {
    registry: pluginSettings,
    applicationSettings: applicationPluginSettings,
  } = resolvePluginSettingsState(config);

  for (const dependency of config.routing?.dependencies ?? []) {
    addDependency(path.resolve(options.cwd, dependency), "semantic");
  }

  const preparationContext: PluginSetupContext<TBundlerCfg> = {
    mode: "development",
    cwd: options.cwd,
    config,
    flags: options.flags,
    logger,
    addWatchFile(file) {
      addDependency(file, "opaque");
    },
  };

  const reportSourceDependency = ((file: string) => {
    addDependency(file, "semantic");
  }) as SourceDependencyReporter;
  reportSourceDependency.resolutionCandidates = (candidates) => {
    const firstCandidate = candidates[0];
    const directParent = firstCandidate
      ? path.dirname(firstCandidate)
      : undefined;
    if (directParent) addDependency(directParent, "semantic");
    for (const directory of collectProjectSourceResolutionWatchDirectories(
      candidates,
    )) {
      if (directory === directParent) continue;
      addDependency(directory, "semantic");
    }
  };

  validateHtmlTemplates(options.cwd, config);
  const materialized = await analyzeAndMaterializeFrameworkIR({
    cwd: options.cwd,
    mode: "development",
    config,
    pluginContext: preparationContext,
    pluginSettings,
    applicationPluginSettings,
    plan: { buildId: options.buildId, distDir: DEV_DIST_DIR },
    write: false,
    beforeSourceRead(file) {
      addDependency(file, "semantic");
    },
    onSourceDependency: reportSourceDependency,
    onAnalysis(analysis) {
      reportGraphDiagnostics(analysis);
      for (const dependency of analysis.fileDependencies) {
        addDependency(dependency, "semantic");
      }
    },
  });

  const opaqueDependencies = [...dependencies]
    .filter(([, kind]) => kind === "opaque")
    .map(([file]) => file)
    .sort();
  const semanticFingerprint = createDevSemanticFingerprint({
    applicationPluginSettings,
    bundlerName: bundler.name,
    config,
    generatedIR: materialized.generatedIR,
    graph: materialized.analysis.graph,
    opaqueDependencies,
    plan: materialized.plan,
  });

  return {
    analysis: materialized.analysis,
    bundler,
    config,
    configuredConfig: configured,
    dependencies: [...dependencies.keys()].sort(),
    generatedIR: materialized.generatedIR,
    graph: materialized.analysis.graph,
    opaqueDependencies,
    plan: materialized.plan,
    requestedPorts,
    semanticFingerprint,
  };
}

function withCliShortcutsOverride<TBundlerCfg>(
  config: Config<TBundlerCfg> | undefined,
  override: false | undefined,
): Config<TBundlerCfg> | undefined {
  if (override !== false) return config;
  return {
    ...(config ?? {}),
    dev: {
      ...(config?.dev ?? {}),
      cliShortcuts: false,
    },
  };
}

function createDevSemanticFingerprint<TBundlerCfg>(options: {
  applicationPluginSettings: CoreApplicationPluginSettings;
  bundlerName: string;
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  generatedIR: GeneratedIRImage;
  graph: CoreGraph;
  opaqueDependencies: readonly string[];
  plan: BuildPlan;
}): string {
  const opaqueDependencyHashes = options.opaqueDependencies.map((file) => [
    file,
    readWatchInputSnapshot(file),
  ]);
  const configProjection = {
    ...options.config,
    bundler: options.bundlerName,
    plugins: options.config.plugins.map((plugin) => ({
      id: plugin.id,
      dependencies: plugin.dependencies,
      optionalDependencies: plugin.optionalDependencies,
      enforce: plugin.enforce,
    })),
  };
  const planProjection = omitObjectKey(options.plan, "buildId");
  const imageProjection = options.generatedIR.files.map(({ file, source }) => [
    file,
    createHash("sha256").update(source).digest("hex"),
  ]);
  const serialized = stableSerialize({
    applicationPluginSettings: options.applicationPluginSettings,
    bundler: options.bundlerName,
    config: configProjection,
    generatedIR: imageProjection,
    graph: options.graph,
    opaqueDependencies: opaqueDependencyHashes,
    plan: planProjection,
  });
  return createHash("sha256").update(serialized).digest("hex");
}

function omitObjectKey(value: unknown, keyToOmit: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => omitObjectKey(item, keyToOmit));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== keyToOmit)
      .map(([key, item]) => [key, omitObjectKey(item, keyToOmit)]),
  );
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(toStableValue(value));
}

function toStableValue(value: unknown): unknown {
  if (value === undefined) return "[undefined]";
  if (typeof value === "function") return "[function]";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toStableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, toStableValue(item)]),
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
    const message = location
      ? `${location} - ${diagnostic.message}`
      : diagnostic.message;
    if (diagnostic.level === "error") errors.push(message);
    else logger.warn`${message}`;
  }
  if (errors.length > 0) {
    throw new Error(
      ["[evjs] CoreGraph analysis failed.", ...errors].join("\n"),
    );
  }
}
