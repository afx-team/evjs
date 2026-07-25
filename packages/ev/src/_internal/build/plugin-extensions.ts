import {
  assertEnumerableStaticJsonProperties,
  assertStaticJsonValue,
  cloneStaticJsonValue,
  deepFreezeStaticJsonValue,
  isPlainStaticJsonObject,
} from "@evjs/shared/_internal/static-json";
import type {
  CoreApplicationNode,
  CoreDocumentNode,
  CoreGraph,
  CorePageNode,
  CoreRouteNode,
} from "@evjs/shared/manifest";
import { assertCoreGraph } from "@evjs/shared/manifest";
import {
  assertConfigExtensionNamespace,
  type ResolvedApplicationExtensionValues,
} from "../../config/extensions.js";
import type {
  DefaultBundlerConfig,
  ResolvedConfig,
  ResolvedFrameworkConfig,
} from "../../config/index.js";
import type {
  PluginApplicationExtensionContext,
  PluginDescribeContext,
  PluginDocumentExtensionContext,
  PluginPageExtensionContext,
  PluginRouteExtensionContext,
} from "../../plugin/index.js";
import type { ResolvedPageFileConfig } from "./page-config-module.js";
import { orderPluginsByDependencies } from "./plugin-lifecycle.js";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const PLUGIN_EXTENSION_OWNER_ORDER = [
  "application",
  "page",
  "route",
  "document",
] as const;

type PluginExtensionOwner = (typeof PLUGIN_EXTENSION_OWNER_ORDER)[number];

interface RegisteredExtension<TContext> {
  owner: PluginExtensionOwner;
  pluginName: string;
  namespace: string;
  schemaVersion?: string;
  defaults?: unknown | ((context: TContext) => unknown);
  merge?: (
    defaults: unknown,
    configured: unknown,
    context: TContext,
  ) => unknown;
  validate?: (
    value: unknown,
    context: TContext,
  ) => undefined | boolean | string;
}

export type RegisteredApplicationExtension =
  RegisteredExtension<PluginApplicationExtensionContext>;

export type RegisteredPageExtension =
  RegisteredExtension<PluginPageExtensionContext>;

export type RegisteredRouteExtension =
  RegisteredExtension<PluginRouteExtensionContext>;

export type RegisteredDocumentExtension =
  RegisteredExtension<PluginDocumentExtensionContext>;

export interface RegisteredExtensionNamespace {
  pluginName: string;
  namespace: string;
  schemaVersion?: string;
  owners: readonly PluginExtensionOwner[];
}

export interface PluginGraphDeclaration {
  name: string;
  dependencies?: string[];
  optionalDependencies?: string[];
  enforce?: "pre" | "normal" | "post";
  describe?: (context: PluginDescribeContext) => void;
}

export interface PluginExtensionRegistry {
  readonly applicationExtensions: readonly RegisteredApplicationExtension[];
  readonly pageExtensions: readonly RegisteredPageExtension[];
  readonly routeExtensions: readonly RegisteredRouteExtension[];
  readonly documentExtensions: readonly RegisteredDocumentExtension[];
  readonly namespaces: readonly RegisteredExtensionNamespace[];
}

interface CachedOwnerExtensionResolution {
  readonly fingerprint: string;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface PluginExtensionResolutionSession {
  readonly registry: PluginExtensionRegistry;
  readonly pageResolutions: Map<string, CachedOwnerExtensionResolution>;
  readonly routeResolutions: Map<string, CachedOwnerExtensionResolution>;
  readonly documentResolutions: Map<string, CachedOwnerExtensionResolution>;
}

export interface ConfiguredOwnerExtensionInput {
  readonly source: string;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export interface ApplyPluginExtensionOptions {
  /** Values already resolved before plugin setup. */
  applicationExtensions?: Readonly<Record<string, unknown>>;
  canonicalPages?: Readonly<Record<string, ResolvedPageFileConfig>>;
  routeExtensions?: Readonly<Record<string, ConfiguredOwnerExtensionInput>>;
  documentExtensions?: Readonly<Record<string, ConfiguredOwnerExtensionInput>>;
  extensionResolutionSession?: PluginExtensionResolutionSession;
}

export interface ApplicationExtensionConfigInput {
  extensions?: Readonly<Record<string, unknown>>;
  routing?: { mode: "spa" | "mpa" };
  application?: unknown;
}

/**
 * Resolve Application extension values before plugin setup.
 *
 * The returned snapshot is isolated and deeply frozen for `ctx.config`.
 */
export function resolvePluginApplicationExtensions(
  config: ApplicationExtensionConfigInput,
  registry: PluginExtensionRegistry,
): ResolvedApplicationExtensionValues {
  const configured = config.extensions ?? {};
  const declarations = registry.applicationExtensions;
  assertConfiguredNamespaces(
    configured,
    declarations,
    "config.extensions",
    "applicationExtension()",
  );

  const routingMode =
    config.routing?.mode ?? (config.application ? "spa" : undefined);
  if (!routingMode) {
    if (Object.keys(configured).length > 0) {
      throw new Error(
        "[evjs] config.extensions configures Application extensions, but the project has no framework Application. Configure routing or remove config.extensions.",
      );
    }
    return Object.freeze({}) as ResolvedApplicationExtensionValues;
  }

  const context: PluginApplicationExtensionContext = {
    applicationId: "default",
    applicationRoot: ".",
    routingMode,
  };
  const values = resolveOwnerExtensions(
    declarations,
    configured,
    context,
    'Application "default"',
  );
  return deepFreezeStaticJsonValue(
    values,
  ) as ResolvedApplicationExtensionValues;
}

export interface ResolvedPluginExtensionState<
  TBundlerCfg = DefaultBundlerConfig,
> {
  registry: PluginExtensionRegistry;
  applicationExtensions: ResolvedApplicationExtensionValues;
  config: ResolvedFrameworkConfig<TBundlerCfg>;
}

/**
 * Resolve the complete extension state once, before plugin setup.
 */
export function resolvePluginExtensionState<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  registry: PluginExtensionRegistry = collectPluginExtensionRegistry(
    config.plugins,
  ),
): ResolvedPluginExtensionState<TBundlerCfg> {
  const applicationExtensions = resolvePluginApplicationExtensions(
    config,
    registry,
  );
  return {
    registry,
    applicationExtensions,
    config: {
      ...config,
      extensions: applicationExtensions,
    },
  };
}

/**
 * Scope Page extension resolution to one framework analysis.
 *
 * Alias convergence may rebuild the CoreGraph, but each unchanged Page input
 * reuses the first validated snapshot within this scope.
 */
export function createPluginExtensionResolutionSession(
  registry: PluginExtensionRegistry,
): PluginExtensionResolutionSession {
  return Object.freeze({
    registry,
    pageResolutions: new Map(),
    routeResolutions: new Map(),
    documentResolutions: new Map(),
  });
}

/**
 * Apply all registered plugin extension owners to a normalized CoreGraph.
 */
export function applyPluginExtensions(
  graph: CoreGraph,
  registry: PluginExtensionRegistry,
  options: ApplyPluginExtensionOptions = {},
): CoreGraph {
  const extensionResolutionSession = options.extensionResolutionSession;
  if (
    extensionResolutionSession &&
    extensionResolutionSession.registry !== registry
  ) {
    throw new Error(
      "[evjs] Plugin extension resolution session must use the registry that created it.",
    );
  }
  const applicationValues = options.applicationExtensions ?? {};
  assertResolvedApplicationInputs(
    graph,
    registry.applicationExtensions,
    applicationValues,
  );
  assertCanonicalPageConfigInputs(
    graph,
    registry.pageExtensions,
    options.canonicalPages,
  );
  const routeExtensionInputs = collectConfiguredRouteExtensionInputs(
    graph,
    options.canonicalPages,
    options.routeExtensions,
  );
  assertConfiguredRouteExtensionInputs(
    graph,
    registry.routeExtensions,
    routeExtensionInputs,
  );
  const documentExtensionInputs = collectConfiguredDocumentExtensionInputs(
    graph,
    options.canonicalPages,
    options.documentExtensions,
  );
  assertConfiguredDocumentExtensionInputs(
    graph,
    registry.documentExtensions,
    documentExtensionInputs,
  );
  if (registry.namespaces.length === 0) return graph;
  assertNamespaceAvailability(graph, registry.namespaces);

  const applications = createRecord<CoreApplicationNode>();
  for (const [applicationId, application] of Object.entries(
    graph.applications,
  )) {
    const extensions =
      applicationId === "default"
        ? {
            ...application.extensions,
            ...cloneStaticJsonValue(applicationValues),
          }
        : { ...application.extensions };
    defineRecordValue(applications, applicationId, {
      ...application,
      extensions,
    });
  }

  const pages = createRecord<CorePageNode>();
  for (const [pageId, page] of Object.entries(graph.pages)) {
    const canonicalConfig = options.canonicalPages?.[pageId];
    const context = createPageContext(pageId, page, canonicalConfig);
    const configured = canonicalConfig?.extensions ?? {};
    const resolvedExtensions = resolvePageExtensions(
      extensionResolutionSession,
      registry.pageExtensions,
      configured,
      context,
      `Page "${pageId}"`,
    );
    defineRecordValue(pages, pageId, {
      ...page,
      extensions: {
        ...page.extensions,
        ...resolvedExtensions,
      },
    });
  }

  const routes = graph.routes.map((route) => {
    const configuredInput = routeExtensionInputs[route.id];
    const context = createRouteContext(route);
    const resolvedExtensions = resolveRouteExtensions(
      extensionResolutionSession,
      registry.routeExtensions,
      configuredInput?.extensions ?? {},
      context,
      `Route "${route.id}"`,
    );
    return {
      ...route,
      extensions: {
        ...route.extensions,
        ...resolvedExtensions,
      },
    };
  });

  const documents = createRecord<CoreDocumentNode>();
  for (const [documentId, document] of Object.entries(graph.documents)) {
    const configuredInput = documentExtensionInputs[documentId];
    const context = createDocumentContext(documentId, document);
    const resolvedExtensions = resolveDocumentExtensions(
      extensionResolutionSession,
      registry.documentExtensions,
      configuredInput?.extensions ?? {},
      context,
      `Document "${documentId}"`,
    );
    defineRecordValue(documents, documentId, {
      ...document,
      extensions: {
        ...document.extensions,
        ...resolvedExtensions,
      },
    });
  }

  const namespaces = { ...graph.extensions.namespaces };
  for (const registration of registry.namespaces) {
    namespaces[registration.namespace] = {
      producer: registration.pluginName,
      owners: [...registration.owners],
      ...(registration.schemaVersion
        ? { schemaVersion: registration.schemaVersion }
        : {}),
    };
  }

  const resolved: CoreGraph = {
    ...graph,
    applications,
    pages,
    routes,
    documents,
    extensions: { namespaces },
  };
  assertCoreGraph(resolved, "resolved plugin extensions");
  return resolved;
}

export function collectPluginExtensionRegistry(
  plugins: PluginGraphDeclaration[],
): PluginExtensionRegistry {
  const applicationExtensions: RegisteredApplicationExtension[] = [];
  const pageExtensions: RegisteredPageExtension[] = [];
  const routeExtensions: RegisteredRouteExtension[] = [];
  const documentExtensions: RegisteredDocumentExtension[] = [];
  const namespaces = new Map<
    string,
    {
      pluginName: string;
      schemaVersion?: string;
      owners: Set<PluginExtensionOwner>;
    }
  >();

  for (const plugin of orderPluginsByDependencies(plugins)) {
    if (!plugin.describe) continue;
    const result = plugin.describe({
      applicationExtension(definition, ..._check) {
        const declaration = validateExtensionDefinition(
          plugin.name,
          "application",
          definition,
        ) as RegisteredApplicationExtension;
        registerExtensionDeclaration(declaration, namespaces);
        applicationExtensions.push(declaration);
      },
      pageExtension(definition, ..._check) {
        const declaration = validateExtensionDefinition(
          plugin.name,
          "page",
          definition,
        ) as RegisteredPageExtension;
        registerExtensionDeclaration(declaration, namespaces);
        pageExtensions.push(declaration);
      },
      routeExtension(definition, ..._check) {
        const declaration = validateExtensionDefinition(
          plugin.name,
          "route",
          definition,
        ) as RegisteredRouteExtension;
        registerExtensionDeclaration(declaration, namespaces);
        routeExtensions.push(declaration);
      },
      documentExtension(definition, ..._check) {
        const declaration = validateExtensionDefinition(
          plugin.name,
          "document",
          definition,
        ) as RegisteredDocumentExtension;
        registerExtensionDeclaration(declaration, namespaces);
        documentExtensions.push(declaration);
      },
    });
    if (isPromiseLike(result)) {
      throw new Error(
        `[evjs] Plugin "${plugin.name}" describe() must be synchronous.`,
      );
    }
  }

  return Object.freeze({
    applicationExtensions: Object.freeze(
      applicationExtensions.map((declaration) => Object.freeze(declaration)),
    ),
    pageExtensions: Object.freeze(
      pageExtensions.map((declaration) => Object.freeze(declaration)),
    ),
    routeExtensions: Object.freeze(
      routeExtensions.map((declaration) => Object.freeze(declaration)),
    ),
    documentExtensions: Object.freeze(
      documentExtensions.map((declaration) => Object.freeze(declaration)),
    ),
    namespaces: Object.freeze(
      [...namespaces.entries()].map(([namespace, registration]) =>
        Object.freeze({
          pluginName: registration.pluginName,
          namespace,
          ...(registration.schemaVersion
            ? { schemaVersion: registration.schemaVersion }
            : {}),
          owners: Object.freeze(
            PLUGIN_EXTENSION_OWNER_ORDER.filter((owner) =>
              registration.owners.has(owner),
            ),
          ),
        }),
      ),
    ),
  });
}

function registerExtensionDeclaration(
  declaration: {
    owner: PluginExtensionOwner;
    pluginName: string;
    namespace: string;
    schemaVersion?: string;
  },
  namespaces: Map<
    string,
    {
      pluginName: string;
      schemaVersion?: string;
      owners: Set<PluginExtensionOwner>;
    }
  >,
): void {
  const existing = namespaces.get(declaration.namespace);
  if (!existing) {
    namespaces.set(declaration.namespace, {
      pluginName: declaration.pluginName,
      ...(declaration.schemaVersion
        ? { schemaVersion: declaration.schemaVersion }
        : {}),
      owners: new Set([declaration.owner]),
    });
    return;
  }
  if (existing.pluginName !== declaration.pluginName) {
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" cannot register ${formatOwnerName(declaration.owner)} extension namespace "${declaration.namespace}" because it is already registered by "${existing.pluginName}".`,
    );
  }
  if (existing.owners.has(declaration.owner)) {
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" registered ${formatOwnerName(declaration.owner)} extension namespace "${declaration.namespace}" more than once.`,
    );
  }
  if (existing.schemaVersion !== declaration.schemaVersion) {
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" must use one schemaVersion for extension namespace "${declaration.namespace}" across all owner kinds.`,
    );
  }
  existing.owners.add(declaration.owner);
}

function assertConfiguredNamespaces<TContext>(
  configured: Readonly<Record<string, unknown>>,
  declarations: readonly RegisteredExtension<TContext>[],
  source: string,
  registrationMethod: string,
): void {
  const declared = new Set(
    declarations.map((declaration) => declaration.namespace),
  );
  for (const namespace of Object.keys(configured)) {
    if (declared.has(namespace)) continue;
    throw new Error(
      `[evjs] ${source} uses extension namespace "${namespace}", but no plugin ${registrationMethod} registered it.`,
    );
  }
}

function assertResolvedApplicationInputs(
  graph: CoreGraph,
  declarations: readonly RegisteredApplicationExtension[],
  values: Readonly<Record<string, unknown>>,
): void {
  assertConfiguredNamespaces(
    values,
    declarations,
    "Resolved Application extensions",
    "applicationExtension()",
  );
  if (
    Object.keys(values).length > 0 &&
    !Object.hasOwn(graph.applications, "default")
  ) {
    throw new Error(
      '[evjs] Resolved Application extensions target missing CoreGraph Application "default".',
    );
  }
}

function assertCanonicalPageConfigInputs(
  graph: CoreGraph,
  declarations: readonly RegisteredPageExtension[],
  configs: Readonly<Record<string, ResolvedPageFileConfig>> | undefined,
): void {
  if (!configs) return;
  for (const [pageId, config] of Object.entries(configs)) {
    if (!Object.hasOwn(graph.pages, pageId)) {
      throw new Error(
        `[evjs] Page config "${config.source}" targets unknown CoreGraph Page "${pageId}".`,
      );
    }
    assertConfiguredNamespaces(
      config.extensions,
      declarations,
      `Page "${pageId}" config "${config.source}"`,
      "pageExtension()",
    );
  }
}

function collectConfiguredRouteExtensionInputs(
  graph: CoreGraph,
  canonicalPages: Readonly<Record<string, ResolvedPageFileConfig>> | undefined,
  explicitInputs:
    | Readonly<Record<string, ConfiguredOwnerExtensionInput>>
    | undefined,
): Record<string, ConfiguredOwnerExtensionInput> {
  const inputs = createRecord<ConfiguredOwnerExtensionInput>();
  for (const [routeId, input] of Object.entries(explicitInputs ?? {})) {
    defineRecordValue(inputs, routeId, input);
  }
  for (const [pageId, config] of Object.entries(canonicalPages ?? {})) {
    if (config.routeExtensions === undefined) continue;
    const source = `Page "${pageId}" config "${config.source}" route.extensions`;
    const routes = graph.routes.filter(
      (route) => route.target.kind === "page" && route.target.pageId === pageId,
    );
    if (routes.length === 0) {
      throw new Error(
        `[evjs] ${source} has no semantic CoreGraph Route targeting Page "${pageId}".`,
      );
    }
    if (routes.length > 1) {
      throw new Error(
        `[evjs] ${source} is ambiguous because Page "${pageId}" is targeted by ${routes.length} semantic Routes. Configure extensions on each application.routes declaration instead.`,
      );
    }
    const route = routes[0];
    if (!route) continue;
    const existing = Object.hasOwn(inputs, route.id)
      ? inputs[route.id]
      : undefined;
    if (!existing) {
      defineRecordValue(inputs, route.id, {
        source,
        extensions: config.routeExtensions,
      });
      continue;
    }
    for (const namespace of Object.keys(config.routeExtensions)) {
      if (!Object.hasOwn(existing.extensions, namespace)) continue;
      throw new Error(
        `[evjs] Route "${route.id}" extension namespace "${namespace}" is configured by both ${existing.source} and ${source}. Keep one value per Route owner.`,
      );
    }
    defineRecordValue(inputs, route.id, {
      source: `${existing.source} and ${source}`,
      extensions: {
        ...existing.extensions,
        ...config.routeExtensions,
      },
    });
  }
  return inputs;
}

function assertConfiguredRouteExtensionInputs(
  graph: CoreGraph,
  declarations: readonly RegisteredRouteExtension[],
  inputs: Readonly<Record<string, ConfiguredOwnerExtensionInput>> | undefined,
): void {
  if (!inputs) return;
  const routeIds = new Set(graph.routes.map((route) => route.id));
  for (const [routeId, input] of Object.entries(inputs)) {
    if (!routeIds.has(routeId)) {
      throw new Error(
        `[evjs] ${input.source} targets unknown CoreGraph Route "${routeId}".`,
      );
    }
    assertConfiguredNamespaces(
      input.extensions,
      declarations,
      input.source,
      "routeExtension()",
    );
  }
}

function collectConfiguredDocumentExtensionInputs(
  graph: CoreGraph,
  canonicalPages: Readonly<Record<string, ResolvedPageFileConfig>> | undefined,
  explicitInputs:
    | Readonly<Record<string, ConfiguredOwnerExtensionInput>>
    | undefined,
): Record<string, ConfiguredOwnerExtensionInput> {
  const inputs = createRecord<ConfiguredOwnerExtensionInput>();
  for (const [documentId, input] of Object.entries(explicitInputs ?? {})) {
    defineRecordValue(inputs, documentId, input);
  }
  for (const [pageId, config] of Object.entries(canonicalPages ?? {})) {
    const extensions = config.document?.extensions;
    if (extensions === undefined) continue;
    const source = `Page "${pageId}" config "${config.source}" document.extensions`;
    const documents = Object.values(graph.documents).filter(
      (document) =>
        document.owner.kind === "page" && document.owner.pageId === pageId,
    );
    if (documents.length === 0) {
      throw new Error(
        `[evjs] ${source} requires a Page-owned CoreGraph Document, but Page "${pageId}" does not materialize one. SPA uses an Application-owned Document; use a Document extension default or Page-owned MPA materialization.`,
      );
    }
    if (documents.length > 1) {
      throw new Error(
        `[evjs] ${source} is ambiguous because Page "${pageId}" owns ${documents.length} CoreGraph Documents.`,
      );
    }
    const document = documents[0];
    if (!document) continue;
    const existing = Object.hasOwn(inputs, document.id)
      ? inputs[document.id]
      : undefined;
    if (!existing) {
      defineRecordValue(inputs, document.id, { source, extensions });
      continue;
    }
    for (const namespace of Object.keys(extensions)) {
      if (!Object.hasOwn(existing.extensions, namespace)) continue;
      throw new Error(
        `[evjs] Document "${document.id}" extension namespace "${namespace}" is configured by both ${existing.source} and ${source}. Keep one value per Document owner.`,
      );
    }
    defineRecordValue(inputs, document.id, {
      source: `${existing.source} and ${source}`,
      extensions: {
        ...existing.extensions,
        ...extensions,
      },
    });
  }
  return inputs;
}

function assertConfiguredDocumentExtensionInputs(
  graph: CoreGraph,
  declarations: readonly RegisteredDocumentExtension[],
  inputs: Readonly<Record<string, ConfiguredOwnerExtensionInput>> | undefined,
): void {
  if (!inputs) return;
  for (const [documentId, input] of Object.entries(inputs)) {
    if (!Object.hasOwn(graph.documents, documentId)) {
      throw new Error(
        `[evjs] ${input.source} targets unknown CoreGraph Document "${documentId}".`,
      );
    }
    assertConfiguredNamespaces(
      input.extensions,
      declarations,
      input.source,
      "documentExtension()",
    );
  }
}

function assertNamespaceAvailability(
  graph: CoreGraph,
  registrations: readonly RegisteredExtensionNamespace[],
): void {
  for (const registration of registrations) {
    const existing = Object.hasOwn(
      graph.extensions.namespaces,
      registration.namespace,
    )
      ? graph.extensions.namespaces[registration.namespace]
      : undefined;
    if (!existing) continue;
    throw new Error(
      `[evjs] Plugin "${registration.pluginName}" cannot register extension namespace "${registration.namespace}" because it is already registered by "${existing.producer}".`,
    );
  }
}

function validateExtensionDefinition<TContext>(
  pluginName: string,
  owner: PluginExtensionOwner,
  value: unknown,
): RegisteredExtension<TContext> {
  if (!isPlainStaticJsonObject(value)) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" ${owner}Extension() requires a definition object.`,
    );
  }
  const definition = value as Record<string, unknown>;
  const ownerName = formatOwnerName(owner);
  assertEnumerableStaticJsonProperties(
    definition,
    `Plugin "${pluginName}" ${ownerName} extension definition`,
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
        `[evjs] Plugin "${pluginName}" ${ownerName} extension definition has unknown field "${key}".`,
      );
    }
  }
  assertConfigExtensionNamespace(
    definition.namespace,
    `Plugin "${pluginName}" ${ownerName} extension namespace`,
  );
  const namespace = definition.namespace;
  const schemaVersion =
    definition.schemaVersion === undefined
      ? undefined
      : assertSafeNonEmptyString(
          definition.schemaVersion,
          `Plugin "${pluginName}" ${ownerName} extension "${namespace}" schemaVersion`,
        );
  if (
    definition.merge !== undefined &&
    typeof definition.merge !== "function"
  ) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" ${ownerName} extension "${namespace}" merge must be a function.`,
    );
  }
  if (
    definition.validate !== undefined &&
    typeof definition.validate !== "function"
  ) {
    throw new Error(
      `[evjs] Plugin "${pluginName}" ${ownerName} extension "${namespace}" validate must be a function.`,
    );
  }
  if (
    definition.defaults !== undefined &&
    typeof definition.defaults !== "function"
  ) {
    assertStaticJsonValue(
      definition.defaults,
      `Plugin "${pluginName}" ${ownerName} extension "${namespace}" defaults`,
    );
  }
  return {
    owner,
    pluginName,
    namespace,
    ...(schemaVersion ? { schemaVersion } : {}),
    ...(definition.defaults !== undefined
      ? {
          defaults:
            definition.defaults as RegisteredExtension<TContext>["defaults"],
        }
      : {}),
    ...(definition.merge
      ? {
          merge: definition.merge as RegisteredExtension<TContext>["merge"],
        }
      : {}),
    ...(definition.validate
      ? {
          validate:
            definition.validate as RegisteredExtension<TContext>["validate"],
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

function createRouteContext(route: CoreRouteNode): PluginRouteExtensionContext {
  return {
    routeId: route.id,
    applicationId: route.applicationId,
    ...(route.parentId ? { parentId: route.parentId } : {}),
    pattern: cloneStaticJsonValue(route.pattern),
    target: cloneStaticJsonValue(route.target),
    facets: cloneStaticJsonValue(route.facets),
    ...(route.provenance.source ? { source: route.provenance.source } : {}),
  };
}

function createDocumentContext(
  documentId: string,
  document: CoreDocumentNode,
): PluginDocumentExtensionContext {
  return {
    documentId,
    applicationId: document.applicationId,
    template: document.template,
    output: document.output,
    ...(document.aliases ? { aliases: [...document.aliases] } : {}),
    owner: cloneStaticJsonValue(document.owner),
    ...(document.mount ? { mount: document.mount } : {}),
    ...(document.bootstrap
      ? { bootstrap: cloneStaticJsonValue(document.bootstrap) }
      : {}),
    ...(document.provenance.source
      ? { source: document.provenance.source }
      : {}),
  };
}

function resolvePageExtensions(
  session: PluginExtensionResolutionSession | undefined,
  declarations: readonly RegisteredPageExtension[],
  configured: Readonly<Record<string, unknown>>,
  context: PluginPageExtensionContext,
  target: string,
): Record<string, unknown> {
  return resolveCachedOwnerExtensions(
    session?.pageResolutions,
    context.pageId,
    declarations,
    configured,
    context,
    target,
  );
}

function resolveRouteExtensions(
  session: PluginExtensionResolutionSession | undefined,
  declarations: readonly RegisteredRouteExtension[],
  configured: Readonly<Record<string, unknown>>,
  context: PluginRouteExtensionContext,
  target: string,
): Record<string, unknown> {
  return resolveCachedOwnerExtensions(
    session?.routeResolutions,
    context.routeId,
    declarations,
    configured,
    context,
    target,
  );
}

function resolveDocumentExtensions(
  session: PluginExtensionResolutionSession | undefined,
  declarations: readonly RegisteredDocumentExtension[],
  configured: Readonly<Record<string, unknown>>,
  context: PluginDocumentExtensionContext,
  target: string,
): Record<string, unknown> {
  return resolveCachedOwnerExtensions(
    session?.documentResolutions,
    context.documentId,
    declarations,
    configured,
    context,
    target,
  );
}

function resolveCachedOwnerExtensions<TContext>(
  cache: Map<string, CachedOwnerExtensionResolution> | undefined,
  cacheKey: string,
  declarations: readonly RegisteredExtension<TContext>[],
  configured: Readonly<Record<string, unknown>>,
  context: TContext,
  target: string,
): Record<string, unknown> {
  if (!cache) {
    return resolveOwnerExtensions(declarations, configured, context, target);
  }

  const fingerprint = createOwnerExtensionInputFingerprint(
    context,
    configured,
    target,
  );
  const cached = cache.get(cacheKey);
  if (cached?.fingerprint === fingerprint) {
    return cloneStaticJsonValue(cached.extensions);
  }

  const resolved = resolveOwnerExtensions(
    declarations,
    configured,
    context,
    target,
  );
  const snapshot = deepFreezeStaticJsonValue(cloneStaticJsonValue(resolved));
  cache.set(cacheKey, {
    fingerprint,
    extensions: snapshot,
  });
  return cloneStaticJsonValue(snapshot);
}

function createOwnerExtensionInputFingerprint(
  context: unknown,
  configured: Readonly<Record<string, unknown>>,
  target: string,
): string {
  assertStaticJsonValue(context, `${target} extension context`);
  assertStaticJsonValue(configured, `${target} resolved extension inputs`);
  return JSON.stringify([
    sortStaticJsonValue(context),
    sortStaticJsonValue(configured),
  ]);
}

function sortStaticJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortStaticJsonValue);
  }
  if (!isPlainStaticJsonObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortStaticJsonValue(value[key])]),
  );
}

function resolveOwnerExtensions<TContext>(
  declarations: readonly RegisteredExtension<TContext>[],
  configuredValues: Readonly<Record<string, unknown>>,
  context: TContext,
  target: string,
): Record<string, unknown> {
  const extensions = createRecord<unknown>();
  for (const declaration of declarations) {
    const configured = readConfiguredValue(
      configuredValues,
      declaration,
      target,
    );
    const defaults = resolveDefaults(declaration, context, target);
    const value = resolveExtensionValue(
      declaration,
      defaults,
      configured,
      context,
    );
    if (value === undefined) continue;
    assertStaticJsonValue(
      value,
      `Plugin "${declaration.pluginName}" ${formatOwnerName(declaration.owner)} extension "${declaration.namespace}" for ${target}`,
    );
    const materializedValue = cloneStaticJsonValue(value);
    const validationValue = deepFreezeStaticJsonValue(
      cloneStaticJsonValue(materializedValue),
    );
    runExtensionValidation(declaration, validationValue, context, target);
    defineRecordValue(extensions, declaration.namespace, materializedValue);
  }
  return extensions;
}

function readConfiguredValue<TContext>(
  values: Readonly<Record<string, unknown>>,
  declaration: RegisteredExtension<TContext>,
  target: string,
): { present: boolean; value: unknown } {
  if (!Object.hasOwn(values, declaration.namespace)) {
    return { present: false, value: undefined };
  }
  const value = values[declaration.namespace];
  assertStaticJsonValue(
    value,
    `Plugin "${declaration.pluginName}" configured ${formatOwnerName(declaration.owner)} extension "${declaration.namespace}" for ${target}`,
  );
  return { present: true, value: cloneStaticJsonValue(value) };
}

function resolveDefaults<TContext>(
  declaration: RegisteredExtension<TContext>,
  context: TContext,
  target: string,
): unknown {
  const value =
    typeof declaration.defaults === "function"
      ? declaration.defaults(context)
      : declaration.defaults;
  if (isPromiseLike(value)) {
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" ${formatOwnerName(declaration.owner)} extension "${declaration.namespace}" defaults callback must be synchronous.`,
    );
  }
  if (value === undefined) return undefined;
  assertStaticJsonValue(
    value,
    `Plugin "${declaration.pluginName}" ${formatOwnerName(declaration.owner)} extension "${declaration.namespace}" defaults for ${target}`,
  );
  return cloneStaticJsonValue(value);
}

function resolveExtensionValue<TContext>(
  declaration: RegisteredExtension<TContext>,
  defaults: unknown,
  configured: { present: boolean; value: unknown },
  context: TContext,
): unknown {
  if (!configured.present) return defaults;
  const raw = configured.value;
  if (declaration.merge) {
    const value = declaration.merge(defaults, raw, context);
    if (isPromiseLike(value)) {
      throw new Error(
        `[evjs] Plugin "${declaration.pluginName}" ${formatOwnerName(declaration.owner)} extension "${declaration.namespace}" merge callback must be synchronous.`,
      );
    }
    return value;
  }
  if (isPlainStaticJsonObject(defaults) && isPlainStaticJsonObject(raw)) {
    return { ...defaults, ...raw };
  }
  return raw;
}

function runExtensionValidation<TContext>(
  declaration: RegisteredExtension<TContext>,
  value: unknown,
  context: TContext,
  target: string,
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
      `[evjs] Plugin "${declaration.pluginName}" rejected ${formatOwnerName(declaration.owner)} extension "${declaration.namespace}" for ${target}: ${message}`,
    );
  }
  if (isPromiseLike(result)) {
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" ${formatOwnerName(declaration.owner)} extension "${declaration.namespace}" validate callback must be synchronous.`,
    );
  }
  if (result === false || typeof result === "string") {
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" rejected ${formatOwnerName(declaration.owner)} extension "${declaration.namespace}" for ${target}${typeof result === "string" ? `: ${result}` : "."}`,
    );
  }
  if (result !== undefined && result !== true) {
    throw new Error(
      `[evjs] Plugin "${declaration.pluginName}" ${formatOwnerName(declaration.owner)} extension "${declaration.namespace}" validate callback must return true, false, a message, or undefined.`,
    );
  }
}

function formatOwnerName(owner: PluginExtensionOwner): string {
  switch (owner) {
    case "application":
      return "Application";
    case "page":
      return "Page";
    case "route":
      return "Route";
    case "document":
      return "Document";
  }
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
