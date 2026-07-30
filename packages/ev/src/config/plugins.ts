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

type InactivePluginEntry = false | null | undefined;

type IsUnion<TValue, TCandidate = TValue> = TValue extends TCandidate
  ? [TCandidate] extends [TValue]
    ? false
    : true
  : never;

type TupleIndex<TTuple extends readonly unknown[]> = Exclude<
  keyof TTuple,
  keyof unknown[]
>;

type DefinitelyInstalledPluginEntries<TPlugins extends readonly unknown[]> =
  IsUnion<TPlugins> extends true
    ? never
    : {
        [TIndex in TupleIndex<TPlugins>]: [
          Extract<TPlugins[TIndex], InactivePluginEntry>,
        ] extends [never]
          ? IsUnion<TPlugins[TIndex]> extends true
            ? never
            : Exclude<TPlugins[TIndex], InactivePluginEntry>
          : never;
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
