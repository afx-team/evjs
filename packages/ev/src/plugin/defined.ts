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
import { getPluginEmissionApi } from "./emission-scope.js";
import { runPluginHook } from "./errors.js";
import type {
  FrameworkPageView,
  GeneratedModuleRef,
  Plugin,
  PluginConfigureContext,
  PluginEmitIRContext,
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

export interface PluginOptionsContext {
  readonly owner: "application" | "page";
  readonly applicationId: string;
  readonly applicationRoot: string;
  readonly routingMode: "spa" | "mpa";
  readonly pageId?: string;
  readonly pageModule?: string;
  readonly pageRoot?: string;
  readonly configSource?: string;
}

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
  TDefinitionInput extends object = TInput,
> {
  readonly [PLUGIN_OPTIONS_CONTRACT]: true;
  readonly [pluginOptionsTypes]: {
    readonly input: TInput;
    readonly output: TOutput;
    readonly defaultable: TDefaultable;
  };
  readonly schemaVersion?: string;
  readonly defaultable: TDefaultable;
  readonly defaults?:
    | TDefinitionInput
    | ((context: PluginOptionsContext) => TDefinitionInput);
  readonly schema?: StandardSchemaV1<TDefinitionInput, TOutput>;
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
 * Declare one independently validated Application/Page options contract.
 *
 * Passing defaults makes the contract usable through an omitted value or
 * page-level `true`. Explicit objects are deeply merged over those defaults
 * before schema/plugin validation.
 */
export function pluginOptions<TValue extends object>(
  ...args: RequiredPluginConfigArgs<
    TValue,
    PluginOptionsDefinition<TValue> & {
      readonly defaults: TValue | ((context: PluginOptionsContext) => TValue);
    }
  >
): PluginOptionsContract<DeepPartial<TValue>, TValue, true, TValue>;
export function pluginOptions<TValue extends object>(
  ...args: OptionalPluginConfigArgs<
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
  true,
  SchemaInput<TSchema>
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
    throw new Error(
      "[evjs] pluginOptions() definition must be a plain object.",
    );
  }
  assertOnlyKeys(
    options,
    ["schemaVersion", "defaults", "validate"],
    "pluginOptions() definition",
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

type ContractInput<TContract> = TContract extends {
  readonly [pluginOptionsTypes]: { readonly input: infer TInput };
}
  ? TInput extends object
    ? TInput
    : never
  : never;

type ContractOutput<TContract> = TContract extends {
  readonly [pluginOptionsTypes]: { readonly output: infer TOutput };
}
  ? TOutput extends object
    ? TOutput
    : never
  : never;

type ContractDefaultable<TContract> = TContract extends {
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

type ResolvedContractOptions<TContract> =
  TContract extends AnyPluginOptionsContract
    ? DeepReadonly<ContractOutput<TContract>>
    : undefined;

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

export interface DefinedPluginEmitIRContext<
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg = DefaultBundlerConfig,
> extends PluginEmitIRContext<TBundlerCfg> {
  /** Resolved Application options passed to the plugin factory. */
  readonly options: ResolvedContractOptions<TApplication>;
  /** Pages whose plugin behavior is enabled, with resolved Page options. */
  readonly pages: readonly DefinedPluginPageOptions<ContractOutput<TPage>>[];
}

export interface DefinedPluginEmitPageIRContext<
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg = DefaultBundlerConfig,
> extends PluginEmitIRContext<TBundlerCfg> {
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
  config: Config<TActualBundlerCfg>,
  context: DefinedPluginConfigureContext<TApplication>,
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
  TApplication extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
> = <TActualBundlerCfg extends TBundlerCfg = TBundlerCfg>(
  context: DefinedPluginSetupContext<TApplication, TActualBundlerCfg>,
) => DefinedPluginSetupResult<TBundlerCfg>;

type DefinedPluginEmitIRHook<
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
> = <TActualBundlerCfg extends TBundlerCfg = TBundlerCfg>(
  context: DefinedPluginEmitIRContext<TApplication, TPage, TActualBundlerCfg>,
) => MaybePromise<void>;

type DefinedPluginEmitPageIRHook<
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
> = <TActualBundlerCfg extends TBundlerCfg = TBundlerCfg>(
  context: DefinedPluginEmitPageIRContext<
    TApplication,
    TPage,
    TActualBundlerCfg
  >,
) => MaybePromise<void>;

type DefinedPluginRequiredKey<TKey extends string | undefined> = {
  /** Short key shared by Application and Page plugin options. */
  readonly key: StaticallyKnownPluginKey<Exclude<TKey, undefined>>;
};

type StaticallyKnownPluginKey<TKey extends string> = string extends TKey
  ? never
  : IsUnion<TKey> extends true
    ? never
    : TKey;

type DefinedPluginKeyDescriptor<
  TKey extends string | undefined,
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
> = [TApplication] extends [AnyPluginOptionsContract]
  ? DefinedPluginRequiredKey<TKey>
  : [TPage] extends [AnyPluginOptionsContract]
    ? DefinedPluginRequiredKey<TKey>
    : { readonly key?: never };

type DefinedPluginApplicationDescriptor<
  TApplication extends AnyPluginOptionsContract | undefined,
> = [TApplication] extends [AnyPluginOptionsContract]
  ? {
      /** Application factory options. Independent from Page options. */
      readonly application: TApplication;
    }
  : { readonly application?: never };

type DefinedPluginPageDescriptor<
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
> = [TPage] extends [AnyPluginOptionsContract]
  ? {
      /** Page-level options. Independent from Application options. */
      readonly page: TPage;
      /** Emit IR records for one enabled Page. */
      readonly emitPageIR?: DefinedPluginEmitPageIRHook<
        TApplication,
        TPage,
        TBundlerCfg
      >;
    }
  : {
      readonly page?: never;
      readonly emitPageIR?: never;
    };

export type DefinedPluginDescriptor<
  TName extends string,
  TKey extends string | undefined,
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg = unknown,
> = {
  /** Stable dependency and lifecycle identity, normally the package name. */
  readonly name: TName;
  readonly dependencies?: readonly string[];
  readonly optionalDependencies?: readonly string[];
  readonly enforce?: "pre" | "normal" | "post";
  readonly configure?: DefinedPluginConfigureHook<TApplication, TBundlerCfg>;
  readonly setup?: DefinedPluginSetupHook<TApplication, TBundlerCfg>;
  /** Emit IR records shared by every enabled owner. */
  readonly emitIR?: DefinedPluginEmitIRHook<TApplication, TPage, TBundlerCfg>;
} & DefinedPluginApplicationDescriptor<TApplication> &
  DefinedPluginKeyDescriptor<TKey, TApplication, TPage> &
  DefinedPluginPageDescriptor<TApplication, TPage, TBundlerCfg>;

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
  TName extends string = string,
  TKey extends string | undefined = string | undefined,
  TApplicationInput extends object = object,
  TApplicationOutput extends object = object,
  TPageInput extends object = object,
  TPageOutput extends object = object,
  TPageDefaultable extends boolean = boolean,
  TBundlerCfg = unknown,
> = Plugin<TBundlerCfg> & {
  readonly name: TName;
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

type FactoryArgs<TContract> = TContract extends AnyPluginOptionsContract
  ? ContractDefaultable<TContract> extends true
    ? [options?: ContractInput<TContract> & object]
    : [options: ContractInput<TContract> & object]
  : [];

type DefinedPluginFactoryInstance<
  TName extends string,
  TKey extends string | undefined,
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg = unknown,
> = DefinedPluginInstance<
  TName,
  TKey,
  ContractInput<TApplication>,
  ContractOutput<TApplication>,
  ContractInput<TPage>,
  ContractOutput<TPage>,
  ContractDefaultable<TPage>,
  TBundlerCfg
>;

export type DefinedPluginFactory<
  TName extends string,
  TKey extends string | undefined,
  TApplication extends AnyPluginOptionsContract | undefined,
  TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg = unknown,
> = ((
  ...args: FactoryArgs<TApplication>
) => DefinedPluginFactoryInstance<
  TName,
  TKey,
  TApplication,
  TPage,
  TBundlerCfg
>) &
  (TPage extends AnyPluginOptionsContract
    ? ContractDefaultable<TPage> extends true
      ? {
          /** Install the plugin while requiring Pages to opt in explicitly. */
          withPageOptIn(
            ...args: FactoryArgs<TApplication>
          ): DefinedPluginFactoryInstance<
            TName,
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
  readonly name: string;
  readonly key?: string;
  readonly application?: AnyPluginOptionsContract;
  readonly page?: AnyPluginOptionsContract;
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
  const TName extends string,
  const TKey extends string | undefined = undefined,
  const TApplication extends AnyPluginOptionsContract | undefined = undefined,
  const TPage extends AnyPluginOptionsContract | undefined = undefined,
>(
  descriptor: DefinedPluginDescriptor<TName, TKey, TApplication, TPage>,
): DefinedPluginFactory<TName, TKey, TApplication, TPage>;
/** Define a plugin factory tied to one explicit bundler config shape. */
export function definePlugin<
  const TName extends string,
  const TKey extends string | undefined,
  const TApplication extends AnyPluginOptionsContract | undefined,
  const TPage extends AnyPluginOptionsContract | undefined,
  TBundlerCfg,
>(
  descriptor: DefinedPluginDescriptor<
    TName,
    TKey,
    TApplication,
    TPage,
    TBundlerCfg
  >,
): DefinedPluginFactory<TName, TKey, TApplication, TPage, TBundlerCfg>;
export function definePlugin<
  const TName extends string,
  const TKey extends string | undefined = undefined,
  const TApplication extends AnyPluginOptionsContract | undefined = undefined,
  const TPage extends AnyPluginOptionsContract | undefined = undefined,
  TBundlerCfg = unknown,
>(
  descriptor: DefinedPluginDescriptor<
    TName,
    TKey,
    TApplication,
    TPage,
    TBundlerCfg
  >,
): DefinedPluginFactory<TName, TKey, TApplication, TPage, TBundlerCfg> {
  assertDefinedPluginDescriptor(descriptor);

  const create = (
    installMode: "all" | "pages",
    args: readonly unknown[],
  ): DefinedPluginFactoryInstance<
    TName,
    TKey,
    TApplication,
    TPage,
    TBundlerCfg
  > => {
    const application = descriptor.application;
    if (!application && args.length > 0) {
      throw new Error(
        `[evjs] Plugin "${descriptor.name}" does not declare Application options.`,
      );
    }
    if (args.length > 1) {
      throw new Error(
        `[evjs] Plugin "${descriptor.name}" accepts at most one Application options object.`,
      );
    }
    if (application && !application.defaultable && args.length === 0) {
      throw new Error(
        `[evjs] Plugin "${descriptor.name}" requires Application options.`,
      );
    }

    const runtime: DefinedPluginRuntime = {
      name: descriptor.name,
      ...(descriptor.key ? { key: descriptor.key } : {}),
      ...(application ? { application } : {}),
      ...(descriptor.page ? { page: descriptor.page } : {}),
      applicationConfigured: args[0],
      pagesByDefault: installMode === "all",
      applicationSettingPrepared: false,
    };
    const emitPageIR = descriptor.emitPageIR as
      | DefinedPluginEmitPageIRHook<TApplication, TPage, TBundlerCfg>
      | undefined;
    const plugin: Plugin<TBundlerCfg> = {
      name: descriptor.name,
      ...(descriptor.key ? { key: descriptor.key } : {}),
      ...(descriptor.dependencies
        ? { dependencies: [...descriptor.dependencies] }
        : {}),
      ...(descriptor.optionalDependencies
        ? { optionalDependencies: [...descriptor.optionalDependencies] }
        : {}),
      ...(descriptor.enforce ? { enforce: descriptor.enforce } : {}),
      ...(descriptor.configure
        ? {
            configure: (config, context) =>
              descriptor.configure?.(config, {
                ...context,
                options: resolveConfigureHookApplicationSetting(
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
      ...(descriptor.emitIR || emitPageIR
        ? {
            emitIR: async (context) => {
              const options = getRuntimeApplicationSetting(runtime)
                .config as ResolvedContractOptions<TApplication>;
              const pages = readPageOptions(
                context,
                runtime,
              ) as unknown as DefinedPluginPageOptions<ContractOutput<TPage>>[];
              if (descriptor.emitIR) {
                await descriptor.emitIR({
                  ...context,
                  ...getPluginEmissionApi(context, "emitIR"),
                  options,
                  pages,
                });
              }
              if (emitPageIR) {
                for (const page of pages) {
                  await runPluginHook(descriptor.name, "emitPageIR", () =>
                    emitPageIR({
                      ...context,
                      ...getPluginEmissionApi(context, "emitPageIR"),
                      page: page.page,
                      options,
                      pageOptions: page.options,
                    }),
                  );
                }
              }
            },
          }
        : {}),
    };
    attachDefinedPluginRuntime(plugin, runtime);
    return plugin as DefinedPluginFactoryInstance<
      TName,
      TKey,
      TApplication,
      TPage,
      TBundlerCfg
    >;
  };

  const factory = ((...args: readonly unknown[]) =>
    create("all", args)) as unknown as DefinedPluginFactory<
    TName,
    TKey,
    TApplication,
    TPage,
    TBundlerCfg
  >;
  if (descriptor.page?.defaultable) {
    Object.defineProperty(factory, "withPageOptIn", {
      configurable: false,
      enumerable: true,
      value: (...args: readonly unknown[]) => create("pages", args),
      writable: false,
    });
  }
  return factory;
}

export interface DefinedPluginDeclaration {
  readonly name: string;
  readonly key?: string;
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
    name: runtime.name,
    ...(runtime.key ? { key: runtime.key } : {}),
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

/** @internal Compare the hidden factory contract carried by resolved copies. */
export function hasSameDefinedPluginRuntime(
  left: object,
  right: object,
): boolean {
  return getDefinedPluginRuntime(left) === getDefinedPluginRuntime(right);
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
  context: PluginOptionsContext,
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

/** @internal Resolve one build-scoped Application snapshot before configure hooks. */
export function prepareDefinedPluginApplicationSetting(
  plugin: object,
  context: PluginOptionsContext,
): void {
  const runtime = getDefinedPluginRuntime(plugin);
  if (!runtime) return;
  resolveRuntimeApplicationSetting(runtime, context);
  runtime.applicationSettingPrepared = true;
}

function resolveConfigureHookApplicationSetting(
  runtime: DefinedPluginRuntime,
  context: PluginOptionsContext,
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
  context: PluginOptionsContext,
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
        `${runtime.name} Application options`,
        false,
      );
    } else {
      throw new Error(
        `[evjs] Plugin "${runtime.name}" requires Application options.`,
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
  context: PluginOptionsContext,
): RuntimePluginSetting | undefined {
  const runtime = getDefinedPluginRuntime(plugin);
  if (!runtime) return undefined;
  if (!runtime.page) {
    if (configured !== undefined) {
      throw new Error(
        `[evjs] Plugin "${runtime.name}" does not declare Page options.`,
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
      `[evjs] ${context.configSource ?? context.pageId ?? "Page"} enables plugin "${runtime.key ?? runtime.name}" with true, but the plugin has no Page defaults. Configure an object instead.`,
    );
  }

  const config = resolvePluginContract(
    runtime.page,
    typeof configured === "object" ? configured : undefined,
    context,
    createPageOptionsSource(runtime, context),
    true,
  );
  return Object.freeze({ enabled: true, config });
}

function createPageOptionsSource(
  runtime: DefinedPluginRuntime,
  context: PluginOptionsContext,
): string {
  const key = runtime.key ?? runtime.name;
  let location = `plugins.${key}`;
  if (context.configSource) {
    location = `${context.configSource} ${location}`;
  } else if (context.pageId) {
    location = `Page "${context.pageId}" ${location}`;
  }
  return `Plugin "${runtime.name}" Page options at ${location}`;
}

function resolvePluginContract(
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
      `[evjs] Plugin "${runtime.name}" Application options were not resolved before setup().`,
    );
  }
  return runtime.applicationSetting;
}

function readPageOptions<TBundlerCfg>(
  context: PluginEmitIRContext<TBundlerCfg>,
  runtime: DefinedPluginRuntime,
): DefinedPluginPageOptions<StaticConfigObject>[] {
  const pages: DefinedPluginPageOptions<StaticConfigObject>[] = [];
  for (const page of context.framework.pages) {
    const setting = runtime.key ? page.plugins[runtime.key] : undefined;
    if (!setting?.enabled) continue;
    if (!setting.config) {
      throw new Error(
        `[evjs] Internal invariant: enabled Page plugin "${runtime.name}" has no resolved options.`,
      );
    }
    pages.push({
      page,
      options: setting.config as StaticConfigObject,
    });
  }
  return pages;
}

interface RuntimeDefinedPluginDescriptor {
  readonly name: unknown;
  readonly key?: unknown;
  readonly application?: AnyPluginOptionsContract;
  readonly page?: AnyPluginOptionsContract;
  readonly dependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly enforce?: unknown;
  readonly configure?: unknown;
  readonly setup?: unknown;
  readonly emitIR?: unknown;
  readonly emitPageIR?: unknown;
}

function assertDefinedPluginDescriptor(
  descriptor: RuntimeDefinedPluginDescriptor,
): void {
  if (!isPlainRecord(descriptor)) {
    throw new Error("[evjs] definePlugin() expects a plain descriptor object.");
  }
  assertOnlyKeys(
    descriptor,
    [
      "name",
      "key",
      "application",
      "page",
      "dependencies",
      "optionalDependencies",
      "enforce",
      "configure",
      "setup",
      "emitIR",
      "emitPageIR",
    ],
    "definePlugin() descriptor",
  );
  if (
    typeof descriptor.name !== "string" ||
    descriptor.name.length === 0 ||
    descriptor.name !== descriptor.name.trim()
  ) {
    throw new Error(
      "[evjs] definePlugin() name must be a non-empty string without surrounding whitespace.",
    );
  }
  const hasOptions = Boolean(descriptor.application || descriptor.page);
  if (hasOptions && descriptor.key === undefined) {
    throw new Error(
      "[evjs] definePlugin() key is required when Application or Page options are declared.",
    );
  }
  if (!hasOptions && descriptor.key !== undefined) {
    throw new Error(
      "[evjs] definePlugin() key is only supported when Application or Page options are declared.",
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
  for (const field of ["configure", "setup", "emitIR", "emitPageIR"] as const) {
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
  if (!descriptor.page && descriptor.emitPageIR) {
    throw new Error("[evjs] definePlugin() emitPageIR requires Page options.");
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
): PluginOptionsContext {
  return Object.freeze({
    owner: "application",
    applicationId: "default",
    applicationRoot: ".",
    routingMode: config?.routing?.mode ?? "spa",
  });
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
