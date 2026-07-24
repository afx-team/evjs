import type { CoreGraph, CorePageNode } from "@evjs/shared/manifest";
import { assertCoreGraph } from "@evjs/shared/manifest";
import type {
  PluginDescribeContext,
  PluginPageExtensionContext,
  PluginPageExtensionDefinition,
} from "../../plugin/index.js";
import type { ResolvedPageFileConfig } from "./page-config-module.js";
import { orderPluginsByDependencies } from "./plugin-lifecycle.js";
import { assertJsonSerializable } from "./strict-json.js";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface RegisteredPageExtension {
  pluginName: string;
  namespace: string;
  schemaVersion?: string;
  defaults?: PluginPageExtensionDefinition["defaults"];
  merge?: PluginPageExtensionDefinition["merge"];
  validate?: PluginPageExtensionDefinition["validate"];
}

export interface PluginGraphDeclaration {
  name: string;
  dependencies?: string[];
  optionalDependencies?: string[];
  enforce?: "pre" | "normal" | "post";
  describe?: (context: PluginDescribeContext) => void;
}

export interface PluginExtensionRegistry {
  readonly pageExtensions: readonly RegisteredPageExtension[];
}

export interface ApplyPageExtensionOptions {
  canonical?: Readonly<Record<string, ResolvedPageFileConfig>>;
}

/**
 * Resolve declarative Page extensions after provider normalization.
 */
export function applyPluginPageExtensions(
  graph: CoreGraph,
  registry: PluginExtensionRegistry,
  options: ApplyPageExtensionOptions = {},
): CoreGraph {
  const declarations = registry.pageExtensions;
  assertCanonicalPageConfigInputs(graph, declarations, options.canonical);
  if (declarations.length === 0) return graph;
  assertNamespaceAvailability(graph, declarations);

  const pages = createRecord<CorePageNode>();
  for (const [pageId, page] of Object.entries(graph.pages)) {
    let extensions = { ...page.extensions };
    const canonicalConfig = options.canonical?.[pageId];
    for (const declaration of declarations) {
      const context = createPageContext(pageId, page, canonicalConfig);
      const canonical = readCanonicalValue(
        canonicalConfig,
        declaration,
        context,
      );
      const defaults = resolveDefaults(declaration, context);
      const value = resolveExtensionValue(
        declaration,
        defaults,
        canonical,
        context,
      );
      if (value === undefined) continue;
      assertJsonSerializable(
        value,
        `Plugin "${declaration.pluginName}" Page extension "${declaration.namespace}" for Page "${pageId}"`,
      );
      runExtensionValidation(declaration, value, context);
      extensions = {
        ...extensions,
        [declaration.namespace]: cloneJsonValue(value),
      };
    }
    defineRecordValue(pages, pageId, { ...page, extensions });
  }

  const namespaces = { ...graph.extensions.namespaces };
  for (const declaration of declarations) {
    namespaces[declaration.namespace] = {
      producer: declaration.pluginName,
      owners: ["page"],
      ...(declaration.schemaVersion
        ? { schemaVersion: declaration.schemaVersion }
        : {}),
    };
  }

  const resolved: CoreGraph = {
    ...graph,
    pages,
    extensions: { namespaces },
  };
  assertCoreGraph(resolved, "resolved plugin Page extensions");
  return resolved;
}

export function collectPluginExtensionRegistry(
  plugins: PluginGraphDeclaration[],
): PluginExtensionRegistry {
  const declarations: RegisteredPageExtension[] = [];
  const namespaceOwners = new Map<string, string>();

  for (const plugin of orderPluginsByDependencies(plugins)) {
    if (!plugin.describe) continue;
    const result = plugin.describe({
      pageExtension(definition) {
        const declaration = validatePageExtensionDefinition(
          plugin.name,
          definition,
        );
        const namespaceOwner = namespaceOwners.get(declaration.namespace);
        if (namespaceOwner) {
          throw new Error(
            `[evjs] Plugin "${plugin.name}" cannot register Page extension namespace "${declaration.namespace}" because it is already registered by "${namespaceOwner}".`,
          );
        }
        if (
          definition.defaults !== undefined &&
          typeof definition.defaults !== "function"
        ) {
          assertJsonSerializable(
            definition.defaults,
            `Plugin "${plugin.name}" Page extension "${declaration.namespace}" defaults`,
          );
        }
        namespaceOwners.set(declaration.namespace, plugin.name);
        declarations.push(declaration);
      },
    });
    if (isPromiseLike(result)) {
      throw new Error(
        `[evjs] Plugin "${plugin.name}" describe() must be synchronous.`,
      );
    }
  }

  return Object.freeze({
    pageExtensions: Object.freeze(
      declarations.map((declaration) => Object.freeze(declaration)),
    ),
  });
}

function assertCanonicalPageConfigInputs(
  graph: CoreGraph,
  declarations: readonly RegisteredPageExtension[],
  configs: Readonly<Record<string, ResolvedPageFileConfig>> | undefined,
): void {
  if (!configs) return;
  const declarationsByNamespace = new Map(
    declarations.map((declaration) => [declaration.namespace, declaration]),
  );
  for (const [pageId, config] of Object.entries(configs)) {
    if (!Object.hasOwn(graph.pages, pageId)) {
      throw new Error(
        `[evjs] Page config "${config.source}" targets unknown CoreGraph Page "${pageId}".`,
      );
    }
    for (const namespace of Object.keys(config.extensions)) {
      if (declarationsByNamespace.has(namespace)) continue;
      throw new Error(
        `[evjs] Page "${pageId}" config "${config.source}" uses extension namespace "${namespace}", but no plugin pageExtension() registered it.`,
      );
    }
  }
}

function assertNamespaceAvailability(
  graph: CoreGraph,
  declarations: readonly RegisteredPageExtension[],
): void {
  for (const declaration of declarations) {
    const existing = Object.hasOwn(
      graph.extensions.namespaces,
      declaration.namespace,
    )
      ? graph.extensions.namespaces[declaration.namespace]
      : undefined;
    if (existing) {
      throw new Error(
        `[evjs] Plugin "${declaration.pluginName}" cannot register Page extension namespace "${declaration.namespace}" because it is already registered by "${existing.producer}".`,
      );
    }
  }
}

function validatePageExtensionDefinition(
  pluginName: string,
  value: unknown,
): RegisteredPageExtension {
  if (!isPlainObject(value)) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" pageExtension() requires a definition object.`,
    );
  }
  const definition = value as Record<string, unknown>;
  assertEnumerableDataProperties(
    definition,
    `Plugin "${pluginName}" Page extension definition`,
  );
  const allowedKeys = new Set([
    "namespace",
    "schemaVersion",
    "defaults",
    "merge",
    "validate",
  ]);
  for (const key of Object.keys(definition)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `[evjs] Plugin "${pluginName}" Page extension definition has unknown field "${key}".`,
      );
    }
  }
  const namespace = assertNamespacedId(
    definition.namespace,
    `Plugin "${pluginName}" Page extension namespace`,
  );
  const schemaVersion =
    definition.schemaVersion === undefined
      ? undefined
      : assertSafeNonEmptyString(
          definition.schemaVersion,
          `Plugin "${pluginName}" Page extension "${namespace}" schemaVersion`,
        );
  if (
    definition.merge !== undefined &&
    typeof definition.merge !== "function"
  ) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" Page extension "${namespace}" merge must be a function.`,
    );
  }
  if (
    definition.validate !== undefined &&
    typeof definition.validate !== "function"
  ) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" Page extension "${namespace}" validate must be a function.`,
    );
  }
  return {
    pluginName,
    namespace,
    ...(schemaVersion ? { schemaVersion } : {}),
    ...(definition.defaults !== undefined
      ? {
          defaults:
            definition.defaults as PluginPageExtensionDefinition["defaults"],
        }
      : {}),
    ...(definition.merge
      ? {
          merge: definition.merge as RegisteredPageExtension["merge"],
        }
      : {}),
    ...(definition.validate
      ? {
          validate: definition.validate as RegisteredPageExtension["validate"],
        }
      : {}),
  };
}

function createPageContext(
  pageId: string,
  page: CorePageNode,
  canonicalConfig?: ResolvedPageFileConfig,
): PluginPageExtensionContext {
  return {
    pageId,
    pageModule: page.source.module,
    ...(page.source.scope.kind === "directory"
      ? { pageRoot: page.source.scope.root }
      : {}),
    ...(canonicalConfig ? { configSource: canonicalConfig.source } : {}),
  };
}

function readCanonicalValue(
  config: ResolvedPageFileConfig | undefined,
  declaration: RegisteredPageExtension,
  context: PluginPageExtensionContext,
): { present: boolean; value: unknown } {
  if (!config || !Object.hasOwn(config.extensions, declaration.namespace)) {
    return { present: false, value: undefined };
  }
  const value = config.extensions[declaration.namespace];
  assertJsonSerializable(
    value,
    `Plugin "${declaration.pluginName}" canonical Page extension "${declaration.namespace}" for Page "${context.pageId}"`,
  );
  return { present: true, value: cloneJsonValue(value) };
}

function resolveDefaults(
  declaration: RegisteredPageExtension,
  context: PluginPageExtensionContext,
): unknown {
  const value =
    typeof declaration.defaults === "function"
      ? declaration.defaults(context)
      : declaration.defaults;
  if (isPromiseLike(value)) {
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" Page extension "${declaration.namespace}" defaults callback must be synchronous.`,
    );
  }
  if (value === undefined) return undefined;
  assertJsonSerializable(
    value,
    `Plugin "${declaration.pluginName}" Page extension "${declaration.namespace}" defaults for Page "${context.pageId}"`,
  );
  return cloneJsonValue(value);
}

function resolveExtensionValue(
  declaration: RegisteredPageExtension,
  defaults: unknown,
  configured: { present: boolean; value: unknown },
  context: PluginPageExtensionContext,
): unknown {
  if (!configured.present) return defaults;
  const raw = configured.value;
  if (declaration.merge) {
    const value = declaration.merge(defaults, raw, context);
    if (isPromiseLike(value)) {
      throw new Error(
        `[evjs] Plugin "${declaration.pluginName}" Page extension "${declaration.namespace}" merge callback must be synchronous.`,
      );
    }
    return value;
  }
  if (isPlainObject(defaults) && isPlainObject(raw)) {
    return { ...defaults, ...raw };
  }
  return raw;
}

function runExtensionValidation(
  declaration: RegisteredPageExtension,
  value: unknown,
  context: PluginPageExtensionContext,
): void {
  if (!declaration.validate) return;
  let result: undefined | boolean | string;
  try {
    result = declaration.validate(value, context) as
      | undefined
      | boolean
      | string;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" rejected Page extension "${declaration.namespace}" for Page "${context.pageId}": ${message}`,
    );
  }
  if (isPromiseLike(result)) {
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" Page extension "${declaration.namespace}" validate callback must be synchronous.`,
    );
  }
  if (result === false || typeof result === "string") {
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" rejected Page extension "${declaration.namespace}" for Page "${context.pageId}"${typeof result === "string" ? `: ${result}` : "."}`,
    );
  }
  if (result !== undefined && result !== true) {
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" Page extension "${declaration.namespace}" validate callback must return true, false, a message, or undefined.`,
    );
  }
}

function assertEnumerableDataProperties(value: object, source: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new Error(`[evjs] ${source} contains an unsupported symbol field.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(
        `[evjs] ${source}.${key} must be an enumerable own data property.`,
      );
    }
  }
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertNamespacedId(value: unknown, source: string): string {
  const namespace = assertSafeNonEmptyString(value, source);
  const separator = namespace.indexOf("/");
  if (
    !namespace.startsWith("@") ||
    separator < 2 ||
    separator === namespace.length - 1
  ) {
    throw new Error(
      `[evjs] ${source} must be a namespaced id such as "@company/feature".`,
    );
  }
  return namespace;
}

function assertSafeNonEmptyString(value: unknown, source: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[evjs] ${source} must be a non-empty string.`);
  }
  if (value !== value.trim() || /\s/.test(value) || UNSAFE_KEYS.has(value)) {
    throw new Error(`[evjs] ${source} must be a safe trimmed string.`);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  let current: object | null = value;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "then");
    if (descriptor) {
      return "value" in descriptor && typeof descriptor.value === "function";
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}

function createRecord<T>(): Record<string, T> {
  return {};
}

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
