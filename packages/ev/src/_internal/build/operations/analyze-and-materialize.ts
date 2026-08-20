import path from "node:path";
import type {
  BuildPlan,
  CoreApplicationPluginSettings,
  CoreGraph,
} from "@evjs/shared/manifest";
import type { ResolvedFrameworkConfig } from "../../../config/index.js";
import type { PluginSetupContext } from "../../../plugin/index.js";
import { resolvePageConfigModules } from "../config-loading/page-config-module.js";
import { syncPageRouteTypesFromCoreGraph } from "../discovery/convention-config.js";
import {
  type GeneratedIRImage,
  prepareFrameworkIR,
  publishFrameworkIR,
} from "../generated-ir/generated-contributions.js";
import { createCoreGraph } from "../graph/create-core-graph.js";
import type { GraphAnalysisResult } from "../graph/types.js";
import {
  createBuildGenerationId,
  createBuildPlan,
} from "../plan/create-build-plan.js";
import type { CreateBuildPlanOptions } from "../plan/types.js";
import {
  createPluginSettingsResolutionSession,
  type PluginSettingsRegistry,
} from "../plugins/settings.js";
import { syncPluginTypes } from "../typegen/plugin-types.js";

export interface AnalyzeAndMaterializeOptions<TBundlerCfg> {
  cwd: string;
  mode: "development" | "production";
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  pluginContext: PluginSetupContext<TBundlerCfg>;
  pluginSettings: PluginSettingsRegistry;
  applicationPluginSettings: CoreApplicationPluginSettings;
  plan?: CreateBuildPlanOptions;
  onAnalysis?: (analysis: GraphAnalysisResult) => void;
  beforeSourceRead?: (file: string) => void;
  onSourceDependency?: (file: string) => void;
}

export interface PublishFrameworkRevisionOptions {
  cwd: string;
  generatedIR: GeneratedIRImage;
  graph: CoreGraph;
  syncRouteTypes: boolean;
}

/** Publish one selected in-memory framework revision and its generated types. */
export async function publishFrameworkRevision(
  options: PublishFrameworkRevisionOptions,
): Promise<void> {
  await syncPluginTypes({ cwd: options.cwd });
  await publishFrameworkIR(options.cwd, options.generatedIR);
  if (options.syncRouteTypes) {
    await syncPageRouteTypesFromCoreGraph(options.cwd, options.graph);
  }
}

/** Analyze and render one complete framework IR candidate without writing it. */
export async function analyzeAndMaterializeFrameworkIR<TBundlerCfg>(
  options: AnalyzeAndMaterializeOptions<TBundlerCfg>,
): Promise<{
  analysis: GraphAnalysisResult;
  generatedIR: GeneratedIRImage;
  plan: BuildPlan;
}> {
  const planOptions: CreateBuildPlanOptions = {
    mode: options.mode,
    ...options.plan,
    buildId:
      options.plan?.buildId ??
      createBuildGenerationId(options.plan?.mode ?? options.mode),
  };

  async function prepare(
    analysis: GraphAnalysisResult,
  ): Promise<{ image: GeneratedIRImage; plan: BuildPlan }> {
    return prepareFrameworkIR({
      cwd: options.cwd,
      mode: options.mode,
      config: options.config,
      graph: analysis.graph,
      plugins: options.config.plugins,
      pluginContext: options.pluginContext,
      plan: createBuildPlan(options.config, analysis.graph, planOptions),
    });
  }

  const pageConfigs =
    options.config.routing?.metadata && !options.config.application
      ? await resolvePageConfigModules(
          options.cwd,
          options.config.routing.metadata,
          {
            beforeSourceRead: options.beforeSourceRead,
            onSourceDependency: options.onSourceDependency,
          },
        )
      : undefined;
  const pluginSettingsSession = createPluginSettingsResolutionSession(
    options.pluginSettings,
  );
  let aliases: Record<string, string> = {};
  for (let attempt = 0; attempt < 5; attempt++) {
    const analysis = await createCoreGraph(options.config, options.cwd, {
      resolve: { alias: aliases },
      pluginSettings: options.pluginSettings,
      applicationPluginSettings: options.applicationPluginSettings,
      pluginSettingsSession,
      beforeSourceRead: options.beforeSourceRead,
      onSourceDependency: options.onSourceDependency,
      ...(pageConfigs ? { pageConfigs } : {}),
    });
    options.onAnalysis?.(analysis);
    const { image, plan } = await prepare(analysis);
    const nextAliases = getFrameworkSourceAliases(options.cwd, plan);
    if (haveSameAliases(aliases, nextAliases)) {
      return { analysis, generatedIR: image, plan };
    }
    aliases = nextAliases;
  }

  throw new Error(
    "[evjs] Plugin source alias contributions did not converge after 5 framework graph analysis passes.",
  );
}

function haveSameAliases(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}

function getFrameworkSourceAliases(
  cwd: string,
  plan: BuildPlan,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(plan.resolve?.alias ?? {}).filter(
      ([specifier, replacement]) =>
        isFrameworkSourceAlias(cwd, specifier, replacement),
    ),
  );
}

function isFrameworkSourceAlias(
  cwd: string,
  specifier: string,
  replacement: string,
): boolean {
  if (specifier === "@" && replacement === "./src") return false;
  if (!path.isAbsolute(replacement) && !replacement.startsWith(".")) {
    return false;
  }
  const relative = path.relative(cwd, path.resolve(cwd, replacement));
  return (
    !relative.startsWith("..") &&
    !path.isAbsolute(relative) &&
    relative !== ".ev" &&
    !relative.startsWith(`.ev${path.sep}`)
  );
}
