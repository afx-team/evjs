import type { BuildOutput } from "@evjs/shared/manifest";
import {
  type Config,
  resolveConfig,
  resolvePluginsConfig,
} from "../../config/index.js";
import { clonePluginPreset, isPluginPreset } from "../../config/plugins.js";
import {
  copyDefinedPluginSnapshot,
  createPluginApplicationSettingContext,
  forkDefinedPluginPipeline,
  getDefinedPluginDeclaration,
  hasSameDefinedPluginPipeline,
  isDefinedPluginOwnedPropertyKey,
  isPluginActive,
  prepareDefinedPluginApplicationSetting,
} from "../../plugin/defined.js";
import { runPluginHook } from "../../plugin/errors.js";
import { PLUGIN_HOOK_NAMES } from "../../plugin/hook-names.js";
import type {
  BeforeBuildContext,
  BuildResult,
  ConfigureBundlerContext,
  FrameworkBundlerView,
  FrameworkConfigView,
  FrameworkPluginView,
  Plugin,
  PluginConfigureContext,
  PluginContext,
  PluginHooks,
  PluginSetupContext,
  TransformOutputContext,
} from "../../plugin/index.js";
import type { BundlerEmittedFiles } from "./bundler.js";
import {
  assertAfterBuildDeploymentOutputsAvailable,
  copyDeploymentOutputReservations,
} from "./deployment-output-reservations.js";

const typedPluginHookNames: readonly (keyof PluginHooks)[] = PLUGIN_HOOK_NAMES;
const managedPluginNames = new WeakMap<object, string>();
const pluginConfigSnapshots = new WeakMap<object, object>();

type SetupDisposer = () => void | Promise<void>;

interface ResolvedPluginSetupHooks<TBundlerCfg> {
  readonly receiver: object;
  readonly hooks: Readonly<PluginHooks<TBundlerCfg>>;
}

interface PluginOrderDeclaration {
  name: string;
  dependencies?: string[];
  optionalDependencies?: string[];
}

export function orderPluginsByDependencies<
  TPlugin extends PluginOrderDeclaration,
>(plugins: TPlugin[]): TPlugin[] {
  const pluginByName = new Map<string, TPlugin>();
  const dependentsByName = new Map<string, string[]>();
  const dependencyCountByName = new Map<string, number>();
  const authoredIndexByName = new Map<string, number>();

  for (const [index, plugin] of plugins.entries()) {
    if (pluginByName.has(plugin.name)) {
      throw new Error(
        `[evjs] Duplicate plugin name "${plugin.name}". Plugin names must be unique.`,
      );
    }
    pluginByName.set(plugin.name, plugin);
    dependentsByName.set(plugin.name, []);
    dependencyCountByName.set(plugin.name, 0);
    authoredIndexByName.set(plugin.name, index);
  }

  function addDependency(
    plugin: TPlugin,
    dependencyName: string,
    optional: boolean,
  ): void {
    const dependency = pluginByName.get(dependencyName);
    if (!dependency) {
      if (optional) return;
      throw new Error(
        `[evjs] Plugin "${plugin.name}" depends on missing plugin "${dependencyName}".`,
      );
    }
    if (!isPluginActive(dependency)) {
      if (optional) return;
      const reason =
        getDefinedPluginDeclaration(dependency)?.inactiveReason ??
        "its activation condition evaluated to false";
      throw new Error(
        `[evjs] Plugin "${plugin.name}" depends on inactive plugin "${dependencyName}": ${reason}.`,
      );
    }
    dependentsByName.get(dependencyName)?.push(plugin.name);
    dependencyCountByName.set(
      plugin.name,
      (dependencyCountByName.get(plugin.name) ?? 0) + 1,
    );
  }

  for (const plugin of plugins) {
    if (!isPluginActive(plugin)) continue;
    for (const dependencyName of plugin.dependencies ?? []) {
      addDependency(plugin, dependencyName, false);
    }
    for (const dependencyName of plugin.optionalDependencies ?? []) {
      addDependency(plugin, dependencyName, true);
    }
  }

  function compareAuthoredPluginOrder(left: TPlugin, right: TPlugin): number {
    return (
      (authoredIndexByName.get(left.name) ?? 0) -
      (authoredIndexByName.get(right.name) ?? 0)
    );
  }

  const ready = plugins
    .filter((plugin) => dependencyCountByName.get(plugin.name) === 0)
    .sort(compareAuthoredPluginOrder);
  const ordered: TPlugin[] = [];

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
        ready.sort(compareAuthoredPluginOrder);
      }
    }
  }

  if (ordered.length !== plugins.length) {
    throwPluginDependencyCycle(plugins, ordered, pluginByName);
  }
  return ordered;
}

function throwPluginDependencyCycle<TPlugin extends PluginOrderDeclaration>(
  plugins: TPlugin[],
  ordered: TPlugin[],
  pluginByName: Map<string, TPlugin>,
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
      if (!current || !isPluginActive(current)) break;
      const nextName = [
        ...(current.dependencies ?? []),
        ...(current.optionalDependencies ?? []),
      ].find((name) => {
        const dependency = pluginByName.get(name);
        return Boolean(
          remaining.has(name) && dependency && isPluginActive(dependency),
        );
      });
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

export async function collectPluginHooks<TBundlerCfg>(
  plugins: Plugin<TBundlerCfg>[],
  ctx: PluginContext<TBundlerCfg>,
): Promise<PluginHooks<TBundlerCfg>[]> {
  const allHooks: PluginHooks<TBundlerCfg>[] = [];
  try {
    for (const plugin of plugins) {
      if (!plugin.setup) continue;
      const hooks = await setupPlugin(plugin, ctx);
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

async function setupPlugin<TBundlerCfg>(
  plugin: Plugin<TBundlerCfg>,
  ctx: PluginContext<TBundlerCfg>,
): Promise<PluginHooks<TBundlerCfg> | undefined> {
  const registeredDisposers: SetupDisposer[] = [];
  let acceptingDisposers = true;

  let setupResult: unknown;
  try {
    setupResult = await runPluginHook(plugin.name, "setup", () => {
      const setupContext: PluginSetupContext<TBundlerCfg> = {
        ...ctx,
        config: createPluginConfigSnapshot(ctx.config),
        onDispose(callback) {
          if (!acceptingDisposers) {
            throw new Error(
              `[evjs] Plugin "${plugin.name}" must register onDispose() callbacks before setup() settles.`,
            );
          }
          if (typeof callback !== "function") {
            throw new Error(
              `[evjs] Plugin "${plugin.name}" setup onDispose() expects a function.`,
            );
          }
          registeredDisposers.push(callback);
        },
      };
      return plugin.setup?.(setupContext);
    });
    acceptingDisposers = false;
    const resolvedHooks = await runPluginHook(plugin.name, "setup", () =>
      resolvePluginSetupHooks<TBundlerCfg>(plugin.name, setupResult),
    );
    return createManagedPluginHooks(
      plugin.name,
      resolvedHooks,
      registeredDisposers,
    );
  } catch (error) {
    acceptingDisposers = false;
    const invalidResultDispose = readSetupResultDispose(setupResult);
    return rethrowAfterCleanup(
      error,
      () =>
        runPluginSetupDisposers(
          plugin.name,
          ctx,
          invalidResultDispose,
          registeredDisposers,
        ),
      `[evjs] Plugin "${plugin.name}" setup failed and its cleanup also failed.`,
    );
  }
}

function readSetupResultDispose(
  value: unknown,
): PluginHooks["dispose"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "dispose");
  if (
    descriptor?.enumerable &&
    "value" in descriptor &&
    typeof descriptor.value === "function"
  ) {
    return descriptor.value.bind(value) as NonNullable<PluginHooks["dispose"]>;
  }
  return undefined;
}

function createManagedPluginHooks<TBundlerCfg>(
  pluginName: string,
  resolvedHooks: ResolvedPluginSetupHooks<TBundlerCfg> | undefined,
  registeredDisposers: SetupDisposer[],
): PluginHooks<TBundlerCfg> | undefined {
  if (!resolvedHooks && registeredDisposers.length === 0) return undefined;

  const hooks = resolvedHooks?.hooks;
  const receiver = resolvedHooks?.receiver;
  const configureBundler = hooks?.configureBundler?.bind(receiver);
  const beforeBuild = hooks?.beforeBuild?.bind(receiver);
  const transformOutput = hooks?.transformOutput?.bind(receiver);
  const transformHtml = hooks?.transformHtml?.bind(receiver);
  const rawAfterBuild = hooks?.afterBuild;
  const afterBuild = rawAfterBuild?.bind(receiver);
  const dispose = hooks?.dispose?.bind(receiver);
  const managedHooks: PluginHooks<TBundlerCfg> = {
    ...(configureBundler
      ? {
          configureBundler: (config, ctx) =>
            runPluginHook(pluginName, "configureBundler", () =>
              configureBundler(config, {
                ...ctx,
                config: createPluginConfigSnapshot(ctx.config),
              }),
            ),
        }
      : {}),
    ...(beforeBuild
      ? {
          beforeBuild: (ctx) =>
            runPluginHook(pluginName, "beforeBuild", () =>
              beforeBuild({
                ...ctx,
                config: createPluginConfigSnapshot(ctx.config),
              }),
            ),
        }
      : {}),
    ...(transformOutput
      ? {
          transformOutput: (output, ctx) =>
            runPluginHook(pluginName, "transformOutput", () =>
              transformOutput(output, {
                ...ctx,
                config: createPluginConfigSnapshot(ctx.config),
              }),
            ),
        }
      : {}),
    ...(transformHtml
      ? {
          transformHtml: (document, ctx) =>
            runPluginHook(pluginName, "transformHtml", () =>
              transformHtml(document, {
                ...ctx,
                config: createPluginConfigSnapshot(ctx.config),
              }),
            ),
        }
      : {}),
    ...(afterBuild
      ? {
          afterBuild: (result) =>
            runPluginHook(pluginName, "afterBuild", () => afterBuild(result)),
        }
      : {}),
    dispose: (disposeContext) =>
      runManagedPluginDispose(
        pluginName,
        {
          ...disposeContext,
          config: createPluginConfigSnapshot(disposeContext.config),
        },
        dispose,
        registeredDisposers,
      ),
  };
  if (rawAfterBuild && managedHooks.afterBuild) {
    copyDeploymentOutputReservations(rawAfterBuild, managedHooks.afterBuild);
  }
  managedPluginNames.set(managedHooks, pluginName);
  return managedHooks;
}

async function runPluginSetupDisposers<TBundlerCfg>(
  pluginName: string,
  ctx: PluginContext<TBundlerCfg>,
  dispose: PluginHooks<TBundlerCfg>["dispose"],
  registeredDisposers: SetupDisposer[],
): Promise<void> {
  await runManagedPluginDispose(
    pluginName,
    createLatePluginContext(ctx),
    dispose,
    registeredDisposers,
  );
}

async function runManagedPluginDispose<TBundlerCfg>(
  pluginName: string,
  context: Parameters<NonNullable<PluginHooks<TBundlerCfg>["dispose"]>>[0],
  dispose: PluginHooks<TBundlerCfg>["dispose"],
  registeredDisposers: SetupDisposer[],
): Promise<void> {
  const errors: unknown[] = [];
  if (dispose) {
    try {
      await runPluginHook(pluginName, "dispose", () => dispose(context));
    } catch (error) {
      errors.push(error);
    }
  }
  for (const registeredDispose of [...registeredDisposers].reverse()) {
    try {
      await runPluginHook(pluginName, "dispose", registeredDispose);
    } catch (error) {
      errors.push(error);
    }
  }
  throwCollectedErrors(
    errors,
    `[evjs] Multiple dispose callbacks failed for plugin "${pluginName}".`,
  );
}

function resolvePluginSetupHooks<TBundlerCfg>(
  pluginName: string,
  hooks: unknown,
): ResolvedPluginSetupHooks<TBundlerCfg> | undefined {
  if (hooks === undefined) return undefined;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" setup hook must return a plugin hooks object or undefined.`,
    );
  }
  const prototype = Object.getPrototypeOf(hooks);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" setup hook must return a plain plugin hooks object with Object.prototype or a null prototype.`,
    );
  }

  const hookConfig = hooks as Record<string, unknown>;
  const hookSnapshot = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(hookConfig)) {
    if (typeof key !== "string") {
      throw new Error(
        `[evjs] Plugin "${pluginName}" setup hook returned an unsupported symbol field.`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(hookConfig, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new Error(
        `[evjs] Plugin "${pluginName}" setup hook returned "${key}" must be an enumerable own data property.`,
      );
    }
    if (!isPluginHookName(key)) {
      throwUnknownPluginHook(pluginName, key);
    }
    if (
      descriptor.value !== undefined &&
      typeof descriptor.value !== "function"
    ) {
      throw new Error(
        `[evjs] Plugin "${pluginName}" setup hook returned ${key} must be a function.`,
      );
    }
    if (descriptor.value !== undefined) {
      Object.defineProperty(hookSnapshot, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false,
      });
    }
  }
  return Object.freeze({
    receiver: hooks,
    hooks: Object.freeze(hookSnapshot) as PluginHooks<TBundlerCfg>,
  });
}

function isPluginHookName(
  value: string,
): value is Extract<keyof PluginHooks, string> {
  return (typedPluginHookNames as readonly string[]).includes(value);
}

function throwUnknownPluginHook(pluginName: string, hookName: string): never {
  const replacement = PLUGIN_HOOK_NAMES.find(
    (candidate) => candidate.toLowerCase() === hookName.toLowerCase(),
  );
  if (replacement) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" setup hook returned unsupported hook "${hookName}". Use "${replacement}" instead.`,
    );
  }
  throw new Error(
    `[evjs] Plugin "${pluginName}" setup hook returned unknown hook "${hookName}". Supported hooks are ${PLUGIN_HOOK_NAMES.join(", ")}.`,
  );
}

export async function runConfigureHooks<TBundlerCfg>(
  userConfig: Config<TBundlerCfg> | undefined,
  ctx: PluginConfigureContext,
): Promise<Config<TBundlerCfg> | undefined> {
  let config = cloneConfigureHookInput(userConfig, true);
  // Reject invalid author config before any plugin can be blamed for it.
  resolveConfig(config);
  const configuredPlugins = resolvePluginsConfig<TBundlerCfg>(config?.plugins);
  const plugins = orderPluginsByDependencies([...configuredPlugins]);
  const applicationSettingContext =
    createPluginApplicationSettingContext(config);

  for (const plugin of plugins) {
    prepareDefinedPluginApplicationSetting(plugin, applicationSettingContext);
  }

  for (const plugin of plugins) {
    if (!plugin.configure) continue;
    await runPluginHook(plugin.name, "configure", async () => {
      const nextConfig = await plugin.configure?.(config ?? {}, ctx);
      if (nextConfig !== undefined) {
        config = cloneConfigureHookInput(
          resolvePluginConfigureHookResult<TBundlerCfg>(
            plugin.name,
            nextConfig,
          ),
        );
      }
      const nextPlugins = resolvePluginsConfig<TBundlerCfg>(config?.plugins);
      assertConfigurePluginListUnchanged(
        configuredPlugins,
        nextPlugins,
        plugin.name,
      );
      resolveConfig(config);
    });
  }
  return config;
}

function assertConfigurePluginListUnchanged<TBundlerCfg>(
  expected: Plugin<TBundlerCfg>[],
  actual: Plugin<TBundlerCfg>[],
  pluginName: string,
): void {
  if (
    expected.length === actual.length &&
    expected.every((plugin, index) =>
      hasSameConfiguredPlugin(plugin, actual[index]),
    )
  ) {
    return;
  }
  throw new Error(
    `[evjs] Plugin "${pluginName}" configure hook must not add, remove, replace, or reorder config.plugins. Declare the complete plugin list in defineConfig().`,
  );
}

function hasSameConfiguredPlugin<TBundlerCfg>(
  left: Plugin<TBundlerCfg>,
  right: Plugin<TBundlerCfg> | undefined,
): boolean {
  if (!right) return false;
  return (
    left.name === right.name &&
    (left as { key?: string }).key === (right as { key?: string }).key &&
    haveSameStringArray(left.dependencies, right.dependencies) &&
    haveSameStringArray(
      left.optionalDependencies,
      right.optionalDependencies,
    ) &&
    left.configure === right.configure &&
    left.setup === right.setup &&
    left.emitIR === right.emitIR &&
    hasSameDefinedPluginPipeline(left, right)
  );
}

function haveSameStringArray(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.length === right.length &&
      left.every((value, index) => value === right[index]))
  );
}

function cloneConfigureHookInput<TBundlerCfg>(
  config: Config<TBundlerCfg> | undefined,
  forkPluginPipelineState = false,
): Config<TBundlerCfg> | undefined {
  return cloneConfigureHookValue(
    config,
    new WeakMap(),
    forkPluginPipelineState,
  ) as Config<TBundlerCfg> | undefined;
}

function cloneConfigureHookValue(
  value: unknown,
  seen: WeakMap<object, object>,
  forkPluginPipelineState: boolean,
): unknown {
  if (!value || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing) return existing;
  if (isPluginPreset(value)) {
    return clonePluginPreset(value, (entries, clone) => {
      seen.set(value, clone);
      return cloneConfigureHookValue(entries, seen, forkPluginPipelineState);
    });
  }
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  let clone: object;
  if (Array.isArray(value)) {
    const arrayClone: unknown[] = [];
    arrayClone.length = value.length;
    clone = arrayClone;
  } else {
    clone = Object.create(Object.getPrototypeOf(value));
  }
  seen.set(value, clone);

  for (const key of Reflect.ownKeys(value)) {
    if (
      (Array.isArray(value) && key === "length") ||
      isDefinedPluginOwnedPropertyKey(value, key)
    ) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    Object.defineProperty(
      clone,
      key,
      "value" in descriptor
        ? {
            configurable: true,
            enumerable: descriptor.enumerable,
            value: cloneConfigureHookValue(
              descriptor.value,
              seen,
              forkPluginPipelineState,
            ),
            writable: true,
          }
        : descriptor,
    );
  }
  if (forkPluginPipelineState) {
    forkDefinedPluginPipeline(value, clone);
  } else {
    copyDefinedPluginSnapshot(value, clone);
  }
  return clone;
}

/**
 * Give plugin hooks a detached, deeply frozen metadata view of resolved
 * framework config. Plugin and bundler implementation capabilities are
 * intentionally omitted.
 */
export function createPluginConfigSnapshot<TBundlerCfg>(
  config: PluginContext<TBundlerCfg>["config"],
): FrameworkConfigView<TBundlerCfg> {
  if (!config || typeof config !== "object") return config;
  const cached = pluginConfigSnapshots.get(config);
  if (cached) {
    return cached as FrameworkConfigView<TBundlerCfg>;
  }
  const snapshot = projectPluginConfigSnapshot(config, new WeakMap());
  freezePluginConfigSnapshotValue(snapshot, new WeakSet());
  pluginConfigSnapshots.set(config, snapshot);
  pluginConfigSnapshots.set(snapshot, snapshot);
  return snapshot;
}

function projectPluginConfigSnapshot<TBundlerCfg>(
  config: PluginContext<TBundlerCfg>["config"],
  seen: WeakMap<object, object>,
): FrameworkConfigView<TBundlerCfg> {
  const snapshot = Object.create(
    Object.getPrototypeOf(config),
  ) as FrameworkConfigView<TBundlerCfg>;
  seen.set(config, snapshot);

  for (const key of Reflect.ownKeys(config)) {
    const descriptor = Object.getOwnPropertyDescriptor(config, key);
    if (!descriptor) continue;

    let propertyValue: unknown;
    if (key === "plugins") {
      propertyValue = config.plugins.map(projectFrameworkPluginView);
    } else if (key === "bundler") {
      propertyValue = config.bundler
        ? projectFrameworkBundlerView(config.bundler)
        : undefined;
    } else {
      propertyValue =
        "value" in descriptor ? descriptor.value : Reflect.get(config, key);
      propertyValue = clonePluginConfigSnapshotValue(propertyValue, seen);
    }

    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      value: propertyValue,
      writable: true,
    });
  }
  return snapshot;
}

function projectFrameworkPluginView(
  plugin: FrameworkPluginView,
): FrameworkPluginView {
  const declaration = getDefinedPluginDeclaration(plugin);
  const key = declaration?.key ?? plugin.key;
  return {
    name: plugin.name,
    ...(key === undefined ? {} : { key }),
    active: declaration?.active ?? plugin.active,
    ...(declaration?.inactiveReason
      ? { inactiveReason: declaration.inactiveReason }
      : {}),
  };
}

function projectFrameworkBundlerView(
  bundler: FrameworkBundlerView,
): FrameworkBundlerView {
  return {
    name: bundler.name,
    capabilities: {
      build: {
        server: bundler.capabilities.build.server,
        rsc: bundler.capabilities.build.rsc,
        ppr: bundler.capabilities.build.ppr,
      },
      dev: {
        configuration: bundler.capabilities.dev.configuration,
        html: bundler.capabilities.dev.html,
        entries: bundler.capabilities.dev.entries,
        routes: bundler.capabilities.dev.routes,
        server: bundler.capabilities.dev.server,
        resolution: bundler.capabilities.dev.resolution,
      },
    },
  };
}

function clonePluginConfigSnapshotValue(
  value: unknown,
  seen: WeakMap<object, object>,
): unknown {
  if (!value || typeof value !== "object") return value;
  if (!Array.isArray(value) && !isPlainObject(value)) return value;

  const existing = seen.get(value);
  if (existing) return existing;
  const clone: object = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(Object.getPrototypeOf(value));
  seen.set(value, clone);

  for (const key of Reflect.ownKeys(value)) {
    if (
      (Array.isArray(value) && key === "length") ||
      isDefinedPluginOwnedPropertyKey(value, key)
    ) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    const propertyValue =
      "value" in descriptor ? descriptor.value : Reflect.get(value, key);
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: descriptor.enumerable,
      value: clonePluginConfigSnapshotValue(propertyValue, seen),
      writable: true,
    });
  }
  return clone;
}

function freezePluginConfigSnapshotValue(
  value: unknown,
  seen: WeakSet<object>,
): void {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value) && !isPlainObject(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) {
      freezePluginConfigSnapshotValue(descriptor.value, seen);
    }
  }
  Object.freeze(value);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function resolvePluginConfigureHookResult<TBundlerCfg>(
  pluginName: string,
  config: unknown,
): Config<TBundlerCfg> {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return config as Config<TBundlerCfg>;
  }
  throw new Error(
    `[evjs] Plugin "${pluginName}" configure hook must return a config object or undefined.`,
  );
}

export async function runBeforeBuildHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  ctx: PluginContext<TBundlerCfg>,
  isRebuild: boolean,
): Promise<void> {
  const beforeBuildContext: BeforeBuildContext<TBundlerCfg> = {
    ...createLatePluginContext(ctx),
    isRebuild,
  };
  for (const hook of hooks) {
    await hook.beforeBuild?.(beforeBuildContext);
  }
}

export async function runConfigureBundlerHook<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>,
  bundlerConfig: TBundlerCfg,
  ctx: ConfigureBundlerContext<TBundlerCfg>,
  validate: () => void | Promise<void>,
): Promise<void> {
  const configureBundler = hooks.configureBundler;
  if (!configureBundler) return;

  const run = async () => {
    await configureBundler(bundlerConfig, ctx);
    await validate();
  };
  const pluginName = managedPluginNames.get(hooks);
  if (pluginName) {
    await runPluginHook(pluginName, "configureBundler", run);
    return;
  }
  await run();
}

export async function runTransformOutputHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  output: BuildOutput,
  ctx: PluginContext<TBundlerCfg>,
  validate?: () => void,
): Promise<void> {
  const outputContext = createLatePluginContext(ctx);
  for (const hook of hooks) {
    if (!hook.transformOutput) continue;
    await hook.transformOutput(output, outputContext);
    if (!validate) continue;
    await runPluginHookValidation(hook, "transformOutput", validate);
  }
}

/**
 * Attribute framework validation of a hook's result to the managed plugin that
 * produced it. Raw hooks remain usable by internal adapter tests and receive
 * the original validation error when no plugin ownership is available.
 */
export async function runPluginHookValidation<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>,
  hookName: "transformOutput" | "transformHtml" | "afterBuild",
  validate: () => void | Promise<void>,
): Promise<void> {
  const pluginName = managedPluginNames.get(hooks);
  if (pluginName) {
    await runPluginHook(pluginName, hookName, validate);
    return;
  }
  await validate();
}

export async function runAfterBuildHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  result: BuildResult,
  options: { cwd?: string; emittedFiles?: BundlerEmittedFiles } = {},
): Promise<void> {
  const afterBuildHooks = hooks.flatMap((hook) =>
    hook.afterBuild ? [hook.afterBuild] : [],
  );
  if (afterBuildHooks.length === 0) return;

  const snapshot = structuredClone(result);
  await preflightAfterBuildHooks(hooks, snapshot, options);
  for (const afterBuild of afterBuildHooks) {
    await afterBuild(structuredClone(snapshot));
  }
}

export async function preflightAfterBuildHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  result: BuildResult,
  options: { cwd?: string; emittedFiles?: BundlerEmittedFiles } = {},
): Promise<void> {
  await assertAfterBuildDeploymentOutputsAvailable(
    hooks,
    result,
    options,
    (hook, validate) => runPluginHookValidation(hook, "afterBuild", validate),
  );
}

export async function runDisposeHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  ctx: PluginContext<TBundlerCfg>,
): Promise<void> {
  const errors: unknown[] = [];
  const disposeContext = createLatePluginContext(ctx);
  for (const hook of [...hooks].reverse()) {
    try {
      await hook.dispose?.(disposeContext);
    } catch (error) {
      errors.push(error);
    }
  }
  throwCollectedErrors(errors, "[evjs] Multiple plugin dispose hooks failed.");
}

/** Remove analysis-only capabilities before invoking late lifecycle hooks. */
export function createLatePluginContext<TBundlerCfg>(
  ctx: PluginContext<TBundlerCfg>,
): TransformOutputContext<TBundlerCfg> {
  return {
    mode: ctx.mode,
    command: ctx.command,
    cwd: ctx.cwd,
    config: createPluginConfigSnapshot(ctx.config),
    ...(ctx.flags === undefined ? {} : { flags: ctx.flags }),
    logger: ctx.logger,
  };
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
