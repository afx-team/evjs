import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Config, DefaultBundlerConfig } from "../config/index.js";
import {
  assertPluginKey,
  type ResolvedPagePluginConfigInput,
} from "../config/plugins.js";
import {
  resolveStaticConfigObject,
  type StaticConfigObject,
} from "../config/static.js";
import type {
  ContributionContext,
  FrameworkPageView,
  GeneratedModuleRef,
  Plugin,
  PluginConfigContext,
  PluginContext,
  PluginHooks,
} from "./index.js";

declare const definedPluginContract: unique symbol;
declare const pluginConfigTypes: unique symbol;
const PLUGIN_CONFIG_CONTRACT = Symbol("evjs.plugin-config");

type MaybePromise<T> = T | Promise<T>;
type AnyFunction = (...args: never[]) => unknown;
type RichConfigValue =
  | Date
  | Error
  | GeneratedModuleRef
  | Map<unknown, unknown>
  | PromiseLike<unknown>
  | ReadonlyMap<unknown, unknown>
  | ReadonlySet<unknown>
  | RegExp
  | Set<unknown>
  | URL
  | WeakMap<object, unknown>
  | WeakSet<object>;

type FunctionPropertyNames<TValue extends object> = {
  [TKey in keyof TValue]-?: TValue[TKey] extends AnyFunction ? TKey : never;
}[keyof TValue];

type HasFunctionProperties<TValue extends object> = [
  FunctionPropertyNames<TValue>,
] extends [never]
  ? false
  : true;

type DeepReadonly<T> = T extends AnyFunction
  ? T
  : T extends RichConfigValue
    ? T
    : T extends readonly unknown[]
      ? number extends T["length"]
        ? T extends readonly (infer TItem)[]
          ? readonly DeepReadonly<TItem>[]
          : never
        : { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T extends object
        ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
        : T;

type IsUnion<TValue, TCandidate = TValue> = TValue extends TCandidate
  ? [TCandidate] extends [TValue]
    ? false
    : true
  : never;

type DeepPartialProperty<TValue> = undefined extends TValue
  ? DeepPartial<Exclude<TValue, undefined>> | undefined
  : DeepPartial<TValue>;

type DeepPartial<TValue> = [TValue] extends [AnyFunction]
  ? TValue
  : [TValue] extends [readonly unknown[]]
    ? TValue
    : [TValue] extends [RichConfigValue]
      ? TValue
      : IsUnion<TValue> extends true
        ? TValue
        : [TValue] extends [object]
          ? HasFunctionProperties<TValue> extends true
            ? TValue
            : { [TKey in keyof TValue]?: DeepPartialProperty<TValue[TKey]> }
          : TValue;

export interface PluginSettingContext {
  readonly owner: "application" | "page";
  readonly applicationId: string;
  readonly applicationRoot: string;
  readonly routingMode: "spa" | "mpa";
  readonly pageId?: string;
  readonly pageModule?: string;
  readonly pageRoot?: string;
  readonly configSource?: string;
}

export interface PluginConfigOptions<TValue extends object> {
  /** Optional schema version recorded in the CoreGraph plugin catalog. */
  readonly schemaVersion?: string;
  /** Value used when the application/page explicitly enables this contract without an object. */
  readonly defaults?: TValue | ((context: PluginSettingContext) => TValue);
  /** Return false/a message or throw to reject a resolved value. */
  readonly validate?: (
    value: DeepReadonly<TValue>,
    context: PluginSettingContext,
  ) => undefined | boolean | string;
}

export interface PluginConfigContract<
  TInput extends object = object,
  TOutput extends object = TInput,
  TDefaultable extends boolean = boolean,
> {
  readonly [PLUGIN_CONFIG_CONTRACT]: true;
  readonly [pluginConfigTypes]: {
    readonly input: TInput;
    readonly output: TOutput;
    readonly defaultable: TDefaultable;
  };
  readonly schemaVersion?: string;
  readonly defaultable: TDefaultable;
  readonly defaults?: TOutput | ((context: PluginSettingContext) => TOutput);
  readonly schema?: StandardSchemaV1<TInput, TOutput>;
  readonly validate?: (
    value: DeepReadonly<TOutput>,
    context: PluginSettingContext,
  ) => undefined | boolean | string;
}

type InvalidConfigContractValue = AnyFunction | readonly unknown[];

type PlainConfigContractValue<TValue> = [TValue] extends [object]
  ? [Extract<TValue, InvalidConfigContractValue>] extends [never]
    ? TValue
    : never
  : never;

type SchemaInput<TSchema extends StandardSchemaV1> = PlainConfigContractValue<
  StandardSchemaV1.InferInput<TSchema>
>;

type SchemaOutput<TSchema extends StandardSchemaV1> = PlainConfigContractValue<
  StandardSchemaV1.InferOutput<TSchema>
>;

type ValidConfigSchema<TSchema extends StandardSchemaV1> = [
  SchemaInput<TSchema>,
] extends [never]
  ? never
  : [SchemaOutput<TSchema>] extends [never]
    ? never
    : TSchema;

type RequiredPluginConfigArgs<TValue extends object, TOptions> = [
  PlainConfigContractValue<TValue>,
] extends [never]
  ? [options: never]
  : [options: TOptions];

type OptionalPluginConfigArgs<TValue extends object, TOptions> = [
  PlainConfigContractValue<TValue>,
] extends [never]
  ? [options: never]
  : [options?: TOptions];

/**
 * Declare one independently validated application/page configuration contract.
 *
 * Passing defaults makes the contract usable through an omitted value or
 * page-level `true`. Explicit objects are deeply merged over those defaults
 * before schema/plugin validation.
 */
export function pluginConfig<TValue extends object>(
  ...args: RequiredPluginConfigArgs<
    TValue,
    PluginConfigOptions<TValue> & {
      readonly defaults: TValue | ((context: PluginSettingContext) => TValue);
    }
  >
): PluginConfigContract<DeepPartial<TValue>, TValue, true>;
export function pluginConfig<TValue extends object>(
  ...args: OptionalPluginConfigArgs<
    TValue,
    PluginConfigOptions<TValue> & { readonly defaults?: undefined }
  >
): PluginConfigContract<TValue, TValue, false>;
export function pluginConfig<const TSchema extends StandardSchemaV1>(
  schema: ValidConfigSchema<TSchema>,
  options: Omit<PluginConfigOptions<SchemaOutput<TSchema>>, "defaults"> & {
    readonly defaults:
      | SchemaInput<TSchema>
      | ((context: PluginSettingContext) => SchemaInput<TSchema>);
  },
): PluginConfigContract<
  DeepPartial<SchemaInput<TSchema>>,
  SchemaOutput<TSchema>,
  true
>;
export function pluginConfig<const TSchema extends StandardSchemaV1>(
  schema: ValidConfigSchema<TSchema>,
  options?: Omit<PluginConfigOptions<SchemaOutput<TSchema>>, "defaults"> & {
    readonly defaults?: undefined;
  },
): PluginConfigContract<SchemaInput<TSchema>, SchemaOutput<TSchema>, false>;
export function pluginConfig(
  schemaOrOptions: unknown = {},
  maybeOptions: unknown = {},
): unknown {
  const schema = isStandardSchema(schemaOrOptions)
    ? schemaOrOptions
    : undefined;
  const options = schema ? maybeOptions : schemaOrOptions;
  if (!isPlainRecord(options)) {
    throw new Error("[evjs] pluginConfig() options must be a plain object.");
  }
  assertOnlyKeys(
    options,
    ["schemaVersion", "defaults", "validate"],
    "pluginConfig() options",
  );
  if (
    options.schemaVersion !== undefined &&
    (typeof options.schemaVersion !== "string" ||
      options.schemaVersion.length === 0 ||
      options.schemaVersion !== options.schemaVersion.trim())
  ) {
    throw new Error(
      "[evjs] pluginConfig() schemaVersion must be a non-empty string without surrounding whitespace.",
    );
  }
  if (
    options.defaults !== undefined &&
    typeof options.defaults !== "function"
  ) {
    assertConfigObject(options.defaults, "pluginConfig() defaults");
  }
  if (
    options.validate !== undefined &&
    typeof options.validate !== "function"
  ) {
    throw new Error("[evjs] pluginConfig() validate must be a function.");
  }
  return Object.freeze({
    [PLUGIN_CONFIG_CONTRACT]: true,
    defaultable: options.defaults !== undefined,
    ...(schema ? { schema } : {}),
    ...(options.schemaVersion === undefined
      ? {}
      : { schemaVersion: options.schemaVersion }),
    ...(options.defaults === undefined ? {} : { defaults: options.defaults }),
    ...(options.validate === undefined ? {} : { validate: options.validate }),
  }) as PluginConfigContract;
}

/** Structural constraint used by typed plugin factory declarations. */
interface AnyPluginConfigContract {
  readonly [PLUGIN_CONFIG_CONTRACT]: true;
  readonly schemaVersion?: string;
  readonly defaultable: boolean;
  readonly defaults?: unknown;
  readonly schema?: unknown;
  readonly validate?: unknown;
}

type ContractInput<TContract> = TContract extends {
  readonly [pluginConfigTypes]: { readonly input: infer TInput };
}
  ? TInput extends object
    ? TInput
    : never
  : never;

type ContractOutput<TContract> = TContract extends {
  readonly [pluginConfigTypes]: { readonly output: infer TOutput };
}
  ? TOutput extends object
    ? TOutput
    : never
  : never;

type ContractDefaultable<TContract> = TContract extends {
  readonly [pluginConfigTypes]: {
    readonly defaultable: infer TDefaultable;
  };
}
  ? TDefaultable extends boolean
    ? TDefaultable
    : false
  : false;

export interface DefinedPluginPageOptions<TConfig extends object> {
  readonly page: FrameworkPageView;
  readonly options: DeepReadonly<TConfig>;
}

type ResolvedContractOptions<TContract> =
  TContract extends AnyPluginConfigContract
    ? DeepReadonly<ContractOutput<TContract>>
    : undefined;

export interface DefinedPluginSetupContext<
  TApplication extends AnyPluginConfigContract | undefined,
  TBundlerCfg = DefaultBundlerConfig,
> extends PluginContext<TBundlerCfg> {
  /** Resolved Application options passed to the plugin factory. */
  readonly options: ResolvedContractOptions<TApplication>;
}

export interface DefinedPluginConfigContext<
  TApplication extends AnyPluginConfigContract | undefined,
> extends PluginConfigContext {
  /** Authored Application options resolved with defaults and validation. */
  readonly options: ResolvedContractOptions<TApplication>;
}

export interface DefinedPluginContributionContext<
  TApplication extends AnyPluginConfigContract | undefined,
  TPage extends AnyPluginConfigContract | undefined,
  TBundlerCfg = DefaultBundlerConfig,
> extends ContributionContext<TBundlerCfg> {
  /** Resolved Application options passed to the plugin factory. */
  readonly options: ResolvedContractOptions<TApplication>;
  /** Pages whose plugin behavior is enabled, with resolved Page options. */
  readonly pages: readonly DefinedPluginPageOptions<ContractOutput<TPage>>[];
}

export interface DefinedPluginPageContributionContext<
  TApplication extends AnyPluginConfigContract | undefined,
  TPage extends AnyPluginConfigContract | undefined,
  TBundlerCfg = DefaultBundlerConfig,
> extends ContributionContext<TBundlerCfg> {
  readonly page: FrameworkPageView;
  /** Resolved Application options passed to the plugin factory. */
  readonly options: ResolvedContractOptions<TApplication>;
  /** Resolved options for this enabled Page. */
  readonly pageOptions: DeepReadonly<ContractOutput<TPage>>;
}

type DefinedPluginConfigHook<
  TApplication extends AnyPluginConfigContract | undefined,
  TBundlerCfg,
> = <TActualBundlerCfg extends TBundlerCfg = TBundlerCfg>(
  config: Config<TActualBundlerCfg>,
  context: DefinedPluginConfigContext<TApplication>,
) =>
  | Config<TActualBundlerCfg>
  | undefined
  | void
  | Promise<Config<TActualBundlerCfg> | undefined>
  | Promise<void>;

type DefinedPluginSetupResult<TBundlerCfg> =
  | PluginHooks<TBundlerCfg>
  | undefined
  | void
  | Promise<PluginHooks<TBundlerCfg> | undefined>
  | Promise<void>;

type DefinedPluginSetupHook<
  TApplication extends AnyPluginConfigContract | undefined,
  TBundlerCfg,
> = <TActualBundlerCfg extends TBundlerCfg = TBundlerCfg>(
  context: DefinedPluginSetupContext<TApplication, TActualBundlerCfg>,
) => DefinedPluginSetupResult<TBundlerCfg>;

type DefinedPluginContributionsHook<
  TApplication extends AnyPluginConfigContract | undefined,
  TPage extends AnyPluginConfigContract | undefined,
  TBundlerCfg,
> = <TActualBundlerCfg extends TBundlerCfg = TBundlerCfg>(
  context: DefinedPluginContributionContext<
    TApplication,
    TPage,
    TActualBundlerCfg
  >,
) => MaybePromise<void>;

type DefinedPluginPageContributionHook<
  TApplication extends AnyPluginConfigContract | undefined,
  TPage extends AnyPluginConfigContract | undefined,
  TBundlerCfg,
> = <TActualBundlerCfg extends TBundlerCfg = TBundlerCfg>(
  context: DefinedPluginPageContributionContext<
    TApplication,
    TPage,
    TActualBundlerCfg
  >,
) => MaybePromise<void>;

export interface DefinedPluginDescriptor<
  TId extends string,
  TKey extends string | undefined,
  TApplication extends AnyPluginConfigContract | undefined,
  TPage extends AnyPluginConfigContract | undefined,
  TBundlerCfg = unknown,
> {
  /** Stable dependency and lifecycle identity, normally the package name. */
  readonly id: TId;
  /** Short page.config key. Required only when Page configuration is declared. */
  readonly key?: TKey;
  /** Application factory configuration. Independent from Page configuration. */
  readonly application?: TApplication;
  /** Page-level configuration. Independent from Application configuration. */
  readonly page?: TPage;
  readonly dependencies?: readonly string[];
  readonly optionalDependencies?: readonly string[];
  readonly enforce?: "pre" | "normal" | "post";
  readonly config?: DefinedPluginConfigHook<TApplication, TBundlerCfg>;
  readonly setup?: DefinedPluginSetupHook<TApplication, TBundlerCfg>;
  /** Declare contributions shared by every enabled owner. */
  readonly contributions?: DefinedPluginContributionsHook<
    TApplication,
    TPage,
    TBundlerCfg
  >;
  /** Declare contributions for one enabled Page. */
  readonly contributePage?: DefinedPluginPageContributionHook<
    TApplication,
    TPage,
    TBundlerCfg
  >;
}

interface DefinedPluginTypeContract<
  TApplicationInput extends object,
  TApplicationOutput extends object,
  TPageInput extends object,
  TPageOutput extends object,
  TPageDefaultable extends boolean,
> {
  readonly applicationInput: TApplicationInput;
  readonly applicationOutput: TApplicationOutput;
  readonly pageInput: TPageInput;
  readonly pageOutput: TPageOutput;
  readonly pageDefaultable: TPageDefaultable;
}

export type DefinedPluginInstance<
  TId extends string = string,
  TKey extends string | undefined = string | undefined,
  TApplicationInput extends object = object,
  TApplicationOutput extends object = object,
  TPageInput extends object = object,
  TPageOutput extends object = object,
  TPageDefaultable extends boolean = boolean,
  TBundlerCfg = unknown,
> = Plugin<TBundlerCfg> & {
  readonly id: TId;
  readonly [definedPluginContract]: DefinedPluginTypeContract<
    TApplicationInput,
    TApplicationOutput,
    TPageInput,
    TPageOutput,
    TPageDefaultable
  >;
} & (TKey extends string ? { readonly key: TKey } : { readonly key?: never });

export type DefinedPluginApplicationInput<TPlugin> = TPlugin extends {
  readonly [definedPluginContract]: DefinedPluginTypeContract<
    infer TInput,
    object,
    object,
    object,
    boolean
  >;
}
  ? TInput
  : never;

export type DefinedPluginPageInput<TPlugin> = TPlugin extends {
  readonly [definedPluginContract]: DefinedPluginTypeContract<
    object,
    object,
    infer TInput,
    object,
    boolean
  >;
}
  ? TInput
  : never;

export type DefinedPluginPageDefaultable<TPlugin> = TPlugin extends {
  readonly [definedPluginContract]: DefinedPluginTypeContract<
    object,
    object,
    object,
    object,
    infer TDefaultable
  >;
}
  ? TDefaultable
  : false;

type FactoryArgs<TContract> = TContract extends AnyPluginConfigContract
  ? ContractDefaultable<TContract> extends true
    ? [config?: ContractInput<TContract>]
    : [config: ContractInput<TContract>]
  : [];

type DefinedPluginFactoryInstance<
  TId extends string,
  TKey extends string | undefined,
  TApplication extends AnyPluginConfigContract | undefined,
  TPage extends AnyPluginConfigContract | undefined,
  TBundlerCfg = unknown,
> = DefinedPluginInstance<
  TId,
  TKey,
  ContractInput<TApplication>,
  ContractOutput<TApplication>,
  ContractInput<TPage>,
  ContractOutput<TPage>,
  ContractDefaultable<TPage>,
  TBundlerCfg
>;

export type DefinedPluginFactory<
  TId extends string,
  TKey extends string | undefined,
  TApplication extends AnyPluginConfigContract | undefined,
  TPage extends AnyPluginConfigContract | undefined,
  TBundlerCfg = unknown,
> = ((
  ...args: FactoryArgs<TApplication>
) => DefinedPluginFactoryInstance<
  TId,
  TKey,
  TApplication,
  TPage,
  TBundlerCfg
>) &
  (TPage extends AnyPluginConfigContract
    ? ContractDefaultable<TPage> extends true
      ? {
          /** Install the plugin while requiring Pages to opt in explicitly. */
          forPages(
            ...args: FactoryArgs<TApplication>
          ): DefinedPluginFactoryInstance<
            TId,
            TKey,
            TApplication,
            TPage,
            TBundlerCfg
          >;
        }
      : object
    : object);

interface RuntimePluginSetting {
  readonly enabled: boolean;
  readonly config?: object;
}

interface DefinedPluginRuntime {
  readonly id: string;
  readonly key?: string;
  readonly settingsKey: string;
  readonly application?: AnyPluginConfigContract;
  readonly page?: AnyPluginConfigContract;
  readonly applicationConfigured: unknown;
  readonly pagesByDefault: boolean;
  applicationSetting?: RuntimePluginSetting;
  applicationSettingPrepared: boolean;
}

const DEFINED_PLUGIN_RUNTIME = Symbol.for("@evjs/ev/defined-plugin-runtime");

type DefinedPluginRuntimeCarrier = object & {
  readonly [DEFINED_PLUGIN_RUNTIME]?: DefinedPluginRuntime;
};

/**
 * Define a bundler-agnostic typed plugin factory from one owner-aware
 * descriptor.
 *
 * Pass all five type arguments to the overload below only when a plugin
 * intentionally depends on one bundler's config shape.
 */
export function definePlugin<
  const TId extends string,
  const TKey extends string | undefined = undefined,
  const TApplication extends AnyPluginConfigContract | undefined = undefined,
  const TPage extends AnyPluginConfigContract | undefined = undefined,
>(
  descriptor: DefinedPluginDescriptor<TId, TKey, TApplication, TPage> &
    (TPage extends AnyPluginConfigContract
      ? { readonly key: Exclude<TKey, undefined> }
      : { readonly key?: never }),
): DefinedPluginFactory<TId, TKey, TApplication, TPage>;
/** Define a plugin factory tied to one explicit bundler config shape. */
export function definePlugin<
  const TId extends string,
  const TKey extends string | undefined,
  const TApplication extends AnyPluginConfigContract | undefined,
  const TPage extends AnyPluginConfigContract | undefined,
  TBundlerCfg,
>(
  descriptor: DefinedPluginDescriptor<
    TId,
    TKey,
    TApplication,
    TPage,
    TBundlerCfg
  > &
    (TPage extends AnyPluginConfigContract
      ? { readonly key: Exclude<TKey, undefined> }
      : { readonly key?: never }),
): DefinedPluginFactory<TId, TKey, TApplication, TPage, TBundlerCfg>;
export function definePlugin<
  const TId extends string,
  const TKey extends string | undefined = undefined,
  const TApplication extends AnyPluginConfigContract | undefined = undefined,
  const TPage extends AnyPluginConfigContract | undefined = undefined,
  TBundlerCfg = unknown,
>(
  descriptor: DefinedPluginDescriptor<
    TId,
    TKey,
    TApplication,
    TPage,
    TBundlerCfg
  > &
    (TPage extends AnyPluginConfigContract
      ? { readonly key: Exclude<TKey, undefined> }
      : { readonly key?: never }),
): DefinedPluginFactory<TId, TKey, TApplication, TPage, TBundlerCfg> {
  assertDefinedPluginDescriptor(descriptor);

  const create = (
    installMode: "all" | "pages",
    args: readonly unknown[],
  ): DefinedPluginFactoryInstance<
    TId,
    TKey,
    TApplication,
    TPage,
    TBundlerCfg
  > => {
    const application = descriptor.application;
    if (!application && args.length > 0) {
      throw new Error(
        `[evjs] Plugin "${descriptor.id}" does not declare Application configuration.`,
      );
    }
    if (args.length > 1) {
      throw new Error(
        `[evjs] Plugin "${descriptor.id}" accepts at most one Application configuration object.`,
      );
    }
    if (application && !application.defaultable && args.length === 0) {
      throw new Error(
        `[evjs] Plugin "${descriptor.id}" requires Application configuration.`,
      );
    }

    const settingsKey =
      descriptor.key ?? deriveApplicationPluginKey(descriptor.id);
    const runtime: DefinedPluginRuntime = {
      id: descriptor.id,
      ...(descriptor.key ? { key: descriptor.key } : {}),
      settingsKey,
      ...(application ? { application } : {}),
      ...(descriptor.page ? { page: descriptor.page } : {}),
      applicationConfigured: args[0],
      pagesByDefault: installMode === "all",
      applicationSettingPrepared: false,
    };
    const plugin: Plugin<TBundlerCfg> = {
      name: descriptor.id,
      id: descriptor.id,
      ...(descriptor.key ? { key: descriptor.key } : {}),
      ...(descriptor.dependencies
        ? { dependencies: [...descriptor.dependencies] }
        : {}),
      ...(descriptor.optionalDependencies
        ? { optionalDependencies: [...descriptor.optionalDependencies] }
        : {}),
      ...(descriptor.enforce ? { enforce: descriptor.enforce } : {}),
      ...(descriptor.config
        ? {
            config: (config, context) =>
              descriptor.config?.(config, {
                ...context,
                options: resolveConfigHookApplicationSetting(
                  runtime,
                  createPluginApplicationSettingContext(config),
                ).config as ResolvedContractOptions<TApplication>,
              }),
          }
        : {}),
      ...(descriptor.setup
        ? {
            setup: (context) =>
              descriptor.setup?.({
                ...context,
                options: getRuntimeApplicationSetting(runtime)
                  .config as ResolvedContractOptions<TApplication>,
              }),
          }
        : {}),
      ...(descriptor.contributions || descriptor.contributePage
        ? {
            contributions: async (context) => {
              const options = getRuntimeApplicationSetting(runtime)
                .config as ResolvedContractOptions<TApplication>;
              const pages = readPageOptions(
                context,
                runtime,
              ) as unknown as DefinedPluginPageOptions<ContractOutput<TPage>>[];
              if (descriptor.contributions) {
                await descriptor.contributions({
                  ...context,
                  options,
                  pages,
                });
              }
              if (descriptor.contributePage) {
                for (const page of pages) {
                  await descriptor.contributePage({
                    ...context,
                    page: page.page,
                    options,
                    pageOptions: page.options,
                  });
                }
              }
            },
          }
        : {}),
    };
    attachDefinedPluginRuntime(plugin, runtime);
    return plugin as DefinedPluginFactoryInstance<
      TId,
      TKey,
      TApplication,
      TPage,
      TBundlerCfg
    >;
  };

  const factory = ((...args: readonly unknown[]) =>
    create("all", args)) as unknown as DefinedPluginFactory<
    TId,
    TKey,
    TApplication,
    TPage,
    TBundlerCfg
  >;
  if (descriptor.page?.defaultable) {
    Object.defineProperty(factory, "forPages", {
      configurable: false,
      enumerable: true,
      value: (...args: readonly unknown[]) => create("pages", args),
      writable: false,
    });
  }
  return factory;
}

export interface DefinedPluginDeclaration {
  readonly id: string;
  readonly key?: string;
  readonly settingsKey: string;
  readonly application?: {
    readonly schemaVersion?: string;
    readonly defaultable: boolean;
  };
  readonly page?: {
    readonly schemaVersion?: string;
    readonly defaultable: boolean;
  };
}

export function getDefinedPluginDeclaration(
  plugin: object,
): DefinedPluginDeclaration | undefined {
  const runtime = getDefinedPluginRuntime(plugin);
  if (!runtime) return undefined;
  return {
    id: runtime.id,
    ...(runtime.key ? { key: runtime.key } : {}),
    settingsKey: runtime.settingsKey,
    ...(runtime.application
      ? {
          application: {
            defaultable: runtime.application.defaultable,
            ...(runtime.application.schemaVersion
              ? { schemaVersion: runtime.application.schemaVersion }
              : {}),
          },
        }
      : {}),
    ...(runtime.page
      ? {
          page: {
            defaultable: runtime.page.defaultable,
            ...(runtime.page.schemaVersion
              ? { schemaVersion: runtime.page.schemaVersion }
              : {}),
          },
        }
      : {}),
  };
}

export function copyDefinedPluginRuntime(source: object, target: object): void {
  const runtime = getDefinedPluginRuntime(source);
  if (runtime) attachDefinedPluginRuntime(target, runtime);
}

/** @internal Snapshot the mutable Application cache shared by resolved plugin copies. */
export function createDefinedPluginApplicationSettingSnapshot(
  plugins: readonly object[],
): { commit(): void; restore(): void } {
  const snapshots = new Map<
    DefinedPluginRuntime,
    {
      readonly setting: RuntimePluginSetting | undefined;
      readonly prepared: boolean;
    }
  >();
  for (const plugin of plugins) {
    const runtime = getDefinedPluginRuntime(plugin);
    if (!runtime || snapshots.has(runtime)) continue;
    snapshots.set(runtime, {
      setting: runtime.applicationSetting,
      prepared: runtime.applicationSettingPrepared,
    });
  }

  let settled = false;
  return Object.freeze({
    commit() {
      settled = true;
    },
    restore() {
      if (settled) return;
      settled = true;
      for (const [runtime, snapshot] of snapshots) {
        runtime.applicationSetting = snapshot.setting;
        runtime.applicationSettingPrepared = snapshot.prepared;
      }
    },
  });
}

/** @internal Allow config isolation to preserve only the framework runtime marker. */
export function isDefinedPluginRuntimePropertyKey(key: PropertyKey): boolean {
  return key === DEFINED_PLUGIN_RUNTIME;
}

function getDefinedPluginRuntime(
  plugin: object,
): DefinedPluginRuntime | undefined {
  return (plugin as DefinedPluginRuntimeCarrier)[DEFINED_PLUGIN_RUNTIME];
}

function attachDefinedPluginRuntime(
  plugin: object,
  runtime: DefinedPluginRuntime,
): void {
  Object.defineProperty(plugin, DEFINED_PLUGIN_RUNTIME, {
    configurable: false,
    enumerable: false,
    value: runtime,
    writable: false,
  });
}

export function resolveDefinedPluginApplicationSetting(
  plugin: object,
  context: PluginSettingContext,
  options: { readonly reusePrepared?: boolean } = {},
): RuntimePluginSetting | undefined {
  const runtime = getDefinedPluginRuntime(plugin);
  if (!runtime) return undefined;
  if (
    options.reusePrepared === true &&
    runtime.applicationSettingPrepared === true &&
    runtime.applicationSetting
  ) {
    return runtime.applicationSetting;
  }
  return resolveRuntimeApplicationSetting(runtime, context);
}

/** @internal Resolve one build-scoped Application snapshot before config hooks. */
export function prepareDefinedPluginApplicationSetting(
  plugin: object,
  context: PluginSettingContext,
): void {
  const runtime = getDefinedPluginRuntime(plugin);
  if (!runtime) return;
  resolveRuntimeApplicationSetting(runtime, context);
  runtime.applicationSettingPrepared = true;
}

function resolveConfigHookApplicationSetting(
  runtime: DefinedPluginRuntime,
  context: PluginSettingContext,
): RuntimePluginSetting {
  if (
    runtime.applicationSettingPrepared === true &&
    runtime.applicationSetting
  ) {
    return runtime.applicationSetting;
  }
  return resolveRuntimeApplicationSetting(runtime, context);
}

function resolveRuntimeApplicationSetting(
  runtime: DefinedPluginRuntime,
  context: PluginSettingContext,
): RuntimePluginSetting {
  runtime.applicationSettingPrepared = false;
  let config: object | undefined;
  if (runtime.application) {
    if (
      runtime.applicationConfigured !== undefined ||
      runtime.application.defaultable
    ) {
      config = resolvePluginContract(
        runtime.application,
        runtime.applicationConfigured,
        context,
        `${runtime.id} Application config`,
        false,
      );
    } else {
      throw new Error(
        `[evjs] Plugin "${runtime.id}" requires Application configuration.`,
      );
    }
  }
  const setting = Object.freeze({
    enabled: true,
    ...(config ? { config } : {}),
  });
  runtime.applicationSetting = setting;
  return setting;
}

export function resolveDefinedPluginPageSetting(
  plugin: object,
  configured: ResolvedPagePluginConfigInput | undefined,
  context: PluginSettingContext,
): RuntimePluginSetting | undefined {
  const runtime = getDefinedPluginRuntime(plugin);
  if (!runtime) return undefined;
  if (!runtime.page) {
    if (configured !== undefined) {
      throw new Error(
        `[evjs] Plugin "${runtime.id}" does not declare Page configuration.`,
      );
    }
    return undefined;
  }

  if (configured === false) return Object.freeze({ enabled: false });
  if (
    configured === undefined &&
    (!runtime.pagesByDefault || !runtime.page.defaultable)
  ) {
    return Object.freeze({ enabled: false });
  }
  if (configured === true && !runtime.page.defaultable) {
    throw new Error(
      `[evjs] ${context.configSource ?? context.pageId ?? "Page"} enables plugin "${runtime.key ?? runtime.id}" with true, but the plugin has no Page defaults. Configure an object instead.`,
    );
  }

  const config = resolvePluginContract(
    runtime.page,
    typeof configured === "object" ? configured : undefined,
    context,
    `${runtime.id} Page config`,
    true,
  );
  return Object.freeze({ enabled: true, config });
}

function resolvePluginContract(
  contract: AnyPluginConfigContract,
  configured: unknown,
  context: PluginSettingContext,
  source: string,
  staticOnly: boolean,
): object {
  const defaults = contract.defaults as
    | object
    | ((context: PluginSettingContext) => object)
    | undefined;
  const schema = contract.schema as StandardSchemaV1 | undefined;
  const validate = contract.validate as
    | ((
        value: object,
        context: PluginSettingContext,
      ) => undefined | boolean | string)
    | undefined;
  let value = configured;
  const resolvedDefaults =
    typeof defaults === "function" ? defaults(context) : defaults;
  if (value === undefined) {
    if (resolvedDefaults === undefined) {
      throw new Error(`[evjs] ${source} requires a configuration object.`);
    }
    value = resolvedDefaults;
  } else if (resolvedDefaults !== undefined) {
    value = mergePluginConfigDefaults(resolvedDefaults, value);
  }

  if (!staticOnly || schema) {
    // Standard Schema implementations may coerce their input in place. Give
    // them an isolated snapshot so validation cannot mutate authored values or
    // reusable defaults. Application values need the same isolation even when
    // no schema is present because their resolved snapshot is exposed later.
    value = clonePluginConfigObject(value, source);
  }

  if (schema) {
    const result = schema["~standard"].validate(value);
    if (isPromiseLike(result)) {
      throw new Error(
        `[evjs] ${source} schema must validate synchronously during graph analysis.`,
      );
    }
    if (result.issues) {
      const details = result.issues
        .map((issue) => formatSchemaIssue(issue))
        .join("; ");
      throw new Error(`[evjs] ${source} is invalid: ${details}`);
    }
    value = result.value;
  }

  const resolved = staticOnly
    ? resolveStaticConfigObject(value, source)
    : deepFreezeApplicationConfigObject(
        schema ? clonePluginConfigObject(value, source) : value,
      );
  const validation = validate?.(resolved, context);
  if (validation === false) {
    throw new Error(`[evjs] ${source} was rejected by the plugin.`);
  }
  if (typeof validation === "string") {
    throw new Error(`[evjs] ${source} is invalid: ${validation}`);
  }
  return resolved;
}

function getRuntimeApplicationSetting(
  runtime: DefinedPluginRuntime,
): RuntimePluginSetting {
  if (!runtime.applicationSetting) {
    throw new Error(
      `[evjs] Plugin "${runtime.id}" Application settings were not resolved before setup().`,
    );
  }
  return runtime.applicationSetting;
}

function readPageOptions<TBundlerCfg>(
  context: ContributionContext<TBundlerCfg>,
  runtime: DefinedPluginRuntime,
): DefinedPluginPageOptions<StaticConfigObject>[] {
  const pages: DefinedPluginPageOptions<StaticConfigObject>[] = [];
  for (const page of context.framework.pages) {
    const setting = runtime.key ? page.plugins[runtime.key] : undefined;
    if (!setting?.enabled) continue;
    if (!setting.config) {
      throw new Error(
        `[evjs] Internal invariant: enabled Page plugin "${runtime.id}" has no resolved options.`,
      );
    }
    pages.push({
      page,
      options: setting.config as StaticConfigObject,
    });
  }
  return pages;
}

function assertDefinedPluginDescriptor<TBundlerCfg>(
  descriptor: DefinedPluginDescriptor<
    string,
    string,
    AnyPluginConfigContract | undefined,
    AnyPluginConfigContract | undefined,
    TBundlerCfg
  >,
): void {
  if (!isPlainRecord(descriptor)) {
    throw new Error("[evjs] definePlugin() expects a plain descriptor object.");
  }
  assertOnlyKeys(
    descriptor,
    [
      "id",
      "key",
      "application",
      "page",
      "dependencies",
      "optionalDependencies",
      "enforce",
      "config",
      "setup",
      "contributions",
      "contributePage",
    ],
    "definePlugin() descriptor",
  );
  if (
    typeof descriptor.id !== "string" ||
    descriptor.id.length === 0 ||
    descriptor.id !== descriptor.id.trim()
  ) {
    throw new Error(
      "[evjs] definePlugin() id must be a non-empty string without surrounding whitespace.",
    );
  }
  if (descriptor.page && descriptor.key === undefined) {
    throw new Error(
      "[evjs] definePlugin() key is required when Page configuration is declared.",
    );
  }
  if (!descriptor.page && descriptor.key !== undefined) {
    throw new Error(
      "[evjs] definePlugin() key is only supported when Page configuration is declared.",
    );
  }
  if (descriptor.key !== undefined) {
    assertPluginKey(descriptor.key, "definePlugin() key");
  }
  const dependencies = assertPluginDependencyNames(
    descriptor.dependencies,
    "definePlugin() dependencies",
  );
  const optionalDependencies = assertPluginDependencyNames(
    descriptor.optionalDependencies,
    "definePlugin() optionalDependencies",
  );
  const requiredDependencies = new Set(dependencies);
  const overlappingDependency = optionalDependencies.find((dependency) =>
    requiredDependencies.has(dependency),
  );
  if (overlappingDependency !== undefined) {
    throw new Error(
      `[evjs] definePlugin() optionalDependencies must not repeat required dependency "${overlappingDependency}".`,
    );
  }
  if (
    descriptor.enforce !== undefined &&
    descriptor.enforce !== "pre" &&
    descriptor.enforce !== "normal" &&
    descriptor.enforce !== "post"
  ) {
    throw new Error(
      '[evjs] definePlugin() enforce must be "pre", "normal", or "post".',
    );
  }
  for (const field of [
    "config",
    "setup",
    "contributions",
    "contributePage",
  ] as const) {
    if (
      descriptor[field] !== undefined &&
      typeof descriptor[field] !== "function"
    ) {
      throw new Error(`[evjs] definePlugin() ${field} must be a function.`);
    }
  }
  for (const owner of ["application", "page"] as const) {
    const contract = descriptor[owner];
    if (contract !== undefined && contract[PLUGIN_CONFIG_CONTRACT] !== true) {
      throw new Error(
        `[evjs] definePlugin() ${owner} must be declared with pluginConfig().`,
      );
    }
  }
  if (!descriptor.page && descriptor.contributePage) {
    throw new Error(
      "[evjs] definePlugin() contributePage requires Page configuration.",
    );
  }
}

function assertPluginDependencyNames(
  value: unknown,
  source: string,
): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`[evjs] ${source} must be an array of plugin names.`);
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const [index, name] of value.entries()) {
    if (typeof name !== "string" || name.length === 0 || name !== name.trim()) {
      throw new Error(
        `[evjs] ${source}[${index}] must be a non-empty string without surrounding whitespace.`,
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `[evjs] ${source} must not contain duplicate plugin name "${name}".`,
      );
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** @internal Create the shared Application owner context for one config pass. */
export function createPluginApplicationSettingContext(
  config: { readonly routing?: { readonly mode?: "spa" | "mpa" } } | undefined,
): PluginSettingContext {
  return Object.freeze({
    owner: "application",
    applicationId: "default",
    applicationRoot: ".",
    routingMode: config?.routing?.mode ?? "spa",
  });
}

function deriveApplicationPluginKey(id: string): string {
  const normalized = id
    .toLowerCase()
    .replace(/^@/, "")
    .split("/")
    .map((segment) => segment.replace(/^plugin-/, ""))
    .join("-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const key = /^[a-z]/.test(normalized)
    ? normalized
    : `plugin${normalized ? `-${normalized}` : ""}`;
  assertPluginKey(key, `Application plugin "${id}" internal key`);
  return key;
}

function mergePluginConfigDefaults(
  defaults: object,
  configured: unknown,
): unknown {
  if (!isPlainRecord(defaults) || !isPlainRecord(configured)) {
    return configured;
  }

  const merged = Object.create(
    Object.getPrototypeOf(defaults) === null ? null : Object.prototype,
  ) as Record<PropertyKey, unknown>;
  copyOwnProperties(defaults, merged);
  for (const key of Reflect.ownKeys(configured)) {
    const configuredDescriptor = Object.getOwnPropertyDescriptor(
      configured,
      key,
    );
    if (!configuredDescriptor) continue;
    // Optional TypeScript properties admit explicit undefined in projects that
    // do not use exactOptionalPropertyTypes. Treat it as omission so a required
    // default cannot disappear at runtime.
    if (
      "value" in configuredDescriptor &&
      configuredDescriptor.value === undefined
    ) {
      continue;
    }
    const defaultDescriptor = Object.getOwnPropertyDescriptor(defaults, key);
    if (
      "value" in configuredDescriptor &&
      defaultDescriptor &&
      "value" in defaultDescriptor &&
      isPlainRecord(defaultDescriptor.value) &&
      isPlainRecord(configuredDescriptor.value)
    ) {
      Object.defineProperty(
        merged,
        key,
        normalizeConfigPropertyDescriptor({
          ...configuredDescriptor,
          value: mergePluginConfigDefaults(
            defaultDescriptor.value,
            configuredDescriptor.value,
          ),
        }),
      );
      continue;
    }
    Object.defineProperty(
      merged,
      key,
      normalizeConfigPropertyDescriptor(configuredDescriptor),
    );
  }
  return merged;
}

function copyOwnProperties(source: object, target: object): void {
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor) {
      Object.defineProperty(
        target,
        key,
        normalizeConfigPropertyDescriptor(descriptor),
      );
    }
  }
}

function normalizeConfigPropertyDescriptor(
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  if ("value" in descriptor) {
    return {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      value: descriptor.value,
      writable: true,
    };
  }
  return {
    configurable: true,
    enumerable: descriptor.enumerable ?? false,
    get: descriptor.get,
    set: descriptor.set,
  };
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (typeof value !== "object" || value === null) return false;
  const standard = (value as { readonly "~standard"?: unknown })["~standard"];
  return (
    !!standard &&
    typeof standard === "object" &&
    "validate" in standard &&
    typeof standard.validate === "function"
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertConfigObject(value: unknown, source: string): object {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`[evjs] ${source} must be an object.`);
  }
  return value;
}

function clonePluginConfigObject(value: unknown, source: string): object {
  return clonePluginConfigValue(
    assertConfigObject(value, source),
    new WeakMap(),
  ) as object;
}

function clonePluginConfigValue(
  value: unknown,
  seen: WeakMap<object, object>,
): unknown {
  if (!value || typeof value !== "object") return value;
  if (!Array.isArray(value) && !isPlainRecord(value)) return value;

  const existing = seen.get(value);
  if (existing) return existing;
  const clone: object = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value));
  seen.set(value, clone);

  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    Object.defineProperty(
      clone,
      key,
      "value" in descriptor
        ? {
            configurable: true,
            enumerable: descriptor.enumerable ?? false,
            value: clonePluginConfigValue(descriptor.value, seen),
            writable: true,
          }
        : {
            configurable: true,
            enumerable: descriptor.enumerable ?? false,
            get: descriptor.get,
            set: descriptor.set,
          },
    );
  }
  return clone;
}

function deepFreezeApplicationConfigObject(value: unknown): object {
  const objectValue = value as object;
  deepFreezeApplicationConfigValue(objectValue, new WeakSet());
  return objectValue;
}

function deepFreezeApplicationConfigValue(
  value: unknown,
  seen: WeakSet<object>,
): void {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value) && !isPlainRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) {
      deepFreezeApplicationConfigValue(descriptor.value, seen);
    }
  }
  Object.freeze(value);
}

function assertOnlyKeys(
  value: object,
  allowed: readonly string[],
  source: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new Error(
        `[evjs] ${source} contains unsupported field ${String(key)}.`,
      );
    }
  }
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function formatSchemaIssue(issue: StandardSchemaV1.Issue): string {
  if (!issue.path?.length) return issue.message;
  const path = issue.path
    .map((segment) =>
      typeof segment === "object" && segment !== null && "key" in segment
        ? String(segment.key)
        : String(segment),
    )
    .join(".");
  return `${path}: ${issue.message}`;
}
