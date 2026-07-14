import type { BuildOutput } from "@evjs/shared/manifest";
import { type Config, resolvePluginsConfig } from "../../config/index.js";
import type {
  BuildResult,
  Plugin,
  PluginConfigContext,
  PluginContext,
  PluginHooks,
} from "../../plugin/index.js";

const PLUGIN_HOOK_NAMES = [
  "buildStart",
  "buildOutput",
  "bundlerConfig",
  "buildEnd",
  "dispose",
  "transformHtml",
] as const satisfies readonly (keyof PluginHooks)[];

export function orderPluginsByDependencies<TBundlerCfg>(
  plugins: Plugin<TBundlerCfg>[],
): Plugin<TBundlerCfg>[] {
  const pluginByName = new Map<string, Plugin<TBundlerCfg>>();
  const dependentsByName = new Map<string, string[]>();
  const dependencyCountByName = new Map<string, number>();

  for (const plugin of plugins) {
    if (pluginByName.has(plugin.name)) {
      throw new Error(
        `[evjs] Duplicate plugin name "${plugin.name}". Plugin names must be unique.`,
      );
    }
    pluginByName.set(plugin.name, plugin);
    dependentsByName.set(plugin.name, []);
    dependencyCountByName.set(plugin.name, 0);
  }

  function addDependency(
    plugin: Plugin<TBundlerCfg>,
    dependencyName: string,
    optional: boolean,
  ): void {
    if (!pluginByName.has(dependencyName)) {
      if (optional) return;
      throw new Error(
        `[evjs] Plugin "${plugin.name}" depends on missing plugin "${dependencyName}".`,
      );
    }
    dependentsByName.get(dependencyName)?.push(plugin.name);
    dependencyCountByName.set(
      plugin.name,
      (dependencyCountByName.get(plugin.name) ?? 0) + 1,
    );
  }

  for (const plugin of plugins) {
    for (const dependencyName of plugin.dependencies ?? []) {
      addDependency(plugin, dependencyName, false);
    }
    for (const dependencyName of plugin.optionalDependencies ?? []) {
      addDependency(plugin, dependencyName, true);
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
      if (nextDependencyCount !== 0) continue;
      const dependent = pluginByName.get(dependentName);
      if (dependent) {
        ready.push(dependent);
        ready.sort(comparePluginEnforce);
      }
    }
  }

  if (ordered.length !== plugins.length) {
    throwPluginDependencyCycle(plugins, ordered, pluginByName);
  }
  return ordered;
}

function throwPluginDependencyCycle<TBundlerCfg>(
  plugins: Plugin<TBundlerCfg>[],
  ordered: Plugin<TBundlerCfg>[],
  pluginByName: Map<string, Plugin<TBundlerCfg>>,
): never {
  const remainingNames = plugins
    .filter((plugin) => !ordered.includes(plugin))
    .map((plugin) => plugin.name);
  const remaining = new Set(remainingNames);

  for (const pluginName of remainingNames) {
    const dependencyPath: string[] = [];
    const seen = new Set<string>();
    let currentName = pluginName;
    let repeatedName: string | undefined;

    while (true) {
      if (seen.has(currentName)) {
        repeatedName = currentName;
        break;
      }
      seen.add(currentName);
      dependencyPath.push(currentName);
      const current = pluginByName.get(currentName);
      const nextName = [
        ...(current?.dependencies ?? []),
        ...(current?.optionalDependencies ?? []),
      ].find((name) => remaining.has(name));
      if (!nextName) break;
      currentName = nextName;
    }

    if (repeatedName) {
      const cycleStart = dependencyPath.indexOf(repeatedName);
      const cycle = [...dependencyPath.slice(cycleStart), repeatedName].join(
        " -> ",
      );
      throw new Error(`[evjs] Circular plugin dependency detected: ${cycle}.`);
    }
  }

  throw new Error(
    `[evjs] Circular plugin dependency detected among: ${remainingNames.join(", ")}.`,
  );
}

function comparePluginEnforce<TBundlerCfg>(
  left: Plugin<TBundlerCfg>,
  right: Plugin<TBundlerCfg>,
): number {
  return pluginEnforceRank(left) - pluginEnforceRank(right);
}

function pluginEnforceRank<TBundlerCfg>(plugin: Plugin<TBundlerCfg>): number {
  if (plugin.enforce === "pre") return 0;
  if (plugin.enforce === "post") return 2;
  return 1;
}

export async function collectPluginHooks<TBundlerCfg>(
  plugins: Plugin<TBundlerCfg>[],
  ctx: PluginContext<TBundlerCfg>,
): Promise<PluginHooks<TBundlerCfg>[]> {
  const allHooks: PluginHooks<TBundlerCfg>[] = [];
  try {
    for (const plugin of plugins) {
      if (!plugin.setup) continue;
      const hooks = resolvePluginSetupHooks<TBundlerCfg>(
        plugin.name,
        await plugin.setup(ctx),
      );
      if (hooks) allHooks.push(hooks);
    }
  } catch (error) {
    return rethrowAfterCleanup(
      error,
      () => runDisposeHooks(allHooks, ctx),
      "[evjs] Plugin setup failed and rollback also failed.",
    );
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

export async function runConfigHooks<TBundlerCfg>(
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

export async function runBuildStartHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  ctx: PluginContext<TBundlerCfg>,
): Promise<void> {
  for (const hook of hooks) await hook.buildStart?.(ctx);
}

export async function runBuildOutputHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  output: BuildOutput,
  ctx: PluginContext<TBundlerCfg>,
): Promise<void> {
  for (const hook of hooks) await hook.buildOutput?.(output, ctx);
}

export async function runBuildEndHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  result: BuildResult,
): Promise<void> {
  for (const hook of hooks) await hook.buildEnd?.(result);
}

export async function runDisposeHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  ctx: PluginContext<TBundlerCfg>,
): Promise<void> {
  const errors: unknown[] = [];
  for (const hook of [...hooks].reverse()) {
    try {
      await hook.dispose?.(ctx);
    } catch (error) {
      errors.push(error);
    }
  }
  throwCollectedErrors(errors, "[evjs] Multiple plugin dispose hooks failed.");
}

export function hasSamePluginIdentity<TBundlerCfg>(
  previous: Plugin<TBundlerCfg>[],
  next: Plugin<TBundlerCfg>[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((plugin, index) => plugin.name === next[index]?.name)
  );
}

export async function rethrowAfterCleanup(
  error: unknown,
  cleanup: () => Promise<void>,
  message: string,
): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], message, { cause: error });
  }
  throw error;
}

export async function runCleanupTasks(
  tasks: Array<() => void | Promise<void>>,
): Promise<void> {
  const errors: unknown[] = [];
  for (const task of tasks) {
    try {
      await task();
    } catch (error) {
      errors.push(error);
    }
  }
  throwCollectedErrors(errors, "[evjs] Multiple cleanup tasks failed.");
}

function throwCollectedErrors(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
