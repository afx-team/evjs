import type { BuildOutput } from "@evjs/shared/manifest";
import { type Config, resolvePluginsConfig } from "../../../config/index.js";
import {
  copyDefinedPluginRuntime,
  createPluginApplicationSettingContext,
  definedPluginRuntimeMetadata,
  forkDefinedPluginRuntime,
  prepareDefinedPluginApplicationSetting,
  shareDefinedPluginApplicationBinding,
} from "../../../plugin/definition.js";
import { PLUGIN_HOOK_NAMES } from "../../../plugin/hook-names.js";
import type {
  BeforeBuildContext,
  BuildResult,
  ClientDevMiddleware,
  ClientDevMiddlewareSetupContext,
  CliFlags,
  DevServerReadyContext,
  Plugin,
  PluginCliShortcut,
  PluginConfigureContext,
  PluginConfigureInput,
  PluginHooks,
  PluginSetupContext,
  TransformOutputContext,
} from "../../../plugin/index.js";
import type { BundlerEmittedFiles } from "../bundler/contracts.js";
import { normalizeShortcutKey } from "../operations/cli-shortcuts.js";
import { assertAfterBuildDeploymentOutputsAvailable } from "./deployment-output-reservations.js";

const typedPluginHookNames: readonly (keyof PluginHooks)[] = PLUGIN_HOOK_NAMES;

interface PluginOrderDeclaration {
  id: string;
  dependencies?: readonly string[];
  optionalDependencies?: readonly string[];
  enforce?: "pre" | "normal" | "post";
}

export function orderPluginsByDependencies<
  TPlugin extends PluginOrderDeclaration,
>(plugins: TPlugin[]): TPlugin[] {
  const pluginById = new Map<string, TPlugin>();
  const pluginIdByCaseFoldedId = new Map<string, string>();
  const dependentsById = new Map<string, string[]>();
  const dependencyCountById = new Map<string, number>();

  for (const plugin of plugins) {
    const caseFoldedId = plugin.id.toLowerCase();
    const existingId = pluginIdByCaseFoldedId.get(caseFoldedId);
    if (existingId !== undefined) {
      throw new Error(
        `[evjs] Duplicate plugin id "${plugin.id}" conflicts with "${existingId}". Plugin ids must be globally unique, including on case-insensitive filesystems.`,
      );
    }
    pluginIdByCaseFoldedId.set(caseFoldedId, plugin.id);
    pluginById.set(plugin.id, plugin);
    dependentsById.set(plugin.id, []);
    dependencyCountById.set(plugin.id, 0);
  }

  function addDependency(
    plugin: TPlugin,
    dependencyId: string,
    optional: boolean,
  ): void {
    if (dependencyId === plugin.id) {
      const field = optional ? "optionalDependencies" : "dependencies";
      throw new Error(
        `[evjs] Plugin "${plugin.id}" ${field} must not contain its own id.`,
      );
    }
    const dependency = pluginById.get(dependencyId);
    if (!dependency) {
      if (optional) return;
      throw new Error(
        `[evjs] Plugin "${plugin.id}" depends on missing plugin "${dependencyId}".`,
      );
    }
    dependentsById.get(dependencyId)?.push(plugin.id);
    dependencyCountById.set(
      plugin.id,
      (dependencyCountById.get(plugin.id) ?? 0) + 1,
    );
  }

  for (const plugin of plugins) {
    for (const dependencyId of plugin.dependencies ?? []) {
      addDependency(plugin, dependencyId, false);
    }
    for (const dependencyId of plugin.optionalDependencies ?? []) {
      addDependency(plugin, dependencyId, true);
    }
  }

  const ready = plugins
    .filter((plugin) => dependencyCountById.get(plugin.id) === 0)
    .sort(comparePluginEnforce);
  const ordered: TPlugin[] = [];

  while (ready.length > 0) {
    const plugin = ready.shift();
    if (!plugin) break;
    ordered.push(plugin);

    for (const dependentId of dependentsById.get(plugin.id) ?? []) {
      const nextDependencyCount =
        (dependencyCountById.get(dependentId) ?? 0) - 1;
      dependencyCountById.set(dependentId, nextDependencyCount);
      if (nextDependencyCount !== 0) continue;
      const dependent = pluginById.get(dependentId);
      if (dependent) {
        ready.push(dependent);
        ready.sort(comparePluginEnforce);
      }
    }
  }

  if (ordered.length !== plugins.length) {
    throwPluginDependencyCycle(plugins, ordered, pluginById);
  }
  return ordered;
}

function throwPluginDependencyCycle<TPlugin extends PluginOrderDeclaration>(
  plugins: TPlugin[],
  ordered: TPlugin[],
  pluginById: Map<string, TPlugin>,
): never {
  const remainingIds = plugins
    .filter((plugin) => !ordered.includes(plugin))
    .map((plugin) => plugin.id);
  const remaining = new Set(remainingIds);

  for (const pluginId of remainingIds) {
    const dependencyPath: string[] = [];
    const seen = new Set<string>();
    let currentId = pluginId;
    let repeatedId: string | undefined;

    while (true) {
      if (seen.has(currentId)) {
        repeatedId = currentId;
        break;
      }
      seen.add(currentId);
      dependencyPath.push(currentId);
      const current = pluginById.get(currentId);
      const nextId = [
        ...(current?.dependencies ?? []),
        ...(current?.optionalDependencies ?? []),
      ].find((id) => remaining.has(id));
      if (!nextId) break;
      currentId = nextId;
    }

    if (repeatedId) {
      const cycleStart = dependencyPath.indexOf(repeatedId);
      const cycle = [...dependencyPath.slice(cycleStart), repeatedId].join(
        " -> ",
      );
      throw new Error(`[evjs] Circular plugin dependency detected: ${cycle}.`);
    }
  }

  throw new Error(
    `[evjs] Circular plugin dependency detected among: ${remainingIds.join(", ")}.`,
  );
}

function comparePluginEnforce(
  left: PluginOrderDeclaration,
  right: PluginOrderDeclaration,
): number {
  return pluginEnforceRank(left) - pluginEnforceRank(right);
}

function pluginEnforceRank(plugin: PluginOrderDeclaration): number {
  if (plugin.enforce === "pre") return 0;
  if (plugin.enforce === "post") return 2;
  return 1;
}

export async function collectPluginHooks<TBundlerCfg>(
  plugins: Plugin<TBundlerCfg>[],
  ctx: PluginSetupContext<TBundlerCfg>,
  beforeRollback?: () => void | Promise<void>,
): Promise<PluginHooks<TBundlerCfg>[]> {
  const allHooks: PluginHooks<TBundlerCfg>[] = [];
  const config = createPluginConfigView(ctx.config);
  const flags = snapshotPluginFlags(ctx.flags);
  try {
    for (const plugin of plugins) {
      if (!plugin.setup) continue;
      const setupContext = Object.freeze({
        ...ctx,
        config,
        ...(flags === undefined ? {} : { flags }),
      }) as PluginSetupContext<TBundlerCfg>;
      const setupResult = await plugin.setup(setupContext);
      let hooks: PluginHooks<TBundlerCfg> | undefined;
      try {
        hooks = resolvePluginSetupHooks<TBundlerCfg>(plugin.id, setupResult);
      } catch (error) {
        const rollbackHooks =
          captureSetupRollbackHooks<TBundlerCfg>(setupResult);
        if (rollbackHooks) allHooks.push(rollbackHooks);
        throw error;
      }
      if (hooks) allHooks.push(hooks);
    }
  } catch (error) {
    return rethrowAfterCleanup(
      error,
      () =>
        runCleanupTasks([
          ...(beforeRollback ? [beforeRollback] : []),
          () => runDisposeHooks(allHooks, ctx),
        ]),
      "[evjs] Plugin setup failed and rollback also failed.",
    );
  }
  return allHooks;
}

/**
 * Preserve a valid dispose hook when another field makes setup()'s result
 * invalid. Inspect descriptors directly so rollback never invokes an accessor
 * or treats a non-function value as cleanup.
 */
function captureSetupRollbackHooks<TBundlerCfg>(
  setupResult: unknown,
): PluginHooks<TBundlerCfg> | undefined {
  if (
    !setupResult ||
    typeof setupResult !== "object" ||
    Array.isArray(setupResult)
  ) {
    return undefined;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(setupResult, "dispose");
    if (
      !descriptor?.enumerable ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "function"
    ) {
      return undefined;
    }
    const dispose = descriptor.value;
    return {
      dispose(context) {
        return Reflect.apply(dispose, setupResult, [
          context,
        ]) as void | Promise<void>;
      },
    };
  } catch {
    // Keep the original setup-result validation error authoritative.
    return undefined;
  }
}

function resolvePluginSetupHooks<TBundlerCfg>(
  pluginId: string,
  hooks: unknown,
): PluginHooks<TBundlerCfg> | undefined {
  if (hooks === undefined) return undefined;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new Error(
      `[evjs] Plugin "${pluginId}" setup hook must return a plugin hooks object or undefined.`,
    );
  }

  const hookConfig = hooks as Record<string, unknown>;
  for (const key of Reflect.ownKeys(hookConfig)) {
    if (typeof key !== "string") {
      throw new Error(
        `[evjs] Plugin "${pluginId}" setup hook returned an unsupported symbol field.`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(hookConfig, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new Error(
        `[evjs] Plugin "${pluginId}" setup hook returned "${key}" must be an enumerable own data property.`,
      );
    }
    if (!isPluginHookName(key)) {
      throwUnknownPluginHook(pluginId, key);
    }
    if (
      descriptor.value !== undefined &&
      typeof descriptor.value !== "function"
    ) {
      throw new Error(
        `[evjs] Plugin "${pluginId}" setup hook returned ${key} must be a function.`,
      );
    }
  }
  return hookConfig as PluginHooks<TBundlerCfg>;
}

function isPluginHookName(
  value: string,
): value is Extract<keyof PluginHooks, string> {
  return (typedPluginHookNames as readonly string[]).includes(value);
}

function throwUnknownPluginHook(pluginId: string, hookName: string): never {
  const replacement = PLUGIN_HOOK_NAMES.find(
    (candidate) => candidate.toLowerCase() === hookName.toLowerCase(),
  );
  if (replacement) {
    throw new Error(
      `[evjs] Plugin "${pluginId}" setup hook returned unsupported hook "${hookName}". Use "${replacement}" instead.`,
    );
  }
  throw new Error(
    `[evjs] Plugin "${pluginId}" setup hook returned unknown hook "${hookName}". Supported hooks are ${PLUGIN_HOOK_NAMES.join(", ")}.`,
  );
}

export async function runConfigureHooks<TBundlerCfg>(
  userConfig: Config<TBundlerCfg> | undefined,
  ctx: PluginConfigureContext,
): Promise<Config<TBundlerCfg> | undefined> {
  const clonedConfig = cloneConfigureHookInput(userConfig, true);
  // Use a separate clone graph so aliases elsewhere in raw config cannot
  // mutate the authoritative installation after `plugins` is hidden.
  const installedPlugins = cloneConfigureHookInput(clonedConfig?.plugins);
  const resolvedPlugins = resolvePluginsConfig<TBundlerCfg>(installedPlugins);
  shareResolvedPluginApplicationBindings(installedPlugins, resolvedPlugins);
  const plugins = orderPluginsByDependencies(resolvedPlugins);
  let config = createConfigureHookInput(clonedConfig);
  const applicationSettingContext =
    createPluginApplicationSettingContext(config);
  const configureFlags = snapshotPluginFlags(ctx.flags);

  for (const plugin of plugins) {
    prepareDefinedPluginApplicationSetting(plugin, applicationSettingContext);
  }

  for (const plugin of plugins) {
    if (!plugin.configure) continue;
    const hookInput = config ?? {};
    const configureContext = Object.freeze({
      ...ctx,
      ...(configureFlags === undefined ? {} : { flags: configureFlags }),
    }) as PluginConfigureContext;
    const nextConfig = await plugin.configure(hookInput, configureContext);
    assertConfigureHookDidNotInstallPlugins(plugin.id, hookInput);
    if (nextConfig !== undefined) {
      config = cloneConfigureHookInput(
        resolvePluginConfigureHookResult<TBundlerCfg>(plugin.id, nextConfig),
      );
    }
  }
  return restoreInstalledPlugins(config, installedPlugins);
}

function createConfigureHookInput<TBundlerCfg>(
  config: Config<TBundlerCfg> | undefined,
): PluginConfigureInput<TBundlerCfg> | undefined {
  if (!config) return undefined;
  if (!Reflect.deleteProperty(config, "plugins")) {
    throw new Error(
      "[evjs] Unable to isolate config.plugins from plugin hooks.",
    );
  }
  return config as PluginConfigureInput<TBundlerCfg>;
}

function assertConfigureHookDidNotInstallPlugins(
  pluginId: string,
  config: object,
): void {
  if (!Object.hasOwn(config, "plugins")) return;
  throw new Error(
    `[evjs] Plugin "${pluginId}" configure hook cannot change config.plugins. Install plugins only in the Application config.`,
  );
}

function restoreInstalledPlugins<TBundlerCfg>(
  config: PluginConfigureInput<TBundlerCfg> | undefined,
  plugins: Config<TBundlerCfg>["plugins"],
): Config<TBundlerCfg> | undefined {
  if (!config) return undefined;
  const restored = cloneConfigureHookInput(config);
  if (plugins !== undefined) {
    Object.defineProperty(restored, "plugins", {
      configurable: true,
      enumerable: true,
      value: plugins,
      writable: true,
    });
  }
  return restored;
}

function cloneConfigureHookInput<TValue>(
  config: TValue,
  forkDefinedPlugins = false,
): TValue {
  return cloneConfigureHookValue(
    config,
    new WeakMap(),
    forkDefinedPlugins,
  ) as TValue;
}

function cloneConfigureHookValue(
  value: unknown,
  seen: WeakMap<object, object>,
  forkDefinedPlugins: boolean,
): unknown {
  if (!value || typeof value !== "object") return value;
  if (!Array.isArray(value) && !isPlainObject(value)) return value;

  const existing = seen.get(value);
  if (existing) return existing;
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
    if (Array.isArray(value) && key === "length") {
      continue;
    }
    // Reattach plugin metadata below so this clone can fork or share the
    // build-local Application binding intentionally.
    if (key === definedPluginRuntimeMetadata) continue;
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
              forkDefinedPlugins,
            ),
            writable: true,
          }
        : descriptor,
    );
  }
  if (forkDefinedPlugins) {
    forkDefinedPluginRuntime(value, clone);
  } else {
    copyDefinedPluginRuntime(value, clone);
  }
  return clone;
}

function shareResolvedPluginApplicationBindings<TBundlerCfg>(
  installedPlugins: Config<TBundlerCfg>["plugins"],
  resolvedPlugins: readonly Plugin<TBundlerCfg>[],
): void {
  let resolvedIndex = 0;
  for (const installedPlugin of installedPlugins ?? []) {
    if (
      installedPlugin === false ||
      installedPlugin === null ||
      installedPlugin === undefined
    ) {
      continue;
    }
    const resolvedPlugin = resolvedPlugins[resolvedIndex++];
    if (!resolvedPlugin) {
      throw new Error(
        "[evjs] Resolved plugin installation lost its Application binding.",
      );
    }
    shareDefinedPluginApplicationBinding(installedPlugin, resolvedPlugin);
  }
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function resolvePluginConfigureHookResult<TBundlerCfg>(
  pluginId: string,
  config: unknown,
): PluginConfigureInput<TBundlerCfg> {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    assertConfigureHookDidNotInstallPlugins(pluginId, config);
    return config as PluginConfigureInput<TBundlerCfg>;
  }
  throw new Error(
    `[evjs] Plugin "${pluginId}" configure hook must return a config object or undefined.`,
  );
}

export async function runBeforeBuildHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  ctx: PluginSetupContext<TBundlerCfg>,
  isRebuild: boolean,
): Promise<void> {
  for (const hook of hooks) {
    if (!hook.beforeBuild) continue;
    const beforeBuildContext = Object.freeze({
      ...createLatePluginContext(ctx),
      isRebuild,
    }) as BeforeBuildContext<TBundlerCfg>;
    await hook.beforeBuild(beforeBuildContext);
  }
}

export async function runDevServerReadyHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  ctx: PluginSetupContext<TBundlerCfg>,
  origin: string,
  signal: AbortSignal,
): Promise<void> {
  for (const hook of hooks) {
    if (signal.aborted) return;
    if (!hook.devServerReady) continue;
    const readyContext = Object.freeze({
      ...createLatePluginContext(ctx),
      origin,
      signal,
    }) as DevServerReadyContext<TBundlerCfg>;
    await hook.devServerReady(readyContext);
  }
}

export async function collectClientDevMiddlewares<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  ctx: PluginSetupContext<TBundlerCfg>,
  signal: AbortSignal,
): Promise<ClientDevMiddleware[]> {
  const middlewares: ClientDevMiddleware[] = [];
  for (const hook of hooks) {
    if (signal.aborted) return middlewares;
    if (!hook.clientDevMiddleware) continue;
    const middlewareContext = Object.freeze({
      ...createLatePluginContext(ctx),
      signal,
    }) as ClientDevMiddlewareSetupContext<TBundlerCfg>;
    const value = await hook.clientDevMiddleware(middlewareContext);
    if (value === undefined) continue;
    const contributions = Array.isArray(value) ? value : [value];
    for (const middleware of contributions) {
      if (typeof middleware !== "function") {
        throw new Error(
          "[evjs] clientDevMiddleware hook must return a middleware function, an array of middleware functions, or undefined.",
        );
      }
      middlewares.push(middleware);
    }
  }
  return middlewares;
}

export async function runTransformOutputHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  output: BuildOutput,
  ctx: PluginSetupContext<TBundlerCfg>,
  validate?: () => void,
): Promise<void> {
  for (const hook of hooks) {
    if (!hook.transformOutput) continue;
    const outputContext = createLatePluginContext(ctx);
    await hook.transformOutput(output, outputContext);
    validate?.();
  }
}

export async function runAfterBuildHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  result: BuildResult,
  options: { cwd?: string; emittedFiles?: BundlerEmittedFiles } = {},
): Promise<void> {
  if (!hooks.some((hook) => hook.afterBuild)) return;

  const snapshot = structuredClone(result);
  assertAfterBuildDeploymentOutputsAvailable(hooks, snapshot, options);
  for (const hook of hooks) {
    await hook.afterBuild?.(structuredClone(snapshot));
  }
}

/**
 * Collect every plugin-contributed CLI shortcut, in plugin order.
 *
 * `cliShortcuts` is a descriptor-level contribution collected once from each
 * immutable dev Session's fixed plugin set. Shortcut `action` callbacks
 * receive the live {@link PluginDevSession} only when the key is later pressed.
 */
export async function collectPluginCliShortcuts<TBundlerCfg>(
  plugins: readonly Plugin<TBundlerCfg>[],
  options: { onError?: (error: unknown) => void } = {},
): Promise<PluginCliShortcut[]> {
  const collected: PluginCliShortcut[] = [];
  for (const plugin of [...plugins]) {
    if (!plugin.cliShortcuts) continue;
    try {
      let value: unknown;
      try {
        value = await Reflect.apply(plugin.cliShortcuts, plugin, []);
      } catch (error) {
        throw new Error(
          `[evjs] Plugin "${plugin.id}" cliShortcuts contribution failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      const shortcuts = resolvePluginCliShortcuts(plugin.id, value);
      collected.push(...shortcuts);
    } catch (error) {
      if (!options.onError) throw error;
      options.onError(error);
    }
  }
  return collected;
}

function resolvePluginCliShortcuts(
  pluginId: string,
  value: unknown,
): PluginCliShortcut[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `[evjs] Plugin "${pluginId}" cliShortcuts contribution must return an array.`,
    );
  }

  const resolved: PluginCliShortcut[] = [];
  for (let index = 0; index < value.length; index++) {
    const path = `Plugin "${pluginId}" cliShortcuts item ${index}`;
    const itemDescriptor = Object.getOwnPropertyDescriptor(
      value,
      String(index),
    );
    if (!itemDescriptor?.enumerable || !("value" in itemDescriptor)) {
      throw new Error(`[evjs] ${path} must be an array data property.`);
    }
    const shortcut = itemDescriptor.value;
    if (
      !shortcut ||
      typeof shortcut !== "object" ||
      Array.isArray(shortcut) ||
      !isPlainObject(shortcut)
    ) {
      throw new Error(`[evjs] ${path} must be a shortcut object.`);
    }

    const record = shortcut as Record<string, unknown>;
    for (const key of Reflect.ownKeys(record)) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (
        typeof key !== "string" ||
        !["key", "description", "action"].includes(key) ||
        !descriptor?.enumerable ||
        !("value" in descriptor)
      ) {
        throw new Error(
          `[evjs] ${path} must contain only key, description, and optional action data properties.`,
        );
      }
    }

    if (typeof record.key !== "string") {
      throw new Error(`[evjs] ${path}.key must be a string.`);
    }
    let key: string;
    try {
      key = normalizeShortcutKey(record.key);
    } catch {
      throw new Error(
        `[evjs] ${path}.key must be a single non-whitespace character.`,
      );
    }
    if (
      typeof record.description !== "string" ||
      record.description.trim() === ""
    ) {
      throw new Error(`[evjs] ${path}.description must be a non-empty string.`);
    }
    if (record.action !== undefined && typeof record.action !== "function") {
      throw new Error(
        `[evjs] ${path}.action must be a function when provided.`,
      );
    }

    resolved.push(
      Object.freeze({
        key,
        description: record.description,
        ...(record.action === undefined ? {} : { action: record.action }),
      }) as PluginCliShortcut,
    );
  }
  return resolved;
}

export async function runDisposeHooks<TBundlerCfg>(
  hooks: PluginHooks<TBundlerCfg>[],
  ctx: PluginSetupContext<TBundlerCfg>,
): Promise<void> {
  const errors: unknown[] = [];
  for (const hook of [...hooks].reverse()) {
    try {
      if (hook.dispose) {
        await hook.dispose(createLatePluginContext(ctx));
      }
    } catch (error) {
      errors.push(error);
    }
  }
  throwCollectedErrors(errors, "[evjs] Multiple plugin dispose hooks failed.");
}

/** Remove analysis-only capabilities before invoking late lifecycle hooks. */
export function createLatePluginContext<TBundlerCfg>(
  ctx: PluginSetupContext<TBundlerCfg>,
): TransformOutputContext<TBundlerCfg> {
  const flags = snapshotPluginFlags(ctx.flags);
  return Object.freeze({
    mode: ctx.mode,
    cwd: ctx.cwd,
    config: createPluginConfigView(ctx.config),
    ...(flags === undefined ? {} : { flags }),
    logger: ctx.logger,
  }) as TransformOutputContext<TBundlerCfg>;
}

export function snapshotPluginFlags(
  flags: PluginConfigureContext["flags"],
): PluginConfigureContext["flags"] {
  if (flags === undefined) return undefined;
  if (!isPlainObject(flags)) {
    throw new Error("[evjs] Plugin flags must be a plain object.");
  }

  const snapshot = Object.create(null) as CliFlags;
  for (const key of Reflect.ownKeys(flags)) {
    const descriptor = Object.getOwnPropertyDescriptor(flags, key);
    if (
      typeof key !== "string" ||
      !descriptor?.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error(
        "[evjs] Plugin flags must contain only enumerable own data properties.",
      );
    }
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: snapshotPluginFlagValue(descriptor.value, key),
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function snapshotPluginFlagValue(
  value: unknown,
  key: string,
): CliFlags[string] {
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (!Array.isArray(value)) {
    throw new Error(
      `[evjs] Plugin flag "${key}" must be a boolean, string, or array of booleans and strings.`,
    );
  }

  const snapshot: Array<boolean | string> = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor?.enumerable ||
      !("value" in descriptor) ||
      (typeof descriptor.value !== "boolean" &&
        typeof descriptor.value !== "string")
    ) {
      throw new Error(
        `[evjs] Plugin flag "${key}" item ${index} must be a boolean or string data property.`,
      );
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot) as Array<boolean | string>;
}

const pluginConfigViews = new WeakMap<object, object>();

/**
 * Create the isolated structural snapshot exposed through resolved plugin
 * contexts. Framework-owned arrays and plain records are deeply cloned and
 * frozen; functions and non-plain values remain opaque and are never frozen
 * in place.
 */
export function createPluginConfigView<TBundlerCfg>(
  config: PluginSetupContext<TBundlerCfg>["config"],
): PluginSetupContext<TBundlerCfg>["config"] {
  const existing = pluginConfigViews.get(config);
  if (existing) {
    return existing as PluginSetupContext<TBundlerCfg>["config"];
  }
  const view = cloneReadonlyPluginConfigValue(
    config,
    new WeakMap(),
    "config",
  ) as PluginSetupContext<TBundlerCfg>["config"];
  pluginConfigViews.set(config, view);
  pluginConfigViews.set(view, view);
  return view;
}

function cloneReadonlyPluginConfigValue(
  value: unknown,
  seen: WeakMap<object, object>,
  path: string,
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
    if (Array.isArray(value) && key === "length") {
      continue;
    }
    // Defined-plugin metadata contains build-only Application options. It is
    // pipeline state, not part of another plugin's public config view.
    if (key === definedPluginRuntimeMetadata) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) {
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: descriptor.enumerable,
        value: cloneReadonlyPluginConfigValue(
          descriptor.value,
          seen,
          `${path}.${String(key)}`,
        ),
        writable: true,
      });
      continue;
    }
    throw new Error(
      `[evjs] Resolved plugin context ${path}.${String(key)} must be a data property, not an accessor.`,
    );
  }

  return Object.freeze(clone);
}

export function hasSamePluginIdentity<TBundlerCfg>(
  previous: Plugin<TBundlerCfg>[],
  next: Plugin<TBundlerCfg>[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((plugin, index) => plugin.id === next[index]?.id)
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
