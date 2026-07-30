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
  type PluginOptionsContext,
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
          `[evjs] Plugin key "${declaration.key}" is declared by both "${existing.name}" and "${declaration.name}". Every installed plugin key must be unique.`,
        );
      }
    }
    const registered = Object.freeze({ ...declaration, plugin });
    entries.push(registered);
    if (!registered.key) {
      continue;
    }
    byKey.set(registered.key, registered);
    defineRecordValue(
      catalogEntries,
      registered.key,
      createCatalogEntry(registered),
    );
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
    if (setting && entry.key) {
      defineRecordValue(applicationSettings, entry.key, {
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
      getOwn(configured, requirePluginKey(entry)),
      context,
    );
    if (setting) {
      defineRecordValue(
        settings,
        requirePluginKey(entry),
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
        `[evjs] ${source ?? `Page "${pageId}"`} configures plugin "${key}", but plugin "${entry.name}" does not declare Page options.`,
      );
    }
  }
}

function assertApplicationSettings(
  registry: PluginSettingsRegistry,
  settings: CoreApplicationPluginSettings,
): void {
  for (const entry of registry.entries) {
    if (entry.key && !Object.hasOwn(settings, entry.key)) {
      throw new Error(
        `[evjs] Application options for installed plugin "${entry.name}" were not resolved before graph analysis.`,
      );
    }
  }
}

function requirePluginKey(entry: RegisteredPluginSettings): string {
  if (entry.key) return entry.key;
  throw new Error(
    `[evjs] Internal invariant: plugin "${entry.name}" with options has no key.`,
  );
}

function graphApplicationContext(
  page: CoreGraph["pages"][string],
  application: CoreGraph["applications"][string] | undefined,
  configured: ResolvedPageFileConfig | undefined,
): PluginOptionsContext {
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

function createCatalogEntry(
  registered: RegisteredPluginSettings,
): CorePluginCatalogEntrySnapshot {
  const page = registered.page
    ? {
        ...contractSnapshot(registered.page),
        defaultable: registered.page.defaultable,
      }
    : undefined;
  if (registered.application) {
    return {
      name: registered.name,
      application: contractSnapshot(registered.application),
      ...(page ? { page } : {}),
    };
  }
  if (page) {
    return { name: registered.name, page };
  }
  throw new Error(
    `[evjs] Internal invariant: plugin "${registered.name}" has a key without Application or Page options.`,
  );
}

function cloneCatalog(
  catalog: CorePluginCatalogSnapshot,
): CorePluginCatalogSnapshot {
  return {
    entries: Object.fromEntries(
      Object.entries(catalog.entries).map(([key, entry]) => [
        key,
        cloneCatalogEntry(entry),
      ]),
    ),
  };
}

function cloneCatalogEntry(
  entry: CorePluginCatalogEntrySnapshot,
): CorePluginCatalogEntrySnapshot {
  const page = entry.page ? { ...entry.page } : undefined;
  if (entry.application) {
    return {
      name: entry.name,
      application: { ...entry.application },
      ...(page ? { page } : {}),
    };
  }
  if (page) {
    return { name: entry.name, page };
  }
  throw new Error(
    `[evjs] Internal invariant: catalog plugin "${entry.name}" has no Application or Page contract.`,
  );
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
