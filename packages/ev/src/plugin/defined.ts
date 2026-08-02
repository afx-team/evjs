import { assertPluginId } from "@evjs/shared/manifest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { DefaultBundlerConfig } from "../config/index.js";
import type { ResolvedPagePluginOptionsInput } from "../config/plugins.js";
import {
  resolveStaticConfigObject,
  type StaticConfigObject,
} from "../config/static.js";
import type {
  FrameworkPageView,
  GeneratedModuleRef,
  Plugin,
  PluginConfigureContext,
  PluginConfigureInput,
  PluginContributeContext,
  PluginHooks,
  PluginSetupContext,
} from "./index.js";

declare const definedPluginContract: unique symbol;
declare const pluginOptionsTypes: unique symbol;
const PLUGIN_OPTIONS_CONTRACT = Symbol("evjs.plugin-options");

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

type ParsedNumber<TValue extends string> =
  TValue extends `${infer TNumber extends number}` ? TNumber : never;

type ParsedBigInt<TValue extends string> =
  TValue extends `${infer TBigInt extends bigint}` ? TBigInt : never;

type IsOpenNumberTemplate<TValue extends string> =
  number extends ParsedNumber<TValue>
    ? `${ParsedNumber<TValue>}` extends TValue
      ? true
      : false
    : false;

type IsOpenBigIntTemplate<TValue extends string> =
  bigint extends ParsedBigInt<TValue>
    ? `${ParsedBigInt<TValue>}` extends TValue
      ? true
      : false
    : false;

type HasOpenStringSegment<TValue extends string> = string extends TValue
  ? true
  : IsOpenNumberTemplate<TValue> extends true
    ? true
    : IsOpenBigIntTemplate<TValue> extends true
      ? true
      : TValue extends ""
        ? false
        : TValue extends `${infer TFirst}${infer TRest}`
          ? TRest extends ""
            ? false
            : HasOpenStringSegment<TFirst> extends true
              ? true
              : HasOpenStringSegment<TRest>
          : true;

/** @internal Keep only one complete, unbranded string literal. */
export type DefinitePluginId<TValue extends string> =
  IsUnion<TValue> extends true
    ? never
    : HasOpenStringSegment<TValue> extends true
      ? never
      : TValue;

type DefiniteContract<TContract> =
  IsUnion<TContract> extends true ? never : TContract;

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
          ? { [TKey in keyof TValue]?: DeepPartialProperty<TValue[TKey]> }
          : TValue;

interface PluginOptionsBaseContext {
  readonly applicationId: string;
  readonly applicationRoot: string;
  readonly routingMode: "spa" | "mpa";
}

export type PluginOptionsContext =
  | (PluginOptionsBaseContext & {
      readonly owner: "application";
    })
  | (PluginOptionsBaseContext & {
      readonly owner: "page";
      readonly pageId: string;
      readonly pageModule: string;
      readonly pageRoot?: string;
      readonly configSource?: string;
    });

type ApplicationPluginOptionsContext = Extract<
  PluginOptionsContext,
  { readonly owner: "application" }
>;
type PagePluginOptionsContext = Extract<
  PluginOptionsContext,
  { readonly owner: "page" }
>;

export interface PluginOptionsDefinition<TValue extends object> {
  /** Optional schema version recorded in the CoreGraph plugin catalog. */
  readonly schemaVersion?: string;
  /** Value used when the application/page explicitly enables this contract without an object. */
  readonly defaults?: TValue | ((context: PluginOptionsContext) => TValue);
  /** Return false/a message or throw to reject a resolved value. */
  readonly validate?: (
    value: DeepReadonly<TValue>,
    context: PluginOptionsContext,
  ) => undefined | boolean | string;
}

export interface PluginOptionsContract<
  TInput extends object = object,
  TOutput extends object = TInput,
  TDefaultable extends boolean = boolean,
> {
  readonly [PLUGIN_OPTIONS_CONTRACT]: true;
  readonly [pluginOptionsTypes]: {
    readonly input: TInput;
    readonly output: TOutput;
    readonly defaultable: TDefaultable;
  };
  readonly schemaVersion?: string;
  readonly defaultable: TDefaultable;
  readonly defaults?: TOutput | ((context: PluginOptionsContext) => TOutput);
  readonly schema?: StandardSchemaV1<TInput, TOutput>;
  readonly validate?: (
    value: DeepReadonly<TOutput>,
    context: PluginOptionsContext,
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

type RequiredPluginOptionsArgs<TValue extends object, TOptions> = [
  PlainConfigContractValue<TValue>,
] extends [never]
  ? [options: never]
  : [options: TOptions];

type OptionalPluginOptionsArgs<TValue extends object, TOptions> = [
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
export function pluginOptions<TValue extends object>(
  ...args: RequiredPluginOptionsArgs<
    TValue,
    PluginOptionsDefinition<TValue> & {
      readonly defaults: TValue | ((context: PluginOptionsContext) => TValue);
    }
  >
): PluginOptionsContract<DeepPartial<TValue>, TValue, true>;
export function pluginOptions<TValue extends object>(
  ...args: OptionalPluginOptionsArgs<
    TValue,
    PluginOptionsDefinition<TValue> & { readonly defaults?: undefined }
  >
): PluginOptionsContract<TValue, TValue, false>;
export function pluginOptions<const TSchema extends StandardSchemaV1>(
  schema: ValidConfigSchema<TSchema>,
  options: Omit<PluginOptionsDefinition<SchemaOutput<TSchema>>, "defaults"> & {
    readonly defaults:
      | SchemaInput<TSchema>
      | ((context: PluginOptionsContext) => SchemaInput<TSchema>);
  },
): PluginOptionsContract<
  DeepPartial<SchemaInput<TSchema>>,
  SchemaOutput<TSchema>,
  true
>;
export function pluginOptions<const TSchema extends StandardSchemaV1>(
  schema: ValidConfigSchema<TSchema>,
  options?: Omit<PluginOptionsDefinition<SchemaOutput<TSchema>>, "defaults"> & {
    readonly defaults?: undefined;
  },
): PluginOptionsContract<SchemaInput<TSchema>, SchemaOutput<TSchema>, false>;
export function pluginOptions(
  schemaOrOptions: unknown = {},
  maybeOptions: unknown = {},
): unknown {
  const schema = isStandardSchema(schemaOrOptions)
    ? schemaOrOptions
    : undefined;
  const options = schema ? maybeOptions : schemaOrOptions;
  if (!isPlainRecord(options)) {
    throw new Error("[evjs] pluginOptions() options must be a plain object.");
  }
  assertOnlyKeys(
    options,
    ["schemaVersion", "defaults", "validate"],
    "pluginOptions() options",
  );
  if (
    options.schemaVersion !== undefined &&
    (typeof options.schemaVersion !== "string" ||
      options.schemaVersion.length === 0 ||
      options.schemaVersion !== options.schemaVersion.trim())
  ) {
    throw new Error(
      "[evjs] pluginOptions() schemaVersion must be a non-empty string without surrounding whitespace.",
    );
  }
  if (
    options.defaults !== undefined &&
    typeof options.defaults !== "function"
  ) {
    assertConfigObject(options.defaults, "pluginOptions() defaults");
  }
  if (
    options.validate !== undefined &&
    typeof options.validate !== "function"
  ) {
    throw new Error("[evjs] pluginOptions() validate must be a function.");
  }
  return Object.freeze({
    [PLUGIN_OPTIONS_CONTRACT]: true,
    defaultable: options.defaults !== undefined,
    ...(schema ? { schema } : {}),
    ...(options.schemaVersion === undefined
      ? {}
      : { schemaVersion: options.schemaVersion }),
    ...(options.defaults === undefined ? {} : { defaults: options.defaults }),
    ...(options.validate === undefined ? {} : { validate: options.validate }),
  }) as PluginOptionsContract;
}

/** Structural constraint used by typed plugin factory declarations. */
interface AnyPluginOptionsContract {
  readonly [PLUGIN_OPTIONS_CONTRACT]: true;
  readonly schemaVersion?: string;
  readonly defaultable: boolean;
  readonly defaults?: unknown;
  readonly schema?: unknown;
  readonly validate?: unknown;
}

type ContractInput<TContract> =
  DefiniteContract<TContract> extends {
    readonly [pluginOptionsTypes]: { readonly input: infer TInput };
  }
    ? TInput extends object
      ? TInput
      : never
    : never;

type ContractOutput<TContract> =
  DefiniteContract<TContract> extends {
    readonly [pluginOptionsTypes]: { readonly output: infer TOutput };
  }
    ? TOutput extends object
      ? TOutput
      : never
    : never;

type ContractDefaultable<TContract> =
  DefiniteContract<TContract> extends {
    readonly [pluginOptionsTypes]: {
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

type ResolvedContractOptions<TContract> = [TContract] extends [undefined]
  ? undefined
  : DefiniteContract<TContract> extends AnyPluginOptionsContract
    ? DeepReadonly<ContractOutput<TContract>>
    : never;

export interface DefinedPluginSetupContext<
  TApplication extends AnyPluginOptionsContract | undefined,
  TBundlerCfg = DefaultBundlerConfig,
> extends PluginSetupContext<TBundlerCfg> {
  /** Resolved Application options passed to the plugin factory. */
  readonly options: ResolvedContractOptions<TApplication>;
}

export interface DefinedPluginConfigureContext<
  TApplication extends AnyPluginOptionsContract | undefined,
> extends PluginConfigureContext {
  /** Authored Application options resolved with defaults and validation. */
  readonly options: ResolvedContractOptions<TApplication>;
}

export interface DefinedPluginContributeContext<
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg = DefaultBundlerConfig,
> extends PluginContributeContext<TBundlerCfg> {
  /** Resolved Application options passed to the plugin factory. */
  readonly options: ResolvedContractOptions<TApplication>;
  /** Pages whose plugin behavior is enabled, with resolved Page options. */
  readonly pages: readonly DefinedPluginPageOptions<ContractOutput<TPage>>[];
}

export interface DefinedPluginPageContributeContext<
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg = DefaultBundlerConfig,
> extends PluginContributeContext<TBundlerCfg> {
  readonly page: FrameworkPageView;
  /** Resolved Application options passed to the plugin factory. */
  readonly options: ResolvedContractOptions<TApplication>;
  /** Resolved options for this enabled Page. */
  readonly pageOptions: DeepReadonly<ContractOutput<TPage>>;
}

type DefinedPluginConfigureHook<
  TApplication extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
> = <TActualBundlerCfg extends TBundlerCfg = TBundlerCfg>(
  config: PluginConfigureInput<TActualBundlerCfg>,
  context: DefinedPluginConfigureContext<TApplication>,
) =>
  | DefinedPluginConfigureOutput<TActualBundlerCfg>
  | undefined
  | void
  | Promise<DefinedPluginConfigureOutput<TActualBundlerCfg> | undefined>
  | Promise<void>;

type DefinedPluginConfigureOutput<TBundlerCfg> =
  PluginConfigureInput<TBundlerCfg> & {
    readonly plugins?: never;
  };

type DefinedPluginSetupResult<TBundlerCfg> =
  | PluginHooks<TBundlerCfg>
  | undefined
  | void
  | Promise<PluginHooks<TBundlerCfg> | undefined>
  | Promise<void>;

type DefinedPluginSetupHook<
  TApplication extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
> = <TActualBundlerCfg extends TBundlerCfg = TBundlerCfg>(
  context: DefinedPluginSetupContext<TApplication, TActualBundlerCfg>,
) => DefinedPluginSetupResult<TBundlerCfg>;

type DefinedPluginContributeHook<
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
> = <TActualBundlerCfg extends TBundlerCfg = TBundlerCfg>(
  context: DefinedPluginContributeContext<
    TApplication,
    TPage,
    TActualBundlerCfg
  >,
) => MaybePromise<void>;

type DefinedPluginPageContributeHook<
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
> = <TActualBundlerCfg extends TBundlerCfg = TBundlerCfg>(
  context: DefinedPluginPageContributeContext<
    TApplication,
    TPage,
    TActualBundlerCfg
  >,
) => MaybePromise<void>;

export interface DefinedPluginDescriptor<
  TId extends string,
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg = unknown,
> {
  /** Stable short identity shared by every plugin-owned framework surface. */
  readonly id: TId;
  /** Application factory configuration. Independent from Page configuration. */
  readonly application?: TApplication;
  /** Page-level configuration. Independent from Application configuration. */
  readonly page?: TPage;
  readonly dependencies?: readonly string[];
  readonly optionalDependencies?: readonly string[];
  readonly enforce?: "pre" | "normal" | "post";
  readonly configure?: DefinedPluginConfigureHook<TApplication, TBundlerCfg>;
  readonly setup?: DefinedPluginSetupHook<TApplication, TBundlerCfg>;
  /** Declare contributions shared by every enabled owner. */
  readonly contribute?: DefinedPluginContributeHook<
    TApplication,
    TPage,
    TBundlerCfg
  >;
  /** Declare contributions for one enabled Page. */
  readonly contributePage?: DefinedPluginPageContributeHook<
    TApplication,
    TPage,
    TBundlerCfg
  >;
}

type DefinedPluginContractField<
  TKey extends "application" | "page",
  TContract extends AnyPluginOptionsContract | undefined,
> = [TContract] extends [undefined]
  ? { readonly [TField in TKey]?: never }
  : DefiniteContract<TContract> extends AnyPluginOptionsContract
    ? boolean extends ContractDefaultable<DefiniteContract<TContract>>
      ? never
      : { readonly [TField in TKey]-?: DefiniteContract<TContract> }
    : never;

type DefinedPluginDescriptorInput<
  TId extends string,
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
> = DefinedPluginDescriptor<TId, TApplication, TPage, TBundlerCfg> & {
  readonly id: DefinitePluginId<TId>;
} & DefinedPluginContractField<"application", TApplication> &
  DefinedPluginContractField<"page", TPage>;

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

export type PluginInstance<
  TId extends string = string,
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
};

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

type FactoryArgs<TContract> =
  DefiniteContract<TContract> extends infer TDefinite
    ? [TDefinite] extends [AnyPluginOptionsContract]
      ? ContractDefaultable<TDefinite> extends true
        ? [options?: ContractInput<TDefinite>]
        : [options: ContractInput<TDefinite>]
      : [TContract] extends [undefined]
        ? []
        : [options: never]
    : [options: never];

type PluginFactoryInstance<
  TId extends string,
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg = unknown,
> = PluginInstance<
  TId,
  ContractInput<TApplication>,
  ContractOutput<TApplication>,
  ContractInput<TPage>,
  ContractOutput<TPage>,
  ContractDefaultable<TPage>,
  TBundlerCfg
>;

export type PluginFactory<
  TId extends string = string,
  TApplication extends AnyPluginOptionsContract | undefined = undefined,
  TPage extends AnyPluginOptionsContract | undefined = undefined,
  TBundlerCfg = unknown,
> = ((
  ...args: FactoryArgs<TApplication>
) => PluginFactoryInstance<TId, TApplication, TPage, TBundlerCfg>) &
  ([TPage] extends [AnyPluginOptionsContract]
    ? IsUnion<TPage> extends true
      ? object
      : ContractDefaultable<TPage> extends true
        ? {
            /** Install the plugin while requiring Pages to opt in explicitly. */
            forPages(
              ...args: FactoryArgs<TApplication>
            ): PluginFactoryInstance<TId, TApplication, TPage, TBundlerCfg>;
          }
        : object
    : object);

interface RuntimePluginSetting {
  readonly enabled: boolean;
  readonly options?: object;
}

interface DefinedPluginRuntime {
  readonly id: string;
  readonly application?: AnyPluginOptionsContract;
  readonly page?: AnyPluginOptionsContract;
  readonly applicationConfigured: unknown;
  readonly pagesByDefault: boolean;
}

interface DefinedPluginRuntimeCache {
  applicationSetting: RuntimePluginSetting | undefined;
  applicationSettingPrepared: boolean;
}

interface DefinedPluginRuntimeRegistry {
  readonly version: 2;
  readonly runtimeByPlugin: WeakMap<object, DefinedPluginRuntime>;
  readonly cacheByRuntime: WeakMap<
    DefinedPluginRuntime,
    DefinedPluginRuntimeCache
  >;
}

const DEFINED_PLUGIN_RUNTIME_REGISTRY = Symbol.for(
  "@evjs/ev/defined-plugin-runtime-registry/v2",
);
const definedPluginRuntimeRegistry = getDefinedPluginRuntimeRegistry();

/**
 * Define a bundler-agnostic typed plugin factory from one owner-aware
 * descriptor.
 *
 * Pass all four type arguments to the overload below only when a plugin
 * intentionally depends on one bundler's config shape.
 */
export function definePlugin<
  const TId extends string,
  const TApplication extends AnyPluginOptionsContract | undefined = undefined,
  const TPage extends AnyPluginOptionsContract | undefined = undefined,
>(
  descriptor: DefinedPluginDescriptorInput<TId, TApplication, TPage, unknown>,
): PluginFactory<TId, TApplication, TPage>;
/** Define a plugin factory tied to one explicit bundler config shape. */
export function definePlugin<
  const TId extends string,
  const TApplication extends AnyPluginOptionsContract | undefined,
  const TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
>(
  descriptor: DefinedPluginDescriptorInput<
    TId,
    TApplication,
    TPage,
    TBundlerCfg
  >,
): PluginFactory<TId, TApplication, TPage, TBundlerCfg>;
export function definePlugin<
  const TId extends string,
  const TApplication extends AnyPluginOptionsContract | undefined = undefined,
  const TPage extends AnyPluginOptionsContract | undefined = undefined,
  TBundlerCfg = unknown,
>(
  descriptor: DefinedPluginDescriptorInput<
    TId,
    TApplication,
    TPage,
    TBundlerCfg
  >,
): PluginFactory<TId, TApplication, TPage, TBundlerCfg> {
  const definition = snapshotDefinedPluginDescriptor(descriptor);
  assertDefinedPluginDescriptor(definition);

  const create = (
    installMode: "all" | "pages",
    args: readonly unknown[],
  ): PluginFactoryInstance<TId, TApplication, TPage, TBundlerCfg> => {
    const application = definition.application;
    if (!application && args.length > 0) {
      throw new Error(
        `[evjs] Plugin "${definition.id}" does not declare Application options.`,
      );
    }
    if (args.length > 1) {
      throw new Error(
        `[evjs] Plugin "${definition.id}" accepts at most one Application options object.`,
      );
    }
    if (application && !application.defaultable && args.length === 0) {
      throw new Error(
        `[evjs] Plugin "${definition.id}" requires Application options.`,
      );
    }

    const runtime = createDefinedPluginRuntime({
      id: definition.id,
      ...(application ? { application } : {}),
      ...(definition.page ? { page: definition.page } : {}),
      applicationConfigured: args[0],
      pagesByDefault: installMode === "all",
    });
    const plugin: Plugin<TBundlerCfg> = {
      id: definition.id,
      ...(definition.dependencies
        ? { dependencies: definition.dependencies }
        : {}),
      ...(definition.optionalDependencies
        ? { optionalDependencies: definition.optionalDependencies }
        : {}),
      ...(definition.enforce ? { enforce: definition.enforce } : {}),
      ...(definition.configure
        ? {
            configure: (config, context) =>
              definition.configure?.(config, {
                ...context,
                options: resolveConfigureHookApplicationSetting(
                  runtime,
                  createPluginApplicationSettingContext(config),
                ).options as ResolvedContractOptions<TApplication>,
              }),
          }
        : {}),
      ...(definition.setup
        ? {
            setup: (context) =>
              definition.setup?.({
                ...context,
                options: getRuntimeApplicationSetting(runtime)
                  .options as ResolvedContractOptions<TApplication>,
              }),
          }
        : {}),
      ...(definition.contribute || definition.contributePage
        ? {
            contribute: async (context) => {
              const options = getRuntimeApplicationSetting(runtime)
                .options as ResolvedContractOptions<TApplication>;
              const pages = readPageOptions(
                context,
                runtime,
              ) as unknown as DefinedPluginPageOptions<ContractOutput<TPage>>[];
              if (definition.contribute) {
                await definition.contribute({
                  ...context,
                  options,
                  pages,
                });
              }
              if (definition.contributePage) {
                for (const page of pages) {
                  await definition.contributePage({
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
    return plugin as PluginFactoryInstance<
      TId,
      TApplication,
      TPage,
      TBundlerCfg
    >;
  };

  const factory = ((...args: readonly unknown[]) =>
    create("all", args)) as unknown as PluginFactory<
    TId,
    TApplication,
    TPage,
    TBundlerCfg
  >;
  if (definition.page?.defaultable) {
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
    const cache = getDefinedPluginRuntimeCache(runtime);
    snapshots.set(runtime, {
      setting: cache.applicationSetting,
      prepared: cache.applicationSettingPrepared,
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
        const cache = getDefinedPluginRuntimeCache(runtime);
        cache.applicationSetting = snapshot.setting;
        cache.applicationSettingPrepared = snapshot.prepared;
      }
    },
  });
}

function getDefinedPluginRuntimeRegistry(): DefinedPluginRuntimeRegistry {
  const existing = Reflect.get(globalThis, DEFINED_PLUGIN_RUNTIME_REGISTRY) as
    | DefinedPluginRuntimeRegistry
    | undefined;
  if (existing !== undefined) {
    if (
      existing.version !== 2 ||
      !Object.isFrozen(existing) ||
      !(existing.runtimeByPlugin instanceof WeakMap) ||
      !(existing.cacheByRuntime instanceof WeakMap)
    ) {
      throw new Error(
        "[evjs] Defined plugin runtime registry v2 is incompatible.",
      );
    }
    return existing;
  }

  const registry: DefinedPluginRuntimeRegistry = Object.freeze({
    version: 2,
    runtimeByPlugin: new WeakMap<object, DefinedPluginRuntime>(),
    cacheByRuntime: new WeakMap<
      DefinedPluginRuntime,
      DefinedPluginRuntimeCache
    >(),
  });
  Object.defineProperty(globalThis, DEFINED_PLUGIN_RUNTIME_REGISTRY, {
    configurable: false,
    enumerable: false,
    value: registry,
    writable: false,
  });
  return registry;
}

function createDefinedPluginRuntime(definition: {
  readonly id: string;
  readonly application?: AnyPluginOptionsContract;
  readonly page?: AnyPluginOptionsContract;
  readonly applicationConfigured: unknown;
  readonly pagesByDefault: boolean;
}): DefinedPluginRuntime {
  const runtime: DefinedPluginRuntime = Object.freeze({
    id: definition.id,
    application: definition.application,
    page: definition.page,
    applicationConfigured: definition.applicationConfigured,
    pagesByDefault: definition.pagesByDefault,
  });
  definedPluginRuntimeRegistry.cacheByRuntime.set(runtime, {
    applicationSetting: undefined,
    applicationSettingPrepared: false,
  });
  return runtime;
}

function getDefinedPluginRuntimeCache(
  runtime: DefinedPluginRuntime,
): DefinedPluginRuntimeCache {
  const cache = definedPluginRuntimeRegistry.cacheByRuntime.get(runtime);
  if (!cache) {
    throw new Error("[evjs] Defined plugin runtime cache is unavailable.");
  }
  return cache;
}

function getDefinedPluginRuntime(
  plugin: object,
): DefinedPluginRuntime | undefined {
  const runtime = definedPluginRuntimeRegistry.runtimeByPlugin.get(plugin);
  if (!runtime) return undefined;
  const publicIdDescriptor = Object.getOwnPropertyDescriptor(plugin, "id");
  if (
    !Object.isFrozen(runtime) ||
    !definedPluginRuntimeRegistry.cacheByRuntime.has(runtime) ||
    !publicIdDescriptor ||
    !("value" in publicIdDescriptor) ||
    publicIdDescriptor.value !== runtime.id
  ) {
    throw new Error(
      `[evjs] Defined plugin runtime id "${runtime.id}" does not match its public plugin id.`,
    );
  }
  return runtime;
}

function attachDefinedPluginRuntime(
  plugin: object,
  runtime: DefinedPluginRuntime,
): void {
  const publicIdDescriptor = Object.getOwnPropertyDescriptor(plugin, "id");
  if (
    !Object.isFrozen(runtime) ||
    !definedPluginRuntimeRegistry.cacheByRuntime.has(runtime) ||
    !publicIdDescriptor ||
    !("value" in publicIdDescriptor) ||
    publicIdDescriptor.value !== runtime.id
  ) {
    throw new Error(
      `[evjs] Defined plugin runtime id "${runtime.id}" does not match its public plugin id.`,
    );
  }
  Object.defineProperty(plugin, "id", {
    configurable: false,
    enumerable: publicIdDescriptor.enumerable ?? true,
    value: runtime.id,
    writable: false,
  });
  definedPluginRuntimeRegistry.runtimeByPlugin.set(plugin, runtime);
}

export function resolveDefinedPluginApplicationSetting(
  plugin: object,
  context: PluginOptionsContext,
  options: { readonly reusePrepared?: boolean } = {},
): RuntimePluginSetting | undefined {
  const runtime = getDefinedPluginRuntime(plugin);
  if (!runtime) return undefined;
  const cache = getDefinedPluginRuntimeCache(runtime);
  if (
    options.reusePrepared === true &&
    cache.applicationSettingPrepared === true &&
    cache.applicationSetting
  ) {
    return cache.applicationSetting;
  }
  return resolveRuntimeApplicationSetting(runtime, context);
}

/** @internal Resolve one build-scoped Application snapshot before config hooks. */
export function prepareDefinedPluginApplicationSetting(
  plugin: object,
  context: PluginOptionsContext,
): void {
  const runtime = getDefinedPluginRuntime(plugin);
  if (!runtime) return;
  resolveRuntimeApplicationSetting(runtime, context);
  getDefinedPluginRuntimeCache(runtime).applicationSettingPrepared = true;
}

function resolveConfigureHookApplicationSetting(
  runtime: DefinedPluginRuntime,
  context: PluginOptionsContext,
): RuntimePluginSetting {
  const cache = getDefinedPluginRuntimeCache(runtime);
  if (cache.applicationSettingPrepared === true && cache.applicationSetting) {
    return cache.applicationSetting;
  }
  return resolveRuntimeApplicationSetting(runtime, context);
}

function resolveRuntimeApplicationSetting(
  runtime: DefinedPluginRuntime,
  context: PluginOptionsContext,
): RuntimePluginSetting {
  const cache = getDefinedPluginRuntimeCache(runtime);
  cache.applicationSettingPrepared = false;
  let options: object | undefined;
  if (runtime.application) {
    if (
      runtime.applicationConfigured !== undefined ||
      runtime.application.defaultable
    ) {
      options = resolvePluginOptionsContract(
        runtime.application,
        runtime.applicationConfigured,
        context,
        `${runtime.id} Application options`,
        false,
      );
    } else {
      throw new Error(
        `[evjs] Plugin "${runtime.id}" requires Application options.`,
      );
    }
  }
  const setting = Object.freeze({
    enabled: true,
    ...(options ? { options } : {}),
  });
  cache.applicationSetting = setting;
  return setting;
}

export function resolveDefinedPluginPageSetting(
  plugin: object,
  configured: ResolvedPagePluginOptionsInput | undefined,
  context: PagePluginOptionsContext,
): RuntimePluginSetting | undefined {
  const runtime = getDefinedPluginRuntime(plugin);
  if (!runtime) return undefined;
  if (!runtime.page) {
    if (configured !== undefined) {
      throw new Error(
        `[evjs] Plugin "${runtime.id}" does not declare Page options.`,
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
      `[evjs] ${context.configSource ?? context.pageId ?? "Page"} enables plugin "${runtime.id}" with true, but the plugin has no Page defaults. Configure an object instead.`,
    );
  }

  const options = resolvePluginOptionsContract(
    runtime.page,
    typeof configured === "object" ? configured : undefined,
    context,
    `${runtime.id} Page options`,
    true,
  );
  return Object.freeze({ enabled: true, options });
}

function resolvePluginOptionsContract(
  contract: AnyPluginOptionsContract,
  configured: unknown,
  context: PluginOptionsContext,
  source: string,
  staticOnly: boolean,
): object {
  const defaults = contract.defaults as
    | object
    | ((context: PluginOptionsContext) => object)
    | undefined;
  const schema = contract.schema as StandardSchemaV1 | undefined;
  const validate = contract.validate as
    | ((
        value: object,
        context: PluginOptionsContext,
      ) => undefined | boolean | string)
    | undefined;
  let value = configured;
  const resolvedDefaults =
    typeof defaults === "function" ? defaults(context) : defaults;
  if (value === undefined) {
    if (resolvedDefaults === undefined) {
      throw new Error(`[evjs] ${source} requires an options object.`);
    }
    value = resolvedDefaults;
  } else if (resolvedDefaults !== undefined) {
    value = mergePluginOptionsDefaults(resolvedDefaults, value);
  }

  if (!staticOnly || schema) {
    // Standard Schema implementations may coerce their input in place. Give
    // them an isolated snapshot so validation cannot mutate authored values or
    // reusable defaults. Application values need the same isolation even when
    // no schema is present because their resolved snapshot is exposed later.
    value = clonePluginOptionsObject(value, source);
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
        schema ? clonePluginOptionsObject(value, source) : value,
      );
  const validation = validate?.(resolved, context);
  if (isPromiseLike(validation)) {
    // Validation is deliberately synchronous because configuration resolution
    // cannot suspend midway through graph analysis. Observe a rejected thenable
    // before reporting the contract violation so it cannot surface later as an
    // unrelated unhandled rejection.
    void Promise.resolve(validation).catch(() => {});
    throw new Error(`[evjs] ${source} validate() must complete synchronously.`);
  }
  if (validation === undefined || validation === true) return resolved;
  if (validation === false) {
    throw new Error(`[evjs] ${source} was rejected by the plugin.`);
  }
  if (typeof validation === "string") {
    throw new Error(`[evjs] ${source} is invalid: ${validation}`);
  }
  throw new Error(
    `[evjs] ${source} validate() must return true, false, a string message, or undefined.`,
  );
}

function getRuntimeApplicationSetting(
  runtime: DefinedPluginRuntime,
): RuntimePluginSetting {
  const setting = getDefinedPluginRuntimeCache(runtime).applicationSetting;
  if (!setting) {
    throw new Error(
      `[evjs] Plugin "${runtime.id}" Application settings were not resolved before setup().`,
    );
  }
  return setting;
}

function readPageOptions<TBundlerCfg>(
  context: PluginContributeContext<TBundlerCfg>,
  runtime: DefinedPluginRuntime,
): DefinedPluginPageOptions<StaticConfigObject>[] {
  const pages: DefinedPluginPageOptions<StaticConfigObject>[] = [];
  for (const page of context.framework.pages) {
    const setting = page.plugins[runtime.id];
    if (!setting?.enabled) continue;
    if (!setting.options) {
      throw new Error(
        `[evjs] Internal invariant: enabled Page plugin "${runtime.id}" has no resolved options.`,
      );
    }
    pages.push({
      page,
      options: setting.options as StaticConfigObject,
    });
  }
  return pages;
}

const DEFINED_PLUGIN_DESCRIPTOR_FIELDS = [
  "id",
  "application",
  "page",
  "dependencies",
  "optionalDependencies",
  "enforce",
  "configure",
  "setup",
  "contribute",
  "contributePage",
] as const;

function snapshotDefinedPluginDescriptor<
  TId extends string,
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
>(
  descriptor: DefinedPluginDescriptorInput<
    TId,
    TApplication,
    TPage,
    TBundlerCfg
  >,
): DefinedPluginDescriptorInput<TId, TApplication, TPage, TBundlerCfg> {
  if (!isPlainRecord(descriptor)) {
    throw new Error("[evjs] definePlugin() expects a plain descriptor object.");
  }
  assertOnlyKeys(
    descriptor,
    DEFINED_PLUGIN_DESCRIPTOR_FIELDS,
    "definePlugin() descriptor",
  );

  const snapshot = Object.create(Object.getPrototypeOf(descriptor)) as Record<
    string,
    unknown
  >;
  for (const key of Reflect.ownKeys(descriptor)) {
    const property = Object.getOwnPropertyDescriptor(descriptor, key);
    if (
      typeof key !== "string" ||
      !property ||
      !property.enumerable ||
      !("value" in property)
    ) {
      throw new Error(
        `[evjs] definePlugin() descriptor field ${String(key)} must be an enumerable own data property.`,
      );
    }
    const value =
      key === "dependencies" || key === "optionalDependencies"
        ? snapshotPluginDependencyIds(property.value, `definePlugin() ${key}`)
        : property.value;
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
  }
  return Object.freeze(snapshot) as DefinedPluginDescriptorInput<
    TId,
    TApplication,
    TPage,
    TBundlerCfg
  >;
}

function snapshotPluginDependencyIds(value: unknown, source: string): unknown {
  if (!Array.isArray(value)) return value;

  const snapshot: unknown[] = new Array(value.length);
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !property.enumerable || !("value" in property)) {
      throw new Error(
        `[evjs] ${source}[${index}] must be an enumerable own data property.`,
      );
    }
    Object.defineProperty(snapshot, index, {
      configurable: false,
      enumerable: true,
      value: property.value,
      writable: false,
    });
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/.test(key) ||
      Number(key) >= value.length
    ) {
      throw new Error(
        `[evjs] ${source} must not contain symbol or extra properties.`,
      );
    }
  }
  return Object.freeze(snapshot);
}

function assertDefinedPluginDescriptor<
  TId extends string,
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
>(
  descriptor: DefinedPluginDescriptor<TId, TApplication, TPage, TBundlerCfg>,
): void {
  assertOnlyKeys(
    descriptor,
    DEFINED_PLUGIN_DESCRIPTOR_FIELDS,
    "definePlugin() descriptor",
  );
  assertPluginId(descriptor.id, "definePlugin() id");
  const dependencies = assertPluginDependencyNames(
    descriptor.dependencies,
    "definePlugin() dependencies",
  );
  const optionalDependencies = assertPluginDependencyNames(
    descriptor.optionalDependencies,
    "definePlugin() optionalDependencies",
  );
  if (dependencies.includes(descriptor.id)) {
    throw new Error(
      `[evjs] definePlugin() dependencies must not contain the plugin's own id "${descriptor.id}".`,
    );
  }
  if (optionalDependencies.includes(descriptor.id)) {
    throw new Error(
      `[evjs] definePlugin() optionalDependencies must not contain the plugin's own id "${descriptor.id}".`,
    );
  }
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
    "configure",
    "setup",
    "contribute",
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
    if (contract !== undefined && contract[PLUGIN_OPTIONS_CONTRACT] !== true) {
      throw new Error(
        `[evjs] definePlugin() ${owner} must be declared with pluginOptions().`,
      );
    }
  }
  if (!descriptor.page && descriptor.contributePage) {
    throw new Error(
      "[evjs] definePlugin() contributePage requires Page options.",
    );
  }
}

function assertPluginDependencyNames(
  value: unknown,
  source: string,
): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`[evjs] ${source} must be an array of plugin ids.`);
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const [index, name] of value.entries()) {
    assertPluginId(name, `${source}[${index}]`);
    if (seen.has(name)) {
      throw new Error(
        `[evjs] ${source} must not contain duplicate plugin id "${name}".`,
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
): ApplicationPluginOptionsContext {
  return Object.freeze({
    owner: "application",
    applicationId: "default",
    applicationRoot: ".",
    routingMode: config?.routing?.mode ?? "spa",
  });
}

function mergePluginOptionsDefaults(
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
          value: mergePluginOptionsDefaults(
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

function clonePluginOptionsObject(value: unknown, source: string): object {
  return clonePluginOptionsValue(
    assertConfigObject(value, source),
    new WeakMap(),
  ) as object;
}

function clonePluginOptionsValue(
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
            value: clonePluginOptionsValue(descriptor.value, seen),
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
