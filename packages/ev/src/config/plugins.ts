import {
  assertEnumerableStaticJsonProperties,
  assertStaticJsonValue,
  cloneStaticJsonValue,
  deepFreezeStaticJsonValue,
  isPlainStaticJsonObject,
} from "@evjs/shared/_internal/static-json";
import type {
  DefinedPluginPageDefaultable,
  DefinedPluginPageInput,
} from "../plugin/defined.js";
import type { StaticConfigCompatible, StaticConfigValue } from "./static.js";

const UNSAFE_PLUGIN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

declare const installedPluginRegistry: unique symbol;
declare const pluginPresetType: unique symbol;
const PLUGIN_PRESET_REGISTRY = Symbol.for("@evjs/ev/plugin-preset-registry/v1");
const pluginPresetEntries = getPluginPresetRegistry();

type InactivePluginEntry = false | null | undefined;

/**
 * An entry accepted from a plugin preset factory.
 *
 * The complete bundler-specific Plugin constraint is enforced when the preset
 * is installed in `Config.plugins`.
 */
export type PluginPresetEntry =
  | Readonly<{ name: string }>
  | PluginPreset<readonly PluginPresetEntry[]>
  | InactivePluginEntry;

/** A branded tuple of plugin entries. */
export interface PluginPreset<
  out TEntries extends readonly unknown[] = readonly unknown[],
> {
  readonly [pluginPresetType]: TEntries;
}

/** A plugin preset factory preserving its original arguments and exact tuple. */
export type PluginPresetFactory<
  TArguments extends readonly unknown[],
  TEntries extends readonly PluginPresetEntry[],
> = (...args: TArguments) => PluginPreset<TEntries>;

/**
 * Define a reusable, typed plugin composition.
 *
 * The returned factory keeps the input factory's arguments while branding its
 * exact output tuple so config resolution can distinguish presets from arrays.
 */
export function definePluginPreset<
  const TArguments extends readonly unknown[],
  const TEntries extends readonly PluginPresetEntry[],
>(
  factory: (...args: TArguments) => TEntries,
): PluginPresetFactory<TArguments, TEntries> {
  if (typeof factory !== "function") {
    throw new Error("[evjs] definePluginPreset() requires a factory function.");
  }
  return function createPluginPreset(...args): PluginPreset<TEntries> {
    const preset = Object.freeze({});
    pluginPresetEntries.set(preset, factory(...args));
    return preset as PluginPreset<TEntries>;
  };
}

/** @internal */
export function isPluginPreset(value: unknown): value is PluginPreset {
  return (
    typeof value === "object" &&
    value !== null &&
    pluginPresetEntries.has(value)
  );
}

/** @internal */
export function getPluginPresetEntries(preset: PluginPreset): unknown {
  return pluginPresetEntries.get(preset);
}

/** @internal Clone an opaque preset while projecting its hidden entries. */
export function clonePluginPreset(
  preset: PluginPreset,
  cloneEntries: (entries: unknown, clone: PluginPreset) => unknown,
): PluginPreset {
  const clone = Object.freeze({}) as PluginPreset;
  pluginPresetEntries.set(clone, undefined);
  pluginPresetEntries.set(
    clone,
    cloneEntries(getPluginPresetEntries(preset), clone),
  );
  return clone;
}

function getPluginPresetRegistry(): WeakMap<object, unknown> {
  const existing = Reflect.get(globalThis, PLUGIN_PRESET_REGISTRY);
  if (existing !== undefined) {
    if (existing instanceof WeakMap) {
      return existing as WeakMap<object, unknown>;
    }
    throw new Error("[evjs] The global plugin preset registry is invalid.");
  }

  const registry = new WeakMap<object, unknown>();
  Object.defineProperty(globalThis, PLUGIN_PRESET_REGISTRY, {
    configurable: false,
    enumerable: false,
    value: registry,
    writable: false,
  });
  return registry;
}

/**
 * Project configuration generated from `ev.config.ts`.
 *
 * `src/plugin-types.d.ts` augments this interface with the exact static config
 * type. Plugin packages do not maintain global registries themselves.
 */
export interface InstalledPluginRegistry {
  readonly [installedPluginRegistry]?: never;
}

type GeneratedInstalledPluginConfig =
  InstalledPluginRegistry extends Readonly<{ config: infer TConfig }>
    ? TConfig
    : never;

type IsUnion<TValue, TCandidate = TValue> = TValue extends TCandidate
  ? [TCandidate] extends [TValue]
    ? false
    : true
  : never;

type TupleIndex<TTuple extends readonly unknown[]> = Exclude<
  keyof TTuple,
  keyof unknown[]
>;

type DefinitelyInstalledPluginEntry<TEntry> = [
  Extract<TEntry, InactivePluginEntry>,
] extends [never]
  ? IsUnion<TEntry> extends true
    ? never
    : TEntry extends PluginPreset<infer TEntries>
      ? DefinitelyInstalledPluginEntries<TEntries>
      : Exclude<TEntry, InactivePluginEntry>
  : never;

type DefinitelyInstalledPluginEntries<TPlugins extends readonly unknown[]> =
  IsUnion<TPlugins> extends true
    ? never
    : {
        [TIndex in TupleIndex<TPlugins>]: DefinitelyInstalledPluginEntry<
          TPlugins[TIndex]
        >;
      }[TupleIndex<TPlugins>];

type ConfiguredPlugin<TConfig> = [TConfig] extends [
  Readonly<{
    plugins: infer TPlugins extends readonly unknown[];
  }>,
]
  ? DefinitelyInstalledPluginEntries<TPlugins>
  : never;

type InstalledPlugin = Exclude<
  ConfiguredPlugin<GeneratedInstalledPluginConfig>,
  InactivePluginEntry
>;

type PluginPageKey<TPlugin> = TPlugin extends unknown
  ? [DefinedPluginPageInput<TPlugin>] extends [never]
    ? never
    : TPlugin extends { readonly key: infer TKey extends string }
      ? string extends TKey
        ? never
        : IsUnion<TKey> extends true
          ? never
          : TKey
      : never
  : never;

type InstalledPluginPageKey = PluginPageKey<InstalledPlugin>;

type InstalledPluginForPageKey<TKey extends InstalledPluginPageKey> = Extract<
  InstalledPlugin,
  { readonly key: TKey }
>;

type PagePluginConfiguredValue<TPlugin> =
  DefinedPluginPageInput<TPlugin> extends never
    ? never
    :
        | false
        | StaticConfigCompatible<DefinedPluginPageInput<TPlugin>>
        | (DefinedPluginPageDefaultable<TPlugin> extends true ? true : never);

type RegisteredPagePluginValues = {
  readonly [TKey in InstalledPluginPageKey]?: PagePluginConfiguredValue<
    InstalledPluginForPageKey<TKey>
  >;
};

/** Page-level settings for plugins installed by `ev.config.ts`. */
export type PagePluginConfigValues = [InstalledPluginPageKey] extends [never]
  ? Readonly<Record<string, never>>
  : RegisteredPagePluginValues;

type NormalizedStaticConfigPropertyKey<TKey extends PropertyKey> = TKey extends
  | string
  | number
  ? `${TKey}`
  : TKey;

type NormalizedStaticConfigObject<TValue extends object> = {
  readonly [TKey in keyof TValue as NormalizedStaticConfigPropertyKey<TKey>]: TValue[TKey];
};

type ExactStaticConfigValue<TActual, TExpected> = TExpected extends
  | null
  | boolean
  | number
  | string
  ? TActual extends TExpected
    ? TActual
    : never
  : TExpected extends readonly (infer TExpectedItem)[]
    ? TActual extends readonly (infer TActualItem)[]
      ? readonly ExactStaticConfigValue<TActualItem, TExpectedItem>[]
      : never
    : TExpected extends object
      ? TActual extends object
        ? {
            readonly [TKey in keyof TActual]: NormalizedStaticConfigPropertyKey<TKey> extends keyof NormalizedStaticConfigObject<TExpected>
              ? ExactStaticConfigValue<
                  Exclude<TActual[TKey], undefined>,
                  Exclude<
                    NormalizedStaticConfigObject<TExpected>[NormalizedStaticConfigPropertyKey<TKey> &
                      keyof NormalizedStaticConfigObject<TExpected>],
                    undefined
                  >
                >
              : never;
          }
        : never
      : never;

type ExactPagePluginConfiguredValue<TActual, TExpected> =
  TActual extends boolean
    ? TActual extends TExpected
      ? TActual
      : never
    : ExactStaticConfigValue<TActual, Exclude<TExpected, boolean>>;

/** Exact nested-value check used by the generic `definePageConfig()` helper. */
export type PagePluginConfigValuesCheck<TActual> = TActual extends undefined
  ? undefined
  : TActual extends object
    ? {
        readonly [TKey in keyof TActual]: TKey extends InstalledPluginPageKey
          ? ExactPagePluginConfiguredValue<
              Exclude<TActual[TKey], undefined>,
              Exclude<RegisteredPagePluginValues[TKey], undefined>
            >
          : never;
      }
    : never;

export type ResolvedPagePluginConfigInput =
  | boolean
  | Readonly<Record<string, StaticConfigValue>>;

/** Validate and isolate the static plugin map read from `page.config.*`. */
export function resolvePagePluginConfigValues(
  value: unknown,
  source: string,
): Readonly<Record<string, ResolvedPagePluginConfigInput>> {
  if (value === undefined) return {};
  if (!isPlainStaticJsonObject(value)) {
    throw new Error(`[evjs] ${source} must be a plain object.`);
  }
  assertEnumerableStaticJsonProperties(value, source);

  const resolved: Record<string, ResolvedPagePluginConfigInput> = {};
  for (const [key, configured] of Object.entries(value)) {
    assertPluginKey(key, `${source} key`);
    if (typeof configured === "boolean") {
      defineRecordValue(resolved, key, configured);
      continue;
    }
    if (!isPlainStaticJsonObject(configured)) {
      throw new Error(
        `[evjs] ${source}.${key} must be false, true, or a plain object.`,
      );
    }
    assertStaticJsonValue(configured, `${source}.${key}`);
    defineRecordValue(
      resolved,
      key,
      deepFreezeStaticJsonValue(cloneStaticJsonValue(configured)) as Readonly<
        Record<string, StaticConfigValue>
      >,
    );
  }
  return Object.freeze(resolved);
}

export function assertPluginKey(
  value: unknown,
  source: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) ||
    UNSAFE_PLUGIN_KEYS.has(value)
  ) {
    throw new Error(
      `[evjs] ${source} must be a lowercase plugin key such as "analytics" or "error-reporting".`,
    );
  }
}

export type ExtractInstalledPlugin<TConfig, TKey extends string> = Extract<
  ConfiguredPlugin<TConfig>,
  { readonly key: TKey }
>;

function defineRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
