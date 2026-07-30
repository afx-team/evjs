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
import type { ResolvedPagePluginConfigInput } from "../../config/plugins.js";
import {
  createPluginApplicationSettingContext,
  type DefinedPluginDeclaration,
  getDefinedPluginDeclaration,
  type PluginSettingContext,
  resolveDefinedPluginApplicationSetting,
  resolveDefinedPluginPageSetting,
} from "../../plugin/defined.js";
import type { Plugin } from "../../plugin/index.js";
import type { ResolvedPageFileConfig } from "./page-config-module.js";
import { orderPluginsByDependencies } from "./plugin-lifecycle.js";

export interface RegisteredPluginSettings extends DefinedPluginDeclaration {
  readonly plugin: object;
}

export interface PluginSettingsRegistry {
  readonly entries: readonly RegisteredPluginSettings[];
  readonly byKey: ReadonlyMap<string, RegisteredPluginSettings>;
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

export interface ResolvePluginSettingsStateOptions {
  /** Reuse the Application snapshot prepared at the start of config hooks. */
  readonly reusePreparedApplicationSettings?: boolean;
}

export interface ApplyPluginSettingsOptions {
  readonly applicationSettings?: CoreApplicationPluginSettings;
  readonly canonicalPages?: Readonly<Record<string, ResolvedPageFileConfig>>;
  readonly session?: PluginSettingsResolutionSession;
}

/** Collect installed descriptor plugins and their public owner contracts. */
export function collectPluginSettingsRegistry<TBundlerCfg>(
  plugins: readonly Plugin<TBundlerCfg>[],
): PluginSettingsRegistry {
  const entries: RegisteredPluginSettings[] = [];
  const byKey = new Map<string, RegisteredPluginSettings>();
  const catalogEntries: Record<string, CorePluginCatalogEntrySnapshot> = {};

  for (const plugin of orderPluginsByDependencies([...plugins])) {
    const declaration = getDefinedPluginDeclaration(plugin);
    if (!declaration) continue;
    if (declaration.key) {
      const existing = byKey.get(declaration.key);
      if (existing) {
        throw new Error(
          `[evjs] Plugin key "${declaration.key}" is declared by both "${existing.id}" and "${declaration.id}". Every installed Page plugin key must be unique.`,
        );
      }
    }
    const registered = Object.freeze({ ...declaration, plugin });
    entries.push(registered);
    if (registered.key) byKey.set(registered.key, registered);
    if (Object.hasOwn(catalogEntries, registered.settingsKey)) {
      throw new Error(
        `[evjs] Plugin internal key "${registered.settingsKey}" is shared by multiple installed plugins. Application-only keys are derived from complete plugin ids; use distinct ids.`,
      );
    }
    defineRecordValue(catalogEntries, registered.settingsKey, {
      id: registered.id,
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
    byKey,
    catalog: Object.freeze({ entries: Object.freeze(catalogEntries) }),
  });
}

/** Resolve Application settings before plugin setup executes. */
export function resolvePluginSettingsState<TBundlerCfg>(
  config: ResolvedConfig<TBundlerCfg>,
  registry: PluginSettingsRegistry = collectPluginSettingsRegistry(
    config.plugins,
  ),
  options: ResolvePluginSettingsStateOptions = {},
): ResolvedPluginSettingsState {
  const applicationSettings: CoreApplicationPluginSettings = {};
  const context = createPluginApplicationSettingContext(config);
  for (const entry of registry.entries) {
    const setting = resolveDefinedPluginApplicationSetting(
      entry.plugin,
      context,
      { reusePrepared: options.reusePreparedApplicationSettings === true },
    );
    if (setting) {
      defineRecordValue(applicationSettings, entry.settingsKey, {
        enabled: setting.enabled,
      });
    }
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
      getOwn(configured, requirePageKey(entry)),
      context,
    );
    if (setting) {
      defineRecordValue(
        settings,
        requirePageKey(entry),
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
  configured: Readonly<Record<string, ResolvedPagePluginConfigInput>>,
  source: string | undefined,
  pageId: string,
): void {
  for (const key of Object.keys(configured)) {
    const entry = registry.byKey.get(key);
    if (!entry) {
      throw new Error(
        `[evjs] ${source ?? `Page "${pageId}"`} configures plugin "${key}", but that plugin is not installed by ev.config.`,
      );
    }
    if (!entry.page) {
      throw new Error(
        `[evjs] ${source ?? `Page "${pageId}"`} configures plugin "${key}", but plugin "${entry.id}" does not declare Page configuration.`,
      );
    }
  }
}

function assertApplicationSettings(
  registry: PluginSettingsRegistry,
  settings: CoreApplicationPluginSettings,
): void {
  for (const entry of registry.entries) {
    if (!Object.hasOwn(settings, entry.settingsKey)) {
      throw new Error(
        `[evjs] Application settings for installed plugin "${entry.id}" were not resolved before graph analysis.`,
      );
    }
  }
}

function requirePageKey(entry: RegisteredPluginSettings): string {
  if (entry.key) return entry.key;
  throw new Error(
    `[evjs] Internal invariant: Page-aware plugin "${entry.id}" has no Page key.`,
  );
}

function graphApplicationContext(
  page: CoreGraph["pages"][string],
  application: CoreGraph["applications"][string] | undefined,
  configured: ResolvedPageFileConfig | undefined,
): PluginSettingContext {
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
          id: entry.id,
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
  return {
    enabled: setting.enabled,
    ...(setting.config ? { config: structuredClone(setting.config) } : {}),
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
