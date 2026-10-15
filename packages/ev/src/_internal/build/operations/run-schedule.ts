import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BuildPlan, CoreGraph } from "@evjs/shared/manifest";
import type { ResolvedFrameworkConfig } from "../../../config/index.js";
import type { PluginHooks, PluginSetupContext } from "../../../plugin/index.js";
import {
  preflightBundlerBuild,
  resolveBundlerServerEntryAssets,
} from "../bundler/contracts.js";
import { createProductionOutputTransaction } from "../output/production-output-transaction.js";

/** Compile in a private staging directory and execute once; never publish output. */
export async function executeScheduleBuild<T>(
  prepared: {
    cwd: string;
    config: ResolvedFrameworkConfig<T>;
    graph: CoreGraph;
    plan: BuildPlan;
    hooks: PluginHooks<T>[];
    pluginContext: PluginSetupContext<T>;
  },
  taskId: string,
): Promise<void> {
  if (!prepared.graph.serverSchedules?.some((task) => task.id === taskId)) {
    throw new Error(`[evjs] Unknown schedule: ${taskId}`);
  }
  const bundler = prepared.config.bundler;
  if (!bundler)
    throw new Error("[evjs] Schedule execution requires a bundler.");
  const plan: BuildPlan = {
    ...prepared.plan,
    entries: prepared.plan.entries.filter(
      (entry) => entry.environment === "server",
    ),
    html: [],
  };
  preflightBundlerBuild(bundler, plan);
  const transaction = await createProductionOutputTransaction(
    prepared.cwd,
    plan,
  );
  try {
    const facts = await bundler.build({
      config: prepared.config,
      cwd: prepared.cwd,
      hooks: prepared.hooks,
      plan: transaction.buildPlan,
      addWatchFile: prepared.pluginContext.addWatchFile,
    });
    const entry = plan.entries.find((entry) => entry.kind === "server-runtime");
    if (!entry)
      throw new Error("[evjs] Schedule build is missing its server entry.");
    const assets = resolveBundlerServerEntryAssets(
      plan,
      facts.serverEntryAssets ?? {},
      "Schedule build",
    );
    const asset = assets[entry.name].js[0];
    const module = facts.loadServerModule
      ? await facts.loadServerModule(asset)
      : await import(
          pathToFileURL(path.resolve(transaction.outputPaths.serverDir, asset))
            .href
        );
    const exports = module as {
      runSchedule?: (id: string) => Promise<void>;
      default?: { runSchedule?: (id: string) => Promise<void> };
    };
    const run = exports.runSchedule ?? exports.default?.runSchedule;
    if (typeof run !== "function")
      throw new Error("[evjs] Server bundle does not export runSchedule.");
    await run(taskId);
  } finally {
    await transaction.rollback();
  }
}
