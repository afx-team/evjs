import path from "node:path";
import type { BuildPlan } from "@evjs/shared/manifest";
import type {
  ResolvedApplicationExtensionValues,
  ResolvedFrameworkConfig,
} from "../../config/index.js";
import type { PluginContext } from "../../plugin/index.js";
import { syncPageRouteTypesFromCoreGraph } from "./convention-config.js";
import {
  type PreparedFrameworkIRMaterialization,
  prepareFrameworkIRMaterialization,
} from "./generated-contributions.js";
import { createCoreGraph, type GraphAnalysisResult } from "./graph/index.js";
import { resolvePageConfigModules } from "./page-config-module.js";
import { type CreateBuildPlanOptions, createBuildPlan } from "./plan/index.js";
import {
  createPluginExtensionResolutionSession,
  type PluginExtensionRegistry,
} from "./plugin-extensions.js";

export interface AnalyzeAndMaterializeOptions<TBundlerCfg> {
  cwd: string;
  mode: "development" | "production";
  command: "dev" | "build";
  config: ResolvedFrameworkConfig<TBundlerCfg>;
  pluginContext: PluginContext<TBundlerCfg>;
  pluginExtensions: PluginExtensionRegistry;
  applicationExtensions: ResolvedApplicationExtensionValues;
  plan?: CreateBuildPlanOptions;
  write?: boolean;
  /**
   * Prepare and preflight framework-owned files, but leave publication to the
   * caller. Used by dev bundler transactions so the active compiler cannot
   * observe candidate generated modules before it has been quarantined.
   */
  deferWrite?: boolean;
  onAnalysis?: (analysis: GraphAnalysisResult) => void;
}

export interface DeferredFrameworkIRMaterialization {
  readonly committed: boolean;
  preflight(): Promise<void>;
  commit(): Promise<void>;
}

export async function analyzeAndMaterializeFrameworkIR<TBundlerCfg>(
  options: AnalyzeAndMaterializeOptions<TBundlerCfg>,
): Promise<{
  analysis: GraphAnalysisResult;
  plan: BuildPlan;
  materialization?: DeferredFrameworkIRMaterialization;
}> {
  async function materialize(
    analysis: GraphAnalysisResult,
  ): Promise<PreparedFrameworkIRMaterialization> {
    return prepareFrameworkIRMaterialization({
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
  const extensionResolutionSession = createPluginExtensionResolutionSession(
    options.pluginExtensions,
  );
  let aliases: Record<string, string> = {};
  for (let attempt = 0; attempt < 5; attempt++) {
    const analysis = await createCoreGraph(options.config, options.cwd, {
      resolve: { alias: aliases },
      pluginExtensions: options.pluginExtensions,
      applicationExtensions: options.applicationExtensions,
      extensionResolutionSession,
      ...(pageConfigs ? { pageConfigs } : {}),
    });
    options.onAnalysis?.(analysis);
    const prepared = await materialize(analysis);
    const plan = prepared.plan;
    const nextAliases = getFrameworkSourceAliases(options.cwd, plan);
    if (haveSameAliases(aliases, nextAliases)) {
      if (options.write === false) {
        return { analysis, plan };
      }

      await prepared.preflight();
      let commitPromise: Promise<void> | undefined;
      let committed = false;
      const materialization: DeferredFrameworkIRMaterialization = {
        get committed() {
          return committed;
        },
        preflight: prepared.preflight,
        commit() {
          commitPromise ??= (async () => {
            await prepared.commit();
            if (options.config.routing) {
              await syncPageRouteTypesFromCoreGraph(
                options.cwd,
                analysis.graph,
              );
            }
            committed = true;
          })();
          return commitPromise;
        },
      };
      if (!options.deferWrite) {
        await materialization.commit();
      }
      return { analysis, plan, materialization };
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
