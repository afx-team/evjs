import path from "node:path";
import type {
  BuildPlan,
  CoreApplicationPluginSettings,
} from "@evjs/shared/manifest";
import type { ResolvedFrameworkConfig } from "../../config/index.js";
import { runPluginHook } from "../../plugin/errors.js";
import type { PluginContext } from "../../plugin/index.js";
import { syncPageRouteTypesFromCoreGraph } from "./convention-config.js";
import {
  type PreparedFrameworkIR,
  type PreparedSourceAliasContribution,
  prepareFrameworkIR,
} from "./generated-contributions.js";
import { createCoreGraph, type GraphAnalysisResult } from "./graph/index.js";
import { resolvePageConfigModules } from "./page-config-module.js";
import { type CreateBuildPlanOptions, createBuildPlan } from "./plan/index.js";
import {
  createPluginSettingsResolutionSession,
  type PluginSettingsRegistry,
} from "./plugin-settings.js";
import { syncPluginTypes } from "./plugin-types.js";

export interface AnalyzeAndMaterializeOptions<TBundlerCfg> {
  cwd: string;
  mode: "development" | "production";
  command: "dev" | "build";
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  pluginContext: PluginContext<TBundlerCfg>;
  pluginSettings: PluginSettingsRegistry;
  applicationPluginSettings: CoreApplicationPluginSettings;
  plan?: CreateBuildPlanOptions;
  write?: boolean;
  deferWrite?: boolean;
  onAnalysis?: (analysis: GraphAnalysisResult) => void;
}

export async function analyzeAndMaterializeFrameworkIR<TBundlerCfg>(
  options: AnalyzeAndMaterializeOptions<TBundlerCfg>,
): Promise<{
  analysis: GraphAnalysisResult;
  plan: BuildPlan;
  commit?: () => Promise<void>;
}> {
  async function materialize(
    analysis: GraphAnalysisResult,
  ): Promise<PreparedFrameworkIR> {
    return prepareFrameworkIR({
      cwd: options.cwd,
      mode: options.mode,
      command: options.command,
      config: options.config,
      graph: analysis.graph,
      plugins: options.config.plugins,
      pluginContext: options.pluginContext,
      plan: createBuildPlan(options.config, analysis.graph, {
        mode: options.mode,
        ...options.plan,
      }),
    });
  }

  const pageConfigs =
    options.config.routing?.metadata && !options.config.application
      ? await resolvePageConfigModules(
          options.cwd,
          options.config.routing.metadata,
        )
      : undefined;
  const pluginSettingsSession = createPluginSettingsResolutionSession(
    options.pluginSettings,
  );
  let aliasState: FrameworkSourceAliasState = {
    aliases: {},
    contributions: [],
  };
  let lastChangingContribution: PreparedSourceAliasContribution | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const analysis = await createCoreGraph(options.config, options.cwd, {
      resolve: { alias: aliasState.aliases },
      pluginSettings: options.pluginSettings,
      applicationPluginSettings: options.applicationPluginSettings,
      pluginSettingsSession,
      ...(pageConfigs ? { pageConfigs } : {}),
    });
    options.onAnalysis?.(analysis);
    const prepared = await materialize(analysis);
    const plan = prepared.plan;
    const nextAliasState = getFrameworkSourceAliasState(options.cwd, prepared);
    if (haveSameAliases(aliasState.aliases, nextAliasState.aliases)) {
      const commit = async () => {
        await syncPluginTypes({ cwd: options.cwd });
        await prepared.write();
        if (options.config.routing) {
          await syncPageRouteTypesFromCoreGraph(options.cwd, analysis.graph);
        }
      };
      if (options.write !== false && !options.deferWrite) {
        await commit();
      }
      return {
        analysis,
        plan,
        ...(options.write !== false && options.deferWrite ? { commit } : {}),
      };
    }
    lastChangingContribution =
      getChangingSourceAliasContribution(aliasState, nextAliasState) ??
      lastChangingContribution;
    aliasState = nextAliasState;
  }

  const convergenceError = new Error(
    "[evjs] Plugin source alias contributions did not converge after 5 framework graph analysis passes.",
  );
  if (!lastChangingContribution) throw convergenceError;
  return runPluginHook(
    lastChangingContribution.pluginName,
    lastChangingContribution.originHook,
    () => {
      throw convergenceError;
    },
  );
}

interface FrameworkSourceAliasState {
  aliases: Record<string, string>;
  contributions: PreparedSourceAliasContribution[];
}

function getFrameworkSourceAliasState(
  cwd: string,
  prepared: PreparedFrameworkIR,
): FrameworkSourceAliasState {
  const aliases = getFrameworkSourceAliases(cwd, prepared.plan);
  const contributions: PreparedSourceAliasContribution[] = [];
  const seenSpecifiers = new Set<string>();
  // Resolve slots use last-write-wins precedence. Retain only the effective
  // contributor for each specifier, in highest-precedence order.
  for (
    let index = prepared.sourceAliasContributions.length - 1;
    index >= 0;
    index--
  ) {
    const contribution = prepared.sourceAliasContributions[index];
    if (!contribution || seenSpecifiers.has(contribution.specifier)) {
      continue;
    }
    seenSpecifiers.add(contribution.specifier);
    contributions.push(contribution);
  }
  return { aliases, contributions };
}

function getChangingSourceAliasContribution(
  previous: FrameworkSourceAliasState,
  next: FrameworkSourceAliasState,
): PreparedSourceAliasContribution | undefined {
  const changedSpecifiers = new Set([
    ...Object.keys(previous.aliases),
    ...Object.keys(next.aliases),
  ]);
  for (const specifier of changedSpecifiers) {
    if (previous.aliases[specifier] === next.aliases[specifier]) {
      changedSpecifiers.delete(specifier);
    }
  }
  return (
    next.contributions.find((contribution) =>
      changedSpecifiers.has(contribution.specifier),
    ) ??
    previous.contributions.find((contribution) =>
      changedSpecifiers.has(contribution.specifier),
    )
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
