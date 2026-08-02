import type {
  CoreApplicationPluginSettings,
  CoreGraph,
  CorePagePluginSetting,
  CorePagePluginSettings,
  CorePluginCatalogEntrySnapshot,
  CorePluginCatalogSnapshot,
} from "@evjs/shared/manifest";
import { assertCoreGraph } from "@evjs/shared/manifest";
import type { ResolvedConfig } from "../../config/index.js";
import type { ResolvedPagePluginOptionsInput } from "../../config/plugins.js";
import {
  createPluginApplicationSettingContext,
  type DefinedPluginDeclaration,
  getDefinedPluginDeclaration,
  type PluginOptionsContext,
  resolveDefinedPluginApplicationSetting,
  resolveDefinedPluginPageSetting,
} from "../../plugin/defined.js";
import type { Plugin } from "../../plugin/index.js";
import type { ResolvedPageFileConfig } from "./page-config-module.js";
import { orderPluginsByDependencies } from "./plugin-lifecycle.js";

export interface RegisteredPluginSettings {
  readonly id: string;
  readonly application?: DefinedPluginDeclaration["application"];
  readonly page?: DefinedPluginDeclaration["page"];
  readonly plugin: object;
}

export interface PluginSettingsRegistry {
  readonly entries: readonly RegisteredPluginSettings[];
  readonly byId: ReadonlyMap<string, RegisteredPluginSettings>;
  readonly catalog: CorePluginCatalogSnapshot;
}

interface CachedPageSettings {
  readonly fingerprint: string;
  readonly settings: CorePagePluginSettings;
}

export interface PluginSettingsResolutionSession {
  readonly registry: PluginSettingsRegistry;
  readonly pageResolutions: Map<string, CachedPageSettings>;
}

export interface ResolvedPluginSettingsState {
  readonly registry: PluginSettingsRegistry;
  readonly applicationSettings: CoreApplicationPluginSettings;
}

export interface ApplyPluginSettingsOptions {
  readonly applicationSettings?: CoreApplicationPluginSettings;
  readonly canonicalPages?: Readonly<Record<string, ResolvedPageFileConfig>>;
  readonly session?: PluginSettingsResolutionSession;
}

/** Collect every installed plugin and any public owner contracts it declares. */
export function collectPluginSettingsRegistry<TBundlerCfg>(
  plugins: readonly Plugin<TBundlerCfg>[],
): PluginSettingsRegistry {
  const entries: RegisteredPluginSettings[] = [];
  const byId = new Map<string, RegisteredPluginSettings>();
  const catalogEntries: Record<string, CorePluginCatalogEntrySnapshot> = {};

  for (const plugin of orderPluginsByDependencies([...plugins])) {
    const pluginId = plugin.id;
    const declaration = getDefinedPluginDeclaration(plugin);
    const existing = byId.get(pluginId);
    if (existing) {
      throw new Error(
        `[evjs] Duplicate plugin id "${pluginId}". Plugin ids must be globally unique.`,
      );
    }
    const registered: RegisteredPluginSettings = Object.freeze({
      id: pluginId,
      ...(declaration?.application
        ? { application: declaration.application }
        : {}),
      ...(declaration?.page ? { page: declaration.page } : {}),
      plugin,
    });
    entries.push(registered);
    byId.set(registered.id, registered);
    defineRecordValue(catalogEntries, registered.id, {
      ...(registered.application
        ? { application: contractSnapshot(registered.application) }
        : {}),
      ...(registered.page
        ? {
            page: {
              ...contractSnapshot(registered.page),
              defaultable: registered.page.defaultable,
            },
          }
        : {}),
    });
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    byId,
    catalog: Object.freeze({ entries: Object.freeze(catalogEntries) }),
  });
}

/** Resolve Application settings before plugin setup executes. */
export function resolvePluginSettingsState<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  registry: PluginSettingsRegistry = collectPluginSettingsRegistry(
    config.plugins,
  ),
): ResolvedPluginSettingsState {
  const applicationSettings: CoreApplicationPluginSettings = {};
  const context = createPluginApplicationSettingContext(config);
  for (const entry of registry.entries) {
    const setting = resolveDefinedPluginApplicationSetting(
      entry.plugin,
      context,
    );
    defineRecordValue(applicationSettings, entry.id, {
      enabled: setting?.enabled ?? true,
    });
  }
  return Object.freeze({
    registry,
    applicationSettings: Object.freeze(applicationSettings),
  });
}

export function createPluginSettingsResolutionSession(
  registry: PluginSettingsRegistry,
): PluginSettingsResolutionSession {
  return Object.freeze({ registry, pageResolutions: new Map() });
}

/** Apply effective Application/Page settings to one normalized CoreGraph. */
export function applyPluginSettings(
  graph: CoreGraph,
  registry: PluginSettingsRegistry,
  options: ApplyPluginSettingsOptions = {},
): CoreGraph {
  if (options.session && options.session.registry !== registry) {
    throw new Error(
      "[evjs] Plugin settings resolution session must use the registry that created it.",
    );
  }
  const applicationSettings = options.applicationSettings ?? {};
  assertApplicationSettings(registry, applicationSettings);

  const applications = Object.fromEntries(
    Object.entries(graph.applications).map(([id, application]) => [
      id,
      {
        ...application,
        plugins: cloneApplicationSettings(applicationSettings),
      },
    ]),
  );
  const pages = Object.fromEntries(
    Object.entries(graph.pages).map(([pageId, page]) => {
      const configured = options.canonicalPages?.[pageId];
      return [
        pageId,
        {
          ...page,
          plugins: resolvePageSettings(
            registry,
            page,
            graph.applications[page.applicationId],
            configured,
            applicationSettings,
            options.session,
          ),
        },
      ];
    }),
  );
  const resolved: CoreGraph = {
    ...graph,
    applications,
    pages,
    plugins: cloneCatalog(registry.catalog),
  };
  assertCoreGraph(resolved, "resolved plugin settings");
  return resolved;
}

function resolvePageSettings(
  registry: PluginSettingsRegistry,
  page: CoreGraph["pages"][string],
  application: CoreGraph["applications"][string] | undefined,
  configuredPage: ResolvedPageFileConfig | undefined,
  applicationSettings: CoreApplicationPluginSettings,
  session: PluginSettingsResolutionSession | undefined,
): CorePagePluginSettings {
  const configured = configuredPage?.plugins ?? {};
  assertPageConfiguredKeys(
    registry,
    configured,
    configuredPage?.source,
    page.id,
  );
  const fingerprint = JSON.stringify({
    source: configuredPage?.source,
    page: page.source,
    configured,
    applicationSettings,
  });
  const cached = session?.pageResolutions.get(page.id);
  if (cached?.fingerprint === fingerprint)
    return cloneSettings(cached.settings);

  const settings: CorePagePluginSettings = {};
  const context = graphApplicationContext(page, application, configuredPage);
  for (const entry of registry.entries) {
    if (!entry.page) continue;
    const setting = resolveDefinedPluginPageSetting(
      entry.plugin,
      getOwn(configured, entry.id),
      context,
    );
    if (setting) {
      defineRecordValue(
        settings,
        entry.id,
        cloneSetting(setting as CorePagePluginSetting),
      );
    }
  }
  const snapshot = Object.freeze(settings);
  session?.pageResolutions.set(page.id, { fingerprint, settings: snapshot });
  return cloneSettings(snapshot);
}

function assertPageConfiguredKeys(
  registry: PluginSettingsRegistry,
  configured: Readonly<Record<string, ResolvedPagePluginOptionsInput>>,
  source: string | undefined,
  pageId: string,
): void {
  for (const id of Object.keys(configured)) {
    const entry = registry.byId.get(id);
    if (!entry) {
      throw new Error(
        `[evjs] ${source ?? `Page "${pageId}"`} configures plugin "${id}", but that plugin is not installed by ev.config.`,
      );
    }
    if (!entry.page) {
      throw new Error(
        `[evjs] ${source ?? `Page "${pageId}"`} configures plugin "${id}", but plugin "${entry.id}" does not declare Page options.`,
      );
    }
  }
}

function assertApplicationSettings(
  registry: PluginSettingsRegistry,
  settings: CoreApplicationPluginSettings,
): void {
  for (const entry of registry.entries) {
    if (!Object.hasOwn(settings, entry.id)) {
      throw new Error(
        `[evjs] Application settings for installed plugin "${entry.id}" were not resolved before graph analysis.`,
      );
    }
  }
}

function graphApplicationContext(
  page: CoreGraph["pages"][string],
  application: CoreGraph["applications"][string] | undefined,
  configured: ResolvedPageFileConfig | undefined,
): Extract<PluginOptionsContext, { readonly owner: "page" }> {
  return Object.freeze({
    owner: "page",
    applicationId: page.applicationId,
    applicationRoot: application?.root ?? ".",
    routingMode: application?.routingMode ?? "spa",
    pageId: page.id,
    pageModule: page.source.module,
    ...(page.source.scope.kind === "directory"
      ? { pageRoot: page.source.scope.root }
      : {}),
    ...(configured ? { configSource: configured.source } : {}),
  });
}

function contractSnapshot(contract: { readonly schemaVersion?: string }): {
  schemaVersion?: string;
} {
  return contract.schemaVersion
    ? { schemaVersion: contract.schemaVersion }
    : {};
}

function cloneCatalog(
  catalog: CorePluginCatalogSnapshot,
): CorePluginCatalogSnapshot {
  return {
    entries: Object.fromEntries(
      Object.entries(catalog.entries).map(([key, entry]) => [
        key,
        {
          ...(entry.application
            ? { application: { ...entry.application } }
            : {}),
          ...(entry.page ? { page: { ...entry.page } } : {}),
        },
      ]),
    ),
  };
}

function cloneSettings(
  settings: CorePagePluginSettings,
): CorePagePluginSettings {
  return Object.fromEntries(
    Object.entries(settings).map(([key, setting]) => [
      key,
      cloneSetting(setting),
    ]),
  );
}

function cloneApplicationSettings(
  settings: CoreApplicationPluginSettings,
): CoreApplicationPluginSettings {
  return Object.fromEntries(
    Object.entries(settings).map(([key, setting]) => [
      key,
      { enabled: setting.enabled },
    ]),
  );
}

function cloneSetting(setting: CorePagePluginSetting): CorePagePluginSetting {
  if (!setting.enabled) return { enabled: false };
  return {
    enabled: true,
    options: structuredClone(setting.options),
  };
}

function getOwn<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
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
